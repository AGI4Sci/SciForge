import type { TraceJsonValue } from './schema.js'

export const TRACE_REDACTION_MARKER = '[REDACTED]'

export type TraceSanitizationOptions = {
  sensitiveValues?: readonly string[]
}

const SECRET_FIELD_NAMES = new Set([
  'authorization',
  'authentication',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'token',
  'authtoken',
  'xauthtoken',
  'xaccesstoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'password',
  'passwd',
  'credential',
  'credentials',
  'secret',
  'sessionkey',
  'privatekey',
  'signingkey'
])

const SECRET_FIELD_SUFFIXES = [
  'authorization',
  'apikey',
  'token',
  'clientsecret',
  'password',
  'credential',
  'secret',
  'cookie',
  'privatekey',
  'signingkey'
]

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const OPENAI_ANTHROPIC_KEY_PATTERN = /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g
const GITHUB_TOKEN_PATTERN = /\b(?:gh[opusr]|github_pat)_[A-Za-z0-9_]{12,}\b/g
const GOOGLE_KEY_PATTERN = /\bAIza[A-Za-z0-9_-]{20,}\b/g
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
const SERVICE_TOKEN_PATTERN = /\b(?:npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g
const SECRET_HEADER_LINE_PATTERN = /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:\s*)[^\r\n]*/gim
const INLINE_ASSIGNMENT_PATTERN = /(["']?)(authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|client[-_ ]?secret|password|passwd|credential|private[-_ ]?key|secret)\1(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}&]+)/gi
const URL_PASSWORD_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)(@)/gi

export function isSecretFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name)
  return SECRET_FIELD_NAMES.has(normalized) ||
    SECRET_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function sanitizeTraceText(value: string, options: TraceSanitizationOptions = {}): string {
  let sanitized = value
    .replace(PRIVATE_KEY_PATTERN, TRACE_REDACTION_MARKER)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${TRACE_REDACTION_MARKER}`)
    .replace(JWT_PATTERN, TRACE_REDACTION_MARKER)
    .replace(OPENAI_ANTHROPIC_KEY_PATTERN, TRACE_REDACTION_MARKER)
    .replace(GITHUB_TOKEN_PATTERN, TRACE_REDACTION_MARKER)
    .replace(GOOGLE_KEY_PATTERN, TRACE_REDACTION_MARKER)
    .replace(AWS_ACCESS_KEY_PATTERN, TRACE_REDACTION_MARKER)
    .replace(SERVICE_TOKEN_PATTERN, TRACE_REDACTION_MARKER)
    .replace(SECRET_HEADER_LINE_PATTERN, `$1${TRACE_REDACTION_MARKER}`)
    .replace(INLINE_ASSIGNMENT_PATTERN, (_match, quote: string, key: string, separator: string) => (
      `${quote}${key}${quote}${separator}${TRACE_REDACTION_MARKER}`
    ))
    .replace(URL_PASSWORD_PATTERN, `$1${TRACE_REDACTION_MARKER}$3`)
  for (const sensitiveValue of exactSensitiveValues(options.sensitiveValues ?? [])) {
    sanitized = sanitized.replaceAll(sensitiveValue, TRACE_REDACTION_MARKER)
  }
  return sanitized
}

/**
 * Sanitizes a complete streamed text sequence before redistributing it over
 * the original ordered event count. Joining first catches patterns split at
 * arbitrary transport chunk boundaries.
 */
export function sanitizeTraceTextChunks(
  chunks: readonly string[],
  options: TraceSanitizationOptions = {}
): string[] {
  if (chunks.length === 0) return []
  const sanitized = sanitizeTraceText(chunks.join(''), options)
  let offset = 0
  return chunks.map((chunk, index) => {
    if (index === chunks.length - 1) return sanitized.slice(offset)
    const nextOffset = Math.min(sanitized.length, offset + chunk.length)
    const part = sanitized.slice(offset, nextOffset)
    offset = nextOffset
    return part
  })
}

export function sanitizeTraceHeaders(
  headers: Headers | Iterable<readonly [string, unknown]> | Record<string, unknown>,
  options: TraceSanitizationOptions = {}
): Record<string, TraceJsonValue> {
  const result: Record<string, TraceJsonValue> = {}
  for (const [name, value] of headerEntries(headers)) {
    result[name] = isSecretFieldName(name)
      ? TRACE_REDACTION_MARKER
      : sanitizeTraceValue(value, options)
  }
  return result
}

/** Returns credential values that must also be removed if an upstream echoes them unlabeled. */
export function sensitiveTraceValuesFromHeaders(
  headers: Headers | Iterable<readonly [string, unknown]> | Record<string, unknown>
): string[] {
  const values = new Set<string>()
  for (const [name, raw] of headerEntries(headers)) {
    if (!isSecretFieldName(name)) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      if (!trimmed) continue
      values.add(trimmed)
      const authToken = /^(?:Bearer|Basic)\s+(.+)$/i.exec(trimmed)?.[1]?.trim()
      if (authToken) values.add(authToken)
      if (normalizeFieldName(name).endsWith('cookie')) {
        for (const item of trimmed.split(';')) {
          const cookieValue = item.slice(item.indexOf('=') + 1).trim()
          if (cookieValue && cookieValue !== item.trim()) values.add(cookieValue)
        }
      }
    }
  }
  return [...values]
}

export function sanitizeTraceValue(
  value: unknown,
  options: TraceSanitizationOptions = {}
): TraceJsonValue {
  return sanitizeValue(value, new WeakSet<object>(), 0, options)
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  options: TraceSanitizationOptions
): TraceJsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return sanitizeTraceText(value, options)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`
  if (depth >= 100) return '[MaxDepth]'

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: sanitizeTraceText(value.name, options),
      message: sanitizeTraceText(value.message, options),
      ...(value.stack ? { stack: sanitizeTraceText(value.stack, options) } : {})
    }
  }
  if (value instanceof Uint8Array) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    return {
      encoding: 'base64',
      data: containsSensitiveBinaryData(bytes, options)
        ? TRACE_REDACTION_MARKER
        : bytes.toString('base64')
    }
  }

  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeValue(entry, seen, depth + 1, options))
    }
    if (value instanceof Map) {
      const mapped: Record<string, TraceJsonValue> = {}
      for (const [key, entry] of value.entries()) {
        const name = String(key)
        mapped[name] = isSecretFieldName(name)
          ? TRACE_REDACTION_MARKER
          : sanitizeValue(entry, seen, depth + 1, options)
      }
      return mapped
    }
    if (value instanceof Set) {
      return [...value].map((entry) => sanitizeValue(entry, seen, depth + 1, options))
    }

    const objectValue = value as Record<string, unknown>
    const sanitized: Record<string, TraceJsonValue> = {}
    for (const [name, entry] of Object.entries(objectValue)) {
      sanitized[name] = isSecretFieldName(name)
        ? TRACE_REDACTION_MARKER
        : sanitizeValue(entry, seen, depth + 1, options)
    }
    return sanitized
  } catch {
    return '[Unserializable]'
  } finally {
    seen.delete(value)
  }
}

function containsSensitiveBinaryData(
  bytes: Buffer,
  options: TraceSanitizationOptions
): boolean {
  for (const raw of options.sensitiveValues ?? []) {
    const value = raw.trim()
    if (!value || value === TRACE_REDACTION_MARKER) continue
    if (bytes.indexOf(Buffer.from(value, 'utf8')) >= 0) return true
  }
  const inspectableText = bytes.toString('latin1')
  return sanitizeTraceText(inspectableText) !== inspectableText
}

function exactSensitiveValues(values: readonly string[]): string[] {
  const exactValues = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value || value === TRACE_REDACTION_MARKER) continue
    exactValues.add(value)
  }
  return [...exactValues].sort((left, right) => right.length - left.length)
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function headerEntries(
  headers: Headers | Iterable<readonly [string, unknown]> | Record<string, unknown>
): Iterable<readonly [string, unknown]> {
  if (Symbol.iterator in Object(headers)) {
    return headers as Iterable<readonly [string, unknown]>
  }
  return Object.entries(headers)
}
