import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import {
  ClaudeCodeRuntimeService,
  type ClaudeAgentSdk
} from './claude-code-service'

type QueryCall = {
  prompt: string | AsyncIterable<unknown>
  options?: ClaudeAgentSdkOptions
}

const computerUseLaunch = {
  appPath: '/tmp/sciforge-app',
  execPath: '/tmp/electron',
  isPackaged: false
}

function configuredModelRouterSettings() {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = 'sciforge-router'
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }
  return modelRouter
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: configuredModelRouterSettings(),
    workspaceRoot: '/tmp/sciforge-workspace',
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

function fakeSdk(
  handler: (call: QueryCall) => SDKMessage[] | Promise<SDKMessage[]>
): { sdk: ClaudeAgentSdk; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  return {
    calls,
    sdk: {
      query: vi.fn((call: QueryCall) => {
        calls.push(call)
        return queryFromMessages(async () => handler(call))
      })
    }
  }
}

function queryFromMessages(
  messages: () => SDKMessage[] | Promise<SDKMessage[]>
): ClaudeAgentSdkQuery {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of await messages()) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        yield message
      }
    }
  } as unknown as ClaudeAgentSdkQuery
}

function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as SDKMessage
}

function assistantText(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: sessionId,
    uuid: randomTestId('assistant'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
  })
}

function assistantThinking(thinking: string, text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: sessionId,
    uuid: randomTestId('assistant'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking },
        { type: 'text', text }
      ],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
  })
}

function thinkingDelta(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'stream_event',
    session_id: sessionId,
    uuid: randomTestId('stream'),
    parent_tool_use_id: null,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: text }
    }
  })
}

function result(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: sessionId,
    uuid: randomTestId('result'),
    usage: { input_tokens: 3, output_tokens: 4 }
  })
}

function init(sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: randomTestId('init'),
    apiKeySource: 'ANTHROPIC_API_KEY',
    claude_code_version: '2.1.185',
    cwd: '/tmp/workspace',
    tools: ['Read', 'Edit'],
    mcp_servers: [],
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: []
  })
}

async function serviceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-claude-runtime-'))
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code test condition.')
}

function randomTestId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ClaudeCodeRuntimeService', () => {
  it('connects through the Claude Agent SDK wrapper without launching a probe process', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.connect()

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.info).toMatchObject({
        command: 'claude',
        sdk: '@anthropic-ai/claude-agent-sdk'
      })
    }
  })

  it('creates GUI-owned threads without starting an SDK query', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.startThread({ workspace: '/tmp/workspace', title: 'Draft' })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.thread.runtimeId).toBe('claude')
      expect(result.thread.title).toBe('Draft')
    }
  })

  it('subscribes before replaying stored events and de-duplicates queued live echoes', async () => {
    const { sdk } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    await service.publishSyntheticEvent({
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'stored'
    })
    const eventStore = (service as unknown as { eventStore: { read: (...args: unknown[]) => Promise<Array<{ event: unknown }>> } }).eventStore
    const originalRead = eventStore.read.bind(eventStore)
    eventStore.read = vi.fn(async (...args: unknown[]) => {
      const subscribers = (service as unknown as {
        eventSubscribers: Set<{ queue: unknown[]; wake?: (() => void) | null }>
      }).eventSubscribers
      expect(subscribers.size).toBe(1)
      const stored = await originalRead(...args)
      for (const subscriber of subscribers) {
        subscriber.queue.push(stored[0]?.event)
        subscriber.wake?.()
      }
      return stored
    })
    const abort = new AbortController()
    const seen: AgentRuntimeEvent[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('thread-1', 0, abort.signal)) {
        seen.push(event)
      }
    })()

    await vi.waitFor(() => {
      expect(seen).toEqual([
        expect.objectContaining({
          kind: 'assistant_delta',
          seq: 1,
          text: 'stored'
        })
      ])
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    abort.abort()
    await consume

    expect(seen).toHaveLength(1)
  })

  it('starts turns with Model Router SDK env and resumes stored Claude sessions', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-secret')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-1'),
      assistantText('Hello from Claude.', 'claude-session-1'),
      result('Hello from Claude.', 'claude-session-1')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Resume me' })
    if (!thread.ok) throw new Error(thread.message)
    const firstTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'hello',
      workspace: '/tmp/workspace'
    })
    if (!firstTurn.ok) throw new Error(firstTurn.message)
    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok && detail.detail.backendThreadId === 'claude-session-1'
    })
    const secondTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'again',
      workspace: '/tmp/workspace'
    })
    if (!secondTurn.ok) throw new Error(secondTurn.message)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.prompt).toBe('hello')
    expect(calls[0]?.options?.cwd).toBe('/tmp/workspace')
    expect(calls[0]?.options?.model).toBe('sonnet')
    expect(calls[0]?.options?.permissionMode).toBe('acceptEdits')
    expect(calls[0]?.options?.forwardSubagentText).toBe(true)
    expect(calls[0]?.options?.agentProgressSummaries).toBe(true)
    expect(calls[0]?.options?.sessionStore).toBeTruthy()
    expect(calls[0]?.options?.sessionStoreFlush).toBe('eager')
    expect(calls[0]?.options?.extraArgs).toMatchObject({ allowedTools: 'Edit' })
    expect(calls[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(calls[0]?.options?.env?.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.ANTHROPIC_SMALL_FAST_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/sciforge-claude-config')
    expect(calls[0]?.options?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(calls[1]?.options?.resume).toBe('claude-session-1')

    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok &&
        detail.detail.latestTurnStatus === 'completed' &&
        (detail.detail.items?.filter((item) =>
          item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
        ).length ?? 0) === 2
    })
    const detail = await service.readThread(thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)
    expect(detail.detail.backendThreadId).toBe('claude-session-1')
    expect(detail.detail.items?.filter((item) =>
      item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
    )).toHaveLength(2)
  })

  it('maps Claude thinking content blocks to reasoning items without mixing them into assistant text', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-thinking'),
      assistantThinking('Check the code path.', 'Done from Claude.', 'claude-session-thinking'),
      result('Done from Claude.', 'claude-session-thinking')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Thinking' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'think out loud',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok && detail.detail.latestTurnStatus === 'completed'
    })
    const detail = await service.readThread(thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)

    expect(detail.detail.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'Check the code path.'
      }),
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Done from Claude.'
      })
    ]))
    expect(detail.detail.items?.some((item) =>
      item.kind === 'assistant_message' && item.text?.includes('Check the code path.')
    )).toBe(false)
  })

  it('passes Claude reasoning effort to the SDK and stores streamed thinking deltas once', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-stream-thinking'),
      thinkingDelta('Streaming thought.', 'claude-session-stream-thinking'),
      assistantThinking('Final thought should not duplicate.', 'Finished.', 'claude-session-stream-thinking'),
      result('Finished.', 'claude-session-stream-thinking')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Streaming thinking' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'think while working',
      workspace: '/tmp/workspace',
      reasoningEffort: 'max'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok && detail.detail.latestTurnStatus === 'completed'
    })
    const detail = await service.readThread(thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)

    expect(calls[0]?.options?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(calls[0]?.options?.effort).toBe('max')
    expect(calls[0]?.options?.includePartialMessages).toBe(true)
    expect(detail.detail.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'Streaming thought.'
      }),
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Finished.'
      })
    ]))
    expect(detail.detail.items?.some((item) =>
      item.kind === 'reasoning' && item.text?.includes('Final thought should not duplicate.')
    )).toBe(false)
  })

  it('injects the managed computer-use MCP server into Claude SDK turns when configured', async () => {
    vi.stubEnv('SCIFORGE_CUA_SERVICE_URL', 'http://127.0.0.1:3900')
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-computer-use'),
      result('Done.', 'claude-session-computer-use')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      computerUseMcpLaunch: computerUseLaunch,
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Computer use' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'use the screen',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    expect(calls[0]?.options?.mcpServers).toMatchObject({
      gui_owl_computer_use: {
        type: 'stdio',
        command: '/tmp/electron',
        args: [
          '/tmp/sciforge-app/out/main/computer-use-mcp-node-entry.js',
          '--gui-owl-computer-use-mcp-server'
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900'
        },
        alwaysLoad: true
      }
    })
    expect(calls[0]?.options?.mcpServers).not.toHaveProperty('gui_computer_use')
  })

  it('maps Task and Workflow tool output and reads canonical child transcripts', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call.options?.sessionStore?.append({
        projectKey: 'project-a',
        sessionId: 'claude-session-children',
        subpath: 'subagents/agent-agent-42'
      }, [{
        type: 'assistant',
        uuid: 'subagent-entry-1',
        timestamp: '2026-06-21T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Nested transcript line.' }]
        }
      }])
      return [
        init('claude-session-children'),
        sdkMessage({
          type: 'assistant',
          session_id: 'claude-session-children',
          uuid: 'assistant-tools',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'tool-agent',
              name: 'Task',
              input: { prompt: 'Inspect auth', subagent_type: 'code-reviewer' }
            }, {
              type: 'tool_use',
              id: 'tool-workflow',
              name: 'Workflow',
              input: { taskId: 'task-1', workflowName: 'spec' }
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-agent-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-agent',
              content: JSON.stringify({
                agentId: 'agent-42',
                agentType: 'code-reviewer',
                prompt: 'Inspect auth',
                usage: { total_tokens: 42 },
                totalTokens: 42,
                status: 'completed',
                outputFile: '/tmp/agent-output.txt'
              })
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-workflow-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-workflow',
              content: JSON.stringify({
                taskId: 'task-1',
                runId: 'run-9',
                workflowName: 'spec',
                summary: 'Workflow finished.',
                transcriptDir: '/tmp/workflows/run-9',
                scriptPath: '/tmp/spec.workflow.md',
                status: 'completed'
              })
            }]
          }
        }),
        result('Done.', 'claude-session-children')
      ]
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Children' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'delegate',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      const children = await service.listThreadChildren({ threadId: thread.thread.id })
      return children.children.length === 2
    })

    const children = await service.listThreadChildren({ threadId: thread.thread.id })
    expect(children.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'agent-42',
        kind: 'agent',
        status: 'completed',
        name: 'code-reviewer',
        prompt: 'Inspect auth',
        usage: expect.objectContaining({ totalTokens: 42 }),
        transcriptRef: expect.objectContaining({
          source: 'claude-agent-sdk.sessionStore',
          metadata: expect.objectContaining({
            sessionId: 'claude-session-children',
            subpath: 'subagents/agent-agent-42'
          })
        }),
        metadata: expect.objectContaining({
          agentId: 'agent-42',
          agentType: 'code-reviewer',
          outputFile: '/tmp/agent-output.txt'
        })
      }),
      expect.objectContaining({
        id: 'run-9',
        kind: 'workflow',
        status: 'completed',
        name: 'spec',
        summary: 'Workflow finished.',
        transcriptRef: expect.objectContaining({
          path: '/tmp/workflows/run-9'
        }),
        metadata: expect.objectContaining({
          taskId: 'task-1',
          runId: 'run-9',
          workflowName: 'spec',
          transcriptDir: '/tmp/workflows/run-9',
          scriptPath: '/tmp/spec.workflow.md'
        })
      })
    ]))

    const transcript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      childId: 'agent-42'
    })
    expect(transcript.transcript.entries).toEqual([
      expect.objectContaining({
        id: 'subagent-entry-1',
        kind: 'assistant_message',
        text: 'Nested transcript line.'
      })
    ])

    const workflowTranscript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      childId: 'run-9'
    })
    expect(workflowTranscript.transcript).toMatchObject({
      runtimeId: 'claude',
      parentThreadId: thread.thread.id,
      childId: 'run-9',
      child: expect.objectContaining({
        kind: 'workflow',
        name: 'spec'
      }),
      entries: [
        { id: 'run-9-summary', kind: 'assistant_message', text: 'Workflow finished.' }
      ],
      summary: 'Workflow finished.',
      degraded: true
    })
  })

  it('maps Claude task system messages with camelCase fields to canonical children', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-task-events'),
      sdkMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'claude-session-task-events',
        uuid: 'task-started',
        taskId: 'task-camel',
        subagentType: 'researcher',
        prompt: 'Find context'
      }),
      sdkMessage({
        type: 'system',
        subtype: 'task_notification',
        session_id: 'claude-session-task-events',
        uuid: 'task-notification',
        taskId: 'task-camel',
        subagentType: 'researcher',
        status: 'success',
        summary: 'Context found.'
      }),
      result('Done.', 'claude-session-task-events')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Task events' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'delegate',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      const children = await service.listThreadChildren({ threadId: thread.thread.id })
      return children.children.some((child) => child.id === 'task-camel' && child.status === 'completed')
    })
    const children = await service.listThreadChildren({ threadId: thread.thread.id, parentTurnId: turn.turnId })
    expect(children.children).toEqual([
      expect.objectContaining({
        id: 'task-camel',
        runtimeId: 'claude',
        parentThreadId: thread.thread.id,
        parentTurnId: turn.turnId,
        kind: 'agent',
        status: 'completed',
        name: 'researcher',
        prompt: 'Find context',
        summary: 'Context found.',
        transcriptRef: expect.objectContaining({
          runtimeId: 'claude',
          childId: 'task-camel',
          transcriptId: 'subagents/agent-task-camel'
        })
      })
    ])

    const transcript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      parentTurnId: turn.turnId,
      childId: 'task-camel'
    })
    expect(transcript.transcript).toMatchObject({
      childId: 'task-camel',
      parentTurnId: turn.turnId,
      entries: [
        { id: 'task-camel-prompt', kind: 'user_message', text: 'Find context' },
        { id: 'task-camel-summary', kind: 'assistant_message', text: 'Context found.' }
      ],
      degraded: true
    })
  })
})
