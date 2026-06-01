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
    codexSessionId: stringField(record.codexSessionId),
    nativeSessionId: stringField(record.nativeSessionId),
    threadId: stringField(record.threadId),
    thread_id: stringField(record.thread_id),
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
    streamProcess: streamProcess ? compactStreamProcessForRequestPayload(streamProcess) : undefined,
  };
}

function compactStreamProcessForRequestPayload(streamProcess: Record<string, unknown>) {
  return compactRecord({
    eventCount: numberField(streamProcess.eventCount),
    retainedEventCount: numberField(streamProcess.retainedEventCount),
    truncated: typeof streamProcess.truncated === 'boolean' ? streamProcess.truncated : undefined,
    summaryDigest: compactDigestRecord(streamProcess.summaryDigest) ?? digestTextField(streamProcess.summary),
    refs: refsFromRawValue(streamProcess).slice(0, 24),
    eventSummaries: compactStreamProcessEventSummaries(streamProcess).slice(-16),
  });
}

function compactStreamProcessEventSummaries(streamProcess: Record<string, unknown>) {
  const source = Array.isArray(streamProcess.eventSummaries)
    ? streamProcess.eventSummaries
    : Array.isArray(streamProcess.events)
      ? streamProcess.events
      : [];
  return source
    .map(compactRawEventSummary)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && Object.keys(entry).length));
}

function compactDigestRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return compactRecord({
    omitted: stringField(record.omitted),
    chars: numberField(record.chars),
    hash: stringField(record.hash),
    refs: Array.isArray(record.refs) ? record.refs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 12) : undefined,
  });
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
  const native = recordField(record.native);
  const hasStructuredSignal = stringField(record.type)
    || stringField(record.status)
    || stringField(native.status)
    || stringField(record.ref)
    || stringField(native.ref)
    || record.progress
    || native.progress
    || record.schemaVersion === 'sciforge.interaction-progress-event.v1';
  if (!hasStructuredSignal) return undefined;
  return compactRecord({
    type: stringField(record.type),
    label: stringField(record.label),
    status: stringField(record.status),
    createdAt: stringField(record.createdAt),
    source: stringField(record.source),
    toolName: stringField(record.toolName) ?? stringField(native.toolName),
    fileRef: stringField(record.fileRef) ?? stringField(native.fileRef),
    ref: stringField(record.ref) ?? stringField(native.ref),
    messageDigest: digestTextField(record.message),
    detailDigest: compactDigestRecord(record.detailDigest) ?? digestTextField(record.detail),
    refs: refsFromRawValue(record).slice(0, 12),
  });
}

function refsFromRawValue(value: unknown, depth = 0): string[] {
  return collectRuntimeRefsFromValue(value, { maxDepth: 5 - depth, maxRefs: 32, includeIds: true })
    .filter(safeRequestPayloadRef);
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

function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
    refs: refsFromRawValue(value).slice(0, 12),
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

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  }));
}

function safeRequestPayloadRef(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (/\s/.test(text)) return false;
  if (/https?:\/\//i.test(text) || /^(?:data|blob):/i.test(text) || /^file:\/\//i.test(text)) return false;
  if (/^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}
