import type { AgentRuntimeId } from '../../../../src/shared/agent-runtime-contract'

export const EVIDENCE_DAG_SERVICE_URL_ENV = 'SCIFORGE_EVIDENCE_DAG_SERVICE_URL'
export const EVIDENCE_DAG_API_KEY_ENV = 'SCIFORGE_EVIDENCE_DAG_API_KEY'
export const EVIDENCE_DAG_TIMEOUT_MS_ENV = 'SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS'
export const DEFAULT_EVIDENCE_DAG_SERVICE_URL = 'http://127.0.0.1:3897'
export const DEFAULT_EVIDENCE_DAG_TIMEOUT_MS = 600_000

export function evidenceDagThreadId(
  runtimeId: AgentRuntimeId | string | undefined,
  threadId: string
): string {
  const id = threadId.trim()
  const runtime = runtimeId?.trim()
  return runtime && id ? `${runtime}:${id}` : id
}

export function normalizeEvidenceDagServiceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function evidenceDagServiceUrlFromEnv(env: Record<string, string | undefined>): string {
  return normalizeEvidenceDagServiceUrl(env[EVIDENCE_DAG_SERVICE_URL_ENV])
}

export function evidenceDagApiKeyFromEnv(env: Record<string, string | undefined>): string {
  return (env[EVIDENCE_DAG_API_KEY_ENV] ?? '').trim()
}

export function evidenceDagUiUrl(input: {
  runtimeId?: AgentRuntimeId | string
  threadId?: string | null
  serviceUrl?: string
  apiKey?: string | null
}): string {
  const base = normalizeEvidenceDagServiceUrl(input.serviceUrl) || DEFAULT_EVIDENCE_DAG_SERVICE_URL
  const url = new URL(`${base}/`)
  const threadId = input.threadId?.trim()
  const runtimeId = input.runtimeId?.trim()
  if (threadId) {
    url.searchParams.set('thread', evidenceDagThreadId(runtimeId, threadId))
    if (runtimeId) url.searchParams.set('preview', 'trusted')
  }
  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    const hash = new URLSearchParams()
    hash.set('token', apiKey)
    url.hash = hash.toString()
  }
  return url.toString()
}
