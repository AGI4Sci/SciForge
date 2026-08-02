import { createHash } from 'node:crypto';

import {
  normalizeProviderChatCompletionsBody,
  normalizeProviderResponsesRequest,
  resolveProviderCompatibility,
  type ProviderCompatibilityConfig,
  type ProviderCompatibilityProfile,
} from './provider-compat';
import {
  anthropicMessageToResponse,
  chatCompletionToResponse,
  chatToolNameAliasesFromResponsesTools,
  responsesReasoningToAnthropicThinking,
  responsesToAnthropicMessages,
  responsesToChatCompletions,
  type JsonObject,
  type ResponsesRequest,
} from './response-compat';
import { hygienizeModelRequestBody } from './request-hygiene';

export type UpstreamWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';

export type UpstreamAttempt = {
  protocol: UpstreamWireProtocol;
  phase: 'probe' | 'request';
  url: string;
  latencyMs: number;
  status: 'ok' | 'rejected' | 'failed' | 'incompatible';
  httpStatus?: number;
  errorCode?: string;
};

export type CanonicalUpstreamResult = {
  protocol: UpstreamWireProtocol;
  response: JsonObject;
};

export type UpstreamTraceAttemptStart = {
  protocol: string;
  phase: 'probe' | 'request';
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: unknown;
  retry?: number;
};

export type UpstreamTraceAttemptObserver = {
  responseHeaders?(status: number, headers: Record<string, string>): void;
  responseChunk?(index: number, chunk: Uint8Array): void;
  error?(error: unknown): void;
  end?(result: { status?: number; durationMs: number }): void;
};

type DriverRequest = {
  request: ResponsesRequest;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  compatibility?: ProviderCompatibilityConfig;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  toolNameAliases?: Record<string, string>;
  traceAttempt?: (attempt: UpstreamTraceAttemptStart) => UpstreamTraceAttemptObserver | undefined;
};

type PreparedRequest = {
  url: string;
  headers: Record<string, string>;
  body: JsonObject;
  parse(response: Response): Promise<JsonObject>;
};

type UpstreamDriver = {
  protocol: UpstreamWireProtocol;
  prepare(options: DriverRequest): PreparedRequest;
};

const STABLE_PROTOCOL_ORDER: readonly UpstreamWireProtocol[] = [
  'responses',
  'chat-completions',
  'anthropic-messages',
];
const DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS = 300_000;

export class UpstreamRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly upstreamStatus?: number;
  readonly responseBody?: string;
  readonly definitiveRejection: boolean;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    upstreamStatus?: number;
    responseBody?: string;
    definitiveRejection?: boolean;
  }) {
    super(options.message);
    this.name = 'UpstreamRequestError';
    this.code = options.code;
    this.status = options.status;
    this.upstreamStatus = options.upstreamStatus;
    this.responseBody = options.responseBody;
    this.definitiveRejection = options.definitiveRejection === true;
  }
}

class UpstreamCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamCapabilityError';
  }
}

export class UpstreamProtocolNegotiator {
  readonly #cache = new Map<string, UpstreamWireProtocol>();
  readonly #probes = new Map<string, Promise<UpstreamWireProtocol>>();

  cachedProtocol(
    baseUrl: string,
    model: string,
    compatibility?: ProviderCompatibilityConfig,
  ): UpstreamWireProtocol | undefined {
    return this.#cache.get(routeCacheKey(baseUrl, model, compatibility));
  }

  clear(): void {
    this.#cache.clear();
    this.#probes.clear();
  }

  async request(options: DriverRequest & {
    preferredProtocol: UpstreamWireProtocol;
    onAttempt?: (attempt: UpstreamAttempt) => void;
  }): Promise<CanonicalUpstreamResult> {
    const cacheKey = routeCacheKey(options.baseUrl, options.model, options.compatibility);
    let cached = this.#cache.get(cacheKey);
    const compatibility = resolveProviderCompatibility(
      options.compatibility,
      options.preferredProtocol,
    );
    const candidates = candidateProtocols(
      compatibility.preferredProtocol,
      cached,
      compatibility.allowedProtocols as readonly UpstreamWireProtocol[],
    );
    if (!cached && compatibility.probeBeforeUse && candidates.length > 1) {
      cached = await this.#probe({
        ...options,
        cacheKey,
        candidates,
      });
    }
    const requestCandidates = candidateProtocols(
      compatibility.preferredProtocol,
      cached,
      compatibility.allowedProtocols as readonly UpstreamWireProtocol[],
    );
    let lastDefinitiveError: UpstreamRequestError | undefined;
    let lastCapabilityError: UpstreamCapabilityError | undefined;

    for (const [retry, protocol] of requestCandidates.entries()) {
      const driver = DRIVERS[protocol];
      let prepared: PreparedRequest;
      try {
        prepared = driver.prepare({
          ...options,
          request: hygienizeModelRequestBody(options.request as Record<string, unknown>) as ResponsesRequest,
        });
      } catch (error) {
        if (!(error instanceof UpstreamCapabilityError)) throw error;
        lastCapabilityError = error;
        options.onAttempt?.({
          protocol,
          phase: 'request',
          url: buildUpstreamEndpointUrl(options.baseUrl, protocolPath(protocol)),
          latencyMs: 0,
          status: 'incompatible',
          errorCode: 'upstream_protocol_capability_unsupported',
        });
        if (cached === protocol) this.#cache.delete(cacheKey);
        continue;
      }

      const startedAt = Date.now();
      const traceObserver = options.traceAttempt?.({
        protocol,
        phase: 'request',
        method: 'POST',
        url: prepared.url,
        headers: prepared.headers,
        body: prepared.body,
        retry,
      });
      const timeoutSignal = AbortSignal.timeout(upstreamRequestTimeoutMs(options.timeoutMs));
      const requestSignal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      let response: Response;
      try {
        response = await options.fetchImpl(prepared.url, {
          method: 'POST',
          headers: prepared.headers,
          body: JSON.stringify(prepared.body),
          signal: requestSignal,
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const requestError = requestException(error, { timedOut: timeoutSignal.aborted });
        traceObserver?.error?.(requestError);
        traceObserver?.end?.({ durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'request',
          url: prepared.url,
          latencyMs,
          status: 'failed',
          errorCode: requestError.code,
        });
        throw requestError;
      }

      traceObserver?.responseHeaders?.(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      try {
        response = await captureUpstreamResponse(response, (index, chunk) => {
          traceObserver?.responseChunk?.(index, chunk);
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const requestError = requestException(error, { timedOut: timeoutSignal.aborted });
        traceObserver?.error?.(requestError);
        traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'request',
          url: prepared.url,
          latencyMs,
          status: 'failed',
          httpStatus: response.status,
          errorCode: requestError.code,
        });
        throw requestError;
      }

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        const definitiveRejection = isDefinitiveProtocolRejection(response.status, responseBody);
        const error = new UpstreamRequestError({
          code: `upstream_http_${response.status}`,
          message: `Upstream returned HTTP ${response.status}.`,
          status: response.status,
          upstreamStatus: response.status,
          responseBody,
          definitiveRejection,
        });
        traceObserver?.error?.(error);
        traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'request',
          url: prepared.url,
          latencyMs,
          status: definitiveRejection ? 'rejected' : 'failed',
          httpStatus: response.status,
          errorCode: error.code,
        });
        if (!definitiveRejection) throw error;
        lastDefinitiveError = error;
        if (cached === protocol) this.#cache.delete(cacheKey);
        continue;
      }

      let canonicalResponse: JsonObject;
      try {
        canonicalResponse = await prepared.parse(response);
      } catch (error) {
        const responseError = error instanceof UpstreamRequestError
          ? error
          : new UpstreamRequestError({
              code: 'upstream_invalid_response',
              message: 'Upstream returned an invalid response for the selected protocol.',
              status: 502,
            });
        traceObserver?.error?.(responseError);
        traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'request',
          url: prepared.url,
          latencyMs,
          status: responseError.definitiveRejection ? 'rejected' : 'failed',
          httpStatus: response.status,
          errorCode: responseError.code,
        });
        if (responseError.definitiveRejection) {
          lastDefinitiveError = responseError;
          if (cached === protocol) this.#cache.delete(cacheKey);
          continue;
        }
        throw responseError;
      }

      options.onAttempt?.({
        protocol,
        phase: 'request',
        url: prepared.url,
        latencyMs,
        status: 'ok',
        httpStatus: response.status,
      });
      traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
      this.#cache.set(cacheKey, protocol);
      return { protocol, response: canonicalResponse };
    }

    if (lastDefinitiveError) {
      throw new UpstreamRequestError({
        code: 'upstream_protocol_unsupported',
        message: 'The configured upstream definitively rejected every supported model protocol.',
        status: 502,
        upstreamStatus: lastDefinitiveError.upstreamStatus,
        responseBody: lastDefinitiveError.responseBody,
        definitiveRejection: true,
      });
    }
    throw new UpstreamRequestError({
      code: 'upstream_protocol_capability_unsupported',
      message: lastCapabilityError?.message ?? 'No supported upstream protocol can represent the request.',
      status: 422,
    });
  }

  async #probe(options: DriverRequest & {
    cacheKey: string;
    candidates: readonly UpstreamWireProtocol[];
    onAttempt?: (attempt: UpstreamAttempt) => void;
  }): Promise<UpstreamWireProtocol> {
    const existing = this.#probes.get(options.cacheKey);
    if (existing) return existing;
    const probe = this.#runProbe(options);
    this.#probes.set(options.cacheKey, probe);
    try {
      return await probe;
    } finally {
      if (this.#probes.get(options.cacheKey) === probe) this.#probes.delete(options.cacheKey);
    }
  }

  async #runProbe(options: DriverRequest & {
    cacheKey: string;
    candidates: readonly UpstreamWireProtocol[];
    onAttempt?: (attempt: UpstreamAttempt) => void;
  }): Promise<UpstreamWireProtocol> {
    let lastRejection: UpstreamRequestError | undefined;
    for (const [retry, protocol] of options.candidates.entries()) {
      const prepared = prepareProtocolProbe(options, protocol);
      const startedAt = Date.now();
      const traceObserver = options.traceAttempt?.({
        protocol,
        phase: 'probe',
        method: 'POST',
        url: prepared.url,
        headers: prepared.headers,
        body: prepared.body,
        retry,
      });
      const timeoutSignal = AbortSignal.timeout(upstreamRequestTimeoutMs(options.timeoutMs));
      const requestSignal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      let response: Response;
      try {
        response = await options.fetchImpl(prepared.url, {
          method: 'POST',
          headers: prepared.headers,
          body: JSON.stringify(prepared.body),
          signal: requestSignal,
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const requestError = requestException(error, { timedOut: timeoutSignal.aborted });
        traceObserver?.error?.(requestError);
        traceObserver?.end?.({ durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'probe',
          url: prepared.url,
          latencyMs,
          status: 'failed',
          errorCode: requestError.code,
        });
        throw requestError;
      }

      traceObserver?.responseHeaders?.(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      try {
        response = await captureUpstreamResponse(response, (index, chunk) => {
          traceObserver?.responseChunk?.(index, chunk);
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const requestError = requestException(error, { timedOut: timeoutSignal.aborted });
        traceObserver?.error?.(requestError);
        traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'probe',
          url: prepared.url,
          latencyMs,
          status: 'failed',
          httpStatus: response.status,
          errorCode: requestError.code,
        });
        throw requestError;
      }
      const latencyMs = Date.now() - startedAt;
      const responseBody = await response.text().catch(() => '');
      if (probeResponseConfirmsProtocol(response.status, responseBody)) {
        traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
        options.onAttempt?.({
          protocol,
          phase: 'probe',
          url: prepared.url,
          latencyMs,
          status: 'ok',
          httpStatus: response.status,
        });
        this.#cache.set(options.cacheKey, protocol);
        return protocol;
      }

      const definitiveRejection = isDefinitiveProtocolRejection(response.status, responseBody);
      const error = new UpstreamRequestError({
        code: `upstream_http_${response.status}`,
        message: `Upstream returned HTTP ${response.status}.`,
        status: response.status,
        upstreamStatus: response.status,
        responseBody,
        definitiveRejection,
      });
      traceObserver?.error?.(error);
      traceObserver?.end?.({ status: response.status, durationMs: latencyMs });
      options.onAttempt?.({
        protocol,
        phase: 'probe',
        url: prepared.url,
        latencyMs,
        status: definitiveRejection ? 'rejected' : 'failed',
        httpStatus: response.status,
        errorCode: error.code,
      });
      if (!definitiveRejection) throw error;
      lastRejection = error;
    }
    throw new UpstreamRequestError({
      code: 'upstream_protocol_unsupported',
      message: 'Protocol probing found no supported upstream model API.',
      status: 502,
      upstreamStatus: lastRejection?.upstreamStatus,
      responseBody: lastRejection?.responseBody,
      definitiveRejection: true,
    });
  }
}

function prepareProtocolProbe(
  options: Pick<DriverRequest, 'baseUrl' | 'apiKey' | 'model'>,
  protocol: UpstreamWireProtocol,
): Omit<PreparedRequest, 'parse'> {
  const prompt = 'SciForge protocol capability probe. Reply with one period.';
  if (protocol === 'responses') {
    return {
      url: buildUpstreamEndpointUrl(options.baseUrl, 'responses'),
      headers: bearerHeaders(options.apiKey),
      body: {
        model: options.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        max_output_tokens: 1,
        stream: false,
      },
    };
  }
  if (protocol === 'chat-completions') {
    return {
      url: buildUpstreamEndpointUrl(options.baseUrl, 'chat/completions'),
      headers: bearerHeaders(options.apiKey),
      body: {
        model: options.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1,
        stream: false,
      },
    };
  }
  return {
    url: buildUpstreamEndpointUrl(options.baseUrl, 'messages'),
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1,
      stream: false,
    },
  };
}

function probeResponseConfirmsProtocol(status: number, responseBody: string): boolean {
  if (status >= 200 && status <= 299) return true;
  if (status !== 400 && status !== 422) return false;
  const normalized = protocolErrorText(responseBody);
  if (isAuthenticationOrOperationalError(normalized)) return false;
  return !isDefinitiveProtocolRejection(status, responseBody);
}

export async function captureUpstreamResponse(
  response: Response,
  onChunk: (index: number, chunk: Uint8Array) => void,
): Promise<Response> {
  if (!response.body) return response;
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let index = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = Uint8Array.from(result.value);
    chunks.push(chunk);
    onChunk(index, chunk);
    index += 1;
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) : null;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function isDefinitiveProtocolRejection(
  status: number,
  responseBody = '',
): boolean {
  if (status === 404 || status === 405 || status === 415) return true;
  const normalized = protocolErrorText(responseBody);
  if (!normalized || isAuthenticationOrOperationalError(normalized)) return false;
  if (status >= 500 && status <= 599) {
    return /\bconvert[ _-]?request[ _-]?failed\b/iu.test(normalized)
      && /\b(?:not[ _-]?implemented|unsupported)\b/iu.test(normalized);
  }
  if (status !== 400 && status !== 422) return false;
  return (
    /\b(?:unknown|unsupported|unrecognized|invalid)\b.{0,48}\b(?:endpoint|route|path|protocol|media[ _-]?type|request[ _-]?(?:format|schema))\b/iu.test(normalized)
    || /\b(?:endpoint|route|path|protocol|media[ _-]?type|request[ _-]?(?:format|schema))\b.{0,48}\b(?:unknown|unsupported|unrecognized|invalid|not found)\b/iu.test(normalized)
    || /\b(?:unknown|unsupported|unrecognized|invalid)[ _-](?:endpoint|route|protocol|schema)\b/iu.test(normalized)
    || /\b(?:messages|input)\b.{0,32}\b(?:is required|required field|must be provided)\b/iu.test(normalized)
  );
}

export function buildUpstreamEndpointUrl(baseUrl: string, path: string): string {
  const normalized = trimUrlPathEnd(baseUrl);
  if (!normalized) return `/v1/${path}`;
  if (normalized.toLowerCase().endsWith(`/${path}`)) return normalized;
  const withoutEndpoint = stripKnownEndpointPath(normalized);
  const lastSegment = lastUrlPathSegment(withoutEndpoint).toLowerCase();
  if (
    /^v\d+[a-z0-9]*$/u.test(lastSegment)
    || splitUrlSuffix(withoutEndpoint).path.split('/').some((segment) => /^v\d+[a-z0-9]*$/u.test(segment))
  ) {
    return appendUrlPath(withoutEndpoint, path);
  }
  return appendUrlPath(withoutEndpoint, `v1/${path}`);
}

const responsesDriver: UpstreamDriver = {
  protocol: 'responses',
  prepare(options) {
    const profile = resolveProviderCompatibility(options.compatibility, 'responses');
    let request: ResponsesRequest;
    try {
      request = normalizeProviderResponsesRequest(options.request, profile);
    } catch (error) {
      throw providerNormalizationCapabilityError(error);
    }
    assertResponsesCapabilities(request);
    const body = responsesRequestBody(request, options.model);
    return {
      url: buildUpstreamEndpointUrl(options.baseUrl, 'responses'),
      headers: bearerHeaders(options.apiKey),
      body,
      parse: (response) => parseResponsesResponse(response),
    };
  },
};

const chatCompletionsDriver: UpstreamDriver = {
  protocol: 'chat-completions',
  prepare(options) {
    assertChatCapabilities(options.request);
    const profile = resolveProviderCompatibility(options.compatibility, 'chat-completions');
    let body: JsonObject;
    try {
      body = normalizeProviderChatCompletionsBody(
        responsesToChatCompletions({
          ...options.request,
          model: options.model,
        }, { defaultModel: options.model }),
        profile,
      );
    } catch (error) {
      throw providerNormalizationCapabilityError(error);
    }
    if (options.request.stream === true) body.stream = true;
    const aliases = options.toolNameAliases ?? chatToolNameAliasesFromResponsesTools(options.request.tools);
    return {
      url: buildUpstreamEndpointUrl(options.baseUrl, 'chat/completions'),
      headers: bearerHeaders(options.apiKey),
      body,
      parse: async (response) => chatCompletionToResponse(
        await parseChatCompletionsResponse(response),
        { model: options.model },
        aliases,
      ),
    };
  },
};

function providerNormalizationCapabilityError(error: unknown): Error {
  if (error instanceof RangeError) return new UpstreamCapabilityError(error.message);
  return error instanceof Error ? error : new Error(String(error));
}

const anthropicMessagesDriver: UpstreamDriver = {
  protocol: 'anthropic-messages',
  prepare(options) {
    assertAnthropicCapabilities(options.request);
    let body: JsonObject;
    try {
      body = responsesToAnthropicMessages({
        ...options.request,
        model: options.model,
      }, { defaultModel: options.model });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new UpstreamCapabilityError(error.message);
    }
    if (options.request.stream === true) body.stream = true;
    return {
      url: buildUpstreamEndpointUrl(options.baseUrl, 'messages'),
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
      parse: async (response) => anthropicMessageToResponse(
        await parseAnthropicMessagesResponse(response),
        { model: options.model },
      ),
    };
  },
};

const DRIVERS: Record<UpstreamWireProtocol, UpstreamDriver> = {
  responses: responsesDriver,
  'chat-completions': chatCompletionsDriver,
  'anthropic-messages': anthropicMessagesDriver,
};

function candidateProtocols(
  preferred: UpstreamWireProtocol,
  cached: UpstreamWireProtocol | undefined,
  allowed: readonly UpstreamWireProtocol[] = STABLE_PROTOCOL_ORDER,
): UpstreamWireProtocol[] {
  const allowedSet = new Set(allowed);
  const ordered = [preferred, ...STABLE_PROTOCOL_ORDER.filter((value) => value !== preferred)]
    .filter((value) => allowedSet.has(value));
  return cached && allowedSet.has(cached)
    ? [cached, ...ordered.filter((value) => value !== cached)]
    : ordered;
}

function routeCacheKey(
  baseUrl: string,
  model: string,
  compatibility?: ProviderCompatibilityConfig,
): string {
  return createHash('sha256')
    .update(`${trimUrlPathEnd(baseUrl)}\n${model.trim()}\n${JSON.stringify(compatibility ?? {})}`)
    .digest('hex');
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

function responsesRequestBody(request: ResponsesRequest, model: string): JsonObject {
  const body = { ...request, model } as Record<string, unknown>;
  const maxOutputTokens = request.max_output_tokens ?? request.max_tokens;
  delete body.max_tokens;
  if (isDisabledAnthropicThinking(request.thinking)) delete body.thinking;
  if (maxOutputTokens !== undefined) body.max_output_tokens = maxOutputTokens;
  return compactObject(body);
}

function assertResponsesCapabilities(request: ResponsesRequest): void {
  if (request.thinking !== undefined && !isDisabledAnthropicThinking(request.thinking)) {
    throw new UpstreamCapabilityError('OpenAI Responses cannot losslessly represent Anthropic thinking controls.');
  }
  if (request.stop !== undefined) {
    throw new UpstreamCapabilityError('OpenAI Responses cannot represent explicit stop sequences.');
  }
}

function assertChatCapabilities(request: ResponsesRequest): void {
  if (request.thinking !== undefined && !isDisabledAnthropicThinking(request.thinking)) {
    throw new UpstreamCapabilityError('Chat Completions cannot losslessly represent Anthropic thinking controls.');
  }
}

function isDisabledAnthropicThinking(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'disabled') return false;
  return Object.keys(value).every((key) => key === 'type');
}

function assertAnthropicCapabilities(request: ResponsesRequest): void {
  if (request.asr_options !== undefined) {
    throw new UpstreamCapabilityError('Anthropic Messages cannot represent the requested audio-transcription controls.');
  }
  const maxTokensValue = request.max_output_tokens ?? request.max_tokens;
  const maxTokens = typeof maxTokensValue === 'number' && Number.isFinite(maxTokensValue)
    ? maxTokensValue
    : 4096;
  try {
    responsesReasoningToAnthropicThinking(request, maxTokens);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new UpstreamCapabilityError(error.message);
  }
  if (request.tool_choice === 'none') {
    throw new UpstreamCapabilityError('Anthropic Messages cannot represent tool_choice="none" without dropping tools.');
  }
}

async function parseResponsesResponse(
  response: Response,
): Promise<JsonObject> {
  if (isEventStream(response)) {
    const events = parseSse(await response.text());
    let completed: JsonObject | undefined;
    let explicitError: JsonObject | undefined;
    let sawModelOutput = false;
    let sawAmbiguousData = false;
    for (const event of events) {
      const payload = parseJsonObject(event.data);
      if (!payload) {
        if (event.data !== '[DONE]') sawAmbiguousData = true;
        continue;
      }
      const outputEvent = isResponsesModelOutputEvent(payload, event.event);
      const errorEvent = isExplicitStreamErrorPayload(payload, event.event);
      if (outputEvent) sawModelOutput = true;
      if (errorEvent) {
        explicitError = payload as JsonObject;
        if (hasAmbiguousErrorPayloadData(payload)) sawAmbiguousData = true;
      }
      const responseValue = isRecord(payload.response) ? payload.response as JsonObject : undefined;
      const completedEvent = event.event === 'response.completed' || payload.type === 'response.completed';
      if (completedEvent) {
        completed = responseValue;
      }
      if (!outputEvent && !errorEvent && !completedEvent && !isResponsesHousekeepingEvent(payload, event.event)) {
        sawAmbiguousData = true;
      }
    }
    if (completed) {
      assertNoErrorPayload(completed);
      assertResponsesResponseSchema(completed);
      return completed;
    }
    if (explicitError) {
      throw new UpstreamRequestError({
        code: 'upstream_error_payload',
        message: 'Responses stream returned an explicit error before producing model output.',
        status: 502,
        upstreamStatus: response.status,
        definitiveRejection: !sawModelOutput && !sawAmbiguousData,
      });
    }
    throw invalidResponse('Responses stream did not contain a completed response.');
  }
  const payload = await readJsonObject(response);
  if (isExplicitStreamErrorPayload(payload, undefined)) {
    throw new UpstreamRequestError({
      code: 'upstream_error_payload',
      message: 'Responses returned an explicit error payload before producing model output.',
      status: 502,
      upstreamStatus: response.status,
      definitiveRejection: !isResponsesModelOutputEvent(payload, undefined)
        && !hasAmbiguousErrorPayloadData(payload),
    });
  }
  assertNoErrorPayload(payload);
  assertResponsesResponseSchema(payload);
  return payload;
}

function isExplicitStreamErrorPayload(payload: Record<string, unknown>, event: string | undefined): boolean {
  if (hasExplicitErrorValue(payload.error) || event === 'error' || payload.type === 'error' || payload.type === 'response.failed') {
    return true;
  }
  return typeof payload.code === 'string'
    && payload.code.trim().length > 0
    && typeof payload.message === 'string'
    && payload.message.trim().length > 0;
}

function isResponsesModelOutputEvent(payload: Record<string, unknown>, event: string | undefined): boolean {
  const eventType = event || (typeof payload.type === 'string' ? payload.type : '');
  if (/^response\.(?:output_|content_part\.|function_call_arguments\.|reasoning_|refusal\.|image_generation_call\.|code_interpreter_call\.|file_search_call\.|web_search_call\.|mcp_)/u.test(eventType)) {
    return true;
  }
  if (Array.isArray(payload.output) && payload.output.length > 0) return true;
  const response = isRecord(payload.response) ? payload.response : undefined;
  if (Array.isArray(response?.output) && response.output.length > 0) return true;
  const usage = isRecord(response?.usage)
    ? response.usage
    : isRecord(payload.usage) ? payload.usage : undefined;
  return numericField(usage, 'output_tokens') > 0
    || numericField(usage, 'completion_tokens') > 0;
}

function hasAmbiguousErrorPayloadData(payload: Record<string, unknown>): boolean {
  return [
    'choices',
    'content',
    'data',
    'delta',
    'output',
    'output_text',
    'text',
  ].some((key) => payload[key] !== undefined);
}

function isResponsesHousekeepingEvent(payload: Record<string, unknown>, event: string | undefined): boolean {
  const eventType = event || (typeof payload.type === 'string' ? payload.type : '');
  return eventType === 'response.created'
    || eventType === 'response.in_progress'
    || eventType === 'response.queued';
}

function numericField(value: Record<string, unknown> | undefined, key: string): number {
  const field = value?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : 0;
}

async function parseChatCompletionsResponse(response: Response): Promise<JsonObject> {
  if (!isEventStream(response)) {
    const payload = await readJsonObject(response);
    assertNoErrorPayload(payload);
    assertChatCompletionsResponseSchema(payload);
    return payload;
  }

  const events = parseSse(await response.text());
  let id = '';
  let model = '';
  let created = Math.floor(Date.now() / 1000);
  let content = '';
  let reasoningContent = '';
  let finishReason: unknown = null;
  let usage: unknown;
  const toolCalls = new Map<number, Record<string, unknown>>();
  for (const event of events) {
    if (event.data === '[DONE]') continue;
    const chunk = parseJsonObject(event.data);
    if (!chunk) continue;
    if (typeof chunk.id === 'string') id = chunk.id;
    if (typeof chunk.model === 'string') model = chunk.model;
    if (typeof chunk.created === 'number') created = chunk.created;
    if (chunk.usage !== undefined) usage = chunk.usage;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : {};
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
    const deltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const value of deltas) {
      if (!isRecord(value)) continue;
      const index = typeof value.index === 'number' ? value.index : toolCalls.size;
      const current = toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      const currentFunction = isRecord(current.function) ? current.function : {};
      const deltaFunction = isRecord(value.function) ? value.function : {};
      toolCalls.set(index, {
        id: `${typeof current.id === 'string' ? current.id : ''}${typeof value.id === 'string' ? value.id : ''}`,
        type: 'function',
        function: {
          name: `${typeof currentFunction.name === 'string' ? currentFunction.name : ''}${typeof deltaFunction.name === 'string' ? deltaFunction.name : ''}`,
          arguments: `${typeof currentFunction.arguments === 'string' ? currentFunction.arguments : ''}${typeof deltaFunction.arguments === 'string' ? deltaFunction.arguments : ''}`,
        },
      });
    }
  }
  const payload = compactObject({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: compactObject({
        role: 'assistant',
        content: content || null,
        reasoning_content: reasoningContent || undefined,
        tool_calls: toolCalls.size > 0 ? [...toolCalls.values()] : undefined,
      }),
      finish_reason: finishReason,
    }],
    usage,
  });
  assertChatCompletionsResponseSchema(payload);
  return payload;
}

async function parseAnthropicMessagesResponse(response: Response): Promise<JsonObject> {
  if (!isEventStream(response)) {
    const payload = await readJsonObject(response);
    assertNoErrorPayload(payload);
    assertAnthropicMessagesResponseSchema(payload);
    return payload;
  }

  const events = parseSse(await response.text());
  let message: Record<string, unknown> = {};
  const content = new Map<number, Record<string, unknown>>();
  let stopReason: unknown = null;
  let stopSequence: unknown = null;
  let usage: Record<string, unknown> = {};
  for (const event of events) {
    const payload = parseJsonObject(event.data);
    if (!payload) continue;
    if (payload.type === 'message_start' && isRecord(payload.message)) {
      message = { ...payload.message };
      if (isRecord(payload.message.usage)) usage = { ...payload.message.usage };
    }
    const index = typeof payload.index === 'number' ? payload.index : 0;
    if (payload.type === 'content_block_start' && isRecord(payload.content_block)) {
      content.set(index, { ...payload.content_block });
    }
    if (payload.type === 'content_block_delta' && isRecord(payload.delta)) {
      const current = content.get(index) ?? { type: 'text', text: '' };
      const delta = payload.delta;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        current.text = `${typeof current.text === 'string' ? current.text : ''}${delta.text}`;
      }
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        current.thinking = `${typeof current.thinking === 'string' ? current.thinking : ''}${delta.thinking}`;
      }
      if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        current.signature = `${typeof current.signature === 'string' ? current.signature : ''}${delta.signature}`;
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        current.__partialJson = `${typeof current.__partialJson === 'string' ? current.__partialJson : ''}${delta.partial_json}`;
      }
      content.set(index, current);
    }
    if (payload.type === 'message_delta' && isRecord(payload.delta)) {
      if (payload.delta.stop_reason !== undefined) stopReason = payload.delta.stop_reason;
      if (payload.delta.stop_sequence !== undefined) stopSequence = payload.delta.stop_sequence;
      if (isRecord(payload.usage)) usage = { ...usage, ...payload.usage };
    }
  }
  const blocks = [...content.entries()].sort(([left], [right]) => left - right).map(([, block]) => {
    if (block.type !== 'tool_use' || typeof block.__partialJson !== 'string') return block;
    const { __partialJson, ...rest } = block;
    return { ...rest, input: parseJsonValue(__partialJson) ?? {} };
  });
  const payload = compactObject({
    ...message,
    type: 'message',
    role: 'assistant',
    content: blocks,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage,
  });
  assertAnthropicMessagesResponseSchema(payload);
  return payload;
}

function upstreamRequestTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(timeoutMs));
}

function requestException(
  error: unknown,
  state: { timedOut?: boolean } = {},
): UpstreamRequestError {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const timeout = state.timedOut === true
    || name.includes('abort')
    || message.includes('timeout')
    || message.includes('timed out');
  return new UpstreamRequestError({
    code: timeout ? 'upstream_timeout' : 'upstream_network_error',
    message: timeout ? 'Upstream request timed out.' : 'Upstream request failed before a response was received.',
    status: timeout ? 504 : 502,
  });
}

function invalidResponse(message: string): UpstreamRequestError {
  return new UpstreamRequestError({ code: 'upstream_invalid_response', message, status: 502 });
}

function assertNoErrorPayload(payload: JsonObject): void {
  if (!hasExplicitErrorValue(payload.error)) return;
  throw new UpstreamRequestError({
    code: 'upstream_error_payload',
    message: 'Upstream returned an error payload instead of a model response.',
    status: 502,
  });
}

function hasExplicitErrorValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function assertResponsesResponseSchema(payload: JsonObject): void {
  if (
    payload.object !== 'response'
    || typeof payload.id !== 'string'
    || !payload.id
    || typeof payload.status !== 'string'
    || !Array.isArray(payload.output)
  ) {
    throw invalidResponse('Responses endpoint returned an incompatible response schema.');
  }
}

function assertChatCompletionsResponseSchema(payload: JsonObject): void {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : undefined;
  if (
    payload.object !== 'chat.completion'
    || !choice
    || !isRecord(choice.message)
    || typeof choice.finish_reason !== 'string'
    || !choice.finish_reason
  ) {
    throw invalidResponse('Chat Completions returned an incompatible response schema.');
  }
}

function assertAnthropicMessagesResponseSchema(payload: JsonObject): void {
  if (
    payload.type !== 'message'
    || typeof payload.id !== 'string'
    || !payload.id
    || payload.role !== 'assistant'
    || !Array.isArray(payload.content)
    || typeof payload.stop_reason !== 'string'
    || !payload.stop_reason
  ) {
    throw invalidResponse('Anthropic Messages returned an incompatible response schema.');
  }
}

async function readJsonObject(response: Response): Promise<JsonObject> {
  try {
    const value = await response.json();
    if (isRecord(value)) return value as JsonObject;
  } catch {
    // Normalize below so callers never retry an ambiguous successful response.
  }
  throw invalidResponse('Upstream returned a non-JSON response.');
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') === true;
}

function parseSse(text: string): Array<{ event?: string; data: string }> {
  const events: Array<{ event?: string; data: string }> = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return events;
}

function protocolPath(protocol: UpstreamWireProtocol): string {
  if (protocol === 'responses') return 'responses';
  if (protocol === 'chat-completions') return 'chat/completions';
  return 'messages';
}

function protocolErrorText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isRecord(value)) return trimmed.slice(0, 2_000);
    const error = isRecord(value.error) ? value.error : value;
    return [error.code, error.type, error.message, error.detail]
      .filter((item): item is string => typeof item === 'string')
      .join(' ')
      .slice(0, 2_000);
  } catch {
    return trimmed.slice(0, 2_000);
  }
}

function isAuthenticationOrOperationalError(value: string): boolean {
  return /\b(?:auth(?:entication|orization)?|api[ _-]?key|credential|quota|billing|rate[ _-]?limit|too many requests|timeout|timed out|temporar(?:y|ily))\b/iu.test(value);
}

function stripKnownEndpointPath(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl);
  const lower = split.path.toLowerCase();
  for (const path of ['chat/completions', 'images/generations', 'images/edits', 'responses', 'messages']) {
    if (lower.endsWith(`/${path}`)) {
      return `${split.path.slice(0, -path.length).replace(/\/+$/, '')}${split.suffix}`;
    }
  }
  return baseUrl;
}

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const suffixStart = url.search(/[?#]/);
  if (suffixStart < 0) return { path: url, suffix: '' };
  return { path: url.slice(0, suffixStart), suffix: url.slice(suffixStart) };
}

function trimUrlPathEnd(url: string): string {
  const split = splitUrlSuffix(url.trim());
  return `${split.path.replace(/\/+$/, '')}${split.suffix}`;
}

function appendUrlPath(baseUrl: string, path: string): string {
  const split = splitUrlSuffix(baseUrl);
  return `${split.path.replace(/\/+$/, '')}/${path}${split.suffix}`;
}

function lastUrlPathSegment(url: string): string {
  const split = splitUrlSuffix(url.trim());
  return split.path.replace(/\/+$/, '').split('/').pop() ?? '';
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function compactObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
