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

  it('exposes Evidence DAG audit IPC', async () => {
    const api = exposedApi as {
      runEvidenceDagAudit(payload: unknown): Promise<unknown>
    }
    const payload = { runtimeId: 'codex', threadId: 'thread-1' }

    await api.runEvidenceDagAudit(payload)

    expect(invoke).toHaveBeenCalledWith('evidenceDag:audit-run', payload)
  })

  it('exposes real file paths from picked or dropped files', () => {
    const api = exposedApi as {
      getPathForFile(file: File): string
    }
    const file = { name: 'paper.pdf' } as File

    expect(api.getPathForFile(file)).toBe('/tmp/file.txt')
  })

  it('exposes filtered dev preview navigation notifications', () => {
    const api = exposedApi as {
      onDevPreviewNavigate(handler: (payload: unknown) => void): () => void
    }
    const handler = vi.fn()

    const unsubscribe = api.onDevPreviewNavigate(handler)
    const wrapped = on.mock.calls.find(([channel]) => channel === 'dev-preview:navigate')?.[1]
    wrapped?.({}, { url: 'http://127.0.0.1:5173/docs', webContentsId: 42 })
    wrapped?.({}, { url: 'http://127.0.0.1:5173/docs', webContentsId: '42' })
    unsubscribe()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:5173/docs',
      webContentsId: 42
    })
    expect(removeListener).toHaveBeenCalledWith('dev-preview:navigate', wrapped)
  })

  it('keeps PDF preview on the generic workspace file IPC channel', async () => {
    const api = exposedApi as {
      readWorkspaceFile(options: unknown): Promise<unknown>
      previewWorkspaceHtml(options: unknown): Promise<unknown>
      writeWorkspaceDocxText(options: unknown): Promise<unknown>
    }

    await api.readWorkspaceFile({ path: 'paper.pdf', workspaceRoot: '/tmp/workspace' })
    await api.previewWorkspaceHtml({ path: 'status.html', workspaceRoot: '/tmp/workspace' })
    await api.writeWorkspaceDocxText({
      path: 'paper.docx',
      workspaceRoot: '/tmp/workspace',
      paragraphs: [{ index: 1, text: 'edited' }]
    })

    expect(invoke).toHaveBeenCalledWith('file:read-workspace', {
      path: 'paper.pdf',
      workspaceRoot: '/tmp/workspace'
    })
    expect(invoke).toHaveBeenCalledWith('file:preview-workspace-html', {
      path: 'status.html',
      workspaceRoot: '/tmp/workspace'
    })
    expect(invoke).toHaveBeenCalledWith('file:write-docx-text', {
      path: 'paper.docx',
      workspaceRoot: '/tmp/workspace',
      paragraphs: [{ index: 1, text: 'edited' }]
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

  it('exposes connect-phone and remote-channel APIs on canonical IPC channels', async () => {
    const api = exposedApi as {
      getConnectPhoneStatus(): Promise<unknown>
      runScheduleTask(taskId: string): Promise<unknown>
      startConnectPhoneInstallQr(provider: 'feishu' | 'weixin', options?: { isLark?: boolean }): Promise<unknown>
      pollConnectPhoneInstall(provider: 'feishu' | 'weixin', deviceCode: string): Promise<unknown>
      onRemoteChannelActivity(handler: (payload: unknown) => void): () => void
      updateRemoteChannelActiveThreadContext(payload: unknown): Promise<unknown>
      mirrorRemoteChannelMessage(threadId: string, text: string, direction: 'user' | 'assistant'): Promise<unknown>
      createRemoteChannelTaskFromText(text: string, options?: { channelId?: string; modelHint?: string; mode?: 'agent' | 'plan' }): Promise<unknown>
    }

    expect('getClawStatus' in api).toBe(false)
    expect('runClawTask' in api).toBe(false)
    expect('runConnectPhoneTask' in api).toBe(false)
    expect('startClawImInstallQr' in api).toBe(false)
    expect('pollClawImInstall' in api).toBe(false)
    expect('onClawChannelActivity' in api).toBe(false)
    expect('updateClawActiveThreadContext' in api).toBe(false)
    expect('mirrorClawChannelMessage' in api).toBe(false)
    expect(`mirrorRemoteChannelMessageTo${'Feishu'}` in api).toBe(false)
    expect('createClawTaskFromText' in api).toBe(false)

    await api.getConnectPhoneStatus()
    await api.runScheduleTask('task-1')
    await api.startConnectPhoneInstallQr('feishu', { isLark: true })
    await api.pollConnectPhoneInstall('feishu', 'device-1')
    await api.updateRemoteChannelActiveThreadContext({ threadId: 'thread-1' })
    await api.mirrorRemoteChannelMessage('thread-1', 'hello', 'user')
    await api.createRemoteChannelTaskFromText('schedule this', {
      channelId: 'channel-1',
      modelHint: 'auto',
      mode: 'agent'
    })

    const handler = vi.fn()
    const unsubscribe = api.onRemoteChannelActivity(handler)
    const wrapped = on.mock.calls.find(([channel]) => channel === 'remoteChannel:activity')?.[1]
    wrapped?.({}, { channelId: 'channel-1', threadId: 'thread-1' })
    unsubscribe()

    expect(invoke).toHaveBeenCalledWith('connectPhone:status')
    expect(invoke).toHaveBeenCalledWith('schedule:task:run', 'task-1')
    expect(invoke).toHaveBeenCalledWith('connectPhone:install:qrcode', { provider: 'feishu', isLark: true })
    expect(invoke).toHaveBeenCalledWith('connectPhone:install:poll', { provider: 'feishu', deviceCode: 'device-1' })
    expect(invoke).toHaveBeenCalledWith('remoteChannel:active-thread-context', { threadId: 'thread-1' })
    expect(invoke).toHaveBeenCalledWith('remoteChannel:message:mirror', {
      threadId: 'thread-1',
      text: 'hello',
      direction: 'user'
    })
    expect(invoke).toHaveBeenCalledWith('remoteChannel:task:create-from-text', {
      text: 'schedule this',
      channelId: 'channel-1',
      modelHint: 'auto',
      mode: 'agent'
    })
    expect(handler).toHaveBeenCalledWith({ channelId: 'channel-1', threadId: 'thread-1' })
    expect(removeListener).toHaveBeenCalledWith('remoteChannel:activity', wrapped)
  })

  it('exposes Paper Radar IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      paperRadar: {
        status(): Promise<unknown>
        syncProfile(payload: unknown): Promise<unknown>
        review(payload: unknown): Promise<unknown>
        search(payload: unknown): Promise<unknown>
        digest(payload: unknown): Promise<unknown>
      }
    }

    await api.paperRadar.status()
    await api.paperRadar.syncProfile({ profile: 'lab_default', maxRecords: 20 })
    await api.paperRadar.review({
      profile: { name: 'lab_default', keywords: [], excludeKeywords: [], arxivCategories: [], biorxivSubjects: [] },
      days: 7,
      topK: 5
    })
    await api.paperRadar.search({ query: 'protein design', topK: 5 })
    await api.paperRadar.digest({ profile: 'lab_default', days: 7, topK: 5 })

    expect(invoke).toHaveBeenCalledWith('paperRadar:status')
    expect(invoke).toHaveBeenCalledWith('paperRadar:sync-profile', { profile: 'lab_default', maxRecords: 20 })
    expect(invoke).toHaveBeenCalledWith('paperRadar:review', {
      profile: { name: 'lab_default', keywords: [], excludeKeywords: [], arxivCategories: [], biorxivSubjects: [] },
      days: 7,
      topK: 5
    })
    expect(invoke).toHaveBeenCalledWith('paperRadar:search', { query: 'protein design', topK: 5 })
    expect(invoke).toHaveBeenCalledWith('paperRadar:digest', { profile: 'lab_default', days: 7, topK: 5 })
  })

  it('exposes Research Cards IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      researchCards: {
        list(payload?: unknown): Promise<unknown>
        create(payload: unknown): Promise<unknown>
        update(payload: unknown): Promise<unknown>
        archive(payload: unknown): Promise<unknown>
      }
    }

    await api.researchCards.list({ kind: 'claim' })
    await api.researchCards.create({ kind: 'claim', title: 'SPO11 trigger claim' })
    await api.researchCards.update({ cardId: 'rc-1', patch: { status: 'needs_evidence' } })
    await api.researchCards.archive({ cardId: 'rc-1' })

    expect(invoke).toHaveBeenCalledWith('researchCards:list', { kind: 'claim' })
    expect(invoke).toHaveBeenCalledWith('researchCards:create', { kind: 'claim', title: 'SPO11 trigger claim' })
    expect(invoke).toHaveBeenCalledWith('researchCards:update', { cardId: 'rc-1', patch: { status: 'needs_evidence' } })
    expect(invoke).toHaveBeenCalledWith('researchCards:archive', { cardId: 'rc-1' })
  })

  it('exposes PDF annotation sidecar IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      pdfAnnotations: {
        load(payload: unknown): Promise<unknown>
        save(payload: unknown): Promise<unknown>
        export(payload: unknown): Promise<unknown>
        exportPdf(payload: unknown): Promise<unknown>
        import(payload: unknown): Promise<unknown>
      }
    }
    const target = { pdfPath: '/tmp/workspace/paper.pdf', workspaceRoot: '/tmp/workspace' }
    const sidecar = {
      schemaVersion: 1,
      version: 0,
      manifest: {
        app: 'sciforge.pdf-annotations',
        schemaVersion: 1,
        privacy: { explicitOnly: true, chatTranscriptEmbedded: false },
        contribution: { reviewableJson: true, mergeKey: 'threadId', conflictResolution: 'updatedAt' },
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z'
      },
      pdfFingerprint: { sha256: 'sha256', size: 1 },
      anchors: [],
      annotations: [],
      threads: [],
      authors: [],
      updatedAt: '2026-06-22T00:00:00.000Z'
    }

    await api.pdfAnnotations.load(target)
    await api.pdfAnnotations.save({ ...target, sidecar })
    await api.pdfAnnotations.export({ ...target, sidecar, anonymizeAuthors: true })
    await api.pdfAnnotations.exportPdf({ ...target, sidecar })
    await api.pdfAnnotations.import({ ...target, packageBase64: 'ZmFrZS16aXA=' })

    expect(invoke).toHaveBeenCalledWith('pdfAnnotations:load', target)
    expect(invoke).toHaveBeenCalledWith('pdfAnnotations:save', { ...target, sidecar })
    expect(invoke).toHaveBeenCalledWith('pdfAnnotations:export', { ...target, sidecar, anonymizeAuthors: true })
    expect(invoke).toHaveBeenCalledWith('pdfAnnotations:exportPdf', { ...target, sidecar })
    expect(invoke).toHaveBeenCalledWith('pdfAnnotations:import', { ...target, packageBase64: 'ZmFrZS16aXA=' })
  })

  it('exposes PDF review IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      pdfReview: {
        generate(payload: unknown): Promise<unknown>
        improveAnnotation(payload: unknown): Promise<unknown>
      }
    }
    const target = { pdfPath: '/tmp/workspace/paper.pdf', workspaceRoot: '/tmp/workspace' }
    const sidecar = {
      schemaVersion: 1,
      version: 0,
      manifest: {
        app: 'sciforge.pdf-annotations',
        schemaVersion: 1,
        privacy: { explicitOnly: true, chatTranscriptEmbedded: false },
        contribution: { reviewableJson: true, mergeKey: 'threadId', conflictResolution: 'updatedAt' },
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z'
      },
      pdfFingerprint: { sha256: 'sha256', size: 1 },
      anchors: [],
      annotations: [],
      threads: [],
      authors: [],
      updatedAt: '2026-06-22T00:00:00.000Z'
    }

    await api.pdfReview.generate(target)
    await api.pdfReview.improveAnnotation({ ...target, sidecar, threadId: 'thread-1', annotationId: 'ann-1' })

    expect(invoke).toHaveBeenCalledWith('pdfReview:generate', target)
    expect(invoke).toHaveBeenCalledWith('pdfReview:improveAnnotation', {
      ...target,
      sidecar,
      threadId: 'thread-1',
      annotationId: 'ann-1'
    })
  })

  it('exposes visible context IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      visibleContext: {
        publish(snapshot: unknown): Promise<unknown>
        get(): Promise<unknown>
      }
    }
    const snapshot = {
      schemaVersion: 1,
      updatedAt: '2026-07-04T00:00:00.000Z',
      workspaceRoot: '/tmp/workspace',
      components: [{
        id: 'right-sidebar',
        region: 'right-sidebar',
        component: 'file-preview',
        visible: true,
        updatedAt: '2026-07-04T00:00:00.000Z',
        summary: 'Previewing a file.'
      }]
    }

    await api.visibleContext.publish(snapshot)
    await api.visibleContext.get()

    expect(invoke).toHaveBeenCalledWith('visibleContext:publish', snapshot)
    expect(invoke).toHaveBeenCalledWith('visibleContext:get')
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

    await api.agentRuntime.subscribeEvents({ runtimeId: 'codex', threadId: 'thread-1', streamId: 'stream-1' })
    await api.agentRuntime.stopEvents('stream-1')
    await api.agentRuntime.interruptTurn({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', discard: true })
    await api.agentRuntime.steerTurn({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', text: 'continue' })
    await api.agentRuntime.renameThread({ runtimeId: 'codex', threadId: 'thread-1', title: 'Renamed' })
    await api.agentRuntime.deleteThread({ runtimeId: 'codex', threadId: 'thread-1' })
    await api.agentRuntime.compactThread({ runtimeId: 'codex', threadId: 'thread-1', reason: 'manual' })
    await api.agentRuntime.forkThread({ runtimeId: 'codex', threadId: 'thread-1', relation: 'side', title: 'Side path' })
    await api.agentRuntime.resumeSession({ runtimeId: 'codex', sessionId: 'session-1', model: 'deepseek-v4-pro', mode: 'agent' })
    await api.agentRuntime.updateThreadRelation({ runtimeId: 'codex', threadId: 'thread-1', relation: 'primary' })
    await api.agentRuntime.usage({ groupBy: 'thread', threadId: 'thread-1' })
    await api.agentRuntime.resolveApproval({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    await api.agentRuntime.resolveUserInput({
      runtimeId: 'codex',
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
      runtimeId: 'codex',
      threadId: 'thread-1',
      streamId: 'stream-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:stopEvents', 'stream-1')
    expect(invoke).toHaveBeenCalledWith('agentRuntime:interruptTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: true
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:steerTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: 'continue'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:renameThread', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Renamed'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:deleteThread', {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:compactThread', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      reason: 'manual'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:forkThread', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resumeSession', {
      runtimeId: 'codex',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:updateThreadRelation', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:usage', {
      groupBy: 'thread',
      threadId: 'thread-1'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resolveApproval', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    expect(invoke).toHaveBeenCalledWith('agentRuntime:resolveUserInput', {
      runtimeId: 'codex',
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
