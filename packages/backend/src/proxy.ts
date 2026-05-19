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
  log?: (message: string) => void;
  fetchImpl?: typeof fetch;
}

export interface StartedCodexResponsesProxy {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

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

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'OPTIONS') return sendCors(response);
      if (request.method === 'GET' && url.pathname === '/healthz') {
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
  const upstream = await fetchImpl(upstreamUrl, {
    method: 'POST',
    headers: upstreamHeaders(request, options, 'application/json'),
    body: JSON.stringify(chatRequest),
  });

  if (!upstream.ok) {
    const payload = await upstream.text();
    return sendJson(response, upstream.status, normalizeUpstreamError(payload, upstream.status));
  }

  if (chatRequest.stream === true) {
    return streamChatCompletionAsResponses(response, upstream, chatRequest.model);
  }

  const completion = await upstream.json();
  return sendJson(response, 200, chatCompletionToResponse(completion, responsesRequest));
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

function normalizeUpstreamError(payload: string, status: number): JsonObject {
  const parsed = parseJsonObject(payload);
  if (parsed?.error && typeof parsed.error === 'object') return parsed as JsonObject;
  return {
    error: {
      code: 'upstream_error',
      message: payload || `Upstream HTTP ${status}`,
    },
  };
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
