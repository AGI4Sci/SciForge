const SECRET_KEY_PATTERN = /(api[-_\s]?key|access[-_\s]?key(?:[-_\s]?id)?|private[-_\s]?key|authorization|bearer|bot[-_\s]?token|client[-_\s]?secret|app[-_\s]?secret|webhook[-_\s]?secret|password|passphrase|secret|token)/i
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi
const SECRET_TEXT_PATTERNS = [
  /(["'])(authorization|api[-_\s]?key|bot[-_\s]?token|client[-_\s]?secret|app[-_\s]?secret|webhook[-_\s]?secret|password|token|secret|x-sciforge-secret)\1\s*:\s*(["'])((?:Bearer|Bot)\s+)?[^"']*\3/gi,
  /\b(authorization|api[-_\s]?key|(?:aws[-_\s]?)?access[-_\s]?key(?:[-_\s]?id)?|aws[-_\s]?secret[-_\s]?access[-_\s]?key|private[-_\s]?key|bot[-_\s]?token|client[-_\s]?secret|app[-_\s]?secret|webhook[-_\s]?secret|password|passphrase|token|secret|x-sciforge-secret)\s*(:|=)\s*((?:Bearer|Bot)\s+)?[^\s,;]+/gi,
  /\b(bearer|bot)\s+([^\s,;]+)/gi
]

export const REDACTED_SECRET = '<redacted>'

export function redactSecrets<T>(value: T): T {
  return redact(value, '', new WeakSet<object>()) as T
}

function redact(value: unknown, key = '', seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, '', seen))
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED_SECRET
    return redactSecretText(value)
  }
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = SECRET_KEY_PATTERN.test(childKey)
      ? REDACTED_SECRET
      : redact(childValue, childKey, seen)
  }
  return out
}

export function redactSecretText(value: string): string {
  const redacted = SECRET_TEXT_PATTERNS.reduce((current, pattern, index) =>
    current.replace(pattern, (...args) => {
      const match = String(args[0])
      if (index === 0) {
        const quote = String(args[1])
        const key = String(args[2])
        const valueQuote = String(args[3])
        const scheme = typeof args[4] === 'string' ? args[4] : ''
        return `${quote}${key}${quote}: ${valueQuote}${scheme}${REDACTED_SECRET}${valueQuote}`
      }
      if (index === 1) {
        const key = String(args[1])
        const separator = String(args[2])
        const scheme = typeof args[3] === 'string' ? args[3] : ''
        const padding = separator === ':' ? ' ' : ''
        return `${key}${separator}${padding}${scheme}${REDACTED_SECRET}`
      }
      const scheme = match.toLowerCase().startsWith('bot ') ? 'Bot' : 'Bearer'
      return `${scheme} ${REDACTED_SECRET}`
    }), value)
  return redacted.replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED_SECRET)
}

export function redactExactSensitiveValues(
  value: string,
  sensitiveValues: readonly string[]
): string {
  const exact = [...new Set(sensitiveValues.filter((candidate) => (
    typeof candidate === 'string' && candidate.length > 0 && candidate !== REDACTED_SECRET
  )))].sort((left, right) => right.length - left.length)
  return exact.reduce(
    (current, sensitiveValue) => current.replaceAll(sensitiveValue, REDACTED_SECRET),
    value
  )
}
