import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeCapabilities,
  type AgentRuntimeEvent
} from '@shared/agent-runtime-contract'
import { AgentRuntimeProvider } from './agent-runtime-provider'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

function settings(activeAgentRuntime: AgentRuntimeId): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function makeSink(): ThreadEventSink {
  return {
    onSeq: vi.fn(),
    onDeltas: vi.fn(),
    onUserMessage: vi.fn(),
    onTool: vi.fn(),
    onCompaction: vi.fn(),
    onReview: vi.fn(),
    onApproval: vi.fn(),
    onUserInput: vi.fn(),
    onUserInputStatus: vi.fn(),
    onRuntimeStatus: vi.fn(),
    onRuntimeError: vi.fn(),
    onGoal: vi.fn(),
    onTodos: vi.fn(),
    onTurnComplete: vi.fn(),
    onError: vi.fn(),
    onUsage: vi.fn()
  }
}

function capabilities(runtimeId: AgentRuntimeId): AgentRuntimeCapabilities {
  const transport = runtimeId === 'sciforge' ? 'http_sse' : runtimeId === 'claude' ? 'cli_process' : 'jsonrpc_stdio'
  return {
    ...createDefaultAgentRuntimeCapabilities({
      runtimeId,
      transport
    }),
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: runtimeId === 'sciforge' ? 'sse' : 'ipc'
    },
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: runtimeId === 'sciforge' ? 'full_runtime_text' : 'summary',
      source: runtimeId === 'sciforge' ? 'model' : 'runtime_summary'
    },
    tools: {
      ...createDefaultAgentRuntimeCapabilities({ runtimeId, transport }).tools,
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      diagnostics: { available: runtimeId === 'sciforge' }
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: runtimeId === 'sciforge' ? 'async' : 'fail_closed',
      userInput: runtimeId === 'sciforge' ? 'async' : 'fail_closed',
      compact: runtimeId === 'sciforge' ? 'native' : 'noop',
      fork: runtimeId === 'sciforge',
      review: runtimeId === 'sciforge',
      goals: runtimeId === 'sciforge',
      todos: runtimeId === 'sciforge',
      resumeSession: runtimeId === 'sciforge'
    },
    storage: {
      guiOwnedThreads: runtimeId === 'codex',
      backendThreadIdStable: runtimeId === 'sciforge',
      usage: true,
      attachments: { available: runtimeId === 'sciforge' },
      memory: { available: runtimeId === 'sciforge' }
    }
  }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('AgentRuntimeProvider', () => {
  it('routes provider operations through neutral agentRuntime IPC with the active runtime id', async () => {
    const connect = vi.fn(async () => undefined)
    const listThreads = vi.fn(async () => [
      {
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'One',
        updatedAt: '2026-06-11T00:00:00.000Z',
        todos: {
          threadId: 'thread-1',
          updatedAt: '2026-06-11T00:00:03.000Z',
          items: [{
            id: 'todo-list-1',
            content: 'Preserve list todos',
            status: 'pending',
            createdAt: '2026-06-11T00:00:01.000Z',
            updatedAt: '2026-06-11T00:00:03.000Z'
          }]
        }
      }
    ])
    const startThread = vi.fn(async () => ({
      id: 'thread-2',
      runtimeId: 'codex',
      title: 'Two',
      updatedAt: '2026-06-11T00:01:00.000Z',
      workspace: '/tmp/workspace'
    }))
    const readThread = vi.fn(async () => ({
      id: 'thread-2',
      runtimeId: 'codex',
      title: 'Two',
      updatedAt: '2026-06-11T00:01:00.000Z',
      latestSeq: 3,
      latestTurnId: 'turn-1',
      todos: {
        threadId: 'thread-2',
        updatedAt: '2026-06-11T00:01:03.000Z',
        items: [{
          id: 'todo-1',
          content: 'Map events',
          status: 'pending',
          createdAt: '2026-06-11T00:01:03.000Z',
          updatedAt: '2026-06-11T00:01:03.000Z',
          source: {
            kind: 'plan',
            planId: 'plan-1',
            relativePath: '.sciforge/plan/bridge.md',
            ordinal: 0,
            contentHash: 'hash-1'
          }
        }]
      },
      items: [
        { id: 'user-1', kind: 'user_message', text: 'hello', createdAt: '2026-06-11T00:01:01.000Z' },
        { id: 'assistant-1', kind: 'assistant_message', text: 'hi', createdAt: '2026-06-11T00:01:02.000Z' }
      ]
    }))
    const startTurn = vi.fn(async () => ({ threadId: 'thread-2', turnId: 'turn-2', userMessageItemId: 'user-2' }))
    const interruptTurn = vi.fn(async () => undefined)
    const steerTurn = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const forkThread = vi.fn(async () => ({
      id: 'side-thread',
      runtimeId: 'codex',
      title: 'Side path',
      updatedAt: '2026-06-11T00:02:00.000Z',
      model: 'gpt-5',
      mode: 'agent'
    }))
    const resumeSession = vi.fn(async () => ({ threadId: 'resumed-thread', sessionId: 'session-1' }))
    const updateThreadRelation = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          connect,
          capabilities: vi.fn(async () => capabilities('codex')),
          listThreads,
          startThread,
          readThread,
          startTurn,
          interruptTurn,
          steerTurn,
          renameThread,
          deleteThread,
          compactThread,
          forkThread,
          resumeSession,
          updateThreadRelation
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.connect()).resolves.toBeUndefined()
    expect(provider.id).toBe('codex')
    await expect(provider.listThreads({ limit: 1, includeSide: true })).resolves.toEqual([
      expect.objectContaining({
        id: 'thread-1',
        title: 'One',
        runtimeId: 'codex',
        todos: expect.objectContaining({
          items: [expect.objectContaining({ id: 'todo-list-1' })]
        })
      })
    ])
    expect(listThreads).toHaveBeenCalledWith({ limit: 1, includeSide: true })
    await expect(provider.createThread({ title: 'Two', workspace: '/tmp/workspace', mode: 'agent' })).resolves.toEqual(
      expect.objectContaining({ id: 'thread-2', title: 'Two', runtimeId: 'codex' })
    )
    await expect(provider.getThreadDetail('thread-2')).resolves.toMatchObject({
      latestSeq: 3,
      latestTurnId: 'turn-1',
      latestUserMessageId: 'user-1',
      todos: {
        items: [
          expect.objectContaining({
            id: 'todo-1',
            source: expect.objectContaining({
              kind: 'plan',
              relativePath: '.sciforge/plan/bridge.md'
            })
          })
        ]
      },
      blocks: [
        { kind: 'user', id: 'user-1', text: 'hello' },
        { kind: 'assistant', id: 'assistant-1', text: 'hi' }
      ]
    })
    await expect(provider.sendUserMessage('thread-2', 'hello', {
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello'
    })).resolves.toEqual({ threadId: 'thread-2', turnId: 'turn-2', userMessageItemId: 'user-2' })
    await expect(provider.interruptTurn('thread-2', 'turn-2', { discard: true })).resolves.toBeUndefined()
    await expect(provider.steerUserMessage?.('thread-2', 'turn-2', 'more')).resolves.toBeUndefined()
    await expect(provider.renameThread('thread-2', 'Renamed')).resolves.toBeUndefined()
    await expect(provider.compactThread?.('thread-2', 'manual')).resolves.toBeUndefined()
    await expect(provider.forkThread?.('thread-2', { relation: 'side', title: 'Side path' })).resolves.toEqual(
      expect.objectContaining({ id: 'side-thread', title: 'Side path', runtimeId: 'codex' })
    )
    await expect(provider.resumeSession?.('session-1', {
      model: 'gpt-5',
      mode: 'agent'
    })).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(provider.updateThreadRelation?.('thread-2', 'primary')).resolves.toBeUndefined()
    await expect(provider.deleteThread('thread-2')).resolves.toBeUndefined()

    expect(connect).toHaveBeenCalledWith('codex')
    expect(listThreads).toHaveBeenCalledWith({ limit: 1, includeSide: true })
    expect(startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      title: 'Two',
      workspace: '/tmp/workspace',
      mode: 'agent'
    })
    expect(readThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'thread-2' })
    expect(startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      text: 'hello',
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello'
    })
    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      discard: true
    })
    expect(steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      text: 'more'
    })
    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      title: 'Renamed'
    })
    expect(deleteThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2'
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      reason: 'manual'
    })
    expect(forkThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      relation: 'side',
      title: 'Side path'
    })
    expect(resumeSession).toHaveBeenCalledWith({
      runtimeId: 'codex',
      sessionId: 'session-1',
      model: 'gpt-5',
      mode: 'agent'
    })
    expect(updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      relation: 'primary'
    })
  })

  it('preserves structured user input questions from persisted thread detail', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-input',
            runtimeId: 'codex',
            title: 'Input thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Pick deployment target',
                status: 'pending',
                meta: {
                  requestId: 'request-1',
                  questions: [
                    {
                      id: 'target',
                      header: 'Target',
                      question: 'Where should this run?',
                      options: [
                        { label: 'Staging', description: 'Use staging account' },
                        { label: 'Production' }
                      ]
                    }
                  ]
                },
                createdAt: '2026-06-11T00:00:01.000Z'
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-input', 'codex')

    await expect(provider.getThreadDetail('thread-input')).resolves.toMatchObject({
      blocks: [
        {
          kind: 'user_input',
          requestId: 'request-1',
          questions: [
            {
              id: 'target',
              header: 'Target',
              question: 'Where should this run?',
              options: [
                { label: 'Staging', description: 'Use staging account' },
                { label: 'Production', description: '' }
              ]
            }
          ]
        }
      ]
    })
  })

  it('dedupes persisted user input items with the same request id', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-input-duplicate',
            runtimeId: 'codex',
            title: 'Input thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'input-old',
                kind: 'user_input',
                summary: 'Pick deployment target',
                status: 'pending',
                meta: {
                  requestId: 'request-1',
                  questions: [{ id: 'target', header: 'Target', question: 'Where?', options: [] }]
                },
                createdAt: '2026-06-11T00:00:01.000Z'
              },
              {
                id: 'input-new',
                kind: 'user_input',
                summary: 'Pick deployment target',
                status: 'pending',
                meta: {
                  requestId: 'request-1',
                  questions: [{ id: 'target', header: 'Target', question: 'Where?', options: [] }]
                },
                createdAt: '2026-06-11T00:00:02.000Z'
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-input-duplicate', 'codex')

    const detail = await provider.getThreadDetail('thread-input-duplicate')

    expect(detail.blocks.filter((block) => block.kind === 'user_input')).toEqual([
      expect.objectContaining({ kind: 'user_input', id: 'input-new', requestId: 'request-1' })
    ])
  })

  it('settles stale running tool items from terminal thread snapshots', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-completed-tool',
            runtimeId: 'codex',
            title: 'Completed tool thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            status: 'completed',
            latestSeq: 5,
            latestTurnId: 'turn-1',
            turns: [{
              id: 'turn-1',
              threadId: 'thread-completed-tool',
              status: 'completed',
              items: [
                {
                  id: 'user-1',
                  kind: 'user_message',
                  text: 'hello',
                  createdAt: '2026-06-11T00:00:01.000Z'
                },
                {
                  id: 'tool-call-1',
                  kind: 'tool',
                  summary: 'Read file',
                  status: 'running',
                  toolKind: 'command_execution',
                  meta: { callId: 'call-1', toolName: 'local_shell' },
                  createdAt: '2026-06-11T00:00:02.000Z'
                },
                {
                  id: 'tool-result-1',
                  kind: 'tool',
                  summary: 'Read file',
                  status: 'success',
                  toolKind: 'command_execution',
                  meta: { callId: 'call-1', toolName: 'local_shell' },
                  createdAt: '2026-06-11T00:00:03.000Z'
                },
                {
                  id: 'assistant-1',
                  kind: 'assistant_message',
                  text: 'done',
                  createdAt: '2026-06-11T00:00:04.000Z'
                }
              ]
            }]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-completed-tool', 'codex')

    const detail = await provider.getThreadDetail('thread-completed-tool')

    expect(detail.blocks).toEqual([
      expect.objectContaining({ kind: 'user', id: 'user-1' }),
      expect.objectContaining({ kind: 'tool', id: 'tool-result-1', status: 'success' }),
      expect.objectContaining({ kind: 'assistant', id: 'assistant-1', text: 'done' })
    ])
    expect(detail.blocks.some((block) => block.kind === 'tool' && block.status === 'running')).toBe(false)
  })

  it('settles stale pending blocks from idle snapshots', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-idle',
            runtimeId: 'codex',
            title: 'Idle thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            status: 'idle',
            latestSeq: 3,
            items: [
              {
                id: 'tool-running',
                kind: 'tool',
                summary: 'Old command',
                status: 'running',
                toolKind: 'command_execution',
                createdAt: '2026-06-11T00:00:01.000Z'
              },
              {
                id: 'input-pending',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-1' },
                createdAt: '2026-06-11T00:00:02.000Z'
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-idle', 'codex')

    const detail = await provider.getThreadDetail('thread-idle')

    expect(detail.blocks).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'success' }),
      expect.objectContaining({ kind: 'user_input', id: 'input-pending', status: 'cancelled' })
    ])
    expect(detail.blocks.some((block) => block.kind === 'tool' && block.status === 'running')).toBe(false)
    expect(detail.blocks.some((block) => block.kind === 'user_input' && block.status === 'pending')).toBe(false)
  })

  it('uses latestTurnId instead of turn array order when settling terminal snapshots', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-out-of-order',
            runtimeId: 'codex',
            title: 'Out of order thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            latestSeq: 8,
            latestTurnId: 'turn-latest',
            turns: [
              {
                id: 'turn-latest',
                threadId: 'thread-out-of-order',
                status: 'completed',
                items: [
                  {
                    id: 'user-latest',
                    kind: 'user_message',
                    text: 'download missing papers',
                    createdAt: '2026-06-11T00:00:03.000Z'
                  },
                  {
                    id: 'assistant-latest',
                    kind: 'assistant_message',
                    text: 'done',
                    createdAt: '2026-06-11T00:00:04.000Z'
                  }
                ]
              },
              {
                id: 'turn-stale',
                threadId: 'thread-out-of-order',
                status: 'running',
                items: [
                  {
                    id: 'tool-stale',
                    kind: 'tool',
                    summary: 'Old command',
                    status: 'running',
                    toolKind: 'command_execution',
                    createdAt: '2026-06-11T00:00:01.000Z'
                  }
                ]
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-out-of-order', 'codex')

    const detail = await provider.getThreadDetail('thread-out-of-order')

    expect(detail.threadStatus).toBe('completed')
    expect(detail.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant', id: 'assistant-latest', text: 'done' }),
      expect.objectContaining({ kind: 'tool', id: 'tool-stale', status: 'success' })
    ]))
    expect(detail.blocks.some((block) => block.kind === 'tool' && block.status === 'running')).toBe(false)
  })

  it('routes thread-bound mutations through the runtime remembered for the thread', async () => {
    let activeRuntime: AgentRuntimeId = 'codex'
    const readThread = vi.fn(async () => ({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex thread',
      updatedAt: '2026-06-11T00:01:00.000Z',
      latestSeq: 1,
      items: [{
        id: 'input-item',
        kind: 'user_input',
        summary: 'Choose one',
        status: 'pending',
        meta: { requestId: 'input-codex' }
      }]
    }))
    const startTurn = vi.fn(async (input) => ({
      threadId: input.threadId,
      turnId: 'turn-next',
      userMessageItemId: 'user-next'
    }))
    const interruptTurn = vi.fn(async () => undefined)
    const steerTurn = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const updateThreadRelation = vi.fn(async () => undefined)
    const auxiliary = vi.fn(async (input) => {
      if (input.operation === 'reviewThread') {
        return { threadId: input.payload.threadId, turnId: 'review-turn' }
      }
      if (input.operation === 'setThreadGoal') {
        return {
          threadId: input.payload.threadId,
          objective: 'ship it',
          status: 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
      if (input.operation === 'clearThreadGoal') return true
      if (input.operation === 'getThreadTodos') return null
      if (input.operation === 'archiveThread') return undefined
      if (input.operation === 'cancelUserInput') return undefined
      if (input.operation === 'startRuntimeHandoff') {
        return {
          sourceRuntimeId: 'codex',
          sourceThreadId: input.payload.sourceThreadId,
          targetRuntimeId: 'sciforge',
          targetThread: {
            id: input.payload.targetThreadId,
            runtimeId: 'sciforge',
            title: 'Runtime handoff',
            updatedAt: '2026-06-11T00:02:00.000Z'
          },
          turn: {
            threadId: input.payload.targetThreadId,
            turnId: 'turn-next',
            userMessageItemId: 'user-next'
          },
          packet: {
            schema: 'sciforge.runtime_handoff.v1',
            notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
            sourceRuntimeId: 'codex',
            sourceThreadId: input.payload.sourceThreadId,
            targetRuntimeId: 'sciforge',
            completed: [],
            pending: [],
            evidence: [],
            fileReferences: [],
            explicitMemories: [],
            createdAt: '2026-06-11T00:02:00.000Z'
          }
        }
      }
      return undefined
    })
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings(activeRuntime)),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread,
          startTurn,
          interruptTurn,
          steerTurn,
          renameThread,
          deleteThread,
          compactThread,
          updateThreadRelation,
          auxiliary
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.getThreadDetail('codex-thread')

    await provider.interruptTurn('codex-thread', 'turn-next')
    await provider.steerUserMessage?.('codex-thread', 'turn-next', 'more')
    await provider.renameThread('codex-thread', 'Renamed')
    await provider.compactThread?.('codex-thread', 'manual')
    await provider.reviewThread?.('codex-thread', { kind: 'uncommittedChanges' })
    await provider.setThreadGoal?.('codex-thread', { objective: 'ship it', status: 'active' })
    await provider.clearThreadGoal?.('codex-thread')
    await provider.getThreadTodos?.('codex-thread')
    await provider.archiveThread?.('codex-thread', true)
    await provider.cancelUserInput?.('input-codex')
    await provider.updateThreadRelation?.('codex-thread', 'primary')
    await provider.deleteThread('codex-thread')

    activeRuntime = 'sciforge'
    rendererRuntimeClient.invalidateSettings()
    provider.rememberThreadRuntime('handoff-thread', 'codex')

    await expect(provider.sendUserMessage('handoff-thread', 'follow up')).resolves.toEqual({
      threadId: 'handoff-thread',
      turnId: 'turn-next',
      userMessageItemId: 'user-next'
    })

    expect(startTurn).not.toHaveBeenCalled()
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'startRuntimeHandoff',
      payload: expect.objectContaining({
        sourceRuntimeId: 'codex',
        sourceThreadId: 'handoff-thread',
        targetRuntimeId: 'sciforge',
        targetThreadId: 'handoff-thread',
        text: 'follow up'
      })
    })
    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-next'
    })
    expect(steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-next',
      text: 'more'
    })
    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      title: 'Renamed'
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual'
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'reviewThread',
      payload: {
        threadId: 'codex-thread',
        target: { kind: 'uncommittedChanges' },
        model: undefined
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'setThreadGoal',
      payload: {
        threadId: 'codex-thread',
        patch: { objective: 'ship it', status: 'active' }
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'clearThreadGoal',
      payload: { threadId: 'codex-thread' }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'getThreadTodos',
      payload: { threadId: 'codex-thread' }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'archiveThread',
      payload: { threadId: 'codex-thread', archived: true }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'cancelUserInput',
      payload: { threadId: 'codex-thread', requestId: 'input-codex' }
    })
    expect(updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      relation: 'primary'
    })
    expect(deleteThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'codex-thread' })
  })

  it('derives legacy UI capabilities from neutral runtime capabilities', async () => {
    const runtimeCapabilities = vi.fn(async () => capabilities('codex'))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: runtimeCapabilities
        },
      }
    })

    const provider = new AgentRuntimeProvider()
    await provider.refreshCapabilities()

    expect(provider.getCapabilities()).toEqual({
      interrupt: true,
      stream: true,
      approvals: false,
      attachFiles: false,
      review: false,
      compact: true,
      fork: false,
      steer: true,
      goals: false,
      todos: false,
      skills: false,
      checkpoints: false,
      sideConversations: false
    })

    runtimeCapabilities.mockResolvedValueOnce({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'unsupported'
      }
    })
    await provider.refreshCapabilities()

    expect(provider.getCapabilities().compact).toBe(false)
  })

  it('exposes host service auxiliary helpers without runtime-specific branches', async () => {
    let activeRuntime: AgentRuntimeId = 'codex'
    const auxiliary = vi.fn(async (input: {
      operation: string
      runtimeId?: AgentRuntimeId
      payload?: Record<string, unknown>
    }) => {
      if (input.operation === 'listMemories') {
        return [{
          id: 'mem-1',
          text: 'Shared memory',
          scope: 'user',
          tags: ['profile'],
          createdAt: '2026-06-20T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:00.000Z'
        }]
      }
      if (input.operation === 'createMemory') {
        return {
          id: 'mem-2',
          text: input.payload?.text,
          scope: 'workspace',
          tags: [],
          createdAt: '2026-06-20T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:00.000Z'
        }
      }
      if (input.operation === 'updateMemory') {
        const patch = input.payload?.patch as { text?: string } | undefined
        return {
          id: input.payload?.memoryId,
          text: patch?.text,
          scope: 'workspace',
          tags: ['updated'],
          disabled: false,
          deleted: false,
          createdAt: '2026-06-20T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:01.000Z'
        }
      }
      if (input.operation === 'deleteMemory') {
        return {
          id: input.payload?.memoryId,
          text: 'Deleted memory',
          scope: 'workspace',
          tags: [],
          disabled: false,
          deleted: true,
          createdAt: '2026-06-20T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:01.000Z'
        }
      }
      if (input.operation === 'uploadAttachment') {
        return {
          id: 'attachment-1',
          name: input.payload?.name,
          mimeType: input.payload?.mimeType,
          createdAt: '2026-06-20T00:00:00.000Z'
        }
      }
      if (input.operation === 'getAttachmentContent') {
        return {
          ok: true,
          attachmentId: input.payload?.attachmentId,
          text: 'attachment body'
        }
      }
      if (input.operation === 'getContextState') {
        return { runtimeId: 'codex', threadId: input.payload?.threadId, rawHistoryItems: 0, effectiveHistoryItems: 0, updatedAt: 'now' }
      }
      if (input.operation === 'listModelAuditRecords') {
        return [{
          id: 'audit-1',
          runtimeId: 'codex',
          threadId: input.payload?.threadId,
          startedAt: '2026-06-20T00:00:00.000Z',
          request: {
            bodySummary: {
              schema: 'agent-runtime.turnStart',
              keys: ['text'],
              textChars: 5,
              attachmentCount: 0,
              fileReferenceCount: 0,
              inlineContextReferenceCount: 0,
              modelRouterObjectReferenceCount: 0,
              hasGuiPlan: false,
              estimatedJsonChars: 10
            }
          },
          streamOutput: { text: 'hello', reasoning: '', toolCalls: [] }
        }]
      }
      if (input.operation === 'clearModelAuditRecords') {
        if (input.payload?.fail === true) throw new Error('clear failed')
        return true
      }
      if (input.operation === 'listGitCheckpoints') {
        return [{
          id: 'checkpoint-1',
          runtimeId: input.payload?.runtimeId,
          threadId: input.payload?.threadId,
          workspaceRoot: input.payload?.workspaceRoot,
          createdAt: '2026-06-20T00:00:00.000Z'
        }]
      }
      if (input.operation === 'createGitCheckpoint') {
        return {
          id: 'checkpoint-2',
          runtimeId: input.runtimeId,
          threadId: input.payload?.threadId,
          workspaceRoot: input.payload?.workspaceRoot
        }
      }
      if (input.operation === 'runCodeNavigation') {
        return { ok: true, locations: [{ relativePath: 'src/index.ts', line: 3, character: 8 }] }
      }
      if (input.operation === 'listWorkspaceReferences') {
        return { ok: true, references: [{ workspaceRoot: '/tmp/ws', relativePath: 'src/index.ts', name: 'index.ts', kind: 'file' }] }
      }
      if (input.operation === 'listThreadChildren') {
        return {
          runtimeId: 'codex',
          threadId: input.payload?.threadId,
          children: [{
            runtimeId: 'codex',
            parentThreadId: input.payload?.threadId,
            id: 'child-1',
            kind: 'agent',
            name: 'research',
            status: 'running'
          }]
        }
      }
      if (input.operation === 'readChildTranscript') {
        return {
          transcript: {
            runtimeId: 'codex',
            parentThreadId: input.payload?.parentThreadId,
            childId: input.payload?.childId,
            transcriptRef: input.payload?.transcriptRef,
            entries: [{
              id: 'entry-1',
              kind: 'assistant_message',
              text: 'child output'
            }]
          }
        }
      }
      return true
    })
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings(activeRuntime)),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: vi.fn(async () => capabilities('codex')),
          auxiliary
        },
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')

    await expect(provider.listMemories({ query: 'profile' })).resolves.toEqual([expect.objectContaining({
      id: 'mem-1',
      content: 'Shared memory'
    })])
    await expect(provider.createMemory({ content: 'New memory', scope: 'workspace' })).resolves.toMatchObject({
      content: 'New memory',
      scope: 'workspace'
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'createMemory',
      payload: {
        content: 'New memory',
        scope: 'workspace',
        text: 'New memory'
      }
    })
    await expect(provider.updateMemory?.('mem-2', { content: 'Updated memory', tags: ['updated'] })).resolves.toMatchObject({
      id: 'mem-2',
      content: 'Updated memory',
      scope: 'workspace',
      tags: ['updated']
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'updateMemory',
      payload: {
        memoryId: 'mem-2',
        patch: {
          tags: ['updated'],
          text: 'Updated memory'
        }
      }
    })
    await expect(provider.deleteMemory?.('mem-2')).resolves.toMatchObject({
      id: 'mem-2',
      deletedAt: '2026-06-20T00:00:01.000Z'
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'deleteMemory',
      payload: { memoryId: 'mem-2' }
    })
    await expect(provider.getContextState('codex-thread')).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })
    activeRuntime = 'sciforge'
    rendererRuntimeClient.invalidateSettings()
    await expect(provider.getAttachmentContent?.('attachment-1', {
      threadId: 'codex-thread',
      workspace: '/tmp/ws'
    })).resolves.toMatchObject({
      ok: true,
      attachmentId: 'attachment-1'
    })
    await expect(provider.uploadAttachment?.({
      name: 'figure.png',
      mimeType: 'image/png',
      dataBase64: 'ZmFrZQ==',
      threadId: 'codex-thread',
      workspace: '/tmp/ws'
    })).resolves.toMatchObject({
      id: 'attachment-1',
      name: 'figure.png'
    })
    await expect(provider.listModelAuditRecords({ threadId: 'codex-thread', limit: 5 })).resolves.toEqual([
      expect.objectContaining({
        id: 'audit-1',
        runtimeId: 'codex',
        threadId: 'codex-thread'
      })
    ])
    await expect(provider.listGitCheckpoints?.({
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/ws'
    })).resolves.toEqual([
      expect.objectContaining({
        id: 'checkpoint-1',
        runtimeId: 'codex',
        threadId: 'codex-thread'
      })
    ])
    await expect(provider.createGitCheckpoint?.({
      workspaceRoot: '/tmp/ws',
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })).resolves.toEqual(expect.objectContaining({
      id: 'checkpoint-2',
      runtimeId: 'codex',
      threadId: 'codex-thread'
    }))
    await expect(provider.clearModelAuditRecords()).resolves.toBe(true)
    await expect(provider.runCodeNavigation?.({
      workspaceRoot: '/tmp/ws',
      operation: 'goToDefinition',
      filePath: 'src/index.ts',
      line: 3,
      character: 8
    })).resolves.toMatchObject({
      ok: true,
      locations: [expect.objectContaining({ relativePath: 'src/index.ts' })]
    })
    await expect(provider.listWorkspaceReferences({ workspaceRoot: '/tmp/ws' })).resolves.toMatchObject({
      ok: true,
      references: [expect.objectContaining({ relativePath: 'src/index.ts' })]
    })
    await expect(provider.listThreadChildren?.('codex-thread', { limit: 20 })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      children: [expect.objectContaining({ id: 'child-1', parentThreadId: 'codex-thread' })]
    })
    await expect(provider.readChildTranscript?.({
      runtimeId: 'codex',
      parentThreadId: 'codex-thread',
      childId: 'child-1',
      transcriptRef: { runtimeId: 'codex', childId: 'child-1', transcriptId: 'transcript-1' }
    })).resolves.toMatchObject({
      transcript: {
        childId: 'child-1',
        entries: [expect.objectContaining({ text: 'child output' })]
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'getContextState',
      payload: { threadId: 'codex-thread' }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'uploadAttachment',
      payload: {
        name: 'figure.png',
        mimeType: 'image/png',
        dataBase64: 'ZmFrZQ==',
        threadId: 'codex-thread',
        workspace: '/tmp/ws'
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'getAttachmentContent',
      payload: {
        attachmentId: 'attachment-1',
        options: {
          threadId: 'codex-thread',
          workspace: '/tmp/ws'
        }
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'listModelAuditRecords',
      payload: {
        threadId: 'codex-thread',
        limit: 5,
        runtimeId: 'codex'
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'listGitCheckpoints',
      payload: {
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/ws',
        runtimeId: 'codex'
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'createGitCheckpoint',
      payload: {
        workspaceRoot: '/tmp/ws',
        threadId: 'codex-thread',
        turnId: 'turn-1'
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      operation: 'clearModelAuditRecords',
      payload: {}
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: {
        threadId: 'codex-thread',
        limit: 20
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: {
        runtimeId: 'codex',
        parentThreadId: 'codex-thread',
        childId: 'child-1',
        transcriptRef: { runtimeId: 'codex', childId: 'child-1', transcriptId: 'transcript-1' }
      }
    })
  })

  it('propagates model audit auxiliary failures through the provider', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: vi.fn(async () => capabilities('codex')),
          auxiliary: vi.fn(async (input: { operation: string }) => {
            if (input.operation === 'clearModelAuditRecords') throw new Error('clear failed')
            return []
          })
        },
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.clearModelAuditRecords()).rejects.toThrow('clear failed')
  })

  it('forwards neutral turn model hints to Codex adapter calls', async () => {
    const startTurn = vi.fn(async () => ({
      threadId: 'codex-thread',
      turnId: 'turn-codex'
    }))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: vi.fn(async () => capabilities('codex')),
          startTurn
        },
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.sendUserMessage('codex-thread', 'hello', {
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      displayText: 'hello'
    })

    expect(startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'hello',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      displayText: 'hello'
    })
  })

  it('does not fall back unknown thread-bound operations to the active runtime', async () => {
    const startTurn = vi.fn(async () => ({
      threadId: 'codex-thread',
      turnId: 'turn-codex'
    }))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('sciforge')),
        setSettings: vi.fn(),
        agentRuntime: {
          startTurn
        },
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.sendUserMessage('codex-thread', 'hello')).rejects.toThrow(/thread runtime/i)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('does not fall back cancelUserInput without a remembered request mapping to the active runtime', async () => {
    const auxiliary = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('sciforge')),
        setSettings: vi.fn(),
        agentRuntime: {
          auxiliary
        },
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.cancelUserInput?.('missing-input')).rejects.toThrow(/user input/i)
    expect(auxiliary).not.toHaveBeenCalled()
  })

  it('dispatches subscribed neutral runtime events into the thread sink', async () => {
    const listeners: Array<(payload: { streamId: string; event: AgentRuntimeEvent }) => void> = []
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('sciforge')),
        setSettings: vi.fn(),
        agentRuntime: {
          subscribeEvents: vi.fn(async () => ({ streamId: 'stream-1' })),
          stopEvents: vi.fn(async () => true),
          onEvent: vi.fn((handler) => {
            listeners.push(handler)
            return vi.fn()
          }),
          onEnd: vi.fn(() => vi.fn()),
          onError: vi.fn(() => vi.fn())
        },
      }
    })
    const sink = makeSink()
    const ac = new AbortController()
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-1', 'sciforge')
    const subscription = provider.subscribeThreadEvents('thread-1', 0, sink, ac.signal)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    listeners[0]?.({
      streamId: 'stream-1',
      event: { kind: 'assistant_delta', threadId: 'thread-1', itemId: 'assistant-1', text: 'hi', seq: 1 }
    })
    ac.abort()
    await subscription

    expect(sink.onDeltas).toHaveBeenCalledWith([{ kind: 'agent_message', itemId: 'assistant-1', text: 'hi', seq: 1 }])
  })

  it('resolves approval and user input requests through neutral IPC after reading thread detail', async () => {
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-2',
            runtimeId: 'codex',
            title: 'Two',
            updatedAt: '2026-06-11T00:01:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'approval-item',
                kind: 'approval',
                summary: 'Run command?',
                status: 'pending',
                meta: { approvalId: 'approval-1' }
              },
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-1' }
              }
            ]
          })),
          resolveApproval,
          resolveUserInput
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-2', 'codex')
    await provider.getThreadDetail('thread-2')
    await expect(provider.submitApprovalDecision?.('approval-1', 'allow')).resolves.toBeUndefined()
    await expect(provider.submitUserInputResponse?.('input-1', [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])).resolves.toBeUndefined()

    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    expect(resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      requestId: 'input-1',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })
  })

  it('submits the underlying Codex request id when an approval is clicked by item id', async () => {
    const resolveApproval = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-2',
            runtimeId: 'codex',
            title: 'Two',
            updatedAt: '2026-06-11T00:01:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'call_approval',
                kind: 'approval',
                summary: 'Run command?',
                status: 'pending',
                meta: {
                  approvalId: 'call_approval',
                  codexRequestId: 39,
                  codexRequestKind: 'approval'
                }
              }
            ]
          })),
          resolveApproval
        }
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-2', 'codex')
    await provider.getThreadDetail('thread-2')
    await expect(provider.submitApprovalDecision?.('call_approval', 'allow')).resolves.toBeUndefined()

    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      approvalId: '39',
      decision: 'allowed'
    })
  })

  it('resolves interaction requests through the runtime that produced them', async () => {
    let activeRuntime: AgentRuntimeId = 'codex'
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings(activeRuntime)),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'codex-thread',
            runtimeId: 'codex',
            title: 'Codex thread',
            updatedAt: '2026-06-11T00:01:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'approval-item',
                kind: 'approval',
                summary: 'Run command?',
                status: 'pending',
                meta: { approvalId: 'approval-codex' }
              },
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-codex' }
              }
            ]
          })),
          resolveApproval,
          resolveUserInput
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.getThreadDetail('codex-thread')
    activeRuntime = 'sciforge'
    rendererRuntimeClient.invalidateSettings()
    await expect(provider.submitApprovalDecision?.('approval-codex', 'deny')).resolves.toBeUndefined()
    await expect(provider.submitUserInputResponse?.('input-codex', [
      { id: 'choice', label: 'No', value: 'no' }
    ])).resolves.toBeUndefined()

    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      approvalId: 'approval-codex',
      decision: 'denied'
    })
    expect(resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      requestId: 'input-codex',
      answers: [{ id: 'choice', label: 'No', value: 'no' }]
    })
  })

  it('pins event subscriptions to the active runtime at subscription start', async () => {
    const subscribeEvents = vi.fn(async () => ({ streamId: 'stream-1' }))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          subscribeEvents,
          stopEvents: vi.fn(async () => true),
          onEvent: vi.fn(() => vi.fn()),
          onEnd: vi.fn(() => vi.fn()),
          onError: vi.fn(() => vi.fn())
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-2', 'codex')
    const ac = new AbortController()
    const subscription = provider.subscribeThreadEvents('thread-2', 7, makeSink(), ac.signal)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    ac.abort()
    await subscription

    expect(subscribeEvents).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      sinceSeq: 7,
      streamId: expect.stringMatching(/^agent-runtime-/u)
    })
  })
})
