import type { GatewayRequest, ToolPayload, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';
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
import type {
  VSCodeCoWorkLiveDiagnosticResult,
} from './agent-host-vscode-cowork-live-diagnostic.js';

export interface ComputerUseNativeRouteInput {
  request: CodexAppServerStartTurnRequest;
  workspace: string;
  provider: string;
  model: string;
  profile: string;
  abortSignal?: AbortSignal;
  textEditAppiumMac2Client?: AppiumMac2WindowActionClient;
  currentVSCodeCoWorkLiveDiagnosticRunner?: CurrentVSCodeCoWorkLiveDiagnosticRunner;
  currentVSCodeCoWorkLiveDiagnosticOptions?: {
    activateCurrentVSCodeIfNeeded?: boolean;
  };
}

const NORMALIZED_SCHEMA_VERSION = 'sciforge.codex.normalized-event.v1' as const;
const CURRENT_VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV = 'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_LIVE_DIAGNOSTIC';
const UNSAFE_APPROVAL_REF_STRING_PATTERN = /(?:\bBearer\s+|\b(?:sk|rk|pk|ghp|github_pat)[_-]|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization|credential|providerPayload|data:[^,\s]+;base64,|https?:\/\/)/i;
const BASE64ISH_APPROVAL_REF_PATTERN = /^[A-Za-z0-9+/_=-]{160,}$/;

export type CurrentVSCodeCoWorkLiveDiagnosticRunner = (input: {
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
  authorizationProfileId?: string;
  runtimeIntent?: unknown;
  agentHostInput?: unknown;
  activateCurrentVSCodeIfNeeded?: boolean;
}) => Promise<VSCodeCoWorkLiveDiagnosticResult> | VSCodeCoWorkLiveDiagnosticResult;

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
  const rawLatestObservation = isRecord(observation?.vscodeCoWork) ? observation.vscodeCoWork : undefined;
  const latestObservation = structuredVSCodeCoWorkObservationFromHostInput(agentHostInput, observation, rawLatestObservation);
  if (!isCurrentVSCodeCoWorkHostInput(agentHostInput, target)) return undefined;
  const explicitHostBinding = isRecord(target?.vscodeCoWork) ? target.vscodeCoWork : undefined;
  const genericHostBinding = genericVSCodeCoWorkBindingFromHostInput(agentHostInput, target, latestObservation);
  const hostBinding = explicitHostBinding && genericHostBinding
    ? compactRecord({ ...genericHostBinding, ...explicitHostBinding })
    : explicitHostBinding ?? genericHostBinding;
  if (!hostBinding && !latestObservation) return undefined;
  const operation = stringField(hostBinding, 'operation');
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

function structuredVSCodeCoWorkObservationFromHostInput(
  agentHostInput: Record<string, unknown>,
  observation: Record<string, unknown> | undefined,
  rawLatestObservation: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!observation && !rawLatestObservation) return undefined;
  const refs = uniqueRouteStrings([
    ...safeHostInputRefs(observation?.refs),
    ...safeHostInputRefs(rawLatestObservation?.refs),
  ]);
  const sessionRefs = uniqueRouteStrings([
    ...refs,
    ...refsWithPrefix(safeHostInputRefs(agentHostInput.refs), ['window-action-session:', 'computer-use-session:']),
  ]);
  const windowRef = safeHostInputRef(rawLatestObservation?.windowRef, ['window:'])
    ?? firstRefWithPrefix(refs, ['window:']);
  if (!windowRef) return rawLatestObservation;

  return compactRecord({
    ...(rawLatestObservation ?? {}),
    windowRef,
    sessionRef: safeHostInputRef(rawLatestObservation?.sessionRef, ['window-action-session:', 'computer-use-session:'])
      ?? firstRefWithPrefix(sessionRefs, ['window-action-session:', 'computer-use-session:']),
    observationRef: safeHostInputRef(rawLatestObservation?.observationRef, ['observation:'])
      ?? firstRefWithPrefix(refs, ['observation:']),
    screenshotRef: safeHostInputRef(rawLatestObservation?.screenshotRef, ['image:'])
      ?? firstRefWithPrefix(refs, ['image:']),
    accessibilityRef: safeHostInputRef(rawLatestObservation?.accessibilityRef, ['accessibility:'])
      ?? firstRefWithPrefix(refs, ['accessibility:']),
    textRefs: nonEmptyRefs(uniqueRouteStrings([
      ...refsWithPrefix(safeHostInputRefs(rawLatestObservation?.textRefs), ['text:']),
      ...refsWithPrefix(refs, ['text:']),
    ])),
    elementRefs: nonEmptyRefs(uniqueRouteStrings([
      ...refsWithPrefix(safeHostInputRefs(rawLatestObservation?.elementRefs), ['element:']),
      ...refsWithPrefix(refs, ['element:']),
    ])),
    freshnessRef: safeHostInputRef(rawLatestObservation?.freshnessRef, ['freshness:'])
      ?? firstRefWithPrefix(refs, ['freshness:']),
    visibleFileRefs: nonEmptyRefs(uniqueRouteStrings([
      ...refsWithPrefix(safeHostInputRefs(rawLatestObservation?.visibleFileRefs), ['file-ref:']),
      ...refsWithPrefix(refs, ['file-ref:']),
    ])),
    nonUserFileScopeRef: safeHostInputRef(rawLatestObservation?.nonUserFileScopeRef, ['non-user-file-scope:']),
  });
}

function genericVSCodeCoWorkBindingFromHostInput(
  agentHostInput: Record<string, unknown>,
  target: Record<string, unknown> | undefined,
  latestObservation: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!target || !latestObservation) return undefined;
  const requestRef = firstRefWithPrefix(safeHostInputRefs(agentHostInput.refs), ['chat-request:']);
  const targetRefs = safeHostInputRefs(target.refs);
  const windowRefs = refsWithPrefix(targetRefs, ['window:']);
  const selectedWindowRef = selectedGenericWindowRef(windowRefs, latestObservation);
  if (!selectedWindowRef) return requestRef ? { requestRef } : undefined;
  const appRef = firstRefWithPrefix(targetRefs, ['macos-app:']);
  const processRef = firstRefWithPrefix(targetRefs, ['process:']);
  const titleRef = firstRefWithPrefix(targetRefs, ['text:']);
  const frontmostRef = firstRefWithPrefix(targetRefs, ['frontmost:']);
  if (!appRef || !processRef || !titleRef || !frontmostRef) return requestRef ? { requestRef } : undefined;
  const visibleFileRefs = refsWithPrefix(targetRefs, ['file-ref:']);
  return compactRecord({
    requestRef,
    selectedWindowRef,
    selectedFileRef: visibleFileRefs.length === 1 ? visibleFileRefs[0] : undefined,
    windowCandidates: [
      compactRecord({
        appRef,
        processRef,
        windowRef: selectedWindowRef,
        titleRef,
        frontmostRef,
        visibleFileRefs: visibleFileRefs.length ? visibleFileRefs : undefined,
      }),
    ],
  });
}

function selectedGenericWindowRef(
  windowRefs: string[],
  latestObservation: Record<string, unknown>,
): string | undefined {
  if (windowRefs.length !== 1) return undefined;
  const windowRef = windowRefs[0];
  const observationWindowRef = safeHostInputRef(latestObservation.windowRef, ['window:']);
  if (observationWindowRef && observationWindowRef !== windowRef) return undefined;
  return windowRef;
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
  const liveDiagnostic = await tryRunCurrentVSCodeCoWorkLiveDiagnostic(input, bridge);
  if (liveDiagnostic) {
    queue.push(operationEvent(metadata, 'Runtime Codex selected the current VSCode co-work live diagnostic runner.', 'running'));
    queue.push(doneEvent(metadata, liveDiagnostic));
    return true;
  }
  queue.push(doneEvent(metadata, bridge.payload));
  return true;
}

async function tryRunCurrentVSCodeCoWorkLiveDiagnostic(
  input: ComputerUseNativeRouteInput,
  bridge: ReturnType<typeof createVSCodeCoWorkChatBridge>,
): Promise<ToolPayload | undefined> {
  if (!bridge || bridge.decision.status !== 'ready' || bridge.decision.primitive !== 'observe') return undefined;
  const runner = currentVSCodeCoWorkLiveDiagnosticRunner(input);
  if (!runner) return undefined;
  const result = await runner({
    commandText: input.request.commandText,
    workspacePath: input.workspace,
    commandId: input.request.commandId,
    attemptId: input.request.attemptId,
    authorizationProfileId: stringField(input.request.agentHostInput, 'authorizationProfileId'),
    runtimeIntent: input.request.runtimeIntent,
    agentHostInput: input.request.agentHostInput,
    activateCurrentVSCodeIfNeeded: shouldActivateCurrentVSCodeForLiveDiagnostic(input),
  });
  return currentVSCodeCoWorkLiveDiagnosticPayload(result);
}

function shouldActivateCurrentVSCodeForLiveDiagnostic(input: ComputerUseNativeRouteInput): boolean | undefined {
  return input.currentVSCodeCoWorkLiveDiagnosticOptions?.activateCurrentVSCodeIfNeeded === true
    ? true
    : undefined;
}

function currentVSCodeCoWorkLiveDiagnosticRunner(input: ComputerUseNativeRouteInput): CurrentVSCodeCoWorkLiveDiagnosticRunner | undefined {
  return input.currentVSCodeCoWorkLiveDiagnosticRunner
    ?? (process.env[CURRENT_VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV] === '1'
      ? defaultCurrentVSCodeCoWorkLiveDiagnosticRunner
      : undefined);
}

async function defaultCurrentVSCodeCoWorkLiveDiagnosticRunner(input: Parameters<CurrentVSCodeCoWorkLiveDiagnosticRunner>[0]) {
  const { runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic } = await import('./agent-host-vscode-cowork-current-live-diagnostic.js');
  return runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic(input);
}

function currentVSCodeCoWorkLiveDiagnosticPayload(result: VSCodeCoWorkLiveDiagnosticResult): ToolPayload {
  const status = result.status;
  const evidenceRefs = safeHostInputRefs(result.evidenceRefs);
  const cleanupRefs = safeHostInputRefs(result.cleanupRefs);
  const primitiveChainObserved = safePrimitiveChain(result.primitiveChainObserved);
  const agentHostFinalAnswer = safeAgentHostFinalAnswer(result.agentHostFinalAnswer);
  const hostProducerEvidence = safeHostProducerEvidence(result);
  return compactRecord({
    status,
    message: result.message,
    claimType: 'computer-use-vscode-cowork-live-diagnostic',
    evidenceLevel: 'refs-first',
    reasoningTrace: 'Agent Host ran the current VSCode co-work live diagnostic only after Host-selected refs-first observe decision; Computer Use core did not infer or plan the task.',
    maturity: 'live-diagnostic',
    productReady: false,
    primitiveChainObserved,
    evidenceRefs,
    cleanupRefs,
    hostProducerEvidence,
    agentHostFinalAnswer,
    completionTruth: agentHostFinalAnswer?.completionTruth,
    claims: [{
      kind: 'computer-use-vscode-cowork-live-diagnostic',
      status,
      maturity: 'live-diagnostic',
      productReady: false,
      hostOwnsFinalAnswer: true,
      computerUseCorePlanning: false,
      primitiveChainObserved,
      supportingRefs: evidenceRefs.slice(0, 12),
      hostProducerEvidenceRefs: hostProducerEvidence?.evidenceRefs,
    }],
    uiManifest: [{
      kind: 'computer-use-vscode-cowork-live-diagnostic',
      status,
      maturity: 'live-diagnostic',
      productReady: false,
      refsOnly: true,
      cleanupRefs,
      hostProducerEvidenceRefs: hostProducerEvidence?.evidenceRefs,
    }],
    executionUnits: [{
      id: 'computer-use.current-vscode-cowork.live-diagnostic',
      tool: 'current-vscode-cowork-live-diagnostic',
      status: status === 'completed' ? 'done' : status,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved,
      outputRef: evidenceRefs[0],
      evidenceRefs,
      cleanupRefs,
      hostProducerEvidenceRefs: hostProducerEvidence?.evidenceRefs,
    }],
    artifacts: [],
    logs: [{
      level: 'info',
      code: 'current-vscode-cowork-live-diagnostic',
      status,
      evidenceRefs,
      cleanupRefs,
      hostProducerEvidenceRefs: hostProducerEvidence?.evidenceRefs,
    }],
  });
}

function safeHostProducerEvidence(result: VSCodeCoWorkLiveDiagnosticResult): Record<string, unknown> | undefined {
  const agentHostInput = safeAgentHostInputProducerEvidence(result.agentHostInput);
  const runtimeTruth = safeRuntimeTruthProducerEvidence(result.runtimeTruth);
  if (!agentHostInput && !runtimeTruth) return undefined;

  const agentHostInputRefs = refsFromRecord(agentHostInput, 'agentHostInputRefs');
  const targetRefs = uniqueRouteStrings([
    ...refsFromRecord(agentHostInput, 'targetRefs'),
    ...refsFromRecord(runtimeTruth, 'targetRefs'),
  ]);
  const observationRefs = uniqueRouteStrings([
    ...refsFromRecord(agentHostInput, 'observationRefs'),
    ...refsFromRecord(runtimeTruth, 'observationRefs'),
  ]);
  const permissionRefs = uniqueRouteStrings([
    ...refsFromRecord(agentHostInput, 'permissionRefs'),
    ...refsFromRecord(runtimeTruth, 'permissionRefs'),
  ]);
  const sessionReadyRefs = refsFromRecord(runtimeTruth, 'sessionReadyRefs');
  const inputLeaseRefs = refsFromRecord(runtimeTruth, 'inputLeaseRefs');
  const actorCursorRefs = refsFromRecord(runtimeTruth, 'actorCursorRefs');
  const adapterRefs = refsFromRecord(runtimeTruth, 'adapterRefs');
  const runtimeTruthRefs = refsFromRecord(runtimeTruth, 'runtimeTruthRefs');
  const evidenceRefs = uniqueRouteStrings([
    ...agentHostInputRefs,
    ...targetRefs,
    ...observationRefs,
    ...permissionRefs,
    ...sessionReadyRefs,
    ...inputLeaseRefs,
    ...actorCursorRefs,
    ...adapterRefs,
    ...runtimeTruthRefs,
  ]);

  return compactRecord({
    schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-live-producer-evidence.v1',
    source: 'codex-agent-host-vscode-cowork-live-diagnostic',
    targetKind: stringField(agentHostInput, 'targetKind'),
    operation: stringField(agentHostInput, 'operation'),
    agentHostInputRefs: nonEmptyRefs(agentHostInputRefs),
    targetRefs: nonEmptyRefs(targetRefs),
    observationRefs: nonEmptyRefs(observationRefs),
    permissionRefs: nonEmptyRefs(permissionRefs),
    sessionReadyRefs: nonEmptyRefs(sessionReadyRefs),
    inputLeaseRefs: nonEmptyRefs(inputLeaseRefs),
    actorCursorRefs: nonEmptyRefs(actorCursorRefs),
    adapterRefs: nonEmptyRefs(adapterRefs),
    runtimeTruthRefs: nonEmptyRefs(runtimeTruthRefs),
    evidenceRefs: nonEmptyRefs(evidenceRefs),
  });
}

function safeAgentHostInputProducerEvidence(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.codex-agent-host-input.v1') return undefined;
  const target = isRecord(value.target) ? value.target : undefined;
  const vscodeCoWork = isRecord(target?.vscodeCoWork) ? target.vscodeCoWork : undefined;
  const observation = isRecord(value.observation) ? value.observation : undefined;
  const permissions = isRecord(value.permissions) ? value.permissions : undefined;
  const agentHostInputRefs = safeHostInputRefs(value.refs);
  const targetRefs = safeHostInputRefs(target?.refs);
  const observationRefs = safeHostInputRefs(observation?.refs);
  const permissionRefs = uniqueRouteStrings([
    ...safeHostInputRefs(permissions?.refs),
    ...safeHostInputRefs(permissions?.permissionRefs),
  ]);
  const scopedExecutorRefs = safeHostInputRefs(permissions?.scopedExecutorRefs);
  const targetKind = target?.kind === 'current-vscode-cowork' ? 'current-vscode-cowork' : undefined;
  const operation = safeVSCodeCoWorkLiveOperation(vscodeCoWork?.operation);
  if (!targetKind && !operation && !agentHostInputRefs.length && !targetRefs.length && !observationRefs.length && !permissionRefs.length) {
    return undefined;
  }
  return compactRecord({
    targetKind,
    operation,
    agentHostInputRefs: nonEmptyRefs(agentHostInputRefs),
    targetRefs: nonEmptyRefs(targetRefs),
    observationRefs: nonEmptyRefs(observationRefs),
    permissionRefs: nonEmptyRefs(permissionRefs),
    scopedExecutorRefs: nonEmptyRefs(scopedExecutorRefs),
  });
}

function safeRuntimeTruthProducerEvidence(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.agent-host.runtime-truth.v1') return undefined;
  const target = isRecord(value.target) ? value.target : undefined;
  const observation = isRecord(value.observation) ? value.observation : undefined;
  const permissions = isRecord(value.permissions) ? value.permissions : undefined;
  const sessions = isRecord(value.sessions) ? value.sessions : undefined;
  const adapter = isRecord(value.adapter) ? value.adapter : undefined;
  const inputIsolation = isRecord(adapter?.inputIsolation) ? adapter.inputIsolation : undefined;
  const permissionRefs = uniqueRouteStrings([
    ...safeHostInputRefs(permissions?.refs),
    ...safeHostInputRefs(permissions?.permissionRefs),
  ]);
  const runtimeTruthRefs = safeHostInputRefs(value.refs);
  const targetRefs = safeHostInputRefs(target?.refs);
  const observationRefs = uniqueRouteStrings([
    ...safeHostInputRefs(observation?.refs),
    ...safeHostInputRefs(sessions?.observationRefs),
  ]);
  const sessionReadyRefs = safeHostInputRefs(sessions?.sessionReadyRefs);
  const inputLeaseRefs = uniqueRouteStrings([
    ...safeHostInputRefs(sessions?.inputLeaseRefs),
    ...safeHostInputRefs(inputIsolation?.refs).filter((ref) => ref.startsWith('scoped-input-lease:') || ref.startsWith('input-lease:')),
  ]);
  const actorCursorRefs = uniqueRouteStrings([
    ...safeHostInputRefs(sessions?.actorCursorRefs),
    ...safeHostInputRefs(inputIsolation?.refs).filter((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('actor-cursor:')),
  ]);
  const adapterRefs = safeHostInputRefs(adapter?.refs);
  if (
    !runtimeTruthRefs.length
    && !targetRefs.length
    && !observationRefs.length
    && !permissionRefs.length
    && !sessionReadyRefs.length
    && !inputLeaseRefs.length
    && !actorCursorRefs.length
    && !adapterRefs.length
  ) {
    return undefined;
  }
  return compactRecord({
    runtimeTruthRefs: nonEmptyRefs(runtimeTruthRefs),
    targetRefs: nonEmptyRefs(targetRefs),
    observationRefs: nonEmptyRefs(observationRefs),
    permissionRefs: nonEmptyRefs(permissionRefs),
    sessionReadyRefs: nonEmptyRefs(sessionReadyRefs),
    inputLeaseRefs: nonEmptyRefs(inputLeaseRefs),
    actorCursorRefs: nonEmptyRefs(actorCursorRefs),
    adapterRefs: nonEmptyRefs(adapterRefs),
  });
}

function safeVSCodeCoWorkLiveOperation(value: unknown): 'read-visible-text' | 'insert-draft' | undefined {
  return value === 'read-visible-text' || value === 'insert-draft' ? value : undefined;
}

function refsFromRecord(value: unknown, key: string): string[] {
  if (!isRecord(value)) return [];
  const refs = value[key];
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : [];
}

function nonEmptyRefs(refs: string[]): string[] | undefined {
  return refs.length ? refs : undefined;
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
      allowOpenAiRuntime: false,
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
    return sanitizePublicEvent(compactRecord({
      ...baseEvent(metadata, event.type),
      status: event.status,
      source: event.source,
      toolName: event.toolName,
      message: event.message,
      text: event.text,
      detail: event.detail,
      output: event.output,
    })) as Record<string, unknown>;
  }
  return sanitizePublicEvent(operationEvent(
    metadata,
    event.message ?? event.text ?? event.detail ?? event.type,
    event.status ?? 'running',
  )) as Record<string, unknown>;
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
  const status = statusFromPayload(payload);
  const hasHostFinalAnswer = hasHostOwnedFinalAnswerPayload(payload);
  const eventType = hasHostFinalAnswer ? 'done' : localEvidenceEventType(status);
  const projectedPayload = hasHostFinalAnswer ? payload : localEvidencePayload(payload);
  const message = hasHostFinalAnswer
    ? payload.message
    : localEvidenceMessage(status);
  return sanitizePublicEvent(compactRecord({
    ...baseEvent(metadata, eventType),
    ...projectedPayload,
    status: hasHostFinalAnswer ? status : localEvidenceStatus(status),
    message,
    text: message,
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    evidenceRefs: uniqueRouteStrings([...payloadRefs, ...metadata.evidenceRefs]),
  })) as Record<string, unknown>;
}

function hasHostOwnedFinalAnswerPayload(payload: ToolPayload): boolean {
  const value = (payload as unknown as Record<string, unknown>).agentHostFinalAnswer;
  return isRecord(value)
    && value.schemaVersion === 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1'
    && value.source === 'codex-agent-host-vscode-cowork-live-diagnostic'
    && value.hostOwnsFinalAnswer === true
    && value.computerUseCorePlanning === false;
}

function localEvidenceEventType(status: string | undefined): 'blocked' | 'partial' {
  return status === 'blocked' || status === 'needs-confirmation' || status === 'failed'
    ? 'blocked'
    : 'partial';
}

function localEvidenceStatus(status: string | undefined): string {
  if (status === 'blocked' || status === 'needs-confirmation' || status === 'failed') return status;
  return 'partial';
}

function localEvidenceMessage(status: string | undefined): string {
  if (status === 'blocked') return 'Computer Use native route returned refs-first blocked evidence; Agent Host final answer is required.';
  if (status === 'needs-confirmation') return 'Computer Use native route needs confirmation from refs-first evidence; Agent Host final answer is required.';
  return 'Computer Use native route returned refs-first partial evidence; Agent Host final answer is required.';
}

function localEvidencePayload(payload: ToolPayload): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as unknown as Record<string, unknown>)) {
    if (key === 'message' || key === 'text' || key === 'status' || key === 'agentHostFinalAnswer' || key === 'completionTruth' || key === 'taskOutcome') continue;
    if (key === 'executionUnits' && Array.isArray(value)) {
      output[key] = value.map(localEvidenceExecutionUnit);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function localEvidenceExecutionUnit(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const status = stringField(value, 'status');
  if (status !== 'done' && status !== 'completed') return value;
  return {
    ...value,
    status: 'partial',
  };
}

function failedEvent(metadata: RouteMetadata, message: string): Record<string, unknown> {
  return sanitizePublicEvent(compactRecord({
    ...baseEvent(metadata, 'failed'),
    status: 'failed',
    message,
    text: message,
  })) as Record<string, unknown>;
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

function safeHostInputRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueRouteStrings(value.map((item) => safeHostInputRef(item)).filter(nonEmptyString));
}

function firstRefWithPrefix(refs: string[], prefixes: string[]): string | undefined {
  return refs.find((ref) => prefixes.some((prefix) => ref.startsWith(prefix)));
}

function refsWithPrefix(refs: string[], prefixes: string[]): string[] {
  return refs.filter((ref) => prefixes.some((prefix) => ref.startsWith(prefix)));
}

function nonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function safeHostInputRef(value: unknown, prefixes?: string[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 500) return undefined;
  if (UNSAFE_APPROVAL_REF_STRING_PATTERN.test(text)) return undefined;
  if (BASE64ISH_APPROVAL_REF_PATTERN.test(text)) return undefined;
  if (!/^[a-z][a-z0-9_-]*:[^\s/\\]+$/i.test(text)) return undefined;
  if (prefixes && !prefixes.some((prefix) => text.startsWith(prefix))) return undefined;
  return text;
}

function safePrimitiveChain(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^(?:bind|observe|host-decision|act|control\(release\)|control|release)$/i.test(item));
}

function safeAgentHostFinalAnswer(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1') return undefined;
  if (value.source !== 'codex-agent-host-vscode-cowork-live-diagnostic') return undefined;
  if (value.hostOwnsFinalAnswer !== true) return undefined;
  if (value.computerUseCorePlanning !== false) return undefined;
  const status = liveDiagnosticStatus(value.status);
  if (!status) return undefined;
  const primitiveChainObserved = safePrimitiveChain(value.primitiveChainObserved);
  const evidenceRefs = safeHostInputRefs(value.evidenceRefs);
  const cleanupRefs = safeHostInputRefs(value.cleanupRefs);
  return compactRecord({
    schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
    source: 'codex-agent-host-vscode-cowork-live-diagnostic',
    status,
    text: safeDiagnosticText(value.text) ?? 'Host final answer text omitted because it was not refs-first safe.',
    maturity: 'live-diagnostic',
    productReady: false,
    hostOwnsFinalAnswer: value.hostOwnsFinalAnswer === true,
    computerUseCorePlanning: false,
    primitiveChainObserved,
    evidenceRefs,
    cleanupRefs,
    materializerClaimType: safeDiagnosticToken(value.materializerClaimType),
    completionTruth: safeCompletionTruth(value.completionTruth),
  });
}

function safeCompletionTruth(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.computer-use.completion-truth.v1') return undefined;
  const scope = value.scope === 'action' || value.scope === 'user-task' || value.scope === 'workflow'
    ? value.scope
    : undefined;
  const status = value.status === 'satisfied' || value.status === 'blocked' || value.status === 'needs-confirmation'
    ? value.status
    : undefined;
  if (!scope || !status) return undefined;
  return compactRecord({
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope,
    status,
    evidenceRefs: safeHostInputRefs(value.evidenceRefs),
    validator: safeDiagnosticToken(value.validator),
    reason: safeDiagnosticText(value.reason),
  });
}

function liveDiagnosticStatus(value: unknown): 'completed' | 'blocked' | 'needs-confirmation' | undefined {
  return value === 'completed' || value === 'blocked' || value === 'needs-confirmation'
    ? value
    : undefined;
}

function safeDiagnosticToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 120) return undefined;
  if (UNSAFE_APPROVAL_REF_STRING_PATTERN.test(text) || BASE64ISH_APPROVAL_REF_PATTERN.test(text)) return undefined;
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(text) ? text : undefined;
}

function safeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 600) return undefined;
  if (UNSAFE_APPROVAL_REF_STRING_PATTERN.test(text) || BASE64ISH_APPROVAL_REF_PATTERN.test(text)) return undefined;
  if (/raw-|product-ready|kill-vscode|clear-profile/i.test(text)) return undefined;
  return text;
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
