import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()
let exposedApi: unknown

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      exposedApi = api
    })
  },
  ipcRenderer: {
    invoke,
    on,
    removeListener
  },
  webUtils: {
    getPathForFile: vi.fn(() => '/tmp/file.txt')
  }
}))

describe('preload agentRuntime bridge', () => {
  beforeEach(async () => {
    vi.resetModules()
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
    exposedApi = undefined
    await import('./index')
  })

  it('exposes runtime status notifications', () => {
    const api = exposedApi as {
      onRuntimeStatus(handler: (payload: unknown) => void): () => void
    }
    const handler = vi.fn()

    const unsubscribe = api.onRuntimeStatus(handler)
    const wrapped = on.mock.calls.find(([channel]) => channel === 'runtime:status')?.[1]
    wrapped?.({}, { state: 'running', source: 'test', at: '2026-06-14T00:00:00.000Z' })
    unsubscribe()

    expect(handler).toHaveBeenCalledWith({
      state: 'running',
      source: 'test',
      at: '2026-06-14T00:00:00.000Z'
    })
    expect(removeListener).toHaveBeenCalledWith('runtime:status', wrapped)
  })

  it('exposes a bridge to open the local Model Router config file', async () => {
    const api = exposedApi as {
      openModelRouterConfigFile(): Promise<unknown>
    }

    await api.openModelRouterConfigFile()

    expect(invoke).toHaveBeenCalledWith('modelRouter:config:open')
  })

  it('exposes scientific skills MCP config IPC', async () => {
    const api = exposedApi as {
      buildScientificSkillsMcpConfig(workspaceRoot?: string): Promise<unknown>
    }

    await api.buildScientificSkillsMcpConfig('/tmp/workspace')

    expect(invoke).toHaveBeenCalledWith('mcp:scientific-skills-config', {
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('exposes scientific plotting MCP config IPC', async () => {
    const api = exposedApi as {
      buildScientificPlottingMcpConfig(workspaceRoot?: string): Promise<unknown>
    }

    await api.buildScientificPlottingMcpConfig('/tmp/workspace')

    expect(invoke).toHaveBeenCalledWith('mcp:scientific-plotting-config', {
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('exposes scientific skills local status IPC', async () => {
    const api = exposedApi as {
      getScientificSkillsStatus(workspaceRoot?: string): Promise<unknown>
    }

    await api.getScientificSkillsStatus('/tmp/workspace')

    expect(invoke).toHaveBeenCalledWith('mcp:scientific-skills-status', {
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('exposes scientific skills install IPC', async () => {
    const api = exposedApi as {
      installScientificSkills(request: unknown): Promise<unknown>
    }

    await api.installScientificSkills({
      workspaceRoot: '/tmp/workspace',
      backend: 'git',
      ref: 'main'
    })

    expect(invoke).toHaveBeenCalledWith('scientific-skills:install', {
      workspaceRoot: '/tmp/workspace',
      backend: 'git',
      ref: 'main'
    })
  })

  it('exposes scientific plotting status IPC', async () => {
    const api = exposedApi as {
      getScientificPlottingStatus(workspaceRoot?: string): Promise<unknown>
    }

    await api.getScientificPlottingStatus('/tmp/workspace')

    expect(invoke).toHaveBeenCalledWith('scientific-plotting:status', {
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('exposes scientific plotting reference preparation IPC', async () => {
    const api = exposedApi as {
      prepareScientificPlottingReference(request: unknown): Promise<unknown>
    }

    await api.prepareScientificPlottingReference({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'papers/reference.pdf',
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

    expect(invoke).toHaveBeenCalledWith('scientific-plotting:prepare-reference', {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'papers/reference.pdf',
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
  })

  it('exposes figure style extraction IPC', async () => {
    const api = exposedApi as {
      extractFigureStyle(request: unknown): Promise<unknown>
    }

    await api.extractFigureStyle({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'figures/reference.png',
      sourceType: 'image',
      figureId: 'Fig. 2A'
    })

    expect(invoke).toHaveBeenCalledWith('figure-style:extract', {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'figures/reference.png',
      sourceType: 'image',
      figureId: 'Fig. 2A'
    })
  })

  it('exposes figure style evaluation IPC', async () => {
    const api = exposedApi as {
      evaluateFigureStyle(request: unknown): Promise<unknown>
    }

    await api.evaluateFigureStyle({
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png'
    })

    expect(invoke).toHaveBeenCalledWith('figure-style:evaluate', {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png'
    })
  })

  it('exposes figure style review IPC', async () => {
    const api = exposedApi as {
      reviewFigureStyle(request: unknown): Promise<unknown>
    }

    await api.reviewFigureStyle({
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png',
      minOverall: 0.82
    })

    expect(invoke).toHaveBeenCalledWith('figure-style:review', {
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png',
      minOverall: 0.82
    })
  })

  it('exposes workspace file picking IPC', async () => {
    const api = exposedApi as {
      pickWorkspaceFile(defaultPath?: string): Promise<unknown>
    }

    await api.pickWorkspaceFile('/tmp/workspace')

    expect(invoke).toHaveBeenCalledWith('workspace:pick-file', '/tmp/workspace')
  })

  it('exposes real file paths from picked or dropped files', () => {
    const api = exposedApi as {
      getPathForFile(file: File): string
    }
    const file = { name: 'paper.pdf' } as File

    expect(api.getPathForFile(file)).toBe('/tmp/file.txt')
  })

  it('keeps PDF preview on the generic workspace file IPC channel', async () => {
    const api = exposedApi as {
      readWorkspaceFile(options: unknown): Promise<unknown>
    }

    await api.readWorkspaceFile({ path: 'paper.pdf', workspaceRoot: '/tmp/workspace' })

    expect(invoke).toHaveBeenCalledWith('file:read-workspace', {
      path: 'paper.pdf',
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('exposes speech-to-text transcription IPC', async () => {
    const api = exposedApi as {
      speechToText: {
        transcribe(payload: unknown): Promise<unknown>
      }
    }
    const payload = {
      audioBase64: 'ZmFrZS13YXY=',
      mimeType: 'audio/wav',
      durationMs: 1000
    }

    await api.speechToText.transcribe(payload)

    expect(invoke).toHaveBeenCalledWith('speech:transcribe', payload)
  })

  it('forwards Discord Client ID and per-channel guard IPC payloads', async () => {
    const api = exposedApi as {
      configureDiscordClientId(clientId: string): Promise<unknown>
      configureDiscordBotToken(token: string, clientId?: string): Promise<unknown>
      configureDiscordProxy(proxyUrl: string): Promise<unknown>
      testDiscordChannel(channelId: string, text?: string, channelConfigId?: string): Promise<unknown>
      setDiscordGuard(enabled: boolean, channelConfigId?: string, forceTakeover?: boolean): Promise<unknown>
    }

    await api.configureDiscordClientId('client-1')
    await api.configureDiscordBotToken('token-1', 'client-1')
    await api.configureDiscordProxy('http://127.0.0.1:7890')
    await api.testDiscordChannel('discord-channel-1', 'hello', 'config-1')
    await api.setDiscordGuard(true, 'config-1', true)

    expect(invoke).toHaveBeenCalledWith('discord:configure-client', { clientId: 'client-1' })
    expect(invoke).toHaveBeenCalledWith('discord:configure-token', {
      token: 'token-1',
      clientId: 'client-1'
    })
    expect(invoke).toHaveBeenCalledWith('discord:configure-proxy', {
      proxyUrl: 'http://127.0.0.1:7890'
    })
    expect(invoke).toHaveBeenCalledWith('discord:test-send', {
      channelId: 'discord-channel-1',
      text: 'hello',
      channelConfigId: 'config-1'
    })
    expect(invoke).toHaveBeenCalledWith('discord:set-guard', {
      enabled: true,
      channelConfigId: 'config-1',
      forceTakeover: true
    })
  })

  it('exposes neutral runtime streaming and control IPC methods', async () => {
    const api = exposedApi as {
      agentRuntime: {
        subscribeEvents(input: unknown): Promise<unknown>
        stopEvents(streamId: string): Promise<unknown>
        interruptTurn(input: unknown): Promise<unknown>
        steerTurn(input: unknown): Promise<unknown>
        renameThread(input: unknown): Promise<unknown>
        deleteThread(input: unknown): Promise<unknown>
        compactThread(input: unknown): Promise<unknown>
        forkThread(input: unknown): Promise<unknown>
        resumeSession(input: unknown): Promise<unknown>
        updateThreadRelation(input: unknown): Promise<unknown>
        usage(input: unknown): Promise<unknown>
        resolveApproval(input: unknown): Promise<unknown>
        resolveUserInput(input: unknown): Promise<unknown>
        onEvent(handler: (payload: unknown) => void): () => void
        onEnd(handler: (payload: unknown) => void): () => void
        onError(handler: (payload: unknown) => void): () => void
      }
    }

    await api.agentRuntime.subscribeEvents({ threadId: 'thread-1', streamId: 'stream-1' })
    await api.agentRuntime.stopEvents('stream-1')
    await api.agentRuntime.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1', discard: true })
    await api.agentRuntime.steerTurn({ threadId: 'thread-1', turnId: 'turn-1', text: 'continue' })
    await api.agentRuntime.renameThread({ threadId: 'thread-1', title: 'Renamed' })
    await api.agentRuntime.deleteThread({ threadId: 'thread-1' })
    await api.agentRuntime.compactThread({ threadId: 'thread-1', reason: 'manual' })
    await api.agentRuntime.forkThread({ threadId: 'thread-1', relation: 'side', title: 'Side path' })
    await api.agentRuntime.resumeSession({ sessionId: 'session-1', model: 'deepseek-v4-pro', mode: 'agent' })
    await api.agentRuntime.updateThreadRelation({ threadId: 'thread-1', relation: 'primary' })
    await api.agentRuntime.usage({ groupBy: 'thread', threadId: 'thread-1' })
    await api.agentRuntime.resolveApproval({
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    await api.agentRuntime.resolveUserInput({
      threadId: 'thread-1',
      requestId: 'request-1',
      answers: [{ id: 'answer-1', value: 'yes' }]
    })

    const eventHandler = vi.fn()
    const unsubscribe = api.agentRuntime.onEvent(eventHandler)
    const wrapped = on.mock.calls.find(([channel]) => channel === 'agentRuntime:event')?.[1]
    wrapped?.({}, { streamId: 'stream-1', event: { kind: 'heartbeat', threadId: 'thread-1' } })
    unsubscribe()

    expect(invoke).toHaveBeenCalledWith('agentRuntime:subscribeEvents', {
      threadId: 'thread-1',
      streamId: 'stream-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:stopEvents', 'stream-1')
    expect(invoke).toHaveBeenCalledWith('agentRuntime:interruptTurn', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: true
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:steerTurn', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: 'continue'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:renameThread', {
      threadId: 'thread-1',
      title: 'Renamed'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:deleteThread', {
      threadId: 'thread-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:compactThread', {
      threadId: 'thread-1',
      reason: 'manual'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:forkThread', {
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resumeSession', {
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:updateThreadRelation', {
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:usage', {
      groupBy: 'thread',
      threadId: 'thread-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resolveApproval', {
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resolveUserInput', {
      threadId: 'thread-1',
      requestId: 'request-1',
      answers: [{ id: 'answer-1', value: 'yes' }]
    })
    expect(eventHandler).toHaveBeenCalledWith({
      streamId: 'stream-1',
      event: { kind: 'heartbeat', threadId: 'thread-1' }
    })
    expect(removeListener).toHaveBeenCalledWith('agentRuntime:event', wrapped)

    api.agentRuntime.onEnd(vi.fn())
    api.agentRuntime.onError(vi.fn())
    expect(on).toHaveBeenCalledWith('agentRuntime:end', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agentRuntime:error', expect.any(Function))
  })
})
