import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleInvokeResult,
} from '@sciforge-ui/runtime-contract/modules';

export const COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID = 'computer_use' as const;
export const COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA = 'sciforge.computer-use.primitive-result.v1' as const;

export const COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS = {
  bind: 'sciforge.computer-use.bind-input.v1',
  observe: 'sciforge.computer-use.observe-input.v1',
  act: 'sciforge.computer-use.act-input.v1',
  runProcedure: 'sciforge.computer-use.run-procedure-input.v1',
  control: 'sciforge.computer-use.control-input.v1',
} as const;

export const COMPUTER_USE_PRIMITIVE_INTENTS = {
  bind: 'computer_use.bind',
  observe: 'computer_use.observe',
  act: 'computer_use.act',
  runProcedure: 'computer_use.run_procedure',
  control: 'computer_use.control',
} as const;

export const COMPUTER_USE_PRIMITIVE_NAMES = ['bind', 'observe', 'act', 'run_procedure', 'control'] as const;
export const COMPUTER_USE_PROCEDURE_STEP_PRIMITIVES = ['observe', 'act', 'control'] as const;
export const COMPUTER_USE_TARGET_KINDS = ['window', 'app', 'display', 'screen-region', 'remote-desktop'] as const;
export const COMPUTER_USE_CAPTURE_MODES = ['none', 'screenshot', 'accessibility', 'both'] as const;
export const COMPUTER_USE_ACTION_TYPES = ['click', 'double_click', 'type', 'key', 'scroll', 'wait', 'app_command', 'drag'] as const;
export const COMPUTER_USE_CONTROL_COMMANDS = ['pause', 'resume', 'cancel', 'release', 'stop'] as const;
export const COMPUTER_USE_ACTION_REQUIREMENTS = {
  click: {
    required: ['elementRef_or_point'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  double_click: {
    required: ['elementRef_or_point'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  type: {
    required: ['textRef'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  key: {
    required: ['key_or_keys'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  scroll: {
    required: ['direction'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  wait: {
    required: ['durationMs'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  app_command: {
    required: ['command'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
  drag: {
    required: ['point', 'toPoint'],
    evidenceRefs: ['actionRef', 'executorEventRef', 'inputEventRef', 'invalidatedRefs'],
  },
} as const;

export type ComputerUsePrimitiveName = typeof COMPUTER_USE_PRIMITIVE_NAMES[number];
export type ComputerUseProcedureStepPrimitive = typeof COMPUTER_USE_PROCEDURE_STEP_PRIMITIVES[number];
export type ComputerUsePrimitiveStatus = 'completed' | 'partial' | 'blocked' | 'needs-confirmation' | 'failed';
export type ComputerUseTargetKind = typeof COMPUTER_USE_TARGET_KINDS[number];
export type ComputerUseCaptureMode = typeof COMPUTER_USE_CAPTURE_MODES[number];
export type ComputerUseActionType = typeof COMPUTER_USE_ACTION_TYPES[number];
export type ComputerUseControlCommand = typeof COMPUTER_USE_CONTROL_COMMANDS[number];
export type ComputerUseRiskPolicy = 'fail-closed' | 'allow-confirmed';
export type ComputerUseRiskLevel = 'low' | 'medium' | 'high';
export type ComputerUseCoordinateSpace = 'screen' | 'window' | 'element';
export type ComputerUseScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface ComputerUsePrimitiveBudget {
  maxTimeMs?: number;
  elapsedMs?: number;
  maxSteps?: number;
  stepsUsed?: number;
}

export interface ComputerUseDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  refs?: string[];
  retryable?: boolean;
}

export interface ComputerUseRepairHint {
  code: string;
  message: string;
  suggestedPrimitive?: ComputerUsePrimitiveName;
  machineReadable?: Record<string, unknown>;
}

export interface ComputerUsePrimitiveEnvelope<T = unknown> {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA;
  moduleId: typeof COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID;
  primitive: ComputerUsePrimitiveName;
  status: ComputerUsePrimitiveStatus;
  output?: T;
  refs: string[];
  diagnostics: ComputerUseDiagnostic[];
  budget: ComputerUsePrimitiveBudget;
  blockedReason?: string;
  repairHints?: ComputerUseRepairHint[];
}

export interface ComputerUseTargetBinding {
  kind: ComputerUseTargetKind;
  targetRef?: string;
  windowRef?: string;
  appRef?: string;
  displayRef?: string;
  regionRef?: string;
  remoteSessionRef?: string;
  windowId?: string;
  appId?: string;
  titleContains?: string;
}

export interface ComputerUseBindInput {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind;
  target: ComputerUseTargetBinding;
  riskPolicy?: ComputerUseRiskPolicy;
  approvalRef?: string;
  budget?: ComputerUsePrimitiveBudget;
}

export interface ComputerUseBindOutput {
  sessionId: string;
  sessionRef?: string;
  targetRef?: string;
  inputAdapterRef?: string;
  cursorRef?: string;
  windowActionSessionRef?: string;
  scopedInputLeaseRef?: string;
  observationRef?: string;
}

export interface ComputerUseObserveInput {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe;
  sessionId: string;
  capture?: ComputerUseCaptureMode;
  includeTree?: boolean;
  budget?: ComputerUsePrimitiveBudget;
}

export interface ComputerUseObserveOutput {
  sessionId: string;
  observationRef: string;
  screenshotRef?: string;
  accessibilityRef?: string;
  elementRefs?: string[];
  textRefs?: string[];
  staleInvalidationRefs?: string[];
}

export interface ComputerUsePoint {
  x: number;
  y: number;
  coordinateSpace: ComputerUseCoordinateSpace;
}

export interface ComputerUseAtomicAction {
  type: ComputerUseActionType;
  elementRef?: string;
  point?: ComputerUsePoint;
  toPoint?: ComputerUsePoint;
  textRef?: string;
  key?: string;
  keys?: string[];
  direction?: ComputerUseScrollDirection;
  amount?: number;
  durationMs?: number;
  command?: string;
}

export interface ComputerUseActionRisk {
  level?: ComputerUseRiskLevel;
  categories?: string[];
  actionHash?: string;
}

export interface ComputerUseActInput {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act;
  sessionId: string;
  actionId?: string;
  contextRefs?: string[];
  action: ComputerUseAtomicAction;
  inputAdapterRef?: string;
  cursorRef?: string;
  scopedInputLeaseRef?: string;
  captureAfter?: boolean;
  risk?: ComputerUseActionRisk;
  approvalRef?: string;
  budget?: ComputerUsePrimitiveBudget;
}

export interface ComputerUseActOutput {
  sessionId: string;
  actionRef: string;
  executorEventRef: string;
  inputAdapterRef?: string;
  cursorRef?: string;
  scopedInputLeaseRef?: string;
  inputEventRef?: string;
  beforeObservationRef?: string;
  afterObservationRef?: string;
  invalidatedRefs?: string[];
}

export interface ComputerUseControlInput {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control;
  sessionId: string;
  command: ComputerUseControlCommand;
  inputAdapterRef?: string;
  cursorRef?: string;
  scopedInputLeaseRef?: string;
  reasonRef?: string;
  budget?: ComputerUsePrimitiveBudget;
}

export interface ComputerUseControlOutput {
  sessionId: string;
  controlRef: string;
  releasedRefs?: string[];
}

export interface ComputerUseProcedureStep {
  id: string;
  primitive: ComputerUseProcedureStepPrimitive;
  input: ComputerUseObserveInput | ComputerUseActInput | ComputerUseControlInput;
}

export interface ComputerUseRunProcedureInput {
  schemaVersion: typeof COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure;
  sessionId: string;
  procedureRef?: string;
  steps: ComputerUseProcedureStep[];
  budget?: ComputerUsePrimitiveBudget;
}

export interface ComputerUseProcedureStepResult {
  stepId: string;
  primitive: ComputerUseProcedureStepPrimitive;
  status: ComputerUsePrimitiveStatus;
  refs: string[];
  blockedReason?: string;
  diagnostics?: ComputerUseDiagnostic[];
}

export interface ComputerUseRunProcedureOutput {
  sessionId: string;
  procedureRef?: string;
  stepResults: ComputerUseProcedureStepResult[];
}

export type ComputerUsePrimitiveInput =
  | ComputerUseBindInput
  | ComputerUseObserveInput
  | ComputerUseActInput
  | ComputerUseRunProcedureInput
  | ComputerUseControlInput;

export interface ComputerUsePrimitiveValidationResult {
  ok: boolean;
  primitive?: ComputerUsePrimitiveName;
  input?: ComputerUsePrimitiveInput;
  errors: string[];
}

export interface ComputerUsePrimitivePortResult<T = unknown> {
  status: ComputerUsePrimitiveStatus;
  output?: T;
  refs?: string[];
  diagnostics?: ComputerUseDiagnostic[];
  budget?: ComputerUsePrimitiveBudget;
  blockedReason?: string;
  repairHints?: ComputerUseRepairHint[];
}

export interface ComputerUsePrimitivePorts {
  bind?(input: ComputerUseBindInput): Promise<ComputerUsePrimitivePortResult<ComputerUseBindOutput>> | ComputerUsePrimitivePortResult<ComputerUseBindOutput>;
  observe?(input: ComputerUseObserveInput): Promise<ComputerUsePrimitivePortResult<ComputerUseObserveOutput>> | ComputerUsePrimitivePortResult<ComputerUseObserveOutput>;
  act?(input: ComputerUseActInput): Promise<ComputerUsePrimitivePortResult<ComputerUseActOutput>> | ComputerUsePrimitivePortResult<ComputerUseActOutput>;
  control?(input: ComputerUseControlInput): Promise<ComputerUsePrimitivePortResult<ComputerUseControlOutput>> | ComputerUsePrimitivePortResult<ComputerUseControlOutput>;
}

export interface ComputerUsePrimitiveServiceOptions {
  ports?: ComputerUsePrimitivePorts;
  now?: () => number;
}

export interface ComputerUsePrimitiveService {
  describe(): ModuleDescription;
  invoke(request: ModuleInvokeRequest): Promise<ModuleInvokeResult<ComputerUsePrimitiveEnvelope>>;
}

interface ComputerUseSessionState {
  sessionId: string;
  targetRef?: string;
  inputAdapterRef: string;
  cursorRef: string;
  scopedInputLeaseRef: string;
  status: 'active' | 'paused' | 'released' | 'stopped' | 'cancelled';
}

interface ComputerUseSessionRuntime {
  sessions: Map<string, ComputerUseSessionState>;
}

const INTENT_TO_PRIMITIVE = new Map<string, ComputerUsePrimitiveName>([
  [COMPUTER_USE_PRIMITIVE_INTENTS.bind, 'bind'],
  [COMPUTER_USE_PRIMITIVE_INTENTS.observe, 'observe'],
  [COMPUTER_USE_PRIMITIVE_INTENTS.act, 'act'],
  [COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure, 'run_procedure'],
  [COMPUTER_USE_PRIMITIVE_INTENTS.control, 'control'],
]);

export function createComputerUsePrimitiveService(options: ComputerUsePrimitiveServiceOptions = {}): ComputerUsePrimitiveService {
  const ports = options.ports ?? {};
  const now = options.now ?? Date.now;
  const runtime: ComputerUseSessionRuntime = {
    sessions: new Map(),
  };
  return {
    describe: computerUsePrimitiveModuleDescription,
    invoke: async (request) => {
      const startedAt = now();
      const validation = validateComputerUsePrimitiveInvokeRequest(request);
      if (!validation.ok || !validation.primitive || !validation.input) {
        return moduleResult({
          moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
          ok: false,
          error: validation.errors.join(';'),
        });
      }

      const primitive = validation.primitive;
      const input = validation.input;
      const result = primitive === 'run_procedure'
        ? await executeRunProcedure(input as ComputerUseRunProcedureInput, ports, startedAt, now, runtime)
        : await executePrimitive(primitive, input, ports, startedAt, now, runtime);

      return primitiveModuleResult(primitive, {
        ...result,
        budget: mergeBudget(elapsedBudget(input, startedAt, now()), result.budget),
      });
    },
  };
}

export function validateComputerUsePrimitiveInvokeRequest(request: ModuleInvokeRequest): ComputerUsePrimitiveValidationResult {
  const errors: string[] = [];
  if (request.moduleId !== COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID) {
    errors.push(`module_id_mismatch:${request.moduleId}`);
  }
  const primitive = primitiveFromIntent(request.intent);
  if (!primitive) {
    errors.push(`unsupported_computer_use_primitive_intent:${request.intent}`);
    return { ok: false, errors };
  }
  const input = record(request.input);
  if (!input) return { ok: false, primitive, errors: [...errors, 'missing_input'] };

  if (primitive === 'bind') validateBindInput(input, errors);
  if (primitive === 'observe') validateObserveInput(input, errors);
  if (primitive === 'act') validateActInput(input, errors);
  if (primitive === 'run_procedure') validateRunProcedureInput(input, errors);
  if (primitive === 'control') validateControlInput(input, errors);

  return {
    ok: errors.length === 0,
    primitive,
    input: errors.length === 0 ? input as unknown as ComputerUsePrimitiveInput : undefined,
    errors,
  };
}

export function computerUsePrimitiveModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    title: 'Computer Use',
    summary: 'Refs-first desktop/GUI primitive module. Agent Host owns task understanding, locate, repair, verification, completion truth, and final synthesis.',
    resources: [
      { kind: 'computer-use-session', refPrefix: 'computer-use:session:', queryable: false, readable: true },
      { kind: 'window-action-session', refPrefix: 'window-action-session:', queryable: false, readable: true },
      { kind: 'computer-use-observation', refPrefix: 'observation:', queryable: false, readable: true },
      { kind: 'window-action', refPrefix: 'window-action:', queryable: false, readable: true },
      { kind: 'executor-event', refPrefix: 'executor-event:', queryable: false, readable: true },
    ],
    intents: COMPUTER_USE_PRIMITIVE_NAMES.map((primitive) => ({
      name: intentForPrimitive(primitive),
      sideEffect: computerUsePrimitiveSideEffect(primitive),
      returnsOperation: false,
      summary: computerUsePrimitiveSummary(primitive),
    })),
    facets: { refs: true, events: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 300 },
  });
}

async function executeRunProcedure(
  input: ComputerUseRunProcedureInput,
  ports: ComputerUsePrimitivePorts,
  startedAt: number,
  now: () => number,
  runtime: ComputerUseSessionRuntime,
): Promise<ComputerUsePrimitivePortResult<ComputerUseRunProcedureOutput>> {
  const confirmationBlock = firstProcedureConfirmationBlock(input);
  if (confirmationBlock) return confirmationBlock;

  const stepResults: ComputerUseProcedureStepResult[] = [];
  const refs: string[] = [];
  let status: ComputerUsePrimitiveStatus = 'completed';
  let blockedReason: string | undefined;
  let diagnostics: ComputerUseDiagnostic[] = [];

  for (const step of input.steps) {
    const result = await executePrimitive(step.primitive, step.input, ports, now(), now, runtime);
    const stepRefs = uniqueStrings(result.refs ?? []);
    refs.push(...stepRefs);
    stepResults.push({
      stepId: step.id,
      primitive: step.primitive,
      status: result.status,
      refs: stepRefs,
      blockedReason: result.blockedReason,
      diagnostics: result.diagnostics,
    });
    diagnostics = diagnostics.concat(result.diagnostics ?? []);
    if (!isSuccessfulStatus(result.status)) {
      status = result.status;
      blockedReason = result.blockedReason ?? `procedure_step_${result.status}:${step.id}`;
      break;
    }
  }

  return {
    status,
    output: {
      sessionId: input.sessionId,
      procedureRef: input.procedureRef,
      stepResults,
    },
    refs: uniqueStrings(refs),
    diagnostics,
    blockedReason,
    budget: {
      ...elapsedBudget(input, startedAt, now()),
      stepsUsed: stepResults.length,
    },
  };
}

async function executePrimitive(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure'> | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  ports: ComputerUsePrimitivePorts,
  startedAt: number,
  now: () => number,
  runtime: ComputerUseSessionRuntime,
): Promise<ComputerUsePrimitivePortResult> {
  if (primitive === 'act') {
    const confirmationBlock = actionConfirmationBlock(input as ComputerUseActInput, startedAt, now);
    if (confirmationBlock) return confirmationBlock;
  }

  const port = portForPrimitive(primitive, ports);
  if (!port) return missingPortResult(primitive, input, startedAt, now);

  const sessionBlock = primitive === 'bind'
    ? undefined
    : sessionExecutionBlock(primitive, input, runtime, startedAt, now);
  if (sessionBlock) return sessionBlock;

  const session = primitive === 'bind'
    ? undefined
    : runtime.sessions.get((input as ComputerUseObserveInput | ComputerUseActInput | ComputerUseControlInput).sessionId);
  const scopedInput = scopePrimitiveInput(primitive, input, session);

  try {
    const result = await port(scopedInput as never);
    return finalizePrimitiveResult(primitive, scopedInput, result, runtime, startedAt, now);
  } catch (error) {
    return primitivePortError(primitive, input, error, startedAt, now);
  }
}

function sessionExecutionBlock(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure' | 'bind'> | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  runtime: ComputerUseSessionRuntime,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult | undefined {
  const sessionId = (input as ComputerUseObserveInput | ComputerUseActInput | ComputerUseControlInput).sessionId;
  const session = runtime.sessions.get(sessionId);
  if (!session) {
    return sessionBlockedResult('unknown_computer_use_session', primitive, input, startedAt, now);
  }
  if (session.status === 'released') {
    return sessionBlockedResult('computer_use_session_released', primitive, input, startedAt, now);
  }
  if (session.status === 'stopped') {
    return sessionBlockedResult('computer_use_session_stopped', primitive, input, startedAt, now);
  }
  if (session.status === 'cancelled') {
    return sessionBlockedResult('computer_use_session_cancelled', primitive, input, startedAt, now);
  }
  if (primitive === 'act' && session.status === 'paused') {
    return sessionBlockedResult('computer_use_session_paused', primitive, input, startedAt, now);
  }
  return undefined;
}

function scopePrimitiveInput(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure'> | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  session: ComputerUseSessionState | undefined,
): ComputerUsePrimitiveInput {
  if (!session) return input;
  if (primitive === 'act') {
    return {
      ...(input as ComputerUseActInput),
      inputAdapterRef: session.inputAdapterRef,
      cursorRef: session.cursorRef,
      scopedInputLeaseRef: session.scopedInputLeaseRef,
    };
  }
  if (primitive === 'control') {
    return {
      ...(input as ComputerUseControlInput),
      inputAdapterRef: session.inputAdapterRef,
      cursorRef: session.cursorRef,
      scopedInputLeaseRef: session.scopedInputLeaseRef,
    };
  }
  return input;
}

function finalizePrimitiveResult(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure'> | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  result: ComputerUsePrimitivePortResult,
  runtime: ComputerUseSessionRuntime,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult {
  if (primitive === 'bind') {
    return finalizeBindResult(input as ComputerUseBindInput, result as ComputerUsePrimitivePortResult<ComputerUseBindOutput>, runtime, startedAt, now);
  }
  if (primitive === 'act') {
    return finalizeActResult(input as ComputerUseActInput, result as ComputerUsePrimitivePortResult<ComputerUseActOutput>, runtime, startedAt, now);
  }
  if (primitive === 'observe') {
    return finalizeObserveResult(input as ComputerUseObserveInput, result as ComputerUsePrimitivePortResult<ComputerUseObserveOutput>, startedAt, now);
  }
  if (primitive === 'control') {
    return finalizeControlResult(input as ComputerUseControlInput, result as ComputerUsePrimitivePortResult<ComputerUseControlOutput>, runtime, startedAt, now);
  }
  return result;
}

function finalizeBindResult(
  input: ComputerUseBindInput,
  result: ComputerUsePrimitivePortResult<ComputerUseBindOutput>,
  runtime: ComputerUseSessionRuntime,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<ComputerUseBindOutput> {
  if (!isSuccessfulStatus(result.status)) return result;
  const output = result.output;
  if (!output || !nonEmptyString(output.sessionId) || !nonEmptyString(output.inputAdapterRef) || !nonEmptyString(output.cursorRef) || !nonEmptyString(output.scopedInputLeaseRef)) {
    return invalidIsolationResult('invalid_bind_session_isolation_refs', 'A completed bind must return sessionId, inputAdapterRef, cursorRef, and scopedInputLeaseRef.', input, startedAt, now);
  }
  const duplicate = [...runtime.sessions.values()].find((session) => isLiveSession(session)
    && (session.sessionId === output.sessionId
      || session.inputAdapterRef === output.inputAdapterRef
      || session.cursorRef === output.cursorRef
      || session.scopedInputLeaseRef === output.scopedInputLeaseRef));
  if (duplicate) {
    return invalidIsolationResult('duplicate_active_session_input_isolation_refs', 'Each active Computer Use session must own unique inputAdapterRef, cursorRef, and scopedInputLeaseRef values.', input, startedAt, now);
  }

  runtime.sessions.set(output.sessionId, {
    sessionId: output.sessionId,
    targetRef: output.targetRef,
    inputAdapterRef: output.inputAdapterRef,
    cursorRef: output.cursorRef,
    scopedInputLeaseRef: output.scopedInputLeaseRef,
    status: 'active',
  });

  return {
    ...result,
    refs: uniqueStrings([
      ...(result.refs ?? []),
      output.inputAdapterRef,
      output.cursorRef,
      output.scopedInputLeaseRef,
    ]),
  };
}

function finalizeActResult(
  input: ComputerUseActInput,
  result: ComputerUsePrimitivePortResult<ComputerUseActOutput>,
  runtime: ComputerUseSessionRuntime,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<ComputerUseActOutput> {
  if (!isSuccessfulStatus(result.status)) return result;
  const session = runtime.sessions.get(input.sessionId);
  if (!session) return sessionBlockedResult('unknown_computer_use_session', 'act', input, startedAt, now);
  const output = result.output;
  if (!output) return result;
  if (!hasRequiredActEvidence(output)) {
    return invalidEvidenceResult('invalid_act_evidence_refs', 'A completed act must return actionRef, executorEventRef, inputEventRef, beforeObservationRef, afterObservationRef, and invalidatedRefs.', input, startedAt, now);
  }
  const mismatch = (nonEmptyString(output.inputAdapterRef) && output.inputAdapterRef !== session.inputAdapterRef)
    || (nonEmptyString(output.cursorRef) && output.cursorRef !== session.cursorRef)
    || (nonEmptyString(output.scopedInputLeaseRef) && output.scopedInputLeaseRef !== session.scopedInputLeaseRef);
  if (mismatch) {
    return sessionBlockedResult('computer_use_session_input_scope_mismatch', 'act', input, startedAt, now);
  }
  const scopedOutput = {
    ...output,
    inputAdapterRef: session.inputAdapterRef,
    cursorRef: session.cursorRef,
    scopedInputLeaseRef: session.scopedInputLeaseRef,
  };
  return {
    ...result,
    output: scopedOutput,
    refs: uniqueStrings([
      ...(result.refs ?? []),
      session.inputAdapterRef,
      session.cursorRef,
      session.scopedInputLeaseRef,
    ]),
  };
}

function finalizeObserveResult(
  input: ComputerUseObserveInput,
  result: ComputerUsePrimitivePortResult<ComputerUseObserveOutput>,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<ComputerUseObserveOutput> {
  if (!isSuccessfulStatus(result.status)) return result;
  if (!hasRequiredObserveEvidence(result.output)) {
    return invalidEvidenceResult('invalid_observe_evidence_refs', 'A completed observe must return observationRef, screenshotRef, accessibilityRef, elementRefs, and textRefs.', input, startedAt, now);
  }
  return result;
}

function finalizeControlResult(
  input: ComputerUseControlInput,
  result: ComputerUsePrimitivePortResult<ComputerUseControlOutput>,
  runtime: ComputerUseSessionRuntime,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<ComputerUseControlOutput> {
  if (!isSuccessfulStatus(result.status)) return result;
  const session = runtime.sessions.get(input.sessionId);
  if (!session) return sessionBlockedResult('unknown_computer_use_session', 'control', input, startedAt, now);

  if (input.command === 'pause') session.status = 'paused';
  if (input.command === 'resume') session.status = 'active';
  if (input.command === 'release') session.status = 'released';
  if (input.command === 'stop') session.status = 'stopped';
  if (input.command === 'cancel') session.status = 'cancelled';

  const releasedRefs = input.command === 'release' || input.command === 'stop' || input.command === 'cancel'
    ? [session.scopedInputLeaseRef, session.inputAdapterRef, session.cursorRef]
    : [];
  const output = result.output
    ? {
        ...result.output,
        releasedRefs: uniqueStrings([
          ...(result.output.releasedRefs ?? []),
          ...releasedRefs,
        ]),
      }
    : result.output;
  return {
    ...result,
    output,
    refs: uniqueStrings([
      ...(result.refs ?? []),
      ...releasedRefs,
    ]),
  };
}

function invalidIsolationResult<T>(
  blockedReason: string,
  message: string,
  input: ComputerUsePrimitiveInput,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<T> {
  return {
    status: 'failed',
    blockedReason,
    refs: [],
    diagnostics: [{
      code: blockedReason,
      message,
      severity: 'error',
      retryable: false,
    }],
    budget: elapsedBudget(input, startedAt, now()),
  };
}

function invalidEvidenceResult<T>(
  blockedReason: string,
  message: string,
  input: ComputerUsePrimitiveInput,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<T> {
  return {
    status: 'failed',
    blockedReason,
    refs: [],
    diagnostics: [{
      code: blockedReason,
      message,
      severity: 'error',
      retryable: false,
    }],
    budget: elapsedBudget(input, startedAt, now()),
  };
}

function sessionBlockedResult<T>(
  blockedReason: string,
  primitive: ComputerUsePrimitiveName | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<T> {
  return {
    status: 'blocked',
    blockedReason,
    refs: [],
    diagnostics: [{
      code: blockedReason,
      message: `Computer Use ${primitive} cannot run because the session is not active for this input adapter scope.`,
      severity: 'error',
      retryable: false,
    }],
    budget: elapsedBudget(input, startedAt, now()),
  };
}

function primitiveModuleResult(
  primitive: ComputerUsePrimitiveName,
  input: ComputerUsePrimitivePortResult,
): ModuleInvokeResult<ComputerUsePrimitiveEnvelope> {
  const refs = uniqueStrings(input.refs ?? []);
  const value: ComputerUsePrimitiveEnvelope = {
    schemaVersion: COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA,
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    primitive,
    status: input.status,
    output: input.output,
    refs,
    diagnostics: input.diagnostics ?? [],
    budget: input.budget ?? {},
    blockedReason: input.blockedReason,
    repairHints: input.repairHints,
  };
  const ok = isSuccessfulStatus(input.status);
  return moduleResult({
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    ok,
    value,
    refs,
    error: ok ? undefined : input.blockedReason ?? input.status,
  });
}

function validateBindInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind, errors);
  rejectUnknownFields(input, ['schemaVersion', 'target', 'riskPolicy', 'approvalRef', 'budget'], errors);
  const target = record(input.target);
  if (!target) {
    errors.push('invalid_object:target');
  } else {
    rejectUnknownFields(target, ['kind', 'targetRef', 'windowRef', 'appRef', 'displayRef', 'regionRef', 'remoteSessionRef', 'windowId', 'appId', 'titleContains'], errors, 'target');
    validateRequiredEnum(target.kind, COMPUTER_USE_TARGET_KINDS, 'target.kind', errors);
    for (const field of ['targetRef', 'windowRef', 'appRef', 'displayRef', 'regionRef', 'remoteSessionRef', 'windowId', 'appId', 'titleContains']) {
      validateOptionalString(target[field], `target.${field}`, errors);
    }
    if (!hasAnyNonEmptyString(target, ['targetRef', 'windowRef', 'appRef', 'displayRef', 'regionRef', 'remoteSessionRef', 'windowId', 'appId', 'titleContains'])) {
      errors.push('missing_target_ref');
    }
  }
  validateOptionalEnum(input.riskPolicy, ['fail-closed', 'allow-confirmed'], 'riskPolicy', errors);
  validateOptionalString(input.approvalRef, 'approvalRef', errors);
  validateOptionalBudget(input.budget, errors);
}

function validateObserveInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe, errors);
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'capture', 'includeTree', 'budget'], errors);
  if (!nonEmptyString(input.sessionId)) errors.push('missing_string:sessionId');
  validateOptionalEnum(input.capture, COMPUTER_USE_CAPTURE_MODES, 'capture', errors);
  validateOptionalBoolean(input.includeTree, 'includeTree', errors);
  validateOptionalBudget(input.budget, errors);
}

function validateActInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act, errors);
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'actionId', 'contextRefs', 'action', 'captureAfter', 'risk', 'approvalRef', 'budget'], errors);
  if (!nonEmptyString(input.sessionId)) errors.push('missing_string:sessionId');
  validateOptionalString(input.actionId, 'actionId', errors);
  validateOptionalStringArray(input.contextRefs, 'contextRefs', errors);
  validateAction(input.action, errors);
  validateOptionalBoolean(input.captureAfter, 'captureAfter', errors);
  validateOptionalRisk(input.risk, errors);
  validateOptionalString(input.approvalRef, 'approvalRef', errors);
  validateOptionalBudget(input.budget, errors);
}

function validateControlInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control, errors);
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'command', 'reasonRef', 'budget'], errors);
  if (!nonEmptyString(input.sessionId)) errors.push('missing_string:sessionId');
  validateRequiredEnum(input.command, COMPUTER_USE_CONTROL_COMMANDS, 'command', errors);
  validateOptionalString(input.reasonRef, 'reasonRef', errors);
  validateOptionalBudget(input.budget, errors);
}

function validateRunProcedureInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure, errors);
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'procedureRef', 'steps', 'budget'], errors);
  if (!nonEmptyString(input.sessionId)) errors.push('missing_string:sessionId');
  validateOptionalString(input.procedureRef, 'procedureRef', errors);
  validateOptionalBudget(input.budget, errors);

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push('missing_array:steps');
    return;
  }
  if (input.steps.length > 50) errors.push('too_many_steps:steps');
  input.steps.forEach((step, index) => validateProcedureStep(step, index, input.sessionId, errors));
}

function validateProcedureStep(value: unknown, index: number, sessionId: unknown, errors: string[]) {
  const step = record(value);
  if (!step) {
    errors.push(`invalid_object:steps[${index}]`);
    return;
  }
  rejectUnknownFields(step, ['id', 'primitive', 'input'], errors, `steps[${index}]`);
  if (!nonEmptyString(step.id)) errors.push(`missing_string:steps[${index}].id`);
  validateRequiredEnum(step.primitive, COMPUTER_USE_PROCEDURE_STEP_PRIMITIVES, `steps[${index}].primitive`, errors);
  const stepInput = record(step.input);
  if (!stepInput) {
    errors.push(`invalid_object:steps[${index}].input`);
    return;
  }
  if (step.primitive === 'observe') validateObserveInput(stepInput, errors);
  if (step.primitive === 'act') validateActInput(stepInput, errors);
  if (step.primitive === 'control') validateControlInput(stepInput, errors);
  if (nonEmptyString(sessionId) && stepInput.sessionId !== sessionId) {
    errors.push(`procedure_step_session_mismatch:steps[${index}].input.sessionId`);
  }
}

function validateAction(value: unknown, errors: string[]) {
  const action = record(value);
  if (!action) {
    errors.push('invalid_object:action');
    return;
  }
  rejectUnknownFields(action, ['type', 'elementRef', 'point', 'toPoint', 'textRef', 'key', 'keys', 'direction', 'amount', 'durationMs', 'command'], errors, 'action');
  validateRequiredEnum(action.type, COMPUTER_USE_ACTION_TYPES, 'action.type', errors);
  validateOptionalString(action.elementRef, 'action.elementRef', errors);
  validateOptionalString(action.textRef, 'action.textRef', errors);
  validateOptionalString(action.key, 'action.key', errors);
  validateOptionalString(action.command, 'action.command', errors);
  validateOptionalStringArray(action.keys, 'action.keys', errors);
  validateOptionalFinitePositiveNumber(action.amount, 'action.amount', errors);
  validateOptionalFinitePositiveNumber(action.durationMs, 'action.durationMs', errors);
  validateOptionalEnum(action.direction, ['up', 'down', 'left', 'right'], 'action.direction', errors);
  validateOptionalPoint(action.point, errors);
  validateOptionalPoint(action.toPoint, errors, 'action.toPoint');

  if ((action.type === 'click' || action.type === 'double_click') && !nonEmptyString(action.elementRef) && !record(action.point)) {
    errors.push('missing_action_target:elementRef_or_point');
  }
  if (action.type === 'drag' && (!record(action.point) || !record(action.toPoint))) {
    errors.push('missing_action_target:point_and_toPoint');
  }
  if (action.type === 'type' && !nonEmptyString(action.textRef)) errors.push('missing_string:action.textRef');
  if (action.type === 'key' && !nonEmptyString(action.key) && !validStringArray(action.keys)) errors.push('missing_key:action.key_or_keys');
  if (action.type === 'scroll' && !['up', 'down', 'left', 'right'].includes(String(action.direction))) errors.push('missing_enum:action.direction');
  if (action.type === 'wait' && !positiveNumber(action.durationMs)) errors.push('missing_number:action.durationMs');
  if (action.type === 'app_command' && !nonEmptyString(action.command)) errors.push('missing_string:action.command');
}

function validateOptionalPoint(value: unknown, errors: string[], field = 'action.point') {
  if (value === undefined) return;
  const point = record(value);
  if (!point) {
    errors.push(`invalid_object:${field}`);
    return;
  }
  rejectUnknownFields(point, ['x', 'y', 'coordinateSpace'], errors, field);
  validateRequiredFiniteNumber(point.x, `${field}.x`, errors);
  validateRequiredFiniteNumber(point.y, `${field}.y`, errors);
  validateRequiredEnum(point.coordinateSpace, ['screen', 'window', 'element'], `${field}.coordinateSpace`, errors);
}

function validateOptionalRisk(value: unknown, errors: string[]) {
  if (value === undefined) return;
  const risk = record(value);
  if (!risk) {
    errors.push('invalid_object:risk');
    return;
  }
  rejectUnknownFields(risk, ['level', 'categories', 'actionHash'], errors, 'risk');
  validateOptionalEnum(risk.level, ['low', 'medium', 'high'], 'risk.level', errors);
  validateOptionalStringArray(risk.categories, 'risk.categories', errors);
  validateOptionalString(risk.actionHash, 'risk.actionHash', errors);
}

function validateSchema(input: Record<string, unknown>, schemaVersion: string, errors: string[]) {
  if (input.schemaVersion !== schemaVersion) errors.push(`schema_version_mismatch:${schemaVersion}`);
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: string[], errors: string[], prefix?: string) {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(input)) {
    if (allowedSet.has(field)) continue;
    errors.push(prefix ? `unknown_${prefix}_field:${field}` : `unknown_input_field:${field}`);
  }
}

function validateOptionalBudget(value: unknown, errors: string[]) {
  if (value === undefined) return;
  const budget = record(value);
  if (!budget) {
    errors.push('invalid_object:budget');
    return;
  }
  rejectUnknownFields(budget, ['maxTimeMs', 'elapsedMs', 'maxSteps', 'stepsUsed'], errors, 'budget');
  validateOptionalFinitePositiveNumber(budget.maxTimeMs, 'budget.maxTimeMs', errors);
  validateOptionalFiniteNonNegativeNumber(budget.elapsedMs, 'budget.elapsedMs', errors);
  validateOptionalIntegerRange(budget.maxSteps, 'budget.maxSteps', 1, 50, errors);
  validateOptionalIntegerRange(budget.stepsUsed, 'budget.stepsUsed', 0, 50, errors);
}

function validateOptionalString(value: unknown, field: string, errors: string[]) {
  if (value !== undefined && !nonEmptyString(value)) errors.push(`invalid_string:${field}`);
}

function validateOptionalStringArray(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (!validStringArray(value)) errors.push(`invalid_string_array:${field}`);
}

function validateOptionalBoolean(value: unknown, field: string, errors: string[]) {
  if (value !== undefined && typeof value !== 'boolean') errors.push(`invalid_boolean:${field}`);
}

function validateOptionalEnum(value: unknown, allowed: readonly string[], field: string, errors: string[]) {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) errors.push(`invalid_enum:${field}`);
}

function validateRequiredEnum(value: unknown, allowed: readonly string[], field: string, errors: string[]) {
  if (typeof value !== 'string' || !allowed.includes(value)) errors.push(`invalid_enum:${field}`);
}

function validateOptionalIntegerRange(value: unknown, field: string, min: number, max: number, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) errors.push(`invalid_integer:${field}`);
}

function validateOptionalFinitePositiveNumber(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (!positiveNumber(value)) errors.push(`invalid_number:${field}`);
}

function validateOptionalFiniteNonNegativeNumber(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`invalid_number:${field}`);
}

function validateRequiredFiniteNumber(value: unknown, field: string, errors: string[]) {
  if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`invalid_number:${field}`);
}

function firstProcedureConfirmationBlock(input: ComputerUseRunProcedureInput): ComputerUsePrimitivePortResult<ComputerUseRunProcedureOutput> | undefined {
  for (const step of input.steps) {
    if (step.primitive !== 'act') continue;
    const block = actionConfirmationBlock(step.input as ComputerUseActInput, 0, () => 0);
    if (!block) continue;
    return {
      ...block,
      output: {
        sessionId: input.sessionId,
        procedureRef: input.procedureRef,
        stepResults: [{
          stepId: step.id,
          primitive: step.primitive,
          status: block.status,
          refs: [],
          blockedReason: block.blockedReason,
          diagnostics: block.diagnostics,
        }],
      },
      blockedReason: `procedure_step_needs_confirmation:${step.id}`,
    };
  }
  return undefined;
}

function actionConfirmationBlock(
  input: ComputerUseActInput,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<ComputerUseActOutput> | undefined {
  const confirmationRequirement = actionConfirmationRequirement(input);
  if (!confirmationRequirement.required) return undefined;
  const approvalRef = input.approvalRef;
  if (nonEmptyString(approvalRef) && approvalRefMatchesConfirmation(approvalRef, confirmationRequirement)) return undefined;
  const blockedReason = nonEmptyString(approvalRef)
    ? 'computer_use_action_approval_ref_mismatch'
    : 'computer_use_action_needs_confirmation';
  return {
    status: 'needs-confirmation',
    refs: [],
    blockedReason,
    diagnostics: [{
      code: blockedReason,
      message: nonEmptyString(approvalRef)
        ? 'High-risk Computer Use action approvalRef is not bound to the current risk envelope.'
        : 'High-risk Computer Use action requires a caller-supplied approvalRef before execution.',
      severity: 'error',
      retryable: true,
    }],
    budget: elapsedBudget(input, startedAt, now()),
    repairHints: [{
      code: 'supply-approval-ref',
      message: 'Collect approval outside Computer Use, then retry this exact action with approvalRef bound to the same risk envelope.',
      suggestedPrimitive: 'act',
      machineReadable: input.risk?.actionHash ? { actionHash: input.risk.actionHash } : undefined,
    }],
  };
}

function actionConfirmationRequirement(input: ComputerUseActInput): {
  required: boolean;
  actionHash?: string;
  command?: string;
} {
  const actionHash = nonEmptyString(input.risk?.actionHash) ? input.risk.actionHash : undefined;
  if (input.risk?.level === 'high') return { required: true, actionHash };
  if (riskCategoriesNeedConfirmation(input.risk?.categories)) return { required: true, actionHash };
  const command = input.action.command?.toLowerCase();
  const commandRequiresConfirmation = input.action.type === 'app_command'
    && typeof command === 'string'
    && ['submit', 'send', 'publish', 'upload', 'delete', 'pay', 'authorize'].includes(command);
  return commandRequiresConfirmation
    ? { required: true, actionHash, command }
    : { required: false };
}

function riskCategoriesNeedConfirmation(categories: string[] | undefined) {
  return (categories ?? []).some((category) => {
    const normalized = category.toLowerCase().replace(/[_\s]+/g, '-');
    return normalized === 'cross-app'
      || normalized === 'cross-window'
      || normalized === 'cross-account'
      || normalized === 'irreversible'
      || normalized === 'irreversible-side-effect';
  });
}

function approvalRefMatchesConfirmation(
  approvalRef: string,
  requirement: { actionHash?: string; command?: string },
) {
  if (requirement.actionHash) return approvalRef.includes(requirement.actionHash);
  if (requirement.command) return approvalRef.toLowerCase().includes(requirement.command);
  return false;
}

function missingPortResult(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure'> | ComputerUseProcedureStepPrimitive,
  input: ComputerUsePrimitiveInput,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult {
  return {
    status: 'blocked',
    blockedReason: `missing_computer_use_primitive_port:${primitive}`,
    refs: [],
    diagnostics: [{
      code: 'missing-port',
      message: `No host port is registered for ${intentForPrimitive(primitive)}.`,
      severity: 'error',
      retryable: false,
    }],
    budget: elapsedBudget(input, startedAt, now()),
    repairHints: [{
      code: 'register-host-port',
      message: 'Register a Computer Use host port for this primitive before invoking it.',
      suggestedPrimitive: primitive,
    }],
  };
}

function primitivePortError<T = unknown>(
  primitive: ComputerUsePrimitiveName,
  input: ComputerUsePrimitiveInput,
  error: unknown,
  startedAt: number,
  now: () => number,
): ComputerUsePrimitivePortResult<T> {
  return {
    status: 'failed',
    blockedReason: 'computer_use_primitive_port_error',
    refs: [],
    diagnostics: [{
      code: 'port-error',
      message: errorMessage(error),
      severity: 'error',
      retryable: true,
    }],
    budget: elapsedBudget(input, startedAt, now()),
    repairHints: [{
      code: 'inspect-host-port',
      message: 'Inspect the host port implementation and retry only after the target-bound session is still valid.',
      suggestedPrimitive: primitive,
    }],
  };
}

function primitiveFromIntent(intent: string): ComputerUsePrimitiveName | undefined {
  return INTENT_TO_PRIMITIVE.get(intent);
}

function intentForPrimitive(primitive: ComputerUsePrimitiveName) {
  if (primitive === 'run_procedure') return COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure;
  return COMPUTER_USE_PRIMITIVE_INTENTS[primitive];
}

function portForPrimitive(
  primitive: Exclude<ComputerUsePrimitiveName, 'run_procedure'> | ComputerUseProcedureStepPrimitive,
  ports: ComputerUsePrimitivePorts,
) {
  if (primitive === 'bind') return ports.bind;
  if (primitive === 'observe') return ports.observe;
  if (primitive === 'act') return ports.act;
  return ports.control;
}

function computerUsePrimitiveSideEffect(primitive: ComputerUsePrimitiveName) {
  if (primitive === 'observe') return 'none' as const;
  if (primitive === 'bind' || primitive === 'control') return 'workspace' as const;
  return 'external' as const;
}

function computerUsePrimitiveSummary(primitive: ComputerUsePrimitiveName) {
  if (primitive === 'bind') return 'Bind a Host-selected target and return scoped session refs.';
  if (primitive === 'observe') return 'Observe a bound target and return refs-first current state evidence.';
  if (primitive === 'act') return 'Execute one Host-selected atomic GUI action against an existing session.';
  if (primitive === 'run_procedure') return 'Execute Host-specified local primitive steps without task reasoning or completion truth.';
  return 'Pause, cancel, stop, resume, or release a scoped Computer Use session.';
}

function elapsedBudget(input: ComputerUsePrimitiveInput, startedAt: number, endedAt: number): ComputerUsePrimitiveBudget {
  const budget = record((input as { budget?: unknown }).budget);
  return {
    ...budget,
    elapsedMs: Math.max(0, endedAt - startedAt),
  };
}

function mergeBudget(base: ComputerUsePrimitiveBudget, override: ComputerUsePrimitiveBudget | undefined): ComputerUsePrimitiveBudget {
  return { ...base, ...override };
}

function hasProcedureStepResults(value: unknown): value is ComputerUseRunProcedureOutput {
  const output = record(value);
  return Boolean(output && Array.isArray(output.stepResults));
}

function hasRequiredObserveEvidence(output: ComputerUseObserveOutput | undefined) {
  return Boolean(output
    && nonEmptyString(output.observationRef)
    && nonEmptyString(output.screenshotRef)
    && nonEmptyString(output.accessibilityRef)
    && validStringArray(output.elementRefs)
    && validStringArray(output.textRefs));
}

function hasRequiredActEvidence(output: ComputerUseActOutput | undefined) {
  return Boolean(output
    && nonEmptyString(output.actionRef)
    && nonEmptyString(output.executorEventRef)
    && nonEmptyString(output.inputEventRef)
    && nonEmptyString(output.beforeObservationRef)
    && nonEmptyString(output.afterObservationRef)
    && validStringArray(output.invalidatedRefs));
}

function isSuccessfulStatus(status: ComputerUsePrimitiveStatus) {
  return status === 'completed' || status === 'partial';
}

function isLiveSession(session: ComputerUseSessionState) {
  return session.status === 'active' || session.status === 'paused';
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function hasAnyNonEmptyString(value: Record<string, unknown>, fields: string[]) {
  return fields.some((field) => nonEmptyString(value[field]));
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
