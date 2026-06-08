export const PUBLIC_EVENT_REDACTED = '[redacted-public-event-payload]';

const FORBIDDEN_KEY_SEGMENTS = new Set([
  'raw',
  'secret',
  'password',
  'credential',
  'authorization',
  'token',
  'log',
  'logs',
  'stdout',
  'stderr',
  'html',
  'dom',
  'body',
]);
const FORBIDDEN_KEY_COMPOUNDS = new Set([
  'api-key',
  'access-token',
  'refresh-token',
  'auth-token',
  'provider-payload',
  'provider-request',
  'provider-response',
  'provider-body',
  'provider-request-body',
  'provider-response-body',
  'artifact-body',
  'artifact-data',
  'screenshot-base64',
  'screenshot-bytes',
  'screenshot-path',
  'image-base64',
  'image-bytes',
  'data-url',
  'trace-json',
  'raw-trace',
  'raw-logs',
  'log-lines',
  'accessibility-tree',
  'ax-tree',
  'visible-text',
  'selected-text',
  'raw-command',
  'command-text',
  'terminal-command',
  'raw-path',
  'workspace-path',
  'file-path',
  'target-path',
  'raw-url',
  'request-body',
  'response-body',
  'raw-body',
]);
const UNSAFE_VALUE_PATTERN = /data:image|;base64,|https?:\/\/|wss?:\/\/|file:\/\/|blob:|javascript:|bearer\s+|\b(?:sk|rk|pk)-[A-Za-z0-9_-]+|\bghp_[A-Za-z0-9_]+|\bgithub_pat_[A-Za-z0-9_]+|provider[-_:]?payload|raw[-_:]?(?:screenshot|command|path|payload|body|trace|log)|(?:^|[\s"'([{])(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i;
const NAKED_BASE64_PATTERN = /^[A-Za-z0-9+/]{120,}={0,2}$/;
const REF_ARRAY_KEY_PATTERN = /(?:^|[-_])refs?$/i;
const TOKENIZED_REF_PATTERN = /^[a-z][a-z0-9_-]*:[^\s\\]+$/i;

export function sanitizePublicEvent(value: unknown): unknown {
  return sanitizePublicEventValue(value, undefined);
}

export function publicEventHasForbiddenRaw(value: unknown): boolean {
  if (typeof value === 'string') return isUnsafePublicString(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => publicEventHasForbiddenRaw(item));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenPublicKey(key)) return true;
    if (publicEventHasForbiddenRaw(child)) return true;
  }
  return false;
}

function sanitizePublicEventValue(value: unknown, key: string | undefined): unknown {
  if (typeof value === 'string') {
    if (key && isRefArrayKey(key)) return isSafePublicRef(value) ? value : undefined;
    return isUnsafePublicString(value) ? PUBLIC_EVENT_REDACTED : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    const sanitizedItems = value
      .map((item) => sanitizePublicEventValue(item, key))
      .filter((item) => item !== undefined);
    return sanitizedItems;
  }
  if (typeof value !== 'object') return undefined;

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenPublicKey(childKey)) continue;
    const sanitized = sanitizePublicEventValue(childValue, childKey);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  return result;
}

function isForbiddenPublicKey(key: string): boolean {
  const normalized = normalizePublicKey(key);
  if (FORBIDDEN_KEY_COMPOUNDS.has(normalized)) return true;
  const segments = normalized.split('-').filter(Boolean);
  return segments.some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment));
}

function normalizePublicKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function isRefArrayKey(key: string): boolean {
  return REF_ARRAY_KEY_PATTERN.test(normalizePublicKey(key));
}

function isSafePublicRef(value: string): boolean {
  const trimmed = value.trim();
  return TOKENIZED_REF_PATTERN.test(trimmed) && !isUnsafePublicString(trimmed);
}

function isUnsafePublicString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return UNSAFE_VALUE_PATTERN.test(trimmed) || NAKED_BASE64_PATTERN.test(trimmed);
}
