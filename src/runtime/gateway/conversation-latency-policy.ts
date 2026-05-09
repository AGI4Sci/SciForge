export const CONVERSATION_LATENCY_POLICY_SCHEMA_VERSION = 'sciforge.conversation.latency-policy.v1' as const;

type JsonMap = Record<string, unknown>;

export interface ConversationLatencyPolicy {
  schemaVersion: typeof CONVERSATION_LATENCY_POLICY_SCHEMA_VERSION;
  firstVisibleResponseMs: number;
  firstEventWarningMs: number;
  silentRetryMs: number;
  allowBackgroundCompletion: boolean;
  blockOnContextCompaction: boolean;
  blockOnVerification: boolean;
  reason: string;
}

const FAST_FIRST_VISIBLE_MS = 1200;
const STANDARD_FIRST_VISIBLE_MS = 3000;
const WAIT_FIRST_VISIBLE_MS = 8000;
const FAST_WARNING_MS = 8000;
const STANDARD_WARNING_MS = 12000;
const WAIT_WARNING_MS = 18000;
const STANDARD_SILENT_RETRY_MS = 45000;
const BLOCKING_SILENT_RETRY_MS = 60000;

const HIGH_RISK_WORDS = new Set([
  'critical',
  'dangerous',
  'delete',
  'destructive',
  'external-write',
  'high',
  'modify-credentials',
  'payment',
  'publish',
  'send-message',
  'write',
]);

export function buildConversationLatencyPolicy(request: unknown): ConversationLatencyPolicy {
  const data = recordValue(request) ?? {};
  const policyInput = firstRecord(data.policyInput, data.policy_input, data);
  const goal = firstRecord(data.goalSnapshot, data.goal_snapshot);
  const context = firstRecord(data.contextPolicy, data.context_policy);
  const execution = firstRecord(data.executionModePlan, data.execution_mode_plan);
  const capability = firstRecord(data.capabilityBrief, data.capability_brief);
  const recovery = firstRecord(data.recoveryPlan, data.recovery_plan);

  const selectedActions = collectSelectedActions(policyInput, capability);
  const selectedVerifiers = collectSelectedVerifiers(policyInput, capability, execution);
  const recentFailures = recentFailuresFor(policyInput, recovery);
  const guidance = userGuidance(policyInput);
  const allSelected = [...selectedActions, ...selectedVerifiers, ...selectedCapabilities(capability)];

  const executionMode = textValue(execution.executionMode);
  const signals = stringSet(execution.signals);
  const riskFlags = stringSet(execution.riskFlags);
  const contextMode = textValue(context.mode);

  const reasons: string[] = [];
  const blockingReasons: string[] = [];
  if (hasHumanApprovalRequired(policyInput, allSelected)) {
    blockingReasons.push('human approval required');
  }
  if (hasHighRiskAction(selectedActions, allSelected, riskFlags)) {
    blockingReasons.push('high-risk action');
  }
  if (selectedActions.length > 0) {
    blockingReasons.push('selected action requires foreground execution');
  }
  if (hasFailedVerification(policyInput, recovery, recentFailures)) {
    blockingReasons.push('failed verification');
  }

  const hasRepairSignal = signals.has('repair')
    || contextMode === 'repair'
    || goal.taskRelation === 'repair'
    || recentFailures.length > 0;
  const hasVerificationWork = selectedVerifiers.length > 0 || signals.has('verifier');
  const contextNearLimit = isContextNearLimit(policyInput, context);

  const directContext = executionMode === 'direct-context-answer';
  const lowRiskContinuation = executionMode === 'repair-or-continue-project'
    && signals.has('continuation')
    && !signals.has('repair')
    && guidance.length === 0
    && recentFailures.length === 0
    && selectedActions.length === 0
    && selectedVerifiers.length === 0
    && !hasHighRiskAction([], allSelected, riskFlags);
  const lightLookup = executionMode === 'thin-reproducible-adapter';
  const multiStage = executionMode === 'multi-stage-project';

  const blockOnContextCompaction = contextNearLimit;
  const blockOnVerification = blockingReasons.length > 0 || hasRepairSignal || hasVerificationWork || multiStage;
  const allowBackgroundCompletion = allowBackground({
    directContext,
    lowRiskContinuation,
    lightLookup,
    multiStage,
    blockingReasons,
    contextNearLimit,
    hasRepairSignal,
  });

  if (blockingReasons.length > 0) reasons.push(...dedupe(blockingReasons));
  if (contextNearLimit) {
    reasons.push('context near limit; compaction must finish before sending');
  }
  if (directContext) {
    reasons.push('direct context answer can be made from current conversation state');
  } else if (lowRiskContinuation) {
    reasons.push('low-risk continuation can respond first and complete evidence in background');
  } else if (lightLookup) {
    reasons.push('light reproducible lookup can show quick progress while external information arrives');
  } else if (hasRepairSignal) {
    reasons.push('repair/failure path must wait for validation evidence');
  } else if (multiStage) {
    reasons.push('multi-stage work may stream progress but final success waits for verification');
  } else {
    reasons.push('standard task policy');
  }

  const timing = timings({
    directContext,
    lowRiskContinuation,
    lightLookup,
    blocking: blockingReasons.length > 0 || hasRepairSignal || contextNearLimit,
  });

  return {
    schemaVersion: CONVERSATION_LATENCY_POLICY_SCHEMA_VERSION,
    firstVisibleResponseMs: timing.firstVisible,
    firstEventWarningMs: timing.firstWarning,
    silentRetryMs: timing.retry,
    allowBackgroundCompletion,
    blockOnContextCompaction,
    blockOnVerification,
    reason: dedupe(reasons).join('; '),
  };
}

function allowBackground(params: {
  directContext: boolean;
  lowRiskContinuation: boolean;
  lightLookup: boolean;
  multiStage: boolean;
  blockingReasons: string[];
  contextNearLimit: boolean;
  hasRepairSignal: boolean;
}): boolean {
  if (params.blockingReasons.length > 0 || params.contextNearLimit || params.hasRepairSignal) {
    return false;
  }
  if (params.directContext) return false;
  return params.lowRiskContinuation || params.lightLookup || params.multiStage;
}

function timings(params: {
  directContext: boolean;
  lowRiskContinuation: boolean;
  lightLookup: boolean;
  blocking: boolean;
}) {
  if (params.directContext || params.lowRiskContinuation) {
    return { firstVisible: FAST_FIRST_VISIBLE_MS, firstWarning: FAST_WARNING_MS, retry: STANDARD_SILENT_RETRY_MS };
  }
  if (params.lightLookup) {
    return { firstVisible: STANDARD_FIRST_VISIBLE_MS, firstWarning: STANDARD_WARNING_MS, retry: STANDARD_SILENT_RETRY_MS };
  }
  if (params.blocking) {
    return { firstVisible: WAIT_FIRST_VISIBLE_MS, firstWarning: WAIT_WARNING_MS, retry: BLOCKING_SILENT_RETRY_MS };
  }
  return { firstVisible: STANDARD_FIRST_VISIBLE_MS, firstWarning: STANDARD_WARNING_MS, retry: STANDARD_SILENT_RETRY_MS };
}

function collectSelectedActions(policyInput: JsonMap, capability: JsonMap): unknown[] {
  const values: unknown[] = [];
  for (const source of policySources(policyInput)) {
    values.push(...sequenceValue(firstValue(source, 'selectedActions', 'actions', 'selected_actions')));
  }
  values.push(...sequenceValue(capability.selectedActions));
  values.push(...sequenceValue(capability.selected).filter((item) => {
    const record = recordValue(item);
    return record ? textValue(record.kind).toLowerCase() === 'action' : false;
  }));
  return values;
}

function collectSelectedVerifiers(policyInput: JsonMap, capability: JsonMap, execution: JsonMap): unknown[] {
  const values: unknown[] = [];
  for (const source of policySources(policyInput)) {
    values.push(...sequenceValue(firstValue(source, 'selectedVerifiers', 'verifiers', 'selected_verifiers')));
  }
  values.push(...sequenceValue(capability.selectedVerifiers));
  values.push(...sequenceValue(execution.selectedVerifiers));
  values.push(...sequenceValue(capability.selected).filter((item) => {
    const record = recordValue(item);
    return record ? textValue(record.kind).toLowerCase() === 'verifier' : false;
  }));
  return values;
}

function selectedCapabilities(capability: JsonMap): unknown[] {
  return [
    ...sequenceValue(capability.selected),
    ...sequenceValue(capability.selectedSkills),
    ...sequenceValue(capability.selectedTools),
    ...sequenceValue(capability.selectedSenses),
  ];
}

function recentFailuresFor(policyInput: JsonMap, recovery: JsonMap): unknown[] {
  const failures: unknown[] = [];
  for (const source of policySources(policyInput)) {
    failures.push(...sequenceValue(firstValue(source, 'recentFailures', 'failures')));
    if (source.failure) failures.push(source.failure);
  }
  const session = recordValue(policyInput.session) ?? {};
  failures.push(...sequenceValue(session.runs).filter((item) => {
    const record = recordValue(item);
    return record ? new Set(['failed', 'failure', 'error']).has(textValue(record.status).toLowerCase()) : false;
  }));
  if (new Set(['failed', 'failure', 'error']).has(textValue(recovery.status).toLowerCase())) {
    failures.push(recovery);
  }
  return failures;
}

function userGuidance(policyInput: JsonMap): unknown[] {
  for (const source of policySources(policyInput)) {
    const queue = sequenceValue(firstValue(source, 'userGuidanceQueue', 'guidanceQueue', 'guidance'));
    if (queue.length > 0) return queue;
  }
  return [];
}

function hasHumanApprovalRequired(policyInput: JsonMap, actions: unknown[]): boolean {
  for (const source of policySources(policyInput)) {
    if (source.humanApprovalRequired === true) return true;
    const approval = firstRecord(source.approval, source.humanApproval);
    if (approval.required === true || new Set(['required', 'pending']).has(textValue(approval.status).toLowerCase())) {
      return true;
    }
  }
  for (const action of actions) {
    const record = recordValue(action) ?? {};
    if (record.humanApprovalRequired === true) return true;
    const approval = firstRecord(record.approval, record.humanApproval);
    if (approval.required === true || textValue(approval.requires).toLowerCase() === 'human') return true;
  }
  return false;
}

function hasHighRiskAction(selectedActionsList: unknown[], allSelected: unknown[], riskFlags: Set<string>): boolean {
  if (riskFlags.has('code-or-workspace-side-effect')) return true;
  for (const action of [...selectedActionsList, ...allSelected]) {
    const record = recordValue(action) ?? {};
    const riskLevel = textValue(record.riskLevel ?? record.risk_level ?? record.risk).toLowerCase();
    if (riskLevel === 'high' || riskLevel === 'critical') return true;
    const text = [
      textValue(record.id),
      textValue(record.kind),
      textValue(record.summary),
      textValue(record.description),
      sequenceValue(record.sideEffects).map(textValue).join(' '),
      sequenceValue(record.risk).map(textValue).join(' '),
    ].join(' ').toLowerCase();
    for (const token of tokens(text)) {
      if (HIGH_RISK_WORDS.has(token)) return true;
    }
  }
  return false;
}

function hasFailedVerification(policyInput: JsonMap, recovery: JsonMap, failures: unknown[]): boolean {
  for (const item of [...failures, recovery, ...sequenceValue(policyInput.verificationResults)]) {
    const record = recordValue(item) ?? {};
    const text = [
      textValue(record.type),
      textValue(record.stage),
      textValue(record.status),
      textValue(record.state),
      textValue(record.reason),
      textValue(record.failureReason),
      textValue(record.error),
    ].join(' ').toLowerCase();
    if (text.includes('verification') && ['fail', 'failed', 'failure', 'error', 'rejected'].some((word) => text.includes(word))) {
      return true;
    }
  }
  return false;
}

function isContextNearLimit(policyInput: JsonMap, context: JsonMap): boolean {
  for (const source of [recordValue(policyInput.limits) ?? {}, recordValue(policyInput.policyHints) ?? {}, context]) {
    const budget = firstRecord(source.contextBudget, source.budget);
    if (budgetNearLimit(budget)) return true;
    if (source.contextNearLimit === true || source.nearContextLimit === true) return true;
    const remaining = numberValue(firstValue(source, 'remainingContextTokens', 'contextRemainingTokens', 'remainingTokens'));
    const maximum = numberValue(firstValue(source, 'maxContextTokens', 'contextWindowTokens', 'maxTokens', 'totalTokens'));
    const used = numberValue(firstValue(source, 'usedContextTokens', 'contextTokens', 'usedTokens'));
    if (remaining !== undefined && remaining <= 2048) return true;
    if (maximum && used !== undefined && used / maximum >= 0.88) return true;
  }
  return false;
}

function budgetNearLimit(budget: JsonMap): boolean {
  if (Object.keys(budget).length === 0) return false;
  if (budget.nearLimit === true) return true;
  const remaining = numberValue(firstValue(budget, 'remainingTokens', 'remaining', 'availableTokens'));
  const maximum = numberValue(firstValue(budget, 'maxTokens', 'totalTokens', 'limitTokens'));
  const used = numberValue(firstValue(budget, 'usedTokens', 'used', 'currentTokens'));
  const ratio = numberValue(firstValue(budget, 'usedRatio', 'usageRatio', 'ratio'));
  if (remaining !== undefined && remaining <= 2048) return true;
  if (ratio !== undefined && ratio >= 0.88) return true;
  if (maximum && used !== undefined && used / maximum >= 0.88) return true;
  return false;
}

function policySources(policyInput: JsonMap): JsonMap[] {
  return [
    recordValue(policyInput.policyHints) ?? {},
    recordValue(policyInput.metadata) ?? {},
    recordValue(policyInput.tsDecisions) ?? {},
    policyInput,
  ];
}

function firstValue(data: JsonMap, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in data) return data[key];
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonMap {
  for (const value of values) {
    const record = recordValue(value);
    if (record && Object.keys(record).length > 0) return record;
  }
  return {};
}

function recordValue(value: unknown): JsonMap | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonMap : undefined;
}

function sequenceValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Uint8Array) return [new TextDecoder().decode(value)];
  return Array.isArray(value) ? value : [];
}

function stringSet(value: unknown): Set<string> {
  return new Set(sequenceValue(value).map(textValue).filter(Boolean));
}

function tokens(value: string): Set<string> {
  return new Set(value.replaceAll('_', '-').replaceAll('/', '-').split(/\s+/).filter(Boolean));
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function textValue(value: unknown): string {
  return String(value || '').trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = textValue(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
