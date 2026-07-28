import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilityResourceContentAccessFromUrl } from '../shared/workspace-preview-asset-url'

const invoke = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()
const setZoomFactor = vi.fn()
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
  webFrame: {
    setZoomFactor
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
    setZoomFactor.mockReset()
    exposedApi = undefined
    await import('./index')
  })

  it('uses native Chromium zoom for renderer UI scaling', () => {
    const api = exposedApi as {
      setUiZoomFactor(factor: number): void
    }

    api.setUiZoomFactor(0.82)
    api.setUiZoomFactor(0.1)
    api.setUiZoomFactor(Number.NaN)

    expect(setZoomFactor).toHaveBeenNthCalledWith(1, 0.82)
    expect(setZoomFactor).toHaveBeenNthCalledWith(2, 0.5)
    expect(setZoomFactor).toHaveBeenNthCalledWith(3, 1)
  })

  it('exposes one runtime-neutral model access status bridge', async () => {
    const api = exposedApi as {
      getModelAccessStatus(): Promise<unknown>
    }

    await api.getModelAccessStatus()

    expect(invoke).toHaveBeenCalledWith('modelAccess:status')
  })

  it('exposes one generic constrained file picker without a Biology Room facade', async () => {
    const api = exposedApi as {
      pickFile(request: unknown): Promise<unknown>
      biologyRoom?: Record<string, unknown>
    }
    const request = {
      title: 'Select data',
      defaultPath: '/tmp/workspace',
      filters: [{ name: 'Data', extensions: ['csv'] }]
    }

    await api.pickFile(request)

    expect(invoke).toHaveBeenCalledWith('workspace:pick-file', request)
    expect(api.biologyRoom).toBeUndefined()
  })

  it('exposes durable full-trace read, export, and clear IPC', async () => {
    const api = exposedApi as {
      traces: {
        read(query?: unknown): Promise<unknown>
        summaries(query?: unknown): Promise<unknown>
        export(traceIds?: readonly string[]): Promise<unknown>
        clear(): Promise<unknown>
      }
    }

    await api.traces.read({ threadId: 'thread-1', limit: 10 })
    await api.traces.summaries({ runtimeId: 'codex', limit: 5 })
    await api.traces.export(['trace-1'])
    await api.traces.clear()

    expect(invoke).toHaveBeenCalledWith('traces:read', { threadId: 'thread-1', limit: 10 })
    expect(invoke).toHaveBeenCalledWith('traces:summaries', { runtimeId: 'codex', limit: 5 })
    expect(invoke).toHaveBeenCalledWith('traces:export', { traceIds: ['trace-1'] })
    expect(invoke).toHaveBeenCalledWith('traces:clear')
  })

  it('exposes the grouped generic extension lifecycle', async () => {
    const api = exposedApi as {
      extensions: {
        list(): Promise<unknown>
        install(input: unknown): Promise<unknown>
        uninstall(input: unknown): Promise<unknown>
        rollback(input: unknown): Promise<unknown>
        setEnabled(input: unknown): Promise<unknown>
      }
    }
    const install = { path: '/tmp/browser.sciforge-extension' }
    const byPackage = { packageName: '@sciforge/domain-browser' }
    const disable = { ...byPackage, enabled: false }

    await api.extensions.list()
    await api.extensions.install(install)
    await api.extensions.uninstall(byPackage)
    await api.extensions.rollback(byPackage)
    await api.extensions.setEnabled(disable)

    expect(invoke).toHaveBeenCalledWith('extensions:list')
    expect(invoke).toHaveBeenCalledWith('extensions:install', install)
    expect(invoke).toHaveBeenCalledWith('extensions:uninstall', byPackage)
    expect(invoke).toHaveBeenCalledWith('extensions:rollback', byPackage)
    expect(invoke).toHaveBeenCalledWith('extensions:set-enabled', disable)
  })

  it('does not expose the removed draw.io runtime API', () => {
    expect(exposedApi).not.toHaveProperty('getLocalDrawioUrl')
  })

  it('exposes the unified VisualDocument lifecycle without legacy canvas methods', async () => {
    const api = exposedApi as Record<string, ((payload: unknown) => Promise<unknown>) | undefined>
    const calls = [
      ['openVisualDocument', 'visual-document:open', { workspaceRoot: '/tmp/project', documentId: 'figure-1' }],
      ['insertVisualDocumentArtifact', 'visual-document:insert-artifact', { workspaceRoot: '/tmp/project', kind: 'image', sourcePath: '/tmp/figure.png' }],
      ['updateVisualDocumentContext', 'visual-document:update-context', { workspaceRoot: '/tmp/project', styleProfileRef: 'paper-style' }],
      ['saveVisualDocumentAnnotations', 'visual-document:save-annotations', { workspaceRoot: '/tmp/project', annotations: [] }],
      ['exportVisualReviewPacket', 'visual-document:export-review-packet', { workspaceRoot: '/tmp/project' }],
      ['createVisualCandidateRevision', 'visual-document:create-candidate', { workspaceRoot: '/tmp/project', candidatePath: '/tmp/candidate.png', summary: 'Improved layout' }],
      ['acceptVisualCandidateRevision', 'visual-document:accept-candidate', { workspaceRoot: '/tmp/project', revisionId: 'revision-1' }],
      ['rejectVisualCandidateRevision', 'visual-document:reject-candidate', { workspaceRoot: '/tmp/project', revisionId: 'revision-1' }]
    ] as const

    for (const [method, channel, payload] of calls) {
      await api[method]?.(payload)
      expect(invoke).toHaveBeenCalledWith(channel, payload)
    }
    await api.getVisualDocumentStatus?.('/tmp/project')
    expect(invoke).toHaveBeenCalledWith('visual-document:status', { workspaceRoot: '/tmp/project' })

  })

  it('exposes real file paths from picked or dropped files', () => {
    const api = exposedApi as {
      getPathForFile(file: File): string
    }
    const file = { name: 'paper.pdf' } as File

    expect(api.getPathForFile(file)).toBe('/tmp/file.txt')
  })

  it('exposes workspace entry import IPC', async () => {
    const api = exposedApi as {
      importWorkspaceEntries(payload: unknown): Promise<unknown>
    }
    const payload = {
      sourcePaths: ['/tmp/source.csv'],
      targetWorkspaceRoot: '/tmp/workspace',
      targetDirectory: 'incoming',
      conflictPolicy: { strategy: 'rename' }
    }

    await api.importWorkspaceEntries(payload)

    expect(invoke).toHaveBeenCalledWith('file:import-workspace-entries', payload)
  })

  it('exposes PDF rename suggestion IPC', async () => {
    const api = exposedApi as {
      suggestWorkspacePdfName(payload: unknown): Promise<unknown>
    }
    const payload = {
      workspaceRoot: '/tmp/workspace',
      path: 'papers/2603.10165v2.pdf'
    }

    await api.suggestWorkspacePdfName(payload)

    expect(invoke).toHaveBeenCalledWith('file:suggest-workspace-pdf-name', payload)
  })

  it('exposes workspace clipboard paste IPC', async () => {
    const api = exposedApi as {
      pasteWorkspaceClipboard(payload: unknown): Promise<unknown>
    }
    const payload = {
      workspaceRoot: '/tmp/workspace',
      targetDirectory: 'notes',
      conflictPolicy: { strategy: 'skip' }
    }

    await api.pasteWorkspaceClipboard(payload)

    expect(invoke).toHaveBeenCalledWith('clipboard:paste-workspace', payload)
  })

  it('keeps preview-specific HTML and DOCX writes off the renderer-facing file IPC surface', async () => {
    const api = exposedApi as {
      readWorkspaceFile(options: unknown): Promise<unknown>
      previewWorkspaceHtml?: unknown
      writeWorkspaceDocxText?: unknown
    }

    await api.readWorkspaceFile({ path: 'paper.pdf', workspaceRoot: '/tmp/workspace' })

    expect(invoke).toHaveBeenCalledWith('file:read-workspace', {
      path: 'paper.pdf',
      workspaceRoot: '/tmp/workspace'
    })
    expect(api.previewWorkspaceHtml).toBeUndefined()
    expect(api.writeWorkspaceDocxText).toBeUndefined()
  })

  it('exposes generic capability and file APIs without domain facades', async () => {
    const api = exposedApi as {
      watchWorkspaceFile(payload: unknown): Promise<unknown>
      unwatchWorkspaceFile(watchId: string): Promise<unknown>
      onWorkspaceFileChanged(handler: (payload: unknown) => void): () => void
      capabilities: {
        bind(input: unknown): Promise<unknown>
        invoke(input: unknown): Promise<unknown>
        resourceContentUrl(access: unknown): string | null
      }
      workspacePreview?: unknown
      biologyRoom?: unknown
    }
    const resource = {
      token: 'cap_abcdefghijklmnopqrstuvwxyz',
      semanticRevision: 'revision-1',
      expiresAt: '2026-07-16T14:00:00.000Z'
    }
    invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === 'file:watch-workspace') return { watchId: 'watch-1' }
      if (channel === 'file:unwatch-workspace') return true
      return undefined
    })

    const capabilityRequest = {
      request: { actionId: 'workspace-preview.list', input: {} }
    }
    const bindRequest = {
      workspaceId: '/tmp/workspace',
      request: { resourceRef: 'res_abcdefghijklmnopqrstuvwxyz' }
    }
    await api.capabilities.bind(bindRequest)
    await api.capabilities.invoke(capabilityRequest)
    await api.watchWorkspaceFile({ path: 'protein.pdb', workspaceRoot: '/tmp/workspace' })
    await api.unwatchWorkspaceFile('watch-1')
    const assetSourceUrl = api.capabilities.resourceContentUrl({
      workspaceId: '/tmp/workspace',
      resource
    })
    const changed = vi.fn()
    const unsubscribe = api.onWorkspaceFileChanged(changed)
    const wrapped = on.mock.calls.find(([channel]) => channel === 'file:workspace-changed')?.[1]
    wrapped?.({}, { ok: true, watchId: 'watch-1' })
    unsubscribe()

    expect(invoke).toHaveBeenCalledWith('capability:bind', bindRequest)
    expect(invoke).toHaveBeenCalledWith('capability:invoke', capabilityRequest)
    expect(invoke).toHaveBeenCalledWith('file:watch-workspace', {
      path: 'protein.pdb',
      workspaceRoot: '/tmp/workspace'
    })
    expect(invoke).toHaveBeenCalledWith('file:unwatch-workspace', 'watch-1')
    expect(assetSourceUrl).not.toBeNull()
    expect(capabilityResourceContentAccessFromUrl(assetSourceUrl!)).toEqual({
      workspaceId: '/tmp/workspace',
      resource
    })
    expect(changed).toHaveBeenCalledWith({ ok: true, watchId: 'watch-1' })
    expect(removeListener).toHaveBeenCalledWith('file:workspace-changed', wrapped)
    expect(api.workspacePreview).toBeUndefined()
    expect(api.biologyRoom).toBeUndefined()
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

  it('does not expose a Paper Radar domain-specific preload bridge', () => {
    const api = exposedApi as {
      paperRadar?: unknown
      capabilities?: {
        invoke?: unknown
      }
    }

    expect(api.paperRadar).toBeUndefined()
    expect(api.capabilities?.invoke).toBeTypeOf('function')
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

  it('does not expose legacy PDF annotation IPC methods through the preload bridge', () => {
    const api = exposedApi as {
      pdfAnnotations?: unknown
    }

    expect(api.pdfAnnotations).toBeUndefined()
  })

  it('exposes visible context IPC methods through the preload bridge', async () => {
    const api = exposedApi as {
      visibleContext: {
        publish(snapshot: unknown): Promise<unknown>
        get(): Promise<unknown>
        readCapturePreview(request: { path: string }): Promise<unknown>
        onRefreshRequested(handler: () => void): () => void
        onCaptureStateChanged(handler: (active: boolean) => void): () => void
      }
    }
    const snapshot = {
      schemaVersion: 3,
      revision: 1,
      publishedAt: '2026-07-04T00:00:00.000Z',
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
      workspaceRoot: '/tmp/workspace',
      components: [{
        id: 'right-sidebar',
        region: 'right-sidebar',
        component: 'workspace-preview',
        visible: true,
        updatedAt: '2026-07-04T00:00:00.000Z',
        summary: 'Previewing a file.'
      }]
    }

    await api.visibleContext.publish(snapshot)
    await api.visibleContext.get()
    await api.visibleContext.readCapturePreview({ path: '/tmp/capture.png' })
    const onRefresh = vi.fn()
    const onCaptureState = vi.fn()
    const stopRefresh = api.visibleContext.onRefreshRequested(onRefresh)
    const stopCaptureState = api.visibleContext.onCaptureStateChanged(onCaptureState)
    const refreshWrapped = on.mock.calls.find(([channel]) => channel === 'visibleContext:refresh-requested')?.[1]
    const captureStateWrapped = on.mock.calls.find(([channel]) => channel === 'visibleContext:capture-state')?.[1]
    refreshWrapped?.({})
    captureStateWrapped?.({}, true)
    stopRefresh()
    stopCaptureState()

    expect(invoke).toHaveBeenCalledWith('visibleContext:publish', snapshot)
    expect(invoke).toHaveBeenCalledWith('visibleContext:get')
    expect(invoke).toHaveBeenCalledWith('visibleContext:capture:preview', { path: '/tmp/capture.png' })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onCaptureState).toHaveBeenCalledWith(true)
    expect(removeListener).toHaveBeenCalledWith('visibleContext:refresh-requested', refreshWrapped)
    expect(removeListener).toHaveBeenCalledWith('visibleContext:capture-state', captureStateWrapped)
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
