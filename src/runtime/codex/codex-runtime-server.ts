import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import {
  createCodexAgentHostGroundingSnapshot,
  resolveCodexAgentHostRuntimeTruth,
  type CodexAgentHostRuntimeTruth,
  type CodexAgentHostRuntimeTruthResolver,
} from './agent-host-grounding.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  type BoundedOperationResultValue,
  type ModuleInvokeRequest,
  type ModuleInvokeResult,
  validateBoundedOperationRequest,
} from '../../../packages/contracts/runtime/modules.js';
import { isRecord, readJson, writeJson } from '../server/http.js';
import { sanitizeCompletionEvidencePolicy } from '../computer-use/completion-evidence-policy.js';
import { isComputerUseNativeRouteCommand } from './computer-use-native-route.js';
import {
  createCodexAgentHostBrowserBoundedOperationTurnLoopResult,
  evaluateCodexAgentHostTurnLoop,
  type CodexAgentHostBrowserBoundedOperationInvoker,
  type CodexAgentHostTurnLoopResult,
} from './agent-host-turn-loop.js';
import {
  CODEX_RUNTIME_STREAM_PATH,
  CODEX_RUNTIME_WEBSOCKET_PATH,
  assertCodexRealtimeSessionEnvelope,
  createCodexRealtimeControlAck,
  createCodexRealtimeSessionEnvelope,
  normalizeCodexRealtimeClientControl,
  type CodexRealtimeClientControl,
} from '@sciforge-ui/runtime-contract/codex-realtime-session';
import {
  createRuntimeModuleDispatcher,
  createRuntimeModuleRegistry,
} from '../modules/dispatcher.js';
import { createBrowserBoundedOperationModuleHandler } from '../modules/bounded-operation-module-handlers.js';
import {
  evaluateBrowserEvidenceNeed,
  semanticBrowserSearchQueryFromPrompt,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';

const CODEX_RUNTIME_HEARTBEAT_MS = 5_000;
const CODEX_REALTIME_CANCEL_TIMEOUT_MS = 500;
export { CODEX_RUNTIME_STREAM_PATH, CODEX_RUNTIME_WEBSOCKET_PATH };

const codexRuntimeWss = new WebSocketServer({ noServer: true });

export interface CodexRuntimeRouteOptions {
  agentHostRuntimeTruthResolver?: CodexAgentHostRuntimeTruthResolver;
  browserBoundedOperationInvoker?: (input: {
    workspacePath: string;
    commandId?: string;
    attemptId?: string;
  }) => CodexAgentHostBrowserBoundedOperationInvoker | undefined;
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
    const approvalMetadata = sanitizeCodexRuntimeApprovalMetadata(body);
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
    const agentHostGrounding = createCodexAgentHostGroundingSnapshot(agentHostInput, { runtimeTruth: agentHostRuntimeTruth });
    const directBrowserEvidence = output.shouldContinue()
      ? await runtimeDirectBrowserEvidenceTurn({
        agentHostInput,
        commandText,
        workspacePath,
        commandId,
        attemptId,
        auditMetadata: body.auditMetadata,
        agentHostRuntimeTruth,
        runtimeIntent,
        abortSignal,
        options,
      })
      : undefined;
    if (directBrowserEvidence) {
      output.emit('agent_host_turn_loop', directBrowserEvidence.event);
      output.emit('gui_present', runtimeGuiPresentEventFromTurnLoopResult({
        turnLoop: directBrowserEvidence,
        commandText,
        workspacePath,
        commandId,
        attemptId,
      }));
      output.emit('done', directBrowserEvidence.result);
      return;
    }
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
    const observation = createRuntimeTurnObservation();
    const terminalEvents: NormalizedAgentEvent[] = [];
    for await (const event of turn.events) {
      lastRuntimeEventAt = Date.now();
      if (!output.shouldContinue()) break;
      observeRuntimeTurnEvent(observation, event);
      if (isRuntimeTurnTerminalEvent(event)) {
        terminalEvents.push(event);
        continue;
      }
      if (shouldWithholdRuntimeTextEvent(event, commandText)) continue;
      output.emit(event.type, event);
    }
    const fallback = output.shouldContinue()
      ? await runtimeStructuredModuleInvokeFallback({
        observation,
        agentHostInput,
        commandText,
        workspacePath,
        commandId,
        attemptId,
        auditMetadata: body.auditMetadata,
        agentHostRuntimeTruth,
        abortSignal,
        options,
      })
      : undefined;
    const browserFallback = fallback ?? (output.shouldContinue()
      ? await runtimeBrowserEvidenceFallback({
        observation,
        agentHostInput,
        commandText,
        workspacePath,
        commandId,
        attemptId,
        auditMetadata: body.auditMetadata,
        agentHostRuntimeTruth,
        abortSignal,
        options,
      })
      : undefined);
    if (browserFallback) {
      output.emit('agent_host_turn_loop', browserFallback.event);
      output.emit('gui_present', runtimeGuiPresentEventFromTurnLoopResult({
        turnLoop: browserFallback,
        commandText,
        workspacePath,
        commandId,
        attemptId,
      }));
      output.emit('done', browserFallback.result);
    } else {
      for (const event of terminalEvents) {
        if (!output.shouldContinue()) break;
        output.emit(event.type, event);
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
}

interface RuntimeTurnObservation {
  assistantText: string[];
  sawToolLifecycle: boolean;
  sawGuiCompletion: boolean;
  sawBrowserEvidenceRef: boolean;
  sawTerminalDone: boolean;
  sawTerminalFailure: boolean;
}

function createRuntimeTurnObservation(): RuntimeTurnObservation {
  return {
    assistantText: [],
    sawToolLifecycle: false,
    sawGuiCompletion: false,
    sawBrowserEvidenceRef: false,
    sawTerminalDone: false,
    sawTerminalFailure: false,
  };
}

function observeRuntimeTurnEvent(observation: RuntimeTurnObservation, event: NormalizedAgentEvent): void {
  if (event.type === 'message' || event.type === 'message_delta') {
    const text = typeof event.text === 'string' ? event.text : typeof event.message === 'string' ? event.message : undefined;
    if (text) observation.assistantText.push(text);
  }
  if (event.type === 'done') {
    const doneEvent = event as unknown as { finalText?: unknown };
    const finalText = typeof doneEvent.finalText === 'string' ? doneEvent.finalText : undefined;
    const message = typeof event.message === 'string' ? event.message : undefined;
    const text = finalText ?? message;
    if (text) observation.assistantText.push(text);
  }
  if (event.type === 'tool_started' || event.type === 'tool_completed') observation.sawToolLifecycle = true;
  if (event.type === 'gui_present' || event.type === 'gui_ask_user') observation.sawGuiCompletion = true;
  if ((event.evidenceRefs ?? []).some((ref) => ref.startsWith('browser-host-session:'))) {
    observation.sawBrowserEvidenceRef = true;
  }
  if (event.type === 'done') observation.sawTerminalDone = true;
  if (event.type === 'failed' || event.type === 'cancelled') observation.sawTerminalFailure = true;
}

function isRuntimeTurnTerminalEvent(event: NormalizedAgentEvent): boolean {
  return event.type === 'done' || event.type === 'failed' || event.type === 'cancelled';
}

function shouldWithholdRuntimeTextEvent(event: NormalizedAgentEvent, commandText: string): boolean {
  if (event.type !== 'message' && event.type !== 'message_delta') return false;
  const text = typeof event.text === 'string' ? event.text : typeof event.message === 'string' ? event.message : '';
  if (looksRuntimeModuleInvokeProtocolText(text)) return true;
  return looksLikeUnsupportedBrowserEvidenceAnswer(text, commandText)
    && !(event.evidenceRefs ?? []).some((ref) => ref.startsWith('browser-host-session:'));
}

async function runtimeDirectBrowserEvidenceTurn(input: {
  agentHostInput: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  agentHostRuntimeTruth?: CodexAgentHostRuntimeTruth;
  runtimeIntent?: AgentCliStartTurnInput['runtimeIntent'];
  abortSignal: AbortSignal;
  options: CodexRuntimeRouteOptions;
}): Promise<CodexAgentHostTurnLoopResult | undefined> {
  if (!shouldRunRuntimeDirectBrowserEvidenceTurn(input.commandText, input.runtimeIntent)) return undefined;
  const invokerFactory = input.options.browserBoundedOperationInvoker ?? defaultRuntimeBrowserBoundedOperationInvoker;
  const browserBoundedOperationInvoker = invokerFactory({
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
  });
  if (!browserBoundedOperationInvoker) return undefined;
  return evaluateCodexAgentHostTurnLoop({
    input: input.agentHostInput,
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    auditMetadata: input.auditMetadata,
    runtimeTruth: input.agentHostRuntimeTruth,
    browserBoundedOperationInvoker,
    abortSignal: input.abortSignal,
  });
}

function shouldRunRuntimeDirectBrowserEvidenceTurn(
  commandText: string,
  runtimeIntent?: AgentCliStartTurnInput['runtimeIntent'],
): boolean {
  if (runtimeIntent) return false;
  if (looksLikeSideEffectCommand(commandText)) return false;
  return runtimeCommandNeedsBrowserEvidence(commandText);
}

function looksLikeSideEffectCommand(commandText: string): boolean {
  const text = userIntentTextFromCommandText(commandText).replace(/\s+/g, ' ').trim();
  return /\b(?:pay|send|submit|delete|remove|upload|change|update|sign|deploy|purchase|buy|book|cancel|create|post|publish|email|message|form|invoice|token|contract|production)\b/i.test(text)
    || /(?:支付|付款|发送|提交|删除|移除|上传|修改|更改|签署|签名|部署|购买|预订|取消|创建|发布|邮件|表单|发票|令牌|合同)/u.test(text);
}

async function runtimeStructuredModuleInvokeFallback(input: {
  observation: RuntimeTurnObservation;
  agentHostInput: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  agentHostRuntimeTruth?: CodexAgentHostRuntimeTruth;
  abortSignal: AbortSignal;
  options: CodexRuntimeRouteOptions;
}): Promise<CodexAgentHostTurnLoopResult | undefined> {
  if (!shouldRunRuntimeStructuredModuleInvokeFallback(input.observation)) return undefined;
  const request = safeBrowserModuleInvokeRequestFromAssistantText(
    input.observation.assistantText.join('\n'),
    input.commandText,
  );
  if (!request) return undefined;
  const invokerFactory = input.options.browserBoundedOperationInvoker ?? defaultRuntimeBrowserBoundedOperationInvoker;
  const browserBoundedOperationInvoker = invokerFactory({
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
  });
  if (!browserBoundedOperationInvoker) return undefined;
  const operationResult = await browserBoundedOperationInvoker(request);
  return createCodexAgentHostBrowserBoundedOperationTurnLoopResult({
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    operationRequest: request,
    operationResult,
  });
}

function shouldRunRuntimeStructuredModuleInvokeFallback(observation: RuntimeTurnObservation): boolean {
  if (!observation.sawTerminalDone || observation.sawTerminalFailure) return false;
  if (observation.sawToolLifecycle || observation.sawGuiCompletion || observation.sawBrowserEvidenceRef) return false;
  return looksRuntimeModuleInvokeProtocolText(observation.assistantText.join('\n'));
}

function safeBrowserModuleInvokeRequestFromAssistantText(
  text: string,
  commandText: string,
): ModuleInvokeRequest | undefined {
  if (!text.trim() || text.length > 20_000) return undefined;
  const tagPattern = /<\s*(?:module[_.-]?invoke|module_invoke)\b[^>]*>([\s\S]{1,8000}?)<\s*\/\s*(?:module[_.-]?invoke|module_invoke)\s*>/giu;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text))) {
    const request = safeBrowserModuleInvokeRequestFromValue(parseJsonObject(match[1]), commandText);
    if (request) return request;
  }
  for (const objectText of boundedOperationObjectLiteralsFromText(text)) {
    const request = safeBrowserModuleInvokeRequestFromValue(parseJsonObject(objectText), commandText)
      ?? safeBrowserModuleInvokeRequestFromOperationText(objectText, commandText);
    if (request) return request;
  }
  return undefined;
}

function looksRuntimeModuleInvokeProtocolText(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  return /<\s*(?:module[_.-]?invoke|module_invoke)\b/i.test(compact)
    || /\bname\s*=\s*["']module[_.-]?invoke["']\s*>/i.test(compact)
    || /\bmodule[_.-]?invoke\b/i.test(compact) && /\bexecuteBoundedOperation\b/i.test(compact)
    || /<\s*function_calls?\b/i.test(compact) && /\bbrowser\s+executeBoundedOperation\b/i.test(compact);
}

function boundedOperationObjectLiteralsFromText(text: string): string[] {
  const objects: string[] = [];
  const markerPattern = /executeBoundedOperation/giu;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(text))) {
    const objectStart = text.indexOf('{', markerPattern.lastIndex);
    if (objectStart < 0) continue;
    const object = balancedObjectLiteralAt(text, objectStart, 8_000);
    if (object) objects.push(object);
  }
  return objects;
}

function balancedObjectLiteralAt(text: string, start: number, maxLength: number): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  const endLimit = Math.min(text.length, start + maxLength);
  for (let index = start; index < endLimit; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') continue;
    depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return undefined;
}

function safeBrowserModuleInvokeRequestFromValue(value: unknown, commandText: string): ModuleInvokeRequest | undefined {
  if (!isRecord(value)) return undefined;
  const moduleId = stringField(value.moduleId);
  const intent = stringField(value.intent);
  if (moduleId !== 'browser' || intent !== EXECUTE_BOUNDED_OPERATION_INTENT) return undefined;
  const input = isRecord(value.input) ? value.input : {};
  const operationKind = stringField(input.operationKind);
  const targetScope = isRecord(input.targetScope) ? input.targetScope : {};
  if (operationKind === 'browser.open_read') {
    const url = safeRuntimeBrowserUrl(targetScope.url);
    if (!url) return undefined;
    return validatedRuntimeBrowserModuleRequest(runtimeBrowserOpenReadOperationRequest(commandText, url));
  }
  if (operationKind === 'browser.search_read') {
    const query = preferredRuntimeBrowserSearchQuery(commandText, stringField(targetScope.query));
    if (!query) return undefined;
    return validatedRuntimeBrowserModuleRequest(runtimeBrowserSearchReadOperationRequest(commandText, query));
  }
  return undefined;
}

function safeBrowserModuleInvokeRequestFromOperationText(
  objectText: string,
  commandText: string,
): ModuleInvokeRequest | undefined {
  if (!objectText.trim() || objectText.length > 8_000) return undefined;
  const operationKind = quotedObjectStringField(objectText, 'operationKind');
  const query = quotedObjectStringField(objectText, 'query');
  const url = quotedObjectStringField(objectText, 'url');
  if (operationKind === 'browser.open_read' || (!operationKind && url && !query)) {
    const safeUrl = safeRuntimeBrowserUrl(url);
    if (!safeUrl) return undefined;
    return validatedRuntimeBrowserModuleRequest(runtimeBrowserOpenReadOperationRequest(commandText, safeUrl));
  }
  if (operationKind === 'browser.search_read' || (!operationKind && query)) {
    const safeQuery = preferredRuntimeBrowserSearchQuery(commandText, query);
    if (!safeQuery) return undefined;
    return validatedRuntimeBrowserModuleRequest(runtimeBrowserSearchReadOperationRequest(commandText, safeQuery));
  }
  return undefined;
}

function quotedObjectStringField(objectText: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(String.raw`(?:["']?${escaped}["']?)\s*:\s*(["'])([\s\S]*?)\1`, 'iu');
  const match = pattern.exec(objectText);
  const value = match?.[2]?.replace(/\\(["'\\])/g, '$1').replace(/\s+/g, ' ').trim();
  return value || undefined;
}

function preferredRuntimeBrowserSearchQuery(commandText: string, protocolQuery: string | undefined): string | undefined {
  const semanticQuery = semanticBrowserSearchQueryFromPrompt(commandText);
  const safeProtocolQuery = safeRuntimeBrowserSearchQuery(protocolQuery);
  const safeSemanticQuery = safeRuntimeBrowserSearchQuery(semanticQuery);
  if (safeSemanticQuery && semanticQueryShouldOverrideProtocolQuery(safeSemanticQuery, safeProtocolQuery)) {
    return safeSemanticQuery;
  }
  return safeProtocolQuery ?? safeSemanticQuery;
}

function semanticQueryShouldOverrideProtocolQuery(semanticQuery: string, protocolQuery: string | undefined): boolean {
  const semanticSite = siteConstraintRoot(semanticQuery);
  if (!semanticSite) return false;
  const protocolSite = siteConstraintRoot(protocolQuery);
  return !protocolSite || protocolSite === semanticSite;
}

function siteConstraintRoot(query: string | undefined): string | undefined {
  const value = /\bsite:([^\s]+)/i.exec(query ?? '')?.[1];
  if (!value) return undefined;
  return value.split('/')[0]?.replace(/^www\./i, '').toLowerCase() || undefined;
}

function runtimeBrowserSearchReadOperationRequest(prompt: string, query: string): ModuleInvokeRequest {
  return {
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: {
        kind: 'web-search',
        query,
        prompt: userIntentTextFromCommandText(prompt).slice(0, 2_000),
      },
      config: {
        allowedActions: ['search', 'open', 'read'],
        maxSteps: 4,
        maxTimeMs: 45_000,
        maxModelCalls: 1,
        riskPolicy: 'low',
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
        stopConditions: ['enough-source-pages'],
      },
    },
  };
}

function runtimeBrowserOpenReadOperationRequest(prompt: string, url: string): ModuleInvokeRequest {
  return {
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.open_read',
      ownerModuleId: 'browser',
      targetScope: {
        kind: 'url',
        url,
        prompt: userIntentTextFromCommandText(prompt).slice(0, 2_000),
      },
      config: {
        allowedActions: ['open', 'read'],
        maxSteps: 2,
        maxTimeMs: 45_000,
        maxModelCalls: 1,
        riskPolicy: 'low',
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
        stopConditions: ['page-read'],
      },
    },
  };
}

function validatedRuntimeBrowserModuleRequest(request: ModuleInvokeRequest): ModuleInvokeRequest | undefined {
  return validateBoundedOperationRequest(request).ok ? request : undefined;
}

function safeRuntimeBrowserSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query || query.length > 300) return undefined;
  if (/[\u0000-\u001f<>]|(?:data:|javascript:|file:|blob:|authorization|bearer|api[_-]?key|password|secret|token|<html)/i.test(query)) {
    return undefined;
  }
  return query;
}

function safeRuntimeBrowserUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 2_048) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    if (/[\u0000-\u001f<>]|(?:authorization|bearer|api[_-]?key|password|secret|token|<html)/i.test(text)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string | undefined): unknown {
  if (!value) return undefined;
  const text = value.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function runtimeGuiPresentEventFromTurnLoopResult(input: {
  turnLoop: CodexAgentHostTurnLoopResult;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
}): NormalizedAgentEvent {
  const event = input.turnLoop.event;
  const result = input.turnLoop.result;
  const commandId = stringField(result.commandId) ?? input.commandId ?? event.commandId;
  const attemptId = stringField(result.attemptId) ?? input.attemptId ?? event.attemptId;
  const message = stringField(result.message) ?? stringField(event.message) ?? 'Runtime Codex produced a structured presentation.';
  const evidenceRefs = uniqueStringFields([
    ...stringArrayField(result.evidenceRefs),
    ...stringArrayField(event.evidenceRefs),
  ]).slice(0, 24);
  const source = commandId ? `gui.present:${commandId}:agent-host` : 'gui.present:agent-host';
  const displayIntent = isRecord(result.displayIntent) ? result.displayIntent : {};
  const status = stringField(displayIntent.status) ?? stringField(result.status) ?? stringField(event.status);
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    timestamp: new Date().toISOString(),
    type: 'gui_present',
    status,
    text: message,
    provider: stringField(event.provider) ?? 'sciforge-agent-host',
    model: stringField(event.model) ?? 'codex-agent-host-turn-loop',
    profile: stringField(event.profile) ?? 'sciforge-runtime-default',
    workspace: stringField(event.workspace) ?? input.workspacePath,
    commandId,
    attemptId,
    evidenceRefs,
    raw: {
      source,
      presentation: {
        source,
        text: message,
        ref: evidenceRefs[0],
        title: 'Runtime answer',
        hint: 'markdown',
        status,
        displayedRefs: evidenceRefs.slice(0, 12),
      },
    },
  };
}

async function runtimeBrowserEvidenceFallback(input: {
  observation: RuntimeTurnObservation;
  agentHostInput: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  agentHostRuntimeTruth?: CodexAgentHostRuntimeTruth;
  abortSignal: AbortSignal;
  options: CodexRuntimeRouteOptions;
}): Promise<CodexAgentHostTurnLoopResult | undefined> {
  if (!shouldRunRuntimeBrowserEvidenceFallback(input.observation, input.commandText)) return undefined;
  const invokerFactory = input.options.browserBoundedOperationInvoker ?? defaultRuntimeBrowserBoundedOperationInvoker;
  const browserBoundedOperationInvoker = invokerFactory({
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
  });
  if (!browserBoundedOperationInvoker) return undefined;
  return evaluateCodexAgentHostTurnLoop({
    input: input.agentHostInput,
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    auditMetadata: input.auditMetadata,
    runtimeTruth: input.agentHostRuntimeTruth,
    browserBoundedOperationInvoker,
    abortSignal: input.abortSignal,
  });
}

function shouldRunRuntimeBrowserEvidenceFallback(observation: RuntimeTurnObservation, commandText: string): boolean {
  if (!observation.sawTerminalDone && !observation.sawTerminalFailure) return false;
  if (observation.sawGuiCompletion || observation.sawBrowserEvidenceRef) return false;
  if (observation.sawTerminalFailure && runtimeCommandNeedsBrowserEvidence(commandText)) return true;
  const text = observation.assistantText.join('').replace(/\s+/g, ' ').trim();
  if (looksLikeUnsupportedBrowserEvidenceAnswer(text, commandText)) return true;
  if (observation.sawToolLifecycle) return false;
  return looksLikeBrowserToolIntentOnlyText(text);
}

function runtimeCommandNeedsBrowserEvidence(commandText: string): boolean {
  const decision = evaluateBrowserEvidenceNeed({ prompt: userIntentTextFromCommandText(commandText) });
  return decision.decision === 'search' || decision.decision === 'open';
}

function looksLikeUnsupportedBrowserEvidenceAnswer(text: string, commandText: string): boolean {
  if (!runtimeCommandNeedsBrowserEvidence(commandText)) return false;
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  if (/(?:browser-host-session:|source-page-ref|page-text-ref)/i.test(compact)) return false;
  if (looksLikeBrowserToolIntentOnlyText(compact)) return true;
  if (compact.length < 180) return false;
  const claimsLookup = /(?:我(?:已经|已|来|将|会|尝试|正在|先|再|最后)?.{0,12}(?:搜索|检索|查询|查看|使用浏览器|使用 Browser)|(?:搜索|检索|查询|查看).{0,16}(?:结果|论文|文章|页面|API)|I(?:'ve| have| will| am| was)?.{0,20}(?:search|looked up|queried|browse)|(?:search|lookup|query|browser|Browser|API).{0,20}(?:result|paper|article|source))/iu.test(compact);
  const presentsExternalAnswer = /(?:标题|作者|链接|论文|文章|新增|今天|今日|最新|结果|来源|摘要|结论|paper|papers|article|articles|author|authors|title|titles|link|links|today|latest|recent|result|results|source|sources|summary|summar)/iu.test(compact);
  return claimsLookup && presentsExternalAnswer;
}

function looksLikeBrowserToolIntentOnlyText(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact || compact.length > 700) return false;
  if (/(?:https?:\/\/|browser-host-session:|source-page-ref|page-text-ref|arxiv\.org|doi\.org|artifact:|file:)/i.test(compact)) return false;
  const mentionsBrowser = /\bBrowser\b|\bbrowser\b|浏览器|内置浏览器/u.test(compact);
  if (!mentionsBrowser) return false;
  const intentVerb = /(?:使用|调用|通过|借助|打开|搜索|检索|查询|查找|浏览|读取|总结|我将|我会|准备|正在|将会|use|using|call|invoke|search|look\s*up|open|browse|read|summari[sz]e)/iu;
  const toolNoun = /(?:模块|工具|module|tool|bounded operation|executeBoundedOperation)/iu;
  const startsAsAction = /^(?:使用|调用|通过|借助|打开|搜索|检索|查询|查找|浏览|读取|总结|use|using|call|invoke|search|look\s*up|open|browse|read)\b/iu.test(compact);
  const firstPersonPlan = /(?:我(?:将|会|来|准备)|接下来|现在|I(?:'ll| will| am going to)|Let me)\s*(?:use|call|invoke|search|look\s*up|open|browse|使用|调用|搜索|检索|查询|打开|浏览)/iu.test(compact);
  return intentVerb.test(compact) && (toolNoun.test(compact) || startsAsAction || firstPersonPlan);
}

function defaultRuntimeBrowserBoundedOperationInvoker(input: {
  workspacePath: string;
}): CodexAgentHostBrowserBoundedOperationInvoker {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({ workspacePath: input.workspacePath }),
  }));
  return async (request): Promise<ModuleInvokeResult<BoundedOperationResultValue>> =>
    dispatcher.invoke(request) as Promise<ModuleInvokeResult<BoundedOperationResultValue>>;
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

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStringFields(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
