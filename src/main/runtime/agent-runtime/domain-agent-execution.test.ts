import { describe, expect, it, vi } from 'vitest'
import type { DomainMainTurnLifecycleEvent } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeId, AgentRuntimeThreadPage } from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeHost } from './host'
import { createDomainAgentExecutionHost } from './domain-agent-execution'

type ExecutionRuntimeHost = Pick<
  AgentRuntimeHost,
  | 'startThread'
  | 'startTurn'
  | 'interruptTurn'
  | 'reclaimEphemeralThread'
  | 'readThreadStatus'
  | 'readThreadPage'
  | 'subscribeTurnLifecycle'
>

function createHarness(options: Readonly<{
  terminalState?: 'completed' | 'failed' | 'cancelled' | null
  deleteError?: Error
  interruptError?: Error
  unsubscribeError?: Error
}> = {}) {
  const listeners = new Set<(event: DomainMainTurnLifecycleEvent) => void | Promise<void>>()
  let threadSequence = 0
  const activeThreads = new Set<string>()
  const activeTurns = new Set<string>()
  const startThread = vi.fn(async (input) => {
    const id = `thread-${++threadSequence}`
    activeThreads.add(id)
    return {
      id,
      runtimeId: input.runtimeId,
      title: 'Domain execution',
      updatedAt: '2026-08-14T00:00:00.000Z'
    }
  })
  const startTurn = vi.fn(async (input) => {
    const turnId = `turn-${threadSequence}`
    activeTurns.add(turnId)
    if (options.terminalState) {
      const event: DomainMainTurnLifecycleEvent = {
        kind: 'after-turn',
        state: options.terminalState,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        turnId,
        occurredAt: '2026-08-14T00:00:01.000Z'
      }
      for (const listener of listeners) await listener(event)
      activeTurns.delete(turnId)
    }
    return { threadId: input.threadId, turnId }
  })
  const interruptTurn = vi.fn(async (input) => {
    if (options.interruptError) throw options.interruptError
    activeTurns.delete(input.turnId)
  })
  const reclaimEphemeralThread = vi.fn(async (input) => {
    if (options.deleteError) throw options.deleteError
    activeThreads.delete(input.threadId)
  })
  const host: ExecutionRuntimeHost = {
    startThread,
    startTurn,
    interruptTurn,
    reclaimEphemeralThread,
    readThreadStatus: vi.fn(async (input) => ({
      id: input.threadId,
      runtimeId: input.runtimeId,
      status: options.terminalState ?? 'running',
      latestSeq: 1,
      latestTurnId: `turn-${threadSequence}`,
      latestTurnStatus: options.terminalState ?? 'running'
    })),
    readThreadPage: vi.fn(async (input): Promise<AgentRuntimeThreadPage> => ({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      latestSeq: 2,
      turns: [{
        id: `turn-${threadSequence}`,
        threadId: input.threadId,
        status: 'completed',
        items: [{ id: 'assistant-1', kind: 'assistant_message', text: 'done' }]
      }],
      nextCursor: null
    })),
    subscribeTurnLifecycle: vi.fn((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (options.unsubscribeError) throw options.unsubscribeError
      }
    })
  }
  return {
    execution: createDomainAgentExecutionHost({
      agentRuntimeHost: host,
      resolveRuntimeId: async (): Promise<AgentRuntimeId> => 'codex',
      pollIntervalMs: 5
    }),
    host,
    activeThreads,
    activeTurns,
    listeners,
    startThread,
    interruptTurn,
    reclaimEphemeralThread
  }
}

const request = {
  prompt: 'Do one thing.',
  workspaceRoot: 'C:\\workspace',
  interaction: 'background' as const,
  mode: 'agent' as const
}

describe('createDomainAgentExecutionHost', () => {
  it('keeps persistent execution available through run', async () => {
    const harness = createHarness({ terminalState: 'completed' })

    await expect(harness.execution.run(request)).resolves.toEqual({
      threadId: 'thread-1',
      text: 'done'
    })
    expect(harness.startThread).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: false }))
    expect(harness.reclaimEphemeralThread).not.toHaveBeenCalled()
    expect(harness.listeners.size).toBe(0)
  })

  it('deletes all thread-scoped state after a successful ephemeral execution', async () => {
    const harness = createHarness({ terminalState: 'completed' })

    await expect(harness.execution.runEphemeral(request)).resolves.toEqual({
      threadId: 'thread-1',
      text: 'done'
    })
    expect(harness.startThread).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }))
    expect(harness.interruptTurn).not.toHaveBeenCalled()
    expect(harness.reclaimEphemeralThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'thread-1' })
    expect(harness.activeThreads.size).toBe(0)
    expect(harness.activeTurns.size).toBe(0)
    expect(harness.listeners.size).toBe(0)
  })

  it('preserves the business failure while deleting ephemeral state', async () => {
    const harness = createHarness({ terminalState: 'failed' })

    await expect(harness.execution.runEphemeral(request)).rejects.toThrow('Agent execution failed.')
    expect(harness.reclaimEphemeralThread).toHaveBeenCalledTimes(1)
    expect(harness.activeThreads.size).toBe(0)
    expect(harness.listeners.size).toBe(0)
  })

  it('awaits turn interruption before deleting an aborted ephemeral thread', async () => {
    const harness = createHarness({ terminalState: null })
    const controller = new AbortController()
    const execution = harness.execution.runEphemeral({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(harness.activeTurns.size).toBe(1))

    controller.abort(new Error('stop requested'))

    await expect(execution).rejects.toThrow('stop requested')
    expect(harness.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({ discard: true }))
    expect(harness.interruptTurn.mock.invocationCallOrder[0]).toBeLessThan(
      harness.reclaimEphemeralThread.mock.invocationCallOrder[0]
    )
    expect(harness.activeThreads.size).toBe(0)
    expect(harness.activeTurns.size).toBe(0)
    expect(harness.listeners.size).toBe(0)
  })

  it('preserves a timeout reason while cleaning the unfinished turn', async () => {
    const harness = createHarness({ terminalState: null })
    const signal = AbortSignal.timeout(10)

    const error = await harness.execution.runEphemeral({ ...request, signal }).catch((caught) => caught)

    expect(error).toMatchObject({ name: 'TimeoutError' })
    expect(harness.interruptTurn).toHaveBeenCalledTimes(1)
    expect(harness.reclaimEphemeralThread).toHaveBeenCalledTimes(1)
    expect(harness.activeThreads.size).toBe(0)
    expect(harness.activeTurns.size).toBe(0)
    expect(harness.listeners.size).toBe(0)
  })

  it('reports cleanup failure after a successful business result', async () => {
    const harness = createHarness({
      terminalState: 'completed',
      deleteError: new Error('delete failed')
    })

    await expect(harness.execution.runEphemeral(request)).rejects.toThrow(
      'Agent execution succeeded but cleanup failed: delete failed'
    )
    expect(harness.listeners.size).toBe(0)
  })

  it('keeps the primary failure first when cleanup also fails', async () => {
    const primary = 'Agent execution failed.'
    const harness = createHarness({
      terminalState: 'failed',
      deleteError: new Error('delete failed')
    })

    const error = await harness.execution.runEphemeral(request).catch((caught) => caught)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.message).toBe(`${primary} Cleanup also failed: delete failed`)
    expect(error.cause).toMatchObject({ message: primary })
    expect(error.errors[0]).toMatchObject({ message: primary })
    expect(error.errors[1]).toMatchObject({ message: 'delete failed' })
  })

  it('returns to the resource baseline across repeated ephemeral executions', async () => {
    const harness = createHarness({ terminalState: 'completed' })

    for (let index = 0; index < 20; index += 1) {
      await harness.execution.runEphemeral({ ...request, prompt: `Run ${index}` })
      expect(harness.activeThreads.size).toBe(0)
      expect(harness.activeTurns.size).toBe(0)
      expect(harness.listeners.size).toBe(0)
    }
    expect(harness.reclaimEphemeralThread).toHaveBeenCalledTimes(20)
  })

  it('awaits persistent abort interruption without reclaiming the thread', async () => {
    const harness = createHarness({ terminalState: null })
    const controller = new AbortController()
    const execution = harness.execution.run({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(harness.activeTurns.size).toBe(1))

    controller.abort(new Error('persistent stop'))

    await expect(execution).rejects.toThrow('persistent stop')
    expect(harness.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({ discard: false }))
    expect(harness.reclaimEphemeralThread).not.toHaveBeenCalled()
    expect(harness.activeThreads).toEqual(new Set(['thread-1']))
  })

  it('awaits persistent timeout interruption without reclaiming the thread', async () => {
    const harness = createHarness({ terminalState: null })

    const error = await harness.execution.run({ ...request, signal: AbortSignal.timeout(10) })
      .catch((caught) => caught)

    expect(error).toMatchObject({ name: 'TimeoutError' })
    expect(harness.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({ discard: false }))
    expect(harness.reclaimEphemeralThread).not.toHaveBeenCalled()
    expect(harness.activeThreads).toEqual(new Set(['thread-1']))
  })

  it('keeps the persistent business error first when awaited interrupt also fails', async () => {
    const harness = createHarness({
      terminalState: null,
      interruptError: new Error('interrupt failed')
    })
    const controller = new AbortController()
    const execution = harness.execution.run({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(harness.activeTurns.size).toBe(1))
    controller.abort(new Error('persistent stop'))

    const error = await execution.catch((caught) => caught)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.cause).toMatchObject({ message: 'persistent stop' })
    expect(error.errors).toEqual([
      expect.objectContaining({ message: 'persistent stop' }),
      expect.objectContaining({ message: 'interrupt failed' })
    ])
  })
})
