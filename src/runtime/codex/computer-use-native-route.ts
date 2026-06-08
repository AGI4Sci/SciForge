import type { GatewayRequest, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { COMPUTER_USE_ACTION_PROVIDER_ID } from '../computer-use/host-adapter.js';
import { VISION_TOOL_ID } from '../vision-sense/trace-policy.js';
import { evaluateCodexAgentHostTurnLoop } from './agent-host-turn-loop.js';
import type {
  CodexAppServerStartTurnRequest,
  CodexAppServerTurnStream,
} from './codex-app-server-adapter.js';
import type { AppiumMac2WindowActionClient } from './appium-mac2-window-action-adapter.js';
import { createTextEditWindowActionChatBridge } from './textedit-window-action-chat-bridge.js';
import { createVSCodeCoWorkChatBridge } from './vscode-cowork-chat-bridge.js';

export interface ComputerUseNativeRouteInput {
  request: CodexAppServerStartTurnRequest;
  workspace: string;
  provider: string;
  model: string;
  profile: string;
  abortSignal?: AbortSignal;
  textEditAppiumMac2Client?: AppiumMac2WindowActionClient;
}

const NORMALIZED_SCHEMA_VERSION = 'sciforge.codex.normalized-event.v1' as const;
const UNSAFE_APPROVAL_REF_STRING_PATTERN = /(?:\bBearer\s+|\b(?:sk|rk|pk|ghp|github_pat)[_-]|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization|credential|providerPayload|data:[^,\s]+;base64,|https?:\/\/)/i;
const BASE64ISH_APPROVAL_REF_PATTERN = /^[A-Za-z0-9+/_=-]{160,}$/;

export function isComputerUseNativeRouteCommand(commandText: string): boolean {
  const text = computerUseNativeRouteCommandText(commandText);
  if (!text) return false;
  return /^\/(?:computer-use|computer\s+use)\s+diagnostic\b/i.test(text);
}

export function computerUseNativeRouteCommandText(commandText: string): string | undefined {
  const text = commandText.trimStart();
  if (!/^\/(?:computer-use|computer\s+use)\b/i.test(text)) return undefined;
  return text.split(/\r?\n\s*\r?\n/, 1)[0]?.trim();
}

export function createComputerUseNativeRouteStream(input: ComputerUseNativeRouteInput): CodexAppServerTurnStream | undefined {
  const runtimeIntent = runtimeIntentForComputerUseNativeRoute(input.request);
  if (!isComputerUseNativeRouteCommand(input.request.commandText) && !runtimeIntent) {
    return undefined;
  }
  const routeInput = runtimeIntent && runtimeIntent !== input.request.runtimeIntent
    ? {
      ...input,
      request: {
        ...input.request,
        runtimeIntent,
      },
    }
    : input;
  const retiredVirtualAppScreenReason = retiredVirtualAppScreenNativeRouteReason(input.request.commandText);
  if (retiredVirtualAppScreenReason) {
    const metadata = routeMetadata(routeInput);
    return {
      turnId: routeInput.request.commandId,
      provider: routeInput.provider,
      model: routeInput.model,
      profile: routeInput.profile,
      workspacePath: routeInput.workspace,
      events: singleEventStream(failedEvent(metadata, retiredVirtualAppScreenReason)),
    };
  }
  return {
    turnId: routeInput.request.commandId,
    provider: routeInput.provider,
    model: routeInput.model,
    profile: routeInput.profile,
    workspacePath: routeInput.workspace,
    events: computerUseNativeRouteEvents(routeInput),
  };
}

async function* singleEventStream(event: Record<string, unknown>): AsyncIterable<Record<string, unknown>> {
  yield event;
}

function hasExplicitHostOwnedComputerUseNativeRouteIntent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'sciforge.runtime-codex.host-intent.v1'
    && value.kind === 'computer-use-native-route'
    && value.source === 'host-owned';
}

function runtimeIntentForComputerUseNativeRoute(request: CodexAppServerStartTurnRequest): CodexAppServerStartTurnRequest['runtimeIntent'] | undefined {
  if (hasExplicitHostOwnedComputerUseNativeRouteIntent(request.runtimeIntent)) {
    return request.runtimeIntent;
  }
  return vscodeCoWorkRuntimeIntentFromAgentHostInput(request);
}

function vscodeCoWorkRuntimeIntentFromAgentHostInput(request: CodexAppServerStartTurnRequest): CodexAppServerStartTurnRequest['runtimeIntent'] | undefined {
  const agentHostInput = isRecord(request.agentHostInput) ? request.agentHostInput : undefined;
  if (agentHostInput?.schemaVersion !== 'sciforge.codex-agent-host-input.v1') return undefined;
  const target = isRecord(agentHostInput.target) ? agentHostInput.target : undefined;
  const observation = isRecord(agentHostInput.observation) ? agentHostInput.observation : undefined;
  const permissions = isRecord(agentHostInput.permissions) ? agentHostInput.permissions : undefined;
  const hostBinding = isRecord(target?.vscodeCoWork) ? target.vscodeCoWork : undefined;
  const latestObservation = isRecord(observation?.vscodeCoWork) ? observation.vscodeCoWork : undefined;
  if (!hostBinding && !latestObservation) return undefined;
  if (!isCurrentVSCodeCoWorkHostInput(agentHostInput, target)) return undefined;
  const intentText = stringField(agentHostInput, 'intentText') ?? request.commandText;
  const operation = stringField(hostBinding, 'operation') ?? lowRiskVSCodeCoWorkOperationFromText(intentText);
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
    computerUseNext: {
      taskId: 'CU-NEXT-09',
      recommendedTargetMode: 'active-window',
      recommendedTargetApp: 'Visual Studio Code',
      semanticMarkers: ['current-vscode-cowork', 'refs-first'],
    },
    vscodeCoWork: compactRecord({
      ...(hostBinding ?? {}),
      operation,
      permissionRef: stringField(hostBinding, 'permissionRef') ?? firstPermissionRef(permissions?.refs),
      latestObservation: latestObservation ?? (isRecord(hostBinding?.latestObservation) ? hostBinding.latestObservation : undefined),
    }),
  };
}

function isCurrentVSCodeCoWorkHostInput(
  agentHostInput: Record<string, unknown>,
  target: Record<string, unknown> | undefined,
): boolean {
  if (stringField(target, 'kind') === 'current-vscode-cowork') return true;
  if (isRecord(target?.vscodeCoWork)) return true;
  const refs = Array.isArray(agentHostInput.refs) ? agentHostInput.refs : [];
  return refs.some((ref) => ref === 'intent:current-vscode-cowork');
}

function lowRiskVSCodeCoWorkOperationFromText(intentText: string): 'read-visible-text' | 'focus-editor' | undefined {
  if (/(?:读取|查看|看看|read|visible\s+text)/i.test(intentText)) return 'read-visible-text';
  if (/(?:聚焦|focus)/i.test(intentText)) return 'focus-editor';
  return undefined;
}

function retiredVirtualAppScreenNativeRouteReason(commandText: string): string | undefined {
  const text = computerUseNativeRouteCommandText(commandText);
  if (!text) return undefined;
  if (!/^\/(?:computer-use|computer\s+use)\s+screen\s+(?:attach|reconnect)\b/i.test(text)) return undefined;
  const usesVirtualAppScreenSurface = /(?:--source(?:=|\s+)(?:"right-pane-screen"|'right-pane-screen'|right-pane-screen)|virtual-app-screen:|gui\.present:|screen-activation)/i.test(text);
  if (!usesVirtualAppScreenSurface) return undefined;
  return 'VirtualAppScreen right pane screen attach/reconnect is retired from the default Computer Use native route; use Runtime Codex Computer Use bounded operations or image evidence refs instead.';
}

async function* computerUseNativeRouteEvents(input: ComputerUseNativeRouteInput): AsyncIterable<Record<string, unknown>> {
  const queue = new AsyncEventQueue<Record<string, unknown>>();
  const metadata = routeMetadata(input);
  const request = computerUseGatewayRequest(input);
  const run = runComputerUseNativeRoute(input, request, queue, metadata);
  try {
    for await (const event of queue) yield event;
    await run;
  } finally {
    input.abortSignal?.removeEventListener('abort', queue.abort);
  }
}

async function runComputerUseNativeRoute(
  input: ComputerUseNativeRouteInput,
  request: GatewayRequest,
  queue: AsyncEventQueue<Record<string, unknown>>,
  metadata: RouteMetadata,
) {
  const abort = () => queue.push(failedEvent(metadata, 'Runtime Codex Computer Use native route was cancelled.'));
  input.abortSignal?.addEventListener('abort', abort, { once: true });
  queue.abort = abort;
  try {
    queue.push(operationEvent(metadata, 'Runtime Codex selected the Computer Use native package bridge.', 'running'));
    if (await tryRunVSCodeCoWorkChatBridge(input, queue, metadata)) return;
    if (await tryRunTextEditWindowActionBridge(input, queue, metadata)) return;
    const { tryRunVisionSenseRuntime } = await import('../vision-sense-runtime.js');
    const payload = await tryRunVisionSenseRuntime(request, {
      signal: input.abortSignal,
      onEvent(event) {
        queue.push(workspaceRuntimeEvent(metadata, event));
      },
    });
    if (!payload) {
      queue.push(failedEvent(metadata, 'Computer Use native route did not select a package bridge runtime.'));
      return;
    }
    queue.push(doneEvent(metadata, payload));
  } catch (error) {
    queue.push(failedEvent(metadata, error instanceof Error ? error.message : String(error)));
  } finally {
    input.abortSignal?.removeEventListener('abort', abort);
    queue.end();
  }
}

async function tryRunVSCodeCoWorkChatBridge(
  input: ComputerUseNativeRouteInput,
  queue: AsyncEventQueue<Record<string, unknown>>,
  metadata: RouteMetadata,
): Promise<boolean> {
  const bridge = createVSCodeCoWorkChatBridge({
    runtimeIntent: input.request.runtimeIntent,
    commandId: input.request.commandId,
    attemptId: input.request.attemptId,
  });
  if (!bridge) return false;
  queue.push(operationEvent(metadata, 'Runtime Codex selected the VSCode co-work Host bridge.', 'running'));
  queue.push(doneEvent(metadata, bridge.payload));
  return true;
}

async function tryRunTextEditWindowActionBridge(
  input: ComputerUseNativeRouteInput,
  queue: AsyncEventQueue<Record<string, unknown>>,
  metadata: RouteMetadata,
): Promise<boolean> {
  const commandText = computerUseNativeRouteCommandText(input.request.commandText) ?? input.request.commandText;
  const bridge = createTextEditWindowActionChatBridge({
    commandText,
    workspacePath: input.workspace,
    env: process.env,
    appiumMac2Client: input.textEditAppiumMac2Client,
  });
  if (!bridge) return false;
  queue.push(operationEvent(metadata, 'Runtime Codex selected the TextEdit WindowActionSession bridge.', 'running'));
  const turn = await evaluateCodexAgentHostTurnLoop({
    input: input.request.agentHostInput ?? ordinaryChatAgentHostInput(commandText),
    commandText,
    workspacePath: input.workspace,
    commandId: input.request.commandId,
    attemptId: input.request.attemptId,
    runtimeTruth: bridge.runtimeTruth,
    computerUseActMaterializer: bridge.computerUseActMaterializer,
    abortSignal: input.abortSignal,
  });
  if (!turn) return false;
  queue.push(doneEvent(metadata, turn.result as unknown as ToolPayload));
  return true;
}

function ordinaryChatAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ordinary-chat',
    intentText,
    singleTurnOverride: false,
    refs: [],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

export function computerUseGatewayRequest(input: ComputerUseNativeRouteInput): GatewayRequest {
  const commandText = computerUseNativeRouteCommandText(input.request.commandText) ?? input.request.commandText;
  const approvalRef = firstSafeApprovalRef([
    approvalRefFromCommandText(commandText),
    stringField(input.request.humanApproval, 'approvalRef'),
    stringField(input.request.uiState, 'approvalRef'),
    stringField(input.request.uiState, 'computerUseApprovalRef'),
  ]);
  const computerUseNext = sanitizeComputerUseNextBinding(input.request.runtimeIntent?.computerUseNext);
  const computerUseLong = sanitizeComputerUseLongBinding(input.request.runtimeIntent?.computerUseLong);
  return {
    skillDomain: 'knowledge',
    prompt: commandText,
    handoffSource: 'ui-chat',
    workspacePath: input.workspace,
    artifacts: [],
    references: [],
    selectedToolIds: [VISION_TOOL_ID],
    selectedSenseIds: [VISION_TOOL_ID],
    selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
    expectedEvidenceKinds: [
      'computer-use-tui-host-actions',
      'vision-trace',
      'computer-use-primitive-session',
      'primitive-trace',
    ],
    uiState: {
      schemaVersion: 'sciforge.runtime-codex.computer-use-native-route.v1',
      selectedToolIds: [VISION_TOOL_ID],
      selectedSenseIds: [VISION_TOOL_ID],
      selectedActionIds: [COMPUTER_USE_ACTION_PROVIDER_ID],
      allowOpenAiRuntime: input.request.allowOpenAiRuntime === true,
      entrypoint: 'runtime-codex-commandText',
      terminalEquivalentText: true,
      computerUseApprovalRef: approvalRef,
      ...(computerUseNext ? { computerUseNext } : {}),
      ...(computerUseLong ? { computerUseLong } : {}),
    },
    humanApproval: approvalRef ? {
      approvalRef,
      decision: 'approved',
      source: 'runtime-codex-commandText',
    } : undefined,
  };
}

function sanitizeComputerUseNextBinding(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    taskId: stringField(value, 'taskId'),
    scenarioId: stringField(value, 'scenarioId'),
    title: stringField(value, 'title'),
    requirements: stringListField(value.requirements),
    recommendedTargetMode: stringField(value, 'recommendedTargetMode'),
    recommendedTargetApp: stringField(value, 'recommendedTargetApp'),
    recommendedMaxSteps: numberField(value, 'recommendedMaxSteps'),
    semanticMarkers: stringListField(value.semanticMarkers),
    safetyBoundary: booleanRecord(value.safetyBoundary),
  });
}

function sanitizeComputerUseLongBinding(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return nonEmptyRecord({
    taskId: stringField(value, 'taskId'),
    scenarioId: stringField(value, 'scenarioId'),
    title: stringField(value, 'title'),
    requirements: stringListField(value.requirements),
    recommendedTargetMode: stringField(value, 'recommendedTargetMode'),
    recommendedTargetApp: stringField(value, 'recommendedTargetApp'),
    recommendedMaxSteps: numberField(value, 'recommendedMaxSteps'),
    semanticMarkers: stringListField(value.semanticMarkers),
    safetyBoundary: booleanRecord(value.safetyBoundary),
  });
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
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

function workspaceRuntimeEvent(metadata: RouteMetadata, event: WorkspaceRuntimeEvent): Record<string, unknown> {
  if (event.type === 'computer-use.tui-host-actions') {
    return compactRecord({
      ...baseEvent(metadata, event.type),
      status: event.status,
      source: event.source,
      toolName: event.toolName,
      message: event.message,
      text: event.text,
      detail: event.detail,
      output: event.output,
    });
  }
  return operationEvent(
    metadata,
    event.message ?? event.text ?? event.detail ?? event.type,
    event.status ?? 'running',
  );
}

function operationEvent(
  metadata: RouteMetadata,
  message: string,
  status: string,
): Record<string, unknown> {
  return compactRecord({
    ...baseEvent(metadata, 'operation_progress'),
    status,
    message,
    text: message,
  });
}

function doneEvent(metadata: RouteMetadata, payload: ToolPayload): Record<string, unknown> {
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const payloadRefs = Array.isArray(payloadRecord.evidenceRefs)
    ? (payloadRecord.evidenceRefs as unknown[]).filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
    : [];
  return compactRecord({
    ...baseEvent(metadata, 'done'),
    ...payload,
    status: statusFromPayload(payload),
    message: payload.message,
    text: payload.message,
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    evidenceRefs: uniqueRouteStrings([...payloadRefs, ...metadata.evidenceRefs]),
  });
}

function failedEvent(metadata: RouteMetadata, message: string): Record<string, unknown> {
  return compactRecord({
    ...baseEvent(metadata, 'failed'),
    status: 'failed',
    message,
    text: message,
  });
}

function statusFromPayload(payload: ToolPayload) {
  const status = stringField(payload, 'status') ?? firstExecutionUnitStatus(payload);
  return status ?? 'done';
}

function firstExecutionUnitStatus(payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  for (const unit of units) {
    const status = stringField(unit, 'status');
    if (status) return status;
  }
  return undefined;
}

interface RouteMetadata {
  commandId: string;
  attemptId: string;
  evidenceRefs: string[];
}

function routeMetadata(input: ComputerUseNativeRouteInput): RouteMetadata {
  return {
    commandId: input.request.commandId,
    attemptId: input.request.attemptId,
    evidenceRefs: [
      `audit:codex-app-server:${input.request.commandId}:${input.request.attemptId}:normalized-events`,
      `audit:computer-use-native-route:${input.request.commandId}:${input.request.attemptId}`,
    ],
  };
}

function baseEvent(metadata: RouteMetadata, type: string) {
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    type,
    timestamp: new Date().toISOString(),
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    evidenceRefs: metadata.evidenceRefs,
  };
}

function approvalRefFromCommandText(commandText: string): string | undefined {
  const match = /(?:^|\s)--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(commandText);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value?.trim() || undefined;
}

function firstSafeApprovalRef(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const ref = safeApprovalRef(value);
    if (ref) return ref;
  }
  return undefined;
}

function safeApprovalRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 500) return undefined;
  if (UNSAFE_APPROVAL_REF_STRING_PATTERN.test(text)) return undefined;
  if (BASE64ISH_APPROVAL_REF_PATTERN.test(text)) return undefined;
  return text;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function uniqueRouteStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stringField(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function firstPermissionRef(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => (
    typeof item === 'string'
    && /^permission:[^\s/\\]+$/i.test(item.trim())
  ))?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;
  abort: () => void = () => {};

  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
