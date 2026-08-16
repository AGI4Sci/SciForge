import { redactCredentials } from '@sciforge/collaboration-contracts'

const ASSIGNMENT = /\b(api[-_]?key|token|password|secret|challenge)\s*[:=]\s*[^\s,;]+/gi

export type RedactionLimits = {
  maxDepth: number
  maxEntries: number
  maxStringLength: number
}

const DEFAULT_LIMITS: RedactionLimits = {
  maxDepth: 5,
  maxEntries: 64,
  maxStringLength: 1_024
}

export function redactZulipText(value: string, maxLength = DEFAULT_LIMITS.maxStringLength): string {
  const sharedRedacted = redactCredentials(value)
  const redacted = (typeof sharedRedacted === 'string' ? sharedRedacted : '[REDACTED]')
    .replace(ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`)
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`
}

export function redactZulipDiagnostic(
  value: unknown,
  limits: Partial<RedactionLimits> = {}
): unknown {
  const effective: RedactionLimits = { ...DEFAULT_LIMITS, ...limits }
  let entries = 0
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') {
      return redactZulipText(current, effective.maxStringLength)
    }
    if (typeof current === 'number' || typeof current === 'boolean' || current === null) return current
    if (current === undefined) return undefined
    if (depth >= effective.maxDepth) return '[TRUNCATED]'
    if (typeof current !== 'object') return redactZulipText(String(current), effective.maxStringLength)
    if (seen.has(current)) return '[CIRCULAR]'
    seen.add(current)

    if (Array.isArray(current)) {
      const result: unknown[] = []
      for (const item of current) {
        if (entries >= effective.maxEntries) {
          result.push('[TRUNCATED]')
          break
        }
        entries += 1
        result.push(visit(item, depth + 1))
      }
      return result
    }

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(current)) {
      if (entries >= effective.maxEntries) {
        result.truncated = true
        break
      }
      entries += 1
      result[key] = visit(item, depth + 1)
    }
    return result
  }

  return redactCredentials(visit(value, 0))
}
