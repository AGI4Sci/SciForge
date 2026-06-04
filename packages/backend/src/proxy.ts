import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chatToolNameAliasesFromResponsesTools,
  chatCompletionToResponse,
  functionCallOutputItem,
  makeId,
  messageOutputItem,
  responsesToChatCompletions,
  type ChatCompletionRequest,
  type ChatToolCall,
  type ChatToolNameAliasMap,
  type CodexResponsesProxyOptions,
  type JsonObject,
  type ResponsesRequest,
} from './response-compat';

export interface CodexResponsesProxyServerOptions extends CodexResponsesProxyOptions {
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  forceNonStreamingUpstream?: boolean;
  log?: (message: string) => void;
  fetchImpl?: typeof fetch;
  resolveDynamicOptions?: () => Promise<Partial<CodexResponsesProxyServerOptions>> | Partial<CodexResponsesProxyServerOptions>;
}

export interface StartedCodexResponsesProxy {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

type UpstreamPreflightCategory =
  | 'ready'
  | 'config-missing'
  | 'provider-auth'
  | 'rate-limited'
  | 'upstream-outage'
  | 'repo-bug';

type UpstreamPreflightResult = {
  schemaVersion: 'sciforge.proxy.upstream-preflight.v1';
  check: 'upstream';
  endpoint: '/models';
  ok: boolean;
  category: UpstreamPreflightCategory;
  message: string;
  retryable: boolean;
  durationMs: number;
  timeoutMs: number;
  httpStatus?: number;
  audit?: JsonObject;
  releaseAcceptance: 'not-evaluated';
};

type UpstreamErrorBridge = {
  protocol: 'raw-openai-compatible' | 'responses-to-chat-completions';
  proxyEndpoint: string;
  upstreamEndpoint: string;
  requestFeatures?: JsonObject;
  compatibilityRetry?: JsonObject;
};

type ProviderCapabilityName =
  | 'streaming'
  | 'streaming_tools'
  | 'tool_choice_required'
  | 'tool_choice_object'
  | 'parallel_tool_calls'
  | 'metadata';

type ProviderCompatibilityStrategy =
  | 'native-chat-completions'
  | 'non-streaming-chat-completions'
  | 'simplified-tool-choice-object'
  | 'relaxed-tool-choice-auto'
  | 'omit-parallel-tool-calls'
  | 'omit-metadata';

type ProviderCapabilityProfile = {
  schemaVersion: 'sciforge.proxy.provider-capabilities.v1';
  key: string;
  unsupported: Partial<Record<ProviderCapabilityName, true>>;
  updatedAt: string;
};

type ChatCompletionAttempt = {
  request: ChatCompletionRequest;
  strategies: ProviderCompatibilityStrategy[];
};

type ChatCompletionFailure = {
  status: number;
  payload: string;
  contentType?: string;
  attempt: ChatCompletionAttempt;
  attemptIndex: number;
};

type StreamingState = {
  responseId: string;
  model: string;
  messageItemId: string;
  outputText: string;
  messageStarted: boolean;
  toolCalls: Map<number, MutableToolCall>;
  nextOutputIndex: number;
  toolNameAliases: ChatToolNameAliasMap;
};

type MutableToolCall = {
  itemId: string;
  outputIndex: number;
  outputItemAdded: boolean;
  flushedArgumentsLength: number;
  call: ChatToolCall;
};

export function createCodexResponsesProxyServer(options: CodexResponsesProxyServerOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const upstreamPreflightTimeoutMs = 2_500;
  const capabilityProfiles = new Map<string, ProviderCapabilityProfile>();

  return createServer(async (request, response) => {
    try {
      const dynamicOptions = await options.resolveDynamicOptions?.();
      const requestOptions = { ...options, ...dynamicOptions, fetchImpl, resolveDynamicOptions: options.resolveDynamicOptions };
      const upstreamBaseUrl = trimTrailingSlash(requestOptions.upstreamBaseUrl);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        if (url.searchParams.get('check') === 'upstream') {
          const upstream = await preflightUpstream(request, fetchImpl, requestOptions, upstreamBaseUrl, upstreamPreflightTimeoutMs);
          return sendJson(response, 200, {
            ok: upstream.ok,
            upstreamBaseUrl,
            checkedAt: new Date().toISOString(),
            upstream,
          });
        }
        return sendJson(response, 200, {
          ok: true,
          upstreamBaseUrl,
          checkedAt: new Date().toISOString(),
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        return await proxyRaw(request, response, fetchImpl, requestOptions, `${upstreamBaseUrl}/models`, {
          protocol: 'raw-openai-compatible',
          proxyEndpoint: '/v1/models',
          upstreamEndpoint: '/models',
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        return await proxyRaw(request, response, fetchImpl, requestOptions, `${upstreamBaseUrl}/chat/completions`, {
          protocol: 'raw-openai-compatible',
          proxyEndpoint: '/v1/chat/completions',
          upstreamEndpoint: '/chat/completions',
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        return await handleResponsesRequest(request, response, fetchImpl, requestOptions, capabilityProfiles, upstreamBaseUrl, `${upstreamBaseUrl}/chat/completions`, {
          protocol: 'responses-to-chat-completions',
          proxyEndpoint: '/v1/responses',
          upstreamEndpoint: '/chat/completions',
        });
      }
      return sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found' } });
    } catch (error) {
      options.log?.(`proxy error: ${error instanceof Error ? error.message : String(error)}`);
      return sendJson(response, 500, {
        error: {
          code: 'sciforge_proxy_error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

async function preflightUpstream(
  request: IncomingMessage,
  fetchImpl: typeof fetch,
  options: CodexResponsesProxyServerOptions,
  upstreamBaseUrl: string,
  timeoutMs: number,
): Promise<UpstreamPreflightResult> {
  const startedAt = Date.now();
  const headers = upstreamHeaders(request, options, undefined);
  if (!upstreamBaseUrl) {
    return upstreamPreflightResult({
      category: 'config-missing',
      message: 'Provider proxy upstream base URL is not configured.',
      retryable: false,
      startedAt,
      timeoutMs,
    });
  }
  if (!hasAuthorizationHeader(headers)) {
    return upstreamPreflightResult({
      category: 'config-missing',
      message: 'Provider proxy upstream Authorization is not configured.',
      retryable: false,
      startedAt,
      timeoutMs,
    });
  }

  const upstreamUrl = `${upstreamBaseUrl}/models`;
  try {
    new URL(upstreamUrl);
  } catch {
    return upstreamPreflightResult({
      category: 'repo-bug',
      message: 'Provider proxy upstream /models URL is invalid.',
      retryable: false,
      startedAt,
      timeoutMs,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (upstream.ok) {
      return upstreamPreflightResult({
        category: 'ready',
        message: 'Provider upstream /models preflight succeeded.',
        retryable: false,
        startedAt,
        timeoutMs,
        httpStatus: upstream.status,
      });
    }
    const payload = await upstream.text().catch(() => '');
    return upstreamPreflightResult({
      category: upstreamPreflightCategoryForStatus(upstream.status),
      message: upstreamPreflightMessageForStatus(upstream.status),
      retryable: isRetryableUpstreamStatus(upstream.status),
      startedAt,
      timeoutMs,
      httpStatus: upstream.status,
      audit: buildUpstreamErrorAudit(payload, upstream.headers.get('content-type') ?? undefined),
    });
  } catch (error) {
    clearTimeout(timer);
    const timedOut = isAbortError(error);
    return upstreamPreflightResult({
      category: 'upstream-outage',
      message: timedOut
        ? 'Provider upstream /models preflight timed out.'
        : 'Provider upstream /models preflight failed due to a network or DNS error.',
      retryable: true,
      startedAt,
      timeoutMs,
    });
  }
}

function upstreamPreflightResult(input: {
  category: UpstreamPreflightCategory;
  message: string;
  retryable: boolean;
  startedAt: number;
  timeoutMs: number;
  httpStatus?: number;
  audit?: JsonObject;
}): UpstreamPreflightResult {
  return {
    schemaVersion: 'sciforge.proxy.upstream-preflight.v1',
    check: 'upstream',
    endpoint: '/models',
    ok: input.category === 'ready',
    category: input.category,
    message: input.message,
    retryable: input.retryable,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    timeoutMs: input.timeoutMs,
    httpStatus: input.httpStatus,
    audit: input.audit,
    releaseAcceptance: 'not-evaluated',
  };
}

export async function startCodexResponsesProxyServer(
  options: CodexResponsesProxyServerOptions & { host?: string; port?: number },
): Promise<StartedCodexResponsesProxy> {
  const host = options.host ?? '127.0.0.1';
  const server = createCodexResponsesProxyServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3891, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  return {
    server,
    url,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function handleResponsesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  fetchImpl: typeof fetch,
  options: CodexResponsesProxyServerOptions,
  capabilityProfiles: Map<string, ProviderCapabilityProfile>,
  upstreamBaseUrl: string,
  upstreamUrl: string,
  bridge: UpstreamErrorBridge,
) {
  const body = await readJson(request);
  const responsesRequest = body && typeof body === 'object' && !Array.isArray(body) ? body as ResponsesRequest : {};
  const chatRequest = responsesToChatCompletions(responsesRequest, options);
  const toolNameAliases = chatToolNameAliasesFromResponsesTools(responsesRequest.tools);
  const originalFeatures = chatRequestFeatures(chatRequest);
  const profileKey = providerCapabilityProfileKey(upstreamBaseUrl, chatRequest.model, options, request);
  const profile = capabilityProfiles.get(profileKey) ?? createProviderCapabilityProfile(profileKey);
  const requestFeatures = chatRequestFeatures(chatRequest);
  const responseBridge = {
    ...bridge,
    requestFeatures,
  };
  const attempts = providerCompatibilityAttempts(chatRequest, profile, options.forceNonStreamingUpstream === true);
  let firstFailure: ChatCompletionFailure | undefined;
  let lastFailure: ChatCompletionFailure | undefined;

  for (const [index, attempt] of attempts.entries()) {
    const upstream = await fetchImpl(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders(request, options, 'application/json'),
      body: JSON.stringify(attempt.request),
    });

    if (upstream.ok) {
      learnProviderCapabilities(profile, chatRequest, attempt);
      capabilityProfiles.set(profile.key, profile);
      if (chatRequest.stream === true && attempt.request.stream !== true) {
        const completion = await upstream.json();
        return streamChatCompletionObjectAsResponses(response, completion, responsesRequest, toolNameAliases);
      }
      if (chatRequest.stream === true) {
        return streamChatCompletionAsResponses(response, upstream, chatRequest.model, toolNameAliases);
      }
      const completion = await upstream.json();
      return sendJson(response, 200, chatCompletionToResponse(completion, responsesRequest, toolNameAliases));
    }

    const failure: ChatCompletionFailure = {
      status: upstream.status,
      payload: await upstream.text(),
      contentType: upstream.headers.get('content-type') ?? undefined,
      attempt,
      attemptIndex: index,
    };
    firstFailure ??= failure;
    lastFailure = failure;
    if (!shouldRetryProviderCompatibility(upstream.status) || index === attempts.length - 1) break;
  }

  const failure = lastFailure;
  if (!failure) {
    return sendJson(response, 500, {
      error: {
        code: 'sciforge_proxy_error',
        message: 'Provider compatibility attempts were not generated.',
      },
    });
  }

  return sendJson(response, failure.status, normalizeUpstreamError(
    failure.payload,
    failure.status,
    failure.contentType,
    {
      ...responseBridge,
      compatibilityRetry: compatibilityRetryMetadata(attempts, firstFailure, failure, originalFeatures, profile),
    },
  ));
}

function shouldRetryProviderCompatibility(status: number) {
  return status === 400 || status === 415 || status === 422 || status === 501;
}

function providerCompatibilityAttempts(
  chatRequest: ChatCompletionRequest,
  profile: ProviderCapabilityProfile,
  forceNonStreamingUpstream: boolean,
): ChatCompletionAttempt[] {
  const attempts: ChatCompletionAttempt[] = [];
  const add = (request: ChatCompletionRequest, strategies: ProviderCompatibilityStrategy[]) => {
    const signature = JSON.stringify(request);
    if (attempts.some((attempt) => JSON.stringify(attempt.request) === signature)) return request;
    attempts.push({ request, strategies });
    return request;
  };

  const profiled = applyKnownProviderLowering(chatRequest, profile, forceNonStreamingUpstream);
  let current = add(profiled.request, profiled.strategies);

  const nonStreaming = lowerToNonStreaming(current);
  if (nonStreaming) current = add(nonStreaming, uniqueStrategies([...profiled.strategies, 'non-streaming-chat-completions']));

  const simplifiedToolChoice = lowerObjectToolChoice(current);
  if (simplifiedToolChoice) current = add(simplifiedToolChoice, uniqueStrategies([...strategiesForRequest(attempts, current), 'simplified-tool-choice-object']));

  const relaxedToolChoice = lowerToolChoiceToAuto(current);
  if (relaxedToolChoice) current = add(relaxedToolChoice, uniqueStrategies([...strategiesForRequest(attempts, current), 'relaxed-tool-choice-auto']));

  const withoutParallel = lowerOmitParallelToolCalls(current);
  if (withoutParallel) current = add(withoutParallel, uniqueStrategies([...strategiesForRequest(attempts, current), 'omit-parallel-tool-calls']));

  const withoutMetadata = lowerOmitMetadata(current);
  if (withoutMetadata) add(withoutMetadata, uniqueStrategies([...strategiesForRequest(attempts, current), 'omit-metadata']));

  return attempts;
}

function applyKnownProviderLowering(
  request: ChatCompletionRequest,
  profile: ProviderCapabilityProfile,
  forceNonStreamingUpstream: boolean,
): ChatCompletionAttempt {
  let current = request;
  const strategies: ProviderCompatibilityStrategy[] = [];
  if (
    forceNonStreamingUpstream
    || (profile.unsupported.streaming === true && current.stream === true)
    || (profile.unsupported.streaming_tools === true && current.stream === true && chatRequestHasTools(current))
  ) {
    const lowered = lowerToNonStreaming(current);
    if (lowered) {
      current = lowered;
      strategies.push('non-streaming-chat-completions');
    }
  }
  if (profile.unsupported.tool_choice_object === true) {
    const lowered = lowerObjectToolChoice(current);
    if (lowered) {
      current = lowered;
      strategies.push('simplified-tool-choice-object');
    }
  }
  if (profile.unsupported.tool_choice_required === true) {
    const lowered = lowerToolChoiceToAuto(current);
    if (lowered) {
      current = lowered;
      strategies.push('relaxed-tool-choice-auto');
    }
  }
  if (profile.unsupported.parallel_tool_calls === true) {
    const lowered = lowerOmitParallelToolCalls(current);
    if (lowered) {
      current = lowered;
      strategies.push('omit-parallel-tool-calls');
    }
  }
  if (profile.unsupported.metadata === true) {
    const lowered = lowerOmitMetadata(current);
    if (lowered) {
      current = lowered;
      strategies.push('omit-metadata');
    }
  }
  return { request: current, strategies: uniqueStrategies(strategies) };
}

function lowerToNonStreaming(request: ChatCompletionRequest): ChatCompletionRequest | undefined {
  if (request.stream !== true) return undefined;
  return { ...request, stream: false };
}

function lowerObjectToolChoice(request: ChatCompletionRequest): ChatCompletionRequest | undefined {
  if (!isPlainObject(request.tool_choice)) return undefined;
  const toolName = toolChoiceFunctionName(request.tool_choice);
  const lowered: ChatCompletionRequest = {
    ...request,
    tool_choice: 'required',
  };
  const filteredTools = toolName ? filterChatToolsByName(request.tools, toolName) : undefined;
  if (filteredTools) lowered.tools = filteredTools;
  return lowered;
}

function lowerToolChoiceToAuto(request: ChatCompletionRequest): ChatCompletionRequest | undefined {
  if (request.tool_choice === undefined || request.tool_choice === 'auto' || request.tool_choice === 'none') return undefined;
  const lowered: ChatCompletionRequest = {
    ...request,
    tool_choice: 'auto',
  };
  if (isPlainObject(request.tool_choice)) {
    const toolName = toolChoiceFunctionName(request.tool_choice);
    const filteredTools = toolName ? filterChatToolsByName(request.tools, toolName) : undefined;
    if (filteredTools) lowered.tools = filteredTools;
  }
  return lowered;
}

function lowerOmitParallelToolCalls(request: ChatCompletionRequest): ChatCompletionRequest | undefined {
  if (request.parallel_tool_calls === undefined) return undefined;
  const { parallel_tool_calls: _parallelToolCalls, ...lowered } = request;
  return lowered;
}

function lowerOmitMetadata(request: ChatCompletionRequest): ChatCompletionRequest | undefined {
  if (request.metadata === undefined) return undefined;
  const { metadata: _metadata, ...lowered } = request;
  return lowered;
}

function strategiesForRequest(attempts: ChatCompletionAttempt[], request: ChatCompletionRequest): ProviderCompatibilityStrategy[] {
  const signature = JSON.stringify(request);
  return attempts.find((attempt) => JSON.stringify(attempt.request) === signature)?.strategies ?? [];
}

function uniqueStrategies(strategies: ProviderCompatibilityStrategy[]): ProviderCompatibilityStrategy[] {
  return [...new Set(strategies)];
}

function chatRequestHasTools(request: ChatCompletionRequest): boolean {
  return Array.isArray(request.tools) && request.tools.length > 0;
}

function toolChoiceFunctionName(value: JsonObject): string | undefined {
  if (typeof value.name === 'string' && value.name) return value.name;
  if (isPlainObject(value.function) && typeof value.function.name === 'string' && value.function.name) {
    return value.function.name;
  }
  return undefined;
}

function filterChatToolsByName(tools: unknown, name: string): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const filtered = tools.filter((tool) => chatToolName(tool) === name);
  return filtered.length > 0 ? filtered : undefined;
}

function chatToolName(tool: unknown): string | undefined {
  if (!isPlainObject(tool)) return undefined;
  if (typeof tool.name === 'string' && tool.name) return tool.name;
  if (isPlainObject(tool.function) && typeof tool.function.name === 'string' && tool.function.name) {
    return tool.function.name;
  }
  return undefined;
}

function learnProviderCapabilities(
  profile: ProviderCapabilityProfile,
  originalRequest: ChatCompletionRequest,
  attempt: ChatCompletionAttempt,
) {
  const unsupported = profile.unsupported;
  const learned = attempt.strategies[attempt.strategies.length - 1];
  if (learned === 'non-streaming-chat-completions' && originalRequest.stream === true) {
    if (chatRequestHasTools(originalRequest)) unsupported.streaming_tools = true;
    else unsupported.streaming = true;
  }
  if (learned === 'simplified-tool-choice-object') unsupported.tool_choice_object = true;
  if (learned === 'relaxed-tool-choice-auto') unsupported.tool_choice_required = true;
  if (learned === 'omit-parallel-tool-calls') unsupported.parallel_tool_calls = true;
  if (learned === 'omit-metadata') unsupported.metadata = true;
  profile.updatedAt = new Date().toISOString();
}

function compatibilityRetryMetadata(
  attempts: ChatCompletionAttempt[],
  firstFailure: ChatCompletionFailure | undefined,
  finalFailure: ChatCompletionFailure,
  originalFeatures: JsonObject,
  profile: ProviderCapabilityProfile,
): JsonObject {
  const metadata: JsonObject = {
    attempted: attempts.length > 1,
    attemptCount: finalFailure.attemptIndex + 1,
    generatedAttemptCount: attempts.length,
    finalStatus: finalFailure.status,
    strategies: uniqueStrategies(attempts
      .slice(0, finalFailure.attemptIndex + 1)
      .flatMap((attempt) => attempt.strategies.length ? attempt.strategies : ['native-chat-completions'])),
    originalFeatures,
    providerCapabilities: providerCapabilityPublicSummary(profile),
  };
  if (firstFailure) metadata.initialStatus = firstFailure.status;
  return metadata;
}

function providerCapabilityPublicSummary(profile: ProviderCapabilityProfile): JsonObject {
  return {
    schemaVersion: profile.schemaVersion,
    keySha256: `sha256:${createHash('sha256').update(profile.key).digest('hex')}`,
    unsupported: Object.keys(profile.unsupported).sort(),
    updatedAt: profile.updatedAt,
  };
}

function providerCapabilityProfileKey(
  upstreamBaseUrl: string,
  model: string,
  options: CodexResponsesProxyServerOptions,
  request: IncomingMessage,
): string {
  const authorization = options.upstreamApiKey
    ? `server:${options.upstreamApiKey}`
    : typeof request.headers.authorization === 'string'
      ? `incoming:${request.headers.authorization}`
      : 'no-auth';
  const authHash = createHash('sha256').update(authorization).digest('hex').slice(0, 16);
  return [
    trimTrailingSlash(upstreamBaseUrl),
    model,
    authHash,
  ].join('|');
}

function createProviderCapabilityProfile(key: string): ProviderCapabilityProfile {
  return {
    schemaVersion: 'sciforge.proxy.provider-capabilities.v1',
    key,
    unsupported: {},
    updatedAt: new Date().toISOString(),
  };
}

function chatRequestFeatures(request: ChatCompletionRequest): JsonObject {
  return {
    stream: request.stream === true,
    messageCount: request.messages.length,
    toolCount: Array.isArray(request.tools) ? request.tools.length : 0,
    toolChoiceConfigured: request.tool_choice !== undefined,
    toolChoiceKind: toolChoiceKind(request.tool_choice),
    parallelToolCallsConfigured: request.parallel_tool_calls !== undefined,
    metadataConfigured: request.metadata !== undefined,
    maxTokensConfigured: request.max_tokens !== undefined,
  };
}

function toolChoiceKind(value: unknown) {
  if (value === undefined) return 'none';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.function && typeof record.function === 'object') return 'chat-function-object';
    if (typeof record.name === 'string') return 'responses-function-object';
    if (typeof record.type === 'string') return `object:${record.type}`;
    return 'object';
  }
  return typeof value;
}

function streamChatCompletionObjectAsResponses(
  response: ServerResponse,
  completion: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: ChatToolNameAliasMap = {},
) {
  const converted = chatCompletionToResponse(completion, request, toolNameAliases);
  const state: StreamingState = {
    responseId: typeof converted.id === 'string' ? converted.id : makeId('resp'),
    model: typeof converted.model === 'string' ? converted.model : 'unknown',
    messageItemId: makeId('msg'),
    outputText: '',
    messageStarted: false,
    toolCalls: new Map(),
    nextOutputIndex: 0,
    toolNameAliases,
  };
  const output = Array.isArray(converted.output) ? converted.output.filter(isJsonObject) : [];
  const outputText = typeof converted.output_text === 'string' ? converted.output_text : '';

  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  });
  writeResponseEvent(response, 'response.created', {
    response: responseSummary(state, 'in_progress', []),
  });

  for (const [index, item] of output.entries()) {
    if (item.type === 'message') {
      const itemId = typeof item.id === 'string' ? item.id : state.messageItemId;
      writeResponseEvent(response, 'response.output_item.added', {
        output_index: index,
        item: {
          ...item,
          id: itemId,
          status: 'in_progress',
          content: [],
        },
      });
      writeResponseEvent(response, 'response.content_part.added', {
        item_id: itemId,
        output_index: index,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      });
      if (outputText) {
        writeResponseEvent(response, 'response.output_text.delta', {
          item_id: itemId,
          output_index: index,
          content_index: 0,
          delta: outputText,
        });
      }
      writeResponseEvent(response, 'response.output_text.done', {
        item_id: itemId,
        output_index: index,
        content_index: 0,
        text: outputText,
      });
      writeResponseEvent(response, 'response.content_part.done', {
        item_id: itemId,
        output_index: index,
        content_index: 0,
        part: { type: 'output_text', text: outputText, annotations: [] },
      });
      writeResponseEvent(response, 'response.output_item.done', {
        output_index: index,
        item,
      });
      continue;
    }

    if (item.type === 'function_call') {
      const itemId = typeof item.id === 'string' ? item.id : makeId('fc');
      const argumentsText = typeof item.arguments === 'string' ? item.arguments : '';
      writeResponseEvent(response, 'response.output_item.added', {
        output_index: index,
        item: {
          ...item,
          id: itemId,
          status: 'in_progress',
          arguments: '',
        },
      });
      if (argumentsText) {
        writeResponseEvent(response, 'response.function_call_arguments.delta', {
          item_id: itemId,
          output_index: index,
          delta: argumentsText,
        });
      }
      writeResponseEvent(response, 'response.function_call_arguments.done', {
        item_id: itemId,
        output_index: index,
        arguments: argumentsText,
      });
      writeResponseEvent(response, 'response.output_item.done', {
        output_index: index,
        item,
      });
    }
  }

  state.outputText = outputText;
  writeResponseEvent(response, 'response.completed', {
    response: responseSummary(state, 'completed', output),
  });
  response.write('data: [DONE]\n\n');
  response.end();
}

async function streamChatCompletionAsResponses(
  response: ServerResponse,
  upstream: Response,
  model: string,
  toolNameAliases: ChatToolNameAliasMap = {},
) {
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  });

  const state: StreamingState = {
    responseId: makeId('resp'),
    model,
    messageItemId: makeId('msg'),
    outputText: '',
    messageStarted: false,
    toolCalls: new Map(),
    nextOutputIndex: 0,
    toolNameAliases,
  };

  writeResponseEvent(response, 'response.created', {
    response: responseSummary(state, 'in_progress', []),
  });

  for await (const payload of readSsePayloads(upstream)) {
    if (payload === '[DONE]') break;
    const chunk = parseJsonObject(payload);
    if (!chunk) continue;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    for (const choice of choices) {
      const record = choice && typeof choice === 'object' ? choice as Record<string, unknown> : {};
      const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      if (content) {
        ensureMessageStarted(response, state);
        state.outputText += content;
        writeResponseEvent(response, 'response.output_text.delta', {
          item_id: state.messageItemId,
          output_index: 0,
          content_index: 0,
          delta: content,
        });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const partial of delta.tool_calls) {
          applyToolCallDelta(response, state, partial);
        }
      }
    }
  }

  const output = finishStreamingItems(response, state);
  writeResponseEvent(response, 'response.completed', {
    response: responseSummary(state, 'completed', output),
  });
  response.write('data: [DONE]\n\n');
  response.end();
}

function ensureMessageStarted(response: ServerResponse, state: StreamingState) {
  if (state.messageStarted) return;
  state.messageStarted = true;
  writeResponseEvent(response, 'response.output_item.added', {
    output_index: 0,
    item: {
      id: state.messageItemId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    },
  });
  writeResponseEvent(response, 'response.content_part.added', {
    item_id: state.messageItemId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  state.nextOutputIndex = Math.max(state.nextOutputIndex, 1);
}

function applyToolCallDelta(response: ServerResponse, state: StreamingState, value: unknown) {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const index = typeof record.index === 'number' ? record.index : state.toolCalls.size;
  const fn = record.function && typeof record.function === 'object' ? record.function as Record<string, unknown> : {};
  let entry = state.toolCalls.get(index);
  if (!entry) {
    const itemId = makeId('fc');
    entry = {
      itemId,
      outputIndex: state.nextOutputIndex++,
      outputItemAdded: false,
      flushedArgumentsLength: 0,
      call: {
        id: typeof record.id === 'string' && record.id ? record.id : makeId('call'),
        type: 'function',
        function: {
          name: typeof fn.name === 'string' && fn.name ? state.toolNameAliases[fn.name] ?? fn.name : '',
          arguments: '',
        },
      },
    };
    state.toolCalls.set(index, entry);
  }
  if (typeof record.id === 'string' && record.id) entry.call.id = record.id;
  if (typeof fn.name === 'string' && fn.name) entry.call.function.name = state.toolNameAliases[fn.name] ?? fn.name;
  ensureToolCallStarted(response, entry);
  if (typeof fn.arguments === 'string' && fn.arguments) {
    entry.call.function.arguments += fn.arguments;
    flushToolCallArguments(response, entry);
  }
}

function finishStreamingItems(response: ServerResponse, state: StreamingState): JsonObject[] {
  const output: JsonObject[] = [];
  if (state.messageStarted) {
    const message = messageOutputItem(state.outputText, state.messageItemId);
    output.push(message);
    writeResponseEvent(response, 'response.output_text.done', {
      item_id: state.messageItemId,
      output_index: 0,
      content_index: 0,
      text: state.outputText,
    });
    writeResponseEvent(response, 'response.content_part.done', {
      item_id: state.messageItemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: state.outputText, annotations: [] },
    });
    writeResponseEvent(response, 'response.output_item.done', {
      output_index: 0,
      item: message,
    });
  }

  for (const entry of [...state.toolCalls.values()].sort((left, right) => left.outputIndex - right.outputIndex)) {
    if (!entry.call.function.name) entry.call.function.name = 'unknown_tool';
    ensureToolCallStarted(response, entry);
    flushToolCallArguments(response, entry);
    const item = functionCallOutputItem(entry.call, entry.itemId);
    output.push(item);
    writeResponseEvent(response, 'response.function_call_arguments.done', {
      item_id: entry.itemId,
      output_index: entry.outputIndex,
      arguments: entry.call.function.arguments,
    });
    writeResponseEvent(response, 'response.output_item.done', {
      output_index: entry.outputIndex,
      item,
    });
  }
  return output;
}

function ensureToolCallStarted(response: ServerResponse, entry: MutableToolCall) {
  if (entry.outputItemAdded || !entry.call.function.name) return;
  entry.outputItemAdded = true;
  writeResponseEvent(response, 'response.output_item.added', {
    output_index: entry.outputIndex,
    item: {
      id: entry.itemId,
      type: 'function_call',
      status: 'in_progress',
      call_id: entry.call.id,
      name: entry.call.function.name,
      arguments: '',
    },
  });
}

function flushToolCallArguments(response: ServerResponse, entry: MutableToolCall) {
  if (!entry.outputItemAdded) return;
  const nextDelta = entry.call.function.arguments.slice(entry.flushedArgumentsLength);
  if (!nextDelta) return;
  entry.flushedArgumentsLength = entry.call.function.arguments.length;
  writeResponseEvent(response, 'response.function_call_arguments.delta', {
    item_id: entry.itemId,
    output_index: entry.outputIndex,
    delta: nextDelta,
  });
}

async function proxyRaw(
  request: IncomingMessage,
  response: ServerResponse,
  fetchImpl: typeof fetch,
  options: CodexResponsesProxyServerOptions,
  upstreamUrl: string,
  bridge: UpstreamErrorBridge,
) {
  const body = request.method === 'GET' ? undefined : await readRaw(request);
  const upstream = await fetchImpl(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders(request, options, request.headers['content-type']),
    body: body ? body.toString('utf8') : undefined,
  });
  if (!upstream.ok) {
    const payload = await upstream.text();
    return sendJson(response, upstream.status, normalizeUpstreamError(
      payload,
      upstream.status,
      upstream.headers.get('content-type') ?? undefined,
      bridge,
    ));
  }
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(request);
  return raw.length ? JSON.parse(raw.toString('utf8')) : {};
}

async function readRaw(request: IncomingMessage): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function* readSsePayloads(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
  if (buffer.trim()) {
    const data = buffer.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) yield data;
  }
}

function responseSummary(state: StreamingState, status: 'in_progress' | 'completed', output: JsonObject[]): JsonObject {
  const summary: JsonObject = {
    id: state.responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: state.model,
    status,
    output,
  };
  if (status === 'completed') summary.output_text = state.outputText;
  return summary;
}

function writeResponseEvent(response: ServerResponse, type: string, payload: JsonObject) {
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function sendCors(response: ServerResponse) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  });
  response.end();
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function upstreamHeaders(
  request: IncomingMessage,
  options: CodexResponsesProxyServerOptions,
  contentType: string | string[] | undefined,
): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
  };
  const authorization = options.upstreamApiKey
    ? `Bearer ${options.upstreamApiKey}`
    : request.headers.authorization;
  if (authorization) headers.authorization = Array.isArray(authorization) ? authorization[0] : authorization;
  if (contentType) headers['content-type'] = Array.isArray(contentType) ? contentType[0] : contentType;
  return headers;
}

function hasAuthorizationHeader(headers: HeadersInit): boolean {
  if (headers instanceof Headers) return Boolean(headers.get('authorization'));
  if (Array.isArray(headers)) {
    return headers.some(([name, value]) => name.toLowerCase() === 'authorization' && value.trim());
  }
  return typeof headers.authorization === 'string' && Boolean(headers.authorization.trim());
}

function upstreamPreflightCategoryForStatus(status: number): UpstreamPreflightCategory {
  if (status === 401 || status === 403) return 'provider-auth';
  if (status === 429) return 'rate-limited';
  if (status === 502 || status === 503 || status === 504) return 'upstream-outage';
  return 'repo-bug';
}

function upstreamPreflightMessageForStatus(status: number): string {
  const phrase = httpStatusPhrase(status);
  const label = phrase ? `HTTP ${status} ${phrase}` : `HTTP ${status}`;
  if (status === 401 || status === 403) return `Provider upstream rejected credentials with ${label}.`;
  if (status === 429) return `Provider upstream is rate limited with ${label}.`;
  if (status === 502 || status === 503 || status === 504) return `Provider upstream is unavailable with ${label}.`;
  return `Provider upstream returned unexpected ${label}; inspect proxy wiring and request compatibility.`;
}

function normalizeUpstreamError(
  payload: string,
  status: number,
  contentType?: string,
  bridge?: UpstreamErrorBridge,
): JsonObject {
  const audit = buildUpstreamErrorAudit(payload, contentType);
  const bridgeMetadata = bridge ? {
    schemaVersion: 'sciforge.proxy.upstream-bridge.v1',
    ...bridge,
  } : undefined;
  const error: JsonObject = {
    code: upstreamErrorCode(status),
    message: upstreamErrorPublicMessage(status),
    type: 'upstream_provider_error',
    status,
    retryable: isRetryableUpstreamStatus(status),
    audit,
  };
  if (bridgeMetadata) error.bridge = bridgeMetadata;
  return {
    error,
  };
}

function buildUpstreamErrorAudit(payload: string, contentType?: string): JsonObject {
  const bodyBytes = Buffer.byteLength(payload, 'utf8');
  const bodyKind = classifyUpstreamErrorBody(payload, contentType);
  const audit: JsonObject = {
    schemaVersion: 'sciforge.proxy.upstream-error-audit.v1',
    rawProviderBody: 'suppressed',
    bodySha256: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
    bodyBytes,
    bodyKind,
    suppressed: ['raw-provider-body', 'provider-endpoint', 'credentials'],
  };
  const mediaType = safeMediaType(contentType);
  if (mediaType) audit.contentType = mediaType;
  return audit;
}

function upstreamErrorCode(status: number): string {
  if (status === 401) return 'upstream_unauthorized';
  if (status === 403) return 'upstream_forbidden';
  if (status === 408) return 'upstream_timeout';
  if (status === 429) return 'upstream_rate_limited';
  if (status >= 500 && status <= 599) return 'upstream_unavailable';
  return 'upstream_error';
}

function upstreamErrorPublicMessage(status: number): string {
  const phrase = httpStatusPhrase(status);
  const label = phrase ? `HTTP ${status} ${phrase}` : `HTTP ${status}`;
  return `Upstream provider returned ${label}. Raw provider error content was suppressed; see audit metadata for digest and size.`;
}

function httpStatusPhrase(status: number): string | undefined {
  switch (status) {
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 408: return 'Request Timeout';
    case 409: return 'Conflict';
    case 413: return 'Payload Too Large';
    case 429: return 'Too Many Requests';
    case 500: return 'Internal Server Error';
    case 502: return 'Bad Gateway';
    case 503: return 'Service Unavailable';
    case 504: return 'Gateway Timeout';
    default: return undefined;
  }
}

function isRetryableUpstreamStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function classifyUpstreamErrorBody(payload: string, contentType?: string): string {
  const mediaType = safeMediaType(contentType);
  const text = payload.slice(0, 4096);
  if (!payload) return 'empty';
  if (looksLikeHtmlChallenge(text)) return 'html-challenge';
  if (mediaType === 'text/html' || /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(text)) return 'html';
  if (mediaType === 'text/event-stream' || /^data:/im.test(text)) return 'sse';
  if (parseJsonObject(payload)) return 'json';
  return 'text';
}

function looksLikeHtmlChallenge(value: string): boolean {
  return /cloudflare|cf[-_]?chl|challenge-platform|turnstile|just a moment|captcha|<script[\s>]/i.test(value);
}

function safeMediaType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)
    ? mediaType
    : undefined;
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is JsonObject {
  return isJsonObject(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
