import { mkdtemp, readdir, rm } from 'node:fs/promises'
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
  const context = {
    userDataDir, signal: new AbortController().signal,
    enablement: { isEnabled: () => true }, log: vi.fn(),
    turnEvents: { subscribe: (next: typeof listener) => { listener = next; return vi.fn() } },
    agentThreads: { read: vi.fn(async () => ({ turns: [{ id: 'turn', messages: [
      { kind: 'user-message', text: '分析实验结果' },
      { kind: 'assistant-progress', text: '还在分析' },
      { kind: 'assistant-final', text: '最终结论及文件路径' }
    ] }] })) }, capabilities: { invoke }
  }
  return { context: context as unknown as DomainMainRuntimeLifecycleContext,
    invoke, emit: (event: DomainMainTurnLifecycleEvent) => listener(event) }
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
