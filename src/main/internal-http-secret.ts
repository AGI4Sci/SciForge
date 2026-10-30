import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { APP_WEBHOOK_SECRET_HEADER } from '../shared/app-brand'

export type InternalHttpSecretScope = 'schedule' | 'workflow'

export function createInternalHttpSecret(scope: InternalHttpSecretScope): string {
  return `sciforge-${scope}-internal-${randomUUID()}`
}

export function normalizeInternalHttpSecret(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function internalSecretEnv(name: string, value: string | null | undefined): Record<string, string> {
  const secret = normalizeInternalHttpSecret(value)
  return secret ? { [name]: secret } : {}
}

export function isAuthorizedInternalHttpRequest(req: IncomingMessage, secret: string): boolean {
  const expected = normalizeInternalHttpSecret(secret)
  if (!expected) return false
  const bearer = parseBearer(req.headers.authorization)
  const headerSecret = normalizeHeaderValue(req.headers[APP_WEBHOOK_SECRET_HEADER])
  return sameSecret(bearer, expected) || sameSecret(headerSecret, expected)
}

function parseBearer(value: string | string[] | undefined): string {
  const raw = normalizeHeaderValue(value)
  const prefix = 'Bearer '
  return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : ''
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function sameSecret(actual: string, expected: string): boolean {
  if (!actual || !expected) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}
