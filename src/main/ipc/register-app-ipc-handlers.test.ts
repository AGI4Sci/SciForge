import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  dialog: {},
  shell: {
    openExternal: vi.fn(async () => undefined)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

const { pdfAnnotationSidecarFixture } = vi.hoisted(() => ({
  pdfAnnotationSidecarFixture: {
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
}))

vi.mock('../services/pdf-annotation-sidecar-service', () => ({
  loadPdfAnnotationSidecar: vi.fn(async () => ({
    ok: true,
    sidecar: pdfAnnotationSidecarFixture,
    path: '/tmp/workspace/.sciforge/pdf-annotations/sha256.json',
    source: 'empty',
    pdfFingerprint: { sha256: 'sha256', size: 1 },
    warnings: []
  })),
  savePdfAnnotationSidecar: vi.fn(async () => ({
    ok: true,
    sidecar: { ...pdfAnnotationSidecarFixture, version: 1 },
    path: '/tmp/workspace/.sciforge/pdf-annotations/sha256.json',
    savedAt: '2026-06-22T00:01:00.000Z'
  })),
  exportPdfAnnotationSidecarPackage: vi.fn(async () => ({
    ok: true,
    path: '/tmp/workspace/paper.dsgui-pdf.zip',
    manifest: pdfAnnotationSidecarFixture.manifest,
    exportedAt: '2026-06-22T00:02:00.000Z'
  })),
  exportPdfAnnotationAdobePdf: vi.fn(async () => ({
    ok: true,
    path: '/tmp/workspace/paper.annotated.pdf',
    annotationCount: 3,
    exportedAt: '2026-06-22T00:02:30.000Z'
  })),
  importPdfAnnotationSidecarPackage: vi.fn(async () => ({
    ok: true,
    sidecar: pdfAnnotationSidecarFixture,
    path: '/tmp/workspace/.sciforge/pdf-annotations/sha256.json',
    importedAt: '2026-06-22T00:03:00.000Z',
    pdfFingerprint: { sha256: 'sha256', size: 1 },
    fingerprintMatched: true,
    warnings: []
  }))
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
    provider: defaultModelProviderSettings(),
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
    getMainWindow: () => null,
    applySettingsPatch,
    fetchUpstreamModels: vi.fn() as never,
    getRemoteChannelRuntime: () => null,
    getScheduleRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
    resolveRuntimeConfigPath: () => '/tmp/sciforge-runtime.json',
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

function stubEvidenceDagReady(status = 200) {
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ ok: status >= 200 && status < 300, data: { service: 'evidence-dag-engine' } }),
    { status }
  ))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    if (href.endsWith('/version')) {
      return new Response(JSON.stringify({
        ok: true,
        data: { service: 'evidence-dag-engine' }
      }), { status: 200 })
    }
    if (href.endsWith('/threads/codex%3Athread-1/ingest-trace')) {
      return new Response(JSON.stringify({
        ok: true,
        data: { summary: { node_count: 2 } }
      }), { status: 200 })
    }
    if (href.endsWith('/threads/codex%3Athread-1/audit-runs')) {
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

function figureStyleExtractionFixture() {
  const spec = {
    version: 1 as const,
    source: { path: 'figures/reference.png', type: 'image' as const, figureId: 'Fig. 2A' },
    canvas: { width: 640, height: 420, aspectRatio: 1.52, background: '#ffffff' },
    palette: {
      colors: ['#222222', '#d24b4b'],
      background: '#ffffff',
      ink: '#222222',
      accent: ['#d24b4b'],
      colorMode: 'limited' as const
    },
    typography: { fontFamily: 'Arial', axisSize: 8, labelSize: 9, titleSize: 11, weight: 'regular' as const },
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
    marks: { lineWidth: 1.2, markerSize: 3, errorBarStyle: 'unknown' as const, density: 'balanced' as const },
    annotations: { significance: 'unknown' as const, legend: 'frameless' as const },
    export: { formats: ['pdf' as const, 'svg' as const, 'png' as const], dpi: 300, transparent: false },
    confidence: { overall: 0.72, palette: 0.8, layout: 0.7, axes: 0.75, typography: 0.35 }
  }

  return {
    ok: true as const,
    spec,
    applyPlan: {
      styleSpec: spec,
      plottingWorkflow: {
        recommendedSkills: ['scientific-visualization'],
        recommendedLibraries: ['Matplotlib'],
        nextControlledTool: 'SciForge DataFigure Engine',
        guardrails: ['Keep generated figures auditable.']
      },
      matplotlibHints: {
        rcParams: { 'axes.grid': true },
        palette: ['#d24b4b'],
        layoutNotes: ['Use 1x1 panel layout.']
      }
    },
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

  it('routes Figure Style reference extraction through the high-level IPC command', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const extraction = figureStyleExtractionFixture()
    const croppedImagePath = '/tmp/workspace/.sciforge/scientific-plotting/references/fig-2a.png'
    const preparedReference = {
      ok: true as const,
      status: 'prepared' as const,
      source: {
        path: '/tmp/workspace/paper/main.pdf',
        type: 'pdf' as const,
        page: 2,
        width: 1000,
        height: 800
      },
      cropBox: { unit: 'pixel' as const, x: 10, y: 20, width: 700, height: 500 },
      croppedImagePath,
      referenceManifestPath: '/tmp/workspace/.sciforge/scientific-plotting/references/fig-2a.reference.json',
      referenceManifest: {
        version: 1 as const,
        tool: 'scientific_plotting_prepare_reference' as const,
        createdAt: '2026-07-07T00:00:00.000Z',
        requestHash: 'hash',
        source: {
          path: '/tmp/workspace/paper/main.pdf',
          type: 'pdf' as const,
          page: 2,
          width: 1000,
          height: 800
        },
        cropBox: { unit: 'pixel' as const, x: 10, y: 20, width: 700, height: 500 },
        croppedImagePath,
        warnings: [],
        nextWorkflow: {
          referencePath: croppedImagePath,
          suggestedProfileTool: 'scientific_plotting_style_profiles' as const,
          suggestedPlanTool: 'scientific_plotting_plan' as const,
          suggestedRenderTool: 'scientific_plotting_render' as const,
          suggestedReviewTool: 'scientific_plotting_review' as const,
          guardrails: []
        }
      },
      warnings: []
    }
    const prepareScientificPlottingReference = vi.fn(async () => preparedReference)
    const extractFigureStyle = vi.fn(async () => extraction)

    registerAppIpcHandlers(registerOptions({
      prepareScientificPlottingReference,
      extractFigureStyle
    }))

    const result = await handlers.get('figure-style:extract-reference')?.({}, {
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper/main.pdf',
      sourceType: 'pdf',
      page: 2,
      dpi: 180,
      cropBox: { unit: 'ratio', x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
      figureId: ' Fig. 2A ',
      notes: ' style only '
    })

    expect(prepareScientificPlottingReference).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper/main.pdf',
      sourceType: 'pdf',
      page: 2,
      dpi: 180,
      cropBox: { unit: 'ratio', x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
      figureId: 'Fig. 2A',
      extractStyle: true
    })
    expect(extractFigureStyle).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/workspace',
      sourcePath: '.sciforge/scientific-plotting/references/fig-2a.png',
      sourceType: 'image',
      figureId: 'Fig. 2A',
      notes: 'style only'
    })
    expect(result).toMatchObject({
      ok: true,
      sourcePath: '.sciforge/scientific-plotting/references/fig-2a.png',
      sourceType: 'image',
      preparedReference,
      extraction
    })
  })

  it('saves Figure Style specs through the dedicated IPC command', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sciforge-figure-style-')))
    const extraction = figureStyleExtractionFixture()
    try {
      registerAppIpcHandlers(registerOptions())

      const result = await handlers.get('figure-style:save-spec')?.({}, {
        workspaceRoot,
        path: ' .sciforge/figure-styles/custom.json ',
        spec: extraction.spec,
        applyPlan: extraction.applyPlan,
        diagnostics: extraction.diagnostics
      })

      expect(result).toMatchObject({
        ok: true,
        path: join(workspaceRoot, '.sciforge/figure-styles/custom.json')
      })
      const saved = JSON.parse(readFileSync(join(workspaceRoot, '.sciforge/figure-styles/custom.json'), 'utf8'))
      expect(saved).toEqual({
        spec: extraction.spec,
        applyPlan: extraction.applyPlan,
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

  it('routes PDF annotation sidecar IPC calls through the service', async () => {
    const pdfAnnotations = await import('../services/pdf-annotation-sidecar-service')
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const target = {
      pdfPath: ' /tmp/workspace/paper.pdf ',
      workspaceRoot: ' /tmp/workspace ',
      pageCount: 12
    }

    registerAppIpcHandlers(registerOptions())

    await expect(handlers.get('pdfAnnotations:load')?.({}, target)).resolves.toMatchObject({
      ok: true,
      source: 'empty'
    })
    await expect(handlers.get('pdfAnnotations:save')?.({}, {
      ...target,
      sidecar: pdfAnnotationSidecarFixture
    })).resolves.toMatchObject({
      ok: true,
      savedAt: '2026-06-22T00:01:00.000Z'
    })
    await expect(handlers.get('pdfAnnotations:export')?.({}, {
      ...target,
      sidecar: pdfAnnotationSidecarFixture,
      anonymizeAuthors: true
    })).resolves.toMatchObject({
      ok: true,
      path: '/tmp/workspace/paper.dsgui-pdf.zip'
    })
    await expect(handlers.get('pdfAnnotations:exportPdf')?.({}, {
      ...target,
      sidecar: pdfAnnotationSidecarFixture
    })).resolves.toMatchObject({
      ok: true,
      path: '/tmp/workspace/paper.annotated.pdf',
      annotationCount: 3
    })
    await expect(handlers.get('pdfAnnotations:import')?.({}, {
      ...target,
      packageBase64: 'ZmFrZS16aXA=',
      attemptRelocation: true
    })).resolves.toMatchObject({
      ok: true,
      fingerprintMatched: true
    })

    expect(pdfAnnotations.loadPdfAnnotationSidecar).toHaveBeenCalledWith({
      pdfPath: '/tmp/workspace/paper.pdf',
      workspaceRoot: '/tmp/workspace',
      pageCount: 12
    })
    expect(pdfAnnotations.savePdfAnnotationSidecar).toHaveBeenCalledWith({
      pdfPath: '/tmp/workspace/paper.pdf',
      workspaceRoot: '/tmp/workspace',
      pageCount: 12,
      sidecar: pdfAnnotationSidecarFixture
    })
    expect(pdfAnnotations.exportPdfAnnotationSidecarPackage).toHaveBeenCalledWith({
      pdfPath: '/tmp/workspace/paper.pdf',
      workspaceRoot: '/tmp/workspace',
      pageCount: 12,
      sidecar: pdfAnnotationSidecarFixture,
      anonymizeAuthors: true
    })
    expect(pdfAnnotations.exportPdfAnnotationAdobePdf).toHaveBeenCalledWith({
      pdfPath: '/tmp/workspace/paper.pdf',
      workspaceRoot: '/tmp/workspace',
      pageCount: 12,
      sidecar: pdfAnnotationSidecarFixture
    })
    expect(pdfAnnotations.importPdfAnnotationSidecarPackage).toHaveBeenCalledWith({
      pdfPath: '/tmp/workspace/paper.pdf',
      workspaceRoot: '/tmp/workspace',
      pageCount: 12,
      packageBase64: 'ZmFrZS16aXA=',
      attemptRelocation: true
    })
  })

  it('rejects invalid PDF annotation import IPC before calling the service', async () => {
    const pdfAnnotations = await import('../services/pdf-annotation-sidecar-service')
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    await expect(
      handlers.get('pdfAnnotations:import')?.({}, {
        pdfPath: '/tmp/workspace/paper.pdf',
        workspaceRoot: '/tmp/workspace'
      })
    ).rejects.toThrow(/Invalid payload for pdfAnnotations:import/)
    expect(pdfAnnotations.importPdfAnnotationSidecarPackage).not.toHaveBeenCalled()
  })

  it('returns an Evidence DAG view URL with a runtime-scoped thread id', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const fetchMock = stubEvidenceDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    const handler = handlers.get('evidenceDag:view')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, { runtimeId: 'codex', threadId: 'thread-1' })).resolves.toEqual({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1#token=test-token'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4897/version',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer test-token' }
      })
    )
  })

  it('returns the global Evidence DAG view without an active thread', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    stubEvidenceDagReady()
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions())

    await expect(handlers.get('evidenceDag:view')?.({}, {})).resolves.toEqual({
      url: 'http://127.0.0.1:4897/#token=test-token'
    })
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
    ).rejects.toThrow(/Evidence DAG service is not reachable/)
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
    ).resolves.toEqual({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1#token=test-token'
    })

    expect(agentRuntime.readThread).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:4897/threads/codex%3Athread-1/ingest-trace',
      expect.anything()
    )
  })

  it('runs a manual Evidence DAG audit after synchronously backfilling the active thread', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.endsWith('/version')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { service: 'evidence-dag-engine' }
        }), { status: 200 })
      }
      if (href.endsWith('/threads/codex%3Athread-1/ingest-trace')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { summary: { node_count: 2 }, audited: true }
        }), { status: 200 })
      }
      if (href.endsWith('/threads/codex%3Athread-1/audit-runs')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'audit:1',
            risk_digest: { total_findings: 2, highest_severity: 'major' }
          }
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: { message: href } }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
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
      handlers.get('evidenceDag:audit-run')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        threshold: 0.7
      })
    ).resolves.toEqual({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1#token=test-token',
      riskDigest: { total_findings: 2, highest_severity: 'major' }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4897/threads/codex%3Athread-1/ingest-trace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          trace: [
            { id: 'u1', type: 'message', role: 'user', content: 'question' },
            { id: 'a1', type: 'message', role: 'assistant', content: 'answer' }
          ]
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4897/threads/codex%3Athread-1/audit-runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          trigger: 'manual',
          threshold: 0.7
        })
      })
    )
  })

  it('does not run a manual Evidence DAG audit when strict backfill fails', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:4897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'test-token')
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.endsWith('/version')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { service: 'evidence-dag-engine' }
        }), { status: 200 })
      }
      if (href.endsWith('/threads/codex%3Athread-1/ingest-trace')) {
        return new Response(JSON.stringify({
          ok: false,
          error: { message: 'extract failed' }
        }), { status: 500 })
      }
      if (href.endsWith('/threads/codex%3Athread-1/audit-runs')) {
        return new Response(JSON.stringify({
          ok: true,
          data: { risk_digest: { total_findings: 0, highest_severity: 'none' } }
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: { message: href } }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const agentRuntime = {
      readThread: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        title: 'Thread',
        updatedAt: '2026-06-26T00:00:00.000Z',
        latestSeq: 1,
        items: [{ id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'question' }]
      }))
    }
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')

    registerAppIpcHandlers(registerOptions({ agentRuntime: agentRuntime as never }))

    await expect(
      handlers.get('evidenceDag:audit-run')?.({}, {
        runtimeId: 'codex',
        threadId: 'thread-1'
      })
    ).rejects.toThrow(/extract failed/)
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:4897/threads/codex%3Athread-1/audit-runs',
      expect.anything()
    )
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

  it('routes HTML preview requests through the dev browser dispatcher', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-html-ipc-'))
    const htmlPath = join(workspaceRoot, 'status.html')
    writeFileSync(htmlPath, '<!doctype html><title>Status</title>')
    const { workspaceHtmlPreviewService } = await import('../services/workspace-html-preview-service')
    try {
      const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
      const sender = createSender(902)

      const dispatcher = registerAppIpcHandlers(registerOptions())
      const result = await dispatcher.invoke(
        'file:preview-workspace-html',
        { path: htmlPath, workspaceRoot },
        sender
      )

      expect(result).toMatchObject({
        ok: true,
        path: realpathSync(htmlPath),
        workspaceRoot: realpathSync(workspaceRoot)
      })
      expect((result as { url?: string }).url).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/status\.html/
      )
      expect(handlers.get('file:preview-workspace-html')).toBeTypeOf('function')
    } finally {
      await workspaceHtmlPreviewService.close()
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

  it('opens the local Model Router config file through the injected handler', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const openModelRouterConfigFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/sciforge/model-router/config.json'
    }))
    const current = settings()
    const store = { load: vi.fn(async () => current) }

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      openModelRouterConfigFile
    }))

    await expect(handlers.get('modelRouter:config:open')?.({}, undefined)).resolves.toEqual({
      ok: true,
      path: '/tmp/sciforge/model-router/config.json'
    })
    expect(store.load).toHaveBeenCalled()
    expect(openModelRouterConfigFile).toHaveBeenCalledWith(current)
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
    ).resolves.toEqual({
      threadId: 'thread-1',
      url: 'http://127.0.0.1:4897/?thread=claude%3Athread-1#token=main-process-token'
    })
  })
})
