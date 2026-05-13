import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';

export interface RunRawCompactionLimits {
  rawTextLimit: number;
  runTextLimit: number;
}

export function compactRunRawForRequestPayload(raw: unknown, limits: RunRawCompactionLimits) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return compactInlineValue(raw, limits.rawTextLimit).value;
  const record = raw as Record<string, unknown>;
  const streamProcess = record.streamProcess && typeof record.streamProcess === 'object' && !Array.isArray(record.streamProcess)
    ? record.streamProcess as Record<string, unknown>
    : undefined;
  const backgroundCompletion = recordField(record.backgroundCompletion);
  return {
    termination: compactRawRecord(record.termination),
    cancelBoundary: compactRawRecord(record.cancelBoundary),
    historicalEditConflict: compactRawRecord(record.historicalEditConflict),
    guidanceQueue: Array.isArray(record.guidanceQueue)
      ? record.guidanceQueue.slice(-8).map((entry) => compactRawRecord(entry)).filter(Boolean)
      : undefined,
    backgroundCompletion: Object.keys(backgroundCompletion).length
      ? {
          status: stringField(backgroundCompletion.status),
          stage: stringField(backgroundCompletion.stage),
          runId: stringField(backgroundCompletion.runId),
          termination: compactRawRecord(backgroundCompletion.termination),
          lastEventSummary: compactRawEventSummary(backgroundCompletion.lastEvent),
          refs: refsFromRawValue(backgroundCompletion).slice(0, 16),
        }
      : undefined,
    refs: refsFromRawValue(record).slice(0, 24),
    bodySummary: {
      omitted: 'run-raw-body',
      keys: Object.keys(record).slice(0, 16),
    },
    streamProcess: streamProcess
      ? {
        eventCount: streamProcess.eventCount,
          summaryDigest: compactDigestField(streamProcess.summaryDigest),
          eventTypes: Array.isArray(streamProcess.events)
            ? streamProcess.events.slice(-24).map((event) => compactRawEventSummary(event)).filter(Boolean)
            : undefined,
        }
      : undefined,
  };
}

function compactRawRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['schemaVersion', 'id', 'status', 'reason', 'mode', 'sideEffectPolicy', 'nextStep', 'branchId', 'requiresUserConfirmation', 'handlingRunId']) {
    const entry = record[key];
    if (typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number') out[key] = entry;
  }
  const refs = refsFromRawValue(record).slice(0, 12);
  if (refs.length) out.refs = refs;
  return Object.keys(out).length ? out : undefined;
}

function compactRawEventSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    type: stringField(record.type),
    status: stringField(record.status),
    source: stringField(record.source),
    messageDigest: digestTextField(record.message),
    refs: refsFromRawValue(record).slice(0, 12),
  };
}

function refsFromRawValue(value: unknown, depth = 0): string[] {
  return collectRuntimeRefsFromValue(value, { maxDepth: 5 - depth, maxRefs: 32, includeIds: true });
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactInlineValue(value: unknown, maxChars: number): { value: unknown; omitted: boolean; approxBytes?: number } {
  if (typeof value === 'string') {
    return { value: digestTextField(value), omitted: true, approxBytes: value.length };
  }
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { value, omitted: false };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return { value, omitted: false };
    return { value: `[omitted from chat payload: ${serialized.length} chars]`, omitted: true, approxBytes: serialized.length };
  } catch {
    return { value: '[omitted from chat payload: unserializable value]', omitted: true };
  }
}

function clipText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated]` : value;
}

function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
    refs: refsFromRawValue(value).slice(0, 12),
  };
}

function compactDigestField(value: unknown) {
  const record = recordField(value);
  const hash = stringField(record.hash);
  if (!hash) return undefined;
  return {
    omitted: stringField(record.omitted) ?? 'text-body',
    chars: typeof record.chars === 'number' ? record.chars : undefined,
    hash,
    refs: Array.isArray(record.refs) ? record.refs.filter((ref): ref is string => typeof ref === 'string').slice(0, 12) : undefined,
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
