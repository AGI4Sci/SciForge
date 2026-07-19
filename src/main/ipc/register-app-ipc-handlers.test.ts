import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureEvidenceDagUpdateQueue,
  evidenceDagQueueStatus
} from '../runtime/evidence-dag-feed'
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
const queueRoots: string[] = []
const { showSaveDialog } = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(async () => ({ isEmpty: () => false })),
    quit: vi.fn()
  },
  dialog: { showSaveDialog },
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
    evidenceDag: { enabled: true },
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
    getMainWindow: () => null,
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
    resolveRuntimeConfigPath: () => '/tmp/sciforge-runtime.json',
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

function stubEvidenceDagReady(status = 200) {
  const fetchMock = vi.fn(async (_input?: string | URL | Request, _init?: RequestInit) => new Response(
    JSON.stringify({ ok: status >= 200 && status < 300, data: { service: 'evidence-dag-engine' } }),
    { status }
  ))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubProjectDagReady(status = 200, compileData: Record<string, unknown> = {
  id: 'run-1',
  stats: {
    claims_added: 2,
    claims_merged: 1,
    claims_invalidated: 0,
    review_enqueued: 1
  },
  diff: { added: ['claim-1'] }
}, statusData?: Record<string, unknown>) {
  let committedVector: unknown[] = []
  let committedScope = { excludedSessions: [] as string[], isolatedSessions: [] as string[] }
  let autonomyMode = 'autonomous'
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const href = String(input)
    const method = init?.method ?? 'GET'
    if (href.startsWith('http://127.0.0.1:4897') && href.endsWith('/updates') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { threadId: string; targetWatermark: string }
      return new Response(JSON.stringify({ ok: true, data: { snapshot: {
        threadId: body.threadId,
        version: 1,
        digest: `sha256:${body.threadId}:${body.targetWatermark}`,
        inputWatermark: body.targetWatermark,
        schemaVersion: '2', extractorVersion: '2', verifierVersion: '2', artifactDigests: [],
        createdAt: '2026-07-10T00:00:00.000Z', status: 'committed'
      } } }), { status: 200 })
    }
    if (href.endsWith('/version')) {
      return new Response(
        JSON.stringify({
          ok: status >= 200 && status < 300,
          data: { service: 'project-dag-engine', version: '0.3.0' }
        }),
        { status }
      )
    }
    if (href.includes('/goals') && method === 'GET') {
      return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 })
    }
    if (href.endsWith('/goals') && method === 'POST') {
      return new Response(JSON.stringify({ ok: true, data: { id: 'goal-1', root_id: 'goal-1' } }), { status: 200 })
    }
    if (/\/goals\/[^/]+\/update$/.test(new URL(href).pathname) && method === 'POST') {
      return new Response(JSON.stringify({
        ok: true, data: { id: 'goal-version-2', root_id: 'goal-1', version: 2 }
      }), { status: 200 })
    }
    if (href.endsWith('/updates') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        evidenceVector?: unknown[]
        capturedScope?: { excludedSessions?: string[]; isolatedSessions?: string[] }
        autonomyMode?: string
      }
      committedVector = body.evidenceVector ?? []
      committedScope = {
        excludedSessions: body.capturedScope?.excludedSessions ?? [],
        isolatedSessions: body.capturedScope?.isolatedSessions ?? []
      }
      autonomyMode = body.autonomyMode ?? autonomyMode
      return new Response(JSON.stringify({
        ok: true, data: { id: String(compileData.id ?? 'project-job-1'), status: 'queued' }
      }), { status: 200 })
    }
    if (href.includes('/updates/status') && method === 'GET') {
      return new Response(JSON.stringify({ ok: true, data: statusData ?? {
        state: 'fresh', pending: 0,
        committedSnapshot: { digest: 'project-snapshot-1', evidenceVector: committedVector, ...committedScope },
        autonomy: { autonomy_mode: autonomyMode }
      } }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: false, error: { message: `unexpected ${method} ${href}` } }), {
      status: 404
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function projectDagAgentRuntime(projectThreadIds: string[] = ['thread-1']) {
  return {
    listThreads: vi.fn(async () => [
      ...projectThreadIds.map((id) => ({
        id,
        runtimeId: 'codex',
        title: `Project alpha ${id}`,
        updatedAt: '2026-07-09T00:00:00.000Z',
        workspace: '/tmp/project-alpha'
      })),
      {
        id: 'other-thread',
        runtimeId: 'codex',
        title: 'Other project thread',
        updatedAt: '2026-07-09T00:00:00.000Z',
        workspace: '/tmp/other-project'
      }
    ]),
    readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
      id: threadId,
      runtimeId: 'codex',
      title: 'Project alpha thread',
      updatedAt: '2026-07-09T00:00:00.000Z',
      latestSeq: 7,
      workspace: '/tmp/project-alpha',
      items: [{ id: `${threadId}:answer`, kind: 'assistant_message', text: 'Evidence.' }]
    }))
  } as never
}

function evidenceDagRiskDigest(highestSeverity: 'blocker' | 'major' | 'minor' | 'info' | 'none') {
  return {
    status: highestSeverity === 'none' ? 'clean' : 'risks_found',
    total_findings: highestSeverity === 'none' ? 0 : 1,
    counts_by_severity: {
      blocker: highestSeverity === 'blocker' ? 1 : 0,
      major: highestSeverity === 'major' ? 1 : 0,
      minor: highestSeverity === 'minor' ? 1 : 0,
      info: highestSeverity === 'info' ? 1 : 0
    },
    highest_severity: highestSeverity,
    recommendation: highestSeverity === 'major'
      ? 'revise_or_accept_risk_before_commit'
      : highestSeverity === 'blocker'
        ? 'block_commit_until_resolved'
        : highestSeverity === 'none'
          ? 'no_action_needed'
          : 'continue_with_attention'
  }
}

function stubEvidenceDagExportAudit(highestSeverity: 'blocker' | 'major' | 'minor' | 'info' | 'none') {
  vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
  vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    if (href.endsWith('/version')) {
      return new Response(JSON.stringify({
        ok: true,
        data: { service: 'evidence-dag-engine' }
      }), { status: 200 })
    }
    if (href.endsWith('/updates')) {
      const body = JSON.parse(String(init?.body)) as { threadId: string; targetWatermark: string }
      return new Response(JSON.stringify({
        ok: true,
        data: { snapshot: {
          threadId: body.threadId, version: 1, digest: 'sha256:export-evidence', inputWatermark: body.targetWatermark,
          schemaVersion: '2', extractorVersion: '2', verifierVersion: '2', artifactDigests: [],
          createdAt: '2026-07-10T00:00:00.000Z', status: 'committed'
        } }
      }), { status: 200 })
    }
    if (href.endsWith('/audits')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          id: 'audit:write-export',
          completed_at: new Date().toISOString(),
          risk_digest: evidenceDagRiskDigest(highestSeverity)
        }
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: false, error: { message: href } }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

function writeExportAgentRuntime() {
  return {
    listThreads: vi.fn(async () => [{
      id: 'thread-1', runtimeId: 'codex', title: 'Report', updatedAt: '2026-07-07T01:00:00.000Z', workspace: '/tmp/workspace'
    }]),
    readThread: vi.fn(async () => ({
      id: 'thread-1',
      runtimeId: 'codex',
      title: 'Report',
      updatedAt: '2026-07-07T01:00:00.000Z',
      latestSeq: 2,
      items: [
        { id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'Draft the report.' },
        { id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'Report content.' }
      ]
    }))
  }
}

function createPaperRadarServiceMock() {
  return {
    status: vi.fn(async () => ({ ok: true, service: 'sciforge.paper-radar', stats: { papers: 0, arxiv: 0, biorxiv: 0 } })),
    syncArxiv: vi.fn(async () => ({ ok: true, data: { source: 'arxiv', fetched: 0, upserted: 0, skipped: 0 } })),
    syncBiorxiv: vi.fn(async () => ({ ok: true, data: { source: 'biorxiv', fetched: 0, upserted: 0, skipped: 0 } })),
    syncProfile: vi.fn(async () => ({ ok: true, data: { profile: 'lab_default', results: [] } })),
    listProfiles: vi.fn(async () => ({ ok: true, data: { profiles: [] } })),
    saveProfile: vi.fn(async () => ({ ok: true, data: { profile: { name: 'lab_default', keywords: [], excludeKeywords: [], arxivCategories: [], biorxivSubjects: [] } } })),
    review: vi.fn(async () => ({ ok: true, data: { profile: 'lab_default', generatedAt: '2026-06-21T00:00:00.000Z', count: 0, papers: [], syncResults: [] } })),
    search: vi.fn(async () => ({ ok: true, data: { papers: [], count: 0 } })),
    rank: vi.fn(async () => ({ ok: true, data: { profile: 'lab_default', count: 0, papers: [] } })),
    digest: vi.fn(async () => ({ ok: true, data: { profile: 'lab_default', generatedAt: '2026-06-21T00:00:00.000Z', count: 0, papers: [] } })),
    close: vi.fn()
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
    const root = mkdtempSync(join(tmpdir(), 'sciforge-ipc-dag-queue-'))
    queueRoots.push(root)
    configureEvidenceDagUpdateQueue({ storagePath: join(root, 'queue.json') })
  })

  afterEach(() => {
    for (const root of queueRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('registers only canonical remote channel mirror IPC', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const removedFeishuMirrorChannel = `remoteChannel:message:mirror-to-${'feishu'}`

    registerAppIpcHandlers(registerOptions())

    expect(handlers.get('remoteChannel:message:mirror')).toBeTypeOf('function')
    expect(handlers.has(removedFeishuMirrorChannel)).toBe(false)
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

  it('returns a paused Evidence view and rejects updates when Evidence DAG is disabled', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const disabled = { ...settings(), evidenceDag: { enabled: false } }
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => disabled) } as never
    }))

    await expect(handlers.get('evidenceDag:view')?.({}, {
      runtimeId: 'codex', threadId: 'thread-1'
    })).resolves.toMatchObject({
      url: '',
      status: {
        freshness: 'paused',
        pendingCount: 0,
        lastError: 'Evidence DAG is disabled in Settings.'
      }
    })
    await expect(handlers.get('evidenceDag:update')?.({}, {
      runtimeId: 'codex', threadId: 'thread-1'
    })).rejects.toThrow('Evidence DAG is disabled in Settings.')
    await expect(handlers.get('projectDag:view')?.({}, {
      workspaceRoot: '/tmp/project'
    })).rejects.toThrow('Evidence DAG is disabled in Settings.')
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

  it('validates Paper Radar payloads before resolving the worker service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const paperRadar = createPaperRadarServiceMock()
    const getPaperRadarService = vi.fn(() => paperRadar as never)

    registerAppIpcHandlers(registerOptions({ getPaperRadarService }))

    const handler = handlers.get('paperRadar:search')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, { topK: 1_000 })).rejects.toThrow(/Invalid payload for paperRadar:search/)
    expect(getPaperRadarService).not.toHaveBeenCalled()
    expect(paperRadar.search).not.toHaveBeenCalled()
  })

  it('routes valid Paper Radar IPC requests through the worker service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const paperRadar = createPaperRadarServiceMock()
    const getPaperRadarService = vi.fn(() => paperRadar as never)

    registerAppIpcHandlers(registerOptions({ getPaperRadarService }))

    const handler = handlers.get('paperRadar:search')
    const result = await handler?.({}, { query: '  protein design  ', topK: 5 })

    expect(getPaperRadarService).toHaveBeenCalledTimes(1)
    expect(paperRadar.search).toHaveBeenCalledWith({ query: 'protein design', topK: 5 })
    expect(result).toEqual({ ok: true, data: { papers: [], count: 0 } })
  })

  it('routes Paper Radar review through the high-level worker command', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const paperRadar = createPaperRadarServiceMock()
    const getPaperRadarService = vi.fn(() => paperRadar as never)

    registerAppIpcHandlers(registerOptions({ getPaperRadarService }))

    const input = {
      profile: {
        name: ' protein_focus ',
        keywords: ['protein design'],
        excludeKeywords: ['review'],
        arxivCategories: ['q-bio'],
        biorxivSubjects: ['bioinformatics']
      },
      days: 7,
      topK: 12,
      maxRecords: 200
    }
    const handler = handlers.get('paperRadar:review')
    const result = await handler?.({}, input)

    expect(getPaperRadarService).toHaveBeenCalledTimes(1)
    expect(paperRadar.review).toHaveBeenCalledWith({
      profile: {
        name: 'protein_focus',
        keywords: ['protein design'],
        excludeKeywords: ['review'],
        arxivCategories: ['q-bio'],
        biorxivSubjects: ['bioinformatics']
      },
      days: 7,
      topK: 12,
      maxRecords: 200
    })
    expect(result).toEqual({
      ok: true,
      data: {
        profile: 'lab_default',
        generatedAt: '2026-06-21T00:00:00.000Z',
        count: 0,
        papers: [],
        syncResults: []
      }
    })
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

  it('returns an Evidence DAG view URL with a runtime-scoped thread id', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const fetchMock = stubEvidenceDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    const handler = handlers.get('evidenceDag:view')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, { runtimeId: 'codex', threadId: 'thread-1' })).resolves.toMatchObject({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1&preview=trusted#token=test-token',
      status: { freshness: 'fresh', pendingCount: 0 }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4897/updates/status?threadId=codex%3Athread-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers)
      })
    )
  })

  it('returns the global Evidence DAG view without an active thread', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    stubEvidenceDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    await expect(handlers.get('evidenceDag:view')?.({}, {})).resolves.toMatchObject({
      url: 'http://127.0.0.1:4897/#token=test-token',
      status: { freshness: 'fresh', pendingCount: 0 }
    })
  })

  it('resolves Evidence DAG preview metadata only through the pinned snapshot endpoint', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const workspace = mkdtempSync(join(tmpdir(), 'evidence-dag-ipc-preview-'))
    queueRoots.push(workspace)
    writeFileSync(join(workspace, 'source.txt'), 'source bytes')
    const digest = `sha256:${'a'.repeat(64)}`
    const snapshotDigest = `sha256:${'b'.repeat(64)}`
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store' })
      expect(init?.headers).toBeInstanceOf(Headers)
      expect(url.pathname).toBe('/threads/codex%3Athread-1/evidence-preview')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        snapshotDigest,
        sourceAssertionId: 'source_assertion:one',
        artifactVersionId: 'artifact-version:one',
        sourceAnchorId: 'anchor:one'
      })
      return new Response(JSON.stringify({
        ok: true,
        data: {
          resolved: true,
          threadId: 'codex:thread-1',
          snapshotDigest,
          workspaceRoot: workspace,
          accessPolicy: {},
          sourceAssertion: {
            id: 'source_assertion:one', type: 'source_assertion', artifact_id: 'artifact:one',
            artifact_version_id: 'artifact-version:one', source_anchor_id: 'anchor:one'
          },
          artifact: { artifactId: 'artifact:one', accessPolicy: {} },
          artifactVersion: {
            versionId: 'artifact-version:one', artifactId: 'artifact:one', locator: 'source.txt',
            contentDigest: digest, availability: 'available', mediaType: 'text/plain'
          },
          sourceAnchor: {
            anchorId: 'anchor:one', artifactId: 'artifact:one',
            artifactVersionId: 'artifact-version:one',
            selector: { type: 'text', lineRange: '1:1' },
            anchorDigest: digest, accessPolicy: {}
          }
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const agentRuntime = {
      readThread: vi.fn(async () => ({
        id: 'thread-1', runtimeId: 'codex', title: 'Evidence',
        updatedAt: '2026-07-11T00:00:00.000Z', latestSeq: 1, workspace
      }))
    }
    const ensureEvidenceDagReady = vi.fn(async () => undefined)
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({
      agentRuntime: agentRuntime as never,
      ensureEvidenceDagReady
    }))

    await expect(handlers.get('evidenceDag:resolve-evidence-preview')?.({}, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest,
      sourceAssertionId: 'source_assertion:one',
      artifactVersionId: 'artifact-version:one',
      sourceAnchorId: 'anchor:one'
    })).resolves.toMatchObject({
      ok: true,
      path: realpathSync(join(workspace, 'source.txt')),
      workspaceRoot: workspace,
      selector: { type: 'text', lineRange: '1:1' },
      contentDigest: digest
    })
    expect(agentRuntime.readThread).toHaveBeenCalledWith({
      runtimeId: 'codex', threadId: 'thread-1'
    })
    expect(ensureEvidenceDagReady).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects Evidence DAG view when the service is not configured', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    await expect(
      handlers.get('evidenceDag:view')?.({}, { runtimeId: 'codex', threadId: 'thread-1' })
    ).rejects.toThrow(/Evidence DAG is not ready/)
  })

  it('rejects Evidence DAG view when the service health check fails', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    stubEvidenceDagReady(503)
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    await expect(
      handlers.get('evidenceDag:view')?.({}, { runtimeId: 'codex', threadId: 'thread-1' })
    ).rejects.toThrow(/Evidence DAG returned HTTP 503/)
  })

  it('returns an embedded Project DAG view URL without opening an external browser', async () => {
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const ensureProjectDagReady = vi.fn(async () => undefined)
    const { shell } = await import('electron')
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({
      ensureProjectDagReady,
      agentRuntime: projectDagAgentRuntime()
    }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      url: 'http://127.0.0.1:3898/?view=graph&embed=1&workspaceRoot=%2Ftmp%2Fproject-alpha&session=codex%3Athread-1#token=project-token',
      status: { freshness: 'fresh', pendingCount: 0 }
    })
    expect(ensureProjectDagReady).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3898/version',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer project-token' }
      })
    )
  })

  it('surfaces a failed Evidence dependency in the Project panel status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-project-dependency-'))
    queueRoots.push(root)
    const dependencyError = new Error('Evidence extractor unavailable')
    const queue = configureEvidenceDagUpdateQueue({
      storagePath: join(root, 'queue.json'),
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:4897',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'evidence-token'
      },
      fetchImpl: vi.fn(async () => { throw dependencyError }),
      maxAttempts: 1
    })
    await queue.enqueue({
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '7',
      reason: 'turn_committed',
      items: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }],
      projectContext: {
        projectKey: '/tmp/project-alpha',
        workspaceRoot: '/tmp/project-alpha',
        projectRoot: '/tmp/project-alpha'
      }
    })
    await vi.waitFor(async () => {
      expect((await queue.status('codex', 'thread-1')).state).toBe('failed')
    })

    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      status: {
        freshness: 'failed',
        pendingCount: 0,
        lastError: 'Evidence extractor unavailable',
        progress: { stage: 'failed', attempt: 1 }
      }
    })
  })

  it('keeps a scheduled Evidence dependency retry distinct from terminal failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-project-dependency-retry-'))
    queueRoots.push(root)
    const dependencyError = new Error('Evidence extractor temporarily unavailable')
    const queue = configureEvidenceDagUpdateQueue({
      storagePath: join(root, 'queue.json'),
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:4897',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'evidence-token'
      },
      fetchImpl: vi.fn(async () => { throw dependencyError }),
      maxAttempts: 2,
      retryBaseMs: 60_000
    })
    await queue.enqueue({
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '7',
      reason: 'turn_committed',
      items: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }],
      projectContext: {
        projectKey: '/tmp/project-alpha',
        workspaceRoot: '/tmp/project-alpha',
        projectRoot: '/tmp/project-alpha'
      }
    })
    await vi.waitFor(async () => {
      const status = await queue.status('codex', 'thread-1')
      expect(status.state).toBe('failed')
      expect(status.nextAttemptAt).toBeTruthy()
    })

    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      status: {
        freshness: 'queued',
        pendingCount: 1,
        lastError: 'Evidence extractor temporarily unavailable',
        nextAttemptAt: expect.any(String),
        progress: { stage: 'retry_scheduled', attempt: 1 }
      }
    })
  })

  it('maps Project compiler retry deadlines without treating terminal failures as active', async () => {
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    stubProjectDagReady(200, {}, {
      state: 'update_failed',
      pending: 0,
      jobs: [{
        id: 'project-job-1',
        status: 'retry_scheduled',
        attempts: 2,
        last_error: 'Compiler temporarily unavailable',
        next_attempt_at: '2026-07-18T12:00:00.000Z',
        updated_at: '2026-07-18T11:59:00.000Z'
      }]
    })
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      status: {
        freshness: 'queued',
        pendingCount: 1,
        lastError: 'Compiler temporarily unavailable',
        nextAttemptAt: '2026-07-18T12:00:00.000Z',
        progress: { stage: 'retry_scheduled', attempt: 2 }
      }
    })
  })

  it('maps a Project compiler failure without a retry deadline to terminal failure', async () => {
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    stubProjectDagReady(200, {}, {
      state: 'update_failed',
      pending: 0,
      jobs: [{
        id: 'project-job-1',
        status: 'failed',
        attempts: 3,
        last_error: 'Compiler rejected the snapshot',
        next_attempt_at: null,
        updated_at: '2026-07-18T11:59:00.000Z'
      }]
    })
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      status: {
        freshness: 'failed',
        pendingCount: 0,
        lastError: 'Compiler rejected the snapshot',
        progress: { stage: 'failed', attempt: 3 }
      }
    })
  })

  it('keeps the committed Project scope when currently listed runtime sessions differ', async () => {
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const originalFetch = fetchMock.getMockImplementation()!
    await originalFetch('http://127.0.0.1:3898/updates', {
      method: 'POST',
      body: JSON.stringify({
        evidenceVector: [
          { threadId: 'codex:committed-thread', digest: 'sha256:committed' },
          { threadId: 'sciforge:retired-thread', digest: 'sha256:retired' }
        ],
        capturedScope: { excludedSessions: [], isolatedSessions: [] }
      })
    })
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({
      agentRuntime: projectDagAgentRuntime(['unrelated-current-thread'])
    }))

    await expect(handlers.get('projectDag:view')?.({}, {
      view: 'graph',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      url: 'http://127.0.0.1:3898/?view=graph&embed=1&workspaceRoot=%2Ftmp%2Fproject-alpha&session=codex%3Acommitted-thread&session=sciforge%3Aretired-thread#token=project-token',
      status: {
        freshness: 'fresh',
        pendingCount: 0,
        scope: {
          includedSessions: ['codex:committed-thread', 'sciforge:retired-thread']
        }
      }
    })
  })

  it('returns after durable enqueue while Session Evidence and Project coordination continue', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'evidence-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const { shell } = await import('electron')
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: 'all',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      url: 'http://127.0.0.1:3898/?view=graph&embed=1&workspaceRoot=%2Ftmp%2Fproject-alpha&session=codex%3Athread-1#token=project-token',
      status: {
        freshness: 'queued',
        pendingCount: 1,
        progress: { stage: 'evidence', completedItems: 0, totalItems: 1 }
      }
    })
    await vi.waitFor(async () => {
      expect((await evidenceDagQueueStatus('codex', 'thread-1')).state).toBe('fresh')
    })
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4897/updates',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3898/updates',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('normalizes a projectRoot-only update into the complete Evidence project identity', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'evidence-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: 'all',
      projectRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({
      status: {
        freshness: 'queued',
        scope: { includedSessions: ['codex:thread-1'] }
      }
    })
    await vi.waitFor(async () => {
      expect((await evidenceDagQueueStatus('codex', 'thread-1')).state).toBe('fresh')
    })
    const evidenceCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === 'http://127.0.0.1:4897/updates' && init?.method === 'POST')
    expect(JSON.parse(String(evidenceCall?.[1]?.body))).toMatchObject({
      projectKey: '/tmp/project-alpha',
      workspaceRoot: '/tmp/project-alpha',
      projectRoot: '/tmp/project-alpha'
    })
  })

  it('rejects an unbounded Project update before it can capture every runtime session', async () => {
    const ensureProjectDagReady = vi.fn(async () => undefined)
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({
      agentRuntime: projectDagAgentRuntime(),
      ensureProjectDagReady
    }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: 'all',
      project: 'project-alpha'
    })).rejects.toThrow(/requires workspaceRoot\/projectRoot unless an explicit session scope/)
    expect(ensureProjectDagReady).not.toHaveBeenCalled()
  })

  it('rejects stale explicit sessions without a workspace root before durable Evidence enqueue', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'evidence-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: projectDagAgentRuntime() }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: ['codex:thread-1'],
      project: 'project-alpha'
    })).rejects.toThrow(/requires workspaceRoot\/projectRoot to refresh stale Evidence sessions/)
    await expect(evidenceDagQueueStatus('codex', 'thread-1')).resolves.toMatchObject({
      state: 'fresh',
      pendingCount: 0
    })
  })

  it('reuses unchanged committed Evidence snapshots without rereading full Session histories', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'evidence-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const originalFetch = fetchMock.getMockImplementation()!
    await originalFetch('http://127.0.0.1:3898/updates', {
      method: 'POST',
      body: JSON.stringify({
        evidenceVector: [
          { threadId: 'codex:thread-1', digest: 'sha256:fresh:codex:thread-1' },
          { threadId: 'sciforge:retired-thread', digest: 'sha256:fresh:sciforge:retired-thread' }
        ],
        capturedScope: { excludedSessions: [], isolatedSessions: [] }
      })
    })
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const href = String(input)
      if (href.startsWith('http://127.0.0.1:4897/updates/status')) {
        const threadId = new URL(href).searchParams.get('threadId') ?? ''
        return new Response(JSON.stringify({ ok: true, data: {
          state: 'fresh', pending: 0, snapshot: {
            threadId,
            version: 4,
            digest: `sha256:fresh:${threadId}`,
            inputWatermark: '7',
            schemaVersion: '2', extractorVersion: '2', verifierVersion: '2',
            artifactDigests: [],
            createdAt: '2026-07-10T00:00:00.000Z',
            status: 'committed'
          }
        } }), { status: 200 })
      }
      return originalFetch(input, init)
    })
    const agentRuntime = projectDagAgentRuntime() as unknown as {
      readThread: ReturnType<typeof vi.fn>
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: 'all',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({ status: { freshness: 'fresh' } })

    expect(agentRuntime.readThread).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:4897/updates',
      expect.objectContaining({ method: 'POST' })
    )
    const projectCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === 'http://127.0.0.1:3898/updates' && init?.method === 'POST')
    const projectBody = JSON.parse(String(projectCall?.[1]?.body))
    expect(projectBody).toMatchObject({
      priority: 3,
      evidenceVector: [
        { threadId: 'codex:thread-1', digest: 'sha256:fresh:codex:thread-1' },
        { threadId: 'sciforge:retired-thread', digest: 'sha256:fresh:sciforge:retired-thread' }
      ],
      capturedScope: { includedSessions: ['codex:thread-1', 'sciforge:retired-thread'] }
    })
    expect(projectBody).not.toHaveProperty('evidenceSnapshots')
  })

  it('applies excluded and isolated sessions through the same Project update command', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'evidence-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({
      agentRuntime: projectDagAgentRuntime(['thread-1', 'thread-2', 'thread-3'])
    }))

    await expect(handlers.get('projectDag:update')?.({}, {
      scope: 'all',
      workspaceRoot: '/tmp/project-alpha',
      excludedSessions: ['codex:thread-2'],
      isolatedSessions: ['codex:thread-3'],
      autonomyMode: 'checkpointed'
    })).resolves.toMatchObject({
      status: {
        freshness: 'queued',
        autonomyMode: 'checkpointed',
        scope: {
          includedSessions: ['codex:thread-1'],
          excludedSessions: ['codex:thread-2'],
          isolatedSessions: ['codex:thread-3']
        }
      }
    })
    await vi.waitFor(async () => {
      expect((await evidenceDagQueueStatus('codex', 'thread-1')).state).toBe('fresh')
    })
    const projectCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === 'http://127.0.0.1:3898/updates' && init?.method === 'POST')
    expect(JSON.parse(String(projectCall?.[1]?.body))).toMatchObject({
      reason: 'manual_immediate',
      autonomyMode: 'checkpointed',
      evidenceVector: [{ threadId: 'codex:thread-1', digest: 'sha256:codex:thread-1:7' }],
      capturedScope: {
        includedSessions: ['codex:thread-1'],
        excludedSessions: ['codex:thread-2'],
        isolatedSessions: ['codex:thread-3']
      }
    })
  })

  it('saves new and existing Goals with an explicit human actor contract', async () => {
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = stubProjectDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    registerAppIpcHandlers(registerOptions())
    const handler = handlers.get('projectDag:save-goal')

    await expect(handler?.({}, {
      title: 'Project alpha', description: 'Initial intent', workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({ goalId: 'goal-1' })
    await expect(handler?.({}, {
      rootGoalId: 'goal-1', title: 'Project alpha revised', description: 'Visible revision',
      workspaceRoot: '/tmp/project-alpha'
    })).resolves.toMatchObject({ goalId: 'goal-1', version: 2 })

    const goalCalls = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).includes('/goals') && init?.method === 'POST')
    expect(goalCalls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      {
        title: 'Project alpha', description: 'Initial intent', actorType: 'human',
        actorId: 'sciforge-desktop:user', projectKey: '/tmp/project-alpha'
      },
      {
        title: 'Project alpha revised', description: 'Visible revision', actorType: 'human',
        actorId: 'sciforge-desktop:user', reframe: false, projectKey: '/tmp/project-alpha'
      }
    ])
  })

  it('does not register the removed direct Project compile IPC path', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())
    expect(handlers.has('projectDag:compile')).toBe(false)
    expect(handlers.get('projectDag:update')).toBeTypeOf('function')
  })

  it('keeps Evidence DAG view read-only without backfilling the active thread', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const fetchMock = stubEvidenceDagReady()
    const agentRuntime = {
      readThread: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'Thread',
        updatedAt: '2026-06-26T00:00:00.000Z',
        latestSeq: 1,
        items: [
          { id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'question' },
          { id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
        ]
      }))
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('evidenceDag:view')?.({}, { runtimeId: 'codex', threadId: 'thread-1' })
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1&preview=trusted#token=test-token',
      status: { freshness: 'fresh', pendingCount: 0 }
    })

    expect(agentRuntime.readThread).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:4897/updates',
      expect.anything()
    )
  })

  it('updates the active thread Evidence DAG on demand', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_SERVICE_URL', 'http://127.0.0.1:3898/')
    vi.stubEnv('SCIFORGE_PROJECT_DAG_API_KEY', 'project-token')
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href === 'http://127.0.0.1:4897/version') {
        return new Response(JSON.stringify({
          ok: true,
          data: { service: 'evidence-dag-engine' }
        }), { status: 200 })
      }
      if (href === 'http://127.0.0.1:4897/updates') {
        const body = JSON.parse(String(init?.body)) as { threadId: string; targetWatermark: string }
        return new Response(JSON.stringify({
          ok: true,
          data: { snapshot: {
            threadId: body.threadId, version: 1, digest: 'sha256:evidence-1', inputWatermark: body.targetWatermark,
            schemaVersion: '2', extractorVersion: '2', verifierVersion: '2', artifactDigests: [],
            createdAt: '2026-07-10T00:00:00.000Z', status: 'committed'
          } }
        }), { status: 200 })
      }
      if (href === 'http://127.0.0.1:3898/updates') {
        return new Response(JSON.stringify({ ok: true, data: { id: 'project-job-1', status: 'queued' } }), {
          status: 200
        })
      }
      if (href.startsWith('http://127.0.0.1:3898/updates/status')) {
        return new Response(JSON.stringify({ ok: true, data: {
          state: 'fresh',
          pending: 0,
          committedSnapshot: {
            evidenceVector: [{ threadId: 'codex:thread-1', digest: 'sha256:evidence-1' }]
          }
        } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: { message: href } }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const agentRuntime = {
      listThreads: vi.fn(async () => [{
        id: 'thread-1', runtimeId: 'codex', title: 'Thread',
        updatedAt: '2026-06-26T00:00:00.000Z', workspace: '/tmp/project-alpha'
      }, {
        id: 'thread-2', runtimeId: 'codex', title: 'Uncompiled sibling',
        updatedAt: '2026-06-26T00:00:00.000Z', workspace: '/tmp/project-alpha'
      }]),
      readThread: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'Thread',
        updatedAt: '2026-06-26T00:00:00.000Z',
        latestSeq: 1,
        items: [
          { id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'question' },
          { id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
        ]
      }))
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('evidenceDag:update')?.({}, { runtimeId: 'codex', threadId: 'thread-1' })
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1&preview=trusted#token=test-token',
      itemCount: 2,
      status: { freshness: 'queued', pendingCount: 1 }
    })
    expect(agentRuntime.readThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    await vi.waitFor(async () => {
      await expect(evidenceDagQueueStatus('codex', 'thread-1')).resolves.toMatchObject({ state: 'fresh' })
    })
    const evidenceCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === 'http://127.0.0.1:4897/updates' && init?.method === 'POST')
    expect(JSON.parse(String(evidenceCall?.[1]?.body))).toMatchObject({
      threadId: 'codex:thread-1',
      targetWatermark: '1',
      reason: 'manual_immediate',
      priority: 'immediate',
      projectKey: '/tmp/project-alpha',
      workspaceRoot: '/tmp/project-alpha',
      projectRoot: '/tmp/project-alpha',
      trace: [
        { id: 'u1', type: 'message', role: 'user', content: 'question' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'answer' }
      ]
    })
  })

  it('rejects write export when Evidence DAG audit has blocker findings', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    stubEvidenceDagExportAudit('blocker')
    const agentRuntime = writeExportAgentRuntime()

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload())
    ).rejects.toThrow(/blocker risks/)
    expect(writeExportServiceMock.exportWriteDocument).not.toHaveBeenCalled()
  })

  it('rejects write export when Evidence DAG audit has major findings without confirmation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    stubEvidenceDagExportAudit('major')
    const agentRuntime = writeExportAgentRuntime()

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload())
    ).rejects.toThrow(/evidenceDagGateOverride/)
    expect(writeExportServiceMock.exportWriteDocument).not.toHaveBeenCalled()
  })

  it('treats unavailable Evidence DAG audit as missing audit for write export', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const agentRuntime = writeExportAgentRuntime()

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload())
    ).rejects.toThrow(/audit is missing/)
    expect(writeExportServiceMock.exportWriteDocument).not.toHaveBeenCalled()

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload({ evidenceDagGateOverride: true }))
    ).resolves.toMatchObject({
      ok: true,
      evidenceDagGate: {
        auditState: 'missing',
        requiresOverride: true,
        overrideConfirmed: true,
        advisory: true
      }
    })
    expect(writeExportServiceMock.exportWriteDocument).toHaveBeenCalledTimes(1)
  })

  it('allows write export when Evidence DAG audit has major findings with confirmation', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    stubEvidenceDagExportAudit('major')
    const agentRuntime = writeExportAgentRuntime()

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('write:export')?.({}, writeExportPayload({ evidenceDagGateOverride: true }))
    ).resolves.toMatchObject({
      ok: true,
      evidenceDagGate: {
        policy: 'evidence-dag-high-impact-gate',
        auditState: 'fresh',
        highestSeverity: 'major',
        requiresOverride: true,
        overrideConfirmed: true,
        advisory: true,
        runtimeId: 'codex',
        threadId: 'thread-1'
      }
    })
    expect(writeExportServiceMock.exportWriteDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/tmp/workspace/report.md',
        format: 'html',
        content: '# Report'
      }),
      { parentWindow: null }
    )
    expect(writeExportServiceMock.exportWriteDocument).not.toHaveBeenCalledWith(
      expect.objectContaining({ evidenceDagGateOverride: true }),
      expect.anything()
    )
  })

  it.each(['minor', 'none'] as const)(
    'allows write export when Evidence DAG audit highest severity is %s',
    async (highestSeverity) => {
      const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
      stubEvidenceDagExportAudit(highestSeverity)
      const agentRuntime = writeExportAgentRuntime()

      registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

      await expect(
        handlers.get('write:export')?.({}, writeExportPayload())
      ).resolves.toMatchObject({
        ok: true,
        evidenceDagGate: {
          auditState: 'fresh',
          highestSeverity,
          requiresOverride: false,
          overrideConfirmed: false,
          advisory: highestSeverity !== 'none'
        }
      })
      expect(writeExportServiceMock.exportWriteDocument).toHaveBeenCalled()
    }
  )

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
          tool: 'visual_artifact_review',
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

  it('returns a native file drag fallback when the sender cannot start desktop drags', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-native-drag-ipc-'))
    const filePath = join(workspaceRoot, 'notes.txt')
    writeFileSync(filePath, 'notes')
    try {
      const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
      const dispatcher = registerAppIpcHandlers(registerOptions())

      const result = await dispatcher.invoke(
        'file:start-workspace-native-drag',
        { path: 'notes.txt', workspaceRoot },
        createSender(903)
      )

      expect(result).toEqual({
        ok: false,
        message: 'Native file dragging is not available in this environment.'
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('starts native file drags with a resolved workspace path', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-native-drag-ipc-'))
    const filePath = join(workspaceRoot, 'notes.txt')
    writeFileSync(filePath, 'notes')
    try {
      const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
      const sender = {
        ...createSender(904),
        startDrag: vi.fn()
      }

      const dispatcher = registerAppIpcHandlers(registerOptions())
      const result = await dispatcher.invoke(
        'file:start-workspace-native-drag',
        { path: 'notes.txt', workspaceRoot },
        sender
      )

      expect(result).toMatchObject({
        ok: true,
        path: realpathSync(filePath)
      })
      expect(sender.startDrag).toHaveBeenCalledWith(expect.objectContaining({
        file: realpathSync(filePath),
        icon: expect.anything()
      }))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
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
    expect(handlers.has('biologyRoom:pick-file')).toBe(true)
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

  it('writes MCP config JSON and notifies the runtime apply hook', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'sciforge-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onRuntimeMcpConfigWritten = vi.fn(async () => undefined)
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
        resolveRuntimeConfigPath: () => configPath,
        onRuntimeMcpConfigWritten
      }))

      await expect(handlers.get('runtimeConfig:write')?.({}, content)).resolves.toEqual({
        ok: true,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(onRuntimeMcpConfigWritten).toHaveBeenCalledWith(configPath, content)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid MCP config JSON before writing or applying it', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'sciforge-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onRuntimeMcpConfigWritten = vi.fn(async () => undefined)

    try {
      registerAppIpcHandlers(registerOptions({
        resolveRuntimeConfigPath: () => configPath,
        onRuntimeMcpConfigWritten
      }))

      await expect(handlers.get('runtimeConfig:write')?.({}, '{')).rejects.toThrow(
        /MCP config must be JSON/
      )
      await expect(handlers.get('runtimeConfig:write')?.({}, '[]')).rejects.toThrow(
        /MCP config must be a JSON object/
      )
      expect(existsSync(configPath)).toBe(false)
      expect(onRuntimeMcpConfigWritten).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
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

  it('returns Evidence DAG view with a runtime-scoped thread id from the main process environment', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'main-process-token')
    stubEvidenceDagReady()

    registerAppIpcHandlers(registerOptions())

    await expect(
      handlers.get('evidenceDag:view')?.({}, {
        runtimeId: 'claude',
        threadId: ' thread-1 '
      })
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=claude%3Athread-1&preview=trusted#token=main-process-token',
      status: { freshness: 'fresh', pendingCount: 0 }
    })
  })
})
