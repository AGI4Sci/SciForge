import { createHash, randomBytes, randomUUID } from 'node:crypto'

const SENSITIVE_KEY = /(?:authorization|credential|secret|token|password|private.?key|challenge)/i

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

export function issueSecret(prefix: string): string {
  return `${prefix}.${randomBytes(32).toString('base64url')}`
}

export function digestSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

export function safeAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (typeof value === 'string') output[key] = value.slice(0, 500)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value
  }
  return output
}
