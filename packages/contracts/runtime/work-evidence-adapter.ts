import type { WorkEvidence } from './work-evidence';

const TOOL_OPERATION_KINDS = ['search', 'fetch', 'read', 'command', 'validate'] as const;
type ToolOperationKind = typeof TOOL_OPERATION_KINDS[number];

export interface BackendToolWorkEvidenceAdapterOptions {
  defaultProvider?: string;
  rawRef?: string;
  maxSummaryChars?: number;
}

export function adaptBackendToolEventToWorkEvidence(
  raw: unknown,
  options: BackendToolWorkEvidenceAdapterOptions = {},
): WorkEvidence[] {
  const record = isRecord(raw) ? raw : {};
  const existing = collectExistingWorkEvidence(record);
  if (existing.length) return existing;

  const candidates = collectToolCandidateRecords(record);
  const evidence = candidates
    .map((candidate) => evidenceFromToolCandidate(candidate, options))
    .filter((entry): entry is WorkEvidence => Boolean(entry));
  return dedupeEvidence(evidence);
}

function evidenceFromToolCandidate(record: Record<string, unknown>, options: BackendToolWorkEvidenceAdapterOptions): WorkEvidence | undefined {
  const operation = inferToolOperation(record);
  if (!operation) return undefined;

  const status = inferStatus(record);
  const resultCount = inferResultCount(record);
  const provider = stringField(record.provider)
    ?? stringField(record.modelProvider)
    ?? stringField(record.model_provider)
    ?? stringField(record.backend)
    ?? stringField(record.source)
    ?? (isRecord(record.providerStatus) ? stringField(record.providerStatus.provider) : undefined)
    ?? (isRecord(record.provider_status) ? stringField(record.provider_status.provider) : undefined)
    ?? (isRecord(record.rateLimit) ? stringField(record.rateLimit.provider) : undefined)
    ?? (isRecord(record.rate_limit) ? stringField(record.rate_limit.provider) : undefined)
    ?? options.defaultProvider;
  const failureReason = inferFailureReason(record);
  const rawRef = firstString(
    record.rawRef,
    record.raw_ref,
    record.traceRef,
    record.trace_ref,
    record.eventRef,
    record.event_ref,
    record.outputRef,
    record.output_ref,
    record.dataRef,
    record.data_ref,
    options.rawRef,
  );
  const diagnostics = lowNoiseDiagnostics(record);
  const outputSummary = clipText(
    firstString(
      record.outputSummary,
      record.output_summary,
      record.summary,
      record.message,
      record.detail,
      isRecord(record.result) ? record.result.summary : undefined,
      isRecord(record.result) ? record.result.outputSummary : undefined,
      isRecord(record.result) ? record.result.output_summary : undefined,
      isRecord(record.output) ? record.output.summary : undefined,
      isRecord(record.output) ? record.output.outputSummary : undefined,
      isRecord(record.output) ? record.output.output_summary : undefined,
    ),
    options.maxSummaryChars ?? 360,
  );

  return {
    kind: workEvidenceKindForOperation(operation),
    status: status === 'empty' || status !== 'success' || resultCount !== 0 ? status : 'empty',
    provider,
    input: compactToolInput(record, operation),
    resultCount,
    outputSummary,
    evidenceRefs: evidenceRefs(record, rawRef),
    failureReason,
    recoverActions: uniqueStrings([
      ...toStringList(record.recoverActions),
      ...toStringList(record.recover_actions),
      ...toStringList(record.recoveryActions),
      ...toStringList(record.recovery_actions),
      ...toStringList(record.repairHints),
      ...toStringList(record.repair_hints),
      ...toStringList(record.fallbacks),
      ...toStringList(record.nextActions),
      ...toStringList(record.next_actions),
    ]),
    nextStep: firstString(record.nextStep, record.next_step),
    diagnostics,
    rawRef,
  };
}

function collectToolCandidateRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  return recordsInValue(record).filter(looksLikeToolCandidate);
}

function looksLikeToolCandidate(record: Record<string, unknown>) {
  if (!inferToolOperation(record)) return false;
  const hasToolEnvelope = [
    record.toolName,
    record.tool_name,
    record.tool,
    record.action,
    record.operation,
    record.operationName,
    record.operation_name,
    record.type,
    record.eventType,
    record.event_type,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  const hasStructuredFact = [
    record.query,
    record.searchQuery,
    record.search_query,
    nestedInputField(record, 'query'),
    nestedInputField(record, 'searchQuery'),
    nestedInputField(record, 'search_query'),
    record.url,
    record.uri,
    record.endpoint,
    nestedInputField(record, 'url'),
    nestedInputField(record, 'uri'),
    nestedInputField(record, 'endpoint'),
    record.path,
    record.file,
    record.filePath,
    record.file_path,
    nestedInputField(record, 'path'),
    nestedInputField(record, 'file'),
    nestedInputField(record, 'filePath'),
    nestedInputField(record, 'file_path'),
    record.command,
    nestedInputField(record, 'command'),
    record.rawRef,
    record.raw_ref,
    record.traceRef,
    record.trace_ref,
    record.outputRef,
    record.output_ref,
    record.stdoutRef,
    record.stdout_ref,
    record.stderrRef,
    record.stderr_ref,
  ].some((value) => typeof value === 'string' && value.trim().length > 0)
    || finiteNumber(record.httpStatus) !== undefined
    || finiteNumber(record.statusCode) !== undefined
    || finiteNumber(record.status_code) !== undefined
    || inferHttpStatus(record) !== undefined
    || finiteNumber(record.exitCode) !== undefined
    || finiteNumber(record.exit_code) !== undefined
    || inferResultCount(record) !== undefined
    || Array.isArray(record.evidenceRefs);
  return hasToolEnvelope && hasStructuredFact;
}

function inferToolOperation(record: Record<string, unknown>): ToolOperationKind | undefined {
  if (finiteNumber(record.exitCode) !== undefined || firstString(record.stdoutRef, record.stderrRef) || firstString(record.command)) return 'command';
  const haystack = [
    record.operation,
    record.operationName,
    record.operation_name,
    record.action,
    record.toolKind,
    record.tool_kind,
    record.toolName,
    record.tool_name,
    record.name,
    record.kind,
    record.type,
    record.eventType,
    record.event_type,
    record.category,
    record.command,
  ]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  if (/\b(command|run_command|run|exec|shell|bash|sh|python|node|npm|pnpm|yarn|pytest|tsx)\b/.test(haystack)) return 'command';
  if (/\b(validat|verif|check|lint|test|schema|assert|acceptance)\b/.test(haystack)) return 'validate';
  if (/\b(search|query|retriev|lookup|grep|rg|find)\b/.test(haystack)) return 'search';
  if (/\b(fetch|download|request|http|curl|wget|crawl|scrape)\b/.test(haystack)) return 'fetch';
  if (/\b(read|open|cat|sed|head|tail|load)\b/.test(haystack)) return 'read';

  if (firstString(record.query, record.searchQuery, record.search_query, nestedInputField(record, 'query'), nestedInputField(record, 'searchQuery'), nestedInputField(record, 'search_query'))) return 'search';
  if (firstString(record.url, record.uri, record.endpoint, nestedInputField(record, 'url'), nestedInputField(record, 'uri'), nestedInputField(record, 'endpoint')) || finiteNumber(record.httpStatus) !== undefined || finiteNumber(record.statusCode) !== undefined) return 'fetch';
  if (firstString(record.path, record.file, record.filename, record.filePath, nestedInputField(record, 'path'), nestedInputField(record, 'file'), nestedInputField(record, 'filename'), nestedInputField(record, 'filePath'), nestedInputField(record, 'file_path'))) return 'read';
  if (firstString(record.verdict) || isRecord(record.validation) || isRecord(record.validator)) return 'validate';
  return undefined;
}

function inferStatus(record: Record<string, unknown>): WorkEvidence['status'] {
  const status = firstString(record.status, record.state, record.resultStatus, record.outcome)?.toLowerCase();
  const exitCode = finiteNumber(record.exitCode) ?? finiteNumber(record.exit_code);
  const httpStatus = inferHttpStatus(record);
  const ok = typeof record.ok === 'boolean' ? record.ok : typeof record.success === 'boolean' ? record.success : undefined;
  const resultCount = inferResultCount(record);
  const hasFailure = Boolean(inferFailureReason(record));
  const fallbackAttempted = Boolean(record.fallbackAttempted ?? record.fallback_attempted ?? record.fallback);
  const fallbackExhausted = Boolean(record.fallbackExhausted ?? record.fallback_exhausted);

  if (fallbackExhausted) return 'failed-with-reason';
  if (exitCode !== undefined && exitCode !== 0) return hasFailure ? 'failed-with-reason' : 'failed';
  if (httpStatus !== undefined && httpStatus >= 400) return hasFailure ? 'failed-with-reason' : 'failed';
  if (ok === false) return hasFailure ? 'failed-with-reason' : 'failed';
  if (status && /\b(fail|error|blocked|timeout|cancel|denied|rejected)\b/.test(status)) return hasFailure ? 'failed-with-reason' : 'failed';
  if (status && /\b(repair)\b/.test(status)) return 'repair-needed';
  if (resultCount === 0) return 'empty';
  if (fallbackAttempted && (ok === true || (status && /\b(success|succeeded|done|complete|completed|pass|passed|ok)\b/.test(status)))) return 'partial';
  if (ok === true || (status && /\b(success|succeeded|done|complete|completed|pass|passed|ok)\b/.test(status))) return 'success';
  if (httpStatus !== undefined && httpStatus >= 200 && httpStatus < 400 && resultCount !== undefined) return 'success';
  if (status && /\b(partial|running|started|pending|in_progress|in-progress)\b/.test(status)) return 'partial';
  return 'partial';
}

function inferResultCount(record: Record<string, unknown>): number | undefined {
  const direct = finiteNumber(record.resultCount)
    ?? finiteNumber(record.result_count)
    ?? finiteNumber(record.count)
    ?? finiteNumber(record.total)
    ?? finiteNumber(record.totalResults)
    ?? finiteNumber(record.total_results)
    ?? finiteNumber(record.matches)
    ?? finiteNumber(record.itemsRead);
  if (direct !== undefined) return direct;
  for (const key of ['results', 'items', 'records', 'matches', 'documents', 'files', 'artifacts']) {
    const value = record[key];
    if (Array.isArray(value)) return value.length;
  }
  for (const key of ['result', 'output', 'response', 'providerStatus', 'provider_status']) {
    const value = record[key];
    if (!isRecord(value)) continue;
    const nested = inferResultCount(value);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function compactToolInput(record: Record<string, unknown>, operation: ToolOperationKind): WorkEvidence['input'] | undefined {
  const picked: Record<string, unknown> = {};
  const aliases: Array<[string, unknown]> = [
    ['query', record.query ?? record.searchQuery ?? record.search_query ?? nestedInputField(record, 'query') ?? nestedInputField(record, 'searchQuery') ?? nestedInputField(record, 'search_query')],
    ['url', record.url ?? record.uri ?? record.endpoint ?? nestedInputField(record, 'url') ?? nestedInputField(record, 'uri') ?? nestedInputField(record, 'endpoint') ?? (isRecord(record.request) ? record.request.url ?? record.request.endpoint : undefined)],
    ['path', record.path ?? record.file ?? record.filePath ?? record.file_path ?? record.filename ?? nestedInputField(record, 'path') ?? nestedInputField(record, 'file') ?? nestedInputField(record, 'filePath') ?? nestedInputField(record, 'file_path') ?? nestedInputField(record, 'filename')],
    ['command', record.command ?? nestedInputField(record, 'command')],
    ['args', record.args ?? nestedInputField(record, 'args')],
    ['schema', record.schema ?? nestedInputField(record, 'schema')],
    ['validator', record.validator ?? nestedInputField(record, 'validator')],
    ['verdict', record.verdict ?? nestedInputField(record, 'verdict')],
  ];
  for (const [key, value] of aliases) {
    if (value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') picked[key] = value;
    if (Array.isArray(value)) picked[key] = value.filter((entry) => typeof entry === 'string' || typeof entry === 'number').slice(0, 12);
  }
  if (!Object.keys(picked).length) return { operation };
  return picked;
}

function workEvidenceKindForOperation(operation: ToolOperationKind): WorkEvidence['kind'] {
  if (operation === 'search') return 'retrieval';
  return operation;
}

function inferFailureReason(record: Record<string, unknown>) {
  const explicit = firstString(record.failureReason, record.failure_reason, record.reason, record.error, record.errorMessage, record.error_message, record.stderr);
  if (explicit) return clipText(explicit, 360);
  const httpStatus = inferHttpStatus(record);
  const timedOut = Boolean(record.timedOut ?? record.timed_out ?? record.timeout);
  const fallbackExhausted = Boolean(record.fallbackExhausted ?? record.fallback_exhausted);
  if (fallbackExhausted && httpStatus === 429 && timedOut) return 'Provider HTTP 429 and fallback timeout exhausted available providers.';
  if (fallbackExhausted) return 'Fallback providers were exhausted.';
  if (httpStatus === 429 && timedOut) return 'Provider returned HTTP 429 and timed out.';
  if (httpStatus === 429) return 'Provider returned HTTP 429 rate-limit diagnostics.';
  if (timedOut) return 'Provider request timed out.';
  return undefined;
}

function evidenceRefs(record: Record<string, unknown>, rawRef?: string) {
  return uniqueStrings([
    ...toStringList(record.evidenceRefs),
    ...toStringList(record.evidence_refs),
    ...toStringList(record.refs),
    ...toStringList(record.artifactRefs),
    ...toStringList(record.artifact_refs),
    ...toStringList(record.outputRefs),
    ...toStringList(record.output_refs),
    ...toStringList(record.logRefs),
    ...toStringList(record.log_refs),
    ...[
      rawRef,
      firstString(record.ref),
      firstString(record.traceId, record.trace_id) ? `trace:${firstString(record.traceId, record.trace_id)}` : undefined,
      firstString(record.eventId, record.event_id) ? `event:${firstString(record.eventId, record.event_id)}` : undefined,
      firstString(record.id) ? `event:${firstString(record.id)}` : undefined,
      firstString(record.runId, record.run_id) ? `run:${firstString(record.runId, record.run_id)}` : undefined,
      firstString(record.outputRef, record.output_ref),
      firstString(record.stdoutRef, record.stdout_ref),
      firstString(record.stderrRef, record.stderr_ref),
    ],
  ]);
}

function lowNoiseDiagnostics(record: Record<string, unknown>) {
  const httpStatus = inferHttpStatus(record);
  const diagnostics = [
    finiteNumber(record.exitCode) !== undefined ? `exitCode=${finiteNumber(record.exitCode)}` : '',
    httpStatus !== undefined ? `httpStatus=${httpStatus}` : '',
    finiteNumber(record.durationMs) !== undefined ? `durationMs=${finiteNumber(record.durationMs)}` : '',
    finiteNumber(record.duration_ms) !== undefined ? `durationMs=${finiteNumber(record.duration_ms)}` : '',
    finiteNumber(record.bytes) !== undefined ? `bytes=${finiteNumber(record.bytes)}` : '',
    firstString(record.status) ? `status=${firstString(record.status)}` : '',
  ];
  return uniqueStrings(diagnostics);
}

function collectExistingWorkEvidence(value: unknown, depth = 0): WorkEvidence[] {
  if (depth > 4 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectExistingWorkEvidence(entry, depth + 1));
  if (!isRecord(value)) return [];
  if (isWorkEvidenceLike(value)) return [value as unknown as WorkEvidence];
  return Object.values(value).flatMap((entry) => collectExistingWorkEvidence(entry, depth + 1));
}

function isWorkEvidenceLike(record: Record<string, unknown>) {
  const schema = stringField(record.schemaVersion);
  if (schema?.startsWith('sciforge.task-')) return false;
  return Boolean(stringField(record.kind))
    && Boolean(stringField(record.status))
    && Array.isArray(record.evidenceRefs)
    && Array.isArray(record.recoverActions);
}

function dedupeEvidence(entries: WorkEvidence[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify([entry.kind, entry.status, entry.provider, entry.input, entry.rawRef, entry.evidenceRefs]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordsInValue(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
}

function nestedInputField(record: Record<string, unknown>, key: string) {
  for (const containerKey of ['input', 'arguments', 'args', 'params', 'parameters']) {
    const container = record[containerKey];
    if (!isRecord(container)) continue;
    if (container[key] !== undefined) return container[key];
  }
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringField(value);
    if (text) return text;
  }
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function inferHttpStatus(record: Record<string, unknown>) {
  return finiteNumber(record.httpStatus)
    ?? finiteNumber(record.statusCode)
    ?? finiteNumber(record.status_code)
    ?? (isRecord(record.response) ? finiteNumber(record.response.status) ?? finiteNumber(record.response.statusCode) ?? finiteNumber(record.response.status_code) : undefined)
    ?? (isRecord(record.providerStatus) ? finiteNumber(record.providerStatus.status) ?? finiteNumber(record.providerStatus.statusCode) ?? finiteNumber(record.providerStatus.status_code) : undefined)
    ?? (isRecord(record.provider_status) ? finiteNumber(record.provider_status.status) ?? finiteNumber(record.provider_status.statusCode) ?? finiteNumber(record.provider_status.status_code) : undefined);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function clipText(value: string | undefined, maxChars: number) {
  if (!value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 24))}\n...[truncated ${value.length - Math.max(0, maxChars - 24)} chars]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}
