import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  type ComputerUseActOutput,
  type ComputerUseAtomicAction,
  type ComputerUseBindOutput,
  type ComputerUseControlOutput,
  type ComputerUseObserveOutput,
  type ComputerUsePrimitiveEnvelope,
  type ComputerUsePrimitiveService,
  type ComputerUseTargetBinding,
} from '../../../packages/actions/computer-use/index.js';
import {
  authorizationProfileOrDefault,
  type ComputerUsePreflightResult,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import {
  createDefaultVSCodeCoWorkComputerUseActMaterializer,
} from './agent-host-vscode-cowork-act-materializer.js';
import type {
  CodexAgentHostComputerUseActMaterializerResult,
  CodexAgentHostComputerUseCompletionTruth,
  CodexAgentHostRuntimeTruth,
  NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';

type VSCodeCoWorkLiveDiagnosticStatus = 'completed' | 'blocked' | 'needs-confirmation';

export interface VSCodeCoWorkLiveDiagnosticInput {
  service: ComputerUsePrimitiveService;
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
  target: ComputerUseTargetBinding;
  authorizationProfileId?: string;
}

export interface VSCodeCoWorkInsertDraftLiveDiagnosticInput extends VSCodeCoWorkLiveDiagnosticInput {
  draftTextRef: string;
}

export interface VSCodeCoWorkLiveDiagnosticResult {
  status: VSCodeCoWorkLiveDiagnosticStatus;
  message: string;
  maturity: 'live-diagnostic';
  productReady: false;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  cleanupRefs: string[];
  agentHostInput?: NormalizedCodexAgentHostInput;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  materializerResult?: CodexAgentHostComputerUseActMaterializerResult;
  agentHostFinalAnswer?: VSCodeCoWorkAgentHostFinalAnswer;
}

export interface VSCodeCoWorkAgentHostFinalAnswer {
  schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1';
  source: 'codex-agent-host-vscode-cowork-live-diagnostic';
  status: VSCodeCoWorkLiveDiagnosticStatus;
  text: string;
  maturity: 'live-diagnostic';
  productReady: false;
  hostOwnsFinalAnswer: true;
  computerUseCorePlanning: false;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  cleanupRefs: string[];
  materializerClaimType?: string;
  completionTruth?: CodexAgentHostComputerUseCompletionTruth;
}

type PrimitiveEnvelope<T> = ComputerUsePrimitiveEnvelope<T>;

export async function runVSCodeCoWorkReadVisibleTextLiveDiagnostic(
  input: VSCodeCoWorkLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const aggregate = liveAggregate();
  let sessionId: string | undefined;
  let bindOutput: ComputerUseBindOutput | undefined;
  let agentHostInput: NormalizedCodexAgentHostInput | undefined;
  let runtimeTruth: CodexAgentHostRuntimeTruth | undefined;
  let materializerResult: CodexAgentHostComputerUseActMaterializerResult | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticStatus,
    message: string,
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) await releaseSession(input.service, sessionId, aggregate);
    const evidenceRefs = runtimeOwnedLiveRefs(aggregate.evidenceRefs);
    const cleanupRefs = runtimeOwnedLiveRefs(aggregate.cleanupRefs);
    const primitiveChainObserved = [...aggregate.primitiveChainObserved];
    const agentHostFinalAnswer = buildAgentHostFinalAnswer({
      status,
      message,
      primitiveChainObserved,
      evidenceRefs,
      cleanupRefs,
      materializerResult,
    });
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved,
      evidenceRefs,
      cleanupRefs,
      ...(agentHostInput ? { agentHostInput } : {}),
      ...(runtimeTruth ? { runtimeTruth } : {}),
      ...(materializerResult ? { materializerResult } : {}),
      agentHostFinalAnswer,
    };
  };

  const bind = await invokePrimitive<ComputerUseBindOutput>(input.service, COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
    target: input.target,
  });
  aggregate.primitiveChainObserved.push('bind');
  mergeRefs(aggregate.evidenceRefs, bind.refs ?? []);
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    mergeRefs(aggregate.cleanupRefs, cleanupRefsFromPrimitive(bind.refs ?? []));
    return finish('blocked', bind.blockedReason ?? 'VSCode co-work live diagnostic blocked: bind did not produce a session.');
  }
  bindOutput = bind.output;
  sessionId = bind.output.sessionId;

  const beforeObserve = await observeSession(input.service, sessionId, aggregate);
  if (beforeObserve.status !== 'completed' || !beforeObserve.output) {
    return finish('blocked', beforeObserve.blockedReason ?? 'VSCode co-work live diagnostic blocked: before observe failed.');
  }

  agentHostInput = buildAgentHostInput(input, bindOutput, bind.refs ?? [], beforeObserve);
  runtimeTruth = buildRuntimeTruth(input, bindOutput, bind.refs ?? [], beforeObserve, agentHostInput);
  const materializer = createDefaultVSCodeCoWorkComputerUseActMaterializer();
  materializerResult = await materializer({
    agentHostInput,
    preflight: readyPreflight(input, agentHostInput, runtimeTruth),
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    runtimeTruth,
  });
  aggregate.primitiveChainObserved.push('host-decision');
  mergeRefs(aggregate.evidenceRefs, materializerResult?.evidenceRefs ?? []);
  const decisionRef = `decision:vscode-cowork:${safeToken(input.attemptId) || 'attempt'}:read-visible-text`;
  aggregate.evidenceRefs.push(decisionRef);

  if (!materializerResult) {
    return finish('blocked', 'VSCode co-work live diagnostic blocked: Host decision materializer returned no result.');
  }
  if (materializerResult.status !== 'completed') {
    return finish(materializerResult.status, materializerResult.message);
  }
  const selectedPrimitive = materializerResult.executionUnits?.find((unit) => unit.tool === 'vscode-cowork.agent-host-producer')?.primitive;
  if (selectedPrimitive !== 'observe') {
    return finish('blocked', 'VSCode co-work live diagnostic blocked: Host did not select a refs-only observe primitive.');
  }

  const selectedObserve = await observeSession(input.service, sessionId, aggregate);
  if (selectedObserve.status !== 'completed' || !selectedObserve.output) {
    return finish('blocked', selectedObserve.blockedReason ?? 'VSCode co-work live diagnostic blocked: selected observe primitive failed.');
  }
  runtimeTruth = buildRuntimeTruth(input, bindOutput, bind.refs ?? [], selectedObserve, agentHostInput);

  return finish('completed', 'VSCode co-work live diagnostic completed a refs-only read-visible-text primitive and released input resources.');
}

export async function runVSCodeCoWorkInsertDraftLiveDiagnostic(
  input: VSCodeCoWorkInsertDraftLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const aggregate = liveAggregate();
  let sessionId: string | undefined;
  let bindOutput: ComputerUseBindOutput | undefined;
  let agentHostInput: NormalizedCodexAgentHostInput | undefined;
  let runtimeTruth: CodexAgentHostRuntimeTruth | undefined;
  let materializerResult: CodexAgentHostComputerUseActMaterializerResult | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticStatus,
    message: string,
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) await releaseSession(input.service, sessionId, aggregate);
    const evidenceRefs = runtimeOwnedLiveRefs(aggregate.evidenceRefs);
    const cleanupRefs = runtimeOwnedLiveRefs(aggregate.cleanupRefs);
    const primitiveChainObserved = [...aggregate.primitiveChainObserved];
    const agentHostFinalAnswer = buildAgentHostFinalAnswer({
      status,
      message,
      primitiveChainObserved,
      evidenceRefs,
      cleanupRefs,
      materializerResult,
    });
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved,
      evidenceRefs,
      cleanupRefs,
      ...(agentHostInput ? { agentHostInput } : {}),
      ...(runtimeTruth ? { runtimeTruth } : {}),
      ...(materializerResult ? { materializerResult } : {}),
      agentHostFinalAnswer,
    };
  };

  const bind = await invokePrimitive<ComputerUseBindOutput>(input.service, COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
    target: input.target,
  });
  aggregate.primitiveChainObserved.push('bind');
  mergeRefs(aggregate.evidenceRefs, bind.refs ?? []);
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    mergeRefs(aggregate.cleanupRefs, cleanupRefsFromPrimitive(bind.refs ?? []));
    return finish('blocked', bind.blockedReason ?? 'VSCode co-work insert-draft live diagnostic blocked: bind did not produce a session.');
  }
  bindOutput = bind.output;
  sessionId = bind.output.sessionId;

  const beforeObserve = await observeSession(input.service, sessionId, aggregate);
  if (beforeObserve.status !== 'completed' || !beforeObserve.output) {
    return finish('blocked', beforeObserve.blockedReason ?? 'VSCode co-work insert-draft live diagnostic blocked: before observe failed.');
  }

  agentHostInput = buildAgentHostInput(input, bindOutput, bind.refs ?? [], beforeObserve, {
    operation: 'insert-draft',
    draftTextRef: input.draftTextRef,
  });
  runtimeTruth = buildRuntimeTruth(input, bindOutput, bind.refs ?? [], beforeObserve, agentHostInput);
  const materializer = createDefaultVSCodeCoWorkComputerUseActMaterializer();
  materializerResult = await materializer({
    agentHostInput,
    preflight: readyPreflight(input, agentHostInput, runtimeTruth),
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    runtimeTruth,
  });
  aggregate.primitiveChainObserved.push('host-decision');
  mergeRefs(aggregate.evidenceRefs, materializerResult?.evidenceRefs ?? []);
  const decisionRef = `decision:vscode-cowork:${safeToken(input.attemptId) || 'attempt'}:insert-draft`;
  aggregate.evidenceRefs.push(decisionRef, input.draftTextRef);

  if (!materializerResult) {
    return finish('blocked', 'VSCode co-work insert-draft live diagnostic blocked: Host decision materializer returned no result.');
  }
  if (materializerResult.status !== 'completed') {
    return finish(materializerResult.status, materializerResult.message);
  }
  const hostUnit = materializerResult.executionUnits?.find((unit) => unit.tool === 'vscode-cowork.agent-host-producer');
  if (hostUnit?.primitive !== 'act') {
    return finish('blocked', 'VSCode co-work insert-draft live diagnostic blocked: Host did not select a refs-first act primitive.');
  }
  const action = isComputerUseAtomicAction(hostUnit.action) ? hostUnit.action : undefined;
  if (!action) {
    return finish('blocked', 'VSCode co-work insert-draft live diagnostic blocked: Host act decision did not include a valid atomic action.');
  }

  const act = await actSession(input.service, sessionId, action, aggregate);
  if (act.status !== 'completed' || !act.output) {
    return finish('blocked', act.blockedReason ?? 'VSCode co-work insert-draft live diagnostic blocked: selected act primitive failed.');
  }

  const afterObserve = await observeSession(input.service, sessionId, aggregate);
  if (afterObserve.status !== 'completed' || !afterObserve.output) {
    return finish('blocked', afterObserve.blockedReason ?? 'VSCode co-work insert-draft live diagnostic blocked: after observe failed.');
  }
  runtimeTruth = buildRuntimeTruth(input, bindOutput, bind.refs ?? [], afterObserve, agentHostInput);
  materializerResult = {
    ...materializerResult,
    completionTruth: {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'action',
      status: 'satisfied',
      validator: 'vscode-cowork-insert-draft-live-diagnostic',
      evidenceRefs: runtimeOwnedLiveRefs([
        ...(materializerResult.evidenceRefs ?? []),
        ...(act.refs ?? []),
        ...(afterObserve.refs ?? []),
      ]),
    },
  };

  return finish('completed', 'VSCode co-work live diagnostic completed one refs-first insert-draft act primitive, observed after state, and released input resources.');
}

async function observeSession(
  service: ComputerUsePrimitiveService,
  sessionId: string,
  aggregate: LiveAggregate,
): Promise<PrimitiveEnvelope<ComputerUseObserveOutput>> {
  const observed = await invokePrimitive<ComputerUseObserveOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
    sessionId,
    capture: 'both',
    includeTree: true,
  });
  aggregate.primitiveChainObserved.push('observe');
  mergeRefs(aggregate.evidenceRefs, observed.refs ?? []);
  return observed;
}

async function actSession(
  service: ComputerUsePrimitiveService,
  sessionId: string,
  action: ComputerUseAtomicAction,
  aggregate: LiveAggregate,
): Promise<PrimitiveEnvelope<ComputerUseActOutput>> {
  const acted = await invokePrimitive<ComputerUseActOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.act, {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
    sessionId,
    actionId: 'insert-draft',
    action,
    captureAfter: true,
  });
  aggregate.primitiveChainObserved.push('act');
  mergeRefs(aggregate.evidenceRefs, [
    ...(acted.refs ?? []),
    acted.output?.actionRef,
    acted.output?.executorEventRef,
    acted.output?.inputEventRef,
    acted.output?.beforeObservationRef,
    acted.output?.afterObservationRef,
    ...(acted.output?.invalidatedRefs ?? []),
  ]);
  return acted;
}

async function releaseSession(
  service: ComputerUsePrimitiveService,
  sessionId: string,
  aggregate: LiveAggregate,
): Promise<void> {
  const released = await invokePrimitive<ComputerUseControlOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.control, {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
    sessionId,
    command: 'release',
  });
  aggregate.primitiveChainObserved.push('control(release)');
  mergeRefs(aggregate.evidenceRefs, released.refs ?? []);
  mergeRefs(aggregate.cleanupRefs, [
    ...(released.refs ?? []),
    ...(released.output?.releasedRefs ?? []),
  ]);
}

function buildAgentHostInput(
  input: VSCodeCoWorkLiveDiagnosticInput,
  bindOutput: ComputerUseBindOutput,
  bindRefs: string[],
  observe: PrimitiveEnvelope<ComputerUseObserveOutput>,
  options: {
    operation?: 'insert-draft';
    draftTextRef?: string;
  } = {},
): NormalizedCodexAgentHostInput {
  const requestRef = `chat-request:vscode-cowork:${safeToken(input.commandId) || 'command'}:${safeToken(input.attemptId) || 'attempt'}`;
  const targetRefs = targetRefsFromLive(input, bindOutput, bindRefs, observe.refs ?? []);
  const observationRefs = observationRefsFromLive(bindOutput, observe);
  const permissionRef = permissionRefFromLive(targetRefs, observationRefs);
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'vscode-cowork-live-diagnostic',
    intentText: input.commandText,
    authorizationProfileId: input.authorizationProfileId ?? 'high-autonomy',
    singleTurnOverride: false,
    refs: runtimeOwnedLiveRefs([
      'intent:current-vscode-cowork',
      requestRef,
      ...targetRefs,
      ...observationRefs,
      options.draftTextRef,
      ...(permissionRef ? [permissionRef] : []),
    ]),
    readiness: {},
    target: {
      kind: 'current-vscode-cowork',
      refs: targetRefs,
      vscodeCoWork: compactRecord({
        operation: options.operation,
        draftTextRef: options.draftTextRef,
        refs: runtimeOwnedLiveRefs([options.draftTextRef]),
      }),
    },
    observation: {
      fresh: true,
      refs: observationRefs,
    },
    permissions: {
      refs: permissionRef ? [permissionRef] : [],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function buildRuntimeTruth(
  input: VSCodeCoWorkLiveDiagnosticInput,
  bindOutput: ComputerUseBindOutput,
  bindRefs: string[],
  observe: PrimitiveEnvelope<ComputerUseObserveOutput>,
  agentHostInput: NormalizedCodexAgentHostInput,
): CodexAgentHostRuntimeTruth {
  const targetRefs = targetRefsFromLive(input, bindOutput, bindRefs, observe.refs ?? []);
  const observationRefs = observationRefsFromLive(bindOutput, observe);
  const permissionRefs = stringList(agentHostInput.permissions.refs);
  const sessionReadyRefs = runtimeOwnedLiveRefs([
    bindOutput.sessionRef,
    bindOutput.windowActionSessionRef,
    bindOutput.inputAdapterRef,
    bindOutput.cursorRef,
    bindOutput.scopedInputLeaseRef,
  ]);
  return {
    schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
    source: 'vscode-cowork-live-diagnostic',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Current VSCode co-work window',
      refs: targetRefs,
    },
    observation: {
      fresh: true,
      refs: observationRefs,
      observedAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      freshnessCheckedAt: new Date().toISOString(),
      freshnessCheck: {
        status: 'current',
        observedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        maxAgeMs: 30_000,
      },
    },
    permissions: {
      refs: permissionRefs,
      permissionRefs,
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
    sessions: {
      sessionReadyRefs,
      targetRefs,
      actorCursorRefs: runtimeOwnedLiveRefs([bindOutput.cursorRef]),
      inputLeaseRefs: runtimeOwnedLiveRefs([bindOutput.scopedInputLeaseRef]),
      observationRefs,
    },
    adapter: {
      providerId: 'sciforge.vscode-cowork.live-diagnostic',
      refs: runtimeOwnedLiveRefs([bindOutput.inputAdapterRef]),
      capabilityRefs: ['runtime-truth:computer-use-capability/current-vscode-cowork'],
      inputIsolation: {
        mode: 'shared-system-input-live-diagnostic',
        refsOnly: true,
        sharedSystemInput: true,
        requiresFocusLease: true,
        singleInteractiveTruth: true,
        refs: runtimeOwnedLiveRefs([bindOutput.scopedInputLeaseRef, bindOutput.inputAdapterRef, bindOutput.cursorRef]),
      },
    },
    refs: runtimeOwnedLiveRefs([
      'intent:current-vscode-cowork',
      ...agentHostInput.refs,
      ...targetRefs,
      ...observationRefs,
      ...permissionRefs,
      ...sessionReadyRefs,
    ]),
  };
}

function targetRefsFromLive(
  input: VSCodeCoWorkLiveDiagnosticInput,
  bindOutput: ComputerUseBindOutput,
  bindRefs: string[],
  observeRefs: string[],
): string[] {
  return runtimeOwnedLiveRefs([
    input.target.appRef,
    input.target.windowRef,
    input.target.targetRef,
    bindOutput.targetRef,
    bindOutput.windowActionSessionRef,
    ...bindRefs,
    ...observeRefs.filter((ref) => /^(?:macos-app:|process:|window:|text:title:|frontmost:|file-ref:|window-action-session:)/i.test(ref)),
  ]);
}

function observationRefsFromLive(
  bindOutput: ComputerUseBindOutput,
  observe: PrimitiveEnvelope<ComputerUseObserveOutput>,
): string[] {
  return runtimeOwnedLiveRefs([
    bindOutput.sessionRef,
    bindOutput.windowActionSessionRef,
    observe.output?.observationRef,
    observe.output?.screenshotRef,
    observe.output?.accessibilityRef,
    ...(observe.output?.textRefs ?? []),
    ...(observe.output?.elementRefs ?? []),
    ...(observe.refs ?? []).filter((ref) =>
      /^(?:computer-use-session:|window-action-session:|window:|observation:|image:|accessibility:|text:|element:|freshness:|file-ref:)/i.test(ref)
    ),
  ]);
}

function permissionRefFromLive(targetRefs: string[], observationRefs: string[]): string | undefined {
  const sessionRef = firstRefWithPrefix([...observationRefs, ...targetRefs], ['window-action-session:', 'computer-use-session:']);
  const fileRef = firstRefWithPrefix([...observationRefs, ...targetRefs], ['file-ref:']);
  if (!sessionRef || !fileRef) return undefined;
  return `permission:current-vscode-cowork:full-access:${sessionRef}:${fileRef}`;
}

function readyPreflight(
  input: VSCodeCoWorkLiveDiagnosticInput,
  agentHostInput: NormalizedCodexAgentHostInput,
  runtimeTruth: CodexAgentHostRuntimeTruth,
): ComputerUsePreflightResult {
  const authorizationProfile = authorizationProfileOrDefault(input.authorizationProfileId ?? agentHostInput.authorizationProfileId).profile;
  return {
    schemaVersion: 'sciforge.computer-use.preflight.v1',
    status: 'ready',
    authorizationProfile,
    target: {
      summary: runtimeTruth.target?.summary ?? 'Current VSCode co-work window',
      refs: runtimeTruth.target?.refs ?? [],
    },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    guardRefs: {
      observationRefs: runtimeTruth.observation?.refs ?? [],
      permissionRefs: runtimeTruth.permissions?.refs ?? [],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
    },
    evidenceRefs: runtimeOwnedLiveRefs([
      ...(runtimeTruth.target?.refs ?? []),
      ...(runtimeTruth.observation?.refs ?? []),
      ...(runtimeTruth.permissions?.refs ?? []),
    ]),
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'refs-only VSCode visible text observation is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}

async function invokePrimitive<T>(
  service: ComputerUsePrimitiveService,
  intent: string,
  primitiveInput: Record<string, unknown>,
): Promise<PrimitiveEnvelope<T>> {
  const result = await service.invoke({
    moduleId: 'computer_use',
    intent,
    input: primitiveInput,
  });
  if (result.value) return result.value as PrimitiveEnvelope<T>;
  if (!result.ok || !result.value) {
    return {
      schemaVersion: 'sciforge.computer-use.primitive-result.v1',
      moduleId: 'computer_use',
      primitive: intent === COMPUTER_USE_PRIMITIVE_INTENTS.bind
        ? 'bind'
        : intent === COMPUTER_USE_PRIMITIVE_INTENTS.observe
          ? 'observe'
          : intent === COMPUTER_USE_PRIMITIVE_INTENTS.control
            ? 'control'
            : 'act',
      status: 'blocked',
      blockedReason: result.error ?? 'computer_use_primitive_failed',
      refs: [],
      diagnostics: [],
      budget: {},
    } as PrimitiveEnvelope<T>;
  }
  return result.value as PrimitiveEnvelope<T>;
}

interface LiveAggregate {
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  cleanupRefs: string[];
}

function liveAggregate(): LiveAggregate {
  return {
    primitiveChainObserved: [],
    evidenceRefs: [],
    cleanupRefs: [],
  };
}

function runtimeOwnedLiveRefs(refs: Array<string | undefined>): string[] {
  return uniqueStrings(refs.filter((ref): ref is string => typeof ref === 'string' && safeLiveRef(ref)));
}

function safeLiveRef(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 260) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(text)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|raw-/i.test(text)) return false;
  return /^(?:runtime-truth:|intent:|chat-request:|decision:|macos-app:|process:|window:|frontmost:|file-ref:|text:|text-ref:|image:|accessibility:|element:|freshness:|observation:|window-action-session:|computer-use-session:|computer-use:|permission:|risk:|approval:|non-user-file-scope:|cursor-move:|selection-ref:|action:|executor-event:|input-event:|input-lease:|scoped-input-lease:|lease:|action-ledger:|adapter-registry:|actor-cursor:|cursor-marker:|scoped-input-adapter:|focus-lease:|stale-invalidation:|control:|front-app-restore:|focus-restore:|mouse-position-restore:|cursor-position-restore:|cancel:|stop:)/i.test(text);
}

function firstRefWithPrefix(refs: string[], prefixes: string[]): string | undefined {
  return refs.find((ref) => prefixes.some((prefix) => ref.startsWith(prefix)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function mergeRefs(target: string[], refs: Array<string | undefined>): void {
  target.splice(0, target.length, ...uniqueStrings([...target, ...runtimeOwnedLiveRefs(refs)]));
}

function cleanupRefsFromPrimitive(refs: string[]): string[] {
  return runtimeOwnedLiveRefs(refs.filter((ref) =>
    /^(?:control:|scoped-input-lease:|input-adapter:|scoped-input-adapter:|cursor-marker:|front-app-restore:|focus-restore:|mouse-position-restore:|cursor-position-restore:)/i.test(ref)
  ));
}

function buildAgentHostFinalAnswer(input: {
  status: VSCodeCoWorkLiveDiagnosticStatus;
  message: string;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  cleanupRefs: string[];
  materializerResult: CodexAgentHostComputerUseActMaterializerResult | undefined;
}): VSCodeCoWorkAgentHostFinalAnswer {
  return {
    schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
    source: 'codex-agent-host-vscode-cowork-live-diagnostic',
    status: input.status,
    text: agentHostFinalAnswerText({
      ...input,
      materializerClaimType: input.materializerResult?.claimType,
    }),
    maturity: 'live-diagnostic',
    productReady: false,
    hostOwnsFinalAnswer: true,
    computerUseCorePlanning: false,
    primitiveChainObserved: input.primitiveChainObserved,
    evidenceRefs: input.evidenceRefs,
    cleanupRefs: input.cleanupRefs,
    ...(input.materializerResult?.claimType ? { materializerClaimType: input.materializerResult.claimType } : {}),
    ...(input.materializerResult?.completionTruth ? { completionTruth: input.materializerResult.completionTruth } : {}),
  };
}

function agentHostFinalAnswerText(input: {
  status: VSCodeCoWorkLiveDiagnosticStatus;
  message: string;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  cleanupRefs: string[];
  materializerClaimType?: string;
}): string {
  const chain = input.primitiveChainObserved.join(' -> ') || 'none';
  const evidence = input.evidenceRefs.slice(0, 8).join(', ') || 'no-evidence-refs';
  const cleanup = input.cleanupRefs.slice(0, 6).join(', ') || 'no-cleanup-refs';
  const completedOperation = input.materializerClaimType === 'computer-use-vscode-cowork-act-decision'
    ? 'insert-draft act'
    : 'read-visible-text';
  if (input.status === 'completed') {
    return [
      `Host completed the current VSCode ${completedOperation} live diagnostic from refs-first evidence.`,
      `Primitive chain: ${chain}.`,
      `Evidence refs: ${evidence}.`,
      `Cleanup refs: ${cleanup}.`,
      'Computer Use core executed only Host-selected primitives and did not plan the task.',
    ].join(' ');
  }
  if (input.status === 'needs-confirmation') {
    return [
      'Host needs confirmation before continuing the current VSCode co-work diagnostic.',
      input.message,
      `Primitive chain: ${chain}.`,
      `Evidence refs: ${evidence}.`,
      `Cleanup refs: ${cleanup}.`,
      'Computer Use core did not choose a target or next task.',
    ].join(' ');
  }
  return [
    'Host blocked the current VSCode co-work diagnostic before claiming completion.',
    input.message,
    `Primitive chain: ${chain}.`,
    `Evidence refs: ${evidence}.`,
    `Cleanup refs: ${cleanup}.`,
    'Computer Use core did not plan the task.',
  ].join(' ');
}

function isComputerUseAtomicAction(value: unknown): value is ComputerUseAtomicAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (action.type === 'type') {
    return typeof action.textRef === 'string'
      && action.textRef.startsWith('text-ref:')
      && (action.elementRef === undefined || typeof action.elementRef === 'string');
  }
  if (action.type === 'key') {
    return typeof action.key === 'string'
      && (action.elementRef === undefined || typeof action.elementRef === 'string');
  }
  if (action.type === 'app_command') {
    return typeof action.command === 'string'
      && (action.elementRef === undefined || typeof action.elementRef === 'string');
  }
  return false;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && !(Array.isArray(entry) && entry.length === 0)),
  ) as T;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function safeToken(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
    : '';
}
