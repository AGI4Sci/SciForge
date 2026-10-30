import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { siyuanDocumentCreateContract } from '../editor-contract.js'
import { renderSciForgeTaskSummary } from '../summary.js'

type CompletedTurn = { runtimeId: string; threadId: string; turnId: string; occurredAt: string; attempt?: number }

/** Durable pending deliveries are retried on startup and the next completed task. */
export function activateTaskSummaries(context: DomainMainRuntimeLifecycleContext) {
  const directory = join(context.userDataDir, 'siyuan-pending-summaries')
  let stopped = false
  let queue = Promise.resolve()
  const persist = async (file: string, event: CompletedTurn) => {
    await writeFile(`${file}.tmp`, JSON.stringify(event), 'utf8')
    await rename(`${file}.tmp`, file)
  }
  const flush = async () => {
    for (const name of await readdir(directory)) {
      if (stopped || context.signal.aborted) return
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
      try {
        const event: CompletedTurn = JSON.parse(await readFile(join(directory, name), 'utf8'))
        const detail = await context.agentThreads.read({ runtimeId: event.runtimeId, threadId: event.threadId })
        const turn = detail.turns.find((candidate) => candidate.id === event.turnId)
        const result = [...(turn?.messages ?? [])].reverse().find((message) => message.kind === 'assistant-final')?.text
        if (!result?.trim()) continue
        const title = turn?.messages.find((message) => message.kind === 'user-message')?.text.split(/\r?\n/u)[0]?.trim().slice(0, 120) || 'SciForge 本轮记录'
        const markdown = renderSciForgeTaskSummary({ title, goal: turn?.messages.find((message) => message.kind === 'user-message')?.text,
          result, completedAt: event.occurredAt }) +
          `\n---\n轮次：${event.turnId}\n会话：${event.threadId}\n运行时：${event.runtimeId}\n`
        const attempt = (event.attempt ?? 0) + 1
        await persist(join(directory, name), { ...event, attempt })
        // Broker failures are memoized per invocation. Each reconciliation gets
        // its own attempt identity; the document writer owns durable write-once semantics.
        await context.capabilities.invoke(siyuanDocumentCreateContract, {
          title, markdown, notebookName: 'SciForge 工作总结',
          path: `/SciForge/${title.replace(/[\\/:*?"<>|]/gu, '_')}-${name.slice(0, 16)}`
        }, { idempotencyKey: `siyuan-summary:${name.slice(0, -5)}:${attempt}`, signal: context.signal })
        await unlink(join(directory, name))
        context.log({ level: 'info', message: 'Task summary saved to local SiYuan.' })
      } catch {
        context.log({ level: 'warn', message: 'SiYuan summary remains pending; will reconcile on the next task or startup.' })
      }
    }
  }
  const enqueue = (event?: CompletedTurn) => {
    queue = queue.then(async () => {
      if (!await context.enablement.isEnabled()) return
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
    }).catch(() => { context.log({ level: 'warn', message: 'Could not queue SiYuan task summary.' }) })
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
