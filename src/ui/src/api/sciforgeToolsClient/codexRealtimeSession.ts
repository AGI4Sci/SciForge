import type { AgentStreamEvent } from '../../domain';
import {
  CODEX_RUNTIME_STREAM_PATH,
  CODEX_RUNTIME_WEBSOCKET_PATH,
  assertCodexRealtimeSessionEnvelope,
  createCodexRealtimeClientControl,
  type CodexRealtimeClientControlInput,
  type CodexRealtimeSessionEnvelope,
} from '@sciforge-ui/runtime-contract/codex-realtime-session';
import { readWorkspaceToolStream } from './runtimeEvents';

export { CODEX_RUNTIME_STREAM_PATH, CODEX_RUNTIME_WEBSOCKET_PATH };

export const CODEX_REALTIME_SESSION_TRANSPORT_STATUS = {
  rtGapId: 'RT-02',
  currentTransport: 'websocket',
  currentContract: 'structured-events',
  targetTransport: 'websocket',
  targetCapability: 'bidirectional-send-receive',
  websocketComplete: true,
  blockers: [],
} as const;

export interface CodexRealtimeSessionRequest {
  realtimeSession: CodexRealtimeSessionEnvelope;
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
}

export interface CodexRealtimeSessionStreamResult {
  response: Response;
  result?: unknown;
  error?: string;
}

export type CodexRealtimeControlInput = CodexRealtimeClientControlInput;

export interface CodexRealtimeControlSender {
  commandId?: string;
  attemptId?: string;
  send(control: CodexRealtimeControlInput): boolean;
}

export interface CodexRealtimeSessionClient {
  stream(
    requestBodyText: string,
    onEvent: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<CodexRealtimeSessionStreamResult>;
}

type RuntimeWebSocket = WebSocket;
type WebSocketFactory = (url: string) => RuntimeWebSocket;

export function assertCodexRealtimeSessionRequestBoundary(request: CodexRealtimeSessionRequest): void {
  assertCodexRealtimeSessionEnvelope(request.realtimeSession);
  if (request.realtimeSession.rawTerminal !== false) {
    throw new Error('Runtime Codex realtime session cannot use raw terminal transport.');
  }
  if (!request.commandText.trim()) throw new Error('Runtime Codex request commandText is required.');
  if (request.realtimeSession.commandId && request.realtimeSession.commandId !== request.commandId) {
    throw new Error('Runtime Codex realtime session commandId must match the request commandId.');
  }
  if (request.realtimeSession.attemptId && request.realtimeSession.attemptId !== request.attemptId) {
    throw new Error('Runtime Codex realtime session attemptId must match the request attemptId.');
  }
}

export function createCodexRealtimeSessionClient(input: {
  workspaceWriterBaseUrl: string;
  fetchImpl?: typeof fetch;
  webSocketFactory?: WebSocketFactory;
  onControlReady?: (sender: CodexRealtimeControlSender) => void;
}): CodexRealtimeSessionClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const webSocketFactory = input.webSocketFactory ?? defaultWebSocketFactory();
  return {
    async stream(requestBodyText, onEvent, signal) {
      if (webSocketFactory) {
        return streamCodexRealtimeWebSocket({
          workspaceWriterBaseUrl: input.workspaceWriterBaseUrl,
          requestBodyText,
          onEvent,
          signal,
          webSocketFactory,
          onControlReady: input.onControlReady,
        });
      }
      const response = await fetchImpl(`${input.workspaceWriterBaseUrl}${CODEX_RUNTIME_STREAM_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBodyWithTransport(requestBodyText, 'sse'),
        signal,
      });
      const stream = await readWorkspaceToolStream(response, (event) => onEvent(event as AgentStreamEvent));
      return {
        response,
        result: stream.result,
        error: stream.error,
      };
    },
  };
}

function defaultWebSocketFactory(): WebSocketFactory | undefined {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return undefined;
  return (url) => new WebSocket(url);
}

async function streamCodexRealtimeWebSocket(input: {
  workspaceWriterBaseUrl: string;
  requestBodyText: string;
  onEvent: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
  webSocketFactory: WebSocketFactory;
  onControlReady?: (sender: CodexRealtimeControlSender) => void;
}): Promise<CodexRealtimeSessionStreamResult> {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let responseError: string | undefined;
  let writeChain = Promise.resolve();
  let writerClosed = false;
  const ws = input.webSocketFactory(codexRuntimeWebSocketUrl(input.workspaceWriterBaseUrl));
  const requestIds = commandIdsFromRequestBody(input.requestBodyText);
  const controlSender: CodexRealtimeControlSender = {
    commandId: requestIds.commandId,
    attemptId: requestIds.attemptId,
    send(control) {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify(createCodexRealtimeClientControl({
        ...control,
        commandId: control.commandId ?? requestIds.commandId,
        attemptId: control.attemptId ?? requestIds.attemptId,
      } as CodexRealtimeControlInput)));
      return true;
    },
  };
  const closeStream = async () => {
    try {
      if (writerClosed) return;
      await writeChain;
      writerClosed = true;
      await writer.close();
    } catch {
      // The readable side may already be cancelled by the parser.
    }
  };
  const writeSseBlock = (event: string, data: unknown) => {
    const chunk = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    writeChain = writeChain.then(async () => {
      if (writerClosed) return;
      await writer.write(chunk);
    }).catch((error: unknown) => {
      responseError = responseError ?? (error instanceof Error ? error.message : String(error));
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1011, 'codex realtime stream write error');
    });
    return writeChain;
  };
  const closeSocketAfterTerminalEvent = (reason: string, code = 1000) => {
    void writeChain.finally(() => {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close(code, reason);
        return;
      }
      void closeStream();
    });
  };
  const socketDone = new Promise<void>((resolve) => {
    ws.addEventListener('open', () => {
      ws.send(requestBodyWithTransport(input.requestBodyText, 'websocket'));
      input.onControlReady?.(controlSender);
    }, { once: true });
    ws.addEventListener('message', (event) => {
      void (async () => {
        const payload = parseRuntimeSocketMessage(event.data);
        if (!payload) return;
        if (payload.type === 'event') {
          writeSseBlock(payload.event, payload.data);
          if (runtimeSocketPayloadIsTerminal(payload.event, payload.data)) {
            closeSocketAfterTerminalEvent('runtime terminal event');
          }
        }
        if (payload.type === 'error') {
          responseError = payload.error;
          writeSseBlock('error', { ok: false, error: payload.error });
          closeSocketAfterTerminalEvent('runtime error event', 1011);
        }
      })().catch((error: unknown) => {
        responseError = error instanceof Error ? error.message : String(error);
        ws.close(1011, 'codex realtime client parse error');
      });
    });
    ws.addEventListener('error', () => {
      responseError = responseError ?? 'Runtime Codex WebSocket error.';
    }, { once: true });
    ws.addEventListener('close', () => {
      void closeStream().finally(resolve);
    }, { once: true });
  });
  const abort = () => {
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1000, 'request aborted');
  };
  input.signal?.addEventListener('abort', abort, { once: true });
  const response = new Response(stream.readable, {
    status: responseError ? 500 : 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
  let parsed: Awaited<ReturnType<typeof readWorkspaceToolStream>> | undefined;
  try {
    parsed = await readWorkspaceToolStream(response, (event) => input.onEvent(event as AgentStreamEvent));
    await socketDone;
    return {
      response,
      result: parsed.result,
      error: parsed.error ?? responseError,
    };
  } finally {
    input.signal?.removeEventListener('abort', abort);
    if (ws.readyState === 0 || ws.readyState === 1) ws.close(1000, 'runtime stream cleanup');
    await closeStream();
    await socketDone.catch(() => undefined);
  }
}

function commandIdsFromRequestBody(requestBodyText: string): { commandId?: string; attemptId?: string } {
  try {
    const body = JSON.parse(requestBodyText) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const record = body as Record<string, unknown>;
    return {
      commandId: typeof record.commandId === 'string' && record.commandId.trim() ? record.commandId.trim() : undefined,
      attemptId: typeof record.attemptId === 'string' && record.attemptId.trim() ? record.attemptId.trim() : undefined,
    };
  } catch {
    return {};
  }
}

function codexRuntimeWebSocketUrl(workspaceWriterBaseUrl: string): string {
  const url = new URL(CODEX_RUNTIME_WEBSOCKET_PATH, workspaceWriterBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function requestBodyWithTransport(requestBodyText: string, eventTransport: CodexRealtimeSessionEnvelope['eventTransport']): string {
  const body = JSON.parse(requestBodyText) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return requestBodyText;
  const record = body as Record<string, unknown>;
  if (record.realtimeSession && typeof record.realtimeSession === 'object' && !Array.isArray(record.realtimeSession)) {
    record.realtimeSession = {
      ...record.realtimeSession,
      eventTransport,
    };
  }
  return JSON.stringify(record);
}

function parseRuntimeSocketMessage(value: unknown):
  | { type: 'event'; event: string; data: unknown }
  | { type: 'error'; error: string }
  | undefined {
  const raw = typeof value === 'string' ? value : String(value);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.type === 'event' && typeof record.event === 'string') {
    return { type: 'event', event: record.event, data: record.data };
  }
  if (record.type === 'error') {
    return { type: 'error', error: typeof record.error === 'string' ? record.error : JSON.stringify(record.error) };
  }
  return undefined;
}

function runtimeSocketPayloadIsTerminal(eventName: string, data: unknown) {
  const eventType = eventName.trim().toLowerCase();
  if (eventType === 'done' || eventType === 'failed' || eventType === 'cancelled' || eventType === 'canceled' || eventType === 'error') return true;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  return type === 'done'
    || type === 'failed'
    || type === 'cancelled'
    || type === 'canceled'
    || type === 'error';
}
