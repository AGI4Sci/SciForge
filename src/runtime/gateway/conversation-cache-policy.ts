export const CONVERSATION_CACHE_POLICY_SCHEMA_VERSION = 'sciforge.conversation.cache-policy.v1' as const;

type JsonMap = Record<string, unknown>;

const RISK_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface ConversationCachePolicy {
  schemaVersion: typeof CONVERSATION_CACHE_POLICY_SCHEMA_VERSION;
  reuseScenarioPlan: boolean;
  reuseSkillPlan: boolean;
  reuseUiPlan: boolean;
  reuseUIPlan: boolean;
  reuseReferenceDigests: boolean;
  reuseArtifactIndex: boolean;
  reuseLastSuccessfulStage: boolean;
  reuseBackendSession: boolean;
  scenarioPlan: JsonMap;
  skillPlan: JsonMap;
  uiPlan: JsonMap;
  referenceDigests: JsonMap;
  artifactIndex: JsonMap;
  lastSuccessfulStage: JsonMap;
  backendSession: JsonMap;
  reason: string;
  signals: JsonMap;
}

export function buildConversationCachePolicy(request: unknown): ConversationCachePolicy {
  const data = recordValue(request) ?? {};
  const execution = recordValue(data.executionModePlan) ?? {};
  const context = recordValue(data.contextPolicy) ?? {};
  const mode = stringValue(execution.executionMode) ?? 'single-stage-task';
  const contextMode = stringValue(context.mode) ?? '';
  const risk = riskLevel(data);
  const riskFlags = new Set(stringArrayValue(execution.riskFlags));
  const recentFailure = riskFlags.has('recent-failure') || hasRecentFailure(data);
  const explicitRefs = hasExplicitRefs(data);
  const digestState = digestStateFor(data);
  const artifactState = artifactStateFor(data);
  const lastSuccess = lastSuccessfulStage(data);

  const scenarioReuse = contextMode !== 'isolate' && !recentFailure && risk !== 'high';
  const skillReuse = risk !== 'high' && !recentFailure;
  const uiReuse = risk !== 'high' && mode !== 'repair-or-continue-project';
  const referenceReuse = digestState.hasDigests && !digestState.hasUnresolved
    && (['continue', 'repair'].includes(contextMode) || explicitRefs);
  const artifactReuse = artifactState.hasEntries && ['continue', 'repair'].includes(contextMode);
  const lastStageReuse = Boolean(lastSuccess)
    && ['repair-or-continue-project', 'multi-stage-project'].includes(mode)
    && !(risk === 'high' || riskFlags.has('code-or-workspace-side-effect'));
  const backendSessionReuse = ['continue', 'repair'].includes(contextMode) && risk !== 'high' && !recentFailure;

  return {
    schemaVersion: CONVERSATION_CACHE_POLICY_SCHEMA_VERSION,
    reuseScenarioPlan: scenarioReuse,
    reuseSkillPlan: skillReuse,
    reuseUiPlan: uiReuse,
    reuseUIPlan: uiReuse,
    reuseReferenceDigests: referenceReuse,
    reuseArtifactIndex: artifactReuse,
    reuseLastSuccessfulStage: lastStageReuse,
    reuseBackendSession: backendSessionReuse,
    scenarioPlan: decision(scenarioReuse, 'scenario context may be reused', 'isolated, failed, or high-risk turn'),
    skillPlan: decision(skillReuse, 'selected capability plan is reusable', 'failure or high risk requires fresh selection'),
    uiPlan: decision(uiReuse, 'UI component plan is reusable', 'repair or high risk requires fresh UI plan'),
    referenceDigests: decision(referenceReuse, digestState.reason, 'reference digests are absent, unresolved, or not in reusable context'),
    artifactIndex: decision(artifactReuse, artifactState.reason, 'artifact index is absent or current turn is isolated'),
    lastSuccessfulStage: decision(lastStageReuse, lastStageReason(lastSuccess), 'no compatible successful stage may be reused'),
    backendSession: decision(backendSessionReuse, 'same-task backend session can continue', 'backend session should be fresh for isolation, failure, or high risk'),
    reason: reason(mode, contextMode, risk, recentFailure),
    signals: {
      executionMode: mode,
      contextMode,
      riskLevel: risk,
      riskFlags: Array.from(riskFlags).sort(),
      recentFailure,
      explicitRefs,
      referenceDigestCount: digestState.count,
      artifactEntryCount: artifactState.count,
    },
  };
}

export const buildConversationCachePolicyFromRequest = buildConversationCachePolicy;

function decision(reuse: boolean, reuseReason: string, missReason: string): JsonMap {
  return { reuse, reason: reuse ? reuseReason : missReason };
}

function digestStateFor(data: JsonMap): { hasDigests: boolean; hasUnresolved: boolean; count: number; reason: string } {
  const digests = arrayValue(data.currentReferenceDigests);
  const unresolved = digests.filter((digest) => {
    const item = recordValue(digest);
    if (!item) return false;
    return !['ok', 'metadata-only', 'unsupported'].includes((stringValue(item.status) ?? '').toLowerCase());
  });
  if (!digests.length) {
    return { hasDigests: false, hasUnresolved: false, count: 0, reason: 'no reference digests are available' };
  }
  if (unresolved.length) {
    return { hasDigests: true, hasUnresolved: true, count: digests.length, reason: 'one or more reference digests are unresolved' };
  }
  return { hasDigests: true, hasUnresolved: false, count: digests.length, reason: 'bounded current reference digests are reusable' };
}

function artifactStateFor(data: JsonMap): { hasEntries: boolean; count: number; reason: string } {
  const index = recordValue(data.artifactIndex) ?? {};
  const entries = arrayValue(index.entries);
  return {
    hasEntries: Boolean(entries.length),
    count: entries.length,
    reason: entries.length ? 'artifact index entries can anchor the continuing turn' : 'artifact index has no entries',
  };
}

function lastSuccessfulStage(data: JsonMap): JsonMap | undefined {
  const session = recordValue(data.session) ?? {};
  const candidates: unknown[] = [];
  for (const key of ['executionUnits', 'runs', 'attempts', 'stages']) {
    candidates.push(...arrayValue(session[key]));
  }
  for (const key of ['priorAttempts', 'attempts']) {
    candidates.push(...arrayValue(data[key]));
  }
  for (const item of candidates.reverse()) {
    const record = recordValue(item);
    if (!record) continue;
    const status = (stringValue(record.status) ?? stringValue(record.state) ?? '').toLowerCase();
    if (['ok', 'success', 'succeeded', 'completed', 'done', 'passed'].includes(status)) return record;
  }
  return undefined;
}

function lastStageReason(stage: JsonMap | undefined): string {
  const stageId = stringValue(stage?.stageId) ?? stringValue(stage?.id) ?? stringValue(stage?.name);
  return stageId ? `last successful stage ${stageId} can seed continuation` : 'last successful stage can seed continuation';
}

function riskLevel(data: JsonMap): 'low' | 'medium' | 'high' {
  let rank = 1;
  const brief = recordValue(data.capabilityBrief) ?? {};
  for (const item of selectedCapabilities(data, brief)) {
    const record = recordValue(item);
    if (record) {
      rank = Math.max(rank, RISK_RANK[(stringValue(record.riskLevel) ?? 'low').toLowerCase()] ?? 1);
      if ((stringValue(record.kind) ?? '').toLowerCase() === 'action') rank = Math.max(rank, 2);
    }
    if (String(item).toLowerCase().includes('high')) rank = Math.max(rank, 3);
  }
  const execution = recordValue(data.executionModePlan) ?? {};
  const riskFlags = new Set(stringArrayValue(execution.riskFlags));
  if (riskFlags.has('code-or-workspace-side-effect')) rank = Math.max(rank, 2);
  return ({ 0: 'low', 1: 'low', 2: 'medium', 3: 'high', 4: 'high' } as Record<number, 'low' | 'medium' | 'high'>)[rank] ?? 'low';
}

function selectedCapabilities(data: JsonMap, brief: JsonMap): unknown[] {
  const policyInput = recordValue(data.policyInput) ?? {};
  const hints = recordValue(policyInput.policyHints) ?? {};
  const metadata = recordValue(policyInput.metadata) ?? {};
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

function hasRecentFailure(data: JsonMap): boolean {
  if (arrayValue(data.recentFailures).length || arrayValue(data.failures).length) return true;
  const session = recordValue(data.session) ?? {};
  for (const item of [...arrayValue(session.runs), ...arrayValue(session.executionUnits)]) {
    const record = recordValue(item);
    if (!record) continue;
    const status = (stringValue(record.status) ?? stringValue(record.state) ?? '').toLowerCase();
    if (['failed', 'error', 'failure', 'timed-out', 'timeout'].includes(status) || record.failureReason) return true;
  }
  return false;
}

function hasExplicitRefs(data: JsonMap): boolean {
  if (arrayValue(data.currentReferences).length || arrayValue(data.references).length || arrayValue(data.refs).length) return true;
  const memory = recordValue(data.memoryPlan) ?? {};
  return Boolean(arrayValue(memory.currentReferenceFocus).length);
}

function reason(mode: string, contextMode: string, risk: string, recentFailure: boolean): string {
  const parts = [`executionMode=${mode}`, `contextMode=${contextMode || 'unknown'}`, `risk=${risk}`];
  if (recentFailure) parts.push('recent failure forces fresh work where needed');
  return parts.join('; ');
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown): string[] {
  return arrayValue(value).filter((item): item is string | number | boolean => item !== null && item !== undefined).map(String);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
