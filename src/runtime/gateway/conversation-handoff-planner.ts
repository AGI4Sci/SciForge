import { createHash } from 'node:crypto';
import {
  CANONICAL_HANDOFF_FORBIDDEN_KEYS,
  normalizeCanonicalHandoffValue,
} from '../workspace-task-input.js';

export const CONVERSATION_HANDOFF_PLAN_SCHEMA_VERSION = 'sciforge.conversation.handoff-plan.v1' as const;

type JsonMap = Record<string, unknown>;

const DEFAULT_MARKDOWN_REPORT_TYPE = ['research', 'report'].join('-');
const REFERENCE_KEYS = ['ref', 'dataRef', 'path', 'filePath', 'markdownRef', 'contentRef', 'stdoutRef', 'stderrRef', 'outputRef'] as const;
const FORBIDDEN_HANDOFF_KEYS = CANONICAL_HANDOFF_FORBIDDEN_KEYS;

export interface ConversationHandoffPlanInput {
  [key: string]: unknown;
}

export interface ConversationHandoffPlan {
  schemaVersion: typeof CONVERSATION_HANDOFF_PLAN_SCHEMA_VERSION;
  status: string;
  ok: boolean;
  payload?: JsonMap;
  budget: Record<string, number>;
  normalizedBytes: number;
  decisions: JsonMap[];
  requiredArtifacts?: JsonMap[];
  auditRefs?: string[];
  reason?: { code: string; message: string };
  nextActions?: string[];
  evidenceRefs?: string[];
}

const DEFAULT_HANDOFF_BUDGET: Record<string, number> = {
  maxPayloadBytes: 220_000,
  maxInlineStringChars: 12_000,
  maxInlineJsonBytes: 48_000,
  maxArrayItems: 24,
  maxObjectKeys: 80,
  headChars: 2_000,
  tailChars: 2_000,
  maxPriorAttempts: 4,
};

export function planConversationHandoff(request: ConversationHandoffPlanInput = {}): ConversationHandoffPlan {
  const budget = normalizeBudget(recordValue(request.budget));
  const decisions: JsonMap[] = [];
  const requiredArtifacts = requiredArtifactsFor(request);
  let payload = omitEmpty({
    goal: compactValue(request.goal ?? {}, budget, decisions, ['goal']),
    prompt: compactPrompt(stringValue(request.prompt) ?? stringValue(recordValue(request.goal)?.prompt), budget, decisions),
    policy: compactValue(request.policy ?? {}, budget, decisions, ['policy']),
    currentReferenceDigests: compactRefs(arrayValue(request.currentReferenceDigests ?? request.digests), budget, decisions),
    artifacts: compactArtifacts(arrayValue(request.artifacts), budget, decisions),
    handoffMemoryProjection: compactHandoffProjection(recordValue(request.handoffMemoryProjection) ?? {}, budget, decisions),
    requiredArtifacts,
  });
  payload = normalizeCanonicalHandoffValue(payload, {
    maxArrayItems: budget.maxArrayItems,
    maxObjectKeys: budget.maxObjectKeys,
    maxDepth: 7,
  }) as JsonMap;
  let normalizedBytes = estimateBytes(payload);

  if (normalizedBytes > budget.maxPayloadBytes) {
    decisions.push({
      kind: kind('handoff', 'payload'),
      reason: kind('payload', 'budget'),
      estimatedBytes: normalizedBytes,
      maxPayloadBytes: budget.maxPayloadBytes,
    });
    payload = normalizeCanonicalHandoffValue(emergencyPayload(request, requiredArtifacts, budget, decisions), {
      maxArrayItems: budget.maxArrayItems,
      maxObjectKeys: budget.maxObjectKeys,
      maxDepth: 7,
    }) as JsonMap;
    normalizedBytes = estimateBytes(payload);
  }

  if (normalizedBytes > budget.maxPayloadBytes) {
    return {
      ...failedResult(
        code('handoff', 'budget', 'exceeded'),
        `Compacted handoff is ${normalizedBytes} bytes, above budget ${budget.maxPayloadBytes}.`,
        [
          'Persist large prompt/artifact inputs behind workspace refs.',
          'Retry with a smaller recent conversation window.',
          'Provide currentReferenceDigests instead of inline source content.',
        ],
      ),
      budget,
      decisions,
      normalizedBytes,
    };
  }

  return {
    schemaVersion: CONVERSATION_HANDOFF_PLAN_SCHEMA_VERSION,
    status: 'ready',
    ok: true,
    payload,
    budget,
    normalizedBytes,
    decisions,
    requiredArtifacts,
    auditRefs: auditRefs(request, payload),
  };
}

export const planHandoff = planConversationHandoff;

function normalizeBudget(raw: JsonMap | undefined): Record<string, number> {
  const budget = { ...DEFAULT_HANDOFF_BUDGET };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) budget[key] = value;
  }
  return budget;
}

function requiredArtifactsFor(request: JsonMap): JsonMap[] {
  const goal = recordValue(request.goal) ?? {};
  const raw = request.requiredArtifacts ?? goal.requiredArtifacts;
  const artifacts: JsonMap[] = [];
  for (const item of arrayValue(raw)) {
    if (typeof item === 'string' && item.trim()) {
      artifacts.push({ type: item.trim(), required: true });
      continue;
    }
    const record = recordValue(item);
    if (!record) continue;
    const itemType = stringValue(record.type) ?? stringValue(record.artifactType) ?? stringValue(record.id);
    if (!itemType) continue;
    artifacts.push({
      type: itemType,
      required: (record.required ?? true) !== false,
      requiresMarkdown: (record.requiresMarkdown ?? record.markdownRequired ?? false) === true,
      requiresRef: (record.requiresRef ?? record.refRequired ?? true) !== false,
    });
  }
  const requiredFormats = new Set([
    ...stringArrayValue(goal.requiredFormats),
    ...stringArrayValue(request.requiredFormats),
  ]);
  const prompt = stringValue(request.prompt) ?? stringValue(goal.prompt) ?? stringValue(goal.summary) ?? '';
  if ((requiredFormats.has('markdown') || requiredFormats.has('report') || looksLikeReportRequest(prompt))
    && !artifacts.some((item) => item.type === DEFAULT_MARKDOWN_REPORT_TYPE)) {
    artifacts.push({ type: DEFAULT_MARKDOWN_REPORT_TYPE, required: true, requiresMarkdown: true, requiresRef: true });
  }
  return artifacts;
}

function compactPrompt(userText: string | undefined, budget: Record<string, number>, decisions: JsonMap[]): unknown {
  if (!userText) return undefined;
  if (userText.length <= budget.maxInlineStringChars) return userText;
  decisions.push({
    kind: 'prompt',
    reason: kind('large', 'string'),
    rawSha1: digestText(userText),
    originalChars: userText.length,
    keptChars: budget.headChars + budget.tailChars,
  });
  return textSummary(userText, budget);
}

function compactRefs(refs: unknown[], budget: Record<string, number>, decisions: JsonMap[]): JsonMap[] {
  const out: JsonMap[] = [];
  for (const [index, ref] of refs.slice(0, budget.maxArrayItems).entries()) {
    const compact = recordValue(compactValue(ref, budget, decisions, ['currentReferenceDigests', String(index)]));
    if (compact) out.push(compact);
  }
  if (refs.length > budget.maxArrayItems) {
    decisions.push({ kind: kind('current', 'reference', 'digests'), reason: kind('array', 'budget'), originalCount: refs.length, keptCount: budget.maxArrayItems });
  }
  return out;
}

function compactArtifacts(artifacts: unknown[], budget: Record<string, number>, decisions: JsonMap[]): JsonMap[] {
  const out: JsonMap[] = [];
  for (const [index, item] of artifacts.slice(0, budget.maxArrayItems).entries()) {
    const artifact = recordValue(item);
    if (!artifact) continue;
    const refs = refsFromRecord(artifact);
    const metadata = recordValue(artifact.metadata) ?? {};
    const compact: JsonMap = {
      id: stringValue(artifact.id) ?? stringValue(artifact.name) ?? stringValue(artifact.type),
      type: stringValue(artifact.type) ?? stringValue(artifact.artifactType),
      ...refs,
      status: stringValue(artifact.status) ?? stringValue(metadata.status),
      metadata: compactValue(artifact.metadata ?? {}, budget, decisions, ['artifacts', String(index), 'metadata']),
    };
    const data = artifact.data;
    if (data !== undefined) {
      if (Object.keys(refs).length || estimateBytes(data) > budget.maxInlineJsonBytes) {
        compact.dataOmitted = true;
        compact.dataSummary = summaryFor(data, kind('artifact', 'data'));
        decisions.push({
          kind: kind('artifact', 'data'),
          reason: kind('refs', 'first'),
          artifactId: compact.id,
          estimatedBytes: estimateBytes(data),
        });
      } else {
        compact.data = compactValue(data, budget, decisions, ['artifacts', String(index), 'data']);
      }
    }
    out.push(omitEmpty(compact));
  }
  if (artifacts.length > budget.maxArrayItems) {
    decisions.push({ kind: 'artifacts', reason: kind('array', 'budget'), originalCount: artifacts.length, keptCount: budget.maxArrayItems });
  }
  return out;
}

function compactHandoffProjection(projection: JsonMap, budget: Record<string, number>, decisions: JsonMap[]): JsonMap {
  const out: JsonMap = {};
  for (const key of [
    'authority',
    'projectSessionMemory',
    'contextProjectionBlocks',
    'stablePrefixHash',
    'contextRefs',
    'selectedContextRefs',
    'retrievalTools',
    'currentReferenceFocus',
    'pollutionGuard',
    'priorAttempts',
  ]) {
    const value = projection[key];
    if (key === 'priorAttempts' && Array.isArray(value) && value.length > budget.maxPriorAttempts) {
      out[key] = value.slice(-budget.maxPriorAttempts).map((item, index) => compactValue(item, budget, decisions, ['handoffMemoryProjection', key, String(index)]));
      decisions.push({ kind: kind('prior', 'attempts'), reason: kind('array', 'budget'), originalCount: value.length, keptCount: budget.maxPriorAttempts });
      continue;
    }
    const compact = compactValue(value, budget, decisions, ['handoffMemoryProjection', key]);
    if (!isEmpty(compact)) out[key] = compact;
  }
  compactProjectionAlias(
    out,
    projection,
    'selectedMessageRefs',
    ['recentConversation'],
    budget,
    decisions,
  );
  compactProjectionAlias(
    out,
    projection,
    'selectedRunRefs',
    ['recentRuns'],
    budget,
    decisions,
  );
  return out;
}

function compactProjectionAlias(
  out: JsonMap,
  projection: JsonMap,
  targetKey: string,
  legacyKeys: string[],
  budget: Record<string, number>,
  decisions: JsonMap[],
): void {
  const sourceKey = projection[targetKey] !== undefined
    ? targetKey
    : legacyKeys.find((key) => projection[key] !== undefined);
  if (!sourceKey) return;
  if (sourceKey !== targetKey) {
    decisions.push({
      kind: kind('handoff', 'projection', 'legacy', 'key'),
      reason: kind('refs', 'first', 'rename'),
      sourceKey,
      targetKey,
    });
  }
  const compact = compactValue(projection[sourceKey], budget, decisions, ['handoffMemoryProjection', targetKey]);
  if (!isEmpty(compact)) out[targetKey] = compact;
}

function compactValue(value: unknown, budget: Record<string, number>, decisions: JsonMap[], path: string[]): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      decisions.push({ kind: 'binary', reason: kind('data', 'url'), pointer: `/${path.join('/')}`, rawSha1: digestText(value) });
      return { kind: kind('omitted', 'binary'), rawSha1: digestText(value), originalChars: value.length };
    }
    if (value.length > budget.maxInlineStringChars) {
      decisions.push({ kind: 'string', reason: kind('large', 'string'), pointer: `/${path.join('/')}`, rawSha1: digestText(value), originalChars: value.length });
      return textSummary(value, budget);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, budget.maxArrayItems).map((item, index) => compactValue(item, budget, decisions, [...path, String(index)]));
    if (value.length > budget.maxArrayItems) {
      decisions.push({ kind: 'array', reason: kind('array', 'budget'), pointer: `/${path.join('/')}`, originalCount: value.length, keptCount: budget.maxArrayItems });
    }
    return kept;
  }
  const record = recordValue(value);
  if (record) {
    if (estimateBytes(record) > budget.maxInlineJsonBytes && REFERENCE_KEYS.some((key) => stringValue(record[key]))) {
      return refsFromRecord(record);
    }
    const entries = Object.entries(record)
      .filter(([key]) => !FORBIDDEN_HANDOFF_KEYS.has(key))
      .slice(0, budget.maxObjectKeys);
    if (Object.keys(record).length > budget.maxObjectKeys) {
      decisions.push({ kind: 'object', reason: kind('object', 'key', 'budget'), pointer: `/${path.join('/')}`, originalCount: Object.keys(record).length, keptCount: budget.maxObjectKeys });
    }
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_HANDOFF_KEYS.has(key)) {
        decisions.push({ kind: kind('forbidden', 'field'), reason: kind('refs', 'first'), pointer: `/${[...path, key].join('/')}` });
      }
    }
    return Object.fromEntries(entries.map(([key, nested]) => [String(key), compactValue(nested, budget, decisions, [...path, String(key)])]));
  }
  return summaryFor(value, kind('unknown', 'value'));
}

function textSummary(text: string, budget: Record<string, number>): JsonMap {
  return {
    kind: kind('text', 'summary'),
    rawSha1: digestText(text),
    originalChars: text.length,
    head: text.slice(0, budget.headChars),
    tail: text.slice(-budget.tailChars),
  };
}

function summaryFor(value: unknown, reason: string): JsonMap {
  const encoded = stableJson(value);
  return { kind: 'summary', reason, rawSha1: digestText(encoded), estimatedBytes: Buffer.byteLength(encoded, 'utf8') };
}

function emergencyPayload(request: JsonMap, requiredArtifacts: JsonMap[], budget: Record<string, number>, decisions: JsonMap[]): JsonMap {
  const emergencyBudget = { ...budget, maxInlineStringChars: 1_000, maxInlineJsonBytes: 4_000, maxArrayItems: 8 };
  return {
    goal: compactValue(request.goal ?? {}, emergencyBudget, decisions, ['goal']),
    currentReferenceDigests: compactRefs(arrayValue(request.currentReferenceDigests ?? request.digests), emergencyBudget, decisions),
    requiredArtifacts,
    omitted: { reason: kind('handoff', 'budget'), nextActions: ['Use workspace refs for full source material.'] },
  };
}

function auditRefs(request: JsonMap, payload: JsonMap): string[] {
  const out: string[] = [];
  for (const item of [...arrayValue(request.currentReferenceDigests ?? request.digests), ...arrayValue(request.artifacts)]) {
    const record = recordValue(item);
    if (!record) continue;
    for (const key of REFERENCE_KEYS) {
      const value = stringValue(record[key]);
      if (value) out.push(value);
    }
  }
  out.push(`${kind('handoff', 'plan')}:${digestText(stableJson(payload)).slice(0, 12)}`);
  return dedupe(out);
}

function refsFromRecord(record: JsonMap): JsonMap {
  const refs: JsonMap = {};
  for (const key of REFERENCE_KEYS) {
    const value = stringValue(record[key]);
    if (value) refs[key] = value;
  }
  return refs;
}

function looksLikeReportRequest(text: string): boolean {
  const lowered = text.toLowerCase();
  return ['report', 'markdown', 'summary', '报告', '总结', '综述'].some((token) => lowered.includes(token));
}

function failedResult(codeValue: string, detail: string, nextActions: string[]): ConversationHandoffPlan {
  return {
    schemaVersion: CONVERSATION_HANDOFF_PLAN_SCHEMA_VERSION,
    status: 'failed-with-reason',
    ok: false,
    reason: { code: codeValue, message: detail },
    nextActions,
    evidenceRefs: [],
    budget: { ...DEFAULT_HANDOFF_BUDGET },
    normalizedBytes: 0,
    decisions: [],
  };
}

function omitEmpty(record: JsonMap): JsonMap {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => !isEmpty(value)));
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null
    || (Array.isArray(value) && value.length === 0)
    || (recordValue(value) !== undefined && Object.keys(value as JsonMap).length === 0);
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

function stableJson(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  const record = recordValue(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortForStableJson(record[key])]));
}

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(stableJson(value), 'utf8');
}

function digestText(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function kind(...parts: string[]): string {
  return parts.join('-');
}

function code(...parts: string[]): string {
  return parts.join('-');
}
