export const PUBLIC_RUNTIME_AUDIT_FALLBACK = 'Runtime event recorded; structured details are available in the run audit.';

const SECRET_LABEL_PATTERN = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization|credential|client[_-]?secret)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{4,})/gi;
const BEARER_SECRET_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi;
const PREFIXED_SECRET_PATTERN = /\b(?:sk|rk|pk|ghp|github_pat)[_-][A-Za-z0-9._-]{8,}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>\\)]+/gi;
const LOCAL_UNIX_PATH_PATTERN = /(^|[\s([{:=])((?:~\/|\/(?:Applications|Users|workspace|tmp|var|private|Volumes|home|opt|etc|mnt|srv|Library)\b)[^\s"',;)}\]]*)/gi;
const WINDOWS_PATH_PATTERN = /(^|[\s([{:=])((?:[A-Za-z]:[\\/]|\\\\)[^\s"',;)}\]]*)/g;
const RAW_RUNTIME_WORD_PATTERN = /\b(?:stdout|stderr|raw[_ -]?jsonl?|jsonl|raw[_ -]?transcript|raw[_ -]?provider[_ -]?(?:body|payload|output)|provider[_ -]?raw[_ -]?(?:body|payload|output))\b/gi;

export function sanitizePublicText(
  value: unknown,
  options: {
    fallback?: string;
    maxLength?: number;
  } = {},
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const fallback = options.fallback ?? PUBLIC_RUNTIME_AUDIT_FALLBACK;
  if (looksLikeRawPayload(text)) return fallback;
  const redacted = redactInlinePrivateText(text)
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
  const compact = redacted.replace(/[ \t]{2,}/g, ' ');
  if (!compact) return fallback;
  const maxLength = options.maxLength ?? 320;
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 18)).replace(/\s+\S*$/, '')} ... [truncated]`;
}

export function sanitizePublicTextRequired(value: unknown, fallback: string) {
  return sanitizePublicText(value, { fallback }) ?? fallback;
}

export function sanitizePublicTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((entry) => sanitizePublicText(entry, { fallback: '[redacted]' }))
    .filter((entry): entry is string => Boolean(entry));
  return out;
}

export function publicScopeToken(value: unknown, fallback = 'default') {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  return `scope-${fnv1aBase36(text)}`;
}

export function publicConfigPresenceLabel(value: unknown, label: string) {
  return typeof value === 'string' && value.trim()
    ? `${label}: present (masked)`
    : `${label}: missing`;
}

export function publicConfigInputPlaceholder(value: unknown, emptyPlaceholder: string) {
  return typeof value === 'string' && value.trim()
    ? 'Configured locally. Enter a new value to replace it, or leave blank to keep the masked setting.'
    : emptyPlaceholder;
}

export function redactInlinePrivateText(value: string) {
  return value
    .replace(BEARER_SECRET_PATTERN, 'Bearer [redacted-secret]')
    .replace(SECRET_LABEL_PATTERN, (_match, label: string) => `${label}=[redacted-secret]`)
    .replace(PREFIXED_SECRET_PATTERN, '[redacted-secret]')
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(LOCAL_UNIX_PATH_PATTERN, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(WINDOWS_PATH_PATTERN, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(RAW_RUNTIME_WORD_PATTERN, 'runtime audit');
}

function looksLikeRawPayload(value: string) {
  const trimmed = value.trim();
  if (/^[{[]/.test(trimmed)) return true;
  if (/^event:\s|^data:\s/im.test(trimmed)) return true;
  if (/\b(?:rawJsonl|raw_jsonl|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(trimmed)) return true;
  return false;
}

function fnv1aBase36(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}
