import { isRecord } from '../gateway-utils.js';
import { planConversationRecovery } from './conversation-recovery-policy.js';
import { normalizeWorkspaceProcessEvents } from './workspace-event-normalizer.js';

export const CONVERSATION_ACCEPTANCE_PLAN_SCHEMA_VERSION = 'sciforge.conversation.acceptance-plan.v1' as const;

type JsonMap = Record<string, unknown>;

export interface ConversationServicePlan {
  acceptancePlan: JsonMap;
  userVisiblePlan: JsonMap[];
  processStage: JsonMap;
  auditTrace: JsonMap[];
  metadata: JsonMap;
}

export interface ConversationTurnComposition {
  contextSession: JsonMap;
  currentReferences: JsonMap[];
  recentFailures: unknown[];
  priorAttempts: unknown[];
  userGuidanceQueue: unknown[];
  selectedTools: unknown[];
  selectedSenses: unknown[];
  selectedVerifiers: unknown[];
  recoveryPlan: JsonMap;
  executionClassifierInput?: JsonMap;
}

export function buildConversationServiceErrorResponse(request: unknown): JsonMap {
  const data = recordValue(request);
  const error = recordValue(data.error);
  return {
    schemaVersion: 'sciforge.conversation-policy.response.v1',
    requestId: data.requestId ?? null,
    status: 'failed',
    goalSnapshot: { text: '', mode: 'ambiguous', explicitRefs: [] },
    contextPolicy: { mode: 'ambiguous' },
    handoffMemoryProjection: {},
    currentReferences: [],
    currentReferenceDigests: [],
    artifactIndex: {},
    capabilityBrief: { selected: [], excluded: [], auditTrace: [] },
    executionModePlan: {},
    handoffPlan: { fallback: { tsRuntimeFallback: true } },
    acceptancePlan: {},
    recoveryPlan: {},
    latencyPolicy: {
      schemaVersion: 'sciforge.conversation.latency-policy.v1',
      firstVisibleResponseMs: 8000,
      firstEventWarningMs: 18000,
      silentRetryMs: 60000,
      allowBackgroundCompletion: false,
      blockOnContextCompaction: true,
      blockOnVerification: true,
      reason: 'safe default after policy service failure',
    },
    responsePlan: {
      schemaVersion: 'sciforge.conversation.response-plan.v1',
      initialResponseMode: 'wait-for-result',
      finalizationMode: 'append-final',
      userVisibleProgress: ['failed'],
      fallbackMessagePolicy: 'safety-first-status-with-required-confirmation',
      reason: 'safe default after policy service failure',
    },
    backgroundPlan: {
      schemaVersion: 'sciforge.conversation.background-plan.v1',
      enabled: false,
      tasks: [],
      handoffRefsRequired: true,
      cancelOnNewUserTurn: true,
      reason: 'safe default after policy service failure',
    },
    cachePolicy: {
      schemaVersion: 'sciforge.conversation.cache-policy.v1',
      reuseScenarioPlan: false,
      reuseSkillPlan: false,
      reuseUiPlan: false,
      reuseUIPlan: false,
      reuseReferenceDigests: false,
      reuseArtifactIndex: false,
      reuseLastSuccessfulStage: false,
      reuseBackendSession: false,
      reason: 'safe default after policy service failure',
    },
    userVisiblePlan: [],
    processStage: {
      phase: 'failed',
      summary: 'Conversation policy request failed.',
    },
    auditTrace: [
      {
        event: 'schema.rejected',
        expectedRequestSchemaVersion: 'sciforge.conversation-policy.request.v1',
      },
    ],
    errors: [{ type: stringValue(error.type) ?? 'Error', message: stringValue(error.message) ?? 'unknown failure' }],
    metadata: { service: 'sciforge_conversation.service' },
  };
}

export function buildConversationPolicyInput(request: unknown): JsonMap {
  const data = recordValue(request);
  const turn = recordValue(data.turn);
  const history = recordList(data.history);
  const session = sessionForPolicy(data.session, history);
  const prompt = stringValue(turn.text) ?? stringValue(turn.prompt) ?? stringValue(data.prompt) ?? '';
  const refs = recordList(turn.refs).length
    ? recordList(turn.refs)
    : recordList(turn.references).length
      ? recordList(turn.references)
      : recordList(data.references).length
        ? recordList(data.references)
        : recordList(data.refs);
  const limits = {
    ...recordValue(data.limits),
    ...recordValue(data.policyHints),
  };

  return {
    schemaVersion: data.schemaVersion,
    requestId: data.requestId,
    turn: {
      turnId: turn.turnId,
      prompt,
      references: refs,
    },
    prompt,
    turnId: turn.turnId,
    references: refs,
    refs,
    history,
    session,
    workspace: recordValue(data.workspace),
    limits,
    policyHints: recordValue(data.policyHints),
    capabilities: recordList(data.capabilities),
    tsDecisions: recordValue(data.tsDecisions),
    metadata: recordValue(data.metadata),
    rawTurn: { ...turn },
  };
}

export const buildConversationPolicyInputFromRequest = buildConversationPolicyInput;

export function buildConversationServicePlan(request: unknown): ConversationServicePlan {
  const data = recordValue(request);
  const policyInput = recordValue(data.policyInput);
  const goalSnapshot = recordValue(data.goalSnapshot);
  const contextPolicy = recordValue(data.contextPolicy);
  const handoffPlan = recordValue(data.handoffPlan);

  return {
    acceptancePlan: acceptancePlan(goalSnapshot, handoffPlan),
    userVisiblePlan: userVisiblePlan(policyInput, goalSnapshot, contextPolicy, handoffPlan),
    processStage: {
      phase: 'planning',
      summary: 'Conversation policy request evaluated.',
      visibleDetail: 'Goal, context, references, capabilities, handoff, and recovery plans are ready.',
    },
    auditTrace: auditTrace(data),
    metadata: { service: 'sciforge_conversation.service' },
  };
}

export const buildConversationServicePlanFromRequest = buildConversationServicePlan;

export function buildConversationTurnComposition(request: unknown): ConversationTurnComposition {
  const data = recordValue(request);
  const policyInput = recordValue(data.policyInput);
  const session = recordValue(policyInput.session ?? data.session);
  const contextPolicy = recordValue(data.contextPolicy);
  const handoffMemoryProjection = recordValue(data.handoffMemoryProjection);
  const currentReferenceDigests = recordList(data.currentReferenceDigests);
  const contextSession = contextSessionForPolicy(session, contextPolicy, handoffMemoryProjection);
  const currentReferences = currentReferencesForTurn(policyInput, currentReferenceDigests);
  const recentFailures = recentFailuresForTurn(policyInput);
  const priorAttempts = priorAttemptsForTurn(policyInput);
  const userGuidanceQueue = userGuidanceQueueForTurn(policyInput);
  const selectedTools = selectedPolicyList(policyInput, 'selectedTools', 'tools');
  const selectedSenses = selectedPolicyList(policyInput, 'selectedSenses', 'senses');
  const selectedVerifiers = selectedPolicyList(policyInput, 'selectedVerifiers', 'verifiers');
  const tsDecisions = recordValue(policyInput.tsDecisions);
  const turnExecutionConstraints = optionalRecord(data.turnExecutionConstraints)
    ?? optionalRecord(recordValue(data.goalSnapshot).turnExecutionConstraints)
    ?? optionalRecord(tsDecisions.turnExecutionConstraints)
    ?? {};

  return {
    contextSession,
    currentReferences,
    recentFailures,
    priorAttempts,
    userGuidanceQueue,
    selectedTools,
    selectedSenses,
    selectedVerifiers,
    recoveryPlan: recoveryPlanForTurn(policyInput, currentReferenceDigests, priorAttempts),
    executionClassifierInput: {
      prompt: policyInput.prompt,
      refs: classifierRefsForTurn(policyInput, currentReferences),
      currentReferences,
      currentReferenceDigests,
      artifacts: recordList(contextSession.artifacts),
      contextPolicy,
      handoffMemoryProjection,
      goalSnapshot: recordValue(data.goalSnapshot),
      capabilityBrief: recordValue(data.capabilityBrief),
      turnExecutionConstraints,
      tsDecisions,
      expectedArtifactTypes: arrayValue(recordValue(data.goalSnapshot).requiredArtifacts),
      selectedCapabilities: arrayValue(recordValue(data.capabilityBrief).selected),
      selectedTools,
      selectedSenses,
      selectedVerifiers,
      recentFailures,
      priorAttempts,
      userGuidanceQueue,
    },
  };
}

export const buildConversationTurnCompositionFromRequest = buildConversationTurnComposition;

function acceptancePlan(goalSnapshot: JsonMap, handoffPlan: JsonMap): JsonMap {
  return {
    schemaVersion: CONVERSATION_ACCEPTANCE_PLAN_SCHEMA_VERSION,
    deferEvaluationUntilOutput: true,
    criteria: arrayValue(goalSnapshot.acceptanceCriteria),
    requiredArtifacts: arrayValue(handoffPlan.requiredArtifacts),
    policy: 'do-not-mark-success-until-required-artifacts-and-refs-pass',
  };
}

function userVisiblePlan(
  policyInput: JsonMap,
  goalSnapshot: JsonMap,
  contextPolicy: JsonMap,
  handoffPlan: JsonMap,
): JsonMap[] {
  const metadata = recordValue(policyInput.metadata);
  const rawEvents = metadata.rawEvents;
  if (Array.isArray(rawEvents) || isRecord(rawEvents)) {
    return normalizeWorkspaceProcessEvents(rawEvents).events.map((event) => recordValue({ ...event }));
  }
  return [
    {
      phase: 'plan',
      title: '识别当前目标',
      detail: stringValue(goalSnapshot.normalizedPrompt) ?? stringValue(policyInput.prompt) ?? '',
    },
    {
      phase: 'plan',
      title: '选择上下文策略',
      detail: stringValue(recordValue(contextPolicy.pollutionGuard).reason) ?? stringValue(contextPolicy.mode),
    },
    {
      phase: 'plan',
      title: '准备执行交接',
      detail: stringValue(handoffPlan.status) ?? 'ready',
    },
  ];
}

function contextSessionForPolicy(session: JsonMap, contextPolicy: JsonMap, _handoffMemoryProjection: JsonMap): JsonMap {
  const mode = stringValue(contextPolicy.mode) ?? '';
  const historyReuse = recordValue(contextPolicy.historyReuse);
  const allowHistory = historyReuse.allowed === true || ['continue', 'repair'].includes(mode);
  if (allowHistory) return session;
  return {
    ...session,
    artifacts: [],
    executionUnits: [],
    runs: [],
    messages: [],
  };
}

function sessionForPolicy(value: unknown, history: JsonMap[]): JsonMap {
  const session = { ...recordValue(value) };
  if (!Array.isArray(session.messages) && history.length > 0) session.messages = history;
  if (!Array.isArray(session.artifacts)) session.artifacts = [];
  if (!Array.isArray(session.executionUnits)) session.executionUnits = [];
  return session;
}

function currentReferencesForTurn(policyInput: JsonMap, currentReferenceDigests: JsonMap[]): JsonMap[] {
  const explicit = recordList(policyInput.references).length > 0
    ? recordList(policyInput.references)
    : recordList(policyInput.refs);
  if (explicit.length > 0) return explicit;
  return currentReferenceDigests.flatMap((digest) => {
    const sourceRef = stringValue(digest.path)
      ?? stringValue(digest.sourceRef)
      ?? stringValue(digest.clickableRef);
    if (!sourceRef) return [];
    const ref = sourceRef.replace(/^file:/, '');
    return [{
      kind: 'file',
      ref,
      title: ref.split('/').filter(Boolean).at(-1) ?? ref,
      source: 'runtime-reference-digest',
      digestId: digest.id,
    }];
  });
}

function classifierRefsForTurn(policyInput: JsonMap, currentReferences: JsonMap[]): JsonMap[] {
  const explicit = recordList(policyInput.references).length > 0
    ? recordList(policyInput.references)
    : recordList(policyInput.refs);
  if (explicit.length > 0) return explicit;
  return currentReferences;
}

function recoveryPlanForTurn(policyInput: JsonMap, currentReferenceDigests: JsonMap[], priorAttempts: unknown[]): JsonMap {
  const hints = recordValue(policyInput.policyHints);
  const metadata = recordValue(policyInput.metadata);
  const failure = optionalRecord(hints.failure) ?? optionalRecord(metadata.failure);
  if (failure) {
    return { ...planConversationRecovery({
      failure,
      digests: currentReferenceDigests,
      attempts: priorAttempts,
    }) };
  }
  return {
    schemaVersion: 'sciforge.conversation.recovery-plan.v1',
    status: 'ready',
    retryable: true,
    strategies: [
      'repair-on-acceptance-failed',
      'digest-recovery-on-silent-stream',
      'failed-with-reason-after-budget',
    ],
  };
}

function recentFailuresForTurn(policyInput: JsonMap): unknown[] {
  const hints = recordValue(policyInput.policyHints);
  const metadata = recordValue(policyInput.metadata);
  const failures: unknown[] = [];
  for (const candidate of [
    hints.recentFailures,
    hints.failures,
    hints.failure ? [hints.failure] : undefined,
    metadata.recentFailures,
  ]) {
    if (Array.isArray(candidate)) failures.push(...candidate);
  }
  for (const run of recordList(recordValue(policyInput.session).runs)) {
    if (['failed', 'error'].includes((stringValue(run.status) ?? '').toLowerCase())) failures.push(run);
  }
  return failures;
}

function priorAttemptsForTurn(policyInput: JsonMap): unknown[] {
  const hints = recordValue(policyInput.policyHints);
  const metadata = recordValue(policyInput.metadata);
  const session = recordValue(policyInput.session);
  const attempts: unknown[] = [];
  for (const candidate of [
    hints.priorAttempts,
    hints.attempts,
    metadata.priorAttempts,
    metadata.attempts,
    session.attempts,
    session.runs,
    session.executionUnits,
  ]) {
    if (Array.isArray(candidate)) attempts.push(...candidate);
  }
  return attempts;
}

function userGuidanceQueueForTurn(policyInput: JsonMap): unknown[] {
  const hints = recordValue(policyInput.policyHints);
  const metadata = recordValue(policyInput.metadata);
  const session = recordValue(policyInput.session);
  for (const candidate of [
    hints.userGuidanceQueue,
    hints.guidanceQueue,
    metadata.userGuidanceQueue,
    session.userGuidanceQueue,
    session.guidanceQueue,
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function selectedPolicyList(policyInput: JsonMap, ...keys: string[]): unknown[] {
  for (const source of [
    recordValue(policyInput.policyHints),
    recordValue(policyInput.metadata),
    recordValue(policyInput.tsDecisions),
  ]) {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function auditTrace(data: JsonMap): JsonMap[] {
  const requestSchemaVersion = stringValue(data.requestSchemaVersion)
    ?? stringValue(recordValue(data.policyInput).schemaVersion);
  const responseSchemaVersion = stringValue(data.responseSchemaVersion)
    ?? 'sciforge.conversation-policy.response.v1';
  const goalSnapshot = recordValue(data.goalSnapshot);
  const contextPolicy = recordValue(data.contextPolicy);
  const handoffMemoryProjection = recordValue(data.handoffMemoryProjection);
  const capabilityBrief = recordValue(data.capabilityBrief);
  const executionModePlan = recordValue(data.executionModePlan);
  const handoffPlan = recordValue(data.handoffPlan);
  const latencyPolicy = recordValue(data.latencyPolicy);
  const responsePlan = recordValue(data.responsePlan);
  const backgroundPlan = recordValue(data.backgroundPlan);
  const cachePolicy = recordValue(data.cachePolicy);

  return [
    {
      event: 'schema.accepted',
      requestSchemaVersion,
      responseSchemaVersion,
    },
    { event: 'module.goal_snapshot', schemaVersion: goalSnapshot.schemaVersion },
    { event: 'module.context_policy', schemaVersion: contextPolicy.schemaVersion },
    { event: 'module.handoff_projection', schemaVersion: handoffMemoryProjection.schemaVersion },
    { event: 'module.current_refs', count: arrayValue(data.currentReferenceDigests).length },
    { event: 'module.capability_broker', selected: arrayValue(capabilityBrief.selected).length },
    { event: 'module.execution_classifier', mode: executionModePlan.executionMode },
    { event: 'module.handoff_planner', status: handoffPlan.status },
    { event: 'module.latency_policy', schemaVersion: latencyPolicy.schemaVersion },
    { event: 'module.response_plan', schemaVersion: responsePlan.schemaVersion },
    { event: 'module.background_plan', schemaVersion: backgroundPlan.schemaVersion },
    { event: 'module.cache_policy', schemaVersion: cachePolicy.schemaVersion },
  ];
}

function recordValue(value: unknown): JsonMap {
  return isRecord(value) ? value : {};
}

function optionalRecord(value: unknown): JsonMap | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordList(value: unknown): JsonMap[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => ({ ...item })) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
