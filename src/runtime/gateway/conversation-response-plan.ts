import { isRecord, toRecordList, toStringList } from '../gateway-utils.js';

export const CONVERSATION_RESPONSE_PLAN_SCHEMA_VERSION = 'sciforge.conversation.response-plan.v1' as const;
export const CONVERSATION_BACKGROUND_PLAN_SCHEMA_VERSION = 'sciforge.conversation.background-plan.v1' as const;

type JsonMap = Record<string, unknown>;
type RiskLevel = 'low' | 'medium' | 'high';

const RISK_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface ConversationResponsePlan {
  schemaVersion: typeof CONVERSATION_RESPONSE_PLAN_SCHEMA_VERSION;
  initialResponseMode: string;
  finalizationMode: string;
  userVisibleProgress: string[];
  progressPhases: string[];
  fallbackMessagePolicy: string;
  backgroundCompletionSummary: string;
  reason: string;
  signals: JsonMap;
}

export interface ConversationBackgroundPlan {
  schemaVersion: typeof CONVERSATION_BACKGROUND_PLAN_SCHEMA_VERSION;
  enabled: boolean;
  tasks: string[];
  handoffRefsRequired: boolean;
  cancelOnNewUserTurn: boolean;
  reason: string;
  signals: JsonMap;
}

export function buildConversationResponsePlan(request: unknown): ConversationResponsePlan {
  const data = recordValue(request);
  const mode = executionMode(data);
  const risk = riskLevel(data);
  const stageHint = toStringList(execution(data).stagePlanHint);
  const riskFlags = new Set(toStringList(execution(data).riskFlags));
  const contextMode = stringValue(context(data).mode) ?? '';

  const initialMode = initialResponseMode(mode, risk, riskFlags);
  const progress = progressPhases(mode, stageHint, riskFlags);
  const finalMode = finalizationMode(mode, risk, initialMode);

  return {
    schemaVersion: CONVERSATION_RESPONSE_PLAN_SCHEMA_VERSION,
    initialResponseMode: initialMode,
    finalizationMode: finalMode,
    userVisibleProgress: progress,
    progressPhases: progress,
    fallbackMessagePolicy: fallbackMessagePolicy(mode, risk, riskFlags),
    backgroundCompletionSummary: backgroundSummary(mode, risk, contextMode),
    reason: responseReason(mode, risk, initialMode, riskFlags),
    signals: {
      executionMode: mode,
      contextMode,
      riskLevel: risk,
      riskFlags: Array.from(riskFlags).sort(),
    },
  };
}

export function buildConversationBackgroundPlan(request: unknown): ConversationBackgroundPlan {
  const data = recordValue(request);
  const mode = executionMode(data);
  const risk = riskLevel(data);
  const riskFlags = new Set(toStringList(execution(data).riskFlags));
  const hasRefs = toRecordList(data.currentReferenceDigests).length > 0 || toRecordList(data.currentReferences).length > 0;
  const hasArtifacts = artifactEntries(data).length > 0;
  const signals = execution(data).signals;
  const hasVerifier = hasSelectedKind(data, 'verifier') || toStringList(signals).includes('verifier');

  const tasks = backgroundTasks(mode, risk, riskFlags, hasRefs, hasArtifacts, hasVerifier);
  const enabled = tasks.length > 0 && risk !== 'high' && mode !== 'direct-context-answer';

  return {
    schemaVersion: CONVERSATION_BACKGROUND_PLAN_SCHEMA_VERSION,
    enabled,
    tasks,
    handoffRefsRequired: handoffRefsRequired(mode, risk, hasRefs, hasArtifacts, riskFlags),
    cancelOnNewUserTurn: cancelOnNewUserTurn(mode, risk, riskFlags),
    reason: backgroundReason(mode, risk, tasks, enabled),
    signals: {
      executionMode: mode,
      riskLevel: risk,
      hasCurrentRefs: hasRefs,
      hasArtifactIndex: hasArtifacts,
      riskFlags: Array.from(riskFlags).sort(),
    },
  };
}

function initialResponseMode(mode: string, risk: RiskLevel, riskFlags: Set<string>): string {
  if (risk === 'high') return 'wait-for-result';
  if (mode === 'direct-context-answer') return 'direct-context-answer';
  if (mode === 'thin-reproducible-adapter') return 'quick-status';
  if (mode === 'repair-or-continue-project') return 'quick-status';
  if (mode === 'multi-stage-project') return 'quick-status';
  if (riskFlags.has('external-information-required')) return 'streaming-draft';
  return 'streaming-draft';
}

function finalizationMode(mode: string, risk: RiskLevel, initialMode: string): string {
  if (mode === 'direct-context-answer') return 'update-artifacts-only';
  if (risk === 'high' || initialMode === 'wait-for-result') return 'append-final';
  if (initialMode === 'streaming-draft') return 'replace-draft';
  return 'append-final';
}

function progressPhases(mode: string, stageHint: string[], riskFlags: Set<string>): string[] {
  if (mode === 'direct-context-answer') return ['answer'];
  let phases = stageHint.length ? [...stageHint] : ['plan', 'analyze', 'emit'];
  if (phases.length && phases[0] !== 'plan' && ['multi-stage-project', 'repair-or-continue-project'].includes(mode)) {
    phases = ['plan', ...phases];
  }
  if (riskFlags.has('recent-failure') && !phases.includes('repair')) {
    phases = phases.length ? [...phases.slice(0, -1), 'repair', phases[phases.length - 1]] : ['repair'];
  }
  return uniqueStrings(phases);
}

function fallbackMessagePolicy(mode: string, risk: RiskLevel, riskFlags: Set<string>): string {
  if (risk === 'high') return 'safety-first-status-with-required-confirmation';
  if (riskFlags.has('recent-failure')) return 'truthful-repair-status-with-next-step';
  if (mode === 'direct-context-answer') return 'truthful-direct-answer-with-current-refs';
  return 'truthful-partial-with-next-step';
}

function backgroundTasks(
  mode: string,
  risk: RiskLevel,
  riskFlags: Set<string>,
  hasRefs: boolean,
  hasArtifacts: boolean,
  hasVerifier: boolean,
): string[] {
  if (mode === 'direct-context-answer') return [];
  const tasks: string[] = [];
  if (['thin-reproducible-adapter', 'multi-stage-project'].includes(mode)) tasks.push('evidence-completion');
  if (['single-stage-task', 'multi-stage-project', 'repair-or-continue-project'].includes(mode)) {
    tasks.push('output-materialization');
  }
  if (hasVerifier || ['medium', 'high'].includes(risk) || riskFlags.has('code-or-workspace-side-effect')) {
    tasks.push('verification');
  }
  if (hasRefs) tasks.push('reference-digest-refresh');
  if (hasArtifacts) tasks.push('workspace-index-refresh');
  if (mode === 'repair-or-continue-project' || riskFlags.has('recent-failure')) tasks.push('failure-recovery');
  if (risk === 'high') tasks.push('blocking-handoff-precheck');
  return uniqueStrings(tasks);
}

function handoffRefsRequired(
  mode: string,
  risk: RiskLevel,
  hasRefs: boolean,
  hasArtifacts: boolean,
  riskFlags: Set<string>,
): boolean {
  return mode !== 'direct-context-answer' || ['medium', 'high'].includes(risk) || hasRefs || hasArtifacts || riskFlags.size > 0;
}

function cancelOnNewUserTurn(mode: string, risk: RiskLevel, riskFlags: Set<string>): boolean {
  if (risk === 'high') return true;
  if (riskFlags.has('code-or-workspace-side-effect')) return true;
  return ['thin-reproducible-adapter', 'single-stage-task'].includes(mode);
}

function backgroundSummary(mode: string, risk: RiskLevel, contextMode: string): string {
  if (mode === 'direct-context-answer') return 'No background completion is required for a current-context answer.';
  if (risk === 'high') return 'Background completion is disabled until required safety checks complete.';
  if (contextMode === 'repair') return 'Repair evidence and final artifacts may complete after the initial status.';
  return 'Non-blocking evidence, artifact, or verification work may continue after the initial response.';
}

function responseReason(mode: string, risk: RiskLevel, initialMode: string, riskFlags: Set<string>): string {
  const parts = [`${mode} uses ${initialMode}`, `risk=${risk}`];
  if (riskFlags.size) parts.push(`flags=${Array.from(riskFlags).sort().slice(0, 4).join(',')}`);
  return parts.join('; ');
}

function backgroundReason(mode: string, risk: RiskLevel, tasks: string[], enabled: boolean): string {
  if (!tasks.length) return `${mode} has no background tasks.`;
  if (!enabled) return `${mode} background tasks are blocked by ${risk} risk.`;
  return `${mode} can continue background tasks: ${tasks.slice(0, 4).join(', ')}.`;
}

function riskLevel(data: JsonMap): RiskLevel {
  let rank = 1;
  for (const item of selectedCapabilities(data)) {
    const record = recordValue(item);
    if (record) rank = Math.max(rank, RISK_RANK[(stringValue(record.riskLevel) ?? 'low').toLowerCase()] ?? 1);
  }
  const riskFlags = new Set(toStringList(execution(data).riskFlags));
  if (riskFlags.has('code-or-workspace-side-effect')) rank = Math.max(rank, 2);
  if (hasSelectedKind(data, 'action')) rank = Math.max(rank, 2);
  if (selectedCapabilities(data).some((item) => capabilityText(item).includes('high'))) rank = Math.max(rank, 3);
  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium';
  return 'low';
}

function executionMode(data: JsonMap): string {
  return stringValue(execution(data).executionMode) ?? 'single-stage-task';
}

function execution(data: JsonMap): JsonMap {
  return recordValue(data.executionModePlan) || recordValue(data.execution) || {};
}

function context(data: JsonMap): JsonMap {
  return recordValue(data.contextPolicy) || {};
}

function selectedCapabilities(data: JsonMap): unknown[] {
  const brief = recordValue(data.capabilityBrief) || {};
  const policyInput = recordValue(data.policyInput) || {};
  const hints = recordValue(policyInput.policyHints) || {};
  const metadata = recordValue(policyInput.metadata) || {};
  return [
    ...arrayValue(brief.selected),
    ...arrayValue(hints.selectedCapabilities),
    ...arrayValue(hints.selectedActions),
    ...arrayValue(hints.selectedVerifiers),
    ...arrayValue(metadata.selectedCapabilities),
    ...arrayValue(metadata.selectedActions),
    ...arrayValue(metadata.selectedVerifiers),
  ];
}

function hasSelectedKind(data: JsonMap, kind: string): boolean {
  return selectedCapabilities(data).some((item) => {
    const record = recordValue(item);
    return (stringValue(record?.kind) ?? '').toLowerCase() === kind;
  });
}

function artifactEntries(data: JsonMap): unknown[] {
  const index = recordValue(data.artifactIndex) || {};
  return arrayValue(index.entries);
}

function capabilityText(value: unknown): string {
  const record = recordValue(value);
  if (!record) return String(value ?? '').toLowerCase();
  return ['id', 'title', 'kind', 'reason', 'riskLevel']
    .map((key) => stringValue(record[key]) ?? '')
    .join(' ')
    .toLowerCase();
}

function recordValue(value: unknown): JsonMap {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
