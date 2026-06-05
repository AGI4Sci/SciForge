import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import { isRecord, readJson, writeJson } from '../server/http.js';
import {
  CODEX_RUNTIME_STREAM_PATH,
  CODEX_RUNTIME_WEBSOCKET_PATH,
  assertCodexRealtimeSessionEnvelope,
  createCodexRealtimeControlAck,
  createCodexRealtimeSessionEnvelope,
  normalizeCodexRealtimeClientControl,
  type CodexRealtimeClientControl,
} from '@sciforge-ui/runtime-contract/codex-realtime-session';

const CODEX_RUNTIME_HEARTBEAT_MS = 5_000;
const CODEX_REALTIME_CANCEL_TIMEOUT_MS = 500;
export { CODEX_RUNTIME_STREAM_PATH, CODEX_RUNTIME_WEBSOCKET_PATH };

const codexRuntimeWss = new WebSocketServer({ noServer: true });

export async function handleCodexRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  adapter: AgentCliAdapter,
): Promise<boolean> {
  if (url.pathname !== CODEX_RUNTIME_STREAM_PATH) return false;
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' });
    return true;
  }

  const abort = new AbortController();
  req.on('aborted', () => abort.abort());
  let responseFinished = false;
  res.on('finish', () => {
    responseFinished = true;
  });
  res.on('close', () => {
    if (!responseFinished) abort.abort();
  });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  try {
    const body = await readJson(req);
    await runCodexRuntimeTurn(body, adapter, abort.signal, {
      expectedTransport: 'sse',
      shouldContinue: () => !res.writableEnded && !res.destroyed,
      emit: (event, data) => writeSse(res, event, data),
    });
  } catch (error) {
    writeSse(res, 'error', { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
  return true;
}

export function handleCodexRuntimeUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  adapter: AgentCliAdapter,
): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname !== CODEX_RUNTIME_WEBSOCKET_PATH) return false;
  codexRuntimeWss.handleUpgrade(req, socket, head, (ws) => {
    connectCodexRuntimeSocket(ws, adapter).catch((err: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) }));
        ws.close(1011, 'codex realtime unavailable');
      }
    });
  });
  return true;
}

async function connectCodexRuntimeSocket(ws: WebSocket, adapter: AgentCliAdapter) {
  const abort = new AbortController();
  ws.on('close', () => abort.abort());
  const pendingControlMessages: string[] = [];
  let requestReceived = false;
  let handleControlMessage: ((raw: string) => void) | undefined;
  const raw = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Runtime Codex WebSocket did not receive a request payload.')), 15_000);
    const onMessage = (message: RawData) => {
      const text = message.toString();
      if (!requestReceived) {
        requestReceived = true;
        clearTimeout(timeout);
        resolve(text);
        return;
      }
      if (handleControlMessage) handleControlMessage(text);
      else pendingControlMessages.push(text);
    };
    ws.on('message', onMessage);
    ws.once('close', () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      reject(error);
    });
  });
  const body = JSON.parse(raw) as unknown;
  assertCodexRuntimeRequestBoundary(body);
  const controlState: CodexRuntimeControlState = {
    commandId: stringField(body.commandId),
    attemptId: stringField(body.attemptId),
  };
  const emit = (event: string, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'event', event, data }));
  };
  handleControlMessage = (message) => {
    void applyCodexRealtimeControlMessage(message, {
      adapter,
      abort,
      state: controlState,
      emit,
    }).catch((error: unknown) => {
      emit('error', {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        source: 'codex-realtime-control',
      });
    });
  };
  for (const message of pendingControlMessages.splice(0)) handleControlMessage(message);

  await runCodexRuntimeTurn(body, adapter, abort.signal, {
    expectedTransport: 'websocket',
    shouldContinue: () => ws.readyState === WebSocket.OPEN,
    emit,
  }, {
    onTurnStarted(turn) {
      controlState.turnId = turn.turnId;
      controlState.attemptId = turn.attemptId;
      controlState.codexSessionId = turn.codexSessionId;
    },
  });
  if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'codex realtime complete');
}

async function runCodexRuntimeTurn(
  body: unknown,
  adapter: AgentCliAdapter,
  abortSignal: AbortSignal,
  output: {
    expectedTransport: 'sse' | 'websocket';
    shouldContinue: () => boolean;
    emit: (event: string, data: unknown) => void;
  },
  hooks: {
    onTurnStarted?: (turn: { turnId: string; attemptId: string; codexSessionId?: string }) => void;
  } = {},
) {
  assertCodexRuntimeRequestBoundary(body);
  const commandText = stringField(body.commandText);
  const workspacePath = stringField(body.workspacePath);
  if (!commandText) throw new Error('commandText is required');
  if (!workspacePath) throw new Error('workspacePath is required');
  const commandId = stringField(body.commandId);
  const attemptId = stringField(body.attemptId);
  const realtimeSession = normalizeRealtimeSessionEnvelope(body, { commandId, attemptId });
  if (realtimeSession.eventTransport !== output.expectedTransport) {
    throw new Error(`Runtime Codex realtime session eventTransport must be ${output.expectedTransport} for this endpoint.`);
  }
  const streamStartedAt = Date.now();
  let lastRuntimeEventAt = streamStartedAt;
  output.emit('realtime_session', realtimeSession);
  output.emit('process-progress', codexRuntimeAcceptedProgressEvent({ commandId, attemptId }));
  const heartbeat = setInterval(() => {
    if (abortSignal.aborted || !output.shouldContinue()) return;
    output.emit('heartbeat', codexRuntimeHeartbeatEvent({
      commandId,
      attemptId,
      streamStartedAt,
      lastRuntimeEventAt,
    }));
  }, CODEX_RUNTIME_HEARTBEAT_MS);
  try {
    const turn = await adapter.startTurn({
      commandText,
      workspacePath,
      commandId,
      attemptId,
      profile: stringField(body.profile),
      codexSessionId: realtimeSession.codexSessionId ?? stringField(body.codexSessionId) ?? stringField(body.nativeSessionId),
      allowOpenAiRuntime: body.allowOpenAiRuntime === true,
      runtimeIntent: runtimeHostIntent(body.runtimeIntent),
      guiExtension: isRecord(body.guiExtension)
        ? {
          enabled: body.guiExtension.enabled !== false,
          statePath: stringField(body.guiExtension.statePath),
        }
        : undefined,
      humanApproval: isRecord(body.humanApproval) ? body.humanApproval : undefined,
      uiState: isRecord(body.uiState) ? body.uiState : undefined,
      declaredIntents: declaredIntentsFromAuditMetadata(body.auditMetadata),
      abortSignal,
    });
    hooks.onTurnStarted?.({
      turnId: turn.turnId,
      attemptId: turn.attemptId,
      codexSessionId: turn.codexSessionId,
    });
    lastRuntimeEventAt = Date.now();
    output.emit('turn', { turnId: turn.turnId, attemptId: turn.attemptId, codexSessionId: turn.codexSessionId });
    for await (const event of turn.events) {
      lastRuntimeEventAt = Date.now();
      if (!output.shouldContinue()) break;
      output.emit(event.type, event);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

interface CodexRuntimeControlState {
  commandId?: string;
  attemptId?: string;
  codexSessionId?: string;
  turnId?: string;
}

async function applyCodexRealtimeControlMessage(
  raw: string,
  input: {
    adapter: AgentCliAdapter;
    abort: AbortController;
    state: CodexRuntimeControlState;
    emit: (event: string, data: unknown) => void;
  },
) {
  let control: CodexRealtimeClientControl;
  try {
    control = normalizeCodexRealtimeClientControl(JSON.parse(raw));
    assertControlTargetsCurrentTurn(control, input.state);
  } catch (error) {
    input.emit('error', {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      source: 'codex-realtime-control',
    });
    return;
  }

  switch (control.controlType) {
    case 'cancel':
      input.emit('realtime_control', createCodexRealtimeControlAck({
        control,
        status: 'accepted',
        delivery: input.state.turnId || input.state.commandId ? 'adapter-cancel' : 'adapter-unavailable',
        detail: '已接收结构化取消请求，正在取消当前 Codex Runtime turn。',
      }));
      await cancelActiveCodexTurn(input.adapter, input.abort, input.state);
      return;
    case 'interrupt':
      input.emit('realtime_control', createCodexRealtimeControlAck({
        control,
        status: 'accepted',
        delivery: control.mode === 'cancel-current' ? 'adapter-cancel' : 'next-turn-required',
        detail: control.mode === 'cancel-current'
          ? '已接收结构化干预请求，正在取消当前 turn；GUI 可把引导作为下一轮 terminal-equivalent text 发送。'
          : '已接收结构化干预请求；当前 Codex app-server turn 不接收 raw terminal stdin，GUI 会把引导保留为下一轮 terminal-equivalent text。',
      }));
      if (control.mode === 'cancel-current') await cancelActiveCodexTurn(input.adapter, input.abort, input.state);
      return;
    case 'input_response':
      input.emit('realtime_control', createCodexRealtimeControlAck({
        control,
        status: 'recorded',
        delivery: 'next-turn-required',
        detail: '已接收结构化输入响应；当前 Codex app-server product path 暂无 GUI approval/input response bridge，响应不会写入 raw terminal。',
      }));
      return;
    case 'approval_response':
      input.emit('realtime_control', createCodexRealtimeControlAck({
        control,
        status: 'recorded',
        delivery: 'next-turn-required',
        detail: '已接收结构化审批响应；当前 Codex app-server product path 暂无 GUI approval/input response bridge，响应不会写入 raw terminal。',
      }));
      return;
  }
}

async function cancelActiveCodexTurn(
  adapter: AgentCliAdapter,
  abort: AbortController,
  state: CodexRuntimeControlState,
) {
  const turnId = state.turnId ?? state.commandId;
  abort.abort();
  if (!turnId) return;
  await Promise.race([
    adapter.cancel(turnId),
    new Promise<void>((resolve) => setTimeout(resolve, CODEX_REALTIME_CANCEL_TIMEOUT_MS)),
  ]).catch(() => undefined);
}

function assertControlTargetsCurrentTurn(control: CodexRealtimeClientControl, state: CodexRuntimeControlState) {
  if (control.commandId && state.commandId && control.commandId !== state.commandId) {
    throw new Error('Runtime Codex realtime control commandId does not match the active request.');
  }
  if (control.attemptId && state.attemptId && control.attemptId !== state.attemptId) {
    throw new Error('Runtime Codex realtime control attemptId does not match the active request.');
  }
}

export function writeSse(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  const flush = (res as ServerResponse & { flush?: () => void }).flush;
  if (typeof flush === 'function') flush.call(res);
}

function codexRuntimeAcceptedProgressEvent({
  commandId,
  attemptId,
}: {
  commandId?: string;
  attemptId?: string;
}) {
  const detail = '已接收文本命令，正在启动 Codex app-server turn。';
  return {
    type: 'process-progress',
    label: 'Codex Runtime',
    detail,
    commandId,
    attemptId,
    progress: {
      phase: 'execute',
      title: '正在启动 Codex app-server',
      detail,
      waitingFor: 'Codex app-server 首个 rich-client 事件',
      nextStep: '收到事件后按顺序展示执行轨迹。',
      reason: 'runtime-codex-request-accepted',
      canAbort: true,
      canContinue: true,
      status: 'running',
    },
    latencyPolicy: {
      firstVisibleResponseMs: 0,
      firstEventWarningMs: 8_000,
      silentRetryMs: 45_000,
      stallBoundMs: 300_000,
    },
  };
}

function codexRuntimeHeartbeatEvent({
  commandId,
  attemptId,
  streamStartedAt,
  lastRuntimeEventAt,
}: {
  commandId?: string;
  attemptId?: string;
  streamStartedAt: number;
  lastRuntimeEventAt: number;
}) {
  const now = Date.now();
  const quietSeconds = Math.max(0, Math.floor((now - lastRuntimeEventAt) / 1000));
  const detail = `Codex app-server stream 仍然连接；已等待 ${quietSeconds}s，正在等待下一条 rich-client 事件。`;
  return {
    type: 'process-progress',
    label: 'Codex Runtime',
    detail,
    commandId,
    attemptId,
    heartbeat: {
      status: 'waiting-for-codex-app-server-event',
      elapsedMs: now - streamStartedAt,
      quietMs: now - lastRuntimeEventAt,
    },
    progress: {
      phase: 'wait',
      title: 'Codex app-server 正在运行',
      detail,
      waitingFor: '下一条 Codex app-server rich-client 事件',
      nextStep: '收到事件后继续按顺序展示执行轨迹。',
      reason: 'runtime-codex-waiting-for-app-server-event',
      canAbort: true,
      canContinue: true,
      status: 'running',
    },
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function codexRuntimeBridgeRequested(body: Record<string, unknown>): boolean {
  const uiState = isRecord(body.uiState) ? body.uiState : {};
  return body.runtimeBridge === 'codex-app-server'
    || body.useCodexRuntimeBridge === true
    || uiState.runtimeBridge === 'codex-app-server'
    || uiState.useCodexRuntimeBridge === true;
}

const CODEX_RUNTIME_REQUEST_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'realtimeSession',
  'commandText',
  'workspacePath',
  'commandId',
  'attemptId',
  'profile',
  'codexSessionId',
  'nativeSessionId',
  'allowOpenAiRuntime',
  'runtimeIntent',
  'guiExtension',
  'humanApproval',
  'uiState',
  'auditMetadata',
]);

const CODEX_RUNTIME_HUMAN_APPROVAL_ALLOWED_KEYS = new Set([
  'approvalRef',
  'decision',
  'source',
  'approvalProvenance',
]);

const CODEX_RUNTIME_APPROVAL_UI_STATE_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'approvalRef',
  'computerUseApprovalRef',
  'terminalEquivalentText',
  'approvalProvenance',
]);

const CODEX_RUNTIME_GUI_EXTENSION_ALLOWED_KEYS = new Set([
  'enabled',
  'statePath',
]);

const CODEX_RUNTIME_HOST_INTENT_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'kind',
  'source',
]);

function normalizeRealtimeSessionEnvelope(
  body: Record<string, unknown>,
  fallback: { commandId?: string; attemptId?: string },
) {
  const envelope = body.realtimeSession ?? createCodexRealtimeSessionEnvelope({
    commandId: fallback.commandId,
    attemptId: fallback.attemptId,
    codexSessionId: stringField(body.codexSessionId) ?? stringField(body.nativeSessionId),
  });
  assertCodexRealtimeSessionEnvelope(envelope);
  return envelope;
}

const CODEX_RUNTIME_FORBIDDEN_NESTED_KEYS = new Set([
  'prompt',
  'messages',
  'transcript',
  'sessionMessages',
  'seedMessages',
  'demoMessages',
  'artifacts',
  'artifactBody',
  'artifactData',
  'claims',
  'claim',
  'expectedArtifactTypes',
  'expectedResult',
  'expectedResults',
  'selectedSkillIds',
  'selectedToolIds',
  'toolProviderRoutes',
  'providerRoute',
  'toolRoute',
  'routeDecision',
  'failureRecoveryPolicy',
  'uiState',
  'references',
  'transportAgentContext',
]);

function assertCodexRuntimeRequestBoundary(body: unknown): asserts body is Record<string, unknown> {
  if (!isRecord(body)) throw new Error('Runtime Codex request body must be an object');
  const extraKeys = Object.keys(body).filter((key) => !CODEX_RUNTIME_REQUEST_ALLOWED_KEYS.has(key));
  if (extraKeys.length) {
    throw new Error(`Runtime Codex request contains non-adapter fields: ${extraKeys.join(', ')}`);
  }
  if (isRecord(body.guiExtension)) {
    const extraGuiKeys = Object.keys(body.guiExtension).filter((key) => !CODEX_RUNTIME_GUI_EXTENSION_ALLOWED_KEYS.has(key));
    if (extraGuiKeys.length) {
      throw new Error(`Runtime Codex guiExtension contains non-adapter fields: ${extraGuiKeys.join(', ')}`);
    }
  }
  if (body.runtimeIntent !== undefined && !runtimeHostIntent(body.runtimeIntent)) {
    throw new Error('Runtime Codex runtimeIntent must be a host-owned Computer Use native route intent.');
  }
  if (isRecord(body.humanApproval) || isRecord(body.uiState)) {
    assertCodexRuntimeApprovalMetadata(body);
  }
  if (isRecord(body.auditMetadata)) {
    const forbiddenAuditKeys = nestedForbiddenKeys(body.auditMetadata, CODEX_RUNTIME_FORBIDDEN_NESTED_KEYS);
    if (forbiddenAuditKeys.length) {
      throw new Error(`Runtime Codex auditMetadata contains non-adapter fields: ${forbiddenAuditKeys.slice(0, 8).join(', ')}`);
    }
  }
}

function runtimeHostIntent(value: unknown): AgentCliStartTurnInput['runtimeIntent'] | undefined {
  if (!isRecord(value)) return undefined;
  const extra = Object.keys(value).filter((key) => !CODEX_RUNTIME_HOST_INTENT_ALLOWED_KEYS.has(key));
  if (extra.length) return undefined;
  if (value.schemaVersion !== 'sciforge.runtime-codex.host-intent.v1') return undefined;
  if (value.kind !== 'computer-use-native-route') return undefined;
  if (value.source !== 'host-owned') return undefined;
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
  };
}

function declaredIntentsFromAuditMetadata(value: unknown): AgentCliStartTurnInput['declaredIntents'] | undefined {
  if (!isRecord(value)) return undefined;
  const projection = isRecord(value.guiLocalProjection) ? value.guiLocalProjection : undefined;
  const declaredIntents = isRecord(projection?.composerDeclaredIntents) ? projection.composerDeclaredIntents : undefined;
  if (!declaredIntents) return undefined;
  const authorization = declaredAuthorizationIntent(declaredIntents.authorization);
  const model = declaredModelIntent(declaredIntents.model);
  const mode = declaredModeIntent(declaredIntents.mode);
  if (!authorization && !model && !mode) return undefined;
  return {
    ...(authorization ? { authorization } : {}),
    ...(model ? { model } : {}),
    ...(mode ? { mode } : {}),
  };
}

function declaredAuthorizationIntent(value: unknown): NonNullable<AgentCliStartTurnInput['declaredIntents']>['authorization'] | undefined {
  if (!isRecord(value)) return undefined;
  const profileId = safeDeclaredIntentText(value.profileId, 80);
  const publicLabel = safeDeclaredIntentText(value.publicLabel, 80);
  if (!profileId && !publicLabel) return undefined;
  const hardConfirmCategories = Array.isArray(value.hardConfirmCategories)
    ? value.hardConfirmCategories
      .map((item) => safeDeclaredIntentText(item, 80))
      .filter((item): item is string => Boolean(item))
      .slice(0, 16)
    : undefined;
  return {
    ...(profileId ? { profileId } : {}),
    ...(publicLabel ? { publicLabel } : {}),
    ...(safeDeclaredIntentText(value.source, 80) ? { source: safeDeclaredIntentText(value.source, 80) } : {}),
    ...(typeof value.singleTurnOverride === 'boolean' ? { singleTurnOverride: value.singleTurnOverride } : {}),
    ...(hardConfirmCategories?.length ? { hardConfirmCategories } : {}),
    ...(safeDeclaredIntentText(value.actionId, 120) ? { actionId: safeDeclaredIntentText(value.actionId, 120) } : {}),
    ...(safeDeclaredIntentText(value.declaredAt, 80) ? { declaredAt: safeDeclaredIntentText(value.declaredAt, 80) } : {}),
  };
}

function declaredModelIntent(value: unknown): NonNullable<AgentCliStartTurnInput['declaredIntents']>['model'] | undefined {
  if (!isRecord(value)) return undefined;
  const modelIntentId = safeDeclaredIntentText(value.modelIntentId, 80);
  const publicLabel = safeDeclaredIntentText(value.publicLabel, 80);
  if (!modelIntentId && !publicLabel) return undefined;
  return {
    ...(modelIntentId ? { modelIntentId } : {}),
    ...(publicLabel ? { publicLabel } : {}),
    ...(safeDeclaredIntentText(value.mode, 60) ? { mode: safeDeclaredIntentText(value.mode, 60) } : {}),
    ...(safeDeclaredIntentText(value.capabilityTier, 60) ? { capabilityTier: safeDeclaredIntentText(value.capabilityTier, 60) } : {}),
    ...(safeDeclaredIntentText(value.actionId, 120) ? { actionId: safeDeclaredIntentText(value.actionId, 120) } : {}),
    ...(safeDeclaredIntentText(value.declaredAt, 80) ? { declaredAt: safeDeclaredIntentText(value.declaredAt, 80) } : {}),
  };
}

function declaredModeIntent(value: unknown): NonNullable<AgentCliStartTurnInput['declaredIntents']>['mode'] | undefined {
  if (!isRecord(value)) return undefined;
  const modeIntentId = safeDeclaredIntentText(value.modeIntentId, 80);
  const publicLabel = safeDeclaredIntentText(value.publicLabel, 80);
  if (!modeIntentId && !publicLabel) return undefined;
  return {
    ...(modeIntentId ? { modeIntentId } : {}),
    ...(publicLabel ? { publicLabel } : {}),
    ...(safeDeclaredIntentText(value.summaryGuidance, 180) ? { summaryGuidance: safeDeclaredIntentText(value.summaryGuidance, 180) } : {}),
    ...(safeDeclaredIntentText(value.actionId, 120) ? { actionId: safeDeclaredIntentText(value.actionId, 120) } : {}),
    ...(safeDeclaredIntentText(value.declaredAt, 80) ? { declaredAt: safeDeclaredIntentText(value.declaredAt, 80) } : {}),
  };
}

function safeDeclaredIntentText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > maxLength) return undefined;
  if (/(?:\bBearer\s+|\b(?:sk|rk|pk|ghp|github_pat)[_-]|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization|credential|https?:\/\/|(?:^|[\s([{:=])(?:~\/|\/(?:Applications|Users|workspace|tmp|var|private|Volumes|home|opt|etc|mnt|srv|Library)\b))/i.test(text)) {
    return undefined;
  }
  return text;
}

function assertCodexRuntimeApprovalMetadata(body: Record<string, unknown>) {
  const commandText = stringField(body.commandText) ?? '';
  if (!/(?:^|\n)\s*\/(?:computer-use|computer\s+use)\s+approve\b/i.test(commandText)) {
    throw new Error('Runtime Codex humanApproval/uiState metadata is only allowed for /computer-use approve commandText.');
  }
  if (isRecord(body.humanApproval)) {
    const extra = Object.keys(body.humanApproval).filter((key) => !CODEX_RUNTIME_HUMAN_APPROVAL_ALLOWED_KEYS.has(key));
    if (extra.length) throw new Error(`Runtime Codex humanApproval contains non-confirmation fields: ${extra.join(', ')}`);
  }
  if (isRecord(body.uiState)) {
    const extra = Object.keys(body.uiState).filter((key) => !CODEX_RUNTIME_APPROVAL_UI_STATE_ALLOWED_KEYS.has(key));
    if (extra.length) throw new Error(`Runtime Codex uiState contains non-confirmation fields: ${extra.join(', ')}`);
  }
}

function nestedForbiddenKeys(value: unknown, forbiddenKeys: Set<string>, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => nestedForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbiddenKeys.has(key) ? [current] : [];
    return [...hit, ...nestedForbiddenKeys(entry, forbiddenKeys, current)];
  });
}
