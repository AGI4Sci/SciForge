import type {
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeThreadDetail
} from '../../shared/agent-runtime-contract'
import {
  DEFAULT_EVIDENCE_DAG_TIMEOUT_MS,
  EVIDENCE_DAG_TIMEOUT_MS_ENV,
  evidenceDagApiKeyFromEnv,
  evidenceDagServiceUrlFromEnv,
  evidenceDagThreadId
} from '../../../packages/workers/evidence-dag/desktop/contract'

type EngineTraceItem = Record<string, unknown>

type FeedOptions = {
  runtimeId: AgentRuntimeId | string
  threadId: string
  items: readonly AgentRuntimeItem[]
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  failOpen?: boolean
  rebuild?: boolean
  verify?: boolean
  audit?: boolean
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function itemContent(item: AgentRuntimeItem): string {
  return item.text?.trim() || item.detail?.trim() || item.summary?.trim() || stringifyOutput(item.meta)
}

function toolName(item: AgentRuntimeItem): string {
  const meta = item.meta ?? {}
  const name = meta.toolName ?? meta.name ?? meta.tool_name ?? item.toolKind
  return typeof name === 'string' && name.trim() ? name.trim() : 'tool'
}

export function isEvidenceDagFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(evidenceDagServiceUrlFromEnv(env) && evidenceDagApiKeyFromEnv(env))
}

export function isEvidenceDagAutoFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!isEvidenceDagFeedEnabled(env)) return false
  const value = env.SCIFORGE_EVIDENCE_DAG_AUTO_FEED?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function toEvidenceDagTraceItems(items: readonly AgentRuntimeItem[]): EngineTraceItem[] {
  const out: EngineTraceItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case 'user_message': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'user', content })
        break
      }
      case 'assistant_message': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'assistant', content })
        break
      }
      case 'reasoning': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'assistant', content })
        break
      }
      case 'tool': {
        if (item.status === 'error' || item.status === 'failed' || item.status === 'aborted') break
        const content = itemContent(item)
        if (content) {
          out.push({ id: item.id, type: 'tool_result', tool_name: toolName(item), content })
        }
        break
      }
      default:
        break
    }
  }
  return out
}

export function completedTurnItems(
  detail: AgentRuntimeThreadDetail,
  turnId: string
): AgentRuntimeItem[] {
  const turn = detail.turns?.find((candidate) => candidate.id === turnId)
  if (turn?.items?.length) return turn.items
  return (detail.items ?? []).filter((item) => item.turnId === turnId)
}

export async function feedEvidenceDag(options: FeedOptions): Promise<void> {
  const env = options.env ?? process.env
  const base = evidenceDagServiceUrlFromEnv(env)
  if (!base) return
  const apiKey = evidenceDagApiKeyFromEnv(env)
  if (!apiKey) return

  const trace = toEvidenceDagTraceItems(options.items)
  if (trace.length === 0) return

  const timeoutMs = Number(env[EVIDENCE_DAG_TIMEOUT_MS_ENV] ?? DEFAULT_EVIDENCE_DAG_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_EVIDENCE_DAG_TIMEOUT_MS
  )
  try {
    const engineThreadId = evidenceDagThreadId(options.runtimeId, options.threadId)
    const response = await (options.fetchImpl ?? fetch)(`${base}/threads/${encodeURIComponent(engineThreadId)}/ingest-trace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        trace,
        ...(options.rebuild ? { rebuild: true } : {}),
        ...(typeof options.verify === 'boolean' ? { verify: options.verify } : {}),
        ...(typeof options.audit === 'boolean' ? { audit: options.audit } : {})
      }),
      signal: controller.signal
    })
    const body = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: unknown } } | null
    if (!response.ok || body?.ok === false) {
      const message = typeof body?.error?.message === 'string'
        ? body.error.message
        : `Evidence DAG ingest returned HTTP ${response.status}`
      throw new Error(message)
    }
  } catch (error) {
    if (options.failOpen === false) throw error
    // fail-open: the DAG is best-effort; never break the runtime turn.
  } finally {
    clearTimeout(timer)
  }
}
