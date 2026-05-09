export const CONVERSATION_CONTEXT_POLICY_SCHEMA_VERSION = 'sciforge.conversation.context-policy.v1' as const;

type JsonMap = Record<string, unknown>;

const REPAIR_HINTS = ['repair', 'fix', 'debug', 'failed', 'failure', 'error', 'log', 'rerun', '修复', '失败', '报错', '日志', '重跑', '排查'];
const CONTINUE_HINTS = ['continue', 'follow up', 'follow-up', 'previous', 'prior', 'last round', '接着', '继续', '上一轮', '刚才', '前面'];
const LOCATION_HINTS = ['where is', 'where are', 'location', 'path', 'file ref', 'file refs', 'artifact ref', 'artifact refs', '文件在哪', '文件哪里', '位置', '路径', '报告', '图表'];
const NEW_TASK_HINTS = ['new task', 'start over', 'ignore previous', 'unrelated', '另一个任务', '新任务', '重新开始', '不要沿用', '别用上一轮'];

export interface ConversationContextPolicy {
  schemaVersion: typeof CONVERSATION_CONTEXT_POLICY_SCHEMA_VERSION;
  mode: string;
  historyReuse: JsonMap;
  referencePriority: JsonMap;
  pollutionGuard: JsonMap;
  repairPolicy?: JsonMap;
}

export function buildConversationContextPolicy(request: unknown): ConversationContextPolicy {
  const data = recordValue(request) ?? {};
  const prompt = textValue(firstValue(data, 'prompt', 'rawPrompt', 'message'));
  const snapshot = firstRecord(data.goalSnapshot, data.goal_snapshot);
  const explicitRefs = stringListValue(
    firstValue(data, 'references', 'refs') ?? snapshot.requiredReferences ?? [],
  );
  const session = firstRecord(data.session);
  const priorGoal = lastPriorGoal(session);
  const relation = textValue(snapshot.taskRelation);

  const mode = inferMode(prompt, relation, explicitRefs.length > 0);
  let allowHistory = ['continue', 'repair'].includes(mode) && mode !== 'isolate';
  if (explicitRefs.length > 0 && mode === 'continue' && !hasAny(prompt, CONTINUE_HINTS)) {
    allowHistory = false;
  }

  const policy: ConversationContextPolicy = {
    schemaVersion: CONVERSATION_CONTEXT_POLICY_SCHEMA_VERSION,
    mode,
    historyReuse: {
      allowed: allowHistory,
      scope: historyScope(mode, explicitRefs),
      maxPriorTurns: ['continue', 'repair'].includes(mode) ? 8 : 0,
    },
    referencePriority: {
      explicitReferences: explicitRefs,
      explicitReferencesFirst: explicitRefs.length > 0,
      historyFallbackAllowed: allowHistory && explicitRefs.length === 0,
    },
    pollutionGuard: {
      dropStaleHistory: mode === 'isolate' || explicitRefs.length > 0,
      requireCurrentReferenceGrounding: explicitRefs.length > 0,
      previousGoal: priorGoal,
      reason: reason(mode, prompt, explicitRefs, priorGoal),
    },
  };
  if (mode === 'repair') {
    policy.repairPolicy = {
      target: 'previous-run',
      includeFailureEvidence: true,
      doNotDeclareSuccessWithoutEvidence: true,
    };
  }
  return policy;
}

export const buildContextPolicy = buildConversationContextPolicy;

export function shouldIsolateHistory(request: unknown): boolean {
  return buildConversationContextPolicy(request).mode === 'isolate';
}

function inferMode(prompt: string, relation: string, hasExplicitRefs: boolean): string {
  if (relation === 'repair' || hasAny(prompt, REPAIR_HINTS)) return 'repair';
  if (hasAny(prompt, NEW_TASK_HINTS)) return 'isolate';
  if (relation === 'continue' || hasAny(prompt, CONTINUE_HINTS) || hasAny(prompt, LOCATION_HINTS)) return 'continue';
  if (relation === 'new-task') return 'isolate';
  if (hasExplicitRefs) return 'isolate';
  return 'isolate';
}

function historyScope(mode: string, explicitRefs: string[]): string {
  if (mode === 'repair') return 'previous-run-and-failure-evidence';
  if (mode === 'continue') return 'same-task-recent-turns';
  if (explicitRefs.length > 0) return 'current-explicit-references-only';
  return 'none';
}

function reason(mode: string, prompt: string, explicitRefs: string[], priorGoal: string): string {
  if (mode === 'repair') return 'repair intent detected; include only prior failure context and current refs';
  if (mode === 'continue') return 'continuation intent detected; reuse same-task recent context';
  if (explicitRefs.length > 0) return 'explicit current references outrank old session memory';
  if (priorGoal) return 'new task defaults to isolation from previous goal';
  return 'no continuation or repair signal';
}

function lastPriorGoal(session: JsonMap): string {
  const messages = arrayValue(session.messages);
  for (const message of [...messages].reverse()) {
    const item = recordValue(message);
    if (!item) continue;
    const snapshot = firstRecord(item.goalSnapshot, item.goal_snapshot);
    const raw = textValue(snapshot.rawPrompt) || textValue(snapshot.normalizedPrompt);
    if (raw) return raw;
  }
  return '';
}

function firstValue(record: JsonMap, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonMap {
  for (const value of values) {
    const record = recordValue(value);
    if (record) return record;
  }
  return {};
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasAny(text: string, hints: string[]): boolean {
  const lowered = text.toLowerCase();
  return hints.some((hint) => lowered.includes(hint.toLowerCase()));
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function stringListValue(value: unknown): string[] {
  const refs: string[] = [];
  for (const item of arrayValue(value)) {
    if (typeof item === 'string') {
      refs.push(item);
      continue;
    }
    const record = recordValue(item);
    if (!record) continue;
    const ref = firstValue(record, 'ref', 'path', 'id', 'uri');
    if (ref) refs.push(String(ref));
  }
  return dedupe(refs);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
