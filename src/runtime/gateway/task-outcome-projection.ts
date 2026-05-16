import { createHash } from 'node:crypto';
import {
  createTaskRunCard,
  validateTaskRunCard,
  type FailureSignatureInput,
  type OwnershipLayerSuggestion,
  type TaskAttributionLayer,
  type TaskOutcomeStatus,
  type TaskProtocolStatus,
  type TaskRunCard,
  type TaskRunCardConversationProjectionSummary,
  type TaskRunCardRef,
} from '@sciforge-ui/runtime-contract/task-run-card';
import {
  appendConversationEvent,
  conversationEventLogDigest,
  createConversationEventLog,
  isConversationEventLog,
  projectConversation,
  replayConversationState,
  type ConversationEvent,
  type ConversationEventLog,
  type ConversationEventType,
  type ConversationProjection,
  type ConversationRef,
} from '../conversation-kernel/index.js';
import type { RuntimeExecutionUnit } from '@sciforge-ui/runtime-contract/execution';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';

export const TASK_OUTCOME_PROJECTION_SCHEMA_VERSION = 'sciforge.gateway-task-outcome-projection.v1' as const;
export const USER_SATISFACTION_PROXY_SCHEMA_VERSION = 'sciforge.user-satisfaction-proxy.v1' as const;
export const NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION = 'sciforge.next-step-attribution.v1' as const;
const externalServiceLayer = ['external', 'provider'].join('-') as TaskAttributionLayer;
const transientUnavailableStatus = ['transient', 'unavailable'].join('-');

type GatewayBackgroundProjectionState = NonNullable<TaskRunCardConversationProjectionSummary['backgroundState']> & {
  revisionPlan?: string;
  foregroundPartialRef?: string;
};

export interface GatewayTaskOutcomeProjectionContext {
  request?: GatewayRequest;
  skill?: SkillAvailability;
  forceRecomputeProjection?: boolean;
  refs?: {
    taskRel?: string;
    outputRel?: string;
    stdoutRel?: string;
    stderrRel?: string;
  };
}

export interface UserSatisfactionProxy {
  schemaVersion: typeof USER_SATISFACTION_PROXY_SCHEMA_VERSION;
  answeredLatestRequest: boolean;
  usableResultVisible: boolean;
  structuredNextStep: boolean;
  preservesWorkRefs: boolean;
  avoidsDuplicateWork: boolean;
  score: number;
  status: 'likely-satisfied' | 'needs-work' | 'needs-human' | 'blocked' | 'unknown';
  reasons: string[];
}

export interface NextStepAttribution {
  schemaVersion: typeof NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION;
  ownerLayer: TaskAttributionLayer;
  nextStep: string;
  reason: string;
  sourceRefs: string[];
  sourceSignals: string[];
}

export interface GatewayTaskOutcomeProjection {
  schemaVersion: typeof TASK_OUTCOME_PROJECTION_SCHEMA_VERSION;
  taskRunCard: TaskRunCard;
  protocolSuccess: boolean;
  taskSuccess: boolean;
  userSatisfactionProxy: UserSatisfactionProxy;
  nextStepAttribution: NextStepAttribution;
  conversationEventLog: ConversationEventLog;
  conversationEventLogRef?: string;
  conversationEventLogDigest: string;
  projectionRestore: {
    schemaVersion: 'sciforge.gateway-projection-restore.v1';
    source: 'conversation-event-log';
    eventCount: number;
    digest: string;
    ref?: string;
  };
  conversationProjection: ConversationProjection;
  ownershipLayerSuggestions: OwnershipLayerSuggestion[];
  projectionRules: string[];
}

export function attachTaskOutcomeProjection(
  payload: ToolPayload,
  context: GatewayTaskOutcomeProjectionContext = {},
): ToolPayload {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const existingProjection = !context.forceRecomputeProjection && isGatewayTaskOutcomeProjection(displayIntent.taskOutcomeProjection)
    ? restoreTaskOutcomeProjectionFromEventLog(displayIntent.taskOutcomeProjection, displayIntent)
    : undefined;
  const projection = existingProjection ?? materializeTaskOutcomeProjection({ payload, ...context });
  return {
    ...payload,
    displayIntent: {
      ...displayIntent,
      taskRunCard: projection.taskRunCard,
      taskOutcomeProjection: projection,
      conversationEventLog: isConversationEventLog(displayIntent.conversationEventLog)
        ? displayIntent.conversationEventLog
        : projection.conversationEventLog,
      conversationEventLogRef: stringField(displayIntent.conversationEventLogRef) ?? projection.conversationEventLogRef,
      conversationEventLogDigest: projection.conversationEventLogDigest,
      conversationProjection: projection.conversationProjection,
    },
  };
}

function restoreTaskOutcomeProjectionFromEventLog(
  projection: GatewayTaskOutcomeProjection,
  displayIntent: Record<string, unknown>,
): GatewayTaskOutcomeProjection {
  const log = isConversationEventLog(displayIntent.conversationEventLog)
    ? displayIntent.conversationEventLog
    : isConversationEventLog(projection.conversationEventLog)
      ? projection.conversationEventLog
      : undefined;
  if (!log) return projection;
  const conversationProjection = projectConversation(log, replayConversationState(log));
  const conversationEventLogDigestValue = conversationEventLogDigest(log);
  const conversationEventLogRef = stringField(displayIntent.conversationEventLogRef)
    ?? projection.conversationEventLogRef;
  const conversationProjectionSummary = conversationProjectionSummaryFromProjection(
    conversationProjection,
    projection.nextStepAttribution,
  );
  const taskRunCard = {
    ...projection.taskRunCard,
    conversationProjectionRef: projection.taskRunCard.conversationProjectionRef
      ?? conversationProjectionRefFromEventLogRef(conversationEventLogRef),
    conversationProjectionSummary,
    refs: withConversationEventLogRef(projection.taskRunCard.refs, conversationEventLogRef),
  };
  return {
    ...projection,
    taskRunCard,
    conversationEventLog: log,
    conversationEventLogRef,
    conversationEventLogDigest: conversationEventLogDigestValue,
    projectionRestore: {
      schemaVersion: 'sciforge.gateway-projection-restore.v1',
      source: 'conversation-event-log',
      eventCount: log.events.length,
      digest: conversationEventLogDigestValue,
      ref: conversationEventLogRef,
    },
    conversationProjection,
    ownershipLayerSuggestions: taskRunCard.ownershipLayerSuggestions,
  };
}

export function materializeTaskOutcomeProjection(input: GatewayTaskOutcomeProjectionContext & {
  payload: ToolPayload;
}): GatewayTaskOutcomeProjection {
  const refs = refsFromPayload(input.payload, input.refs);
  const units = runtimeExecutionUnits(input.payload);
  const failures = failureSignaturesFromPayload(input.payload);
  const protocolStatus = protocolStatusFromPayload(input.payload, units);
  const nextStepAttribution = nextStepAttributionFromPayload(input.payload, input.request, refs, failures, protocolStatus);
  const userSatisfactionProxy = userSatisfactionProxyFromPayload(input.payload, input.request, refs, protocolStatus, nextStepAttribution);
  const taskOutcome = taskOutcomeFromProjection(protocolStatus, input.payload, input.request, userSatisfactionProxy);
  const conversationProjectionRef = conversationProjectionRefFromContext(input.refs);
  const conversationEventLogRef = conversationEventLogRefFromContext(input.refs);
  const preliminaryCard = createTaskRunCard({
    taskId: input.skill?.id,
    title: input.skill?.manifest?.description ?? input.request?.skillDomain,
    goal: input.request?.prompt ?? input.payload.message,
    protocolStatus,
    taskOutcome,
    refs: withConversationEventLogRef(refs, conversationEventLogRef),
    executionUnits: units,
    verificationRefs: verificationRefsFromPayload(input.payload),
    failureSignatures: failures,
    genericAttributionLayer: nextStepAttribution.ownerLayer,
    nextStep: nextStepAttribution.nextStep,
    conversationProjectionRef,
  });
  const kernelProjection = conversationKernelFromTaskOutcome({
    payload: input.payload,
    request: input.request,
    refs,
    taskRunCard: preliminaryCard,
    protocolStatus,
    taskOutcome,
    nextStepAttribution,
  });
  const conversationProjection = kernelProjection.projection;
  const conversationEventLogDigestValue = conversationEventLogDigest(kernelProjection.log);
  const conversationProjectionSummary = conversationProjectionSummaryFromProjection(conversationProjection, nextStepAttribution);
  const taskRunCard = createTaskRunCard({
    taskId: input.skill?.id,
    title: input.skill?.manifest?.description ?? input.request?.skillDomain,
    goal: input.request?.prompt ?? input.payload.message,
    protocolStatus,
    taskOutcome,
    refs: withConversationEventLogRef(refs, conversationEventLogRef),
    executionUnits: units,
    verificationRefs: verificationRefsFromPayload(input.payload),
    failureSignatures: failures,
    genericAttributionLayer: nextStepAttribution.ownerLayer,
    nextStep: nextStepAttribution.nextStep,
    conversationProjectionRef,
    conversationProjectionSummary,
    noHardcodeReview: {
      appliesGenerally: true,
      generalityStatement: 'Gateway task outcome projection is derived from runtime payload status, evidence refs, expected artifacts, and execution unit semantics, not from prompt, scenario, paper, file, or backend names.',
      counterExamples: [
        'A syntactically valid payload that only promises future work should remain needs-work.',
        'A failed run with preserved partial refs should remain resumable instead of becoming complete.',
        'A transient provider failure should attribute recovery to the external-provider layer.',
      ],
    },
  });

  return {
    schemaVersion: TASK_OUTCOME_PROJECTION_SCHEMA_VERSION,
    taskRunCard,
    protocolSuccess: protocolStatus === 'protocol-success',
    taskSuccess: taskOutcome === 'satisfied',
    userSatisfactionProxy,
    nextStepAttribution,
    conversationEventLog: kernelProjection.log,
    conversationEventLogRef,
    conversationEventLogDigest: conversationEventLogDigestValue,
    projectionRestore: {
      schemaVersion: 'sciforge.gateway-projection-restore.v1',
      source: 'conversation-event-log',
      eventCount: kernelProjection.log.events.length,
      digest: conversationEventLogDigestValue,
      ref: conversationEventLogRef,
    },
    conversationProjection,
    ownershipLayerSuggestions: taskRunCard.ownershipLayerSuggestions,
    projectionRules: [
      'Protocol success means the backend returned a parseable contract; task success means the current user goal appears satisfied.',
      'User satisfaction proxy is inferred from visible answer quality, usable artifacts/refs, next-step detail, and repeat-work avoidance.',
      'Next-step attribution names the generic failing or owning runtime layer without prompt/scenario hardcoding.',
      'ConversationEventLog is the replayable truth source persisted with the outcome; ConversationProjection is restored by replaying that log.',
    ],
  };
}

function conversationKernelFromTaskOutcome(input: {
  payload: ToolPayload;
  request?: GatewayRequest;
  refs: TaskRunCardRef[];
  taskRunCard: TaskRunCard;
  protocolStatus: TaskProtocolStatus;
  taskOutcome: TaskOutcomeStatus;
  nextStepAttribution: NextStepAttribution;
}): { log: ConversationEventLog; projection: ConversationProjection } {
  const conversationId = `task-outcome:${input.taskRunCard.id}`;
  const turnId = `turn:${input.taskRunCard.id}`;
  const runId = `run:${input.taskRunCard.id}`;
  const timestamp = timestampFromPayload(input.payload);
  let log = createConversationEventLog(conversationId);
  log = appendConversationEvent(log, {
    id: `${conversationId}:turn`,
    type: 'TurnReceived',
    actor: 'user',
    storage: 'inline',
    timestamp,
    turnId,
    payload: {
      prompt: input.request?.prompt ?? input.payload.message,
      summary: input.request?.prompt ?? input.payload.message,
    },
  }).log;
  const harnessDecisionEvent = harnessDecisionEventFromTaskOutcome({
    payload: input.payload,
    request: input.request,
    conversationId,
    timestamp,
    turnId,
    runId,
  });
  if (harnessDecisionEvent) {
    log = appendConversationEvent(log, harnessDecisionEvent).log;
  }
  log = appendConversationEvent(log, {
    id: `${conversationId}:dispatch`,
    type: 'Dispatched',
    actor: 'kernel',
    storage: 'inline',
    timestamp,
    turnId,
    runId,
    payload: {
      summary: `protocol=${input.protocolStatus}; task=${input.taskOutcome}`,
    },
  }).log;
  const materializedRefs = conversationRefsFromTaskRefs(input.refs);
  if (materializedRefs.length) {
    log = appendConversationEvent(log, {
      id: `${conversationId}:materialized`,
      type: 'OutputMaterialized',
      actor: 'runtime',
      storage: 'ref',
      timestamp,
      turnId,
      runId,
      payload: {
        summary: 'Materialized refs from runtime payload.',
        refs: materializedRefs,
      },
    }).log;
  }
  const terminalEventType = terminalEventTypeForOutcome(input.protocolStatus, input.taskOutcome, input.nextStepAttribution.ownerLayer);
  const terminalRefs = materializedRefs.length ? materializedRefs : [{ ref: `task-card:${input.taskRunCard.id}`, label: 'TaskRunCard' }];
  const terminalFailureReason = terminalFailureReasonFromPayload(input.payload) ?? input.nextStepAttribution.reason;
  log = appendConversationEvent(log, {
    id: `${conversationId}:terminal`,
    type: terminalEventType,
    actor: 'runtime',
    storage: 'ref',
    timestamp,
    turnId,
    runId,
    payload: {
      text: terminalUserVisibleText(input.payload, input.request, input.protocolStatus, input.taskOutcome, input.nextStepAttribution),
      summary: terminalUserVisibleText(input.payload, input.request, input.protocolStatus, input.taskOutcome, input.nextStepAttribution),
      reason: terminalFailureReason,
      failureReason: terminalFailureReason,
      refs: terminalRefs,
    },
  }).log;
  const background = backgroundStateFromPayload(input.payload);
  if (background) {
    const foregroundPartialRef = background.foregroundPartialRef ?? materializedRefs[0]?.ref ?? background.checkpointRefs[0];
    log = background.checkpointRefs.length
      ? appendConversationEvent(log, {
          id: `${conversationId}:background`,
          type: background.status === 'completed' ? 'BackgroundCompleted' : 'BackgroundRunning',
          actor: 'runtime',
          storage: 'ref',
          timestamp,
          turnId,
          runId,
          payload: {
            summary: 'Background continuation state attached to task outcome projection.',
            revisionPlan: background.revisionPlan,
            foregroundPartialRef,
            refs: background.checkpointRefs.map((ref) => ({ ref, label: 'background checkpoint' })),
          },
        }).log
      : appendConversationEvent(log, {
          id: `${conversationId}:background`,
          type: background.status === 'completed' ? 'BackgroundCompleted' : 'BackgroundRunning',
          actor: 'runtime',
          storage: 'inline',
          timestamp,
          turnId,
          runId,
          payload: {
            summary: 'Background continuation state attached to task outcome projection.',
            revisionPlan: background.revisionPlan,
            foregroundPartialRef,
            checkpointRefs: background.checkpointRefs,
          },
        }).log;
  }
  const verificationRef = verificationRefsFromPayload(input.payload)[0];
  if (verificationRef) {
    log = appendConversationEvent(log, {
      id: `${conversationId}:verification`,
      type: 'VerificationRecorded',
      actor: 'verifier',
      storage: 'ref',
      timestamp,
      turnId,
      runId,
      payload: {
        summary: 'Verification evidence attached to task outcome projection.',
        verdict: verificationVerdictForKernel(input.payload.verificationResults?.[0]?.verdict),
        refs: [{ ref: verificationRef, label: 'verification' }],
      },
    }).log;
  }
  return {
    log,
    projection: projectConversation(log, replayConversationState(log)),
  };
}

function terminalUserVisibleText(
  payload: ToolPayload,
  request: GatewayRequest | undefined,
  protocolStatus: TaskProtocolStatus,
  taskOutcome: TaskOutcomeStatus,
  nextStep: NextStepAttribution,
) {
  if (protocolStatus === 'protocol-success' && verificationRequiredButUnsatisfied(payload, request)) {
    return [
      'Result artifacts are available, but required verification is still unverified; this cannot be counted as task success.',
      nextStep.nextStep,
      payload.message ? `Draft result summary: ${payload.message}` : undefined,
    ].filter(Boolean).join('\n\n');
  }
  if (protocolStatus === 'protocol-success' && taskOutcome !== 'satisfied') {
    return [
      'Partial result artifacts are available, but the user goal is not fully satisfied yet.',
      nextStep.nextStep ? `Next step: ${nextStep.nextStep}` : undefined,
      payload.message ? `Draft result summary: ${payload.message}` : undefined,
    ].filter(Boolean).join('\n\n');
  }
  return payload.message || nextStep.nextStep;
}

function harnessDecisionEventFromTaskOutcome(input: {
  payload: ToolPayload;
  request?: GatewayRequest;
  conversationId: string;
  timestamp: string;
  turnId: string;
  runId: string;
}): ConversationEvent | undefined {
  const decision = harnessDecisionFromAvailableSources(input.request, input.payload, input.turnId);
  if (!decision) return undefined;
  return {
    id: `${input.conversationId}:harness-decision`,
    type: 'HarnessDecisionRecorded',
    actor: 'kernel',
    storage: 'ref',
    timestamp: input.timestamp,
    turnId: input.turnId,
    runId: input.runId,
    payload: {
      schemaVersion: 'sciforge.harness-decision-record.v1',
      decisionId: decision.decisionId,
      profileId: decision.profileId,
      digest: decision.digest,
      summary: decision.summary,
      source: decision.source,
      contractRef: decision.contractRef,
      traceRef: decision.traceRef,
      refs: decision.refs,
    },
  };
}

function harnessDecisionFromAvailableSources(
  request: GatewayRequest | undefined,
  payload: ToolPayload,
  turnId: string,
) {
  const candidates = harnessDecisionCandidates(request, payload);
  const profileId = stringFromCandidates(candidates, ['profileId', 'harnessProfileId']);
  const contractRef = stringFromCandidates(candidates, ['contractRef', 'harnessContractRef']);
  const traceRef = stringFromCandidates(candidates, ['traceRef', 'harnessTraceRef']);
  const refs = uniqueConversationRefs([
    ...conversationRefsFromHarnessCandidates(candidates),
    ...(contractRef ? [{ ref: contractRef, label: 'harness contract' }] : []),
    ...(traceRef ? [{ ref: traceRef, label: 'harness trace' }] : []),
  ]);
  if (!profileId || refs.length === 0) return undefined;
  const decisionId = stringFromCandidates(candidates, ['decisionId', 'harnessDecisionId']) ?? `${turnId}:harness-decision`;
  const summary = harnessDecisionSummary(candidates, profileId);
  const source = candidates.find((candidate) => {
    return stringField(candidate.record.profileId)
      || stringField(candidate.record.harnessProfileId)
      || stringField(candidate.record.contractRef)
      || stringField(candidate.record.harnessContractRef)
      || stringField(candidate.record.traceRef)
      || stringField(candidate.record.harnessTraceRef);
  })?.source;
  const digest = stringFromCandidates(candidates, ['digest', 'decisionDigest', 'harnessDecisionDigest'])
    ?? digestHarnessDecision({
      decisionId,
      profileId,
      summary,
      contractRef,
      traceRef,
      refs: refs.map((ref) => ref.ref),
    });
  return {
    decisionId,
    profileId,
    digest,
    summary,
    source,
    contractRef,
    traceRef,
    refs,
  };
}

function harnessDecisionCandidates(request: GatewayRequest | undefined, payload: ToolPayload) {
  const requestRecord = (isRecord(request) ? request : {}) as Record<string, unknown>;
  const uiState = isRecord(request?.uiState) ? request.uiState : {};
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const requestMetadata = isRecord(requestRecord.metadata) ? requestRecord.metadata : {};
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const payloadMetadata = isRecord(payloadRecord.metadata) ? payloadRecord.metadata : {};
  const displayMetadata = isRecord(displayIntent.metadata) ? displayIntent.metadata : {};
  const candidates: Array<{ source: string; record: Record<string, unknown> }> = [];
  const add = (source: string, value: unknown) => {
    if (!isRecord(value)) return;
    candidates.push({ source, record: value });
    if (isRecord(value.summary)) candidates.push({ source: `${source}.summary`, record: value.summary });
  };

  add('request.uiState.agentHarness', uiState.agentHarness);
  add('request.uiState.agentHarnessHandoff', uiState.agentHarnessHandoff);
  add('request.uiState', uiState);
  add('request.metadata.agentHarness', requestMetadata.agentHarness);
  add('request.metadata.agentHarnessHandoff', requestMetadata.agentHarnessHandoff);
  add('request.metadata.harnessDecision', requestMetadata.harnessDecision);
  add('payload.metadata.agentHarness', payloadMetadata.agentHarness);
  add('payload.metadata.agentHarnessHandoff', payloadMetadata.agentHarnessHandoff);
  add('payload.metadata.harnessDecision', payloadMetadata.harnessDecision);
  add('payload.displayIntent.agentHarness', displayIntent.agentHarness);
  add('payload.displayIntent.agentHarnessHandoff', displayIntent.agentHarnessHandoff);
  add('payload.displayIntent.harnessDecision', displayIntent.harnessDecision);
  add('payload.displayIntent.metadata.agentHarness', displayMetadata.agentHarness);
  add('payload.displayIntent.metadata.agentHarnessHandoff', displayMetadata.agentHarnessHandoff);
  add('payload.displayIntent.metadata.harnessDecision', displayMetadata.harnessDecision);
  return candidates;
}

function stringFromCandidates(
  candidates: Array<{ record: Record<string, unknown> }>,
  fields: string[],
) {
  for (const candidate of candidates) {
    for (const field of fields) {
      const value = stringField(candidate.record[field]);
      if (value) return value;
    }
  }
  return undefined;
}

function harnessDecisionSummary(
  candidates: Array<{ record: Record<string, unknown> }>,
  profileId: string,
) {
  const explicit = stringFromCandidates(candidates, ['decisionSummary', 'summaryText', 'description', 'summary']);
  if (explicit) return explicit;
  const intentMode = stringFromCandidates(candidates, ['intentMode']);
  const explorationMode = stringFromCandidates(candidates, ['explorationMode']);
  return [
    `profile=${profileId}`,
    intentMode ? `intent=${intentMode}` : undefined,
    explorationMode ? `exploration=${explorationMode}` : undefined,
  ].filter(Boolean).join('; ');
}

function conversationRefsFromHarnessCandidates(candidates: Array<{ record: Record<string, unknown> }>): ConversationRef[] {
  const refs: ConversationRef[] = [];
  for (const candidate of candidates) {
    refs.push(
      ...refsFromUnknown(candidate.record.refs),
      ...refsFromUnknown(candidate.record.auditRefs),
      ...refsFromUnknown(candidate.record.sourceRefs),
      ...refsFromUnknown(candidate.record.promptDirectives),
    );
    const decisionRef = stringField(candidate.record.decisionRef) ?? stringField(candidate.record.harnessDecisionRef) ?? stringField(candidate.record.ref);
    if (decisionRef) refs.push({ ref: decisionRef, label: 'harness decision' });
    const contractRef = stringField(candidate.record.contractRef) ?? stringField(candidate.record.harnessContractRef);
    if (contractRef) refs.push({ ref: contractRef, label: 'harness contract' });
    const traceRef = stringField(candidate.record.traceRef) ?? stringField(candidate.record.harnessTraceRef);
    if (traceRef) refs.push({ ref: traceRef, label: 'harness trace' });
  }
  return refs;
}

function refsFromUnknown(value: unknown): ConversationRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ConversationRef[] => {
    if (typeof item === 'string' && item.trim()) return [{ ref: item.trim() }];
    if (!isRecord(item)) return [];
    const ref = stringField(item.ref) ?? stringField(item.id);
    if (!ref) return [];
    return [{
      ref,
      digest: stringField(item.digest),
      mime: stringField(item.mime),
      sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : undefined,
      label: stringField(item.label) ?? stringField(item.title) ?? stringField(item.kind),
    }];
  });
}

function uniqueConversationRefs(refs: ConversationRef[]): ConversationRef[] {
  const byRef = new Map<string, ConversationRef>();
  for (const ref of refs) {
    if (!ref.ref.trim()) continue;
    if (!byRef.has(ref.ref)) byRef.set(ref.ref, ref);
  }
  return [...byRef.values()];
}

function digestHarnessDecision(value: Record<string, unknown>) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function terminalEventTypeForOutcome(
  protocolStatus: TaskProtocolStatus,
  taskOutcome: TaskOutcomeStatus,
  ownerLayer: TaskAttributionLayer,
): ConversationEventType {
  if (ownerLayer === externalServiceLayer) return 'ExternalBlocked';
  if (protocolStatus === 'protocol-failed') return 'RepairNeeded';
  if (taskOutcome === 'satisfied') return 'Satisfied';
  if (taskOutcome === 'needs-human') return 'NeedsHuman';
  if (taskOutcome === 'needs-work') return 'DegradedResult';
  return 'RepairNeeded';
}

function conversationRefsFromTaskRefs(refs: TaskRunCardRef[]): ConversationRef[] {
  return refs.map((ref) => ({
    ref: ref.ref,
    label: ref.label,
  }));
}

function conversationProjectionRefFromContext(refs: GatewayTaskOutcomeProjectionContext['refs']) {
  return refs?.outputRel ? `${refs.outputRel}#displayIntent.conversationProjection` : undefined;
}

function conversationEventLogRefFromContext(refs: GatewayTaskOutcomeProjectionContext['refs']) {
  return refs?.outputRel ? `${refs.outputRel}#displayIntent.conversationEventLog` : undefined;
}

function conversationProjectionRefFromEventLogRef(ref: string | undefined) {
  return ref?.endsWith('#displayIntent.conversationEventLog')
    ? ref.replace(/#displayIntent\.conversationEventLog$/, '#displayIntent.conversationProjection')
    : undefined;
}

function withConversationEventLogRef(refs: TaskRunCardRef[], ref: string | undefined): TaskRunCardRef[] {
  return ref ? uniqueTaskRefs([...refs, { kind: 'other', ref, label: 'conversation event log' }]) : refs;
}

function conversationProjectionSummaryFromProjection(
  projection: ConversationProjection,
  fallback: NextStepAttribution,
): TaskRunCardConversationProjectionSummary {
  const visibleAnswer = projection.visibleAnswer;
  const failureDiagnostic = projection.diagnostics.find((diagnostic) => diagnostic.severity === 'error' || diagnostic.code);
  const recoverActions = uniqueStrings(projection.recoverActions);
  return {
    schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
    conversationId: projection.conversationId,
    status: visibleAnswer?.status ?? projection.activeRun?.status ?? 'idle',
    activeRunId: projection.activeRun?.id,
    failureOwner: failureDiagnostic
      ? {
          ownerLayer: failureDiagnostic.code || fallback.ownerLayer,
          reason: failureDiagnostic.message || fallback.reason,
          evidenceRefs: (failureDiagnostic.refs ?? []).map((ref) => ref.ref),
          nextStep: recoverActions[0] ?? fallback.nextStep,
        }
      : fallback.ownerLayer !== 'unknown' && recoverActions.length
        ? {
            ownerLayer: fallback.ownerLayer,
            reason: fallback.reason,
            evidenceRefs: fallback.sourceRefs,
            nextStep: recoverActions[0] ?? fallback.nextStep,
          }
        : undefined,
    recoverActions,
    verificationState: projection.verificationState,
    backgroundState: projection.backgroundState,
  };
}

function backgroundStateFromPayload(payload: ToolPayload): GatewayBackgroundProjectionState | undefined {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const candidate = isRecord(displayIntent.backgroundState)
    ? displayIntent.backgroundState
    : isRecord(displayIntent.backgroundContinuation)
      ? displayIntent.backgroundContinuation
      : undefined;
  if (!candidate) return undefined;
  const status = stringField(candidate.status);
  if (!status || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)) return undefined;
  return {
    status,
    checkpointRefs: uniqueStrings(toStringList(candidate.checkpointRefs)),
    revisionPlan: stringField(candidate.revisionPlan),
    foregroundPartialRef: stringField(candidate.foregroundPartialRef) ?? uniqueStrings(toStringList(candidate.checkpointRefs))[0],
  };
}

function verificationVerdictForKernel(value: unknown) {
  const text = String(value || '');
  if (text === 'pass') return 'pass';
  if (['fail', 'failed', 'uncertain', 'needs-human'].includes(text)) return 'failed';
  if (text === 'unverified') return 'unverified';
  return text || undefined;
}

function timestampFromPayload(payload: ToolPayload) {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  return stringField(displayIntent.updatedAt)
    ?? stringField(displayIntent.createdAt)
    ?? '1970-01-01T00:00:00.000Z';
}

function protocolStatusFromPayload(payload: ToolPayload, units: RuntimeExecutionUnit[]): TaskProtocolStatus {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const explicit = stringField(displayIntent.protocolStatus);
  if (isTaskProtocolStatus(explicit)) return explicit;
  const displayStatus = stringField(displayIntent.status);
  if (displayStatus === 'cancelled') return 'cancelled';
  if (displayStatus === 'running' || units.some((unit) => unit.status === 'running' || unit.status === 'planned')) return 'running';
  if (units.some((unit) => ['failed', 'failed-with-reason', 'repair-needed'].includes(unit.status))) return 'protocol-failed';
  if (payload.message || payload.artifacts.length || units.length || payload.claims.length) return 'protocol-success';
  return 'not-run';
}

function taskOutcomeFromProjection(
  protocolStatus: TaskProtocolStatus,
  payload: ToolPayload,
  request: GatewayRequest | undefined,
  proxy: UserSatisfactionProxy,
): TaskOutcomeStatus {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const explicit = stringField(displayIntent.taskOutcome);
  if (verificationRequiredButUnsatisfied(payload, request)) {
    if (explicit === 'needs-human' || proxy.status === 'needs-human') return 'needs-human';
    return 'needs-work';
  }
  if (isTaskOutcomeStatus(explicit)) return explicit;
  if (proxy.status === 'needs-human') return 'needs-human';
  if (proxy.status === 'blocked') return 'blocked';
  if (protocolStatus === 'running' || protocolStatus === 'not-run') return 'unknown';
  if (protocolStatus === 'cancelled') return 'blocked';
  if (protocolStatus === 'protocol-failed') return proxy.preservesWorkRefs || proxy.usableResultVisible ? 'needs-work' : 'blocked';
  return proxy.status === 'likely-satisfied' ? 'satisfied' : 'needs-work';
}

function requiredVerificationIsUnverified(payload: ToolPayload) {
  return (payload.verificationResults ?? []).some((result) => {
    if (result.verdict !== 'unverified') return false;
    const diagnostics = isRecord(result.diagnostics) ? result.diagnostics : {};
    return diagnostics.required === true;
  });
}

function verificationRequiredButUnsatisfied(payload: ToolPayload, request: GatewayRequest | undefined) {
  const verificationResults = payload.verificationResults ?? [];
  if (verificationBlockDisabledByPayload(payload) && !explicitVerificationRequiredByRequest(payload, request)) return false;
  if (requiredVerificationIsUnverified(payload)) {
    if (verificationBlockDisabledByLatency(request) || verificationBlockDisabledByPayload(payload)) {
      return explicitVerificationRequiredByRequest(payload, request);
    }
    return true;
  }
  if (!verificationRequiredByRequest(payload, request)) return false;
  return !verificationResults.some((result) => result.verdict === 'pass');
}

function verificationRequiredByRequest(payload: ToolPayload, request: GatewayRequest | undefined) {
  const policy = isRecord(request?.verificationPolicy) ? request?.verificationPolicy : undefined;
  if (policy?.required === true && !softHarnessVerificationCanUseNonBlockingLatency(request, policy)) return true;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const displayVerification = isRecord(displayIntent.verificationStatus) ? displayIntent.verificationStatus : {};
  const displayVerificationText = [
    stringField(displayVerification.status),
    stringField(displayVerification.verdict),
    stringField(displayVerification.response),
    stringField(displayVerification.summary),
    stringField(displayVerification.label),
  ].filter(Boolean).join(' ');
  const requestText = [request?.prompt].filter(Boolean).join('\n');
  const explicitVerificationRequest = explicitVerificationRequestPattern().test(requestText)
    || (explicitVerificationRequestPattern().test(requestText) && /unverified|未验证|no verification/i.test(displayVerificationText));
  if (request?.userExplicitVerification && !['none', 'unverified'].includes(request.userExplicitVerification)) return true;
  if (explicitVerificationRequest) return true;
  if (policy?.required === false || verificationBlockDisabledByLatency(request)) return false;
  return false;
}

function explicitVerificationRequiredByRequest(payload: ToolPayload, request: GatewayRequest | undefined) {
  const policy = isRecord(request?.verificationPolicy) ? request?.verificationPolicy : undefined;
  if (policy?.required === true && !softHarnessVerificationCanUseNonBlockingLatency(request, policy)) return true;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const displayVerification = isRecord(displayIntent.verificationStatus) ? displayIntent.verificationStatus : {};
  const displayVerificationText = [
    stringField(displayVerification.status),
    stringField(displayVerification.verdict),
    stringField(displayVerification.response),
    stringField(displayVerification.summary),
    stringField(displayVerification.label),
  ].filter(Boolean).join(' ');
  const requestText = [request?.prompt].filter(Boolean).join('\n');
  if (request?.userExplicitVerification && !['none', 'unverified'].includes(request.userExplicitVerification)) return true;
  return explicitVerificationRequestPattern().test(requestText)
    || (explicitVerificationRequestPattern().test(requestText) && /unverified|未验证|no verification/i.test(displayVerificationText));
}

function explicitVerificationRequestPattern() {
  return /\b(required verification|required verifier|verification required|must verify|verify before|human approval|release gate)\b|必须.{0,16}验证|验证.{0,16}必须|不能.{0,16}声称.{0,16}(完成|success|satisfied)|标记.{0,8}blocker|blocker/i;
}

function softHarnessVerificationCanUseNonBlockingLatency(
  request: GatewayRequest | undefined,
  policy: Record<string, unknown>,
) {
  if (!verificationBlockDisabledByLatency(request)) return false;
  if (requestExplicitlyRequiresBlockingVerification(request)) return false;
  if (policy.riskLevel === 'high' || policy.humanApprovalPolicy === 'required') return false;
  if (policy.mode !== 'lightweight') return false;
  const reason = stringField(policy.reason) ?? '';
  return /contractRef=runtime:\/\/agent-harness\/contracts\/|profileId=[^;]+|intensity=light|Harness policy consumed/i.test(reason);
}

function requestExplicitlyRequiresBlockingVerification(request: GatewayRequest | undefined) {
  if (!request) return false;
  if (request.userExplicitVerification && !['none', 'unverified'].includes(request.userExplicitVerification)) return true;
  if (toStringList(request.selectedActionIds).length > 0) return true;
  if (toStringList(request.actionSideEffects).length > 0) return true;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.humanApprovalPolicy === 'required') return true;
  return explicitVerificationRequestPattern().test(request.prompt ?? '');
}

function verificationBlockDisabledByLatency(request: GatewayRequest | undefined) {
  const uiState = isRecord(request?.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const conversationPolicySummary = isRecord(uiState.conversationPolicySummary) ? uiState.conversationPolicySummary : {};
  const latencyPolicy = isRecord(uiState.latencyPolicy)
    ? uiState.latencyPolicy
    : isRecord(conversationPolicy.latencyPolicy)
      ? conversationPolicy.latencyPolicy
      : isRecord(conversationPolicySummary.latencyPolicy)
        ? conversationPolicySummary.latencyPolicy
        : {};
  return latencyPolicy.blockOnVerification === false;
}

function verificationBlockDisabledByPayload(payload: ToolPayload) {
  const record = payload as unknown as Record<string, unknown>;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const verification = isRecord(displayIntent.verification) ? displayIntent.verification : {};
  const verificationStatus = isRecord(displayIntent.verificationStatus)
    ? displayIntent.verificationStatus
    : isRecord(record.verificationStatus)
      ? record.verificationStatus
      : {};
  const intentFirst = isRecord(record.intentFirstVerification) ? record.intentFirstVerification : {};
  const routing = isRecord(intentFirst.routing) ? intentFirst.routing : {};
  if (verification.nonBlocking === true) return true;
  if (verificationStatus.blocking === false) return true;
  if (stringField(routing.blockingPolicy) === 'non-blocking') return true;
  return (payload.workEvidence ?? []).some((item) => {
    return (item.diagnostics ?? []).some((diagnostic) => /blockingPolicy=non-blocking/i.test(diagnostic));
  });
}

function userSatisfactionProxyFromPayload(
  payload: ToolPayload,
  request: GatewayRequest | undefined,
  refs: TaskRunCardRef[],
  protocolStatus: TaskProtocolStatus,
  nextStep: NextStepAttribution,
): UserSatisfactionProxy {
  const units = toRecordList(payload.executionUnits);
  const expectedArtifactTypes = uniqueStrings([
    ...(request?.expectedArtifactTypes ?? []),
    ...toStringList(isRecord(request?.uiState) ? request?.uiState.expectedArtifactTypes : undefined),
  ]);
  const ignoreExpectedArtifactTypes = directContextReadOnlyPayloadSatisfiesWithoutExpectedArtifacts(payload);
  const openWorkStatus = openWorkStatusFromPayload(payload);
  const needsHuman = units.some((unit) => String(unit.status) === 'needs-human') || openWorkStatus === 'needs-human';
  const explicitFailure = protocolStatus === 'protocol-failed';
  const explicitAnswerStatus = explicitAnswerStatusFromPayload(payload);
  const answeredLatestRequest = explicitAnswerStatus === 'satisfied' && !hasCurrentReferenceFailure(payload);
  const usableResultVisible = hasUsableVisibleResult(payload);
  const expectedArtifactsPresent = ignoreExpectedArtifactTypes || expectedArtifactTypes.length === 0 || expectedArtifactTypes.some((type) => {
    return payload.artifacts.some((artifact) => isRecord(artifact) && artifactSemanticTypeCandidates(artifact).includes(type));
  });
  const structuredNextStep = Boolean(nextStep.nextStep);
  const preservesWorkRefs = refs.length > 0;
  const avoidsDuplicateWork = !explicitFailure || preservesWorkRefs || usableResultVisible;
  const requiredUnverified = verificationRequiredButUnsatisfied(payload, request);
  const reasons = [
    answeredLatestRequest ? 'structured task outcome marks the latest request satisfied' : 'latest request is not marked satisfied by structured outcome metadata',
    openWorkStatus ? `structured result still declares ${openWorkStatus}` : undefined,
    usableResultVisible ? 'usable answer/artifact evidence is visible' : 'no usable visible result or artifact was detected',
    expectedArtifactsPresent ? 'expected artifact coverage is present or not required' : 'one or more expected artifact types are missing',
    requiredUnverified ? 'required verification is explicitly unverified and cannot count as task success' : undefined,
    structuredNextStep ? 'structured next step is available' : 'structured next step is missing',
    preservesWorkRefs ? 'work refs are preserved for resume/audit' : 'no durable work refs are preserved',
    avoidsDuplicateWork ? 'projection can continue from existing refs' : 'rerun would risk repeating work without refs',
  ].filter((reason): reason is string => Boolean(reason));
  const score = Math.round(100 * [
    answeredLatestRequest,
    usableResultVisible,
    expectedArtifactsPresent,
    structuredNextStep,
    preservesWorkRefs,
    avoidsDuplicateWork,
  ].filter(Boolean).length / 6) / 100;
  const status = needsHuman
    ? 'needs-human'
    : requiredUnverified
      ? 'needs-work'
      : explicitFailure && !usableResultVisible && !preservesWorkRefs
      ? 'blocked'
      : protocolStatus === 'running' || protocolStatus === 'not-run'
        ? 'unknown'
        : score >= 0.75 && answeredLatestRequest && usableResultVisible && expectedArtifactsPresent
          ? 'likely-satisfied'
          : 'needs-work';
  return {
    schemaVersion: USER_SATISFACTION_PROXY_SCHEMA_VERSION,
    answeredLatestRequest,
    usableResultVisible,
    structuredNextStep,
    preservesWorkRefs,
    avoidsDuplicateWork,
    score,
    status,
    reasons,
  };
}

function directContextReadOnlyPayloadSatisfiesWithoutExpectedArtifacts(payload: ToolPayload) {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  if (stringField(displayIntent.taskOutcome) !== 'satisfied') return false;
  const units = toRecordList(payload.executionUnits);
  if (!units.some((unit) => stringField(unit.tool) === 'sciforge.direct-context-fast-path' && stringField(unit.status) === 'done')) return false;
  if (units.some((unit) => ['failed', 'failed-with-reason', 'repair-needed', 'needs-human'].includes(stringField(unit.status) ?? ''))) return false;
  const diagnosticText = [
    payload.message,
    ...payload.claims.map((claim) => isRecord(claim) ? stringField(claim.text) ?? '' : ''),
  ].join('\n');
  return !/Missing expected artifacts|缺失产物|cannot satisfy follow-up without expected artifacts/i.test(diagnosticText);
}

function artifactSemanticTypeCandidates(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  const raw = [
    String(artifact.type || ''),
    String(artifact.artifactType || ''),
    String(artifact.kind || ''),
    String(artifact.id || ''),
    String(metadata.type || ''),
    String(metadata.artifactType || ''),
    String(metadata.kind || ''),
  ].filter(Boolean);
  const text = [
    artifact.id,
    artifact.type,
    artifact.artifactType,
    artifact.kind,
    artifact.title,
    artifact.description,
    artifact.path,
    artifact.dataRef,
    metadata.title,
    metadata.description,
    metadata.reportRef,
    metadata.markdownRef,
    metadata.readableRef,
    data.title,
    data.summary,
    boundedSemanticText(data.markdown),
    boundedSemanticText(data.content),
  ].map(String).join(' ');
  if (/project[-_\s]?brief|research[-_\s]?report|grant[-_\s]?proposal/i.test(text)) raw.push('research-report');
  if (/risk[-_\s]?register|evidence[-_\s]?matrix/i.test(text)) raw.push('evidence-matrix');
  if (/decision[-_\s]?log|notebook[-_\s]?timeline/i.test(text)) raw.push('notebook-timeline');
  return uniqueStrings(raw);
}

function boundedSemanticText(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 4000) : '';
}

function nextStepAttributionFromPayload(
  payload: ToolPayload,
  request: GatewayRequest | undefined,
  refs: TaskRunCardRef[],
  failures: FailureSignatureInput[],
  protocolStatus: TaskProtocolStatus,
): NextStepAttribution {
  const units = toRecordList(payload.executionUnits);
  const evidence = payload.workEvidence ?? [];
  const verification = payload.verificationResults ?? [];
  const unitWithNextStep = units.find((unit) => stringField(unit.nextStep) || toStringList(unit.recoverActions).length);
  const workEvidenceWithNextStep = evidence.find((item) => item.nextStep || item.recoverActions.length);
  const verificationWithNextStep = verification.find((item) => item.repairHints?.length);
  const verificationGateUnsatisfied = protocolStatus === 'protocol-success' && verificationRequiredButUnsatisfied(payload, request);
  const nextStep = verificationGateUnsatisfied
    ? 'Run the required verifier or attach human approval before marking the task satisfied.'
    : stringField(unitWithNextStep?.nextStep)
    ?? toStringList(unitWithNextStep?.recoverActions)[0]
    ?? workEvidenceWithNextStep?.nextStep
    ?? workEvidenceWithNextStep?.recoverActions[0]
    ?? verificationWithNextStep?.repairHints?.[0]
    ?? defaultNextStepForPayload(payload, refs);
  const ownerLayer = verificationGateUnsatisfied ? 'verification' : layerFromPayload(payload, failures);
  return {
    schemaVersion: NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION,
    ownerLayer,
    nextStep,
    reason: reasonForLayer(ownerLayer),
    sourceRefs: refs.slice(0, 12).map((ref) => ref.ref),
    sourceSignals: uniqueStrings([
      ...units.map((unit) => stringField(unit.status)).filter((value): value is string => Boolean(value)),
      ...units.map((unit) => stringField(unit.externalDependencyStatus)).filter((value): value is string => Boolean(value)),
      ...failures.map((failure) => failure.kind).filter((value): value is NonNullable<typeof value> => Boolean(value)),
    ]),
  };
}

function failureSignaturesFromPayload(payload: ToolPayload): FailureSignatureInput[] {
  const units = toRecordList(payload.executionUnits);
  const fromUnits = units.flatMap((unit): FailureSignatureInput[] => {
    const message = stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message);
    const status = stringField(unit.status);
    if (!message && !['failed', 'failed-with-reason', 'repair-needed', 'needs-human'].includes(status ?? '')) return [];
    const externalTransient = stringField(unit.externalDependencyStatus) === transientUnavailableStatus;
    return [{
      kind: externalTransient ? 'external-transient' : undefined,
      message: message ?? status ?? 'Execution unit did not complete successfully.',
      layer: layerFromExecutionUnit(unit),
      retryable: externalTransient ? true : undefined,
      refs: unitRefs(unit),
    }];
  });
  const fromWorkEvidence = (payload.workEvidence ?? []).flatMap((evidence): FailureSignatureInput[] => {
    if (evidence.status === 'success') return [];
    const message = evidence.failureReason ?? evidence.nextStep ?? evidence.diagnostics?.[0];
    return message ? [{
      message,
      layer: 'verification',
      refs: uniqueStrings([...evidence.evidenceRefs, evidence.rawRef].filter((ref): ref is string => Boolean(ref))),
    }] : [];
  });
  return [...fromUnits, ...fromWorkEvidence];
}

function terminalFailureReasonFromPayload(payload: ToolPayload): string | undefined {
  const fromUnit = toRecordList(payload.executionUnits)
    .map((unit) => stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message))
    .find((value): value is string => Boolean(value));
  if (fromUnit) return fromUnit;
  const fromWorkEvidence = (payload.workEvidence ?? [])
    .map((evidence) => evidence.failureReason ?? evidence.diagnostics?.[0] ?? evidence.nextStep)
    .find((value): value is string => Boolean(value));
  if (fromWorkEvidence) return fromWorkEvidence;
  return payload.claimType === 'runtime-diagnostic' ? stringField(payload.message) : undefined;
}

function refsFromPayload(
  payload: ToolPayload,
  runtimeRefs: GatewayTaskOutcomeProjectionContext['refs'],
): TaskRunCardRef[] {
  const refs: TaskRunCardRef[] = [];
  for (const [key, ref] of Object.entries(runtimeRefs ?? {})) {
    if (typeof ref === 'string' && ref.trim()) refs.push({ kind: refKind(ref), ref, label: key });
  }
  for (const artifact of toRecordList(payload.artifacts)) {
    const ref = artifactRef(artifact);
    if (ref) refs.push({ kind: 'artifact', ref, label: stringField(artifact.title) ?? stringField(artifact.id) ?? stringField(artifact.type) });
  }
  for (const reference of toRecordList(payload.objectReferences)) {
    const ref = stringField(reference.ref) ?? stringField(reference.id);
    if (ref) refs.push({ kind: refKind(ref, stringField(reference.kind)), ref, label: stringField(reference.title), status: stringField(reference.status) });
  }
  for (const log of toRecordList(payload.logs)) {
    const ref = stringField(log.ref) ?? stringField(log.path);
    if (ref) refs.push({ kind: 'log', ref, label: stringField(log.kind) ?? stringField(log.label) });
  }
  for (const unit of toRecordList(payload.executionUnits)) {
    const id = stringField(unit.id);
    if (id) refs.push({ kind: 'execution-unit', ref: `execution-unit:${id}`, status: stringField(unit.status) });
    for (const ref of unitRefs(unit)) refs.push({ kind: refKind(ref), ref, label: id });
  }
  for (const ref of verificationRefsFromPayload(payload)) refs.push({ kind: 'verification', ref });
  return uniqueTaskRefs(refs);
}

function runtimeExecutionUnits(payload: ToolPayload): RuntimeExecutionUnit[] {
  return toRecordList(payload.executionUnits).map((unit, index) => ({
    id: stringField(unit.id) ?? `execution-unit-${index + 1}`,
    tool: stringField(unit.tool) ?? 'workspace-runtime-gateway',
    params: stringField(unit.params) ?? '{}',
    status: executionStatus(unit.status),
    hash: stringField(unit.hash) ?? String(index + 1),
    codeRef: stringField(unit.codeRef),
    stdoutRef: stringField(unit.stdoutRef),
    stderrRef: stringField(unit.stderrRef),
    outputRef: stringField(unit.outputRef),
    failureReason: stringField(unit.failureReason),
    recoverActions: toStringList(unit.recoverActions),
    nextStep: stringField(unit.nextStep),
    verificationRef: stringField(unit.verificationRef),
    verificationVerdict: verificationVerdict(unit.verificationVerdict),
  }));
}

function layerFromPayload(payload: ToolPayload, failures: FailureSignatureInput[]): TaskAttributionLayer {
  const units = toRecordList(payload.executionUnits);
  return failures.find((failure) => failure.layer)?.layer
    ?? units.map(layerFromExecutionUnit).find((layer) => layer !== 'unknown')
    ?? (payload.verificationResults?.some((result) => result.verdict !== 'pass') ? 'verification' : undefined)
    ?? 'runtime-server';
}

function layerFromExecutionUnit(unit: Record<string, unknown>): TaskAttributionLayer {
  if (stringField(unit.externalDependencyStatus) === transientUnavailableStatus) return externalServiceLayer;
  const refs = isRecord(unit.refs) ? unit.refs : {};
  if (isRecord(refs.validationFailure)) return 'payload-normalization';
  if (isRecord(refs.backendFailure)) return 'agentserver-parser';
  if (['fail', 'uncertain', 'needs-human'].includes(String(unit.verificationVerdict))) return 'verification';
  if (stringField(unit.failureKind) === 'missing-ref' || stringField(unit.failureCode) === 'missing-ref') return 'resume';
  if (stringField(unit.stderrRef) || stringField(unit.stdoutRef) || stringField(unit.outputRef)) return 'runtime-server';
  return 'unknown';
}

function defaultNextStepForPayload(payload: ToolPayload, refs: TaskRunCardRef[]) {
  const units = toRecordList(payload.executionUnits);
  if (units.some((unit) => stringField(unit.externalDependencyStatus) === transientUnavailableStatus)) {
    return 'Retry after provider backoff, or continue with cached evidence and label freshness explicitly.';
  }
  if (units.some((unit) => ['failed', 'failed-with-reason', 'repair-needed'].includes(String(unit.status)))) {
    return refs.length
      ? 'Inspect preserved refs and repair the generic failing layer before rerunning expensive work.'
      : 'Inspect the backend failure and return a structured failed-with-reason payload before rerun.';
  }
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  if (['partial', 'needs-work', 'unverified'].includes(String(displayIntent.status))
    || payload.verificationResults?.some((result) => result.verdict !== 'pass')) {
    return 'Continue from preserved partial refs, fill the missing evidence, or ask the user to adjust scope.';
  }
  return 'Inspect generated artifacts and preserve refs for follow-up, export, or audit.';
}

function reasonForLayer(layer: TaskAttributionLayer) {
  if (layer === externalServiceLayer) return 'Recovery depends on an external service becoming available or cached evidence being attached.';
  if (layer === 'payload-normalization') return 'The next step belongs to contract normalization because payload semantics or schema shape are incomplete.';
  if (layer === 'verification') return 'The next step belongs to verification because evidence or verifier verdicts are incomplete.';
  if (layer === 'resume') return 'The next step belongs to resume because referenced work must be located or refreshed.';
  if (layer === 'agentserver-parser') return 'The next step belongs to backend handoff parsing because runtime could not safely classify backend output.';
  if (layer === 'presentation') return 'The next step belongs to presentation because user-visible result projection is incomplete.';
  return 'The next step belongs to the runtime gateway because it owns task execution state, refs, and recovery.';
}

function hasUsableVisibleResult(payload: ToolPayload) {
  return payload.artifacts.some((artifact) => {
    if (!isRecord(artifact)) return false;
    const artifactType = stringField(artifact.type) ?? stringField(artifact.artifactType);
    if (artifactType === 'runtime-diagnostic') return false;
    return Boolean(
      stringField(artifact.title)
      || stringField(artifact.path)
      || stringField(artifact.dataRef)
      || stringField(artifact.imageRef)
      || isRecord(artifact.data)
    );
  }) || toRecordList(payload.uiManifest).some((slot) => Boolean(stringField(slot.artifactRef)));
}

function explicitAnswerStatusFromPayload(payload: ToolPayload) {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const taskOutcome = stringField(displayIntent.taskOutcome);
  if (['needs-work', 'needs-human', 'blocked', 'unknown'].includes(taskOutcome ?? '')) return taskOutcome;
  const openWorkStatus = openWorkStatusFromPayload(payload);
  if (openWorkStatus) return openWorkStatus;
  if (taskOutcome === 'satisfied') return 'satisfied';
  const answerStatus = stringField(displayIntent.answerStatus) ?? stringField(displayIntent.userGoalStatus);
  if (answerStatus === 'satisfied' || answerStatus === 'answered') return 'satisfied';
  if (['needs-work', 'needs-human', 'blocked', 'unknown'].includes(answerStatus ?? '')) return answerStatus;
  if (completeResultPresentationAnswersRequest(displayIntent.resultPresentation, payload)) return 'satisfied';
  return undefined;
}

function openWorkStatusFromPayload(payload: ToolPayload): TaskOutcomeStatus | undefined {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const statuses = [
    ...toRecordList(payload.claims).flatMap(openWorkStatusRecordFields),
    ...resultPresentationOpenWorkStatuses(displayIntent.resultPresentation),
  ].map(normalizeOpenWorkStatus);
  if (statuses.includes('needs-human')) return 'needs-human';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('needs-work')) return 'needs-work';
  return undefined;
}

function resultPresentationOpenWorkStatuses(resultPresentation: unknown) {
  if (!isRecord(resultPresentation)) return [];
  return toRecordList(resultPresentation.keyFindings).flatMap(openWorkStatusRecordFields);
}

function openWorkStatusRecordFields(record: Record<string, unknown>) {
  return [
    stringField(record.status),
    stringField(record.verdict),
    stringField(record.verificationState),
    stringField(record.answerStatus),
    stringField(record.taskOutcome),
  ].filter((value): value is string => Boolean(value));
}

function normalizeOpenWorkStatus(value: unknown): TaskOutcomeStatus | undefined {
  const text = typeof value === 'string' ? value.toLowerCase().trim().replaceAll(/[\s_]+/g, '-') : '';
  if (['needs-human', 'human-required', 'needs-human-approval'].includes(text)) return 'needs-human';
  if (['blocked', 'failed', 'failed-with-reason', 'repair-needed'].includes(text)) return 'blocked';
  if (['needs-work', 'blocker', 'partial', 'incomplete'].includes(text)) return 'needs-work';
  return undefined;
}

function hasCurrentReferenceFailure(payload: ToolPayload) {
  return toRecordList(payload.executionUnits).some((unit) => String(unit.id || '').startsWith('current-reference-usage-'));
}

function completeResultPresentationAnswersRequest(resultPresentation: unknown, payload: ToolPayload) {
  if (!isRecord(resultPresentation)) return false;
  if (stringField(resultPresentation.status) !== 'complete') return false;
  if (!toRecordList(resultPresentation.answerBlocks).length) return false;
  const artifactActions = toRecordList(resultPresentation.artifactActions);
  const keyFindings = toRecordList(resultPresentation.keyFindings);
  const citedFindings = keyFindings.filter((finding) => [
    ...toStringList(finding.citationIds),
    ...toStringList(finding.citations),
  ].length > 0);
  const payloadHasStructuredEvidence = payload.claims.length > 0
    || payload.artifacts.some((artifact) => isRecord(artifact) && stringField(artifact.type) !== 'runtime-diagnostic');
  return payloadHasStructuredEvidence && (artifactActions.length > 0 || citedFindings.length > 0);
}

function artifactRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.ref)
    ?? stringField(artifact.outputRef)
    ?? stringField(artifact.imageRef)
    ?? stringField(metadata.artifactRef)
    ?? stringField(metadata.outputRef)
    ?? stringField(metadata.reportRef);
}

function unitRefs(unit: Record<string, unknown>) {
  return uniqueStrings([
    stringField(unit.codeRef),
    stringField(unit.outputRef),
    stringField(unit.stdoutRef),
    stringField(unit.stderrRef),
    stringField(unit.diffRef),
    stringField(unit.verificationRef),
    ...toStringList(unit.outputArtifacts),
    ...toStringList(unit.artifacts),
  ].filter((ref): ref is string => Boolean(ref)));
}

function verificationRefsFromPayload(payload: ToolPayload) {
  return uniqueStrings((payload.verificationResults ?? []).flatMap((result, index) => [
    result.id ? `verification:${result.id}` : `verification:${index + 1}`,
    ...result.evidenceRefs,
  ]));
}

function refKind(ref: string, declaredKind?: string): TaskRunCardRef['kind'] {
  if (declaredKind === 'artifact') return 'artifact';
  if (declaredKind === 'execution-unit') return 'execution-unit';
  if (declaredKind === 'verification') return 'verification';
  if (declaredKind === 'log') return 'log';
  if (declaredKind === 'screenshot' || declaredKind === 'screenshot-region') return 'screenshot';
  if (/^run:/i.test(ref)) return 'run';
  if (/^artifact[:]|\.sciforge\/(?:sessions\/[^/]+\/)?(?:artifacts|task-results|exports)\//i.test(ref)) return 'artifact';
  if (/^execution-unit:/i.test(ref)) return 'execution-unit';
  if (/^verification:/i.test(ref)) return 'verification';
  if (/stdout|stderr|\.log$/i.test(ref)) return 'log';
  if (/screenshot|\.(?:png|jpg|jpeg|webp)$/i.test(ref)) return 'screenshot';
  if (/^file:|^\./i.test(ref)) return 'file';
  return 'other';
}

function uniqueTaskRefs(refs: TaskRunCardRef[]) {
  const byKey = new Map<string, TaskRunCardRef>();
  for (const ref of refs) {
    if (!ref.ref.trim()) continue;
    byKey.set(`${ref.kind}:${ref.ref}`, ref);
  }
  return [...byKey.values()].sort((left, right) => `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`));
}

function executionStatus(value: unknown): RuntimeExecutionUnit['status'] {
  const text = String(value || '');
  return ['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(text)
    ? text as RuntimeExecutionUnit['status']
    : 'done';
}

function verificationVerdict(value: unknown): RuntimeExecutionUnit['verificationVerdict'] | undefined {
  const text = String(value || '');
  return ['pass', 'fail', 'uncertain', 'needs-human', 'unverified'].includes(text)
    ? text as RuntimeExecutionUnit['verificationVerdict']
    : undefined;
}

function isTaskProtocolStatus(value: unknown): value is TaskProtocolStatus {
  return ['not-run', 'running', 'protocol-success', 'protocol-failed', 'cancelled'].includes(String(value));
}

function isTaskOutcomeStatus(value: unknown): value is TaskOutcomeStatus {
  return ['satisfied', 'needs-work', 'needs-human', 'blocked', 'unknown'].includes(String(value));
}

function isGatewayTaskOutcomeProjection(value: unknown): value is GatewayTaskOutcomeProjection {
  return isRecord(value)
    && value.schemaVersion === TASK_OUTCOME_PROJECTION_SCHEMA_VERSION
    && isValidTaskRunCard(value.taskRunCard);
}

function isValidTaskRunCard(value: unknown): value is TaskRunCard {
  return validateTaskRunCard(value).length === 0;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
