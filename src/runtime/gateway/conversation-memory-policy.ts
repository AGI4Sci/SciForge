export const CONVERSATION_MEMORY_PLAN_SCHEMA_VERSION = 'sciforge.conversation.memory-plan.v1' as const;

type JsonMap = Record<string, unknown>;

const INLINE_IMAGE_PAYLOAD = /data:image|;base64,/gi;

export interface ConversationMemoryPlan {
  schemaVersion: typeof CONVERSATION_MEMORY_PLAN_SCHEMA_VERSION;
  mode: string;
  recentConversation: JsonMap[];
  recentRuns: JsonMap[];
  conversationLedger: JsonMap[];
  currentReferenceFocus: string[];
  pollutionGuard: JsonMap;
}

export function buildConversationMemoryPlan(request: unknown): ConversationMemoryPlan {
  const data = recordValue(request) ?? {};
  const session = firstRecord(data.session);
  const policy = firstRecord(data.contextPolicy, data.context_policy);
  const snapshot = firstRecord(data.goalSnapshot, data.goal_snapshot);
  const explicitRefs = stringListValue(
    firstValue(data, 'references', 'refs') ?? snapshot.requiredReferences ?? [],
  );
  const messages = arrayValue(session.messages);
  const runs = arrayValue(session.runs);
  const mode = textValue(policy.mode) || 'isolate';

  const ledger = buildConversationLedger(messages, runs);
  const selectedMessages = selectMessages(messages, mode, explicitRefs);
  const selectedRuns = selectRuns(runs, mode, explicitRefs);
  const excluded = excludedHistory(messages, runs, selectedMessages, selectedRuns, mode, explicitRefs);

  return {
    schemaVersion: CONVERSATION_MEMORY_PLAN_SCHEMA_VERSION,
    mode,
    recentConversation: selectedMessages,
    recentRuns: selectedRuns,
    conversationLedger: ledger,
    currentReferenceFocus: explicitRefs,
    pollutionGuard: {
      fileRefOnly: true,
      explicitReferencesFirst: explicitRefs.length > 0,
      excludedHistory: excluded,
    },
  };
}

export const buildMemoryPlan = buildConversationMemoryPlan;

export function buildConversationLedger(messages: unknown[], runs: unknown[] | null = null): JsonMap[] {
  const ledger: JsonMap[] = [];
  messages.forEach((message, index) => {
    const item = recordValue(message) ?? {};
    ledger.push({
      kind: 'message',
      id: textValue(item.id) || `message-${index + 1}`,
      role: textValue(item.role) || 'unknown',
      summary: digestSummary(item, 'session-message-body'),
      refs: refsFromItem(item),
    });
  });
  (runs ?? []).forEach((run, index) => {
    const item = recordValue(run) ?? {};
    ledger.push({
      kind: 'run',
      id: textValue(item.id) || textValue(item.runId) || `run-${index + 1}`,
      status: textValue(item.status) || 'unknown',
      summary: clip(sanitizeText(textValue(item.summary) || textValue(item.message) || textValue(item.error)), 220),
      refs: refsFromItem(item),
    });
  });
  return ledger.slice(-30);
}

function selectMessages(messages: unknown[], mode: string, explicitRefs: string[]): JsonMap[] {
  const selected: JsonMap[] = [];
  for (const message of messages) {
    const item = recordValue(message) ?? {};
    if (mode === 'isolate' && !itemMentionsRefs(item, explicitRefs)) continue;
    if (explicitRefs.length > 0 && !itemMentionsRefs(item, explicitRefs)) continue;
    if (['continue', 'repair'].includes(mode) || itemMentionsRefs(item, explicitRefs)) {
      selected.push(compactMessage(item));
    }
  }
  return selected.slice(-8);
}

function selectRuns(runs: unknown[], mode: string, explicitRefs: string[]): JsonMap[] {
  const selected: JsonMap[] = [];
  for (const run of runs) {
    const item = recordValue(run) ?? {};
    if (explicitRefs.length > 0 && !itemMentionsRefs(item, explicitRefs)) continue;
    if (mode === 'repair') {
      const status = textValue(item.status).toLowerCase();
      if (['failed', 'failed-with-reason', 'error'].includes(status) || itemMentionsRefs(item, explicitRefs)) {
        selected.push(compactRun(item));
      }
      continue;
    }
    if (mode === 'continue') {
      selected.push(compactRun(item));
    } else if (itemMentionsRefs(item, explicitRefs)) {
      selected.push(compactRun(item));
    }
  }
  return selected.slice(-5);
}

function excludedHistory(
  messages: unknown[],
  runs: unknown[],
  selectedMessages: JsonMap[],
  selectedRuns: JsonMap[],
  mode: string,
  explicitRefs: string[],
): Array<{ id: string; reason: string }> {
  const selectedIds = new Set([...selectedMessages, ...selectedRuns].map((item) => String(item.id)));
  const excluded: Array<{ id: string; reason: string }> = [];
  const reason = explicitRefs.length > 0 ? 'not-current-reference-grounded' : 'isolated-new-task';
  if (['continue', 'repair'].includes(mode) && explicitRefs.length === 0) return [];
  for (const item of [...messages, ...runs]) {
    const mapped = recordValue(item) ?? {};
    const itemId = textValue(mapped.id) || textValue(mapped.runId);
    if (itemId && !selectedIds.has(itemId)) excluded.push({ id: itemId, reason });
  }
  return excluded.slice(-20);
}

function compactMessage(item: JsonMap): JsonMap {
  return {
    id: textValue(item.id),
    role: textValue(item.role) || 'unknown',
    contentOmitted: true,
    contentDigest: digestRecord(item, 'session-message-body'),
    refs: refsFromItem(item),
  };
}

function compactRun(item: JsonMap): JsonMap {
  return {
    id: textValue(item.id) || textValue(item.runId),
    status: textValue(item.status) || 'unknown',
    summary: clip(sanitizeText(textValue(item.summary) || textValue(item.message) || textValue(item.error)), 900),
    refs: refsFromItem(item),
  };
}

function itemMentionsRefs(item: JsonMap, refs: string[]): boolean {
  if (!refs.length) return false;
  const haystack = refsFromItem(item).join('\n').toLowerCase();
  return refs.some((ref) => haystack.includes(ref.toLowerCase()));
}

function refsFromItem(item: JsonMap): string[] {
  const refs: string[] = [];
  for (const key of ['refs', 'references', 'artifactRefs', 'traceRefs', 'resultRefs']) {
    refs.push(...stringListValue(item[key]));
  }
  refs.push(...stringListValue(item.objectReferences));
  for (const key of ['contentDigest', 'messageDigest', 'payloadDigest', 'responseDigest', 'promptDigest']) {
    const digest = recordValue(item[key]);
    if (digest) refs.push(...stringListValue(digest.refs));
  }
  return dedupe(refs);
}

function digestRecord(item: JsonMap, fallbackOmitted: string): JsonMap {
  const existing = firstRecord(
    item.contentDigest,
    item.messageDigest,
    item.payloadDigest,
    item.responseDigest,
    item.promptDigest,
  );
  if (Object.keys(existing).length) return {
    omitted: textValue(existing.omitted) || fallbackOmitted,
    chars: typeof existing.chars === 'number' ? existing.chars : undefined,
    hash: textValue(existing.hash),
    refs: stringListValue(existing.refs),
  };
  const body = textValue(item.content) || textValue(item.text) || textValue(item.prompt);
  return body
    ? { omitted: fallbackOmitted, chars: body.length, hash: stableTextHash(body), refs: refsFromItem({ ...item, content: undefined, text: undefined, prompt: undefined }) }
    : { omitted: fallbackOmitted, chars: 0, refs: refsFromItem({ ...item, content: undefined, text: undefined, prompt: undefined }) };
}

function digestSummary(item: JsonMap, fallbackOmitted: string) {
  const digest = digestRecord(item, fallbackOmitted);
  const hash = textValue(digest.hash) || 'none';
  const chars = typeof digest.chars === 'number' ? digest.chars : 0;
  const refs = stringListValue(digest.refs);
  return refs.length
    ? `${fallbackOmitted} omitted; hash=${hash}; chars=${chars}; refs=${refs.slice(0, 4).join(', ')}`
    : `${fallbackOmitted} omitted; hash=${hash}; chars=${chars}`;
}

function sanitizeText(text: string): string {
  return text.replace(INLINE_IMAGE_PAYLOAD, '[inline-image-payload-removed]');
}

function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 24)).trimEnd()} [truncated]`;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
