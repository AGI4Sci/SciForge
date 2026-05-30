import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';

const DEFAULT_PREVIEW_TEXT_LIMIT = 12_000;
const DEFAULT_STRUCTURED_STRING_LIMIT = 2_400;
const INLINE_LABEL_LIMIT = 220;
const STRUCTURED_ARRAY_LIMIT = 40;
const STRUCTURED_OBJECT_KEY_LIMIT = 48;
const STRUCTURED_MAX_DEPTH = 6;

const localAbsolutePathPattern = /(^|[\s"'([{<])((?:\/(?:Applications|Users|private|var|tmp|etc|opt|home)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/g;
const privateUrlPattern = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^/\s"'<>]*(?:provider|token|secret|api|auth|oauth)[^/\s"'<>]*)[^\s"'<>]*/gi;
const privateUrlTestPattern = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^/\s"'<>]*(?:provider|token|secret|api|auth|oauth)[^/\s"'<>]*)[^\s"'<>]*/i;
const auditLogRefPattern = /(?:file:)?\.sciforge\/[^\s"'<>]*(?:audit|logs?|stdout|stderr|raw)[^\s"'<>]*/gi;
const auditLogRefTestPattern = /(?:file:)?\.sciforge\/[^\s"'<>]*(?:audit|logs?|stdout|stderr|raw)[^\s"'<>]*/i;
const secretKeyPattern = /(?:^|[_\s-])(?:authorization|auth|api[_\s-]?key|access[_\s-]?token|token|secret|password|credential|client[_\s-]?secret|provider|model(?:name)?|endpoint|baseurl|base[_\s-]?url|invokeurl|invoke[_\s-]?url)(?:$|[_\s-])/i;
const sensitiveBodyKeyPattern = /(?:^|[_-])(?:raw|rawbody|rawpayload|rawresponse|providerpayload|providerresponse|responsebody|stdout|stderr|logs?|logtext|rawoutput|providerrawoutput|html)(?:$|[_-])/i;
const sensitiveTextPattern = /\b(?:authorization|bearer|api[_\s-]?key|access[_\s-]?token|token|secret|password|credential|invalid token|unauthorized|forbidden)\b|RAW_[A-Z0-9_]+|\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/i;

export function sanitizeRightPaneText(value: string): string {
  return value
    .replace(privateUrlPattern, '[redacted-url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted-secret]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/gi, '[redacted-secret]')
    .replace(
      /\b(api[_\s-]?key|access[_\s-]?token|auth[_\s-]?token|token|secret|password|credential|authorization)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      '$1$2[redacted-secret]',
    )
    .replace(/\bAuthorization\s*:\s*[^\n\r]+/gi, 'Authorization: [redacted-secret]')
    .replace(localAbsolutePathPattern, (_match, prefix: string) => `${prefix}[redacted-local-path]`)
    .replace(auditLogRefPattern, '[redacted-audit-ref]')
    .replace(/RAW_[A-Z0-9_]+/g, '[redacted-raw]')
    .replace(/\b(?:Invalid token|Unauthorized|Forbidden)\b[^\n\r.]*/gi, 'authentication details redacted');
}

export function boundedRightPaneText(value: string, limit = DEFAULT_PREVIEW_TEXT_LIMIT): string {
  const safe = sanitizeRightPaneText(value).replace(/\u0000/g, '');
  if (safe.length <= limit) return safe;
  const omitted = safe.length - limit;
  return `${safe.slice(0, limit).trimEnd()}\n\n[preview truncated: ${omitted} chars omitted]`;
}

export function rightPaneInlineLabel(value: unknown, limit = INLINE_LABEL_LIMIT): string {
  const text = boundedRightPaneText(String(value ?? ''), limit).replace(/\s+/g, ' ').trim();
  return text || 'Saved';
}

export function rightPaneSafeRefs(value: unknown, maxRefs = 16): string[] {
  return uniqueStrings(
    collectRuntimeRefsFromValue(value, { maxDepth: 4, maxRefs: maxRefs * 2 })
      .filter((ref) => !rightPaneTextIsSensitive(ref))
      .map((ref) => rightPaneInlineLabel(ref, INLINE_LABEL_LIMIT))
      .filter((ref) => ref && !/^\[redacted-/.test(ref)),
  ).slice(0, maxRefs);
}

export function rightPaneStructuredPreview(value: unknown): unknown {
  const refs = rightPaneSafeRefs(value);
  const preview = sanitizeRightPanePreviewValue(value);
  return refs.length ? { refs, preview } : preview;
}

export function sanitizeRightPanePreviewValue(
  value: unknown,
  key = '',
  depth = 0,
): unknown {
  if (value === undefined || value === null) return value;
  if (isRuntimeDebugSensitiveSummary(value)) return sanitizeRuntimeDebugSummary(value, depth);
  if (secretKeyPattern.test(key)) return summarizeSensitivePreviewValue(value);
  if (typeof value === 'string') {
    if (sensitiveBodyKeyPattern.test(key) && (value.length > 400 || rightPaneTextIsSensitive(value))) {
      return summarizeSensitivePreviewValue(value);
    }
    return boundedRightPaneText(value, DEFAULT_STRUCTURED_STRING_LIMIT);
  }
  if (typeof value !== 'object') return value;
  if (sensitiveBodyKeyPattern.test(key)) return summarizeSensitivePreviewValue(value);
  if (Array.isArray(value)) {
    if (depth >= STRUCTURED_MAX_DEPTH) return { omitted: 'max-depth', length: value.length };
    const items = value
      .slice(0, STRUCTURED_ARRAY_LIMIT)
      .map((item) => sanitizeRightPanePreviewValue(item, key, depth + 1));
    if (value.length > STRUCTURED_ARRAY_LIMIT) {
      items.push({ omitted: `${value.length - STRUCTURED_ARRAY_LIMIT} additional items` });
    }
    return items;
  }
  if (depth >= STRUCTURED_MAX_DEPTH) {
    return { omitted: 'max-depth', keys: Object.keys(value as Record<string, unknown>).slice(0, 12) };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of entries.slice(0, STRUCTURED_OBJECT_KEY_LIMIT)) {
    out[childKey] = sanitizeRightPanePreviewValue(child, childKey, depth + 1);
  }
  if (entries.length > STRUCTURED_OBJECT_KEY_LIMIT) {
    out.omitted = `${entries.length - STRUCTURED_OBJECT_KEY_LIMIT} additional keys`;
  }
  return out;
}

export function formatRightPanePreviewJson(value: unknown, limit = DEFAULT_PREVIEW_TEXT_LIMIT): string {
  try {
    return boundedRightPaneText(JSON.stringify(sanitizeRightPanePreviewValue(value), null, 2), limit);
  } catch {
    return boundedRightPaneText(String(value), limit);
  }
}

export function formatRightPaneStructuredPreviewJson(value: unknown, limit = DEFAULT_PREVIEW_TEXT_LIMIT): string {
  try {
    return boundedRightPaneText(JSON.stringify(rightPaneStructuredPreview(value), null, 2), limit);
  } catch {
    return boundedRightPaneText(String(value), limit);
  }
}

export function rightPaneTextIsSensitive(value: string): boolean {
  return sensitiveTextPattern.test(value)
    || privateUrlTestPattern.test(value)
    || auditLogRefTestPattern.test(value)
    || /(^|[\s"'([{<])(?:\/(?:Applications|Users|private|var|tmp|etc|opt|home)\/|[A-Za-z]:\\)/.test(value);
}

function summarizeSensitivePreviewValue(value: unknown) {
  const refs = rightPaneSafeRefs(value, 8);
  if (typeof value === 'string') {
    return {
      omitted: 'right-pane-sensitive-text',
      chars: value.length,
      refs,
    };
  }
  if (value && typeof value === 'object') {
    return {
      omitted: 'right-pane-sensitive-object',
      keys: Object.keys(value as Record<string, unknown>).slice(0, 12),
      refs,
    };
  }
  return { omitted: 'right-pane-sensitive-value', refs };
}

function sanitizeRuntimeDebugSummary(value: Record<string, unknown>, depth: number) {
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    out[childKey] = sanitizeRightPanePreviewValue(child, childKey === 'refs' ? '' : childKey, depth + 1);
  }
  return out;
}

function isRuntimeDebugSensitiveSummary(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).omitted === 'string'
    && /^runtime-debug-sensitive/.test((value as Record<string, unknown>).omitted as string);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
