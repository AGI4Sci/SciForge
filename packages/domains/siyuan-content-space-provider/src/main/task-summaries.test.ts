import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { DomainMainRuntimeLifecycleContext, DomainMainTurnLifecycleEvent } from '@sciforge/domain-sdk/host'
import { activateTaskSummaries } from './task-summaries.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const completed = { kind: 'after-turn', state: 'completed', runtimeId: 'codex', threadId: 'thread',
  turnId: 'turn', occurredAt: '2026-10-18T12:00:00.000Z' } as DomainMainTurnLifecycleEvent

async function fixture() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'siyuan-summary-'))
  roots.push(userDataDir)
  let listener: (event: DomainMainTurnLifecycleEvent) => unknown = () => undefined
  const invoke = vi.fn<(contract: unknown, input: unknown, options: unknown) => Promise<{ id: string; url: string }>>()
    .mockResolvedValue({ id: '20261018120000-abcdefg', url: 'http://localhost/' })
  const log = vi.fn<(entry: { level: string; message: string }) => void>()
  const threads = vi.fn(async () => ({ turns: [{ id: 'turn', messages: [
      { kind: 'user-message', text: '分析实验结果' },
      { kind: 'assistant-progress', text: '还在分析' },
      { kind: 'assistant-final', text: '最终结论及文件路径' }
    ] }] }))
  const context = {
    userDataDir, signal: new AbortController().signal,
    enablement: { isEnabled: () => true }, log,
    turnEvents: { subscribe: (next: typeof listener) => { listener = next; return vi.fn() } },
    agentThreads: { read: threads }, capabilities: { invoke }
  }
  return { context: context as unknown as DomainMainRuntimeLifecycleContext,
    invoke, threads, log, emit: (event: DomainMainTurnLifecycleEvent) => listener(event) }
}

it('archives only successful turns with a final response, through the capability broker', async () => {
  const f = await fixture()
  const dispose = activateTaskSummaries(f.context)
  f.emit({ ...completed, state: 'failed' } as DomainMainTurnLifecycleEvent)
  f.emit({ ...completed, state: 'cancelled' } as DomainMainTurnLifecycleEvent)
  f.emit({ ...completed, kind: 'after-persistent-child-turn' } as DomainMainTurnLifecycleEvent)
  f.emit(completed)
  await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1))
  await dispose()
  expect(f.invoke.mock.calls[0]).toMatchObject([
    { actionId: 'siyuan.document.create', effect: 'external-write' },
    { title: '分析实验结果', notebookName: 'SciForge 工作总结', markdown: expect.stringContaining('最终结论及文件路径') },
    { idempotencyKey: expect.stringContaining('siyuan-summary:') }
  ])
  expect(JSON.stringify(f.invoke.mock.calls)).not.toContain('还在分析')
  expect(await readdir(join(f.context.userDataDir, 'siyuan-pending-summaries'))).toEqual([])
})

it('retains failed saves and retries the durable pending record on startup', async () => {
  const f = await fixture()
  f.invoke.mockRejectedValueOnce(new Error('kernel unavailable'))
  let dispose = activateTaskSummaries(f.context)
  f.emit(completed)
  await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1))
  await dispose()
  expect(await readdir(join(f.context.userDataDir, 'siyuan-pending-summaries'))).toHaveLength(1)
  dispose = activateTaskSummaries(f.context)
  await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(2))
  await dispose()
  expect(await readdir(join(f.context.userDataDir, 'siyuan-pending-summaries'))).toEqual([])
  expect(f.invoke.mock.calls[0]?.[2]).not.toEqual(f.invoke.mock.calls[1]?.[2])
})

it('does not queue or archive an unscoped chat when managed project mode requires explicit attribution', async () => {
  const f = await fixture()
  const dispose = activateTaskSummaries(f.context, async () => false)
  f.emit(completed)
  await dispose()
  expect(f.invoke).not.toHaveBeenCalled()
  expect(f.context.agentThreads.read).not.toHaveBeenCalled()
  expect(await readdir(f.context.userDataDir)).toEqual([])
})

it('reports why a delivery failed and does not replay the same record on the next completed turn', async () => {
  const f = await fixture()
  f.invoke.mockRejectedValue(Object.assign(new Error('尚未配置思源服务地址：请在本页设置中填写，或设置 SIYUAN_BASE_URL。'),
    { code: 'not_configured', category: 'rejected', retryable: false }))
  const dispose = activateTaskSummaries(f.context)
  f.emit(completed)
  await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1))
  const pending = join(f.context.userDataDir, 'siyuan-pending-summaries')
  await vi.waitFor(async () => expect(JSON.parse(await readFile(join(pending, (await readdir(pending))[0]!), 'utf8')).lastCode).toBe('not_configured'))

  const warnings = f.log.mock.calls.map(([entry]) => entry).filter((entry) => entry.level === 'warn')
  // One aggregated line that carries the code and the text a person can act on,
  // not a bare "remains pending".
  expect(warnings).toHaveLength(1)
  expect(warnings[0]!.message).toContain('not_configured ×1')
  expect(warnings[0]!.message).toContain('Cloud notes is not configured.')

  const stored = JSON.parse(await readFile(join(pending, (await readdir(pending))[0]!), 'utf8'))
  expect(stored.nextAttemptAt).toBeGreaterThan(Date.now() + 60_000)

  // The wait is persisted, so the next completed turn in this session must not
  // re-invoke the broker for a record that cannot succeed yet.
  f.emit(completed)
  await vi.waitFor(async () => expect(await readdir(pending)).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(f.invoke).toHaveBeenCalledTimes(1)
  await dispose()
})

it('keeps generic broker failures generic instead of interpreting arbitrary error prose', async () => {
  const f = await fixture()
  f.invoke.mockRejectedValue(Object.assign(new Error('Handler for siyuan.document.create failed: unauthorized: 思源服务拒绝了访问'),
    { code: 'handler_failed', category: 'failed', retryable: false }))
  const dispose = activateTaskSummaries(f.context)
  f.emit(completed)
  await vi.waitFor(() => {
    const warnings = f.log.mock.calls.map(([entry]) => entry.message)
    expect(warnings.some((message) => message.includes('unknown ×1'))).toBe(true)
  })
  await dispose()
})

it('gives a turn with no final response a reason instead of retrying it silently forever', async () => {
  const f = await fixture()
  f.threads.mockResolvedValueOnce({ turns: [{ id: 'turn', messages: [{ kind: 'user-message', text: '分析实验结果' }] }] })
  const dispose = activateTaskSummaries(f.context)
  f.emit(completed)
  await vi.waitFor(() => {
    const warnings = f.log.mock.calls.map(([entry]) => entry.message)
    expect(warnings.some((message) => message.includes('no_final_result'))).toBe(true)
  })
  await dispose()
  expect(f.invoke).not.toHaveBeenCalled()
})

it('does not expose provider credential URLs, key markers or control text in summary logs', async () => {
  const f = await fixture()
  const secret = 'SUMMARY_PRIVATE_SENTINEL https://user:secret@example.invalid/ -----BEGIN PRIVATE KEY----- \n\u0000'
  f.invoke.mockRejectedValue(Object.assign(new Error(secret), {code:'not_configured',retryable:false}))
  const dispose = activateTaskSummaries(f.context)
  f.emit(completed)
  await vi.waitFor(() => expect(f.log.mock.calls.some(([entry])=>entry.level==='warn')).toBe(true))
  await dispose()
  const logs = JSON.stringify(f.log.mock.calls)
  expect(logs).toContain('not_configured')
  for (const marker of ['SUMMARY_PRIVATE_SENTINEL','user:secret','BEGIN PRIVATE KEY']) expect(logs).not.toContain(marker)
})
