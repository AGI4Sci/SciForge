import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildBackendInputTextAnchors,
  handoffArtifactDataSummaryReason,
  handoffStringCompactionSchema,
  inferHandoffJsonSchema,
  isBinaryLikeHandoffString,
} from '@sciforge-ui/runtime-contract/handoff-input-policy';

export interface WorkspaceTaskInputRefs {
  workspacePath: string;
  taskCodeRef: string;
  inputRef: string;
  outputRef: string;
  stdoutRef: string;
  stderrRef: string;
}

const MAX_PROMPT_CHARS = 24000;
const MAX_INLINE_STRING_CHARS = 8192;
const MAX_INLINE_VALUE_BYTES = 64 * 1024;
const MAX_ARRAY_ITEMS = 24;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 7;

export interface BackendHandoffBudget {
  schemaVersion: 'sciforge.backend-handoff-budget.v1';
  maxPayloadBytes: number;
  maxInlineStringChars: number;
  maxInlineJsonBytes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
  headChars: number;
  tailChars: number;
  maxPriorAttempts: number;
}

export interface BackendHandoffNormalizationResult<T = unknown> {
  payload: T;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  budget: BackendHandoffBudget;
  decisions: BackendHandoffBudgetDecision[];
  auditRefs: string[];
  contextEstimate: BackendHandoffContextEstimate;
}

export interface BackendHandoffBudgetDecision {
  kind: string;
  reason?: string;
  pointer?: string;
  rawRef: string;
  estimatedBytes?: number;
  originalCount?: number;
  keptCount?: number;
  omittedCount?: number;
}

export interface BackendHandoffContextEstimate {
  source: 'estimate';
  rawTokens: number;
  normalizedTokens: number;
  savedTokens: number;
  rawBytes: number;
  normalizedBytes: number;
  budgetMaxPayloadBytes: number;
  normalizedBudgetRatio: number;
}

export const DEFAULT_BACKEND_HANDOFF_BUDGET: BackendHandoffBudget = {
  schemaVersion: 'sciforge.backend-handoff-budget.v1',
  maxPayloadBytes: 220_000,
  maxInlineStringChars: 12_000,
  maxInlineJsonBytes: 48_000,
  maxArrayItems: 24,
  maxObjectKeys: 80,
  maxDepth: 7,
  headChars: 2000,
  tailChars: 2000,
  maxPriorAttempts: 4,
};

export function buildWorkspaceTaskInput(input: Record<string, unknown>, refs: WorkspaceTaskInputRefs) {
  const compacted = compactObject(input, [], 0);
  return {
    ...compacted,
    ...refs,
    _sciforgeInputManifest: {
      schemaVersion: 'sciforge.task-input.v1',
      compactedAt: new Date().toISOString(),
      policy: {
        artifactData: 'large inline artifact data is replaced by refs, hashes, sizes, and previews',
        maxPromptChars: MAX_PROMPT_CHARS,
        maxInlineStringChars: MAX_INLINE_STRING_CHARS,
        maxInlineValueBytes: MAX_INLINE_VALUE_BYTES,
      },
    },
  };
}

export async function normalizeBackendHandoff<T = unknown>(
  input: T,
  options: {
    workspacePath: string;
    purpose: string;
    budget?: Partial<BackendHandoffBudget>;
  },
): Promise<BackendHandoffNormalizationResult<T>> {
  const budget = { ...DEFAULT_BACKEND_HANDOFF_BUDGET, ...options.budget };
  const decisions: BackendHandoffBudgetDecision[] = [];
  const rawJson = stringifyJson(input);
  const rawSha1 = sha1Text(rawJson);
  const rawRef = join(
    '.sciforge',
    'handoffs',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeToken(options.purpose)}-${rawSha1.slice(0, 10)}.json`,
  );
  await writeWorkspaceRef(options.workspacePath, rawRef, JSON.stringify({
    schemaVersion: 'sciforge.backend-handoff-raw.v1',
    createdAt: new Date().toISOString(),
    purpose: options.purpose,
    rawSha1,
    rawBytes: Buffer.byteLength(rawJson, 'utf8'),
    payload: input,
  }, null, 2));

  let payload = normalizeHandoffValue(input, {
    budget,
    rawRef,
    path: [],
    depth: 0,
    siblingRefs: {},
    decisions,
  }) as T;
  payload = attachHandoffManifest(payload, {
    budget,
    rawRef,
    rawSha1,
    rawBytes: Buffer.byteLength(rawJson, 'utf8'),
  }) as T;

  let normalizedBytes = estimateBytes(payload);
  if (normalizedBytes > budget.maxPayloadBytes) {
    payload = attachHandoffManifest(normalizeHandoffValue(input, {
      budget: {
        ...budget,
        maxInlineStringChars: Math.min(1200, budget.maxInlineStringChars),
        maxInlineJsonBytes: Math.min(12_000, budget.maxInlineJsonBytes),
        maxArrayItems: Math.min(8, budget.maxArrayItems),
        maxObjectKeys: Math.min(32, budget.maxObjectKeys),
        maxDepth: Math.min(5, budget.maxDepth),
        headChars: Math.min(600, budget.headChars),
        tailChars: Math.min(600, budget.tailChars),
        maxPriorAttempts: Math.min(2, budget.maxPriorAttempts),
      },
      rawRef,
      path: [],
      depth: 0,
      siblingRefs: {},
      decisions,
    }), {
      budget,
      rawRef,
      rawSha1,
      rawBytes: Buffer.byteLength(rawJson, 'utf8'),
      forced: true,
    }) as T;
    normalizedBytes = estimateBytes(payload);
  }
  if (normalizedBytes > budget.maxPayloadBytes) {
    decisions.push({
      kind: 'backend-handoff',
      reason: 'payload-budget',
      rawRef,
      estimatedBytes: Buffer.byteLength(rawJson, 'utf8'),
    });
    payload = attachHandoffManifest({
      _sciforgeCompacted: true,
      kind: 'backend-handoff',
      reason: 'payload-budget',
      rawRef,
      rawSha1,
      rawBytes: Buffer.byteLength(rawJson, 'utf8'),
      schema: inferHandoffJsonSchema(input),
      head: rawJson.slice(0, Math.min(1000, budget.headChars)),
      tail: rawJson.slice(-Math.min(1000, budget.tailChars)),
    }, {
      budget,
      rawRef,
      rawSha1,
      rawBytes: Buffer.byteLength(rawJson, 'utf8'),
      forced: true,
    }) as T;
    normalizedBytes = estimateBytes(payload);
  }

  return {
    payload,
    rawRef,
    rawSha1,
    rawBytes: Buffer.byteLength(rawJson, 'utf8'),
    normalizedBytes,
    budget,
    decisions,
    auditRefs: [
      `backend-handoff:${safeToken(options.purpose)}:${rawSha1.slice(0, 12)}`,
      rawRef,
    ],
    contextEstimate: estimateHandoffContext({
      rawBytes: Buffer.byteLength(rawJson, 'utf8'),
      normalizedBytes,
      maxPayloadBytes: budget.maxPayloadBytes,
    }),
  };
}

function normalizeHandoffValue(value: unknown, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return normalizeHandoffString(value, context);
  if (typeof value !== 'object') return value;
  if (context.depth >= context.budget.maxDepth) return handoffSummary(value, context, 'max-depth');
  if (Array.isArray(value)) return normalizeHandoffArray(value, context);
  if (!isRecord(value)) return handoffSummary(value, context, 'unknown-object');
  return normalizeHandoffObject(value, context);
}

function normalizeHandoffObject(value: Record<string, unknown>, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  const lowerPath = context.path.map((part) => part.toLowerCase());
  if (looksLikeArtifact(value) || lowerPath.includes('artifacts')) return normalizeHandoffArtifact(value, context);
  if (
    context.path.length > 0
    && !shouldPreserveHandoffContainer(context.path)
    && estimateBytes(value) > context.budget.maxInlineJsonBytes
    && !hasReferenceField(value)
  ) {
    return handoffSummary(value, context, 'large-json');
  }

  const refs = referenceFields(value);
  const entries = Object.entries(value).slice(0, context.budget.maxObjectKeys);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    if (context.path.at(-1) === 'input' && key === 'text' && typeof nested === 'string') {
      const textContext = { ...context, path: [...context.path, key], depth: context.depth + 1, siblingRefs: refs };
      out[key] = compactBackendInputText(nested, textContext);
      if (nested.length > context.budget.maxInlineStringChars) {
        out.textSummary = normalizeHandoffString(nested, textContext);
      }
      continue;
    }
    if (key === 'priorAttempts' && Array.isArray(nested)) {
      out[key] = normalizePriorAttempts(nested, { ...context, path: [...context.path, key], depth: context.depth + 1, siblingRefs: refs });
      continue;
    }
    out[key] = normalizeHandoffValue(nested, {
      ...context,
      path: [...context.path, key],
      depth: context.depth + 1,
      siblingRefs: refs,
    });
  }
  if (Object.keys(value).length > entries.length) {
    out._sciforgeCompacted = {
      kind: 'object-fields',
      originalFieldCount: Object.keys(value).length,
      keptFieldCount: entries.length,
      rawRef: context.rawRef,
      pointer: jsonPointer(context.path),
    };
    context.decisions.push({
      kind: 'object-fields',
      rawRef: context.rawRef,
      pointer: jsonPointer(context.path),
      originalCount: Object.keys(value).length,
      keptCount: entries.length,
    });
  }
  if (estimateBytes(out) > context.budget.maxInlineJsonBytes && context.path.length > 0 && !shouldPreserveHandoffContainer(context.path)) {
    return {
      ...pickReferenceFields(value),
      ...handoffSummary(value, context, 'large-json'),
    };
  }
  return out;
}

function normalizeHandoffArtifact(value: Record<string, unknown>, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  const out: Record<string, unknown> = {};
  for (const key of ['id', 'type', 'title', 'name', 'schemaVersion', 'dataRef', 'path', 'ref', 'outputRef', 'artifactRef', 'mimeType', 'contentType']) {
    if (value[key] !== undefined) out[key] = normalizeHandoffValue(value[key], { ...context, path: [...context.path, key], depth: context.depth + 1 });
  }
  if (isRecord(value.metadata)) {
    out.metadata = normalizeHandoffObject(value.metadata, { ...context, path: [...context.path, 'metadata'], depth: context.depth + 1 });
  }
  if (value.data !== undefined) {
    const dataContext = { ...context, path: [...context.path, 'data'], depth: context.depth + 1 };
    out.dataSummary = {
      ...handoffSummary(value.data, dataContext, handoffArtifactDataSummaryReason(value)),
      schema: inferHandoffJsonSchema(value.data),
    };
    out.dataOmitted = true;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key in out || key === 'metadata' || key === 'data') continue;
    out[key] = normalizeHandoffValue(nested, { ...context, path: [...context.path, key], depth: context.depth + 1 });
  }
  return out;
}

function normalizeHandoffArray(value: unknown[], context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  const normalizedItems = value.slice(0, context.budget.maxArrayItems).map((item, index) => normalizeHandoffValue(item, {
    ...context,
    path: [...context.path, String(index)],
    depth: context.depth + 1,
    siblingRefs: {},
  }));
  if (value.length <= context.budget.maxArrayItems && estimateBytes(normalizedItems) <= context.budget.maxInlineJsonBytes) {
    return normalizedItems;
  }
  return {
    _sciforgeCompacted: true,
    kind: 'array',
    itemCount: value.length,
    estimatedBytes: estimateBytes(value),
    sha1: sha1Json(value),
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    schema: inferHandoffJsonSchema(value),
    head: normalizedItems,
    tail: value.length > context.budget.maxArrayItems
      ? value.slice(-Math.min(3, context.budget.maxArrayItems)).map((item, index) => normalizeHandoffValue(item, {
          ...context,
          path: [...context.path, String(value.length - Math.min(3, context.budget.maxArrayItems) + index)],
          depth: context.depth + 1,
          siblingRefs: {},
        }))
      : undefined,
  };
}

function normalizeHandoffString(value: string, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  const key = context.path.at(-1)?.toLowerCase() || '';
  const logRef = key === 'stdout'
    ? context.siblingRefs.stdoutRef
    : key === 'stderr'
      ? context.siblingRefs.stderrRef
      : undefined;
  const binaryLike = isBinaryLikeHandoffString(value, key);
  const mustCompact = value.length > context.budget.maxInlineStringChars || binaryLike || key === 'stdout' || key === 'stderr';
  if (!mustCompact) return value;
  context.decisions.push({
    kind: binaryLike ? 'binary' : key === 'stdout' || key === 'stderr' ? 'tool-output' : 'string',
    rawRef: logRef ?? context.rawRef,
    pointer: logRef ? undefined : jsonPointer(context.path),
    estimatedBytes: Buffer.byteLength(value, 'utf8'),
  });
  return {
    _sciforgeCompacted: true,
    kind: binaryLike ? 'binary' : key === 'stdout' || key === 'stderr' ? 'tool-output' : 'string',
    chars: value.length,
    bytes: Buffer.byteLength(value, 'utf8'),
    sha1: sha1Text(value),
    rawRef: logRef ?? context.rawRef,
    pointer: logRef ? undefined : jsonPointer(context.path),
    schema: handoffStringCompactionSchema(binaryLike),
    head: value.slice(0, context.budget.headChars),
    tail: value.length > context.budget.headChars ? value.slice(-context.budget.tailChars) : undefined,
  };
}

function compactBackendInputText(value: string, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  if (value.length <= context.budget.maxInlineStringChars) return value;
  context.decisions.push({
    kind: 'backend-input-text',
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    estimatedBytes: Buffer.byteLength(value, 'utf8'),
  });
  return [
    '[SciForge compacted backend input.text to stay within handoff budget.]',
    `rawRef: ${context.rawRef}`,
    `pointer: ${jsonPointer(context.path)}`,
    `sha1: ${sha1Text(value)}`,
    `chars: ${value.length}`,
    '',
    ...buildBackendInputTextAnchors(value, { maxInlineStringChars: context.budget.maxInlineStringChars }),
    '',
    'HEAD:',
    value.slice(0, context.budget.headChars),
    '',
    'TAIL:',
    value.slice(-context.budget.tailChars),
  ].join('\n');
}

function normalizePriorAttempts(value: unknown[], context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}) {
  const kept = value.slice(-context.budget.maxPriorAttempts).map((attempt, index) => {
    if (!isRecord(attempt)) return normalizeHandoffValue(attempt, { ...context, path: [...context.path, String(index)], depth: context.depth + 1 });
    const out: Record<string, unknown> = {};
    for (const key of ['id', 'attempt', 'status', 'skillDomain', 'skillId', 'codeRef', 'inputRef', 'outputRef', 'stdoutRef', 'stderrRef', 'diffRef', 'exitCode', 'createdAt']) {
      if (attempt[key] !== undefined) out[key] = normalizeHandoffValue(attempt[key], { ...context, path: [...context.path, String(index), key], depth: context.depth + 1 });
    }
    for (const key of ['failureReason', 'patchSummary']) {
      if (typeof attempt[key] === 'string') out[key] = normalizeHandoffString(attempt[key] as string, {
        ...context,
        path: [...context.path, String(index), key],
        depth: context.depth + 1,
        siblingRefs: referenceFields(attempt),
      });
    }
    if (Array.isArray(attempt.schemaErrors)) {
      out.schemaErrors = normalizeHandoffArray(attempt.schemaErrors, {
        ...context,
        path: [...context.path, String(index), 'schemaErrors'],
        depth: context.depth + 1,
        siblingRefs: {},
      });
    }
    out.hash = sha1Json(attempt);
    return out;
  });
  context.decisions.push({
    kind: 'prior-attempts',
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    originalCount: value.length,
    keptCount: kept.length,
    omittedCount: Math.max(0, value.length - kept.length),
  });
  return {
    _sciforgeCompacted: value.length > kept.length,
    kind: 'prior-attempts',
    itemCount: value.length,
    omittedCount: Math.max(0, value.length - kept.length),
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    attempts: kept,
  };
}

function handoffSummary(value: unknown, context: {
  budget: BackendHandoffBudget;
  rawRef: string;
  path: string[];
  depth: number;
  siblingRefs: Record<string, string | undefined>;
  decisions: BackendHandoffBudgetDecision[];
}, reason: string) {
  const json = stringifyJson(value);
  context.decisions.push({
    kind: Array.isArray(value) ? 'array' : typeof value,
    reason,
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    estimatedBytes: Buffer.byteLength(json, 'utf8'),
  });
  return {
    _sciforgeCompacted: true,
    kind: Array.isArray(value) ? 'array' : typeof value,
    reason,
    estimatedBytes: Buffer.byteLength(json, 'utf8'),
    sha1: sha1Text(json),
    rawRef: context.rawRef,
    pointer: jsonPointer(context.path),
    schema: inferHandoffJsonSchema(value),
    head: json.slice(0, context.budget.headChars),
    tail: json.length > context.budget.headChars ? json.slice(-context.budget.tailChars) : undefined,
  };
}

function estimateHandoffContext(params: {
  rawBytes: number;
  normalizedBytes: number;
  maxPayloadBytes: number;
}): BackendHandoffContextEstimate {
  const rawTokens = Math.ceil(params.rawBytes / 4);
  const normalizedTokens = Math.ceil(params.normalizedBytes / 4);
  return {
    source: 'estimate',
    rawTokens,
    normalizedTokens,
    savedTokens: Math.max(0, rawTokens - normalizedTokens),
    rawBytes: params.rawBytes,
    normalizedBytes: params.normalizedBytes,
    budgetMaxPayloadBytes: params.maxPayloadBytes,
    normalizedBudgetRatio: params.maxPayloadBytes ? params.normalizedBytes / params.maxPayloadBytes : 0,
  };
}

function attachHandoffManifest(value: unknown, manifest: {
  budget: BackendHandoffBudget;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  forced?: boolean;
}) {
  const handoffManifest = {
    schemaVersion: 'sciforge.backend-handoff-normalized.v1',
    rawRef: manifest.rawRef,
    rawSha1: manifest.rawSha1,
    rawBytes: manifest.rawBytes,
    budget: manifest.budget,
    forcedSecondPass: manifest.forced === true,
  };
  if (isRecord(value)) return { ...value, _sciforgeHandoffManifest: handoffManifest };
  return { value, _sciforgeHandoffManifest: handoffManifest };
}

function compactValue(value: unknown, path: string[], depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return compactString(value, path);
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return compactSummary(value, 'max-depth');
  if (Array.isArray(value)) return compactArray(value, path, depth);
  if (!isRecord(value)) return compactSummary(value, 'unknown-object');
  if (path.at(-1) === 'metadata') return compactObject(value, path, depth);
  return compactObject(value, path, depth);
}

function compactObject(value: Record<string, unknown>, path: string[], depth: number): Record<string, unknown> {
  if (path.length === 1 && path[0] === 'uiStateSummary') return compactUiStateSummary(value, path, depth);
  if (looksLikeArtifact(value)) return compactArtifact(value, path, depth);

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    if (path.length === 0 && key === 'prompt' && typeof nested === 'string') {
      out[key] = compactPrompt(nested);
    } else if (path.length === 0 && key === 'artifacts' && Array.isArray(nested)) {
      out[key] = nested.filter(isRecord).map((artifact, index) => compactArtifact(artifact, [key, String(index)], depth + 1));
    } else if (path.length === 0 && key === 'priorAttempts' && Array.isArray(nested)) {
      out[key] = nested.slice(-8).map((attempt, index) => compactAttempt(attempt, [key, String(index)], depth + 1));
    } else {
      out[key] = compactValue(nested, [...path, key], depth + 1);
    }
  }
  if (Object.keys(value).length > entries.length) {
    out._sciforgeCompacted = {
      kind: 'object-fields',
      originalFieldCount: Object.keys(value).length,
      keptFieldCount: entries.length,
    };
  }
  if (path.length > 0 && estimateBytes(out) > MAX_INLINE_VALUE_BYTES) return compactLargeObject(out, value);
  return out;
}

function compactArtifact(artifact: Record<string, unknown>, path: string[], depth: number) {
  const out: Record<string, unknown> = {};
  const passthroughKeys = [
    'id',
    'type',
    'producerScenario',
    'scenarioPackageRef',
    'schemaVersion',
    'dataRef',
    'path',
    'visibility',
    'audience',
    'sensitiveDataFlags',
    'exportPolicy',
  ];
  for (const key of passthroughKeys) {
    if (artifact[key] !== undefined) out[key] = compactValue(artifact[key], [...path, key], depth + 1);
  }
  if (isRecord(artifact.metadata)) out.metadata = compactObject(artifact.metadata, [...path, 'metadata'], depth + 1);
  if (artifact.data !== undefined) {
    const dataBytes = estimateBytes(artifact.data);
    if (dataBytes > MAX_INLINE_VALUE_BYTES || artifact.dataRef || artifact.path) {
      out.dataSummary = compactSummary(artifact.data, handoffArtifactDataSummaryReason(artifact));
      out.dataOmitted = true;
    } else {
      out.data = compactValue(artifact.data, [...path, 'data'], depth + 1);
    }
  }
  for (const [key, value] of Object.entries(artifact)) {
    if (key in out || passthroughKeys.includes(key) || key === 'metadata' || key === 'data') continue;
    out[key] = compactValue(value, [...path, key], depth + 1);
  }
  return out;
}

function compactAttempt(value: unknown, path: string[], depth: number) {
  if (!isRecord(value)) return compactValue(value, path, depth);
  const out: Record<string, unknown> = {};
  for (const key of [
    'id',
    'attempt',
    'parentAttempt',
    'status',
    'skillDomain',
    'skillId',
    'codeRef',
    'inputRef',
    'outputRef',
    'stdoutRef',
    'stderrRef',
    'diffRef',
    'exitCode',
    'createdAt',
  ]) {
    if (value[key] !== undefined) out[key] = compactValue(value[key], [...path, key], depth + 1);
  }
  if (typeof value.failureReason === 'string') out.failureReason = compactString(value.failureReason, [...path, 'failureReason']);
  if (typeof value.patchSummary === 'string') out.patchSummary = compactString(value.patchSummary, [...path, 'patchSummary']);
  if (Array.isArray(value.schemaErrors)) out.schemaErrors = value.schemaErrors.slice(0, 12).map((item) => compactValue(item, [...path, 'schemaErrors'], depth + 1));
  return out;
}

function compactUiStateSummary(value: Record<string, unknown>, path: string[], depth: number) {
  const out: Record<string, unknown> = {};
  for (const key of ['sessionId', 'activeScenarioId', 'activeRunId', 'scenarioPackageRef', 'skillPlanRef', 'uiPlanRef']) {
    if (value[key] !== undefined) out[key] = compactValue(value[key], [...path, key], depth + 1);
  }
  for (const key of ['recentExecutionRefs', 'artifactRefs', 'runRefs', 'currentReferences']) {
    if (value[key] !== undefined) out[key] = compactValue(value[key], [...path, key], depth + 1);
  }
  return Object.keys(out).length ? out : compactLargeObject({}, value);
}

function compactArray(value: unknown[], path: string[], depth: number) {
  if (estimateBytes(value) <= MAX_INLINE_VALUE_BYTES && value.length <= MAX_ARRAY_ITEMS) {
    return value.map((item, index) => compactValue(item, [...path, String(index)], depth + 1));
  }
  return {
    _sciforgeCompacted: true,
    kind: 'array',
    itemCount: value.length,
    estimatedBytes: estimateBytes(value),
    sha1: sha1Json(value),
    preview: value.slice(0, Math.min(value.length, MAX_ARRAY_ITEMS)).map((item, index) => compactValue(item, [...path, String(index)], depth + 1)),
  };
}

function compactLargeObject(out: Record<string, unknown>, original: unknown) {
  return {
    ...pickReferenceFields(isRecord(original) ? original : {}),
    _sciforgeCompacted: true,
    kind: 'object',
    estimatedBytes: estimateBytes(original),
    sha1: sha1Json(original),
    preview: compactPreview(original),
    fields: Object.keys(out).slice(0, 24),
  };
}

function compactString(value: string, path: string[]) {
  if (path.length === 1 && path[0] === 'prompt') return compactPrompt(value);
  if (value.length <= MAX_INLINE_STRING_CHARS) return value;
  return {
    _sciforgeCompacted: true,
    kind: 'string',
    chars: value.length,
    sha1: sha1Text(value),
    preview: `${value.slice(0, 2000)}\n\n[SciForge compacted ${value.length - 2000} chars from this field]`,
  };
}

function compactPrompt(value: string) {
  if (value.length <= MAX_PROMPT_CHARS) return value;
  return `${value.slice(0, MAX_PROMPT_CHARS)}\n\n[SciForge compacted prompt tail: ${value.length - MAX_PROMPT_CHARS} chars omitted; use recentConversation/artifact refs for full recovery]`;
}

function compactSummary(value: unknown, reason: string) {
  return {
    _sciforgeCompacted: true,
    kind: Array.isArray(value) ? 'array' : typeof value,
    reason,
    estimatedBytes: estimateBytes(value),
    sha1: sha1Json(value),
    preview: compactPreview(value),
  };
}

function compactPreview(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => compactPreview(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, nested]) => [key, primitivePreview(nested)]));
  return value;
}

function primitivePreview(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  return `[object:${Object.keys(value).length}]`;
}

function pickReferenceFields(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ['id', 'type', 'dataRef', 'path', 'outputRef', 'stdoutRef', 'stderrRef', 'codeRef', 'inputRef', 'artifactRef', 'runId', 'sessionId']) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function looksLikeArtifact(value: Record<string, unknown>) {
  return typeof value.id === 'string'
    && typeof value.type === 'string'
    && ('data' in value || 'dataRef' in value || 'path' in value || 'metadata' in value);
}

function estimateBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function sha1Json(value: unknown) {
  try {
    return sha1Text(JSON.stringify(value));
  } catch {
    return sha1Text(String(value));
  }
}

function sha1Text(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: String(value) });
  }
}

async function writeWorkspaceRef(workspace: string, rel: string, content: string) {
  const path = join(workspace, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function referenceFields(value: Record<string, unknown>) {
  return {
    codeRef: stringField(value.codeRef),
    inputRef: stringField(value.inputRef),
    outputRef: stringField(value.outputRef),
    stdoutRef: stringField(value.stdoutRef),
    stderrRef: stringField(value.stderrRef),
    dataRef: stringField(value.dataRef),
    path: stringField(value.path),
    artifactRef: stringField(value.artifactRef),
  };
}

function hasReferenceField(value: Record<string, unknown>) {
  return Object.values(referenceFields(value)).some(Boolean);
}

function shouldPreserveHandoffContainer(path: string[]) {
  const preserve = new Set([
    'agent',
    'input',
    'metadata',
    'runtime',
    'contextPolicy',
    'contextEnvelope',
    'repairContext',
  ]);
  return path.some((part) => preserve.has(part));
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function jsonPointer(path: string[]) {
  return `/${path.map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function safeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'handoff';
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
