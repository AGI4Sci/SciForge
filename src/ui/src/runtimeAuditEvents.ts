export const RUNTIME_AUDIT_EVENT_SUMMARY = 'Runtime event recorded; structured details are available in the folded run audit.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function lowerField(value: unknown) {
  return stringField(value)?.toLowerCase() ?? '';
}

function lowerRecordField(record: Record<string, unknown>, key: string) {
  return lowerField(record[key]);
}

export function isRuntimeAuditOnlyEvent(value: unknown): boolean {
  const record = isRecord(value) ? value : {};
  const raw = isRecord(record.raw) ? record.raw : {};
  const type = lowerField(record.type ?? record.kind);
  const rawType = lowerField(raw.type ?? raw.kind);
  const status = lowerField(record.status);
  const rawStatus = lowerRecordField(raw, 'status');
  const role = lowerField(record.presentationRole ?? record.role ?? record.displayRole);
  const rawRole = lowerField(raw.presentationRole ?? raw.role ?? raw.displayRole);
  const stream = lowerField(record.stream ?? raw.stream);
  const source = lowerField(record.source ?? raw.source);
  const text = [
    stringField(record.detail),
    stringField(record.message),
    stringField(record.text),
    stringField(raw.detail),
    stringField(raw.message),
    stringField(raw.text),
    stringField(raw.chunk),
  ].filter(Boolean).join('\n');

  if (role === 'audit' || role === 'debug' || rawRole === 'audit' || rawRole === 'debug') return true;
  if (type === 'audit' || type === 'debug' || rawType === 'audit' || rawType === 'debug') return true;
  if (stream === 'stderr' || stream === 'stdout') return true;
  if (/(?:^|[-_])(stderr|stdout)(?:$|[-_])/.test(type) || /(?:^|[-_])(stderr|stdout)(?:$|[-_])/.test(rawType)) return true;
  if (/raw[-_]?jsonl|invalid[-_]?jsonl|provider[-_]?sse/.test(`${type} ${rawType} ${status} ${rawStatus}`)) return true;
  if (['stdout', 'stderr', 'jsonl', 'rawJsonl', 'stdoutRef', 'stderrRef', 'rawRef', 'runtimeEventsRef'].some((key) => key in record || key in raw)) {
    return true;
  }
  if (/codex|runtime|plugin|provider|cloudflare|stderr|stdout/.test(`${source} ${type} ${rawType} ${status} ${rawStatus}`)
    && runtimeTextLooksAuditOnly(text)) {
    return true;
  }
  return false;
}

export function runtimeTextLooksAuditOnly(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const text = value.trim();
  return /(?:\b(?:stdout|stderr|raw\s*jsonl|raw_jsonl|provider\s*sse|plugin\s+manifest|manifest\s+warning|invalid\s+plugin|failed\s+to\s+load\s+plugin|codex\s+jsonl|cf-ray|cloudflare)\b|<!doctype\s+html|<html\b|attention\s+required)/i.test(text);
}

export function runtimeAuditOnlyEventSummary(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const raw = isRecord(record.raw) ? record.raw : {};
  const haystack = [
    record.type,
    record.status,
    record.source,
    raw.type,
    lowerRecordField(raw, 'status'),
    raw.stream,
    raw.message,
    raw.chunk,
    record.message,
    record.detail,
  ].map((item) => typeof item === 'string' ? item : '').join('\n').toLowerCase();
  if (/plugin\s+manifest|manifest\s+warning|invalid\s+plugin|failed\s+to\s+load\s+plugin/.test(haystack)) {
    return 'Runtime Codex plugin manifest warning recorded; details are available in the folded run audit.';
  }
  if (/stderr/.test(haystack)) {
    return 'Runtime Codex stderr output recorded; details are available in the folded run audit.';
  }
  if (/stdout/.test(haystack)) {
    return 'Runtime Codex stdout output recorded; details are available in the folded run audit.';
  }
  if (/raw[-_\s]?jsonl|jsonl/.test(haystack)) {
    return 'Runtime Codex raw runtime events recorded; details are available in the folded run audit.';
  }
  if (/cloudflare|<!doctype\s+html|<html\b|provider\s*sse/.test(haystack)) {
    return 'Runtime provider transport output recorded; details are available in the folded run audit.';
  }
  return RUNTIME_AUDIT_EVENT_SUMMARY;
}
