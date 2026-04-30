import { createHash } from 'node:crypto';

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

export function buildWorkspaceTaskInput(input: Record<string, unknown>, refs: WorkspaceTaskInputRefs) {
  const compacted = compactObject(input, [], 0);
  return {
    ...compacted,
    ...refs,
    _bioagentInputManifest: {
      schemaVersion: 'bioagent.task-input.v1',
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
    out._bioagentCompacted = {
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
      out.dataSummary = compactSummary(artifact.data, 'artifact-data');
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
  for (const key of ['recentExecutionRefs', 'artifactRefs', 'runRefs']) {
    if (value[key] !== undefined) out[key] = compactValue(value[key], [...path, key], depth + 1);
  }
  return Object.keys(out).length ? out : compactLargeObject({}, value);
}

function compactArray(value: unknown[], path: string[], depth: number) {
  if (estimateBytes(value) <= MAX_INLINE_VALUE_BYTES && value.length <= MAX_ARRAY_ITEMS) {
    return value.map((item, index) => compactValue(item, [...path, String(index)], depth + 1));
  }
  return {
    _bioagentCompacted: true,
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
    _bioagentCompacted: true,
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
    _bioagentCompacted: true,
    kind: 'string',
    chars: value.length,
    sha1: sha1Text(value),
    preview: `${value.slice(0, 2000)}\n\n[BioAgent compacted ${value.length - 2000} chars from this field]`,
  };
}

function compactPrompt(value: string) {
  if (value.length <= MAX_PROMPT_CHARS) return value;
  return `${value.slice(0, MAX_PROMPT_CHARS)}\n\n[BioAgent compacted prompt tail: ${value.length - MAX_PROMPT_CHARS} chars omitted; use recentConversation/artifact refs for full recovery]`;
}

function compactSummary(value: unknown, reason: string) {
  return {
    _bioagentCompacted: true,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
