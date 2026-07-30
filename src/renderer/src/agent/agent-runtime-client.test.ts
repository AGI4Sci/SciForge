import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentRuntimeClient } from './agent-runtime-client'
import type { AgentRuntimeEvent } from '@shared/agent-runtime-contract'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('agentRuntimeClient', () => {
  it('uses only the neutral agentRuntime preload bridge for requests', async () => {
    const listThreads = vi.fn(async () => [
      { id: 'thread-1', runtimeId: 'codex', title: 'One', updatedAt: '2026-06-11T00:00:00.000Z' }
    ])
    const forbiddenDirectCall = vi.fn()
    const codexListThreads = vi.fn()
    vi.stubGlobal('window', {
      sciforge: {
        agentRuntime: {
          listThreads
        },
        forbiddenDirectCall: forbiddenDirectCall,
        codex: {
          listThreads: codexListThreads
        }
      }
    })

    await expect(agentRuntimeClient.listThreads({ runtimeId: 'codex', limit: 1, includeSide: true })).resolves.toEqual([
      { id: 'thread-1', runtimeId: 'codex', title: 'One', updatedAt: '2026-06-11T00:00:00.000Z' }
    ])

    expect(listThreads).toHaveBeenCalledWith({ runtimeId: 'codex', limit: 1, includeSide: true })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(codexListThreads).not.toHaveBeenCalled()
  })

  it('resolves approvals and user input through the neutral preload bridge', async () => {
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const forkThread = vi.fn(async () => ({
      id: 'forked-thread',
      runtimeId: 'sciforge',
      title: 'Forked',
      updatedAt: '2026-06-11T00:00:00.000Z'
    }))
    const resumeSession = vi.fn(async () => ({ threadId: 'resumed-thread', sessionId: 'session-1' }))
    const updateThreadRelation = vi.fn(async () => undefined)
    const forbiddenDirectCall = vi.fn()
    const codexStartTurn = vi.fn()
    vi.stubGlobal('window', {
      sciforge: {
        agentRuntime: {
          renameThread,
          deleteThread,
          compactThread,
          forkThread,
          resumeSession,
          updateThreadRelation,
          resolveApproval,
          resolveUserInput
        },
        forbiddenDirectCall: forbiddenDirectCall,
        codex: {
          startTurn: codexStartTurn,
          renameThread: vi.fn()
        }
      }
    })

    await expect(agentRuntimeClient.renameThread({
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Renamed'
    })).resolves.toBeUndefined()
    await expect(agentRuntimeClient.deleteThread({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toBeUndefined()
    await expect(agentRuntimeClient.compactThread({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      reason: 'manual'
    })).resolves.toBeUndefined()
    await expect(agentRuntimeClient.forkThread({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })).resolves.toEqual({
      id: 'forked-thread',
      runtimeId: 'sciforge',
      title: 'Forked',
      updatedAt: '2026-06-11T00:00:00.000Z'
    })
    await expect(agentRuntimeClient.resumeSession({
      runtimeId: 'sciforge',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(agentRuntimeClient.updateThreadRelation({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'primary'
    })).resolves.toBeUndefined()
    await expect(agentRuntimeClient.resolveApproval({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })).resolves.toBeUndefined()
    await expect(agentRuntimeClient.resolveUserInput({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'input-1',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })).resolves.toBeUndefined()

    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Renamed'
    })
    expect(deleteThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      reason: 'manual'
    })
    expect(forkThread).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(resumeSession).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    expect(resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'input-1',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(codexStartTurn).not.toHaveBeenCalled()
  })

  it('subscribes to neutral runtime events and cleans up listeners on abort', async () => {
    const listeners: Array<(payload: { streamId: string; event: AgentRuntimeEvent }) => void> = []
    const offEvent = vi.fn()
    const offEnd = vi.fn()
    const offError = vi.fn()
    const subscribeEvents = vi.fn(async () => ({ streamId: 'stream-1' }))
    const stopEvents = vi.fn(async () => true)
    vi.stubGlobal('window', {
      sciforge: {
        agentRuntime: {
          subscribeEvents,
          stopEvents,
          onEvent: vi.fn((handler) => {
            listeners.push(handler)
            return offEvent
          }),
          onEnd: vi.fn(() => offEnd),
          onError: vi.fn(() => offError)
        }
      }
    })
    const ac = new AbortController()
    const seen: AgentRuntimeEvent[] = []
    const workspaceLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'remote-session-1',
      path: '/cluster/project'
    }

    const subscription = agentRuntimeClient.subscribeEvents('thread-1', 4, (event) => {
      seen.push(event)
      ac.abort()
    }, ac.signal, 'codex', workspaceLocator)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    listeners[0]?.({
      streamId: 'stream-1',
      event: { kind: 'assistant_delta', threadId: 'thread-1', itemId: 'assistant-1', text: 'hi', seq: 5 }
    })
    await subscription

    expect(subscribeEvents).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceLocator,
      sinceSeq: 4,
      streamId: expect.stringMatching(/^agent-runtime-/u)
    })
    expect(seen).toEqual([
      { kind: 'assistant_delta', threadId: 'thread-1', itemId: 'assistant-1', text: 'hi', seq: 5 }
    ])
    expect(stopEvents).toHaveBeenCalledWith('stream-1')
    expect(offEvent).toHaveBeenCalled()
    expect(offEnd).toHaveBeenCalled()
    expect(offError).toHaveBeenCalled()
  })
})
