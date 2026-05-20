import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chatCompletionToResponse,
  functionCallOutputItem,
  makeId,
  messageOutputItem,
  responsesToChatCompletions,
  type ChatToolCall,
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

type StreamingState = {
  responseId: string;
  model: string;
  messageItemId: string;
  outputText: string;
  messageStarted: boolean;
  toolCalls: Map<number, MutableToolCall>;
  nextOutputIndex: number;
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
  const upstreamBaseUrl = trimTrailingSlash(options.upstreamBaseUrl);
  const upstreamPreflightTimeoutMs = 2_500;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        if (url.searchParams.get('check') === 'upstream') {
          const upstream = await preflightUpstream(request, fetchImpl, options, upstreamBaseUrl, upstreamPreflightTimeoutMs);
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
        return proxyRaw(request, response, fetchImpl, options, `${upstreamBaseUrl}/models`);
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        return proxyRaw(request, response, fetchImpl, options, `${upstreamBaseUrl}/chat/completions`);
      }
      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        return handleResponsesRequest(request, response, fetchImpl, options, `${upstreamBaseUrl}/chat/completions`);
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
  upstreamUrl: string,
) {
  const body = await readJson(request);
  const responsesRequest = body && typeof body === 'object' && !Array.isArray(body) ? body as ResponsesRequest : {};
  const chatRequest = responsesToChatCompletions(responsesRequest, options);
  const upstreamChatRequest = options.forceNonStreamingUpstream && chatRequest.stream === true
    ? { ...chatRequest, stream: false }
    : chatRequest;
  const upstream = await fetchImpl(upstreamUrl, {
    method: 'POST',
    headers: upstreamHeaders(request, options, 'application/json'),
    body: JSON.stringify(upstreamChatRequest),
  });

  if (!upstream.ok) {
    const payload = await upstream.text();
    return sendJson(response, upstream.status, normalizeUpstreamError(
      payload,
      upstream.status,
      upstream.headers.get('content-type') ?? undefined,
    ));
  }

  if (chatRequest.stream === true && upstreamChatRequest.stream !== true) {
    const completion = await upstream.json();
    return streamChatCompletionObjectAsResponses(response, completion, responsesRequest);
  }

  if (chatRequest.stream === true) {
    return streamChatCompletionAsResponses(response, upstream, chatRequest.model);
  }

  const completion = await upstream.json();
  return sendJson(response, 200, chatCompletionToResponse(completion, responsesRequest));
}

function streamChatCompletionObjectAsResponses(
  response: ServerResponse,
  completion: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
) {
  const converted = chatCompletionToResponse(completion, request);
  const state: StreamingState = {
    responseId: typeof converted.id === 'string' ? converted.id : makeId('resp'),
    model: typeof converted.model === 'string' ? converted.model : 'unknown',
    messageItemId: makeId('msg'),
    outputText: '',
    messageStarted: false,
    toolCalls: new Map(),
    nextOutputIndex: 0,
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
          name: typeof fn.name === 'string' && fn.name ? fn.name : '',
          arguments: '',
        },
      },
    };
    state.toolCalls.set(index, entry);
  }
  if (typeof record.id === 'string' && record.id) entry.call.id = record.id;
  if (typeof fn.name === 'string' && fn.name) entry.call.function.name = fn.name;
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

function normalizeUpstreamError(payload: string, status: number, contentType?: string): JsonObject {
  const audit = buildUpstreamErrorAudit(payload, contentType);
  return {
    error: {
      code: upstreamErrorCode(status),
      message: upstreamErrorPublicMessage(status),
      type: 'upstream_provider_error',
      status,
      retryable: isRetryableUpstreamStatus(status),
      audit,
    },
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
