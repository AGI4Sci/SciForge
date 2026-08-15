import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainMainRuntimeLifecycleContext,
  DomainMainTurnLifecycleEvent
} from '@sciforge/domain-sdk/host'
import {
  GitCheckpointRuntime
} from './runtime.js'
import type { GitCheckpointService } from './service.js'

test('runtime captures enabled before/terminal-after turn events once through lifecycle subscription', async () => {
  const created: unknown[] = []
  const logs: unknown[] = []
  let listener:
    | ((event: DomainMainTurnLifecycleEvent) => void | Promise<void>)
    | undefined
  let enablementListener: ((enabled: boolean) => void) | undefined
  let enabled = true
  const runtime = new GitCheckpointRuntime({
    createService: () => ({
      create: async (input: unknown) => {
        created.push(input)
        return { ok: true, value: {} }
      }
    }) as unknown as GitCheckpointService
  })
  const context = {
    userDataDir: '/user-data',
    appRoot: '/app',
    environment: {},
    agentThreads: {},
    capabilities: {},
    modelAccess: {},
    owner: { moduleId: 'sciforge.git-checkpoints', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    enablement: {
      isEnabled: () => enabled,
      subscribe: (next: (enabled: boolean) => void) => {
        enablementListener = next
        return () => undefined
      }
    },
    log: (entry: unknown) => logs.push(entry),
    turnEvents: {
      subscribe: (next: typeof listener) => {
        listener = next
        return () => undefined
      }
    }
  } as unknown as DomainMainRuntimeLifecycleContext
  const dispose = await runtime.activate(context)
  const before = {
    kind: 'before-turn',
    state: 'starting',
    issuerEpoch: 'issuer-epoch-1',
    deliveryAttemptId: 'attempt-1',
    deliveryAttemptOrdinal: 1,
    boundaryLeaseId: 'turn-boundary:attempt-1',
    clientDirectiveId: 'directive-1',
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    occurredAt: '2026-07-28T00:00:00.000Z'
  } as const
  await listener?.(before)
  await listener?.(before)
  await listener?.({
    ...before,
    kind: 'after-turn',
    turnId: 'turn-1',
    state: 'completed',
    occurredAt: '2026-07-28T00:01:00.000Z'
  })
  await listener?.({
    ...before,
    kind: 'after-turn',
    turnId: 'turn-1',
    state: 'running',
    occurredAt: '2026-07-28T00:00:30.000Z'
  } as unknown as DomainMainTurnLifecycleEvent)
  enabled = false
  enablementListener?.(false)
  await listener?.({
    ...before,
    occurredAt: '2026-07-28T00:02:00.000Z'
  })

  assert.equal(created.length, 2)
  assert.deepEqual(
    created.map((input) => (input as { phase: string }).phase),
    ['before-turn', 'after-turn']
  )
  assert.deepEqual(logs, [])
  await dispose()
  assert.throws(() => runtime.service(), /not active/u)
})

void ({} as DomainMainRuntimeLifecycleContext)

test('runtime rejects hosts without the generic turn event source', async () => {
  const runtime = new GitCheckpointRuntime({
    createService: () => ({}) as GitCheckpointService
  })
  const context = {
    userDataDir: '/user-data',
    appRoot: '/app',
    environment: {},
    agentThreads: {},
    capabilities: {},
    modelAccess: {},
    owner: { moduleId: 'sciforge.git-checkpoints', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    enablement: {
      isEnabled: () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  } as unknown as DomainMainRuntimeLifecycleContext

  await assert.rejects(runtime.activate(context), /turn lifecycle event source/u)
})
