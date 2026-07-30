import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
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
import { AgentRuntimeProvider, defaultCapabilities } from './agent-runtime-provider'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

function settings(activeAgentRuntime: AgentRuntimeId): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
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
  it('uses unavailable Codex capabilities by default without a live Kun transport', () => {
    const provider = new AgentRuntimeProvider()
    const legacyLocal = defaultCapabilities('sciforge')

    expect(provider.id).toBe('codex')
    expect(provider.getCapabilities()).toEqual(expect.objectContaining({
      stream: false,
      interrupt: false,
      approvals: false
    }))
    expect(legacyLocal).toMatchObject({
      runtimeId: 'sciforge',
      transport: 'jsonrpc_stdio',
      events: { live: false, replayable: false, sequenced: false }
    })
  })

  it('routes provider operations through neutral agentRuntime IPC with the active runtime id', async () => {
    const connect = vi.fn(async () => undefined)
    const listThreads = vi.fn(async () => [
      {
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'One',
        updatedAt: '2026-06-11T00:00:00.000Z',
        threadSource: 'subagent',
        visibility: 'auto',
        sidebarVisibility: 'hidden',
        titleSource: 'runtime',
        parentTurnId: 'parent-turn-1',
        agentNickname: 'Worker B',
        agentRole: 'renderer',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/tmp/workspace',
          relativePath: '.sciforge/plan/list.md',
          planId: '/tmp/workspace:.sciforge/plan/list.md',
          title: 'List plan'
        },
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
      guiPlan: {
        operation: 'draft',
        workspaceRoot: '/tmp/workspace',
        relativePath: '.sciforge/plan/bridge.md',
        planId: '/tmp/workspace:.sciforge/plan/bridge.md',
        sourceRequest: 'Bridge plan',
        title: 'Bridge'
      },
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
        {
          id: 'assistant-1',
          kind: 'assistant_message',
          text: 'hi',
          createdAt: '2026-06-11T00:01:02.000Z',
          meta: {
            scientificObjects: [{
              schemaVersion: 1,
              id: 'structure-1',
              modality: 'molecular',
              title: 'Protein structure',
              source: 'tool',
              path: '/tmp/workspace/protein.pdb',
              workspaceRoot: '/tmp/workspace',
              mimeType: 'chemical/x-pdb',
              hash: { algorithm: 'sha256', digest: 'a'.repeat(64) }
            }]
          }
        },
        {
          id: 'integrity-error-1',
          kind: 'system',
          text: 'Required execution proof was missing.',
          detail: 'apply_patch never returned a terminal receipt',
          status: 'error',
          createdAt: '2026-06-11T00:01:03.000Z',
          meta: {
            code: 'runtime_execution_incomplete',
            severity: 'error'
          }
        }
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
        threadSource: 'subagent',
        visibility: 'auto',
        sidebarVisibility: 'hidden',
        titleSource: 'runtime',
        parentTurnId: 'parent-turn-1',
        agentNickname: 'Worker B',
        agentRole: 'renderer',
        guiPlan: expect.objectContaining({
          relativePath: '.sciforge/plan/list.md'
        }),
        todos: expect.objectContaining({
          items: [expect.objectContaining({ id: 'todo-list-1' })]
        })
      })
    ])
    expect(listThreads).toHaveBeenCalledWith({ limit: 1, includeSide: true })
    await expect(provider.createThread({
      title: 'Two',
      workspace: '/shared/project',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      },
      mode: 'agent'
    })).resolves.toEqual(
      expect.objectContaining({ id: 'thread-2', title: 'Two', runtimeId: 'codex' })
    )
    await expect(provider.getThreadDetail('thread-2')).resolves.toMatchObject({
      runtimeId: 'codex',
      latestSeq: 3,
      latestTurnId: 'turn-1',
      latestUserMessageId: 'user-1',
      guiPlan: expect.objectContaining({
        planId: '/tmp/workspace:.sciforge/plan/bridge.md',
        relativePath: '.sciforge/plan/bridge.md'
      }),
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
        {
          kind: 'assistant',
          id: 'assistant-1',
          text: 'hi',
          meta: {
            scientificObjects: [expect.objectContaining({ id: 'structure-1', modality: 'molecular' })]
          }
        },
        {
          kind: 'system',
          id: 'integrity-error-1',
          text: 'Blocked / unverified execution. The runtime did not provide trusted proof that the required tool action completed.',
          code: 'runtime_execution_incomplete',
          detail: expect.stringContaining('apply_patch never returned a terminal receipt'),
          severity: 'error'
        }
      ]
    })
    await expect(provider.sendUserMessage('thread-2', 'hello', {
      clientDirectiveId: 'directive:send:1',
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })).resolves.toEqual({ threadId: 'thread-2', turnId: 'turn-2', userMessageItemId: 'user-2' })
    await expect(provider.interruptTurn('thread-2', 'turn-2', { discard: true })).resolves.toBeUndefined()
    await expect(provider.steerUserMessage?.('thread-2', 'turn-2', 'more', {
      clientDirectiveId: 'directive:steer:1'
    })).resolves.toBeUndefined()
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
      workspace: '/shared/project',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      },
      mode: 'agent'
    })
    expect(readThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      text: 'hello',
      clientDirectiveId: 'directive:send:1',
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      },
      discard: true
    })
    expect(steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      text: 'more',
      clientDirectiveId: 'directive:steer:1',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      title: 'Renamed',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(deleteThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      reason: 'manual',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
    expect(forkThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      relation: 'side',
      title: 'Side path',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
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
      relation: 'primary',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'host-session-1',
        path: '/shared/project'
      }
    })
  })

  it('places every remembered remote thread operation on its workspace host session', async () => {
    const workspaceLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'remote-session-1',
      path: '/cluster/project'
    }
    const readThread = vi.fn(async () => ({
      id: 'remote-thread',
      runtimeId: 'codex' as const,
      title: 'Remote thread',
      updatedAt: '2026-06-11T00:01:00.000Z',
      latestSeq: 4,
      items: [
        {
          id: 'approval-item',
          kind: 'approval' as const,
          summary: 'Run command?',
          status: 'pending' as const,
          meta: { approvalId: 'approval-remote' }
        },
        {
          id: 'input-item',
          kind: 'user_input' as const,
          summary: 'Choose one',
          status: 'pending' as const,
          meta: { requestId: 'input-remote' }
        }
      ]
    }))
    const readThreadSidebarProbe = vi.fn(async () => ({
      runtimeId: 'codex' as const,
      threadId: 'remote-thread',
      text: 'Remote summary'
    }))
    const startTurn = vi.fn(async () => ({
      threadId: 'remote-thread',
      turnId: 'turn-remote',
      userMessageItemId: 'user-remote'
    }))
    const steerTurn = vi.fn(async () => undefined)
    const interruptTurn = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const forkThread = vi.fn(async () => ({
      id: 'remote-fork',
      runtimeId: 'codex' as const,
      title: 'Remote fork',
      updatedAt: '2026-06-11T00:02:00.000Z'
    }))
    const updateThreadRelation = vi.fn(async () => undefined)
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    const auxiliary = vi.fn(async () => ({
      threadId: 'remote-thread',
      modelContextWindow: 100_000,
      totalTokens: 1_000,
      remainingTokens: 99_000,
      remainingPercent: 99,
      autoCompactionThresholdPercent: 10,
      autoCompactionEnabled: true,
      lastUpdatedAt: '2026-06-11T00:01:00.000Z'
    }))
    const subscribeEvents = vi.fn(async () => ({ streamId: 'stream-remote' }))
    const stopEvents = vi.fn(async () => true)
    const deleteThread = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread,
          readThreadSidebarProbe,
          startTurn,
          steerTurn,
          interruptTurn,
          renameThread,
          compactThread,
          forkThread,
          updateThreadRelation,
          resolveApproval,
          resolveUserInput,
          auxiliary,
          subscribeEvents,
          stopEvents,
          onEvent: vi.fn(() => vi.fn()),
          onEnd: vi.fn(() => vi.fn()),
          onError: vi.fn(() => vi.fn()),
          deleteThread
        }
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('remote-thread', 'codex', workspaceLocator)

    await provider.getThreadDetail('remote-thread')
    await provider.getThreadSidebarProbe('remote-thread')
    await provider.sendUserMessage('remote-thread', 'continue')
    await provider.steerUserMessage?.('remote-thread', 'turn-remote', 'more')
    await provider.interruptTurn('remote-thread', 'turn-remote')
    await provider.renameThread('remote-thread', 'Renamed')
    await provider.compactThread?.('remote-thread', 'manual')
    await provider.forkThread?.('remote-thread', { relation: 'side', title: 'Remote fork' })
    await provider.updateThreadRelation?.('remote-thread', 'primary')
    await provider.submitApprovalDecision?.('approval-remote', 'allow')
    await provider.submitUserInputResponse?.('input-remote', [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])
    await provider.getContextState?.('remote-thread')

    const abortController = new AbortController()
    const subscription = provider.subscribeThreadEvents(
      'remote-thread',
      4,
      makeSink(),
      abortController.signal
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    abortController.abort()
    await subscription
    await provider.deleteThread('remote-thread')

    for (const bridgeCall of [
      readThread,
      readThreadSidebarProbe,
      startTurn,
      steerTurn,
      interruptTurn,
      renameThread,
      compactThread,
      forkThread,
      updateThreadRelation,
      resolveApproval,
      resolveUserInput,
      subscribeEvents,
      deleteThread
    ]) {
      expect(bridgeCall).toHaveBeenCalledWith(expect.objectContaining({ workspaceLocator }))
    }
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      workspaceLocator,
      operation: 'getContextState',
      payload: { threadId: 'remote-thread' }
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

  it('uses the runtime request id for persisted approval blocks', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-approval',
            runtimeId: 'codex',
            title: 'Approval thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
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
          }))
        }
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-approval', 'codex')

    const detail = await provider.getThreadDetail('thread-approval')

    expect(detail.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'approval',
        id: 'call_approval',
        approvalId: '39'
      })
    )
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
      expect.objectContaining({ kind: 'user', id: 'user-1', turnStatus: 'completed' }),
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
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'error' }),
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
      expect.objectContaining({ kind: 'tool', id: 'tool-stale', status: 'error' })
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
          targetRuntimeId: 'claude',
          targetThread: {
            id: input.payload.targetThreadId,
            runtimeId: 'claude',
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
            targetRuntimeId: 'claude',
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

    activeRuntime = 'claude'
    rendererRuntimeClient.invalidateSettings()
    provider.rememberThreadRuntime('handoff-thread', 'codex')

    await expect(provider.sendUserMessage('handoff-thread', 'follow up')).resolves.toEqual({
      threadId: 'handoff-thread',
      turnId: 'turn-next',
      userMessageItemId: 'user-next',
      threadIdChange: 'handoff'
    })

    expect(startTurn).not.toHaveBeenCalled()
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'startRuntimeHandoff',
      payload: expect.objectContaining({
        sourceThreadId: 'handoff-thread',
        targetRuntimeId: 'claude',
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
      event: { kind: 'assistant_delta', threadId: 'thread-other', itemId: 'assistant-other', text: 'wrong', seq: 1 }
    })
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
