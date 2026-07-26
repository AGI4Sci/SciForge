import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
const { showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/workspace/data.csv'] })),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(async () => ({ isEmpty: () => false })),
    quit: vi.fn()
  },
  dialog: { showOpenDialog, showSaveDialog },
  shell: {
    openExternal: vi.fn(async () => undefined)
  },
  nativeImage: {
    createEmpty: vi.fn(() => ({ isEmpty: () => true }))
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

const { writeExportServiceMock } = vi.hoisted(() => ({
  writeExportServiceMock: {
    exportWriteDocument: vi.fn(async (payload: { format?: string }) => ({
      ok: true,
      path: '/tmp/workspace/report.html',
      format: payload.format ?? 'html',
      exportedAt: '2026-07-07T01:00:00.000Z'
    })),
    copyWriteDocumentAsRichText: vi.fn(async () => ({
      ok: true,
      copiedAt: '2026-07-07T01:00:00.000Z'
    }))
  }
}))

vi.mock('../services/write-export-service', () => writeExportServiceMock)

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agents: {
      sciforge: defaultLocalRuntimeSettings()
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

function registerOptions(overrides: Partial<Parameters<typeof import('./register-app-ipc-handlers').registerAppIpcHandlers>[0]> = {}) {
  const applySettingsPatch = vi.fn(async () => settings())
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    actionGuardEvaluator: {
      evaluate: vi.fn(async () => ({ allowed: true }))
    },
    getMainWindow: () => null,
    isTrustedIpcSender: () => true,
    applySettingsPatch,
    getModelAccessStatus: vi.fn(async () => ({
      setupRequired: false,
      mode: 'api' as const,
      service: 'model-router' as const,
      health: 'healthy' as const,
      adapterId: null,
      credentialState: 'configured' as const,
      protocol: null,
      protocolState: 'pending-first-request' as const,
      traceCaptureReady: true,
      action: 'The wire protocol will be confirmed by the first real request.'
    })),
    fetchUpstreamModels: vi.fn() as never,
    getRemoteChannelRuntime: () => null,
    getScheduleRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
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
  const destroyedListeners = new Set<() => void>()
  const sender = {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn((event: 'destroyed', listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.add(listener)
      return sender
    }),
    removeListener: vi.fn((event: 'destroyed', listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.delete(listener)
      return sender
    }),
    destroy: vi.fn(() => {
      sender.isDestroyed.mockReturnValue(true)
      const listeners = [...destroyedListeners]
      destroyedListeners.clear()
      for (const listener of listeners) listener()
    })
  }
  return sender
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

function writeExportPayload(overrides: Record<string, unknown> = {}) {
  return {
    path: '/tmp/workspace/report.md',
    workspaceRoot: '/tmp/workspace',
    format: 'html',
    content: '# Report',
    runtimeId: 'codex',
    threadId: 'thread-1',
    ...overrides
  }
}

function visualStyleExtractionFixture() {
  const profile = {
    version: 1 as const,
    id: 'manuscript-default',
    scope: 'manuscript' as const,
    source: { type: 'reference' as const, path: 'figures/reference.png', figureId: 'Fig. 2A' },
    tokens: {
      canvas: { width: 640, height: 420, aspectRatio: 1.52, background: '#ffffff' },
      palette: { colors: ['#222222', '#d24b4b'], background: '#ffffff', ink: '#222222', accent: ['#d24b4b'], colorMode: 'limited' as const },
      typography: { fontFamily: 'Arial', axisSize: 8, labelSize: 9, titleSize: 11, weight: 'regular' as const },
      strokes: { ink: '#222222', primaryWidth: 1.2, secondaryWidth: 0.6, lineCap: 'round' as const },
      spacing: { margin: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 }, gutter: 'balanced' as const, density: 'balanced' as const },
      shapes: { fillMode: 'mixed' as const, shadow: 'none' as const }
    },
    semanticDescription: 'Compact scientific figure with a restrained red accent.',
    confidence: { overall: 0.72, palette: 0.8, spacing: 0.7, plots: 0.5, typography: 0.35, generatedAssets: 0.2 }
  }

  return {
    ok: true as const,
    profile,
    diagnostics: {
      analyzedAt: '2026-07-07T00:00:00.000Z',
      sampledPixels: 10,
      foregroundRatio: 0.3,
      darkPixelRatio: 0.2,
      chromaRatio: 0.1,
      warnings: []
    }
  }
}

describe('registerAppIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('registers only canonical remote channel mirror IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const removedFeishuMirrorChannel = `remoteChannel:message:mirror-to-${'feishu'}`

    registerAppIpcHandlers(registerOptions())

    expect(handlers.get('remoteChannel:message:mirror')).toBeTypeOf('function')
    expect(handlers.has(removedFeishuMirrorChannel)).toBe(false)
  })

  it('rejects IPC from an untrusted renderer before dispatching a handler', async () => {
    const getModelAccessStatus = vi.fn()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({
      isTrustedIpcSender: () => false,
      getModelAccessStatus
    }))

    await expect(handlers.get('modelAccess:status')?.({})).rejects.toThrow('untrusted renderer frame')
    expect(getModelAccessStatus).not.toHaveBeenCalled()
  })

  it('does not register the removed draw.io runtime channel', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    expect(handlers.has('drawio:local-url')).toBe(false)
  })

  it('returns one runtime-neutral model access status', async () => {
    const getModelAccessStatus = vi.fn(async () => ({
      setupRequired: false,
      mode: 'coding-plan' as const,
      service: 'plan-gateway' as const,
      health: 'healthy' as const,
      adapterId: 'codex',
      credentialState: 'authenticated' as const,
      protocol: 'responses' as const,
      protocolState: 'selected' as const,
      traceCaptureReady: true,
      action: 'Coding Plan access and trace capture are ready.'
    }))
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ getModelAccessStatus }))

    await expect(handlers.get('modelAccess:status')?.({})).resolves.toEqual({
      setupRequired: false,
      mode: 'coding-plan',
      service: 'plan-gateway',
      health: 'healthy',
      adapterId: 'codex',
      credentialState: 'authenticated',
      protocol: 'responses',
      protocolState: 'selected',
      traceCaptureReady: true,
      action: 'Coding Plan access and trace capture are ready.'
    })
    expect(getModelAccessStatus).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))
  })

  it('validates durable trace queries and exports through an explicit save destination', async () => {
    const traces = {
      read: vi.fn(async () => ({ events: [], total: 0, corruptLines: 0 })),
      summaries: vi.fn(async () => [{
        traceId: 'trace-1',
        sources: ['agent-runtime'],
        startedAt: '2026-07-19T00:00:00.000Z',
        endedAt: '2026-07-19T00:00:01.000Z',
        durationMs: 1_000,
        status: 'completed',
        requestCount: 1,
        eventCount: 4,
        agentEventCount: 2,
        errorCount: 0
      }]),
      export: vi.fn(async ({ destination }: { destination: string }) => ({
        destination,
        exportedAt: '2026-07-19T00:00:02.000Z',
        eventCount: 4,
        traceCount: 1
      })),
      clear: vi.fn(async () => ({ deletedFiles: 1, deletedEvents: 4 }))
    }
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/sciforge-trace.jsonl'
    })
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ traces: traces as never }))

    await expect(handlers.get('traces:summaries')?.({}, {
      runtimeId: 'codex',
      limit: 20
    })).resolves.toEqual([expect.objectContaining({ traceId: 'trace-1' })])
    expect(traces.summaries).toHaveBeenCalledWith({ runtimeId: 'codex', limit: 20 })

    await expect(handlers.get('traces:export')?.({}, {
      traceIds: ['trace-1']
    })).resolves.toMatchObject({
      canceled: false,
      destination: '/tmp/sciforge-trace.jsonl',
      traceCount: 1
    })
    expect(traces.export).toHaveBeenCalledWith({
      destination: '/tmp/sciforge-trace.jsonl',
      traceIds: ['trace-1']
    })

    await expect(handlers.get('traces:clear')?.({})).resolves.toEqual({
      deletedFiles: 1,
      deletedEvents: 4
    })
    await expect(handlers.get('traces:read')?.({}, {
      kinds: ['not-a-trace-kind']
    })).rejects.toThrow(/payload for traces:read/i)
  })

  it('validates and routes managed visible capture preview requests', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const readCapturePreview = vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      dataUrl: 'data:image/png;base64,capture',
      mimeType: 'image/png' as const,
      size: 7
    }))
    const visibleContext = {
      publish: vi.fn(),
      get: vi.fn(),
      readCapturePreview
    }
    registerAppIpcHandlers(registerOptions({ visibleContext }))

    const handler = handlers.get('visibleContext:capture:preview')
    await expect(handler?.({}, { path: '/tmp/visible-context/captures/capture-1.png' })).resolves.toMatchObject({
      ok: true,
      mimeType: 'image/png'
    })
    expect(readCapturePreview).toHaveBeenCalledWith('/tmp/visible-context/captures/capture-1.png')
    await expect(handler?.({}, { path: '' })).rejects.toThrow(
      /Invalid payload for visibleContext:capture:preview/
    )
  })

  it('binds visible-context publishes to the native sender identity', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const publish = vi.fn(async (snapshot) => snapshot)
    const visibleContext = {
      publish,
      get: vi.fn(),
      readCapturePreview: vi.fn()
    }
    registerAppIpcHandlers(registerOptions({ visibleContext }))
    const sender = { id: 41, capturePage: vi.fn() }
    const payload = {
      schemaVersion: 3,
      revision: 7,
      publishedAt: '2026-07-15T12:00:00.000Z',
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
      activeThreadId: 'thread-7',
      components: []
    }

    await handlers.get('visibleContext:publish')?.({ sender }, payload)

    expect(publish).toHaveBeenCalledWith({ ...payload, windowId: 'electron:41' })
  })

  it('rejects invalid settings patches at the handler boundary', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    expect(handler).toBeTypeOf('function')
    await expect(
      handler?.({}, { agents: { sciforge: { mysteryFlag: true } } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('does not echo API credentials when a settings payload is rejected', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const apiKey = 'sk-sensitive-settings-key-1234567890'
    let failure: unknown
    try {
      await handlers.get('settings:set')?.({}, {
        modelRouter: {
          profiles: {
            default: {
              textReasoner: {
                baseUrl: 'https://api.example.test/v1',
                apiKey,
                model: 'model-1'
              }
            }
          }
        },
        remoteChannel: {
          channels: [{
            lastFailure: {
              provider: 'zulip',
              message: 'Runtime offline',
              occurredAt: '2026-07-19T00:00:00.000Z',
              unexpected: true
            }
          }]
        }
      })
    } catch (error) {
      failure = error
    }

    expect(String(failure)).toContain('Invalid payload for settings:set')
    expect(String(failure)).not.toContain(apiKey)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('passes valid settings patches through to applySettingsPatch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        sciforge: {
          port: 9000
        }
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('does not register Paper Radar domain-specific IPC channels', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions())

    expect(handlers.size).toBe(142)
    expect([...handlers.keys()].filter((channel) => channel.startsWith('paperRadar:'))).toEqual([])
  })

  it('routes visual style profile extraction through its single IPC command', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const extraction = visualStyleExtractionFixture()
    const extractVisualStyleProfile = vi.fn(async () => extraction)

    registerAppIpcHandlers(registerOptions({
      extractVisualStyleProfile
    }))

    const result = await handlers.get('visual-style:extract-profile')?.({}, {
      workspaceRoot: '/tmp/workspace',
      sourcePath: ' figures/reference.png ',
      sourceType: 'image',
      sourceKind: 'reference',
      scope: 'manuscript',
      figureId: ' Fig. 2A ',
      notes: ' style only '
    })

    expect(extractVisualStyleProfile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'figures/reference.png',
      sourceType: 'image',
      sourceKind: 'reference',
      scope: 'manuscript',
      figureId: 'Fig. 2A',
      notes: 'style only'
    })
    expect(result).toEqual(extraction)
  })

  it('saves visual style profiles through the dedicated IPC command', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sciforge-visual-style-')))
    const extraction = visualStyleExtractionFixture()
    try {
      registerAppIpcHandlers(registerOptions())

      const result = await handlers.get('visual-style:save-profile')?.({}, {
        workspaceRoot,
        path: ' .sciforge/visual-styles/manuscript-default.json ',
        profile: extraction.profile,
        diagnostics: extraction.diagnostics
      })

      expect(result).toMatchObject({
        ok: true,
        path: join(workspaceRoot, '.sciforge/visual-styles/manuscript-default.json')
      })
      const saved = JSON.parse(readFileSync(join(workspaceRoot, '.sciforge/visual-styles/manuscript-default.json'), 'utf8'))
      expect(saved).toEqual({
        profile: extraction.profile,
        diagnostics: extraction.diagnostics
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('routes Research Cards IPC requests through the service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const researchCards = {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({ id: 'rc-1', ...input })),
      update: vi.fn(async (input) => ({ id: input.cardId, ...input.patch })),
      archive: vi.fn(async (input) => ({ id: input.cardId, archived: input.archived !== false }))
    }

    registerAppIpcHandlers(registerOptions({ researchCards: researchCards as never }))

    await expect(handlers.get('researchCards:list')?.({}, { kind: 'claim', query: '  SPO11  ' }))
      .resolves.toEqual([])
    await expect(handlers.get('researchCards:create')?.({}, {
      kind: 'claim',
      title: '  SPO11 trigger claim  ',
      stage: 'draft'
    })).resolves.toMatchObject({
      id: 'rc-1',
      kind: 'claim',
      title: 'SPO11 trigger claim',
      stage: 'draft'
    })
    await expect(handlers.get('researchCards:update')?.({}, {
      cardId: 'rc-1',
      patch: { status: 'needs_evidence' }
    })).resolves.toMatchObject({
      id: 'rc-1',
      status: 'needs_evidence'
    })
    await expect(handlers.get('researchCards:archive')?.({}, { cardId: 'rc-1' }))
      .resolves.toMatchObject({ id: 'rc-1', archived: true })

    expect(researchCards.list).toHaveBeenCalledWith({ kind: 'claim', query: 'SPO11' })
    expect(researchCards.create).toHaveBeenCalledWith({
      kind: 'claim',
      title: 'SPO11 trigger claim',
      stage: 'draft'
    })
    expect(researchCards.update).toHaveBeenCalledWith({
      cardId: 'rc-1',
      patch: { status: 'needs_evidence' }
    })
    expect(researchCards.archive).toHaveBeenCalledWith({ cardId: 'rc-1' })
  })

  it('validates Research Cards payloads before resolving the service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const researchCards = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn()
    }

    registerAppIpcHandlers(registerOptions({ researchCards: researchCards as never }))

    await expect(handlers.get('researchCards:create')?.({}, {
      kind: 'claim',
      title: 'Claim',
      stage: 'not-a-stage'
    })).rejects.toThrow(/Invalid payload for researchCards:create/)
    expect(researchCards.create).not.toHaveBeenCalled()
  })

  it('does not register legacy PDF annotation sidecar IPC handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    expect(handlers.has('pdfAnnotations:load')).toBe(false)
    expect(handlers.has('pdfAnnotations:save')).toBe(false)
    expect(handlers.has('pdfAnnotations:export')).toBe(false)
    expect(handlers.has('pdfAnnotations:exportPdf')).toBe(false)
    expect(handlers.has('pdfAnnotations:import')).toBe(false)
  })

  it('rejects write export when an installed action guard denies it', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const evaluate = vi.fn(async () => ({
      allowed: false,
      message: 'Publication is blocked.',
      metadata: { 'evidence.guard': { highestSeverity: 'blocker' } }
    }))

    registerAppIpcHandlers(registerOptions({
      actionGuardEvaluator: { evaluate }
    }))

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload())
    ).rejects.toThrow('Publication is blocked.')
    expect(evaluate).toHaveBeenCalledWith({
      actionId: 'write.export',
      payload: writeExportPayload()
    })
    expect(writeExportServiceMock.exportWriteDocument).not.toHaveBeenCalled()
  })

  it('passes guard-only fields to action guards but not to the export service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const evaluate = vi.fn(async () => ({
      allowed: true,
      metadata: { 'evidence.guard': { overrideConfirmed: true } }
    }))
    const payload = writeExportPayload({ overrideConfirmed: true })

    registerAppIpcHandlers(registerOptions({
      actionGuardEvaluator: { evaluate }
    }))

    await expect(
      handlers.get('write:export')?.({}, payload)
    ).resolves.toEqual({
      ok: true,
      path: '/tmp/workspace/report.html',
      format: 'html',
      exportedAt: '2026-07-07T01:00:00.000Z'
    })
    expect(evaluate).toHaveBeenCalledWith({
      actionId: 'write.export',
      payload
    })
    expect(writeExportServiceMock.exportWriteDocument).toHaveBeenCalledWith(
      {
        path: '/tmp/workspace/report.md',
        workspaceRoot: '/tmp/workspace',
        format: 'html',
        content: '# Report'
      },
      { parentWindow: null }
    )
  })

  it('returns a dispatcher for dev browser bridge calls that uses the same handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())
    const sender = createSender(901)

    const dispatcher = registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        sciforge: {
          port: 9100
        }
      }
    }
    await expect(dispatcher.invoke('settings:set', payload, sender)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
    expect(handlers.get('settings:set')).toBeTypeOf('function')
  })

  it('returns VisualDocument IPC validation errors instead of rejecting through Electron', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const openVisualDocument = vi.fn()
    const sender = createSender(910)

    const dispatcher = registerAppIpcHandlers(registerOptions({ openVisualDocument }))

    await expect(
      dispatcher.invoke('visual-document:open', { workspaceRoot: '' }, sender)
    ).resolves.toMatchObject({
      ok: false,
      status: 'invalid_request'
    })
    expect(openVisualDocument).not.toHaveBeenCalled()
  })

  it('routes the complete VisualDocument lifecycle through one strict IPC surface', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const handlers = {
      getVisualDocumentStatus: vi.fn(async () => ({ ok: true })),
      openVisualDocument: vi.fn(async (request: unknown) => request),
      insertVisualDocumentArtifact: vi.fn(async (request: unknown) => request),
      updateVisualDocumentContext: vi.fn(async (request: unknown) => request),
      saveVisualDocumentAnnotations: vi.fn(async (request: unknown) => request),
      exportVisualReviewPacket: vi.fn(async (request: unknown) => request),
      createVisualCandidateRevision: vi.fn(async (request: unknown) => request),
      acceptVisualCandidateRevision: vi.fn(async (request: unknown) => request),
      rejectVisualCandidateRevision: vi.fn(async (request: unknown) => request)
    }
    const dispatcher = registerAppIpcHandlers(registerOptions(handlers as never))
    const sender = createSender(911)
    const requests = [
      ['visual-document:status', { workspaceRoot: '/tmp/project' }, handlers.getVisualDocumentStatus],
      ['visual-document:open', { workspaceRoot: '/tmp/project', documentId: 'figure-1', createIfMissing: false }, handlers.openVisualDocument],
      ['visual-document:insert-artifact', { workspaceRoot: '/tmp/project', kind: 'image', sourcePath: '/tmp/figure.png' }, handlers.insertVisualDocumentArtifact],
      ['visual-document:update-context', { workspaceRoot: '/tmp/project', styleProfileRef: 'paper-style' }, handlers.updateVisualDocumentContext],
      ['visual-document:save-annotations', { workspaceRoot: '/tmp/project', annotations: [] }, handlers.saveVisualDocumentAnnotations],
      ['visual-document:export-review-packet', { workspaceRoot: '/tmp/project' }, handlers.exportVisualReviewPacket],
      ['visual-document:create-candidate', {
        workspaceRoot: '/tmp/project',
        candidatePath: '/tmp/candidate.png',
        summary: 'Improved layout',
        reviewEvidence: {
          tool: 'image_generation_review_candidate',
          ok: true,
          reviewedArtifactPath: '/tmp/candidate.png',
          reviewedArtifactHash: 'a'.repeat(64),
          reviewedAt: '2026-07-12T00:00:00.000Z',
          score: { overall: 0.9, dimensions: 1, nonEmpty: 1, background: 1, semantic: 0.92, warnings: [] },
          semantic: { pass: true, summary: 'Passed review.', violations: [], repairInstructions: [] },
          repairable: false,
          warnings: []
        }
      }, handlers.createVisualCandidateRevision],
      ['visual-document:accept-candidate', { workspaceRoot: '/tmp/project', revisionId: 'revision-1' }, handlers.acceptVisualCandidateRevision],
      ['visual-document:reject-candidate', { workspaceRoot: '/tmp/project', revisionId: 'revision-1' }, handlers.rejectVisualCandidateRevision]
    ] as const

    for (const [channel, payload, handler] of requests) {
      await dispatcher.invoke(channel, payload, sender)
      expect(handler).toHaveBeenCalledOnce()
    }
    expect(handlers.getVisualDocumentStatus).toHaveBeenCalledWith('/tmp/project')
    expect(handlers.acceptVisualCandidateRevision).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/project',
      revisionId: 'revision-1'
    })
  })

  it('does not register retired workspace surface business channels', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions())

    const retiredChannels = [
      'biologyRoom:create',
      'biologyRoom:openOrCreate',
      'biologyRoom:load',
      'biologyRoom:list',
      'biologyRoom:observe',
      'biologyRoom:apply',
      'biologyRoom:refresh',
      'biologyRoom:history',
      'workspacePreview:listPlugins',
      'workspacePreview:open',
      'workspacePreview:observe',
      'workspacePreview:releaseSession',
      'workspacePreview:describeAsset',
      'workspacePreview:readRange',
      'workspacePreview:prepareArtifact',
      'workspacePreview:readArtifactRange',
      'workspacePreview:applyEdit',
      'workspacePreview:export',
      'workspacePreview:invokeAction',
      'workspacePreview:watch',
      'workspacePreview:unwatch'
    ]

    for (const channel of retiredChannels) {
      expect(handlers.has(channel), channel).toBe(false)
    }
    expect(handlers.has('workspace:pick-file')).toBe(true)
    expect(handlers.has('biologyRoom:pick-file')).toBe(false)
  })

  it('uses one validated generic file picker for domain-declared filters', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions())

    const result = await handlers.get('workspace:pick-file')?.({}, {
      title: ' Select data asset ',
      defaultPath: ' /tmp/workspace ',
      filters: [
        { name: ' Data ', extensions: ['csv', 'tsv', 'nii.gz'] },
        { name: ' All files ', extensions: ['*'] }
      ]
    })

    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Select data asset',
      defaultPath: '/tmp/workspace',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'Data', extensions: ['csv', 'tsv', 'nii.gz'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    expect(result).toEqual({ canceled: false, path: '/tmp/workspace/data.csv' })
  })

  it('rejects unconstrained generic file-picker payloads', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const dispatcher = registerAppIpcHandlers(registerOptions())

    await expect(dispatcher.invoke('workspace:pick-file', {
      title: 'Unsafe picker',
      filters: []
    }, createSender(12))).rejects.toThrow('Invalid payload for workspace:pick-file')
  })

  it('keeps the generic workspace file watch and unwatch lifecycle', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'workspace-file-ipc-watch-'))
    const filePath = join(workspaceRoot, 'notes.txt')
    writeFileSync(filePath, 'initial content', 'utf8')

    try {
      registerAppIpcHandlers(registerOptions())
      const sender = createSender(7)
      const result = await handlers.get('file:watch-workspace')?.({ sender }, {
        path: ' notes.txt ',
        workspaceRoot: ` ${workspaceRoot} `
      })

      expect(result).toMatchObject({
        ok: true,
        path: realpathSync(filePath),
        content: 'initial content',
        size: 15,
        truncated: false
      })
      expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))

      const watchId = (result as { ok: true; watchId: string }).watchId
      await expect(handlers.get('file:unwatch-workspace')?.({ sender }, watchId)).resolves.toBe(true)
      await expect(handlers.get('file:unwatch-workspace')?.({ sender }, watchId)).resolves.toBe(false)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
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
          research: { available: false },
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
        runtimeId: 'sciforge' as const,
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
      handlers.get('agentRuntime:listThreads')?.({}, {
        runtimeId: 'sciforge',
        includeSide: true,
        limit: 20
      })
    ).resolves.toEqual([])
    expect(agentRuntime.listThreads).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      includeSide: true,
      limit: 20
    })
    await expect(
      handlers.get('agentRuntime:startTurn')?.({}, {
        runtimeId: 'codex',
        threadId: 'side-thread-1',
        text: ' hello ',
        visibleContextOwnerThreadId: ' parent-thread-1 ',
        executionIntent: {
          mode: 'execute',
          requirements: [{
            receiptKind: 'visual.capture',
            requiresRegionRef: true
          }]
        }
      })
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
        text: ' keep going ',
        executionIntent: {
          mode: 'inspect',
          requirements: [{ receiptKind: 'visual.look' }]
        }
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
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        reason: ' Manual cleanup '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:forkThread')?.({}, {
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        relation: ' side ',
        title: ' Side path '
      })
    ).resolves.toEqual({
      id: 'forked-thread',
      runtimeId: 'sciforge',
      title: 'Forked',
      updatedAt: '2026-06-11T00:00:00.000Z'
    })
    await expect(
      handlers.get('agentRuntime:resumeSession')?.({}, {
        runtimeId: 'sciforge',
        sessionId: ' session-1 ',
        model: ' deepseek-v4-pro ',
        mode: ' agent '
      })
    ).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(
      handlers.get('agentRuntime:updateThreadRelation')?.({}, {
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        relation: ' primary '
      })
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('agentRuntime:usage')?.({}, {
        runtimeId: 'sciforge',
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
        runtimeId: 'sciforge',
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
      threadId: 'side-thread-1',
      text: 'hello',
      visibleContextOwnerThreadId: 'parent-thread-1',
      executionIntent: {
        mode: 'execute',
        requirements: [{
          receiptKind: 'visual.capture',
          requiresRegionRef: true
        }]
      }
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
      text: 'keep going',
      executionIntent: {
        mode: 'inspect',
        requirements: [{ receiptKind: 'visual.look' }]
      }
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
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      reason: 'Manual cleanup'
    })
    expect(agentRuntime.forkThread).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(agentRuntime.resumeSession).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(agentRuntime.updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(agentRuntime.usage).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      groupBy: 'thread',
      threadId: 'thread-1'
    })
    expect(agentRuntime.auxiliary).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
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

  it('routes auxiliary host-service IPC operations through the injected agent runtime', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const agentRuntime = {
      auxiliary: vi.fn(async (input: { operation: string }) => {
        if (input.operation === 'runCodeNavigation') {
          return {
            ok: true as const,
            locations: [{ path: '/tmp/workspace/src/main.ts', line: 12, column: 4 }]
          }
        }
        if (input.operation === 'listWorkspaceReferences') {
          return {
            ok: true as const,
            references: [{ id: 'ref-1', label: 'src/main.ts', kind: 'file' }]
          }
        }
        return { ok: false as const, reason: 'unhandled operation' }
      })
    }

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    const runCodeNavigationPayload = {
      runtimeId: 'codex' as const,
      operation: 'runCodeNavigation' as const,
      payload: {
        workspaceRoot: '/tmp/workspace',
        query: 'find definition',
        symbol: 'registerAppIpcHandlers'
      }
    }
    const listWorkspaceReferencesPayload = {
      runtimeId: 'claude' as const,
      operation: 'listWorkspaceReferences' as const,
      payload: {
        threadId: 'thread-1',
        workspaceRoot: '/tmp/workspace',
        limit: 20
      }
    }

    await expect(
      handlers.get('agentRuntime:auxiliary')?.({}, runCodeNavigationPayload)
    ).resolves.toEqual({
      ok: true,
      locations: [{ path: '/tmp/workspace/src/main.ts', line: 12, column: 4 }]
    })
    await expect(
      handlers.get('agentRuntime:auxiliary')?.({}, listWorkspaceReferencesPayload)
    ).resolves.toEqual({
      ok: true,
      references: [{ id: 'ref-1', label: 'src/main.ts', kind: 'file' }]
    })

    expect(agentRuntime.auxiliary).toHaveBeenNthCalledWith(1, runCodeNavigationPayload)
    expect(agentRuntime.auxiliary).toHaveBeenNthCalledWith(2, listWorkspaceReferencesPayload)
  })

  it('validates auxiliary host-service payloads and propagates host errors', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const hostError = new Error('workspace reference preview failed')
    const agentRuntime = {
      auxiliary: vi.fn(async () => {
        throw hostError
      })
    }

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('agentRuntime:auxiliary')?.({}, {
        runtimeId: 'codex',
        operation: 'runCodeNavigation',
        payload: 'not-a-payload-record'
      })
    ).rejects.toThrow(/Invalid payload for agentRuntime:auxiliary/)
    expect(agentRuntime.auxiliary).not.toHaveBeenCalled()

    const previewWorkspaceReferencePayload = {
      runtimeId: 'codex' as const,
      operation: 'previewWorkspaceReference' as const,
      payload: {
        referenceId: 'ref-1',
        workspaceRoot: '/tmp/workspace',
        maxBytes: 4096
      }
    }

    await expect(
      handlers.get('agentRuntime:auxiliary')?.({}, previewWorkspaceReferencePayload)
    ).rejects.toThrow(hostError)
    expect(agentRuntime.auxiliary).toHaveBeenCalledWith(previewWorkspaceReferencePayload)
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
      durationMs: 1000
    }

    await expect(handlers.get('speech:transcribe')?.({}, payload)).resolves.toEqual({
      ok: true,
      text: 'hello world'
    })
    expect(store.load).toHaveBeenCalled()
    expect(transcribeSpeech).toHaveBeenCalledWith(current, {
      audioBase64: payload.audioBase64,
      mimeType: 'audio/wav',
      durationMs: 1000
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

  it('uses the GUI-managed WeChat bridge for WeChat install handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const configuredSettings = settings()
    configuredSettings.connectPhone.weixinBridgeUrl = 'http://127.0.0.1:8787/rpc'
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

    expect(handlers.has('remoteChannel:im-install:qrcode')).toBe(false)
    expect(handlers.has('remoteChannel:im-install:poll')).toBe(false)
    await expect(
      handlers.get('connectPhone:install:qrcode')?.({}, { provider: 'weixin' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      handlers.get('connectPhone:install:poll')?.({}, { provider: 'weixin', deviceCode: 'device-1' })
    ).resolves.toEqual({ done: false })

    expect(startWeixinInstallQrcode).toHaveBeenCalledWith('http://127.0.0.1:8787/rpc')
    expect(pollWeixinInstall).toHaveBeenCalledWith('device-1', 'http://127.0.0.1:8787/rpc')
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

    expect(handlers.has('connectPhone:task:run')).toBe(false)
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

  it('routes remote-channel task creation through the Schedule runtime with channel workspace', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const configuredSettings = settings()
    configuredSettings.remoteChannel.channels = [{
      id: 'channel-1',
      provider: 'feishu',
      label: 'Team channel',
      enabled: true,
      model: 'deepseek-v4-pro',
      workspaceRoot: '/tmp/channel-workspace',
      agentProfile: {
        name: 'Team Agent',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }]
    configuredSettings.schedule.defaultWorkspaceRoot = '/tmp/schedule-default'
    const store = { load: vi.fn(async () => configuredSettings) }
    const scheduleRuntime = {
      createScheduledTaskFromText: vi.fn(async () => ({
        kind: 'created' as const,
        taskId: 'task-remote',
        title: 'Remote Reminder',
        scheduleAt: '2026-06-03T09:00:00.000+08:00',
        confirmationText: 'Scheduled from remote channel.'
      }))
    }

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      getScheduleRuntime: () => scheduleRuntime as never
    }))

    await expect(
      handlers.get('remoteChannel:task:create-from-text')?.({}, {
        text: 'Remind the team tomorrow.',
        channelId: 'channel-1',
        modelHint: 'deepseek-v4-pro',
        mode: 'agent'
      })
    ).resolves.toMatchObject({
      kind: 'created',
      taskId: 'task-remote'
    })
    expect(scheduleRuntime.createScheduledTaskFromText).toHaveBeenCalledWith('Remind the team tomorrow.', {
      workspaceRoot: '/tmp/channel-workspace',
      modelHint: 'deepseek-v4-pro',
      mode: 'agent'
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
