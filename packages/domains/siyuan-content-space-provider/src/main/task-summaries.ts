import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { siyuanDocumentCreateContract } from '../editor-contract.js'
import { renderSciForgeTaskSummary } from '../summary.js'

type CompletedTurn = { runtimeId: string; threadId: string; turnId: string; occurredAt: string; attempt?: number }

/** A pending record plus what the last delivery attempt taught us. */
type PendingSummary = CompletedTurn & {
  /** Persisted failure count; first startup reconciliation explicitly bypasses the wait. */
  failures?: number
  /** Epoch ms before which this record is not retried. */
  nextAttemptAt?: number
  /** Last failure code, so the reason is still visible after a restart. */
  lastCode?: string
}

const RETRY_BASE_MS = 60_000
const RETRY_MAX_MS = 30 * 60_000
/**
 * Configuration failures cannot notify this domain when a person fixes them, so
 * they are retried far sooner than transient ones — just never once per flush,
 * which is what used to replay every pending record on every completed turn.
 */
const BLOCKED_RETRY_MS = 2 * 60_000
const NO_FINAL_RESULT = 'no_final_result'

/**
 * Codes whose cause is a person, a configuration or an unknown write outcome.
 * Retrying them on every turn cannot fix them and, for `outcome_unknown`, may
 * write the same document twice.
 */
const blockedCodes: ReadonlySet<string> = new Set([
  'not_configured', 'invalid_configuration', 'invalid_input', 'unauthorized',
  'secure_storage_unavailable', 'document_not_found', 'outcome_unknown', NO_FINAL_RESULT
])

/** Every code this domain's own client throws, so a wrapped rejection can be named. */
const domainFailureCodes = Object.freeze([
  'not_configured', 'invalid_configuration', 'invalid_input', 'unauthorized', 'secure_storage_unavailable',
  'provider_unavailable', 'provider_contract_violation', 'document_not_found', 'api_error', 'outcome_unknown'
])

/** One failure identity, bounded to a single log line. */
function describeFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const outer = typeof details.code === 'string' && domainFailureCodes.includes(details.code) ? details.code : 'unknown'
  // Only an allowlisted code is diagnostic identity. Provider prose may contain
  // credentials, URLs, private paths or arbitrary control characters.
  const code = outer
  const reasons: Readonly<Record<string, string>> = {
    not_configured: 'Cloud notes is not configured.', invalid_configuration: 'Cloud notes configuration is invalid.',
    invalid_input: 'The summary request was rejected.', unauthorized: 'Cloud notes authorization is unavailable.',
    secure_storage_unavailable: 'Secure credential storage is unavailable.', provider_unavailable: 'Cloud notes is temporarily unavailable.',
    provider_contract_violation: 'Cloud notes returned an unsupported response.', document_not_found: 'The target document is unavailable.',
    api_error: 'Cloud notes rejected the operation.', outcome_unknown: 'The previous write outcome is unknown.'
  }
  return { code, message: reasons[code] ?? 'Summary delivery failed; check the configured service and access.',
    retryable: details.retryable === true || code === 'provider_unavailable' }
}

/** How long a record waits after `failures` consecutive failures. */
function retryDelay(code: string, failures: number, retryable: boolean): number {
  if (!retryable || blockedCodes.has(code)) return BLOCKED_RETRY_MS
  return Math.min(RETRY_BASE_MS * 2 ** Math.min(failures - 1, 5), RETRY_MAX_MS)
}

/** Durable pending deliveries are retried on startup and the next completed task. */
export function activateTaskSummaries(context: DomainMainRuntimeLifecycleContext, canArchive: () => Promise<boolean> = async () => true) {
  const directory = join(context.userDataDir, 'siyuan-pending-summaries')
  let stopped = false
  let queue = Promise.resolve()
  // A restart is itself a signal that something changed, so the first flush of a
  // session ignores the persisted wait; later flushes honour it.
  let started = false
  const persist = async (file: string, event: PendingSummary) => {
    await writeFile(`${file}.tmp`, JSON.stringify(event), 'utf8')
    await rename(`${file}.tmp`, file)
  }
  const defer = async (file: string, event: PendingSummary, failure: { code: string; message: string; retryable: boolean }) => {
    const failures = (event.failures ?? 0) + 1
    const wait = retryDelay(failure.code, failures, failure.retryable)
    await persist(file, { ...event, failures, lastCode: failure.code, nextAttemptAt: Date.now() + wait })
    return wait
  }
  const flush = async () => {
    const firstOfSession = !started
    started = true    // One line per flush instead of one per pending record: five records used to
    // mean five identical warnings, and none of them said why.
    const pending = new Map<string, { count: number; message: string; wait: number }>()
    const note = (failure: { code: string; message: string }, wait: number) => {
      const entry = pending.get(failure.code)
      if (entry) { entry.count += 1; entry.wait = Math.min(entry.wait, wait); return }
      pending.set(failure.code, { count: 1, message: failure.message, wait })
    }
    for (const name of await readdir(directory)) {
      if (stopped || context.signal.aborted) return
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
      const file = join(directory, name)
      let event: PendingSummary
      try { event = JSON.parse(await readFile(file, 'utf8')) as PendingSummary }
      catch (error) {
        // An unreadable record never becomes readable by retrying it.
        note(describeFailure(error), RETRY_MAX_MS)
        continue
      }
      if (!firstOfSession && (event.nextAttemptAt ?? 0) > Date.now()) continue
      const attempt = (event.attempt ?? 0) + 1
      try {
        const detail = await context.agentThreads.read({ runtimeId: event.runtimeId, threadId: event.threadId })
        const turn = detail.turns.find((candidate) => candidate.id === event.turnId)
        const result = [...(turn?.messages ?? [])].reverse().find((message) => message.kind === 'assistant-final')?.text
        if (!result?.trim()) {
          const failure = { code: NO_FINAL_RESULT, message: 'The turn has no final assistant message yet', retryable: false }
          note(failure, await defer(file, event, failure))
          continue
        }
        const title = turn?.messages.find((message) => message.kind === 'user-message')?.text.split(/\r?\n/u)[0]?.trim().slice(0, 120) || 'SciForge 本轮记录'
        const markdown = renderSciForgeTaskSummary({ title, goal: turn?.messages.find((message) => message.kind === 'user-message')?.text,
          result, completedAt: event.occurredAt }) +
          `\n---\n轮次：${event.turnId}\n会话：${event.threadId}\n运行时：${event.runtimeId}\n`
        await persist(file, { ...event, attempt })
        // Broker failures are memoized per invocation. Each reconciliation gets
        // its own attempt identity; the document writer owns durable write-once semantics.
        await context.capabilities.invoke(siyuanDocumentCreateContract, {
          title, markdown, notebookName: 'SciForge 工作总结',
          path: `/SciForge/${title.replace(/[\\/:*?"<>|]/gu, '_')}-${name.slice(0, 16)}`
        }, { idempotencyKey: `siyuan-summary:${name.slice(0, -5)}:${attempt}`, signal: context.signal })
        await unlink(file)
        context.log({ level: 'info', message: 'Task summary saved to local SiYuan.' })
      } catch (error) {
        const failure = describeFailure(error)
        note(failure, await defer(file, { ...event, attempt }, failure))
      }
    }
    if (pending.size === 0 || stopped || context.signal.aborted) return
    const total = [...pending.values()].reduce((sum, entry) => sum + entry.count, 0)
    const parts = [...pending.entries()].map(([code, entry]) =>
      `${code} ×${entry.count}: ${entry.message} (retry in ${Math.max(1, Math.round(entry.wait / 1000))}s)`)
    context.log({ level: 'warn', message: `SiYuan summary delivery pending for ${total} record(s); ${parts.join(' | ')}` })
  }
  const enqueue = (event?: CompletedTurn) => {
    queue = queue.then(async () => {
      if (!await context.enablement.isEnabled() || !await canArchive()) return
      await mkdir(directory, { recursive: true })
      if (event) {
        const key = createHash('sha256').update(JSON.stringify([event.runtimeId, event.threadId, event.turnId])).digest('hex')
        const file = join(directory, `${key}.json`)
        try { await readFile(file, 'utf8') }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await persist(file, event)
        }
      }
      await flush()
    }).catch((error: unknown) => {
      const failure = describeFailure(error)
      context.log({ level: 'warn', message: `Could not queue SiYuan task summary: ${failure.code}: ${failure.message}` })
    })
  }
  const unsubscribe = context.turnEvents?.subscribe((event) => {
    if (event.kind === 'after-turn' && event.state === 'completed') enqueue({
      runtimeId: event.runtimeId, threadId: event.threadId, turnId: event.turnId, occurredAt: event.occurredAt
    })
  })
  enqueue()
  return async () => {
    stopped = true
    await unsubscribe?.()
    await queue
  }
}
