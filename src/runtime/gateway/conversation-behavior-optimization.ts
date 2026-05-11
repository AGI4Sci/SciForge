import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';

export const CONVERSATION_BEHAVIOR_OPTIMIZATION_SCHEMA_VERSION = 'sciforge.conversation.behavior-optimization.v1' as const;
export const PARALLEL_WORK_PLAN_SCHEMA_VERSION = 'sciforge.parallel-work-plan.v1' as const;

type JsonMap = Record<string, unknown>;

export type ConversationBehaviorIntentSignal =
  | 'long'
  | 'report'
  | 'research'
  | 'recovery'
  | 'followup'
  | 'scope-change'
  | 'speed-first';

export type BehaviorLatencyTier = 'instant' | 'quick' | 'bounded' | 'deep' | 'background';
export type EvidenceSufficiencyLevel = 'sufficient' | 'partial' | 'insufficient';
export type EvidenceGranularity = 'answer' | 'summary' | 'report' | 'audit';
export type EscalationAction = 'stop' | 'continue' | 'background' | 'needs-evidence';
export type BudgetDowngradeLevel = 'none' | 'light' | 'strong';

export interface ConversationBehaviorOptimizationInput {
  [key: string]: unknown;
  prompt?: string;
  executionModePlan?: JsonMap;
  latencyPolicy?: JsonMap;
  contextPolicy?: JsonMap;
  budget?: JsonMap;
  evidence?: unknown[];
  partial?: JsonMap;
  completedWork?: unknown[];
  pendingWork?: unknown[];
  previousWork?: unknown[];
  toolCandidates?: unknown[];
  currentReferenceDigests?: unknown[];
  artifacts?: unknown[];
  recentFailures?: unknown[];
  userGuidanceQueue?: unknown[];
}

export interface ConversationBehaviorOptimization {
  schemaVersion: typeof CONVERSATION_BEHAVIOR_OPTIMIZATION_SCHEMA_VERSION;
  latencyTier: BehaviorLatencyTier;
  intent: ConversationIntentSignals;
  evidenceSufficiency: EvidenceSufficiencyDecision;
  escalation: EscalationDecision;
  repeatedWorkGuard: RepeatedWorkGuardDecision;
  parallelWorkPlan: ParallelWorkPlan;
  progressWordingInputs: ProgressWordingInputs;
  partialReportPlan: PartialReportPlan;
  budgetDowngrade: BudgetDowngradeDecision;
  backendHandoffDirective: BackendHandoffDirective;
  audit: JsonMap;
}

export interface ConversationIntentSignals {
  signals: ConversationBehaviorIntentSignal[];
  confidence: Record<ConversationBehaviorIntentSignal, number>;
  reasonCodes: string[];
}

export interface EvidenceSufficiencyDecision {
  level: EvidenceSufficiencyLevel;
  requiredGranularity: EvidenceGranularity;
  enoughForCurrentTurn: boolean;
  durableEvidenceRefs: string[];
  missing: string[];
  reasonCodes: string[];
}

export interface EscalationDecision {
  action: EscalationAction;
  stopForegroundExpansion: boolean;
  optionalContinuationItems: string[];
  reasonCodes: string[];
}

export interface RepeatedWorkGuardDecision {
  reuseKeys: RepeatedWorkKey[];
  skipKeys: string[];
  rerunKeys: string[];
  maxRepeatedExploration: number;
  reasonCodes: string[];
}

export interface RepeatedWorkKey {
  kind: string;
  key: string;
  status: string;
  source: string;
  stable: boolean;
}

export interface ParallelWorkPlan {
  schemaVersion: typeof PARALLEL_WORK_PLAN_SCHEMA_VERSION;
  planId: string;
  latencyTier: BehaviorLatencyTier;
  maxConcurrency: number;
  firstResultDeadlineMs: number;
  tasks: ParallelWorkTask[];
  batches: ParallelWorkBatch[];
  conflicts: ParallelWorkConflict[];
  earlyStopPolicy: ParallelWorkEarlyStopPolicy;
}

export interface ParallelWorkTask {
  id: string;
  kind: string;
  dependsOn: string[];
  readSet: string[];
  writeSet: string[];
  sideEffectClass: string;
  costClass: string;
  deadlineMs: number;
  owner: string;
  expectedOutput: string;
  criticalPath: boolean;
  state: 'planned' | 'deferred' | 'skipped';
  reasonCodes: string[];
}

export interface ParallelWorkBatch {
  id: string;
  taskIds: string[];
  mode: 'parallel' | 'serial';
  blocksFirstResult: boolean;
  reasonCodes: string[];
}

export interface ParallelWorkConflict {
  taskIds: string[];
  kind: string;
  resource: string;
  resolution: 'serialize' | 'skip-duplicate' | 'defer';
}

export interface ParallelWorkEarlyStopPolicy {
  stopWhenEvidenceSufficient: boolean;
  cancelSidecarsAfterFirstResult: boolean;
  deferLowValueAfterDeadline: boolean;
  reasonCodes: string[];
}

export interface ProgressWordingInputs {
  stage: string;
  completed: string[];
  next: string[];
  backgroundContinuing: boolean;
  deadlineMs: number;
  reasonCodes: string[];
}

export interface PartialReportPlan {
  enabled: boolean;
  sections: string[];
  includeEvidenceTable: boolean;
  includeGaps: boolean;
  includeContinuationPlan: boolean;
  finalReportDeferred: boolean;
  reasonCodes: string[];
}

export interface BudgetDowngradeDecision {
  active: boolean;
  level: BudgetDowngradeLevel;
  disabledWork: string[];
  retainedWork: string[];
  upgradePath: string[];
  reasonCodes: string[];
}

export interface BackendHandoffDirective {
  schemaVersion: 'sciforge.backend-handoff-directive.v1';
  directiveCodes: string[];
  stateRefs: string[];
  policyRefs: string[];
  forbiddenInlineCategories: string[];
  structuredOnly: boolean;
  reasonCodes: string[];
}

type WorkKeySource = 'previous' | 'pending' | 'candidate';

type NormalizedWorkKey = RepeatedWorkKey & {
  id: string;
  sourceType: WorkKeySource;
};

const INTENT_TOKENS: Record<ConversationBehaviorIntentSignal, string[]> = {
  long: ['long', 'large', 'complex', 'comprehensive', 'exhaustive', 'multi-step', 'batch', 'all', '长期', '复杂', '全面', '完整', '批量'],
  report: ['report', 'brief', 'markdown', 'table', 'summary', 'deliverable', '报告', '总结', '表格', '交付'],
  research: ['research', 'survey', 'review', 'source', 'citation', 'evidence', 'search', '调研', '综述', '来源', '引用', '证据', '检索'],
  recovery: ['recover', 'repair', 'retry', 'resume', 'failed', 'failure', 'timeout', '恢复', '修复', '重试', '失败', '超时'],
  followup: ['continue', 'previous', 'prior', 'last', 'followup', 'again', '继续', '接着', '上一轮', '刚才', '前面'],
  'scope-change': ['change', 'adjust', 'only', 'exclude', 'include', 'instead', 'constraint', '改成', '调整', '只要', '不要', '排除', '约束'],
  'speed-first': ['quick', 'fast', 'first', 'partial', 'draft', 'now', '先', '快', '尽快', '部分', '草稿', '马上'],
};

const SIGNAL_FROM_EXECUTION: Record<string, ConversationBehaviorIntentSignal> = {
  research: 'research',
  'systematic-research': 'research',
  'long-or-uncertain': 'long',
  'artifact-output': 'report',
  repair: 'recovery',
  continuation: 'followup',
  'mid-run-guidance': 'scope-change',
};

const DEFAULT_FIRST_RESULT_MS: Record<BehaviorLatencyTier, number> = {
  instant: 800,
  quick: 1200,
  bounded: 3000,
  deep: 8000,
  background: 1200,
};

export function optimizeConversationBehavior(request: ConversationBehaviorOptimizationInput = {}): ConversationBehaviorOptimization {
  const data = request as JsonMap;
  const intent = classifyBehaviorIntent(data);
  const latencyTier = selectLatencyTier(data, intent);
  const evidenceSufficiency = decideEvidenceSufficiency(data, intent);
  const repeatedWorkGuard = buildRepeatedWorkGuard(data, intent);
  const budgetDowngrade = decideBudgetDowngrade(data, latencyTier);
  const parallelWorkPlan = buildParallelWorkPlan(data, latencyTier, repeatedWorkGuard, evidenceSufficiency, budgetDowngrade);
  const escalation = decideEscalation(data, intent, evidenceSufficiency, repeatedWorkGuard, budgetDowngrade);
  const progressWordingInputs = buildProgressWordingInputs(data, latencyTier, parallelWorkPlan, escalation);
  const partialReportPlan = buildPartialReportPlan(intent, evidenceSufficiency, escalation, budgetDowngrade);
  const backendHandoffDirective = buildBackendHandoffDirective(data, intent, escalation, budgetDowngrade);

  return {
    schemaVersion: CONVERSATION_BEHAVIOR_OPTIMIZATION_SCHEMA_VERSION,
    latencyTier,
    intent,
    evidenceSufficiency,
    escalation,
    repeatedWorkGuard,
    parallelWorkPlan,
    progressWordingInputs,
    partialReportPlan,
    budgetDowngrade,
    backendHandoffDirective,
    audit: {
      promptDigest: textDigest(stringValue(data.prompt)),
      toolCandidateCount: toRecordList(data.toolCandidates).length,
      evidenceCount: toRecordList(data.evidence).length,
      pendingWorkCount: toRecordList(data.pendingWork).length,
    },
  };
}

export const buildConversationBehaviorOptimization = optimizeConversationBehavior;

function classifyBehaviorIntent(data: JsonMap): ConversationIntentSignals {
  const promptTokens = tokenSet(stringValue(data.prompt));
  const confidence = Object.fromEntries(
    (Object.keys(INTENT_TOKENS) as ConversationBehaviorIntentSignal[]).map((signal) => [signal, 0]),
  ) as Record<ConversationBehaviorIntentSignal, number>;
  const reasonCodes: string[] = [];

  for (const [signal, tokens] of Object.entries(INTENT_TOKENS) as Array<[ConversationBehaviorIntentSignal, string[]]>) {
    const hits = tokens.filter((token) => promptTokens.has(token) || promptTokens.has(token.replace('-', ' '))).length;
    if (hits > 0) {
      confidence[signal] = Math.max(confidence[signal], Math.min(0.85, 0.42 + hits * 0.12));
      reasonCodes.push(`intent:${signal}:prompt`);
    }
  }

  const execution = recordValue(data.executionModePlan) ?? {};
  for (const signal of toStringList(execution.signals)) {
    const mapped = SIGNAL_FROM_EXECUTION[signal];
    if (!mapped) continue;
    confidence[mapped] = Math.max(confidence[mapped], 0.74);
    reasonCodes.push(`intent:${mapped}:execution-signal`);
  }

  if (toRecordList(data.recentFailures).length > 0 || hasFailedHistory(data)) {
    confidence.recovery = Math.max(confidence.recovery, 0.9);
    reasonCodes.push('intent:recovery:failure-state');
  }
  if (toRecordList(data.artifacts).length > 0 || contextMode(data) === 'continue') {
    confidence.followup = Math.max(confidence.followup, 0.68);
    reasonCodes.push('intent:followup:state-anchor');
  }
  if (toRecordList(data.userGuidanceQueue).length > 0) {
    confidence['scope-change'] = Math.max(confidence['scope-change'], 0.82);
    reasonCodes.push('intent:scope-change:guidance-queue');
  }
  if (booleanValue(data.speedFirst) || booleanValue(recordValue(data.latencyPolicy)?.allowBackgroundCompletion)) {
    confidence['speed-first'] = Math.max(confidence['speed-first'], 0.78);
    reasonCodes.push('intent:speed-first:latency-policy');
  }

  const signals = (Object.keys(confidence) as ConversationBehaviorIntentSignal[])
    .filter((signal) => confidence[signal] >= 0.5);
  return { signals, confidence, reasonCodes: uniqueStrings(reasonCodes) };
}

function decideEvidenceSufficiency(data: JsonMap, intent: ConversationIntentSignals): EvidenceSufficiencyDecision {
  const granularity = requiredGranularity(intent);
  const evidence = toRecordList(data.evidence);
  const partial = recordValue(data.partial) ?? {};
  const durableRefs = uniqueStrings([
    ...evidence.flatMap(evidenceRefs),
    ...evidence.flatMap((item) => toStringList(item.refs)),
    ...toStringList(partial.evidenceRefs),
  ]);
  const usableEvidence = evidence.filter(isUsableEvidence);
  const hasPartial = hasUsablePartial(partial);
  const hasTable = evidence.some((item) => booleanValue(item.evidenceTable) || stringValue(item.kind) === 'evidenceTable');
  const missing: string[] = [];
  const reasonCodes: string[] = [];

  if (!usableEvidence.length && !hasPartial) missing.push('evidence:any');
  if (granularity !== 'answer' && usableEvidence.length < 2) missing.push('evidence:multiple-independent-items');
  if (granularity === 'report' && !hasTable) missing.push('evidence:table-or-matrix');
  if (granularity === 'audit' && durableRefs.length < usableEvidence.length) missing.push('evidence:durable-refs');

  if (durableRefs.length > 0) reasonCodes.push('evidence:durable-refs-present');
  if (hasPartial) reasonCodes.push('evidence:partial-present');
  if (usableEvidence.length > 0) reasonCodes.push('evidence:usable-items-present');

  const enoughForAnswer = usableEvidence.length > 0 || hasPartial;
  const enoughForSummary = usableEvidence.length >= 2 || (hasPartial && durableRefs.length > 0);
  const enoughForReport = enoughForSummary && (hasTable || hasPartial);
  const enoughForAudit = enoughForReport && durableRefs.length >= Math.max(1, usableEvidence.length);
  const enough = granularity === 'answer'
    ? enoughForAnswer
    : granularity === 'summary'
      ? enoughForSummary
      : granularity === 'report'
        ? enoughForReport
        : enoughForAudit;

  return {
    level: enough ? 'sufficient' : enoughForAnswer ? 'partial' : 'insufficient',
    requiredGranularity: granularity,
    enoughForCurrentTurn: enough || (intent.signals.includes('speed-first') && enoughForAnswer),
    durableEvidenceRefs: durableRefs,
    missing: uniqueStrings(missing),
    reasonCodes: uniqueStrings(reasonCodes.length ? reasonCodes : ['evidence:no-usable-items']),
  };
}

function buildRepeatedWorkGuard(data: JsonMap, intent: ConversationIntentSignals): RepeatedWorkGuardDecision {
  const previous = [
    ...toRecordList(data.previousWork),
    ...toRecordList(data.completedWork),
    ...toRecordList(data.priorAttempts),
  ].flatMap((item) => workKeys(item, 'previous'));
  const pending = toRecordList(data.pendingWork).flatMap((item) => workKeys(item, 'pending'));
  const candidates = toRecordList(data.toolCandidates).flatMap((item) => workKeys(item, 'candidate'));
  const previousByKey = new Map(previous.map((item) => [workKeyId(item), item]));
  const skipKeys: string[] = [];
  const rerunKeys: string[] = [];
  const reuseKeys: RepeatedWorkKey[] = [];
  const reasonCodes: string[] = [];
  const refreshRequested = intent.signals.includes('scope-change') && !intent.signals.includes('speed-first');

  for (const candidate of [...pending, ...candidates]) {
    const prior = previousByKey.get(workKeyId(candidate));
    if (!prior) {
      rerunKeys.push(workKeyId(candidate));
      continue;
    }
    if (refreshRequested && candidate.kind !== 'failure') {
      rerunKeys.push(workKeyId(candidate));
      reasonCodes.push('repeat:refresh-after-scope-change');
      continue;
    }
    if (prior.stable || prior.kind === 'failure' || prior.kind === 'verifier') {
      skipKeys.push(workKeyId(candidate));
      reuseKeys.push(stripSource(prior));
      reasonCodes.push(`repeat:reuse:${prior.kind}`);
    } else {
      rerunKeys.push(workKeyId(candidate));
    }
  }

  return {
    reuseKeys: dedupeWorkKeys(reuseKeys),
    skipKeys: uniqueStrings(skipKeys),
    rerunKeys: uniqueStrings(rerunKeys),
    maxRepeatedExploration: intent.signals.includes('recovery') ? 1 : 0,
    reasonCodes: uniqueStrings(reasonCodes.length ? reasonCodes : ['repeat:no-duplicates']),
  };
}

function buildParallelWorkPlan(
  data: JsonMap,
  latencyTier: BehaviorLatencyTier,
  guard: RepeatedWorkGuardDecision,
  evidence: EvidenceSufficiencyDecision,
  budget: BudgetDowngradeDecision,
): ParallelWorkPlan {
  const deadline = firstResultDeadline(data, latencyTier);
  const skip = new Set(guard.skipKeys);
  const tasks = toRecordList(data.toolCandidates).map((candidate, index) => taskFromCandidate(candidate, index, deadline, skip, budget));
  const conflicts = findTaskConflicts(tasks);
  const batches = batchTasks(tasks, conflicts);
  const maxConcurrency = Math.max(1, Math.min(numberValue(recordValue(data.budget)?.maxConcurrency) ?? 4, 6));
  return {
    schemaVersion: PARALLEL_WORK_PLAN_SCHEMA_VERSION,
    planId: `parallel:${textDigest(JSON.stringify(tasks.map((task) => task.id))).slice(0, 12)}`,
    latencyTier,
    maxConcurrency,
    firstResultDeadlineMs: deadline,
    tasks,
    batches,
    conflicts,
    earlyStopPolicy: {
      stopWhenEvidenceSufficient: evidence.enoughForCurrentTurn,
      cancelSidecarsAfterFirstResult: latencyTier === 'quick' || latencyTier === 'background' || budget.active,
      deferLowValueAfterDeadline: latencyTier !== 'deep' || budget.active,
      reasonCodes: uniqueStrings([
        evidence.enoughForCurrentTurn ? 'early-stop:evidence-sufficient' : 'early-stop:evidence-needed',
        budget.active ? 'early-stop:budget-downgrade' : 'early-stop:budget-normal',
      ]),
    },
  };
}

function decideEscalation(
  data: JsonMap,
  intent: ConversationIntentSignals,
  evidence: EvidenceSufficiencyDecision,
  guard: RepeatedWorkGuardDecision,
  budget: BudgetDowngradeDecision,
): EscalationDecision {
  const pending = toRecordList(data.pendingWork);
  const optional = pending
    .map((item) => stringValue(item.id) || stringValue(item.kind) || stringValue(item.label))
    .filter(Boolean);
  const reasonCodes: string[] = [];

  if (guard.skipKeys.length > 0) reasonCodes.push('escalation:duplicate-work-skipped');
  if (budget.active) reasonCodes.push('escalation:budget-limited');
  if (evidence.enoughForCurrentTurn) reasonCodes.push('escalation:evidence-sufficient');

  if (!evidence.enoughForCurrentTurn) {
    return {
      action: evidence.level === 'partial' && intent.signals.includes('speed-first') ? 'background' : 'needs-evidence',
      stopForegroundExpansion: false,
      optionalContinuationItems: uniqueStrings(optional),
      reasonCodes: uniqueStrings([...reasonCodes, 'escalation:needs-current-turn-evidence']),
    };
  }

  if (intent.signals.includes('speed-first') || budget.active || guard.skipKeys.length > 0) {
    return {
      action: pending.length > 0 ? 'background' : 'stop',
      stopForegroundExpansion: true,
      optionalContinuationItems: uniqueStrings(optional),
      reasonCodes: uniqueStrings([...reasonCodes, pending.length > 0 ? 'escalation:defer-optional-work' : 'escalation:stop']),
    };
  }

  return {
    action: pending.length > 0 ? 'continue' : 'stop',
    stopForegroundExpansion: pending.length === 0,
    optionalContinuationItems: uniqueStrings(optional),
    reasonCodes: uniqueStrings([...reasonCodes, pending.length > 0 ? 'escalation:continue-planned-work' : 'escalation:stop']),
  };
}

function buildProgressWordingInputs(
  data: JsonMap,
  latencyTier: BehaviorLatencyTier,
  plan: ParallelWorkPlan,
  escalation: EscalationDecision,
): ProgressWordingInputs {
  const completed = toRecordList(data.completedWork)
    .map((item) => stringValue(item.label) || stringValue(item.id) || stringValue(item.kind))
    .filter(Boolean);
  const next = plan.tasks
    .filter((task) => task.state === 'planned')
    .slice(0, 4)
    .map((task) => task.kind);
  const firstTask = plan.tasks.find((task) => task.state === 'planned');
  return {
    stage: firstTask?.kind ?? (escalation.stopForegroundExpansion ? 'finalize' : 'plan'),
    completed: uniqueStrings(completed),
    next: uniqueStrings(next),
    backgroundContinuing: escalation.action === 'background' || latencyTier === 'background',
    deadlineMs: plan.firstResultDeadlineMs,
    reasonCodes: uniqueStrings([
      `progress:${latencyTier}`,
      escalation.stopForegroundExpansion ? 'progress:foreground-stop' : 'progress:foreground-active',
    ]),
  };
}

function buildPartialReportPlan(
  intent: ConversationIntentSignals,
  evidence: EvidenceSufficiencyDecision,
  escalation: EscalationDecision,
  budget: BudgetDowngradeDecision,
): PartialReportPlan {
  const enabled = intent.signals.some((signal) => signal === 'long' || signal === 'report' || signal === 'research')
    || evidence.requiredGranularity !== 'answer';
  return {
    enabled,
    sections: enabled ? ['answer-summary', 'evidence', 'gaps', 'next-steps'] : [],
    includeEvidenceTable: enabled && evidence.durableEvidenceRefs.length > 0,
    includeGaps: enabled && evidence.missing.length > 0,
    includeContinuationPlan: enabled && (escalation.optionalContinuationItems.length > 0 || budget.active),
    finalReportDeferred: enabled && (escalation.action === 'background' || budget.active || evidence.level !== 'sufficient'),
    reasonCodes: uniqueStrings([
      enabled ? 'partial-report:enabled' : 'partial-report:not-needed',
      evidence.level === 'sufficient' ? 'partial-report:evidence-ready' : 'partial-report:evidence-gaps',
    ]),
  };
}

function decideBudgetDowngrade(data: JsonMap, latencyTier: BehaviorLatencyTier): BudgetDowngradeDecision {
  const budget = recordValue(data.budget) ?? {};
  const ratios = [
    remainingRatio(budget.remainingToolCalls, budget.maxToolCalls),
    remainingRatio(budget.remainingMs, budget.maxMs),
    remainingRatio(budget.remainingTokens, budget.maxTokens),
  ].filter((value): value is number => typeof value === 'number');
  const minRatio = ratios.length ? Math.min(...ratios) : 1;
  const strong = minRatio <= 0.12;
  const light = minRatio <= 0.25 || latencyTier === 'quick';
  if (!strong && !light) {
    return {
      active: false,
      level: 'none',
      disabledWork: [],
      retainedWork: ['critical-path', 'durable-refs', 'user-visible-partial'],
      upgradePath: [],
      reasonCodes: ['budget:normal'],
    };
  }
  return {
    active: true,
    level: strong ? 'strong' : 'light',
    disabledWork: strong
      ? ['non-critical-fetch', 'deep-verification', 'extra-retries', 'low-value-sidecars']
      : ['extra-retries', 'low-value-sidecars'],
    retainedWork: ['critical-path', 'durable-refs', 'user-visible-partial'],
    upgradePath: ['user-approve-more-budget', 'resume-background-work', 'increase-verification-depth'],
    reasonCodes: [strong ? 'budget:strong-downgrade' : 'budget:light-downgrade'],
  };
}

function buildBackendHandoffDirective(
  data: JsonMap,
  intent: ConversationIntentSignals,
  escalation: EscalationDecision,
  budget: BudgetDowngradeDecision,
): BackendHandoffDirective {
  return {
    schemaVersion: 'sciforge.backend-handoff-directive.v1',
    directiveCodes: uniqueStrings([
      'handoff:structured-contract',
      'handoff:state-refs-first',
      escalation.stopForegroundExpansion ? 'handoff:stop-foreground-expansion' : 'handoff:continue-foreground',
      budget.active ? 'handoff:budget-downgraded' : 'handoff:budget-normal',
      ...intent.signals.map((signal) => `intent:${signal}`),
    ]),
    stateRefs: collectStateRefs(data),
    policyRefs: uniqueStrings([
      `policy:${CONVERSATION_BEHAVIOR_OPTIMIZATION_SCHEMA_VERSION}`,
      ...toStringList(recordValue(data.executionModePlan)?.policyRefs),
      ...toStringList(recordValue(data.contextPolicy)?.policyRefs),
    ]),
    forbiddenInlineCategories: ['full-history', 'raw-trace', 'large-artifact-body', 'case-specific-rule'],
    structuredOnly: true,
    reasonCodes: ['handoff:metadata-only'],
  };
}

function requiredGranularity(intent: ConversationIntentSignals): EvidenceGranularity {
  if (intent.signals.includes('recovery')) return 'audit';
  if (intent.signals.includes('report')) return 'report';
  if (intent.signals.includes('research')) return 'summary';
  return 'answer';
}

function selectLatencyTier(data: JsonMap, intent: ConversationIntentSignals): BehaviorLatencyTier {
  const explicit = stringValue(recordValue(data.executionModePlan)?.latencyTier) || stringValue(data.latencyTier);
  if (isLatencyTier(explicit)) return explicit;
  const mode = stringValue(recordValue(data.executionModePlan)?.executionMode);
  if (intent.signals.includes('speed-first')) return 'quick';
  if (mode === 'direct-context-answer') return 'instant';
  if (intent.signals.includes('long') || intent.signals.includes('report')) return 'background';
  if (intent.signals.includes('research')) return 'bounded';
  return 'bounded';
}

function taskFromCandidate(
  candidate: JsonMap,
  index: number,
  firstResultDeadlineMs: number,
  skip: Set<string>,
  budget: BudgetDowngradeDecision,
): ParallelWorkTask {
  const id = stringValue(candidate.id) || stringValue(candidate.key) || `task-${index + 1}`;
  const kind = stringValue(candidate.kind) || stringValue(candidate.type) || 'work';
  const sideEffectClass = stringValue(candidate.sideEffectClass) || stringValue(candidate.sideEffect) || 'read';
  const costClass = stringValue(candidate.costClass) || stringValue(candidate.cost) || 'normal';
  const criticalPath = candidate.criticalPath !== false && !booleanValue(candidate.sidecar);
  const keyIds = workKeys(candidate, 'candidate').map(workKeyId);
  const duplicate = keyIds.some((key) => skip.has(key));
  const budgetDeferred = budget.active && !criticalPath && costClass !== 'low';
  return {
    id,
    kind,
    dependsOn: toStringList(candidate.dependsOn),
    readSet: toStringList(candidate.readSet),
    writeSet: toStringList(candidate.writeSet),
    sideEffectClass,
    costClass,
    deadlineMs: numberValue(candidate.deadlineMs) ?? (criticalPath ? firstResultDeadlineMs : firstResultDeadlineMs * 3),
    owner: stringValue(candidate.owner) || 'runtime',
    expectedOutput: stringValue(candidate.expectedOutput) || kind,
    criticalPath,
    state: duplicate ? 'skipped' : budgetDeferred ? 'deferred' : 'planned',
    reasonCodes: uniqueStrings([
      duplicate ? 'task:duplicate-skipped' : 'task:unique',
      budgetDeferred ? 'task:budget-deferred' : '',
      criticalPath ? 'task:critical-path' : 'task:sidecar',
    ]),
  };
}

function findTaskConflicts(tasks: ParallelWorkTask[]): ParallelWorkConflict[] {
  const conflicts: ParallelWorkConflict[] = [];
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      if (!left || !right || left.state === 'skipped' || right.state === 'skipped') continue;
      const writeConflict = intersection(left.writeSet, right.writeSet)[0];
      if (writeConflict) {
        conflicts.push({ taskIds: [left.id, right.id], kind: 'write-set', resource: writeConflict, resolution: 'serialize' });
        continue;
      }
      const mutationConflict = left.sideEffectClass !== 'read'
        && right.sideEffectClass !== 'read'
        && intersection(left.readSet, right.readSet)[0];
      if (mutationConflict) {
        conflicts.push({ taskIds: [left.id, right.id], kind: 'side-effect', resource: mutationConflict, resolution: 'serialize' });
      }
    }
  }
  return conflicts;
}

function batchTasks(tasks: ParallelWorkTask[], conflicts: ParallelWorkConflict[]): ParallelWorkBatch[] {
  const planned = tasks.filter((task) => task.state === 'planned');
  const conflictIds = new Set(conflicts.flatMap((conflict) => conflict.taskIds));
  const criticalParallel = planned.filter((task) => task.criticalPath && !conflictIds.has(task.id) && task.dependsOn.length === 0);
  const serial = planned.filter((task) => conflictIds.has(task.id) || task.dependsOn.length > 0);
  const sidecars = planned.filter((task) => !task.criticalPath && !conflictIds.has(task.id) && task.dependsOn.length === 0);
  const batches: ParallelWorkBatch[] = [];
  if (criticalParallel.length) {
    batches.push({
      id: 'batch-critical-read',
      taskIds: criticalParallel.map((task) => task.id),
      mode: 'parallel',
      blocksFirstResult: true,
      reasonCodes: ['batch:critical-path'],
    });
  }
  for (const task of serial) {
    batches.push({
      id: `batch-serial-${task.id}`,
      taskIds: [task.id],
      mode: 'serial',
      blocksFirstResult: task.criticalPath,
      reasonCodes: ['batch:conflict-or-dependency'],
    });
  }
  if (sidecars.length) {
    batches.push({
      id: 'batch-sidecar-read',
      taskIds: sidecars.map((task) => task.id),
      mode: 'parallel',
      blocksFirstResult: false,
      reasonCodes: ['batch:sidecar'],
    });
  }
  return batches;
}

function workKeys(item: JsonMap, sourceType: WorkKeySource): NormalizedWorkKey[] {
  const out: NormalizedWorkKey[] = [];
  for (const kind of ['query', 'url', 'ref', 'artifactHash', 'failureSignature', 'verifierResult']) {
    const value = stringValue(item[kind]) || stringValue(item[snakeKey(kind)]);
    if (!value) continue;
    out.push({
      id: stringValue(item.id) || `${kind}:${value}`,
      kind: normalizeWorkKeyKind(kind),
      key: normalizeKey(value),
      status: stringValue(item.status) || 'unknown',
      source: stringValue(item.source) || sourceType,
      sourceType,
      stable: item.stable === true || stableStatus(stringValue(item.status)),
    });
  }
  return out;
}

function normalizeWorkKeyKind(kind: string): string {
  if (kind === 'artifactHash') return 'artifact';
  if (kind === 'failureSignature') return 'failure';
  if (kind === 'verifierResult') return 'verifier';
  return kind;
}

function workKeyId(key: RepeatedWorkKey): string {
  return `${key.kind}:${key.key}`;
}

function stripSource(key: RepeatedWorkKey): RepeatedWorkKey {
  return { kind: key.kind, key: key.key, status: key.status, source: key.source, stable: key.stable };
}

function dedupeWorkKeys(keys: RepeatedWorkKey[]): RepeatedWorkKey[] {
  const seen = new Set<string>();
  const out: RepeatedWorkKey[] = [];
  for (const key of keys) {
    const id = workKeyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

function collectStateRefs(data: JsonMap): string[] {
  const refs: string[] = [];
  for (const item of [...toRecordList(data.currentReferenceDigests), ...toRecordList(data.artifacts), ...toRecordList(data.evidence)]) {
    refs.push(...evidenceRefs(item));
    for (const key of ['ref', 'dataRef', 'artifactRef', 'outputRef', 'traceRef', 'rawRef']) {
      const value = stringValue(item[key]);
      if (value) refs.push(value);
    }
  }
  return uniqueStrings(refs);
}

function evidenceRefs(item: JsonMap): string[] {
  return uniqueStrings([
    ...toStringList(item.evidenceRefs),
    ...toStringList(item.refs),
    stringValue(item.ref),
    stringValue(item.rawRef),
    stringValue(item.traceRef),
  ].filter(Boolean));
}

function isUsableEvidence(item: JsonMap): boolean {
  const status = stringValue(item.status).toLowerCase();
  if (['failed', 'error', 'invalid', 'stale'].includes(status)) return false;
  return status.length > 0 || evidenceRefs(item).length > 0 || booleanValue(item.stable);
}

function hasUsablePartial(partial: JsonMap): boolean {
  if (!Object.keys(partial).length) return false;
  const status = stringValue(partial.status).toLowerCase();
  if (['failed', 'invalid'].includes(status)) return false;
  return Boolean(stringValue(partial.summary) || stringValue(partial.message) || toStringList(partial.sections).length);
}

function hasFailedHistory(data: JsonMap): boolean {
  return [...toRecordList(data.previousWork), ...toRecordList(data.priorAttempts)].some((item) => {
    const status = stringValue(item.status).toLowerCase();
    return ['failed', 'failure', 'error', 'timeout', 'timed-out'].includes(status) || Boolean(item.failureReason);
  });
}

function contextMode(data: JsonMap): string {
  return stringValue(recordValue(data.contextPolicy)?.mode);
}

function firstResultDeadline(data: JsonMap, latencyTier: BehaviorLatencyTier): number {
  return numberValue(recordValue(data.latencyPolicy)?.firstVisibleResponseMs)
    ?? numberValue(recordValue(data.budget)?.firstResultDeadlineMs)
    ?? DEFAULT_FIRST_RESULT_MS[latencyTier];
}

function remainingRatio(remaining: unknown, max: unknown): number | undefined {
  const left = numberValue(remaining);
  const right = numberValue(max);
  if (left === undefined || right === undefined || right <= 0) return undefined;
  return Math.max(0, Math.min(1, left / right));
}

function tokenSet(text: string): Set<string> {
  const normalized = text.toLowerCase().replaceAll(/[^\p{Letter}\p{Number}\-]+/gu, ' ');
  const tokens = normalized.split(' ').map((token) => token.trim()).filter(Boolean);
  const grams: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) grams.push(`${tokens[index]} ${tokens[index + 1]}`);
  return new Set([...tokens, ...grams, ...Array.from(text)]);
}

function stableStatus(status: string): boolean {
  return ['ok', 'success', 'succeeded', 'completed', 'done', 'passed', 'empty', 'verified'].includes(status.toLowerCase());
}

function isLatencyTier(value: string): value is BehaviorLatencyTier {
  return ['instant', 'quick', 'bounded', 'deep', 'background'].includes(value);
}

function intersection(left: string[], right: string[]): string[] {
  const set = new Set(left);
  return right.filter((item) => set.has(item));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function snakeKey(value: string): string {
  return value.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function textDigest(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function recordValue(value: unknown): JsonMap | undefined {
  return isRecord(value) ? value : undefined;
}
