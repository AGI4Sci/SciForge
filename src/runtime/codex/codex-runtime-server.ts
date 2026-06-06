import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import {
  createCodexAgentHostGroundingSnapshot,
  evaluateCodexAgentHostTurnLoop,
  resolveCodexAgentHostRuntimeTruth,
  type CodexAgentHostComputerUseActMaterializer,
  type CodexAgentHostRuntimeTruth,
  type CodexAgentHostRuntimeTruthResolver,
} from './agent-host-turn-loop.js';
import { isRecord, readJson, writeJson } from '../server/http.js';
import { sanitizeCompletionEvidencePolicy } from '../computer-use/completion-evidence-policy.js';
import { isComputerUseNativeRouteCommand } from './computer-use-native-route.js';
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

export interface CodexRuntimeRouteOptions {
  agentHostRuntimeTruthResolver?: CodexAgentHostRuntimeTruthResolver;
  computerUseActMaterializer?: CodexAgentHostComputerUseActMaterializer;
}

export async function handleCodexRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  adapter: AgentCliAdapter,
  options: CodexRuntimeRouteOptions = {},
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
    }, {}, options);
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
  options: CodexRuntimeRouteOptions = {},
): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname !== CODEX_RUNTIME_WEBSOCKET_PATH) return false;
  codexRuntimeWss.handleUpgrade(req, socket, head, (ws) => {
    connectCodexRuntimeSocket(ws, adapter, options).catch((err: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) }));
        ws.close(1011, 'codex realtime unavailable');
      }
    });
  });
  return true;
}

async function connectCodexRuntimeSocket(ws: WebSocket, adapter: AgentCliAdapter, options: CodexRuntimeRouteOptions = {}) {
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
  }, options);
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
  options: CodexRuntimeRouteOptions = {},
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
  const agentHostInput = agentHostInputForRuntimeTurn(body, commandText);
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
    const explicitRuntimeIntent = runtimeHostIntent(body.runtimeIntent);
    const runtimeIntent = explicitRuntimeIntent ?? runtimeHostIntentFromCommandText(commandText);
    const explicitComputerUseNativeRouteIntent = explicitRuntimeIntent?.kind === 'computer-use-native-route';
    const agentHostRuntimeTruth = await resolveAgentHostRuntimeTruthForTurn(body, {
      agentHostInput,
      commandText,
      workspacePath,
      commandId,
      attemptId,
      auditMetadata: body.auditMetadata,
      abortSignal,
      resolver: options.agentHostRuntimeTruthResolver,
    });
    const agentHostTurnLoopResult = explicitComputerUseNativeRouteIntent
      ? undefined
      : await evaluateCodexAgentHostTurnLoop({
        input: agentHostInput,
        commandText,
        workspacePath,
        commandId,
        attemptId,
        auditMetadata: body.auditMetadata,
        runtimeTruth: agentHostRuntimeTruth,
        runtimeTruthRefresh: options.agentHostRuntimeTruthResolver
          ? ({ step, previousResult }) => resolveAgentHostRuntimeTruthForTurn(body, {
            agentHostInput,
            commandText,
            workspacePath,
            commandId,
            attemptId,
            auditMetadata: {
              source: 'computer-use-act-loop-refresh',
              step,
              previousEvidenceRefs: previousResult?.evidenceRefs?.slice(0, 12),
            },
            abortSignal,
            resolver: options.agentHostRuntimeTruthResolver,
          })
          : undefined,
        computerUseActMaterializer: options.computerUseActMaterializer,
        abortSignal,
      });
    if (agentHostTurnLoopResult) {
      lastRuntimeEventAt = Date.now();
      output.emit('agent_host_turn_loop', agentHostTurnLoopResult.event);
      output.emit('done', agentHostTurnLoopResult.result);
      return;
    }
    const agentHostGrounding = createCodexAgentHostGroundingSnapshot(agentHostInput, { runtimeTruth: agentHostRuntimeTruth });
    const approvalMetadata = sanitizeCodexRuntimeApprovalMetadata(body);
    const turn = await adapter.startTurn({
      commandText,
      workspacePath,
      commandId,
      attemptId,
      profile: stringField(body.profile),
      codexSessionId: realtimeSession.codexSessionId ?? stringField(body.codexSessionId) ?? stringField(body.nativeSessionId),
      allowOpenAiRuntime: body.allowOpenAiRuntime === true,
      runtimeIntent,
      guiExtension: isRecord(body.guiExtension)
        ? {
          enabled: body.guiExtension.enabled !== false,
          statePath: stringField(body.guiExtension.statePath),
        }
        : undefined,
      humanApproval: approvalMetadata.humanApproval,
      uiState: approvalMetadata.uiState,
      declaredIntents: declaredIntentsFromAuditMetadata(body.auditMetadata),
      agentHostGrounding,
      agentHostRuntimeTruth,
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

async function resolveAgentHostRuntimeTruthForTurn(
  body: Record<string, unknown>,
  input: {
    agentHostInput: unknown;
    commandText: string;
    workspacePath: string;
    commandId?: string;
    attemptId?: string;
    auditMetadata?: unknown;
    abortSignal: AbortSignal;
    resolver?: CodexAgentHostRuntimeTruthResolver;
  },
): Promise<CodexAgentHostRuntimeTruth | undefined> {
  if (!input.resolver) return undefined;
  try {
    return await resolveCodexAgentHostRuntimeTruth({
      input: input.agentHostInput,
      commandText: input.commandText,
      workspacePath: input.workspacePath,
      commandId: input.commandId,
      attemptId: input.attemptId,
      auditMetadata: input.auditMetadata,
      abortSignal: input.abortSignal,
      runtimeTruthResolver: input.resolver,
    });
  } catch {
    return {
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      source: 'runtime-truth-resolver-error',
      readiness: {
        browserHostSession: 'blocked',
        nativeBridge: 'blocked',
        nativeSurface: 'blocked',
        windowActionSession: 'blocked',
        computerUseAdapter: 'blocked',
      },
      refs: ['runtime-truth:resolver-error'],
    };
  }
}

function agentHostInputForRuntimeTurn(body: Record<string, unknown>, commandText: string): unknown {
  const commandIntentText = userIntentTextFromCommandText(commandText).slice(0, 2_000);
  if (isRecord(body.agentHostInput) && body.agentHostInput.schemaVersion === 'sciforge.codex-agent-host-input.v1') {
    return {
      ...body.agentHostInput,
      intentText: commandIntentTextFromAskCommand(commandText)?.slice(0, 2_000)
        ?? stringField(body.agentHostInput.intentText)
        ?? commandIntentText,
    };
  }
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'runtime-codex-server-fallback',
    intentText: commandIntentText,
    authorizationProfileId: 'high-autonomy',
    policyOwner: 'codex-agent-host-runtime',
    refs: [],
  };
}

function userIntentTextFromCommandText(commandText: string): string {
  return commandIntentTextFromAskCommand(commandText) ?? commandText.trim();
}

function commandIntentTextFromAskCommand(commandText: string): string | undefined {
  const text = commandText.replace(/\s+/g, ' ').trim();
  if (!/^ask(?:\s|$)/i.test(text)) return undefined;
  const quotedSegments = quotedCommandSegments(text).filter((segment) => !looksLikeReferenceSegment(segment));
  return quotedSegments.at(-1);
}

function quotedCommandSegments(text: string): string[] {
  const segments: string[] = [];
  const pattern = /"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|“([^”]*)”/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const unescaped = raw.replace(/\\"/g, '"').replace(/\\'/g, "'");
    const compact = unescaped.replace(/\s+/g, ' ').trim();
    if (compact) segments.push(compact);
  }
  return segments;
}

function looksLikeReferenceSegment(value: string): boolean {
  return /^(?:artifact|message|run|session|browser-host-session|runtime-health|gui\.present):/i.test(value)
    || /^\.?\.?\/?\.sciforge\//i.test(value)
    || /^\/(?:Applications|Users|Volumes|private|tmp|var)\//i.test(value)
    || /^https?:\/\//i.test(value);
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
  'agentHostInput',
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
  'completionEvidencePolicy',
  'computerUseNext',
  'computerUseLong',
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

const CODEX_RUNTIME_UNSAFE_APPROVAL_KEY_PATTERN = /(?:sidecar|^approvalRequest$|^highRiskAction$|raw|provider.*payload|^payload$|base64|api[_-]?key|secret|password|(?:access|auth)?[_-]?token|authorization|credential|screenshot|bitmap|blob|data[_-]?url|(?:^|(?:source|target|raw))url$|uri$|href$)/i;
const CODEX_RUNTIME_UNSAFE_APPROVAL_STRING_PATTERN = /(?:\bBearer\s+|\b(?:sk|rk|pk|ghp|github_pat)[_-]|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization|credential|providerPayload|data:[^,\s]+;base64,|https?:\/\/)/i;
const CODEX_RUNTIME_BASE64ISH_APPROVAL_STRING_PATTERN = /^[A-Za-z0-9+/_=-]{160,}$/;
const CODEX_RUNTIME_APPROVAL_MAX_DEPTH = 8;
const CODEX_RUNTIME_APPROVAL_MAX_ARRAY_ITEMS = 32;
const CODEX_RUNTIME_APPROVAL_MAX_STRING_LENGTH = 500;

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

function sanitizeCodexRuntimeApprovalMetadata(body: Record<string, unknown>): {
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
} {
  return {
    humanApproval: sanitizeCodexRuntimeHumanApproval(body.humanApproval),
    uiState: sanitizeCodexRuntimeApprovalUiState(body.uiState),
  };
}

function sanitizeCodexRuntimeHumanApproval(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    approvalRef: safeRuntimeApprovalString(value.approvalRef),
    decision: safeRuntimeApprovalString(value.decision),
    source: safeRuntimeApprovalString(value.source),
    approvalProvenance: sanitizeRuntimeApprovalValue(value.approvalProvenance),
  });
}

function sanitizeCodexRuntimeApprovalUiState(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    schemaVersion: safeRuntimeApprovalString(value.schemaVersion),
    approvalRef: safeRuntimeApprovalString(value.approvalRef),
    computerUseApprovalRef: safeRuntimeApprovalString(value.computerUseApprovalRef),
    terminalEquivalentText: typeof value.terminalEquivalentText === 'boolean' ? value.terminalEquivalentText : undefined,
    approvalProvenance: sanitizeRuntimeApprovalValue(value.approvalProvenance),
  });
}

function sanitizeRuntimeApprovalValue(value: unknown, depth = 0): unknown {
  if (depth > CODEX_RUNTIME_APPROVAL_MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return safeRuntimeApprovalString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, CODEX_RUNTIME_APPROVAL_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeRuntimeApprovalValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!safeRuntimeApprovalKey(key)) continue;
    const sanitized = sanitizeRuntimeApprovalValue(entry, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return Object.keys(out).length ? out : undefined;
}

function safeRuntimeApprovalKey(key: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_:-]{0,80}$/.test(key)
    && !CODEX_RUNTIME_UNSAFE_APPROVAL_KEY_PATTERN.test(key);
}

function safeRuntimeApprovalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > CODEX_RUNTIME_APPROVAL_MAX_STRING_LENGTH) return undefined;
  if (CODEX_RUNTIME_UNSAFE_APPROVAL_STRING_PATTERN.test(text)) return undefined;
  if (CODEX_RUNTIME_BASE64ISH_APPROVAL_STRING_PATTERN.test(text)) return undefined;
  return text;
}

function runtimeHostIntent(value: unknown): AgentCliStartTurnInput['runtimeIntent'] | undefined {
  if (!isRecord(value)) return undefined;
  const extra = Object.keys(value).filter((key) => !CODEX_RUNTIME_HOST_INTENT_ALLOWED_KEYS.has(key));
  if (extra.length) return undefined;
  if (value.schemaVersion !== 'sciforge.runtime-codex.host-intent.v1') return undefined;
  if (value.kind !== 'computer-use-native-route') return undefined;
  if (value.source !== 'host-owned') return undefined;
  const completionEvidencePolicy = sanitizeCompletionEvidencePolicy(value.completionEvidencePolicy);
  const computerUseNext = sanitizeComputerUseNextBinding(value.computerUseNext);
  const computerUseLong = sanitizeComputerUseLongBinding(value.computerUseLong);
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
    ...(completionEvidencePolicy ? { completionEvidencePolicy } : {}),
    ...(computerUseNext ? { computerUseNext } : {}),
    ...(computerUseLong ? { computerUseLong } : {}),
  };
}

function runtimeHostIntentFromCommandText(commandText: string): AgentCliStartTurnInput['runtimeIntent'] | undefined {
  if (!isComputerUseNativeRouteCommand(commandText)) return undefined;
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
  };
}

function sanitizeComputerUseNextBinding(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    taskId: stringField(value.taskId),
    scenarioId: stringField(value.scenarioId),
    title: stringField(value.title),
    requirements: stringListField(value.requirements),
    safetyBoundary: booleanRecord(value.safetyBoundary),
  });
}

function sanitizeComputerUseLongBinding(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    taskId: stringField(value.taskId),
    scenarioId: stringField(value.scenarioId),
    title: stringField(value.title),
    requirements: stringListField(value.requirements),
    safetyBoundary: booleanRecord(value.safetyBoundary),
  });
}

function stringListField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  return out.length ? out : undefined;
}

function booleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const out = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => (
    /^[a-zA-Z][a-zA-Z0-9_]*$/.test(entry[0])
    && typeof entry[1] === 'boolean'
  )));
  return Object.keys(out).length ? out : undefined;
}

function nonEmptyRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const out = Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null) return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
  return Object.keys(out).length ? out : undefined;
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
    ...(declaredAuthorizationScope(value.scope) ? { scope: declaredAuthorizationScope(value.scope) } : {}),
    ...(typeof value.singleTurnOverride === 'boolean' ? { singleTurnOverride: value.singleTurnOverride } : {}),
    ...(hardConfirmCategories?.length ? { hardConfirmCategories } : {}),
    ...(safeDeclaredIntentText(value.actionId, 120) ? { actionId: safeDeclaredIntentText(value.actionId, 120) } : {}),
    ...(safeDeclaredIntentText(value.declaredAt, 80) ? { declaredAt: safeDeclaredIntentText(value.declaredAt, 80) } : {}),
  };
}

function declaredAuthorizationScope(value: unknown): NonNullable<NonNullable<AgentCliStartTurnInput['declaredIntents']>['authorization']>['scope'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.user !== 'current-user' || value.workspace !== 'current-workspace') return undefined;
  return {
    user: 'current-user',
    workspace: 'current-workspace',
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
