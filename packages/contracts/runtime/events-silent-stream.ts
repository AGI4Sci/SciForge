import { normalizeRunTermination } from './events';
import type { RunTerminationRecord } from './events';

export type SilentStreamDecisionLayer = 'backend-stream' | 'transport-watchdog' | 'ui-progress';

export const SILENT_STREAM_DECISION_SCHEMA_VERSION = 'sciforge.silent-stream-decision.v1' as const;

export interface SilentStreamDecisionRecord {
  schemaVersion: typeof SILENT_STREAM_DECISION_SCHEMA_VERSION;
  decisionId: string;
  runId: string;
  source: string;
  layers: SilentStreamDecisionLayer[];
  decision: string;
  timeoutMs?: number;
  elapsedMs?: number;
  status?: string;
  retryCount?: number;
  maxRetries?: number;
  termination: RunTerminationRecord;
  detail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SilentStreamRunIdInput {
  runId?: string;
  sessionId?: string;
  prompt?: string;
}

export interface SilentStreamDecisionRecordInput extends SilentStreamRunIdInput {
  source: string;
  layer: SilentStreamDecisionLayer;
  decision?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  status?: string;
  retryCount?: number;
  maxRetries?: number;
  detail?: string;
  createdAt?: string;
  existing?: unknown;
}

export function buildSilentStreamRunId(input: SilentStreamRunIdInput = {}) {
  const explicit = cleanIdentifier(input.runId);
  if (explicit) return explicit;
  const session = cleanIdentifier(input.sessionId) || 'sessionless';
  const promptHash = stableTextHash(input.prompt ?? '');
  return `${session}:turn-${promptHash}`;
}

export function buildSilentStreamDecisionId(input: SilentStreamRunIdInput = {}) {
  return `${buildSilentStreamRunId(input)}:silent-stream`;
}

export function buildSilentStreamDecisionRecord(input: SilentStreamDecisionRecordInput): SilentStreamDecisionRecord {
  const existing = silentStreamDecisionRecordFromUnknown(input.existing);
  const runId = buildSilentStreamRunId({
    runId: input.runId ?? existing?.runId,
    sessionId: input.sessionId,
    prompt: input.prompt,
  });
  const detail = input.detail?.trim() || existing?.detail || 'Silent stream timeout decision.';
  const decision = input.decision ?? existing?.decision ?? 'visible-status';
  return {
    schemaVersion: SILENT_STREAM_DECISION_SCHEMA_VERSION,
    decisionId: existing?.decisionId ?? buildSilentStreamDecisionId({ runId }),
    runId,
    source: existing?.source ?? input.source,
    layers: uniqueSilentDecisionLayers([...(existing?.layers ?? []), input.layer]),
    decision,
    timeoutMs: finiteNumber(input.timeoutMs) ?? existing?.timeoutMs,
    elapsedMs: finiteNumber(input.elapsedMs) ?? existing?.elapsedMs,
    status: input.status ?? existing?.status,
    retryCount: nonNegativeInteger(input.retryCount) ?? existing?.retryCount,
    maxRetries: nonNegativeInteger(input.maxRetries) ?? existing?.maxRetries,
    termination: existing?.termination ?? normalizeRunTermination({
      cancellationReason: 'timeout',
      detail,
      timedOut: true,
    }),
    detail,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.createdAt ?? existing?.updatedAt,
  };
}

export function silentStreamDecisionRecordFromUnknown(value: unknown): SilentStreamDecisionRecord | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record || record.schemaVersion !== SILENT_STREAM_DECISION_SCHEMA_VERSION) return undefined;
  const decisionId = asString(record.decisionId);
  const runId = asString(record.runId);
  const source = asString(record.source);
  if (!decisionId || !runId || !source) return undefined;
  const layers = Array.isArray(record.layers)
    ? uniqueSilentDecisionLayers(record.layers.filter(isSilentDecisionLayer))
    : [];
  const termination = isRunTerminationRecord(record.termination)
    ? record.termination
    : normalizeRunTermination({ cancellationReason: 'timeout', detail: asString(record.detail), timedOut: true });
  return {
    schemaVersion: SILENT_STREAM_DECISION_SCHEMA_VERSION,
    decisionId,
    runId,
    source,
    layers,
    decision: asString(record.decision) ?? 'visible-status',
    timeoutMs: finiteNumber(record.timeoutMs),
    elapsedMs: finiteNumber(record.elapsedMs),
    status: asString(record.status),
    retryCount: nonNegativeInteger(record.retryCount),
    maxRetries: nonNegativeInteger(record.maxRetries),
    termination,
    detail: asString(record.detail),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function cleanIdentifier(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || undefined;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function isSilentDecisionLayer(value: unknown): value is SilentStreamDecisionLayer {
  return value === 'backend-stream' || value === 'transport-watchdog' || value === 'ui-progress';
}

function uniqueSilentDecisionLayers(values: SilentStreamDecisionLayer[]) {
  return Array.from(new Set(values));
}

function isRunTerminationRecord(value: unknown): value is RunTerminationRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'sciforge.run-termination.v1'
    && normalizedRunTerminationReason(asString(value.reason)) !== undefined
    && (value.actor === 'user' || value.actor === 'system' || value.actor === 'backend');
}

function normalizedRunTerminationReason(value: string | undefined) {
  if (value === 'user-cancelled' || value === 'system-aborted' || value === 'timeout' || value === 'backend-error') return value;
  if (!value) return undefined;
  if (/user|manual|requested cancel|已中断|用户|人工/i.test(value)) return 'user-cancelled';
  if (/\b(timeout|timed out|deadline|time limit|超时)\b/i.test(value)) return 'timeout';
  if (/\b(backend|agentserver|workspace runtime|http\s*5\d\d|schema|contract|error|failed|failure|后端|失败)\b/i.test(value)) return 'backend-error';
  if (/abort|aborted|cancelled|canceled|disconnect|network|system|系统|网络|中断/i.test(value)) return 'system-aborted';
  return undefined;
}
