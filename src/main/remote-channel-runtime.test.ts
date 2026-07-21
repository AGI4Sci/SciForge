import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AgentRuntimeId,
  type AppSettingsV1,
  type RemoteChannelV1,
  type RemoteChannelConversationV1
} from '../shared/app-settings'
import { createRemoteChannelRuntime as createProductionRemoteChannelRuntime } from './remote-channel-runtime'
import {
  REMOTE_CHANNEL_PROVIDER_CAPABILITIES,
  classifyRemoteChannelFailure,
  remoteChannelAttachmentFromGeneratedFile,
  latestGeneratedFiles,
  prepareRemoteChannelReplyText,
  splitRemoteChannelReplyText
} from './remote-channel-runtime-helpers'
import type { RemoteChannelRuntimeDeps, ThreadDetailJson } from './remote-channel-runtime-helpers'

type TestAgentRuntime = NonNullable<RemoteChannelRuntimeDeps['agentRuntime']>
type TestThreadDetail = ThreadDetailJson & {
  id: string
  runtimeId: AgentRuntimeId
  title: string
  updatedAt: string
  latestSeq: number
}
type TestConversationOverrides = Partial<RemoteChannelConversationV1> & { localThreadId?: string }
type TestChannelOverrides = Partial<RemoteChannelV1> & { threadId?: string }

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    remoteChannel: {
      ...defaultRemoteChannelSettings(),
      enabled: true
    },
    connectPhone: defaultConnectPhoneSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function buildConversation(overrides: TestConversationOverrides = {}): RemoteChannelConversationV1 {
  const { localThreadId = 'thr_old', ...canonicalOverrides } = overrides
  const conversation = {
    id: 'conv_1',
    chatId: 'oc_chat_a',
    remoteThreadId: '',
    latestMessageId: 'om_previous',
    senderId: 'ou_1',
    senderName: 'Alice',
    workspaceRoot: '/tmp/workspace/conversations/oc_chat_a',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...canonicalOverrides
  }
  return {
    ...conversation,
    agentThreadIds: canonicalOverrides.agentThreadIds ?? (
      localThreadId.trim() ? { sciforge: localThreadId.trim() } : {}
    )
  }
}

function buildChannel(overrides: TestChannelOverrides = {}): RemoteChannelV1 {
  const { threadId = 'thr_old', ...canonicalOverrides } = overrides
  const channel = {
    id: 'channel_1',
    provider: 'feishu' as const,
    label: 'Phone',
    enabled: true,
    model: 'auto',
    workspaceRoot: '/tmp/workspace',
    agentProfile: {
      name: 'kun',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...canonicalOverrides
  }
  return {
    ...channel,
    agentThreadIds: canonicalOverrides.agentThreadIds ?? (
      threadId.trim() ? { sciforge: threadId.trim() } : {}
    )
  }
}

function mutableSettingsStore(initialSettings: AppSettingsV1): {
  current: () => AppSettingsV1
  store: {
    load: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
  }
} {
  let currentSettings = initialSettings
  const store = {
    load: vi.fn(async () => currentSettings),
    patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
      currentSettings = {
        ...currentSettings,
        ...partial,
        remoteChannel: partial.remoteChannel
          ? {
              ...currentSettings.remoteChannel,
              ...partial.remoteChannel,
              im: partial.remoteChannel.im
                ? { ...currentSettings.remoteChannel.im, ...partial.remoteChannel.im }
                : currentSettings.remoteChannel.im
            }
          : currentSettings.remoteChannel
      }
      return currentSettings
    })
  }
  return { current: () => currentSettings, store }
}

function completedThreadDetail(
  threadId: string,
  turnId: string,
  text: string,
  overrides: Partial<ThreadDetailJson> = {}
): TestThreadDetail {
  return {
    id: threadId,
    runtimeId: 'sciforge',
    title: threadId,
    updatedAt: '2026-06-02T00:00:00.000Z',
    latestSeq: 1,
    status: 'idle',
    turns: [
      {
        id: turnId,
        status: 'completed',
        items: [{ kind: 'assistant_text', turnId, text }]
      }
    ],
    ...overrides
  }
}

function completedAgentRuntime(options: {
  threadId?: string
  turnId?: string
  text?: string
  detail?: ThreadDetailJson | ((input: { runtimeId?: string; threadId: string }) => ThreadDetailJson)
  startThread?: (input: Record<string, unknown>) => Promise<{
    id: string
    runtimeId?: AgentRuntimeId
    title?: string
    updatedAt?: string
  }>
  startTurn?: (input: Record<string, unknown>) => Promise<{ threadId: string; turnId: string }>
  readThread?: (input: { runtimeId?: string; threadId: string }) => Promise<ThreadDetailJson>
} = {}): TestAgentRuntime & {
  startThread: ReturnType<typeof vi.fn>
  startTurn: ReturnType<typeof vi.fn>
  readThread: ReturnType<typeof vi.fn>
} {
  const defaultThreadId = options.threadId ?? 'thr_1'
  const defaultTurnId = options.turnId ?? 'turn_1'
  const defaultText = options.text ?? 'agent reply'
  const startThread = vi.fn(options.startThread ?? (async () => ({
    id: defaultThreadId,
    runtimeId: 'sciforge' as const,
    title: defaultThreadId,
    updatedAt: '2026-06-02T00:00:00.000Z'
  })))
  const startTurn = vi.fn(options.startTurn ?? (async (input: Record<string, unknown>) => ({
    threadId: typeof input.threadId === 'string' ? input.threadId : defaultThreadId,
    turnId: defaultTurnId
  })))
  const readThread = vi.fn(options.readThread ?? (async (input: { runtimeId?: string; threadId: string }) => {
    if (typeof options.detail === 'function') return options.detail(input)
    return options.detail ?? completedThreadDetail(input.threadId, defaultTurnId, defaultText)
  }))
  return {
    startThread,
    startTurn,
    readThread
  } as unknown as TestAgentRuntime & {
    startThread: ReturnType<typeof vi.fn>
    startTurn: ReturnType<typeof vi.fn>
    readThread: ReturnType<typeof vi.fn>
  }
}

function unusedAgentRuntime(): TestAgentRuntime {
  const fail = async (): Promise<never> => {
    throw new Error('Unexpected agentRuntime call in this test.')
  }
  return {
    startThread: vi.fn(fail),
    readThread: vi.fn(fail),
    startTurn: vi.fn(fail),
    listThreads: vi.fn(fail),
    interruptTurn: vi.fn(fail)
  } as unknown as TestAgentRuntime
}

function createRemoteChannelRuntime(
  deps: Omit<RemoteChannelRuntimeDeps, 'agentRuntime'> & Partial<Pick<RemoteChannelRuntimeDeps, 'agentRuntime'>>
): ReturnType<typeof createProductionRemoteChannelRuntime> {
  return createProductionRemoteChannelRuntime({
    agentRuntime: unusedAgentRuntime(),
    ...deps
  })
}

describe('RemoteChannelRuntime', () => {
  it('classifies the standard remote-channel failure buckets', () => {
    expect(classifyRemoteChannelFailure({ code: 'runtime_offline', message: 'Local runtime is offline.' })).toBe('runtime_offline')
    expect(classifyRemoteChannelFailure({ code: 'provider_unavailable', message: 'model deepseek-v4-pro missing' })).toBe('model_missing')
    expect(classifyRemoteChannelFailure({ message: 'Timed out waiting for agent response.' })).toBe('timeout')
    expect(classifyRemoteChannelFailure({ code: 'empty_response', message: 'Agent completed without a reply.' })).toBe('empty_response')
    expect(classifyRemoteChannelFailure({ code: 'approval_required', message: 'waiting for desktop approval' })).toBe('waiting_desktop_approval')
    expect(classifyRemoteChannelFailure({ status: 404, message: 'thread not found' })).toBe('local_thread_deleted')
    expect(classifyRemoteChannelFailure({ code: 'provider_send_failed', message: 'Discord send failed' })).toBe('provider_send_failed')
  })

  it('defines provider reply and attachment capabilities for Feishu, WeChat, and Discord', () => {
    expect(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.feishu).toMatchObject({
      label: 'Feishu / Lark',
      maxMessageLength: 30_000,
      markdown: { supported: true, preserveCodeBlocks: true },
      attachments: {
        file: { supported: true, maxBytes: 50 * 1024 * 1024 },
        image: { supported: true },
        link: { supported: true }
      },
      retry: { maxAttempts: 2 }
    })
    expect(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.weixin).toMatchObject({
      label: 'WeChat',
      maxMessageLength: 2_000,
      markdown: { supported: false, preserveCodeBlocks: true },
      attachments: {
        file: { supported: true, maxCount: 3 },
        image: { supported: true, maxCount: 3 },
        link: { supported: true }
      },
      retry: { maxAttempts: 2 }
    })
    expect(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.discord).toMatchObject({
      label: 'Discord',
      maxMessageLength: 2_000,
      markdown: { supported: true, preserveCodeBlocks: true },
      attachments: {
        file: { supported: false },
        image: { supported: false },
        link: { supported: true }
      },
      retry: { maxAttempts: 3 }
    })
  })

  it('splits long replies while preserving fenced code blocks where possible', () => {
    const reply = [
      'Here is the patch:',
      '```ts',
      ...Array.from({ length: 8 }, (_, index) => `const value${index} = ${index};`),
      '```',
      'Done.'
    ].join('\n')

    const chunks = splitRemoteChannelReplyText('discord', reply, { maxMessageLength: 90 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 90)).toBe(true)
    expect(chunks[0]).toContain('```ts')
    expect(chunks[0].trimEnd()).toMatch(/```$/)
    expect(chunks[1]).toMatch(/^```ts\n/)
  })

  it('adds an attachment fallback summary when a provider cannot deliver generated files', () => {
    const prepared = prepareRemoteChannelReplyText('discord', '文件已经生成。', {
      attachments: [
        remoteChannelAttachmentFromGeneratedFile({
          path: '/tmp/workspace/report.md',
          relativePath: 'report.md',
          fileName: 'report.md'
        }),
        remoteChannelAttachmentFromGeneratedFile({
          path: '/tmp/workspace/chart.png',
          relativePath: 'chart.png',
          fileName: 'chart.png'
        })
      ],
      maxMessageLength: 500
    })

    const fullText = prepared.textChunks.join('\n')
    expect(prepared.unsupportedAttachments.map((item) => item.name)).toEqual(['report.md', 'chart.png'])
    expect(fullText).toContain('Discord 当前不能直接投递这些附件')
    expect(fullText).toContain('report.md')
    expect(fullText).toContain('请到桌面查看完整结果')
  })

  it('does not add an unsupported-attachment fallback for WeChat media delivery', () => {
    const prepared = prepareRemoteChannelReplyText('weixin', '文件已经生成。', {
      attachments: [
        remoteChannelAttachmentFromGeneratedFile({
          path: '/tmp/workspace/chart.png',
          relativePath: 'chart.png',
          fileName: 'chart.png'
        })
      ],
      maxMessageLength: 500
    })

    expect(prepared.unsupportedAttachments).toEqual([])
    expect(prepared.textChunks.join('\n')).not.toContain('当前不能直接投递')
  })

  it('extracts generated media files from the current turn only', () => {
    const files = latestGeneratedFiles({
      turns: [
        {
          id: 'turn_old',
          status: 'completed',
          items: [
            {
              kind: 'tool_result',
              turnId: 'turn_old',
              toolKind: 'file_change',
              output: { path: '/tmp/workspace/old.md' }
            }
          ]
        },
        {
          id: 'turn_current',
          status: 'completed',
          items: [
            {
              kind: 'tool_result',
              turnId: 'turn_current',
              toolName: 'generate_image',
              output: {
                files: [
                  { relativePath: 'images/poster.png', fileName: 'poster.png' },
                  { absolute_path: '/tmp/workspace/images/hero.png', name: 'hero.png' }
                ]
              }
            }
          ]
        }
      ]
    }, { turnId: 'turn_current', workspaceRoot: '/tmp/workspace' })

    expect(files).toEqual([
      {
        path: '/tmp/workspace/images/poster.png',
        relativePath: 'images/poster.png',
        fileName: 'poster.png'
      },
      {
        path: '/tmp/workspace/images/hero.png',
        fileName: 'hero.png'
      }
    ])
    expect(latestGeneratedFiles({
      turns: [
        {
          id: 'turn_old',
          status: 'completed',
          items: [{ kind: 'tool_result', turnId: 'turn_old', toolKind: 'file_change', output: { path: '/tmp/workspace/old.md' } }]
        },
        { id: 'turn_empty', status: 'completed', items: [] }
      ]
    }, { turnId: 'turn_empty', workspaceRoot: '/tmp/workspace' })).toEqual([])
  })

  it('bases Feishu conversation workspaces on the configured remote-channel workspace', () => {
    const settings = buildSettings()
    settings.remoteChannel.im.workspaceRoot = '/tmp/remote-channel-default'
    const channel: RemoteChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.remoteChannel.channels = [channel]
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: undefined,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, undefined, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/remote-channel-default')
  })

  it('repairs legacy Feishu conversation workspaces created from an empty channel root', () => {
    const settings = buildSettings()
    settings.remoteChannel.im.workspaceRoot = '/tmp/claw-default'
    const conversation: RemoteChannelConversationV1 = {
      id: 'conv_1',
      chatId: 'oc_chat_a',
      remoteThreadId: '',
      latestMessageId: 'msg_1',
      senderId: 'ou_1',
      senderName: 'Alice',
      agentThreadIds: { sciforge: 'thr_1' },
      workspaceRoot: '/conversations/oc_chat_a',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    const channel: RemoteChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [conversation],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.remoteChannel.channels = [channel]
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: typeof conversation,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, conversation, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default')
  })

  it('repairs legacy Feishu conversation sub-workspaces under the channel project root', () => {
    const settings = buildSettings()
    settings.remoteChannel.im.workspaceRoot = '/tmp/claw-default'
    const conversation = buildConversation({
      chatId: 'oc_chat_a',
      remoteThreadId: '',
      workspaceRoot: '/tmp/claw-default/conversations/oc_chat_a'
    })
    const channel = buildChannel({
      workspaceRoot: '',
      conversations: [conversation]
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: typeof conversation,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, conversation, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default')
  })

  it('delegates reminder creation to Schedule without writing legacy remote-channel tasks', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const createScheduledTaskFromText = vi.fn(async () => ({
      kind: 'created' as const,
      taskId: 'schedule-task-1',
      title: 'Reminder',
      scheduleAt: '2026-06-03T09:00:00.000+08:00',
      confirmationText: 'Scheduled.'
    }))
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: 'Remind me tomorrow to ship the review.' })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toEqual({
      ok: true,
      createdTaskId: 'schedule-task-1',
      reply: 'Scheduled.'
    })
    expect(createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow to ship the review.', {
      workspaceRoot: settings.workspaceRoot,
      modelHint: settings.remoteChannel.im.model,
      mode: settings.remoteChannel.im.mode
    })
    expect(store.patch).not.toHaveBeenCalled()
    expect('tasks' in settings.remoteChannel).toBe(false)
  })

  it('accepts assistant_text items when waiting for a remote-channel turn result', async () => {
    const settings = buildSettings()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      detail: completedThreadDetail('thr_1', 'turn_1', '', {
        thread: { id: 'thr_1', status: 'completed' },
        turns: [{ id: 'turn_1', status: 'completed' }],
        items: [{ kind: 'assistant_text', detail: 'hello from remote channel' }]
      })
    })
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 10,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from remote channel' })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('reads assistant text from the local runtime thread detail shape used by the real runtime', async () => {
    const settings = buildSettings()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      detail: {
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'hello from nested turn items' }]
          }
        ]
      }
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from nested turn items' })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('automatically replaces a missing configured IM thread and reports the previous binding', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const onTurnStarted = vi.fn()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_replacement',
      turnId: 'turn_replacement',
      text: 'replacement reply',
      startThread: async () => ({
        id: 'thr_replacement',
        runtimeId: 'sciforge' as const,
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }),
      startTurn: async (input) => {
        if (input.threadId === 'thr_missing') {
          throw new Error(JSON.stringify({ code: 'not_found', message: 'thread not found: thr_missing' }))
        }
        return {
          threadId: typeof input.threadId === 'string' ? input.threadId : 'thr_replacement',
          turnId: 'turn_replacement'
        }
      },
      readThread: async ({ threadId }) => completedThreadDetail(threadId, 'turn_replacement', 'replacement reply')
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          threadId?: string
          onTurnStarted?: (payload: {
            threadId: string
            turnId: string
            previousThreadId?: string
          }) => Promise<void> | void
        }
      ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im',
      threadId: 'thr_missing',
      onTurnStarted
    })

    expect(result).toMatchObject({
      ok: true,
      text: 'replacement reply',
      message: 'replacement reply',
      threadId: 'thr_replacement'
    })
    expect(agentRuntime.startThread).toHaveBeenCalledTimes(1)
    expect(onTurnStarted).toHaveBeenCalledWith({
      threadId: 'thr_replacement',
      turnId: 'turn_replacement',
      previousThreadId: 'thr_missing'
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-runtime',
      'Configured IM thread was missing; creating a replacement thread.',
      expect.objectContaining({ threadId: 'thr_missing', source: 'im' })
    )
  })

  it('returns classified failures when local runtime reports a missing model', async () => {
    const settings = buildSettings()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_model_missing',
      startTurn: async () => {
        throw new Error(JSON.stringify({
          code: 'provider_unavailable',
          message: 'model deepseek-v4-pro is missing'
        }))
      }
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({
      ok: false,
      message: 'model deepseek-v4-pro is missing',
      failureKind: 'model_missing'
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('resolves IM auto to the managed Model Router alias without reading the legacy Kun model', async () => {
    const settings = buildSettings()
    settings.agents.sciforge.model = 'deepseek-v4-flash'
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_auto_model',
      turnId: 'turn_auto_model'
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; threadId?: string; turnId?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: '',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, threadId: 'thr_auto_model', turnId: 'turn_auto_model' })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('defaults generated-file thread inspection to the Codex runtime', async () => {
    const settings = buildSettings()
    const agentRuntime = completedAgentRuntime({
      readThread: async () => ({ id: 'thread-default-runtime', turns: [] })
    })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined
    })

    await (runtime as unknown as {
      recentGeneratedFilesForThread: (
        settingsArg: AppSettingsV1,
        threadId: string,
        workspaceRoot: string,
        context: Record<string, unknown>
      ) => Promise<unknown[]>
    }).recentGeneratedFilesForThread(settings, 'thread-default-runtime', '/tmp/workspace', {})

    expect(agentRuntime.readThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-default-runtime'
    })
  })

  it('resolves Codex IM auto to the Model Router runtime alias before agentRuntime calls', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex' as const,
        title: 'Codex IM',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          runtimeId: 'codex'
        }
      ) => Promise<{ ok: boolean; threadId?: string; turnId?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 2_000,
      source: 'im',
      runtimeId: 'codex'
    })

    expect(result).toMatchObject({ ok: true, threadId: 'codex-thread', turnId: 'codex-turn' })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
  })

  it('falls back to a plain Feishu chat message when replying to an inbound message fails', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: undefined, replyInThread: undefined }
    )
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-feishu',
      'Failed to send Feishu / Lark reply; falling back to plain chat message.',
      expect.objectContaining({
        channelId: 'channel_1',
        message: 'reply permission denied',
        purpose: 'agent-reply',
        replyTo: 'om_inbound',
        to: 'oc_chat_a'
      })
    )
  })

  it('queues Feishu messages per chat so SDK event handlers can ack immediately', async () => {
    const settings = buildSettings()
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const handleFeishuMessage = vi.fn(async (_channelId: string, message: { messageId: string }) => {
      order.push(`start:${message.messageId}`)
      if (message.messageId === 'om_1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      order.push(`end:${message.messageId}`)
    })
    ;(runtime as unknown as { handleFeishuMessage: typeof handleFeishuMessage })
      .handleFeishuMessage = handleFeishuMessage

    const enqueue = (runtime as unknown as {
      enqueueFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        chatType: 'p2p' | 'group'
        content: string
        rawContentType: string
        mentionedBot: boolean
        mentionAll: boolean
        mentions: unknown[]
        resources: unknown[]
      }) => void
    }).enqueueFeishuMessage.bind(runtime)

    enqueue('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_1',
      senderId: 'ou_1',
      chatType: 'p2p',
      content: 'first',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    })
    enqueue('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_2',
      senderId: 'ou_1',
      chatType: 'p2p',
      content: 'second',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    })

    await vi.waitFor(() => {
      expect(order).toEqual(['start:om_1'])
    })
    releaseFirst()
    await vi.waitFor(() => {
      expect(order).toEqual(['start:om_1', 'end:om_1', 'start:om_2', 'end:om_2'])
    })
  })

  it('drops duplicate Feishu message deliveries before queuing work', async () => {
    const settings = buildSettings()
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })
    const handleFeishuMessage = vi.fn(async () => undefined)
    ;(runtime as unknown as { handleFeishuMessage: typeof handleFeishuMessage })
      .handleFeishuMessage = handleFeishuMessage
    const enqueue = (runtime as unknown as {
      enqueueFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        chatType: 'p2p' | 'group'
        content: string
        rawContentType: string
        mentionedBot: boolean
        mentionAll: boolean
        mentions: unknown[]
        resources: unknown[]
      }) => void
    }).enqueueFeishuMessage.bind(runtime)
    const message = {
      chatId: 'oc_chat_a',
      messageId: 'om_duplicate',
      senderId: 'ou_1',
      chatType: 'p2p' as const,
      content: 'hello',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    }

    enqueue('channel_1', message)
    enqueue('channel_1', message)

    await vi.waitFor(() => {
      expect(handleFeishuMessage).toHaveBeenCalledTimes(1)
    })
  })

  it('drops duplicate Discord message ids before starting another agent turn', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'discord-thread-1',
        runtimeId: 'codex' as const,
        title: 'Discord thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { threadId: string }) => ({
        threadId: input.threadId,
        turnId: 'discord-turn-1'
      })),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Discord thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'discord-turn-1',
          threadId,
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'discord reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'discord reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const input = {
      provider: 'discord' as const,
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: 'dedupe this',
      sender: 'Alice',
      chatType: 'group' as const,
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-duplicate-message',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    }

    const first = await runtime.handleIncomingImMessage(input)
    const second = await runtime.handleIncomingImMessage(input)

    expect(first).toMatchObject({
      ok: true,
      threadId: 'discord-thread-1',
      reply: expect.stringContaining('discord reply')
    })
    expect(second).toEqual({
      ok: true,
      ignored: true,
      message: 'Duplicate remote message ignored.',
      reply: ''
    })
    expect(agentRuntime.startThread).toHaveBeenCalledTimes(1)
    expect(agentRuntime.startTurn).toHaveBeenCalledTimes(1)
    expect(current().remoteChannel.channels[0].recentMessages).toHaveLength(1)
    expect(current().remoteChannel.channels[0].recentMessages?.[0]).toMatchObject({
      provider: 'discord',
      messageId: 'discord-duplicate-message',
      text: 'dedupe this'
    })
  })

  it('ignores unmentioned Feishu group messages when channel guard mode is only_mention', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({ guardMode: 'only_mention' })]
    const forbiddenDirectCall = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const addReaction = vi.fn(async () => 'rc_1')
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_group_a',
      messageId: 'om_group_noise',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'group',
      mentionedBot: false,
      mentionAll: false,
      content: 'ambient group chatter',
      rawContentType: 'text',
      mentions: []
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(addReaction).not.toHaveBeenCalled()
  })

  it('ignores ordinary messages in guard mode off while still answering commands', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      guardMode: 'off',
      conversations: []
    })]
    const forbiddenDirectCall = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const baseInput = {
      provider: 'discord' as const,
      channelId: 'discord-bot-1-guild-1-channel-1',
      sender: 'Alice',
      chatType: 'group' as const,
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-guard-off-1',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    }

    const ignored = await runtime.handleIncomingImMessage({
      ...baseInput,
      text: 'ordinary message'
    })
    const command = await runtime.handleIncomingImMessage({
      ...baseInput,
      text: '/help',
      remoteSession: {
        ...baseInput.remoteSession,
        messageId: 'discord-guard-off-help'
      }
    })

    expect(ignored).toEqual({
      ok: true,
      ignored: true,
      message: 'Ignored by the current channel guard mode.',
      reply: ''
    })
    expect(command).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Remote channel commands')
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('handles all_messages Feishu groups through the shared channel thread', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_000
    settings.remoteChannel.channels = [buildChannel({
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_group',
      turnId: 'turn_group',
      text: 'group reply'
    })
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const addReaction = vi.fn(async () => 'rc_1')
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_group_a',
      messageId: 'om_group_1',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'group',
      mentionedBot: false,
      mentionAll: false,
      content: 'group task',
      rawContentType: 'text',
      mentions: []
    })

    expect(current().remoteChannel.channels[0]).toMatchObject({
      agentThreadIds: { codex: 'thr_group' },
      remoteSession: expect.objectContaining({ chatId: 'oc_group_a', messageId: 'om_group_1' })
    })
    expect(current().remoteChannel.channels[0].conversations).toEqual([])
    expect(send).toHaveBeenCalledWith(
      'oc_group_a',
      { markdown: 'group reply' },
      { replyTo: 'om_group_1', replyInThread: false }
    )
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('handles Feishu /clear locally by clearing the mapped IM thread', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    const conversation = buildConversation({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_old' }
    })
    settings.remoteChannel.channels = [buildChannel({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_old' },
      conversations: [conversation]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/clear',
      rawContentType: 'text',
      mentions: []
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Started a new topic. The next message will create a fresh local conversation.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    expect(current().remoteChannel.channels[0].agentThreadIds).toEqual({})
    expect(current().remoteChannel.channels[0].conversations[0].agentThreadIds).toEqual({})
    expect(current().remoteChannel.channels[0].remoteSession?.messageId).toBe('om_inbound')
  })

  it('creates a readable Feishu thread title for bare /new', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      runtimeId: 'codex',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_bare_new_feishu',
        runtimeId: 'codex' as const,
        title: 'Remote conversation - Alice',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_bare_new',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/new',
      rawContentType: 'text',
      mentions: []
    })

    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'Remote conversation - Alice'
    }))
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: expect.stringContaining('Remote conversation - Alice') },
      { replyTo: 'om_bare_new', replyInThread: false }
    )
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_bare_new_feishu' }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'oc_chat_a',
      latestMessageId: 'om_bare_new',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_bare_new_feishu' },
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('creates and binds a new IM thread from /new with a title', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'new-discord-thread',
        runtimeId: 'codex' as const,
        title: 'Fix Discord binding',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { threadId: string }) => ({
        threadId: input.threadId,
        turnId: 'new-discord-turn'
      })),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Fix Discord binding',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'new-discord-turn',
          threadId,
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'follow-up reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'follow-up reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/new Fix Discord binding',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-new-title',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Created and bound a local thread')
    })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'Fix Discord binding'
    }))
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'discord-bot-1-guild-1-channel-1',
      threadId: 'new-discord-thread',
      runtimeId: 'codex'
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-discord-thread' }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'channel-1',
      latestMessageId: 'discord-new-title',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-discord-thread' },
      workspaceRoot: '/tmp/workspace'
    })

    const where = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/where',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-new-where',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })
    expect(where).toMatchObject({
      ok: true,
      reply: expect.stringContaining('new-disc')
    })
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()

    const followUp = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: 'continue in the new thread',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-new-follow-up',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })
    expect(followUp).toMatchObject({
      ok: true,
      threadId: 'new-discord-thread',
      reply: expect.stringContaining('follow-up reply')
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'new-discord-thread',
      displayText: 'continue in the new thread'
    }))
  })

  it('returns the runtime reason when /new cannot create a thread', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      startThread: async () => {
        throw new Error(JSON.stringify({
          code: 'model_missing',
          message: 'model unavailable for workspace /tmp/workspace'
        }))
      }
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/new Fix failing model',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-new-failure',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('model unavailable for workspace /tmp/workspace')
    })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      lastFailure: expect.objectContaining({
        provider: 'discord',
        message: 'model unavailable for workspace /tmp/workspace',
        failureKind: 'model_missing',
        channelId: 'discord-bot-1-guild-1-channel-1',
        chatId: 'channel-1'
      })
    })
    expect(current().remoteChannel.channels[0].agentThreadIds?.codex).toBeUndefined()
    expect(current().remoteChannel.channels[0].conversations).toEqual([])
  })

  it('creates Codex /new IM threads through agentRuntime when the host is available', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected direct runtime path ${path}`)
    })
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-host-thread',
        runtimeId: 'codex',
        title: 'Fix failing model',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/new Fix failing model',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-new-host',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('codex:codex-ho...read')
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'Fix failing model'
    }))
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: {
        codex: 'codex-host-thread'
      }
    })
  })

  it('lists projects and switches to a selected thread in the current project', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.workspaceRoot = '/workspace/current'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      workspaceRoot: '/workspace/current',
      agentThreadIds: { codex: 'old-thread' },
      conversations: [],
      updatedAt: '2026-06-02T00:00:00.000Z'
    }), buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin_other',
      label: 'WeChat',
      workspaceRoot: '/workspace/target',
      updatedAt: '2026-06-03T00:00:00.000Z',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      listThreads: vi.fn(async () => [
        {
          id: 'target-thread',
          runtimeId: 'codex' as const,
          title: 'Target Thread',
          updatedAt: '2026-06-04T00:00:00.000Z',
          workspace: '/workspace/target',
          status: 'running'
        },
        {
          id: 'other-thread',
          runtimeId: 'codex' as const,
          title: 'Other Thread',
          updatedAt: '2026-06-04T00:00:00.000Z',
          workspace: '/workspace/other',
          status: 'completed'
        },
        {
          id: 'archived-thread',
          runtimeId: 'codex' as const,
          title: 'Archived Thread',
          updatedAt: '2026-06-05T00:00:00.000Z',
          workspace: '/workspace/target',
          status: 'completed',
          archived: true
        }
      ]),
      startThread: vi.fn(),
      startTurn: vi.fn(async (input: { threadId: string }) => ({
        threadId: input.threadId,
        turnId: 'target-turn'
      })),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Target Thread',
        updatedAt: '2026-06-04T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'target-turn',
          threadId,
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'target reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'target reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const input = (text: string, messageId: string) => runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text,
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId,
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    const projects = await input('/projects', 'discord-projects')
    const useProject = await input('/use project target', 'discord-use-project')
    const threads = await input('/threads', 'discord-threads')
    const archived = await input('/use thread Archived Thread', 'discord-use-archived-thread')
    const useThread = await input('/use thread 1', 'discord-use-thread')
    const followUp = await input('continue target work', 'discord-target-follow-up')

    expect(projects).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Available projects:')
    })
    expect((projects as { reply: string }).reply).toContain('/workspace/target'.slice(-6))
    expect(useProject).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Switched project to target')
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      workspaceRoot: '/workspace/target',
      agentThreadIds: {}
    })
    expect(threads).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Target Thread')
    })
    expect((threads as { reply: string }).reply).not.toContain('Other Thread')
    expect((threads as { reply: string }).reply).not.toContain('Archived Thread')
    expect(archived).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Thread not found')
    })
    expect(useThread).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Switched to thread')
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'channel-1',
      latestMessageId: 'discord-target-follow-up',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'target-thread' },
      workspaceRoot: '/workspace/target'
    })
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'discord-bot-1-guild-1-channel-1',
      threadId: 'target-thread',
      runtimeId: 'codex'
    })
    expect(agentRuntime.listThreads).toHaveBeenCalledWith({ runtimeId: 'codex', limit: 50, includeArchived: false })
    expect(followUp).toMatchObject({
      ok: true,
      threadId: 'target-thread',
      reply: expect.stringContaining('target reply')
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'target-thread',
      displayText: 'continue target work'
    }))
  }, 12_000)

  it('returns a recoverable /threads reply when listThreads is unavailable without mutating or starting a turn', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      workspaceRoot: '/tmp/workspace',
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const createScheduledTaskFromText = vi.fn(async () => ({ kind: 'noop' as const }))
    const logError = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError,
      createScheduledTaskFromText
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/threads',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-threads-unavailable',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('thread list is unavailable')
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })
    expect(current().remoteChannel.channels[0].remoteSession).toBeUndefined()
    expect(store.patch).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-runtime',
      'Unable to list IM thread candidates because AgentRuntimeHost.listThreads is unavailable.',
      expect.objectContaining({ runtimeId: 'codex' })
    )
  })

  it('returns a recoverable /use thread reply when listThreads throws without mutating or starting a turn', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      workspaceRoot: '/tmp/workspace',
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const createScheduledTaskFromText = vi.fn(async () => ({ kind: 'noop' as const }))
    const logError = vi.fn()
    const agentRuntime = {
      listThreads: vi.fn(async () => {
        throw new Error('runtime host unavailable')
      }),
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError,
      createScheduledTaskFromText
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/use thread 1',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-use-thread-unavailable',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('thread list is unavailable')
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })
    expect(current().remoteChannel.channels[0].remoteSession).toBeUndefined()
    expect(store.patch).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-runtime',
      'Failed to list IM thread candidates.',
      expect.objectContaining({
        runtimeId: 'codex',
        message: 'runtime host unavailable'
      })
    )
  })

  it('returns webhook /threads degradation as 200 instead of 500 when listThreads throws', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      workspaceRoot: '/tmp/workspace',
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })]
    const { store } = mutableSettingsStore(settings)
    const createScheduledTaskFromText = vi.fn(async () => ({ kind: 'noop' as const }))
    const agentRuntime = {
      listThreads: vi.fn(async () => {
        throw new Error('runtime host unavailable')
      }),
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({
      text: '/threads',
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('thread list is unavailable')
    })
    expect(store.patch).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'not found',
      text: '/use thread Missing Thread',
      reply: 'Thread not found',
      threads: [{
        id: 'target-thread',
        runtimeId: 'codex' as const,
        title: 'Target Thread',
        updatedAt: '2026-06-04T00:00:00.000Z',
        workspace: '/tmp/workspace',
        status: 'completed'
      }]
    },
    {
      name: 'ambiguous',
      text: '/use thread Duplicate Thread',
      reply: 'Thread name is ambiguous',
      threads: [{
        id: 'duplicate-thread-1',
        runtimeId: 'codex' as const,
        title: 'Duplicate Thread',
        updatedAt: '2026-06-04T00:00:00.000Z',
        workspace: '/tmp/workspace',
        status: 'completed'
      }, {
        id: 'duplicate-thread-2',
        runtimeId: 'codex' as const,
        title: 'Duplicate Thread',
        updatedAt: '2026-06-05T00:00:00.000Z',
        workspace: '/tmp/workspace',
        status: 'completed'
      }]
    },
    {
      name: 'archived returned by provider',
      text: '/use thread Archived Thread',
      reply: 'Thread not found',
      threads: [{
        id: 'archived-thread',
        runtimeId: 'codex' as const,
        title: 'Archived Thread',
        updatedAt: '2026-06-04T00:00:00.000Z',
        workspace: '/tmp/workspace',
        status: 'completed',
        archived: true
      }]
    }
  ])('does not mutate or start a turn when /use thread selector is $name', async ({ text, reply, threads }) => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      workspaceRoot: '/tmp/workspace',
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const createScheduledTaskFromText = vi.fn(async () => ({ kind: 'noop' as const }))
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      listThreads: vi.fn(async () => threads),
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn()
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text,
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: `discord-${text.replace(/\W+/g, '-').toLowerCase()}`,
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining(reply)
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      agentThreadIds: { codex: 'old-thread' },
      conversations: []
    })
    expect(current().remoteChannel.channels[0].remoteSession).toBeUndefined()
    expect(store.patch).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(notifyChannelActivity).not.toHaveBeenCalled()
  })

  it('reports current remote jobs by reading the bound thread', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: [buildConversation({
        chatId: 'channel-1',
        latestMessageId: 'discord-previous',
        runtimeId: 'codex',
        localThreadId: '',
        agentThreadIds: { codex: 'jobs-thread' },
        workspaceRoot: '/tmp/workspace'
      })]
    })]
    const agentRuntime = {
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn(async () => ({
        id: 'jobs-thread',
        runtimeId: 'codex' as const,
        title: 'Jobs thread',
        updatedAt: '2026-06-04T00:00:00.000Z',
        latestSeq: 3,
        turns: [
          { id: 'turn-running', threadId: 'jobs-thread', status: 'running' as const, items: [] },
          { id: 'turn-failed', threadId: 'jobs-thread', status: 'failed' as const, items: [] },
          { id: 'turn-done', threadId: 'jobs-thread', status: 'completed' as const, items: [] }
        ],
        items: []
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/jobs',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: {
        chatId: 'channel-1',
        messageId: 'discord-jobs',
        threadId: '',
        senderId: 'user-1',
        senderName: 'Alice'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Current jobs')
    })
    const reply = (result as { reply: string }).reply
    expect(reply).toContain('Running/queued: 1')
    expect(reply).toContain('Failed: 1')
    expect(reply).toContain('Done: 1')
    expect(reply).toContain('Latest: turn-done completed')
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
  })

  it('rejects Feishu model change commands without mutating the current IM channel', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel()]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '-model flash',
      rawContentType: 'text',
      mentions: []
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(current().remoteChannel.channels[0].model).toBe('auto')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Remote channels do not support changing the model from IM. Change it in GUI or runtime settings.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
  })

  it('handles generic IM lifecycle commands for mode, summary, status, detach, and new private', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'thr_summary' }
      })]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      readThread: async () => ({
        id: 'thr_summary',
        items: [{ kind: 'compaction_event', summary: 'Short project summary.' }]
      })
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const commandInput = (text: string, messageId: string) => runtime.handleIncomingImMessage({
      provider: 'weixin',
      channelId: 'channel_weixin',
      text,
      sender: 'Alice',
      remoteSession: {
        chatId: 'wx_user_1',
        messageId,
        threadId: '',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      }
    })

    await expect(commandInput('/mode plan', 'wx_msg_mode')).resolves.toMatchObject({
      ok: true,
      reply: 'Remote channels do not support changing run mode from IM. Change it in GUI or runtime settings.'
    })
    expect(current().remoteChannel.im.mode).toBe('agent')

    await expect(commandInput('/status', 'wx_msg_status')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Mode: agent')
    })
    await expect(commandInput('where', 'wx_msg_where')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Workspace: /tmp/workspace/conversations/oc_chat_a')
    })
    await expect(commandInput('/where', 'wx_msg_slash_where')).resolves.toMatchObject({
      ok: true,
      reply: expect.not.stringContaining('[redacted-path]')
    })
    await expect(commandInput('/summary', 'wx_msg_summary')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Short project summary.')
    })
    await expect(commandInput('/new private', 'wx_msg_private')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('not supported yet')
    })
    await expect(commandInput('/detach', 'wx_msg_detach')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Detached')
    })
    expect(current().remoteChannel.channels[0].conversations[0].agentThreadIds).toEqual({})
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('handles webhook /help as an IM command before starting a local runtime turn', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({ provider: 'weixin' as const, id: 'channel_weixin' })]
    const { store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const createScheduledTaskFromText = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: '/help', provider: 'weixin', channelId: 'channel_weixin' })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Remote channel commands:')
    })
    const reply = JSON.parse(responseBody).reply as string
    for (const command of [
      '/help',
      '/where',
      '/projects',
      '/use project <number or name>',
      '/threads',
      '/use thread <number or name>',
      '/new <title>',
      '/attach current',
      '/jobs',
      '/model',
      '/mode'
    ]) {
      expect(reply).toContain(command)
    }
    expect(reply).not.toContain('/model auto')
    expect(reply).not.toContain('/mode agent|plan')
    expect(reply).toContain('Ordinary messages go to the currently bound local thread')
    expect(reply).toContain('will not keep following desktop focus')
    expect(reply).toContain('queued in order')
    expect(reply).toContain('Examples:')
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('rejects the retired gui-plan webhook endpoint through normal routing', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const req = {
      method: 'POST',
      url: '/claw/internal/gui-plan/create',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ kind: 'gui_plan_create', prompt: 'legacy plan' }))
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(404)
    expect(JSON.parse(responseBody)).toEqual({ ok: false, message: 'Not found.' })
  })

  it('authenticates IM webhooks with Bearer or x-sciforge-secret only', async () => {
    const settings = buildSettings()
    const secret = 'webhook-secret'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.secret = secret
    settings.remoteChannel.channels = [buildChannel({ provider: 'weixin' as const, id: 'channel_weixin' })]
    const { store } = mutableSettingsStore(settings)
    const createScheduledTaskFromText = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    let messageIndex = 0
    const post = async (headers: Record<string, string>): Promise<{
      status: number
      body: Record<string, unknown>
    }> => {
      messageIndex += 1
      const body = JSON.stringify({
        text: '/help',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: `wx_auth_${messageIndex}`
      })
      const req = {
        method: 'POST',
        url: settings.remoteChannel.im.path,
        headers,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }
      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)
      return { status, body: JSON.parse(responseBody) as Record<string, unknown> }
    }

    await expect(post({})).resolves.toMatchObject({
      status: 401,
      body: { ok: false, message: 'Unauthorized.' }
    })
    await expect(post({ 'x-sciforge-secret': secret })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, reply: expect.stringContaining('Remote channel commands:') }
    })
    await expect(post({ authorization: `Bearer ${secret}` })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, reply: expect.stringContaining('Remote channel commands:') }
    })
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
  })

  it('returns clear webhook degradation messages for empty, attachment-only, and oversized input', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({ provider: 'discord' as const, id: 'channel_discord' })]
    const forbiddenDirectCall = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const post = async (payload: Record<string, unknown>): Promise<{ status: number; body: { ok: false; message: string } }> => {
      const req = {
        method: 'POST',
        url: settings.remoteChannel.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify(payload))
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((body: string) => {
          responseBody = body
        })
      }
      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)
      return { status, body: JSON.parse(responseBody) as { ok: false; message: string } }
    }

    const empty = await post({ provider: 'discord', text: '   ' })
    const attachmentOnly = await post({
      provider: 'discord',
      attachments: [{ url: 'https://cdn.example/debug.png', filename: 'debug.png' }]
    })
    const oversized = await post({
      provider: 'discord',
      text: 'x'.repeat(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.discord.maxMessageLength + 1)
    })

    expect(empty).toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'No message text found. Send a text message to continue.'
      }
    })
    expect(attachmentOnly.status).toBe(400)
    expect(attachmentOnly.body).toMatchObject({
      ok: false,
      message: expect.stringContaining('Attachments-only remote messages are not supported yet')
    })
    expect(oversized.status).toBe(400)
    expect(oversized.body).toMatchObject({
      ok: false,
      message: expect.stringContaining('Message is too long')
    })
    expect(oversized.body.message).toContain('2001/2000')
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('returns a generic webhook error while logging a redacted diagnostic', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: {
        load: vi.fn(async () => {
          throw new Error('Authorization: Bearer raw-webhook-secret failed')
        }),
        patch: vi.fn(async () => settings)
      } as never,
      logError
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ text: 'hello' }))
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toEqual({ ok: false, message: 'Internal server error.' })
    expect(responseBody).not.toContain('raw-webhook-secret')
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-webhook',
      'Remote channel webhook request failed',
      expect.objectContaining({
        message: 'Authorization: Bearer <redacted> failed'
      })
    )
  })

  it('sanitizes structured webhook failures returned by IM processing', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_000
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { store } = mutableSettingsStore(settings)
    const logError = vi.fn()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_weixin',
      startTurn: async () => {
        throw new Error(JSON.stringify({
          code: 'runtime_error',
          message: 'Authorization: Bearer raw-runtime-secret failed'
        }))
      }
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_secret',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toEqual({
      ok: false,
      message: 'Runtime offline',
      failureKind: 'runtime_offline'
    })
    expect(responseBody).not.toContain('raw-runtime-secret')
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-webhook',
      'Remote channel webhook returned a structured failure.',
      expect.objectContaining({
        failure: expect.objectContaining({
          message: 'Authorization: Bearer <redacted> failed'
        })
      })
    )
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('attaches a remote IM conversation to the active desktop thread', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const notifyChannelActivity = vi.fn()
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '/attach current',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_attach',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody).reply).toContain('Attached to the active desktop conversation')
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'desktop-thread-1',
      runtimeId: 'codex'
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_attach',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' },
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('keeps Discord messages on the conversation attached to the active desktop thread', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      agentThreadIds: { codex: 'old-channel-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    let activeThreadId = 'desktop-thread-1'
    let turnIndex = 0
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { threadId: string }) => {
        turnIndex += 1
        return {
          threadId: input.threadId,
          turnId: `discord-turn-${turnIndex}`
        }
      }),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Attached Discord thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: turnIndex,
        turns: [{
          id: `discord-turn-${turnIndex}`,
          threadId,
          status: 'completed' as const,
          items: [{ id: `assistant-${turnIndex}`, kind: 'assistant_message' as const, text: `reply ${turnIndex}` }]
        }],
        items: [{ id: `assistant-${turnIndex}`, kind: 'assistant_message' as const, text: `reply ${turnIndex}` }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: activeThreadId,
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity: vi.fn(),
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const remoteSession = (messageId: string) => ({
      chatId: 'channel-1',
      messageId,
      threadId: '',
      senderId: 'user-1',
      senderName: 'Alice'
    })

    const attach = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: '/attach current',
      sender: 'Alice',
      chatType: 'group',
      remoteSession: remoteSession('discord-attach-1')
    })
    activeThreadId = 'desktop-thread-2'

    const messages = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        runtime.handleIncomingImMessage({
          provider: 'discord',
          channelId: 'discord-bot-1-guild-1-channel-1',
          text: `E2E_ATTACH_00${index + 1}`,
          sender: 'Alice',
          chatType: 'group',
          remoteSession: remoteSession(`discord-message-${index + 1}`)
        })
      )
    )

    expect(attach).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Attached to the active desktop conversation')
    })
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(messages).toHaveLength(5)
    for (const message of messages) {
      expect(message).toMatchObject({ ok: true, threadId: 'desktop-thread-1' })
    }
    expect(messages.filter((message) => 'reply' in message && message.reply?.trim())).toHaveLength(5)
    expect(agentRuntime.startTurn).toHaveBeenCalledTimes(5)
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'desktop-thread-1',
      displayText: 'E2E_ATTACH_001'
    }))
    expect(agentRuntime.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'desktop-thread-2'
    }))
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' }
    })
    expect(current().remoteChannel.channels[0].conversations).toHaveLength(1)
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'channel-1',
      latestMessageId: 'discord-message-5',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' },
      workspaceRoot: '/tmp/workspace'
    })
    expect(current().remoteChannel.channels[0].recentMessages?.filter((message) =>
      message.text?.startsWith('E2E_ATTACH_')
    )).toHaveLength(5)
  }, 15_000)

  it.each([
    { provider: 'discord' as const, channelId: 'channel_discord', chatId: 'discord-channel', chatType: 'group' as const },
    { provider: 'feishu' as const, channelId: 'channel_feishu', chatId: 'oc_chat_a', chatType: 'p2p' as const },
    { provider: 'weixin' as const, channelId: 'channel_weixin', chatId: 'wx_user_1', chatType: 'p2p' as const }
  ])('keeps %s remote conversations on the attach-bound thread after desktop focus changes', async ({ provider, channelId, chatId, chatType }) => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider,
      id: channelId,
      label: provider,
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    let activeThreadId = 'desktop-thread-a'
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { threadId: string }) => ({
        threadId: input.threadId,
        turnId: `${provider}-turn`
      })),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Attached thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: `${provider}-turn`,
          threadId,
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: `${provider} reply` }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: `${provider} reply` }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: activeThreadId,
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const remoteSession = (messageId: string) => ({
      chatId,
      messageId,
      threadId: '',
      senderId: 'remote-user-1',
      senderName: 'Alice'
    })

    await runtime.handleIncomingImMessage({
      provider,
      channelId,
      text: '/attach current',
      sender: 'Alice',
      chatType,
      remoteSession: remoteSession(`${provider}-attach`)
    })
    activeThreadId = 'desktop-thread-b'
    const followUp = await runtime.handleIncomingImMessage({
      provider,
      channelId,
      text: `${provider} follow-up`,
      sender: 'Alice',
      chatType,
      remoteSession: remoteSession(`${provider}-follow-up`)
    })

    expect(followUp).toMatchObject({
      ok: true,
      threadId: 'desktop-thread-a',
      reply: expect.stringContaining(`${provider} reply`)
    })
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'desktop-thread-a',
      displayText: `${provider} follow-up`
    }))
    expect(agentRuntime.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'desktop-thread-b'
    }))
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId,
      latestMessageId: `${provider}-follow-up`,
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-a' },
      workspaceRoot: '/tmp/workspace'
    })
  }, 15_000)

  it('records WeChat webhook conversations and returns the GUI-generated reply', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_weixin',
      turnId: 'turn_weixin',
      text: 'hello from GUI'
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('hello from GUI')
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(JSON.parse(responseBody).reply).toContain('Remote channel commands:')
    expect(current().remoteChannel.channels[0].agentThreadIds).toEqual({ codex: 'thr_weixin' })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      agentThreadIds: { codex: 'thr_weixin' }
    })
  })

  it('handles Codex-bound IM channels through agentRuntime instead of direct /v1 call', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: 'local-thread',
      agentThreadIds: { sciforge: 'local-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected direct runtime path ${path}`)
    })
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex' as const,
        title: 'Codex IM',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex' as const,
        title: 'Codex thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'hello from codex' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'hello from codex' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('hello from codex')
    })
    expect(JSON.parse(responseBody).reply).toContain('Remote channel commands:')
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Remote channel:WeChat] webhook'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: expect.stringContaining('你好'),
      displayText: '你好'
    }))
    expect(agentRuntime.readThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'local-thread',
        codex: 'codex-thread'
      }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: {
        codex: 'codex-thread'
      }
    })
  })

  it('passes rich inbound IM content to runtime while keeping the display text readable', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'discord-bot-1-guild-1-channel-1',
      label: '#debug',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const richText = [
      '第一行 with **Markdown** and @gzy 🚀',
      '',
      '```ts',
      'const mention = "@assistant";',
      'console.log("中文 emoji 😊");',
      '```',
      '> quoted follow-up'
    ].join('\n')
    const runtimePrompt = [
      '[Discord inbound message]',
      'Guild: gzy的服务器',
      'Channel: #debug',
      'Sender: gzy',
      'Mentions: @assistant, @all',
      '',
      richText
    ].join('\n')
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'rich-discord-thread',
        runtimeId: 'codex' as const,
        title: 'Rich Discord thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { threadId: string; text: string; displayText?: string }) => ({
        threadId: input.threadId,
        turnId: 'rich-discord-turn'
      })),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Rich Discord thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'rich-discord-turn',
          threadId,
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'rich reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'rich reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })

    const result = await runtime.handleIncomingImMessage({
      provider: 'discord',
      channelId: 'discord-bot-1-guild-1-channel-1',
      text: richText,
      runtimePrompt,
      sender: 'gzy',
      chatType: 'group',
      remoteSession: {
        chatId: 'discord-channel-1',
        messageId: 'discord-rich-message',
        threadId: '',
        senderId: 'user-1',
        senderName: 'gzy'
      }
    })

    expect(result).toMatchObject({
      ok: true,
      threadId: 'rich-discord-thread',
      reply: expect.stringContaining('rich reply')
    })
    const turnInput = agentRuntime.startTurn.mock.calls[0]?.[0] as unknown as { text: string; displayText?: string }
    expect(turnInput.displayText).toBe(richText)
    expect(turnInput.text).toContain('[Discord inbound message]')
    expect(turnInput.text).toContain('Guild: gzy的服务器')
    expect(turnInput.text).toContain('Mentions: @assistant, @all')
    expect(turnInput.text).toContain('第一行 with **Markdown** and @gzy 🚀')
    expect(turnInput.text).toContain([
      '```ts',
      'const mention = "@assistant";',
      'console.log("中文 emoji 😊");',
      '```'
    ].join('\n'))
  })

  it('reports runtime offline to the remote caller and keeps the binding usable after recovery', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        localThreadId: '',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'bound-codex-thread' },
        workspaceRoot: '/tmp/workspace'
      })]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected direct runtime path ${path}`)
    })
    const agentRuntime = {
      startThread: vi.fn(),
      startTurn: vi.fn()
        .mockRejectedValueOnce(new Error('app-server offline'))
        .mockResolvedValueOnce({
          threadId: 'bound-codex-thread',
          turnId: 'codex-turn-recovered'
        }),
      readThread: vi.fn(async () => ({
        id: 'bound-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Recovered phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn-recovered',
          threadId: 'bound-codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'recovered reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'recovered reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const post = async (text: string, messageId: string): Promise<{
      status: number
      body: Record<string, unknown>
    }> => {
      const req = {
        method: 'POST',
        url: settings.remoteChannel.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            text,
            provider: 'weixin',
            channelId: 'channel_weixin',
            chatId: 'wx_user_1',
            messageId,
            senderId: 'wx_user_1',
            senderName: 'Alice'
          }))
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((body: string) => {
          responseBody = body
        })
      }
      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)
      return { status, body: JSON.parse(responseBody) as Record<string, unknown> }
    }

    const offline = await post('first while runtime is offline', 'wx_offline')

    expect(offline).toEqual({
      status: 500,
      body: {
        ok: false,
        message: 'Runtime offline',
        failureKind: 'runtime_offline'
      }
    })
    expect(current().remoteChannel.channels[0].conversations[0].lastFailure).toMatchObject({
      provider: 'weixin',
      message: 'app-server offline',
      failureKind: 'runtime_offline',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      threadId: 'bound-codex-thread',
      runtimeId: 'codex'
    })

    const recovered = await post('second after runtime recovers', 'wx_recovered')
    expect(recovered).toMatchObject({
      status: 200,
      body: {
        ok: true,
        threadId: 'bound-codex-thread',
        reply: expect.stringContaining('recovered reply')
      }
    })
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'bound-codex-thread',
      displayText: 'first while runtime is offline'
    }))
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'bound-codex-thread',
      displayText: 'second after runtime recovers'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_recovered',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'bound-codex-thread' }
    })
  })

  it('returns an empty-response failure when a Codex IM turn completes without assistant text', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.remoteChannel.im.enabled = true
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex IM',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async () => ({
          threadId: 'codex-thread',
          turnId: 'codex-turn'
        })),
        readThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex thread',
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: 1,
          turns: [{
            id: 'codex-turn',
            threadId: 'codex-thread',
            status: 'completed' as const,
            items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
          }],
          items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
        }))
      }
      const runtime = createRemoteChannelRuntime({
        store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
        agentRuntime,
        logError: () => undefined
      })

      const resultPromise = (runtime as unknown as {
        runPrompt: (
          settingsArg: AppSettingsV1,
          options: {
            prompt: string
            title: string
            workspaceRoot: string
            model: string
            mode: 'agent' | 'plan'
            waitForResult: boolean
            responseTimeoutMs: number
            source: 'task' | 'im'
            runtimeId: 'codex'
          }
        ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
      }).runPrompt(settings, {
        prompt: 'hello',
        title: 'demo',
        workspaceRoot: '/tmp/workspace',
        model: 'auto',
        mode: 'agent',
        waitForResult: true,
        responseTimeoutMs: 10_000,
        source: 'im',
        runtimeId: 'codex'
      })

      await vi.advanceTimersByTimeAsync(1_500)

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        message: 'Agent completed without a reply.',
        failureKind: 'empty_response'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not block the IM queue when timed-out Codex interrupt never resolves', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.remoteChannel.im.enabled = true
      const logError = vi.fn()
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex IM',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async () => ({
          threadId: 'codex-thread',
          turnId: 'codex-turn'
        })),
        readThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex thread',
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: 1,
          turns: [{
            id: 'codex-turn',
            threadId: 'codex-thread',
            status: 'running' as const,
            items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
          }],
          items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
        })),
        interruptTurn: vi.fn(() => new Promise<void>(() => undefined))
      }
      const runtime = createRemoteChannelRuntime({
        store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
        agentRuntime,
        logError
      })

      const resultPromise = (runtime as unknown as {
        runPrompt: (
          settingsArg: AppSettingsV1,
          options: {
            prompt: string
            title: string
            workspaceRoot: string
            model: string
            mode: 'agent' | 'plan'
            waitForResult: boolean
            responseTimeoutMs: number
            source: 'task' | 'im'
            runtimeId: 'codex'
          }
        ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
      }).runPrompt(settings, {
        prompt: 'hello',
        title: 'demo',
        workspaceRoot: '/tmp/workspace',
        model: 'auto',
        mode: 'agent',
        waitForResult: true,
        responseTimeoutMs: 1,
        source: 'im',
        runtimeId: 'codex'
      })

      await vi.advanceTimersByTimeAsync(1_500)
      await vi.advanceTimersByTimeAsync(5_000)

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        message: 'Timed out waiting for agent response.',
        failureKind: 'timeout'
      })
      expect(logError).toHaveBeenCalledWith(
        'remote-channel-runtime',
        'Failed to interrupt timed out agent turn.',
        expect.objectContaining({
          runtimeId: 'codex',
          threadId: 'codex-thread',
          turnId: 'codex-turn',
          message: 'Timed out interrupting agent turn.'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a conversation-bound Codex thread for an unbound phone conversation instead of following desktop or channel focus', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: { codex: 'last-channel-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected direct runtime path ${path}`)
    })
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'new-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'new-codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'new-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'new-codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '从手机继续当前会话',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'new-codex-thread',
      reply: expect.stringContaining('phone reply')
    })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Remote channel:WeChat] webhook'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'new-codex-thread',
      text: expect.stringContaining('从手机继续当前会话'),
      displayText: '从手机继续当前会话'
    }))
    expect(agentRuntime.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'last-channel-thread'
    }))
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'new-codex-thread',
      runtimeId: 'codex'
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-codex-thread' }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-codex-thread' },
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('serializes Feishu private messages with per-message remote thread ids on one local conversation', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 3_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'feishu' as const,
      id: 'channel_feishu',
      label: 'Feishu',
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: {},
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    let createdThreads = 0
    let turns = 0
    const agentRuntime = {
      startThread: vi.fn(async () => {
        createdThreads += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return {
          id: `phone-thread-${createdThreads}`,
          runtimeId: 'codex' as const,
          title: 'Phone thread',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      }),
      startTurn: vi.fn(async (input: { threadId: string }) => {
        turns += 1
        return {
          threadId: input.threadId,
          turnId: `turn-${turns}`
        }
      }),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 2,
        turns: [
          {
            id: 'turn-1',
            threadId,
            status: 'completed' as const,
            items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'reply to Q1' }]
          },
          {
            id: 'turn-2',
            threadId,
            status: 'completed' as const,
            items: [{ id: 'assistant-2', kind: 'assistant_message' as const, text: 'reply to Q2' }]
          }
        ],
        items: [
          { id: 'assistant-1', kind: 'assistant_message' as const, text: 'reply to Q1' },
          { id: 'assistant-2', kind: 'assistant_message' as const, text: 'reply to Q2' }
        ]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      notifyChannelActivity: vi.fn(),
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })

    const [first, second] = await Promise.all([
      runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'Q1',
        sender: 'Alice',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_private_chat',
          messageId: 'om_q1',
          threadId: 'om_q1_remote_thread',
          senderId: 'ou_alice',
          senderName: 'Alice'
        }
      }),
      runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'Q2',
        sender: 'Alice',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_private_chat',
          messageId: 'om_q2',
          threadId: 'om_q2_remote_thread',
          senderId: 'ou_alice',
          senderName: 'Alice'
        }
      })
    ])

    expect(first).toMatchObject({ ok: true, threadId: 'phone-thread-1', reply: expect.stringContaining('reply to Q1') })
    expect(second).toMatchObject({ ok: true, threadId: 'phone-thread-1', reply: expect.stringContaining('reply to Q2') })
    expect(agentRuntime.startThread).toHaveBeenCalledTimes(1)
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'phone-thread-1',
      displayText: 'Q1'
    }))
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'phone-thread-1',
      displayText: 'Q2'
    }))
    expect(current().remoteChannel.channels[0].conversations).toHaveLength(1)
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      chatId: 'oc_private_chat',
      remoteThreadId: '',
      latestMessageId: 'om_q2',
      agentThreadIds: { codex: 'phone-thread-1' }
    })
    expect(current().remoteChannel.channels[0].recentMessages).toEqual([
      expect.objectContaining({
        messageId: 'om_q1',
        senderName: 'Alice',
        text: 'Q1'
      }),
      expect.objectContaining({
        messageId: 'om_q2',
        senderName: 'Alice',
        text: 'Q2'
      })
    ])
  })

  it('adds queued/running hints to queued messages in the same remote conversation', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.remoteChannel.im.enabled = true
      settings.remoteChannel.im.responseTimeoutMs = 10_000
      settings.remoteChannel.channels = [buildChannel({
        provider: 'discord' as const,
        id: 'discord-bot-1-guild-1-channel-1',
        label: '#debug',
        runtimeId: 'codex',
        guardMode: 'all_messages',
        threadId: '',
        agentThreadIds: {},
        conversations: [buildConversation({
          id: 'conversation-discord',
          chatId: 'channel-1',
          remoteThreadId: '',
          latestMessageId: 'discord-previous',
          localThreadId: '',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'discord-thread-1' },
          workspaceRoot: '/tmp/workspace'
        })]
      })]
      const { store } = mutableSettingsStore(settings)
      const startedTexts: string[] = []
      let releaseFirstTurn: () => void = () => undefined
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'unexpected-new-thread',
          runtimeId: 'codex' as const,
          title: 'Unexpected',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async (input: { threadId: string; displayText?: string }) => {
          const displayText = input.displayText ?? ''
          startedTexts.push(displayText)
          if (displayText === 'A') {
            await new Promise<void>((resolve) => {
              releaseFirstTurn = resolve
            })
          }
          return {
            threadId: input.threadId,
            turnId: `turn-${displayText.toLowerCase()}`
          }
        }),
        readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          runtimeId: 'codex' as const,
          title: 'Discord thread',
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: startedTexts.length,
          turns: startedTexts.map((text) => ({
            id: `turn-${text.toLowerCase()}`,
            threadId,
            status: 'completed' as const,
            items: [{ id: `assistant-${text}`, kind: 'assistant_message' as const, text: `reply ${text}` }]
          })),
          items: startedTexts.map((text) => ({
            id: `assistant-${text}`,
            kind: 'assistant_message' as const,
            turnId: `turn-${text.toLowerCase()}`,
            text: `reply ${text}`
          }))
        }))
      }
      const runtime = createRemoteChannelRuntime({
        store: store as never,
        agentRuntime,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const input = (text: string, messageId: string) => runtime.handleIncomingImMessage({
        provider: 'discord',
        channelId: 'discord-bot-1-guild-1-channel-1',
        text,
        sender: 'Alice',
        chatType: 'group',
        remoteSession: {
          chatId: 'channel-1',
          messageId,
          threadId: '',
          senderId: 'user-1',
          senderName: 'Alice'
        }
      })

      const firstPromise = input('A', 'discord-message-a')
      await vi.waitFor(() => {
        expect(startedTexts).toEqual(['A'])
      })
      const secondPromise = input('B', 'discord-message-b')
      const thirdPromise = input('C', 'discord-message-c')
      await Promise.resolve()
      expect(startedTexts).toEqual(['A'])

      releaseFirstTurn()
      for (let index = 0; index < 5; index += 1) {
        await vi.advanceTimersByTimeAsync(1_500)
      }
      const [first, second, third] = await Promise.all([firstPromise, secondPromise, thirdPromise])

      expect(first).toMatchObject({ ok: true, threadId: 'discord-thread-1', reply: expect.stringContaining('reply A') })
      expect(second).toMatchObject({ ok: true, threadId: 'discord-thread-1', reply: expect.stringContaining('reply B') })
      expect(third).toMatchObject({ ok: true, threadId: 'discord-thread-1', reply: expect.stringContaining('reply C') })
      expect((second as { reply: string }).reply.toLowerCase()).toContain('queued/running')
      expect((third as { reply: string }).reply.toLowerCase()).toContain('queued/running')
      expect(agentRuntime.startThread).not.toHaveBeenCalled()
      expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
        threadId: 'discord-thread-1',
        governanceProfile: 'remote_guard',
        displayText: 'A'
      }))
      expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
        threadId: 'discord-thread-1',
        governanceProfile: 'remote_guard',
        displayText: 'B'
      }))
      expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(3, expect.objectContaining({
        threadId: 'discord-thread-1',
        governanceProfile: 'remote_guard',
        displayText: 'C'
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs different remote conversations in parallel when they are bound to different threads', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.remoteChannel.im.enabled = true
      settings.remoteChannel.im.responseTimeoutMs = 10_000
      settings.remoteChannel.channels = [buildChannel({
        provider: 'feishu' as const,
        id: 'channel_feishu',
        label: 'Feishu',
        runtimeId: 'codex',
        threadId: '',
        agentThreadIds: {},
        conversations: [
          buildConversation({
            id: 'conversation-a',
            chatId: 'oc_chat_a',
            remoteThreadId: '',
            latestMessageId: 'om_previous_a',
            localThreadId: '',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'thread-a' },
            workspaceRoot: '/tmp/workspace'
          }),
          buildConversation({
            id: 'conversation-b',
            chatId: 'oc_chat_b',
            remoteThreadId: '',
            latestMessageId: 'om_previous_b',
            localThreadId: '',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'thread-b' },
            workspaceRoot: '/tmp/workspace'
          })
        ]
      })]
      const { store } = mutableSettingsStore(settings)
      const startedTurns: string[] = []
      let releaseThreadA: () => void = () => undefined
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'unexpected-new-thread',
          runtimeId: 'codex' as const,
          title: 'Unexpected',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async (input: { threadId: string; displayText?: string }) => {
          startedTurns.push(`${input.threadId}:${input.displayText ?? ''}`)
          if (input.threadId === 'thread-a') {
            await new Promise<void>((resolve) => {
              releaseThreadA = resolve
            })
          }
          return {
            threadId: input.threadId,
            turnId: `turn-${input.threadId}`
          }
        }),
        readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          runtimeId: 'codex' as const,
          title: `Thread ${threadId}`,
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: 1,
          turns: [{
            id: `turn-${threadId}`,
            threadId,
            status: 'completed' as const,
            items: [{ id: `assistant-${threadId}`, kind: 'assistant_message' as const, text: `reply ${threadId}` }]
          }],
          items: [{ id: `assistant-${threadId}`, kind: 'assistant_message' as const, turnId: `turn-${threadId}`, text: `reply ${threadId}` }]
        }))
      }
      const runtime = createRemoteChannelRuntime({
        store: store as never,
        agentRuntime,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })

      const firstPromise = runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'work A',
        sender: 'Alice',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_chat_a',
          messageId: 'om_a',
          threadId: '',
          senderId: 'ou_a',
          senderName: 'Alice'
        }
      })
      await vi.waitFor(() => {
        expect(startedTurns).toEqual(['thread-a:work A'])
      })
      const secondPromise = runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'work B',
        sender: 'Bob',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_chat_b',
          messageId: 'om_b',
          threadId: '',
          senderId: 'ou_b',
          senderName: 'Bob'
        }
      })

      await vi.waitFor(() => {
        expect(startedTurns).toEqual(['thread-a:work A', 'thread-b:work B'])
      })
      releaseThreadA()
      for (let index = 0; index < 3; index += 1) {
        await vi.advanceTimersByTimeAsync(1_500)
      }
      const [first, second] = await Promise.all([firstPromise, secondPromise])

      expect(first).toMatchObject({ ok: true, threadId: 'thread-a', reply: expect.stringContaining('reply thread-a') })
      expect(second).toMatchObject({ ok: true, threadId: 'thread-b', reply: expect.stringContaining('reply thread-b') })
      expect(agentRuntime.startThread).not.toHaveBeenCalled()
      expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
        threadId: 'thread-a',
        displayText: 'work A'
      }))
      expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
        threadId: 'thread-b',
        displayText: 'work B'
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('continues an existing phone conversation mapping instead of rebinding to active desktop focus', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      agentThreadIds: {},
      conversations: [{
        id: 'conversation-1',
        chatId: 'wx_user_1',
        remoteThreadId: '',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'stale-phone-thread' },
        workspaceRoot: '/tmp/old-phone-workspace',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected direct runtime path ${path}`)
    })
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected new thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'stale-phone-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'stale-phone-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'stale-phone-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '继续电脑端这个话题',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'stale-phone-thread',
      reply: expect.stringContaining('phone reply')
    })
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'stale-phone-thread',
      text: expect.stringContaining('继续电脑端这个话题'),
      displayText: '继续电脑端这个话题'
    }))
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'stale-phone-thread',
      runtimeId: 'codex'
    })
    expect(current().remoteChannel.channels[0].conversations).toHaveLength(1)
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      id: 'conversation-1',
      latestMessageId: 'wx_msg_2',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'stale-phone-thread' },
      workspaceRoot: '/tmp/old-phone-workspace'
    })
  })

  it('starts a Codex thread instead of reconnecting a phone conversation to the removed Kun runtime', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'sciforge',
      threadId: 'stale-kun-channel-thread',
      agentThreadIds: { sciforge: 'stale-kun-channel-thread' },
      conversations: [{
        id: 'conversation-1',
        chatId: 'wx_user_1',
        remoteThreadId: '',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        runtimeId: 'sciforge',
        agentThreadIds: { sciforge: 'stale-kun-conversation-thread' },
        workspaceRoot: '/tmp/old-phone-workspace',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected new thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async (input: { runtimeId?: string; threadId: string }) => ({
        threadId: input.threadId,
        turnId: input.runtimeId === 'sciforge' ? 'local-turn' : 'codex-turn'
      })),
      readThread: vi.fn(async ({ runtimeId, threadId }: { runtimeId?: string; threadId: string }) =>
        runtimeId === 'sciforge'
          ? completedThreadDetail(threadId, 'local-turn', 'stored runtime reply')
          : completedThreadDetail(threadId, 'codex-turn', 'new process reply')
      )
    }
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime: agentRuntime as never,
      getActiveThreadContext: () => ({
        threadId: 'desktop-codex-thread',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '第二次连接新的本地进程',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_3',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'unexpected-new-thread',
      reply: expect.stringContaining('new process reply')
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'unexpected-new-thread',
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex'
    }))
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'unexpected-new-thread',
      runtimeId: 'codex'
    })
    expect(current().remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'stale-kun-channel-thread',
        codex: 'unexpected-new-thread'
      }
    })
    expect(current().remoteChannel.channels[0].conversations[0]).toMatchObject({
      id: 'conversation-1',
      latestMessageId: 'wx_msg_3',
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'stale-kun-conversation-thread',
        codex: 'unexpected-new-thread'
      },
      workspaceRoot: '/tmp/old-phone-workspace'
    })
  })

  it('waits for the current WeChat turn to complete before returning the final reply', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_500
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { store } = mutableSettingsStore(settings)
    let getCount = 0
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      threadId: 'thr_weixin',
      turnId: 'turn_weixin',
      readThread: async () => {
        getCount += 1
        return getCount === 1
          ? {
              id: 'thr_weixin',
              status: 'running',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous reply' }]
                },
                {
                  id: 'turn_weixin',
                  status: 'running',
                  items: [
                    { kind: 'assistant_text', text: 'intermediate reply' },
                    { kind: 'tool_call', detail: 'checking disk usage' }
                  ]
                }
              ]
            }
          : {
              id: 'thr_weixin',
              status: 'idle',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous reply' }]
                },
                {
                  id: 'turn_weixin',
                  status: 'completed',
                  items: [
                    { kind: 'assistant_text', text: 'intermediate reply' },
                    { kind: 'tool_result', detail: 'tool finished' },
                    { kind: 'assistant_text', text: 'final result' }
                  ]
                }
              ]
            }
      }
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'clean disk',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('final result')
    })
    expect(JSON.parse(responseBody).reply).toContain('Remote channel commands:')
    expect(getCount).toBe(2)
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('does not return a previous WeChat session reply for a new turn', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 10
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      turnId: 'turn_current',
      readThread: async () => ({
        id: 'thr_weixin',
        status: 'idle',
        turns: [
          {
            id: 'turn_previous',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'previous reply' }]
          },
          {
            id: 'turn_current',
            status: 'completed',
            items: []
          }
        ]
      })
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Empty response',
      failureKind: 'empty_response'
    })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('interrupts timed out agent runtime turns so phone duty does not stay running', async () => {
    const settings = buildSettings()
    const interruptTurn = vi.fn(async () => undefined)
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime: {
        readThread: vi.fn(async () => ({
          id: 'thread-1',
          runtimeId: 'codex' as const,
          title: 'Thread',
          updatedAt: '2026-06-12T00:00:00.000Z',
          latestSeq: 1,
          turns: [{ id: 'turn-1', threadId: 'thread-1', status: 'running' as const, items: [] }],
          items: []
        })),
        interruptTurn
      } as never,
      logError: () => undefined
    })

    await expect((runtime as unknown as {
      waitForAgentRuntimeAssistantResult: (
        threadId: string,
        turnId: string,
        timeoutMs: number,
        workspaceRoot: string,
        runtimeId: 'codex'
      ) => Promise<unknown>
    }).waitForAgentRuntimeAssistantResult(
      'thread-1',
      'turn-1',
      0,
      '/tmp/workspace',
      'codex'
    )).rejects.toThrow('Timed out waiting for agent response.')

    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: true
    })
  })

  it('returns waiting desktop approval when an agent runtime turn is blocked on approval', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thread-approval',
        runtimeId: 'codex' as const,
        title: 'Thread',
        updatedAt: '2026-06-12T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'thread-approval',
        turnId: 'turn-approval'
      })),
      readThread: vi.fn(async () => ({
        id: 'thread-approval',
        runtimeId: 'codex' as const,
        title: 'Thread',
        updatedAt: '2026-06-12T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'turn-approval',
          threadId: 'thread-approval',
          status: 'running' as const,
          items: [{
            id: 'approval-1',
            kind: 'approval' as const,
            status: 'pending' as const,
            summary: 'Command approval requested'
          }]
        }],
        items: []
      }))
    }
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          runtimeId: 'codex'
        }
      ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
    }).runPrompt(settings, {
      prompt: 'needs approval',
      title: 'approval demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im',
      runtimeId: 'codex'
    })

    expect(result).toMatchObject({
      ok: false,
      message: 'Waiting for desktop approval before the remote channel can continue.',
      failureKind: 'waiting_desktop_approval'
    })
  })

  it('does not return historical WeChat text when the current turn fails', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_000
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const forbiddenDirectCall = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous reply' }]
              },
              {
                id: 'turn_current',
                status: 'failed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.remoteChannel.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Runtime offline',
      failureKind: 'runtime_offline'
    })
  })

  it('mirrors local remote-channel thread messages back to the bundled WeChat bridge', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'wx_out_1'
    }))
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'hello from local', 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledWith({
      accountId: 'wx_account',
      to: 'wx_user_1',
      text: 'hello from local'
    })
  })

  it('splits long mirrored WeChat messages by provider limits', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'wx_out'
    }))
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'w'.repeat(2_100), 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledTimes(2)
    const calls = sendWeixinBridgeMessage.mock.calls as unknown as Array<[{
      accountId: string
      to: string
      text: string
    }]>
    for (const [payload] of calls) {
      expect(payload.text.length).toBeLessThanOrEqual(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.weixin.maxMessageLength)
    }
  })

  it('splits long mirrored Discord messages by provider limits', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'channel_discord',
      threadId: 'thr_discord',
      platformCredential: {
        kind: 'discord',
        applicationId: 'app_1',
        botId: 'bot_1',
        botUsername: 'DeepSeek',
        guildId: 'guild_1',
        guildName: 'Guild',
        channelId: 'discord_channel_1',
        channelName: 'support',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'discord_channel_1',
        localThreadId: 'thr_discord'
      })]
    })]
    const sendDiscordChannelMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'discord_out'
    }))
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError: () => undefined,
      sendDiscordChannelMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_discord', 'd'.repeat(2_100), 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendDiscordChannelMessage).toHaveBeenCalledTimes(2)
    const calls = sendDiscordChannelMessage.mock.calls as unknown as Array<[{
      channelId: string
      text: string
    }]>
    for (const [payload] of calls) {
      expect(payload.text.length).toBeLessThanOrEqual(REMOTE_CHANNEL_PROVIDER_CAPABILITIES.discord.maxMessageLength)
    }
  })

  it('returns and records provider send failures when mirroring to WeChat fails', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const logError = vi.fn()
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: false as const,
      message: 'bridge offline'
    }))
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'hello from local', 'assistant')

    expect(result).toMatchObject({
      ok: false,
      message: 'WeChat send failed: bridge offline',
      failureKind: 'provider_send_failed'
    })
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-weixin',
      'Failed to mirror remote channel message to WeChat',
      expect.objectContaining({
        failureKind: 'provider_send_failed',
        message: 'WeChat send failed: bridge offline'
      })
    )
  })

  it('sends the latest generated workspace file to Feishu when the user asks for it', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-feishu-file-'))
    const filePath = join(workspaceRoot, 'hello.md')
    await writeFile(filePath, '# Hello\n')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.remoteChannel.im.enabled = true
      settings.remoteChannel.im.responseTimeoutMs = 2_000
      const conversation: RemoteChannelConversationV1 = {
        id: 'conv_1',
        chatId: 'oc_chat_a',
        remoteThreadId: '',
        latestMessageId: 'om_previous',
        senderId: 'ou_1',
        senderName: 'Alice',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'thr_1' },
        workspaceRoot,
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      const channel: RemoteChannelV1 = {
        id: 'channel_1',
        provider: 'feishu' as const,
        label: 'Phone',
        enabled: true,
        model: 'auto',
        workspaceRoot,
        agentProfile: {
          name: 'kun',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        conversations: [conversation],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      settings.remoteChannel.channels = [channel]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const forbiddenDirectCall = vi.fn()
      const agentRuntime = completedAgentRuntime({
        readThread: async () => ({
          id: 'thr_1',
          status: 'idle',
          turns: [
            {
              id: 'turn_1',
              status: 'completed',
              items: [
                {
                  kind: 'tool_result',
                  toolKind: 'file_change',
                  output: {
                    path: filePath,
                    relative_path: 'hello.md',
                    bytes_written: 8
                  },
                  isError: false
                }
              ]
            },
            {
              id: 'turn_2',
              status: 'completed',
              items: [
                {
                  kind: 'assistant_text',
                  text: '我无法直接通过飞书发送文件给你，但文件已经创建在 workspace 中。'
                }
              ]
            }
          ]
        })
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_file_1')
      const runtime = createRemoteChannelRuntime({
        store: store as never,
        agentRuntime,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          threadId?: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '发给我',
        rawContentType: 'text',
        mentions: []
      })

      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { markdown: '可以，我把 hello.md 作为附件发给你。' },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'hello.md' } },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      // The direct-file path is fast (synchronous file lookup + upload) and
      // The direct-file path is fast (synchronous file lookup + upload) and
      // must NOT add a pending reaction — that would be visually noisy.
      const addReactionSpy = (runtime as unknown as { feishuChannels: Map<string, { addReaction: ReturnType<typeof vi.fn> }> })
        .feishuChannels.get('channel_1')?.addReaction
      expect(addReactionSpy).not.toHaveBeenCalled()
      expect(agentRuntime.startTurn).not.toHaveBeenCalled()
      expect(forbiddenDirectCall).not.toHaveBeenCalled()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('sends agent reply containing markdown as Feishu / Lark markdown', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_000
    settings.remoteChannel.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const markdownReply = '**bold** `code`\n- item 1\n- item 2'
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      turnId: 'turn_md',
      text: markdownReply
    })
    const send = vi.fn(async () => ({ messageId: 'om_md' }))
    const addReaction = vi.fn(async () => 'rc_test_1')
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'tell me a story',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction is added on the user's inbound message BEFORE
    // the agent reply is sent.
    expect(addReaction).toHaveBeenCalledWith('om_inbound', 'OnIt')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: markdownReply },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    const textFormCall = (send.mock.calls as unknown as Array<[string, Record<string, unknown>]>)
      .find(([, input]) => typeof input?.text === 'string')
    expect(textFormCall).toBeUndefined()
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('falls back to markdown form when retrying without replyTo', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createRemoteChannelRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: undefined, replyInThread: undefined }
    )
  })

  it('continues agent flow when pending reaction add fails', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.im.responseTimeoutMs = 2_000
    settings.remoteChannel.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const logError = vi.fn()
    const agentReply = 'all good'
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = completedAgentRuntime({
      turnId: 'turn_react_fail',
      text: agentReply
    })
    const addReaction = vi.fn().mockRejectedValue(new Error('addReaction API error'))
    const send = vi.fn(async () => ({ messageId: 'om_agent_after_react_fail' }))
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      agentRuntime,
      logError
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_react_fail',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'do something',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction failure must be logged and swallowed.
    expect(logError).toHaveBeenCalledWith(
      'remote-channel-feishu',
      expect.stringContaining('pending reaction'),
      expect.objectContaining({
        message: 'addReaction API error',
        chatId: 'oc_chat_a',
        messageId: 'om_inbound_react_fail'
      })
    )
    // The agent reply is still dispatched despite the reaction failure.
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: agentReply },
      { replyTo: 'om_inbound_react_fail', replyInThread: false }
    )
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      governanceProfile: 'remote_guard'
    }))
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('does not add a pending reaction for IM commands', async () => {
    const settings = buildSettings()
    settings.remoteChannel.im.enabled = true
    settings.remoteChannel.channels = [buildChannel()]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const send = vi.fn(async () => ({ messageId: 'om_cmd' }))
    const addReaction = vi.fn(async () => 'rc_cmd_1')
    const runtime = createRemoteChannelRuntime({
      store: store as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_cmd',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/help',
      rawContentType: 'text',
      mentions: []
    })

    // /help produces a single IM command reply; no pending reaction.
    expect(send).toHaveBeenCalledTimes(1)
    expect(addReaction).not.toHaveBeenCalled()
  })
})
