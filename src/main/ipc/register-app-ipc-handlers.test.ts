import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog, shell } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  shell: {
    openExternal: vi.fn(async () => undefined)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function registerOptions(overrides: Partial<Parameters<typeof import('./register-app-ipc-handlers').registerAppIpcHandlers>[0]> = {}) {
  const applySettingsPatch = vi.fn(async () => settings())
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    getMainWindow: () => null,
    applySettingsPatch,
    fetchUpstreamModels: vi.fn() as never,
    getClawRuntime: () => null,
    getScheduleRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
    resolveKunConfigPath: () => '/tmp/kun.json',
    openModelRouterConfigFile: vi.fn(async () => ({ ok: true as const, path: '/tmp/model-router/config.json' })),
    showTurnCompleteNotification: vi.fn() as never,
    getAppVersion: () => '0.1.0',
    readGuiUpdateState: vi.fn() as never,
    loadGuiUpdaterModule: vi.fn() as never,
    resolveLogDirectory: () => '/tmp/logs',
    logError: vi.fn(),
    ...overrides
  }
}

function createSender(id: number) {
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn()
  }
}

function waitForAbortStream(signal: AbortSignal): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let closed = false
      return {
        async next(): Promise<IteratorResult<unknown>> {
          if (!closed) {
            closed = true
            if (!signal.aborted) {
              await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => resolve(), { once: true })
              })
            }
          }
          return { done: true, value: undefined }
        }
      }
    }
  }
}

describe('registerAppIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(dialog.showOpenDialog).mockReset()
    vi.mocked(shell.openExternal).mockClear()
    vi.unstubAllEnvs()
  })

  it('rejects invalid settings patches at the handler boundary', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    expect(handler).toBeTypeOf('function')
    await expect(
      handler?.({}, { agents: { kun: { mysteryFlag: true } } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('passes valid settings patches through to applySettingsPatch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        kun: {
          port: 9000
        }
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('returns a dispatcher for dev browser bridge calls that uses the same handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())
    const sender = createSender(901)

    const dispatcher = registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        kun: {
          port: 9100
        }
      }
    }
    await expect(dispatcher.invoke('settings:set', payload, sender)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
    expect(handlers.get('settings:set')).toBeTypeOf('function')
  })

  it('routes neutral agent runtime IPC calls through the injected host', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const agentRuntime = {
      connect: vi.fn(async () => undefined),
      capabilities: vi.fn(async () => ({
        contractVersion: 1,
        runtimeId: 'codex',
        transport: 'jsonrpc_stdio',
        events: { live: false, replayable: true, sequenced: true, delivery: 'ipc' },
        threadMaterialization: 'after_first_user_message',
        latency: { phaseEvents: true, firstTokenMetric: true, turnDurationMetric: true },
        reasoning: { available: true, streaming: true, visibility: 'summary', source: 'backend_redacted' },
        model: { inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true },
        tools: {
          toolCalling: true,
          commandExecution: { available: true },
          fileChange: { available: true },
          mcp: { available: false },
          web: { available: false },
          skills: { available: true },
          subagents: { available: true },
          diagnostics: { available: true }
        },
        controls: {
          interrupt: true,
          steer: true,
          approval: 'fail_closed',
          userInput: 'fail_closed',
          compact: 'noop',
          fork: false,
          review: false,
          goals: false,
          todos: false,
          resumeSession: false
        },
        storage: {
          guiOwnedThreads: true,
          backendThreadIdStable: false,
          usage: false,
          attachments: { available: false },
          memory: { available: false }
        }
      })),
      listThreads: vi.fn(async () => []),
      startThread: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'Thread',
        updatedAt: '2026-06-11T00:00:00.000Z'
      })),
      readThread: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'Thread',
        updatedAt: '2026-06-11T00:00:00.000Z',
        latestSeq: 0
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thread-1', turnId: 'turn-1' })),
      interruptTurn: vi.fn(async () => undefined),
      steerTurn: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined),
      deleteThread: vi.fn(async () => undefined),
      compactThread: vi.fn(async () => undefined),
      forkThread: vi.fn(async () => ({
        id: 'forked-thread',
        runtimeId: 'kun' as const,
        title: 'Forked',
        updatedAt: '2026-06-11T00:00:00.000Z'
      })),
      resumeSession: vi.fn(async () => ({ threadId: 'resumed-thread', sessionId: 'session-1' })),
      updateThreadRelation: vi.fn(async () => undefined),
      usage: vi.fn(async () => ({
        supported: true as const,
        groupBy: 'thread' as const,
        buckets: [{ threadId: 'thread-1', totalTokens: 10 }],
        totals: { totalTokens: 10 }
      })),
      auxiliary: vi.fn(async () => ({ host: 'kun' })),
      subscribeEvents: vi.fn(async function* () {
        yield {
          kind: 'assistant_delta' as const,
          threadId: 'thread-1',
          runtimeId: 'codex' as const,
          itemId: 'assistant-1',
          text: 'hello',
          seq: 2
        }
      }),
      resolveApproval: vi.fn(async () => undefined),
      resolveUserInput: vi.fn(async () => undefined)
    }
    const sent: Array<{ channel: string; payload: unknown }> = []
    const sender = {
      id: 12,
      isDestroyed: vi.fn(() => false),
      send: vi.fn((channel: string, payload: unknown) => sent.push({ channel, payload })),
      once: vi.fn(),
      removeListener: vi.fn()
    }

    registerAppIpcHandlers(registerOptions({
      agentRuntime: agentRuntime as never
    }))

    await expect(
      handlers.get('agentRuntime:capabilities')?.({}, { runtimeId: 'codex' })
    ).resolves.toMatchObject({ runtimeId: 'codex' })
    await expect(
      handlers.get('agentRuntime:startTurn')?.({}, { runtimeId: 'codex', threadId: 'thread-1', text: ' hello ' })
    ).resolves.toEqual({ threadId: 'thread-1', turnId: 'turn-1' })
    await expect(
      handlers.get('agentRuntime:interruptTurn')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: ' turn-1 ',
        discard: true
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:steerTurn')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: ' turn-1 ',
        text: ' keep going '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:resolveApproval')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        approvalId: 'approval-1',
        decision: 'denied',
        message: ' nope '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:resolveUserInput')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        requestId: 'request-1',
        answers: [{ id: 'answer-1', value: ' yes ' }]
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:renameThread')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        title: ' Renamed '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:deleteThread')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1'
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:compactThread')?.({}, {
        runtimeId: 'kun',
        threadId: 'thread-1',
        reason: ' Manual cleanup '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:forkThread')?.({}, {
        runtimeId: 'kun',
        threadId: 'thread-1',
        relation: ' side ',
        title: ' Side path '
      })
    ).resolves.toEqual({
      id: 'forked-thread',
      runtimeId: 'kun',
      title: 'Forked',
      updatedAt: '2026-06-11T00:00:00.000Z'
    })
    await expect(
      handlers.get('agentRuntime:resumeSession')?.({}, {
        runtimeId: 'kun',
        sessionId: ' session-1 ',
        model: ' deepseek-v4-pro ',
        mode: ' agent '
      })
    ).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(
      handlers.get('agentRuntime:updateThreadRelation')?.({}, {
        runtimeId: 'kun',
        threadId: 'thread-1',
        relation: ' primary '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:usage')?.({}, {
        runtimeId: 'kun',
        groupBy: 'thread',
        threadId: ' thread-1 '
      })
    ).resolves.toEqual({
      supported: true,
      groupBy: 'thread',
      buckets: [{ threadId: 'thread-1', totalTokens: 10 }],
      totals: { totalTokens: 10 }
    })
    await expect(
      handlers.get('agentRuntime:auxiliary')?.({}, {
        runtimeId: 'kun',
        operation: 'getRuntimeInfo',
        payload: {}
      })
    ).resolves.toEqual({ host: 'kun' })
    await expect(
      handlers.get('agentRuntime:subscribeEvents')?.({ sender }, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        sinceSeq: 1,
        streamId: 'stream-1'
      })
    ).resolves.toEqual({ streamId: 'stream-1' })

    expect(agentRuntime.capabilities).toHaveBeenCalledWith('codex')
    expect(agentRuntime.startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      text: 'hello'
    })
    expect(agentRuntime.interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: true
    })
    expect(agentRuntime.steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: 'keep going'
    })
    expect(agentRuntime.resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'denied',
      message: 'nope'
    })
    expect(agentRuntime.resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'request-1',
      answers: [{ id: 'answer-1', value: 'yes' }]
    })
    expect(agentRuntime.renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Renamed'
    })
    expect(agentRuntime.deleteThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(agentRuntime.compactThread).toHaveBeenCalledWith({
      runtimeId: 'kun',
      threadId: 'thread-1',
      reason: 'Manual cleanup'
    })
    expect(agentRuntime.forkThread).toHaveBeenCalledWith({
      runtimeId: 'kun',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(agentRuntime.resumeSession).toHaveBeenCalledWith({
      runtimeId: 'kun',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(agentRuntime.updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'kun',
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(agentRuntime.usage).toHaveBeenCalledWith({
      runtimeId: 'kun',
      groupBy: 'thread',
      threadId: 'thread-1'
    })
    expect(agentRuntime.auxiliary).toHaveBeenCalledWith({
      runtimeId: 'kun',
      operation: 'getRuntimeInfo',
      payload: {}
    })
    expect(agentRuntime.subscribeEvents).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      sinceSeq: 1,
      streamId: 'stream-1',
      signal: expect.any(AbortSignal)
    })
    expect(sender.send).toHaveBeenCalledWith('agentRuntime:event', {
      streamId: 'stream-1',
      event: expect.objectContaining({ kind: 'assistant_delta', text: 'hello' })
    })
    expect(sender.send).toHaveBeenCalledWith('agentRuntime:end', { streamId: 'stream-1' })
  })

  it('keeps agent runtime event streams owned by the subscribing sender', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const signals: AbortSignal[] = []
    const agentRuntime = {
      subscribeEvents: vi.fn((input: { signal: AbortSignal }) => {
        signals.push(input.signal)
        return waitForAbortStream(input.signal)
      })
    }
    const owner = createSender(31)
    const other = createSender(32)

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('agentRuntime:subscribeEvents')?.({ sender: owner }, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        streamId: 'shared-stream'
      })
    ).resolves.toEqual({ streamId: 'shared-stream' })
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    await expect(
      handlers.get('agentRuntime:stopEvents')?.({ sender: other }, 'shared-stream')
    ).resolves.toBe(false)
    expect(signals[0].aborted).toBe(false)

    await expect(
      handlers.get('agentRuntime:stopEvents')?.({ sender: owner }, 'shared-stream')
    ).resolves.toBe(true)
    expect(signals[0].aborted).toBe(true)
  })

  it('rejects another sender subscribing over an active agent runtime stream id', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const signals: AbortSignal[] = []
    const agentRuntime = {
      subscribeEvents: vi.fn((input: { signal: AbortSignal }) => {
        signals.push(input.signal)
        return waitForAbortStream(input.signal)
      })
    }
    const owner = createSender(41)
    const other = createSender(42)

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('agentRuntime:subscribeEvents')?.({ sender: owner }, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        streamId: 'shared-stream'
      })
    ).resolves.toEqual({ streamId: 'shared-stream' })
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    await expect(
      handlers.get('agentRuntime:subscribeEvents')?.({ sender: other }, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        streamId: 'shared-stream'
      })
    ).rejects.toThrow(/already active/)
    expect(agentRuntime.subscribeEvents).toHaveBeenCalledTimes(1)
    expect(signals[0].aborted).toBe(false)

    await handlers.get('agentRuntime:stopEvents')?.({ sender: owner }, 'shared-stream')
  })

  it('removes the sender destroyed listener when an agent runtime event stream completes', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const agentRuntime = {
      subscribeEvents: vi.fn(async function* () {
        yield {
          kind: 'assistant_delta' as const,
          threadId: 'thread-1',
          runtimeId: 'codex' as const,
          itemId: 'assistant-1',
          text: 'done',
          seq: 1
        }
      })
    }
    const sender = createSender(51)

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('agentRuntime:subscribeEvents')?.({ sender }, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        streamId: 'completed-stream'
      })
    ).resolves.toEqual({ streamId: 'completed-stream' })
    await vi.waitFor(() => expect(sender.removeListener).toHaveBeenCalledTimes(1))
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', sender.once.mock.calls[0][1])
  })

  it('accepts the full settings snapshot emitted by SettingsView auto-apply', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = { ...settings(), locale: 'zh' as const }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('validates speech transcription IPC and routes it through the injected service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const current = settings()
    const store = { load: vi.fn(async () => current) }
    const transcribeSpeech = vi.fn(async () => ({ ok: true as const, text: 'hello world' }))

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      transcribeSpeech
    }))

    const payload = {
      audioBase64: Buffer.from('fake-wav-bytes').toString('base64'),
      mimeType: ' audio/wav ',
      durationMs: 1000,
      speechToText: {
        enabled: true,
        protocol: 'openai-transcriptions' as const,
        baseUrl: ' https://speech.example.test/v1 ',
        apiKey: 'sk-speech',
        model: ' whisper-1 ',
        timeoutMs: 30000
      }
    }

    await expect(handlers.get('speech:transcribe')?.({}, payload)).resolves.toEqual({
      ok: true,
      text: 'hello world'
    })
    expect(store.load).toHaveBeenCalled()
    expect(transcribeSpeech).toHaveBeenCalledWith(current, {
      audioBase64: payload.audioBase64,
      mimeType: 'audio/wav',
      durationMs: 1000,
      speechToText: {
        enabled: true,
        protocol: 'openai-transcriptions',
        baseUrl: 'https://speech.example.test/v1',
        apiKey: 'sk-speech',
        model: 'whisper-1',
        timeoutMs: 30000
      }
    })
  })

  it('rejects invalid speech transcription IPC before calling the service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const transcribeSpeech = vi.fn(async () => ({ ok: true as const, text: 'ignored' }))

    registerAppIpcHandlers(registerOptions({ transcribeSpeech }))

    await expect(
      handlers.get('speech:transcribe')?.({}, {
        audioBase64: Buffer.from('fake-image-bytes').toString('base64'),
        mimeType: 'image/png'
      })
    ).rejects.toThrow(/Invalid payload for speech:transcribe/)
    expect(transcribeSpeech).not.toHaveBeenCalled()
  })

  it('passes schedule settings patches through to applySettingsPatch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async (partial: AppSettingsPatch) => ({
      ...settings(),
      schedule: mergeScheduleSettings(settings().schedule, partial.schedule)
    }))

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{
          id: 'task-1',
          title: 'Daily',
          enabled: true,
          prompt: 'Run',
          schedule: { kind: 'manual' as const }
        }]
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toMatchObject({
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{ id: 'task-1', prompt: 'Run' }]
      }
    })
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('writes MCP config JSON and notifies the runtime apply hook', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)
    const content = `${JSON.stringify({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
        }
      }
    }, null, 2)}\n`

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('deepseek:config:write')?.({}, content)).resolves.toEqual({
        ok: true,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(onKunMcpConfigWritten).toHaveBeenCalledWith(configPath, content)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('builds the scientific skills MCP config fragment through IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({
      getScientificSkillsMcpLaunchConfig: () => ({
        appPath: '/tmp/deepseek-gui-app',
        execPath: '/tmp/electron',
        isPackaged: false
      })
    }))

    await expect(handlers.get('mcp:scientific-skills-config')?.({}, {
      workspaceRoot: '/tmp/workspace'
    })).resolves.toMatchObject({
      ok: true,
      config: {
        servers: {
          scientific_skills: {
            enabled: true,
            transport: 'stdio',
            command: '/tmp/electron',
            args: [
              '/tmp/deepseek-gui-app/out/main/scientific-skills-mcp-node-entry.js',
              '--scientific-skills-mcp-server',
              '--workspace-root',
              '/tmp/workspace'
            ],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/workspace']
          }
        }
      }
    })
  })

  it('builds the scientific plotting MCP config fragment through IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({
      getScientificPlottingMcpLaunchConfig: () => ({
        appPath: '/tmp/deepseek-gui-app',
        execPath: '/tmp/electron',
        isPackaged: false
      })
    }))

    await expect(handlers.get('mcp:scientific-plotting-config')?.({}, {
      workspaceRoot: '/tmp/workspace'
    })).resolves.toMatchObject({
      ok: true,
      config: {
        servers: {
          scientific_plotting: {
            enabled: true,
            transport: 'stdio',
            command: '/tmp/electron',
            args: [
              '/tmp/deepseek-gui-app/out/main/scientific-plotting-mcp-node-entry.js',
              '--scientific-plotting-mcp-server',
              '--workspace-root',
              '/tmp/workspace'
            ],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/workspace']
          }
        }
      }
    })
  })

  it('returns scientific skills local status and curated plotting pack through IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const workspace = mkdtempSync(join(tmpdir(), 'scientific-skills-ipc-'))
    const skillDir = join(workspace, '.agents', 'skills', 'scientific-agent-skills', 'skills', 'matplotlib')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: matplotlib',
      'description: Publication plotting.',
      'allowed-tools: Read',
      '---',
      '# Matplotlib',
      '',
      'Plan static publication figures.'
    ].join('\n'))

    try {
      registerAppIpcHandlers(registerOptions())

      await expect(handlers.get('mcp:scientific-skills-status')?.({}, {
        workspaceRoot: workspace
      })).resolves.toMatchObject({
        ok: true,
        installed: true,
        plottingPack: {
          total: 6,
          items: expect.arrayContaining([
            expect.objectContaining({
              skillId: 'matplotlib',
              installed: true
            })
          ])
        }
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('runs the scientific skills installer through IPC with schema validation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const installScientificSkills = vi.fn(async () => ({
      ok: true as const,
      status: 'installed' as const,
      backend: 'git' as const,
      targetPath: '/tmp/workspace/.agents/skills/scientific-agent-skills',
      commit: '0123456'
    }))

    registerAppIpcHandlers(registerOptions({ installScientificSkills }))

    await expect(handlers.get('scientific-skills:install')?.({}, {
      workspaceRoot: '/tmp/workspace',
      backend: 'git',
      ref: 'main'
    })).resolves.toMatchObject({
      ok: true,
      status: 'installed',
      targetPath: '/tmp/workspace/.agents/skills/scientific-agent-skills'
    })
    expect(installScientificSkills).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      backend: 'git',
      ref: 'main'
    })

    await expect(handlers.get('scientific-skills:install')?.({}, {
      backend: 'git'
    })).rejects.toThrow('Invalid payload for scientific-skills:install')
  })

  it('opens a reference figure picker through IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/workspace/figures/reference.png'],
      bookmarks: []
    })

    registerAppIpcHandlers(registerOptions())

    await expect(
      handlers.get('workspace:pick-file')?.({}, '/tmp/workspace')
    ).resolves.toEqual({
      canceled: false,
      path: '/tmp/workspace/figures/reference.png'
    })
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: '/tmp/workspace',
      properties: ['openFile', 'dontAddToRecent'],
      filters: expect.arrayContaining([
        expect.objectContaining({ name: 'Figures' })
      ])
    }))
  })

  it('routes figure style extraction through IPC with schema validation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const figureStyleSpec = {
      version: 1 as const,
      source: { path: '/tmp/workspace/fig.png', type: 'image' as const },
      canvas: { width: 640, height: 420, aspectRatio: 1.524, background: '#ffffff' },
      palette: {
        colors: ['#222222', '#d24b4b'],
        background: '#ffffff',
        ink: '#222222',
        accent: ['#d24b4b'],
        colorMode: 'limited' as const
      },
      typography: {
        fontFamily: 'Arial',
        axisSize: 8,
        labelSize: 9,
        titleSize: 11,
        weight: 'regular' as const
      },
      layout: {
        panelGrid: '1x1',
        panelLabels: 'unknown' as const,
        margin: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
        gutter: 'balanced' as const
      },
      axes: {
        spine: 'left-bottom' as const,
        tickDirection: 'out' as const,
        grid: true,
        gridTone: 'light' as const,
        gridColor: '#e2e2df',
        gridAlpha: 0.52,
        gridLineWidth: 0.4
      },
      marks: {
        lineWidth: 1.2,
        markerSize: 3,
        errorBarStyle: 'unknown' as const,
        density: 'balanced' as const
      },
      annotations: {
        significance: 'unknown' as const,
        legend: 'frameless' as const
      },
      export: {
        formats: ['pdf' as const, 'svg' as const, 'png' as const],
        dpi: 300,
        transparent: false
      },
      confidence: {
        overall: 0.72,
        palette: 0.8,
        layout: 0.7,
        axes: 0.75,
        typography: 0.35
      }
    }
    const extractFigureStyle = vi.fn(async () => ({
      ok: true as const,
      spec: figureStyleSpec,
      applyPlan: {
        styleSpec: figureStyleSpec,
        plottingWorkflow: {
          recommendedSkills: ['scientific-visualization', 'matplotlib'],
          recommendedLibraries: ['Matplotlib', 'Seaborn'],
          nextControlledTool: 'SciForge DataFigure Engine',
          guardrails: ['Use the reference figure only as style guidance.']
        },
        matplotlibHints: {
          rcParams: {
            'axes.grid': true,
            'axes.edgecolor': '#222222',
            'font.family': 'Arial'
          },
          palette: ['#d24b4b'],
          layoutNotes: ['Use 1x1 panel layout.']
        }
      },
      diagnostics: {
        analyzedAt: '2026-06-21T00:00:00.000Z',
        sampledPixels: 42,
        foregroundRatio: 0.1,
        darkPixelRatio: 0.03,
        chromaRatio: 0.02,
        warnings: []
      }
    }))

    registerAppIpcHandlers(registerOptions({ extractFigureStyle }))

    await expect(handlers.get('figure-style:extract')?.({}, {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'fig.png',
      sourceType: 'image',
      figureId: 'Fig. 1',
      notes: 'paper style'
    })).resolves.toMatchObject({
      ok: true,
      spec: {
        source: { path: '/tmp/workspace/fig.png', type: 'image' }
      }
    })
    expect(extractFigureStyle).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'fig.png',
      sourceType: 'image',
      figureId: 'Fig. 1',
      notes: 'paper style'
    })

    await expect(handlers.get('figure-style:extract')?.({}, {
      workspaceRoot: '/tmp/workspace'
    })).rejects.toThrow('Invalid payload for figure-style:extract')
  })

  it('routes scientific plotting status and reference preparation through IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const getScientificPlottingStatus = vi.fn(async () => ({
      ok: true as const,
      serverName: 'scientific_plotting' as const,
      version: '0.1.0',
      renderer: {
        kind: 'matplotlib' as const,
        pythonCommand: 'python3',
        available: true,
        version: '3.9.4'
      },
      referencePreparation: {
        imageCrop: true as const,
        pdfCrop: {
          available: true,
          command: 'pdftoppm'
        },
        defaultRelativeDir: '.sciforge/figure-references' as const
      },
      reviewPackets: {
        defaultRelativeDir: '.sciforge/figure-reviews' as const,
        readsRenderManifests: true as const,
        writesMarkdownAndJson: true as const
      },
      styleProfiles: {
        builtIn: 5,
        acceptsStyleProfileId: true as const,
        defaultProfileIds: ['nature-2021-alphafold-fig2']
      },
      supportedTemplates: [
        'line' as const,
        'scatter' as const,
        'bar' as const,
        'heatmap' as const,
        'schematic-grid' as const
      ],
      outputPolicy: {
        defaultRelativeDir: '.sciforge/figures',
        writesOnlyInsideWorkspace: true as const,
        formats: ['png'] as ['png']
      },
      degraded: false,
      guardrails: ['Only first-party renderer code is executed.']
    }))
    const prepareScientificPlottingReference = vi.fn(async () => ({
      ok: true as const,
      status: 'prepared' as const,
      source: {
        path: '/tmp/workspace/paper.pdf',
        type: 'pdf' as const,
        page: 2,
        width: 800,
        height: 480
      },
      cropBox: {
        unit: 'pixel' as const,
        x: 80,
        y: 96,
        width: 560,
        height: 240
      },
      croppedImagePath: '/tmp/workspace/.sciforge/figure-references/fig-2a.png',
      referenceManifestPath: '/tmp/workspace/.sciforge/figure-references/fig-2a.reference.json',
      referenceManifest: {
        version: 1 as const,
        tool: 'scientific_plotting_prepare_reference' as const,
        createdAt: '2026-06-21T00:00:00.000Z',
        requestHash: 'a'.repeat(64),
        source: {
          path: '/tmp/workspace/paper.pdf',
          type: 'pdf' as const,
          page: 2,
          width: 800,
          height: 480
        },
        cropBox: {
          unit: 'pixel' as const,
          x: 80,
          y: 96,
          width: 560,
          height: 240
        },
        croppedImagePath: '/tmp/workspace/.sciforge/figure-references/fig-2a.png',
        warnings: [],
        nextWorkflow: {
          referencePath: '/tmp/workspace/.sciforge/figure-references/fig-2a.png',
          suggestedProfileTool: 'scientific_plotting_style_profiles' as const,
          suggestedPlanTool: 'scientific_plotting_plan' as const,
          suggestedRenderTool: 'scientific_plotting_render' as const,
          suggestedReviewTool: 'scientific_plotting_review' as const,
          guardrails: ['Use the cropped PNG as the review reference.']
        }
      },
      warnings: []
    }))

    registerAppIpcHandlers(registerOptions({
      getScientificPlottingStatus,
      prepareScientificPlottingReference
    }))

    await expect(handlers.get('scientific-plotting:status')?.({}, {
      workspaceRoot: '/tmp/workspace'
    })).resolves.toMatchObject({
      ok: true,
      referencePreparation: {
        pdfCrop: { available: true }
      },
      reviewPackets: {
        defaultRelativeDir: '.sciforge/figure-reviews'
      },
      styleProfiles: {
        acceptsStyleProfileId: true
      }
    })
    expect(getScientificPlottingStatus).toHaveBeenCalledTimes(1)

    await expect(handlers.get('scientific-plotting:prepare-reference')?.({}, {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper.pdf',
      sourceType: 'pdf',
      page: 2,
      cropBox: {
        unit: 'ratio',
        x: 0.1,
        y: 0.2,
        width: 0.7,
        height: 0.5
      }
    })).resolves.toMatchObject({
      ok: true,
      status: 'prepared',
      croppedImagePath: '/tmp/workspace/.sciforge/figure-references/fig-2a.png'
    })
    expect(prepareScientificPlottingReference).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper.pdf',
      sourceType: 'pdf',
      page: 2,
      cropBox: {
        unit: 'ratio',
        x: 0.1,
        y: 0.2,
        width: 0.7,
        height: 0.5
      }
    })

    await expect(handlers.get('scientific-plotting:prepare-reference')?.({}, {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper.pdf',
      cropBox: {
        unit: 'ratio',
        x: 0,
        y: 0,
        width: 0,
        height: 1
      }
    })).rejects.toThrow('Invalid payload for scientific-plotting:prepare-reference')
  })

  it('routes figure style similarity evaluation through IPC with schema validation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const evaluateFigureStyle = vi.fn(async () => ({
      ok: true as const,
      score: {
        overall: 0.86,
        palette: 0.9,
        background: 0.88,
        axes: 0.8,
        grid: 0.84,
        layout: 0.82,
        marks: 0.74,
        warnings: []
      },
      diagnostics: {
        reference: {
          analyzedAt: '2026-06-21T00:00:00.000Z',
          sampledPixels: 42,
          foregroundRatio: 0.1,
          darkPixelRatio: 0.03,
          chromaRatio: 0.02,
          warnings: []
        },
        output: {
          analyzedAt: '2026-06-21T00:00:01.000Z',
          sampledPixels: 43,
          foregroundRatio: 0.11,
          darkPixelRatio: 0.031,
          chromaRatio: 0.021,
          warnings: []
        }
      }
    }))

    registerAppIpcHandlers(registerOptions({ evaluateFigureStyle }))

    await expect(handlers.get('figure-style:evaluate')?.({}, {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png'
    })).resolves.toMatchObject({
      ok: true,
      score: { overall: 0.86 }
    })
    expect(evaluateFigureStyle).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png'
    })

    await expect(handlers.get('figure-style:evaluate')?.({}, {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png'
    })).rejects.toThrow('Invalid payload for figure-style:evaluate')
  })

  it('routes figure style review through IPC with schema validation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const reviewFigureStyle = vi.fn(async () => ({
      ok: true as const,
      status: 'repairable' as const,
      score: {
        overall: 0.7,
        palette: 0.9,
        background: 0.4,
        axes: 0.8,
        grid: 0.84,
        layout: 0.82,
        marks: 0.74,
        warnings: ['Canvas or axes background differs from the reference figure.']
      },
      issues: [{
        id: 'background' as const,
        severity: 'warning' as const,
        metric: 'background' as const,
        score: 0.4,
        message: 'Background differs.',
        autoRepairable: true
      }],
      autoRepair: {
        shouldRerender: true,
        reason: 'Rerender with patch.',
        rcParamsPatch: { 'figure.facecolor': '#ffffff' },
        layoutHints: [],
        guardrails: ['Do not change source data.']
      },
      diagnostics: {
        reference: {
          analyzedAt: '2026-06-21T00:00:00.000Z',
          sampledPixels: 42,
          foregroundRatio: 0.1,
          darkPixelRatio: 0.03,
          chromaRatio: 0.02,
          warnings: []
        },
        output: {
          analyzedAt: '2026-06-21T00:00:01.000Z',
          sampledPixels: 43,
          foregroundRatio: 0.11,
          darkPixelRatio: 0.031,
          chromaRatio: 0.021,
          warnings: []
        }
      }
    }))

    registerAppIpcHandlers(registerOptions({ reviewFigureStyle }))

    await expect(handlers.get('figure-style:review')?.({}, {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png',
      minOverall: 0.8
    })).resolves.toMatchObject({
      ok: true,
      status: 'repairable',
      autoRepair: { shouldRerender: true }
    })
    expect(reviewFigureStyle).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png',
      minOverall: 0.8
    })

    await expect(handlers.get('figure-style:review')?.({}, {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      minOverall: 1.5
    })).rejects.toThrow('Invalid payload for figure-style:review')
  })

  it('opens the local Model Router config file through the injected handler', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const openModelRouterConfigFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/deepseek-gui/model-router/config.json'
    }))
    const current = settings()
    const store = { load: vi.fn(async () => current) }

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      openModelRouterConfigFile
    }))

    await expect(handlers.get('modelRouter:config:open')?.({}, undefined)).resolves.toEqual({
      ok: true,
      path: '/tmp/deepseek-gui/model-router/config.json'
    })
    expect(store.load).toHaveBeenCalled()
    expect(openModelRouterConfigFile).toHaveBeenCalledWith(current)
  })

  it('rejects invalid MCP config JSON before writing or applying it', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('deepseek:config:write')?.({}, '{')).rejects.toThrow(
        /MCP config must be JSON/
      )
      await expect(handlers.get('deepseek:config:write')?.({}, '[]')).rejects.toThrow(
        /MCP config must be a JSON object/
      )
      expect(existsSync(configPath)).toBe(false)
      expect(onKunMcpConfigWritten).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('uses the GUI-managed WeChat bridge for WeChat install handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const configuredSettings = settings()
    configuredSettings.claw.im.weixinBridgeUrl = 'http://127.0.0.1:8787/rpc'
    const store = { load: vi.fn(async () => configuredSettings) }
    const startWeixinInstallQrcode = vi.fn(async () => ({
      ok: false as const,
      message: 'expected test response'
    }))
    const pollWeixinInstall = vi.fn(async () => ({ done: false as const }))

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      startWeixinInstallQrcode,
      pollWeixinInstall
    }))

    await expect(
      handlers.get('claw:im-install:qrcode')?.({}, { provider: 'weixin' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      handlers.get('claw:im-install:poll')?.({}, { provider: 'weixin', deviceCode: 'device-1' })
    ).resolves.toEqual({ done: false })

    expect(startWeixinInstallQrcode).toHaveBeenCalledWith()
    expect(pollWeixinInstall).toHaveBeenCalledWith('device-1')
  })

  it('routes schedule task IPC calls to the Schedule runtime', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const scheduleRuntime = {
      status: vi.fn(async () => ({
        internalServerRunning: true,
        internalUrl: 'http://127.0.0.1:8788',
        runningTaskIds: ['task-1'],
        powerSaveBlockerActive: true
      })),
      runTask: vi.fn(async (taskId: string) => ({ ok: true as const, taskId, message: 'Started' })),
      createScheduledTaskFromText: vi.fn(async () => ({
        kind: 'created' as const,
        taskId: 'task-2',
        title: 'Reminder',
        scheduleAt: '2026-06-03T09:00:00.000+08:00',
        confirmationText: 'Scheduled.'
      }))
    }
    registerAppIpcHandlers(registerOptions({
      getScheduleRuntime: () => scheduleRuntime as never
    }))

    await expect(handlers.get('schedule:status')?.({})).resolves.toMatchObject({
      internalServerRunning: true,
      runningTaskIds: ['task-1'],
      powerSaveBlockerActive: true
    })
    await expect(handlers.get('schedule:task:run')?.({}, 'task-1')).resolves.toMatchObject({
      ok: true,
      taskId: 'task-1'
    })
    await expect(
      handlers.get('schedule:task:create-from-text')?.({}, {
        text: 'Remind me tomorrow.',
        workspaceRoot: '/tmp/schedule',
        modelHint: 'deepseek-v4-flash',
        mode: 'plan'
      })
    ).resolves.toMatchObject({
      kind: 'created',
      taskId: 'task-2'
    })

    expect(scheduleRuntime.runTask).toHaveBeenCalledWith('task-1')
    expect(scheduleRuntime.createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow.', {
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })
  })

  it('routes desktop command IPC calls to the focused window and web contents', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const webContents = {
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      reload: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      toggleDevTools: vi.fn()
    }
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents,
      minimize: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn()
    }

    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never
    }))

    const handler = handlers.get('desktop:command')
    await handler?.({ sender: webContents }, 'copy')
    await handler?.({ sender: webContents }, 'zoomIn')
    await handler?.({ sender: webContents }, 'toggleMaximize')
    await handler?.({ sender: webContents }, 'close')

    expect(webContents.copy).toHaveBeenCalledTimes(1)
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(1)
    expect(mainWindow.maximize).toHaveBeenCalledTimes(1)
    expect(mainWindow.close).toHaveBeenCalledTimes(1)
  })
})
