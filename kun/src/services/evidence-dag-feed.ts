/**
 * Evidence-DAG feed seam (kun -> standalone evidence-dag-engine).
 *
 * On each COMPLETED turn the turn-service hands this module that turn's items.
 * We map them to the engine's trace shape (dropping approval/error/UI noise) and
 * POST them to `/threads/{threadId}/ingest-trace` with `merge:true`, so the
 * engine ACCUMULATES the turn into the thread's existing graph — one living DAG
 * per conversation that grows turn by turn, rather than a fresh graph per turn.
 *
 * Design constraints (mirrors translateDataAttachment in agent-loop.ts):
 *   - Gated by SCIFORGE_EVIDENCE_DAG_SERVICE_URL (unset => no-op, feature off).
 *   - Fire-and-forget and fail-open: this NEVER throws and NEVER blocks a turn.
 *     The DAG is an observability side-channel; if the engine is down the turn
 *     must still complete normally.
 */
import type { TurnItem } from '../contracts/items.js'

const SERVICE_URL_ENV = 'SCIFORGE_EVIDENCE_DAG_SERVICE_URL'
const API_KEY_ENV = 'SCIFORGE_EVIDENCE_DAG_API_KEY' // optional Bearer
const TIMEOUT_MS_ENV = 'SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS'
const DEFAULT_TIMEOUT_MS = 15_000

/** A trace item in the shape evidence-dag-engine's render_trace() consumes. */
type EngineTraceItem = Record<string, unknown>

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Pure mapping: kun turn items -> engine trace items. Keeps the signal the DAG
 * extractor needs (user/assistant text, agent reasoning, tool calls, successful
 * tool results) and drops everything that is UI/control noise or has no
 * evidentiary content (approvals, prompts, compaction markers, reviews, errors,
 * failed tool results).
 */
export function toTraceItems(items: readonly TurnItem[]): EngineTraceItem[] {
  const out: EngineTraceItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case 'user_message':
        out.push({ id: item.id, type: 'message', role: 'user', content: item.text })
        break
      case 'assistant_text':
        out.push({ id: item.id, type: 'message', role: 'assistant', content: item.text })
        break
      case 'assistant_reasoning':
        out.push({ id: item.id, type: 'message', role: 'assistant', content: item.text })
        break
      case 'tool_call':
        out.push({ id: item.id, type: 'tool_call', tool_name: item.toolName, arguments: item.arguments })
        break
      case 'tool_result':
        if (item.isError) break // a failed tool result carries no evidence
        out.push({ id: item.id, type: 'tool_result', tool_name: item.toolName, content: stringifyOutput(item.output) })
        break
      default:
        break // approval / user_input / compaction / review / error -> noise
    }
  }
  return out
}

/**
 * Feed one completed turn's items into the thread's evidence DAG (merge mode).
 * No-op when the gate env is unset or the mapped trace is empty. Resolves even
 * on network/timeout/HTTP errors — callers should treat it as fire-and-forget.
 */
export async function feedEvidenceDag(threadId: string, items: readonly TurnItem[]): Promise<void> {
  const base = (process.env[SERVICE_URL_ENV] ?? '').trim().replace(/\/+$/, '')
  if (!base) return // gate off

  const trace = toTraceItems(items)
  if (trace.length === 0) return

  const apiKey = (process.env[API_KEY_ENV] ?? '').trim()
  const timeoutMs = Number(process.env[TIMEOUT_MS_ENV] ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS)
  try {
    await fetch(`${base}/threads/${threadId}/ingest-trace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ trace, merge: true }),
      signal: controller.signal
    })
  } catch {
    // fail-open: the DAG is best-effort; never break the turn.
  } finally {
    clearTimeout(timer)
  }
}
