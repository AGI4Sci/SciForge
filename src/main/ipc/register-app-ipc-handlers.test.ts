import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
import { ControlledProcessService } from '../processes/controlled-process-service'
import { WorkspacePlacementRouter } from '../services/workspace-placement-router'
import { VisibleContextService } from '../services/visible-context-service'
import {
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextSnapshot
} from '../../shared/visible-context'

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
  const workspacePlacement = new WorkspacePlacementRouter({
    sessionManager: {
      portFor: () => {
        throw new Error('Remote Workspace Host is unavailable in this test.')
      }
    },
    localControlledProcesses: new ControlledProcessService()
  })
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
    workspacePlacement,
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

function visibleSnapshot(
  windowId: string,
  revision: number,
  activeThreadId: string,
  route: string
): VisibleContextSnapshot {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    windowId,
    revision,
    publishedAt: `2026-07-31T03:00:0${revision}.000Z`,
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
    activeThreadId,
    route,
    components: []
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
      registeredTargetRef: vi.fn(),
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
      registeredTargetRef: vi.fn(),
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

  it.each([
    {
      initiatingKind: 'browser' as const,
      initiatingWindowId: 'browser:1',
      competingWindowId: 'electron:1'
    },
    {
      initiatingKind: 'electron' as const,
      initiatingWindowId: 'electron:1',
      competingWindowId: 'browser:1'
    }
  ])(
    'binds a $initiatingKind startTurn to its sender surface despite a later $competingWindowId publish',
    async ({ initiatingKind, initiatingWindowId, competingWindowId }) => {
      const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
      const userDataDir = mkdtempSync(join(tmpdir(), 'sciforge-visible-context-ipc-'))
      try {
        const visibleContext = new VisibleContextService(userDataDir, {
          surfaceCaptureProvider: { capture: vi.fn() },
          now: () => new Date('2026-07-31T03:00:03.000Z')
        })
        await visibleContext.publish(visibleSnapshot(
          initiatingWindowId,
          1,
          'thread-a',
          `/${initiatingWindowId}/initial`
        ))
        await visibleContext.publish(visibleSnapshot(
          competingWindowId,
          1,
          'thread-a',
          `/${competingWindowId}/initial`
        ))
        let boundWindowId: string | undefined
        let boundRoute: string | undefined
        const startTurn = vi.fn(async (input: {
          runtimeId: 'codex'
          threadId: string
          visibleContextOwnerThreadId?: string
          visibleContextSurfaceId?: string
          visibleContextBindingId?: string
        }) => {
          await visibleContext.publish(visibleSnapshot(
            competingWindowId,
            2,
            'thread-a',
            `/${competingWindowId}/background`
          ))
          await visibleContext.publish(visibleSnapshot(
            initiatingWindowId,
            2,
            'thread-a',
            `/${initiatingWindowId}/after-submit`
          ))
          const bound = input.visibleContextBindingId
            ? visibleContext.claimSurfaceBinding(
                `${input.runtimeId}:${input.threadId}`,
                input.visibleContextBindingId
              )
            : null
          boundWindowId = bound?.windowId
          boundRoute = bound?.route
          return { threadId: input.threadId, turnId: 'turn-1' }
        })
        registerAppIpcHandlers(registerOptions({
          agentRuntime: { startTurn } as never,
          visibleContext
        }))
        const sender = createSender(1) as ReturnType<typeof createSender> & {
          capturePage?: ReturnType<typeof vi.fn>
        }
        if (initiatingKind === 'electron') sender.capturePage = vi.fn()

        await expect(handlers.get('agentRuntime:startTurn')?.({ sender }, {
          runtimeId: 'codex',
          threadId: 'thread-a',
          text: 'inspect the visible surface'
        })).resolves.toEqual({ threadId: 'thread-a', turnId: 'turn-1' })

        expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
          visibleContextSurfaceId: initiatingWindowId,
          visibleContextBindingId: expect.stringMatching(/^bound_surface_/u)
        }))
        expect(boundWindowId).toBe(initiatingWindowId)
        expect(boundRoute).toBe(`/${initiatingWindowId}/initial`)
        expect(visibleContext.peek()).toMatchObject({
          windowId: initiatingWindowId,
          route: `/${initiatingWindowId}/after-submit`
        })
      } finally {
        rmSync(userDataDir, { recursive: true, force: true })
      }
    }
  )

  it('issues registered target references through the native sender identity', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const registeredTargetRef = vi.fn(async () => 'target_ref')
    const visibleContext = {
      publish: vi.fn(),
      get: vi.fn(),
      registeredTargetRef,
      readCapturePreview: vi.fn()
    }
    registerAppIpcHandlers(registerOptions({ visibleContext }))
    const sender = { id: 42, capturePage: vi.fn() }

    await expect(handlers.get('visibleContext:target-ref')?.({ sender }, {
      componentId: 'chat.timeline',
      targetId: 'message-1'
    })).resolves.toEqual({ ok: true, targetRef: 'target_ref' })
    expect(registeredTargetRef).toHaveBeenCalledWith('electron:42', {
      componentId: 'chat.timeline',
      targetId: 'message-1'
    })
    await expect(handlers.get('visibleContext:target-ref')?.({ sender }, {
      componentId: '',
      targetId: 'message-1'
    })).rejects.toThrow(/Invalid payload for visibleContext:target-ref/)
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

  it('does not register domain-specific Paper Radar or Visual Review IPC channels', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions())

    expect([...handlers.keys()].filter((channel) => channel.startsWith('paperRadar:'))).toEqual([])
    expect([...handlers.keys()].filter((channel) => channel.startsWith('visual-document:'))).toEqual([])
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
      'workspacePreview:unwatch',
      'visual-document:status',
      'visual-document:open',
      'visual-document:insert-artifact',
      'visual-document:update-context',
      'visual-document:save-annotations',
      'visual-document:export-review-packet',
      'visual-document:create-candidate',
      'visual-document:accept-candidate',
      'visual-document:reject-candidate'
    ]

    for (const channel of retiredChannels) {
      expect(handlers.has(channel), channel).toBe(false)
    }
    expect(handlers.has('workspace:pick-file')).toBe(true)
    expect(handlers.has('biologyRoom:pick-file')).toBe(false)
  })

  it('uses one validated generic file picker for domain-declared filters', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const dispatcher = registerAppIpcHandlers(registerOptions())

    const result = await dispatcher.invoke('workspace:pick-file', {
      title: ' Select data asset ',
      defaultPath: ' /tmp/workspace ',
      filters: [
        { name: ' Data ', extensions: ['csv', 'tsv', 'nii.gz'] },
        { name: ' All files ', extensions: ['*'] }
      ]
    }, createSender(11))

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

  it('parents file pickers only to the Electron window that invoked them', async () => {
    const mainWindow = { isDestroyed: vi.fn(() => false) }
    const electronSender = {
      ...createSender(13),
      capturePage: vi.fn()
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const dispatcher = registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never
    }))
    const request = {
      title: 'Open image',
      defaultPath: '/tmp/workspace',
      filters: [{ name: 'Images', extensions: ['png'] }]
    }

    await dispatcher.invoke('workspace:pick-file', request, electronSender)
    expect(showOpenDialog).toHaveBeenLastCalledWith(mainWindow, {
      ...request,
      properties: ['openFile', 'dontAddToRecent']
    })

    await dispatcher.invoke('workspace:pick-file', request, createSender(14))
    expect(showOpenDialog).toHaveBeenLastCalledWith({
      ...request,
      properties: ['openFile', 'dontAddToRecent']
    })
  })

  it('rejects unconstrained generic file-picker payloads', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const dispatcher = registerAppIpcHandlers(registerOptions())

    await expect(dispatcher.invoke('workspace:pick-file', {
      title: 'Unsafe picker',
      filters: []
    }, createSender(12))).rejects.toThrow('Invalid payload for workspace:pick-file')
  })

  it('routes the generic extension lifecycle through injected functions', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const summary = {
      packageName: '@sciforge/domain-browser',
      moduleId: 'sciforge.browser',
      moduleDisplayName: 'Browser',
      version: '1.0.0',
      publisher: { id: 'sciforge', displayName: 'SciForge' },
      source: 'user' as const,
      verification: 'official-signed' as const,
      execution: 'sandboxed-runtime' as const,
      status: 'active' as const,
      permissions: ['network.outbound'],
      contributionKinds: ['command', 'right-panel'],
      contributionCount: 2,
      canRollback: false,
      installedAt: '2026-07-27T12:30:00.000Z'
    }
    const extensions = {
      list: vi.fn(async () => [summary]),
      install: vi.fn(async () => summary),
      uninstall: vi.fn(async () => undefined),
      rollback: vi.fn(async () => summary),
      setEnabled: vi.fn(async () => ({ ...summary, status: 'disabled' as const }))
    }
    const dispatcher = registerAppIpcHandlers(registerOptions({ extensions }))
    const sender = createSender(14)

    await expect(dispatcher.invoke('extensions:list', {}, sender)).resolves.toEqual([summary])
    await expect(dispatcher.invoke('extensions:install', {
      path: ' /tmp/browser.sciforge-extension '
    }, sender)).resolves.toEqual(summary)
    await expect(dispatcher.invoke('extensions:uninstall', {
      packageName: ' @sciforge/domain-browser '
    }, sender)).resolves.toBeUndefined()
    await expect(dispatcher.invoke('extensions:rollback', {
      packageName: '@sciforge/domain-browser'
    }, sender)).resolves.toEqual(summary)
    await expect(dispatcher.invoke('extensions:set-enabled', {
      packageName: '@sciforge/domain-browser',
      enabled: false
    }, sender)).resolves.toMatchObject({ status: 'disabled' })

    expect(extensions.install).toHaveBeenCalledWith({
      path: '/tmp/browser.sciforge-extension'
    })
    expect(extensions.uninstall).toHaveBeenCalledWith({
      packageName: '@sciforge/domain-browser'
    })
    expect(extensions.rollback).toHaveBeenCalledWith({
      packageName: '@sciforge/domain-browser'
    })
    expect(extensions.setEnabled).toHaveBeenCalledWith({
      packageName: '@sciforge/domain-browser',
      enabled: false
    })
  })

  it('rejects invalid extension inputs before dispatch and fails clearly without a manager', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const install = vi.fn()
    const dispatcher = registerAppIpcHandlers(registerOptions({
      extensions: {
        list: vi.fn(),
        install,
        uninstall: vi.fn(),
        rollback: vi.fn(),
        setEnabled: vi.fn()
      } as never
    }))
    const sender = createSender(15)

    await expect(dispatcher.invoke('extensions:install', {
      path: '',
      allowUnsigned: true
    }, sender)).rejects.toThrow('Invalid payload for extensions:install')
    expect(install).not.toHaveBeenCalled()

    const unavailable = registerAppIpcHandlers(registerOptions())
    await expect(unavailable.invoke('extensions:list', {}, sender))
      .rejects.toThrow('Extension management is not initialized.')
  })

  it('bounds extension manager errors and rejects unsafe result metadata', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const sender = createSender(16)
    const failing = registerAppIpcHandlers(registerOptions({
      extensions: {
        list: vi.fn(async () => {
          throw new Error('Official signature failed.\n\u0000 Retry with a signed package.')
        }),
        install: vi.fn(),
        uninstall: vi.fn(),
        rollback: vi.fn(),
        setEnabled: vi.fn()
      } as never
    }))

    await expect(failing.invoke('extensions:list', {}, sender)).rejects.toThrow(
      'Official signature failed. Retry with a signed package.'
    )

    const invalidResult = registerAppIpcHandlers(registerOptions({
      extensions: {
        list: vi.fn(async () => [{
          packageName: '@sciforge/domain-browser',
          secrets: { privateKey: 'not-renderer-safe' }
        }]),
        install: vi.fn(),
        uninstall: vi.fn(),
        rollback: vi.fn(),
        setEnabled: vi.fn()
      } as never
    }))
    await expect(invalidResult.invoke('extensions:list', {}, sender))
      .rejects.toThrow('Invalid payload for extensions:list result')
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
      handlers.get('agentRuntime:startTurn')?.({ sender }, {
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
      handlers.get('agentRuntime:steerTurn')?.({ sender }, {
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
      visibleContextSurfaceId: 'browser:12',
      visibleContextBindingAttempted: true,
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
      visibleContextSurfaceId: 'browser:12',
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

  it('exposes only attached Workspace Host session operations over trusted IPC', async () => {
    const snapshot = {
      activeWorkspaceHostId: 'session-1',
      workspaces: [],
      updatedAt: '2026-07-30T00:00:00.000Z'
    }
    const remoteWorkspace = {
      list: vi.fn(() => []),
      get: vi.fn(() => snapshot),
      attach: vi.fn(async () => snapshot),
      select: vi.fn(() => snapshot),
      reconnect: vi.fn(async () => snapshot),
      close: vi.fn(async () => snapshot),
      subscribe: vi.fn(() => () => undefined)
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({
      remoteWorkspace: remoteWorkspace as never
    }))

    await handlers.get('remoteWorkspace:list')?.({})
    await handlers.get('remoteWorkspace:get')?.({})
    await handlers.get('remoteWorkspace:attach')?.({}, {
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'authorized-session-1'
    })
    await handlers.get('remoteWorkspace:select')?.({}, { sessionId: 'session-1' })
    await handlers.get('remoteWorkspace:reconnect')?.({}, { sessionId: 'session-1' })
    await handlers.get('remoteWorkspace:close')?.({}, { sessionId: 'session-1' })

    expect(remoteWorkspace.attach).toHaveBeenCalledWith({
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'authorized-session-1'
    })
    expect(remoteWorkspace.select).toHaveBeenCalledWith({ sessionId: 'session-1' })
    await expect(handlers.get('remoteWorkspace:attach')?.({}, {
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'authorized-session-2',
      workspaceRoot: '/must/not-cross-this-boundary'
    })).rejects.toThrow(/Invalid payload/u)
  })
})
