import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTcpServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  mergeWorkflowSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WorkflowV1
} from '../shared/app-settings'
import { WorkflowRuntime } from './workflow-runtime'
import type { ScheduleRuntimeDeps } from './schedule-runtime-helpers'

const now = '2026-06-23T00:00:00.000Z'
const mockedResearch = vi.hoisted(() => ({ pdfUrl: '' }))

vi.mock('../../packages/workers/search/src/research-service', () => ({
  researchSearchConfigFromEnv: vi.fn(() => ({
    arxivEnabled: true,
    biorxivEnabled: false,
    semanticScholarEnabled: false,
    semanticScholarApiKey: '',
    tavilyEnabled: false,
    tavilyApiKey: '',
    cnsEnabled: false,
    cnsDomains: [],
    maxResults: 10,
    timeoutMs: 1_000
  })),
  createResearchSearchService: vi.fn(() => ({
    search: vi.fn(async (input: { query: string; maxResults?: number }) => ({
      answerGuidance: 'Use as evidence.',
      interpretedIntent: { intent: 'overview', domain: 'general', rationale: 'test' },
      generatedQueries: [input.query],
      papers: [{
        title: 'Generic workflow paper',
        authors: ['A. Researcher'],
        year: 2026,
        venue: 'Test Venue',
        abstract: 'A test abstract.',
        url: mockedResearch.pdfUrl,
        pdfUrl: mockedResearch.pdfUrl,
        source: ['arxiv'],
        relevanceReason: 'Matches the generic query.'
      }],
      webResults: [],
      themes: [],
      gaps: [],
      suggestedFollowups: [],
      diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 1 }],
      citations: [{ title: 'Generic workflow paper', url: mockedResearch.pdfUrl, source: 'arxiv' }]
    }))
  }))
}))

function unusedAgentRuntime(): ScheduleRuntimeDeps['agentRuntime'] {
  const fail = async (): Promise<never> => {
    throw new Error('Unexpected agentRuntime call in this test.')
  }
  return {
    startThread: vi.fn(fail),
    readThread: vi.fn(fail),
    startTurn: vi.fn(fail),
    interruptTurn: vi.fn(fail)
  } as unknown as ScheduleRuntimeDeps['agentRuntime']
}

function makeWorkflow(patch: Partial<WorkflowV1> = {}): WorkflowV1 {
  return {
    id: 'workflow-1',
    name: 'Callable workflow',
    enabled: true,
    callableByAgent: true,
    env: [{ key: 'SECRET_TOKEN', value: 'super-secret', type: 'secret' }],
    nodes: [{
      id: 'trigger-1',
      type: 'manual-trigger',
      name: 'Manual',
      position: { x: 0, y: 0 },
      disabled: false,
      onError: 'fail',
      retries: 0,
      retryDelayMs: 1000,
      config: {
        inputSchema: [{
          key: 'topic',
          label: 'Topic',
          type: 'text',
          required: true,
          options: [],
          defaultValue: '',
          description: 'Topic to process'
        }]
      }
    }],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: [{
      id: 'run-1',
      trigger: 'manual',
      status: 'success',
      startedAt: now,
      finishedAt: now,
      message: 'Done',
      nodeResults: []
    }],
    ...patch
  }
}

function settingsWith(workflows: WorkflowV1[], port: number, secret = 'workflow-secret'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: mergeWorkflowSettings(defaultWorkflowSettings(), {
      enabled: true,
      webhookPort: port,
      webhookSecret: secret,
      workflows
    }),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function createStore(initial: AppSettingsV1) {
  let current = initial
  return {
    load: vi.fn(async () => current),
    patch: vi.fn(async (partial: AppSettingsPatch) => {
      current = {
        ...current,
        workflow: mergeWorkflowSettings(current.workflow, partial.workflow)
      }
      return current
    }),
    read: () => current
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createTcpServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const port = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function startPdfServer(): Promise<{ server: HttpServer; url: string }> {
  const server = createHttpServer((req, res) => {
    if (req.url !== '/paper.pdf') {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/pdf' })
    res.end(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${address.port}/paper.pdf` }
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for condition.')
}

async function requestInternal(
  port: number,
  path: string,
  body?: Record<string, unknown>,
  secret = 'workflow-secret'
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {}
  if (secret) headers.Authorization = `Bearer ${secret}`
  const init: RequestInit = { method: body ? 'POST' : 'GET', headers }
  if (body) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>
  }
}

describe('WorkflowRuntime internal HTTP facade', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves list, status, validate, stop, export, and import through the authenticated internal API', async () => {
    const port = await findAvailablePort()
    const workflow = makeWorkflow()
    const store = createStore(settingsWith([workflow], port))
    const runtime = new WorkflowRuntime({
      store: store as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn()
    })
    runtime.sync(store.read())

    try {
      await expect(requestInternal(port, '/workflow/internal/list', undefined, '')).resolves.toMatchObject({
        status: 401,
        json: { ok: false, message: 'Unauthorized.' }
      })

      await expect(requestInternal(port, '/workflow/internal/list')).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflows: [{
            id: 'workflow-1',
            name: 'Callable workflow',
            inputs: [{ key: 'topic', type: 'text', required: true, description: 'Topic to process' }]
          }]
        }
      })

      await expect(requestInternal(port, '/workflow/internal/status', { runId: 'run-1' })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          runId: 'run-1',
          workflowId: 'workflow-1',
          status: 'success',
          runtime: { runningWorkflowIds: [] },
          run: { id: 'run-1', status: 'success' }
        }
      })

      await expect(requestInternal(port, '/workflow/internal/validate', {
        workflowId: 'workflow-1',
        input: {}
      })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          valid: false,
          workflowId: 'workflow-1',
          issues: [{ code: 'missing_required_input', path: 'topic' }],
          inputSchema: [{ key: 'topic', type: 'text', required: true }]
        }
      })

      await expect(requestInternal(port, '/workflow/internal/validate', {
        workflow: {
          name: 'Invalid import',
          nodes: []
        }
      })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          valid: false,
          issues: [{ code: 'invalid_workflow_document', path: 'nodes' }]
        }
      })

      await expect(requestInternal(port, '/workflow/internal/stop', { workflowId: 'workflow-1' })).resolves.toMatchObject({
        status: 400,
        json: {
          ok: false,
          workflowId: 'workflow-1',
          message: 'Workflow is not running.'
        }
      })

      const exported = await requestInternal(port, '/workflow/internal/export', { workflowId: 'workflow-1' })
      expect(exported).toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflowId: 'workflow-1',
          workflow: {
            id: 'workflow-1',
            enabled: false,
            callableByAgent: false,
            env: [{ key: 'SECRET_TOKEN', value: '', type: 'secret' }],
            runs: []
          }
        }
      })

      await expect(requestInternal(port, '/workflow/internal/import', {
        workflow: {
          ...(exported.json.workflow as Record<string, unknown>),
          id: 'workflow-1',
          name: 'Callable workflow'
        }
      })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflowId: 'workflow-1-2',
          workflow: {
            id: 'workflow-1-2',
            name: 'Callable workflow (2)',
            enabled: false,
            callableByAgent: false,
            runs: []
          },
          message: 'Workflow imported disabled and not callable by agents. Enable it and allow agent access in the SciForge workflow editor before running it.'
        }
      })
    } finally {
      runtime.stop()
    }
  })

  it('returns the latest active run and its actual id when status is queried by workflow id', async () => {
    const port = await findAvailablePort()
    const base = makeWorkflow()
    const workflow = makeWorkflow({
      nodes: [
        ...base.nodes,
        {
          id: 'approval-1',
          type: 'human-approval',
          name: 'Confirm',
          position: { x: 220, y: 0 },
          disabled: false,
          config: { title: 'Confirm', instruction: '{{text}}', timeoutMs: 0, onTimeout: 'rejected' }
        }
      ],
      connections: [{
        id: 'edge-1',
        source: 'trigger-1',
        sourceHandle: 'out',
        target: 'approval-1',
        targetHandle: 'in'
      }]
    })
    const store = createStore(settingsWith([workflow], port))
    const runtime = new WorkflowRuntime({
      store: store as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn()
    })
    runtime.sync(store.read())

    try {
      const started = await runtime.runWorkflow('workflow-1', { topic: 'biology' })
      expect(started.ok).toBe(true)
      if (!started.ok) throw new Error(started.message)
      await waitFor(async () => (await runtime.status()).pendingApprovals.length === 1)

      await expect(requestInternal(port, '/workflow/internal/status', { workflowId: 'workflow-1' })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          runId: started.runId,
          workflowId: 'workflow-1',
          status: 'running',
          runtime: { runningWorkflowIds: ['workflow-1'] },
          run: { id: started.runId, status: 'running' }
        }
      })

      const pending = (await runtime.status()).pendingApprovals[0]
      expect(runtime.resolveApproval(pending.token, 'approved')).toBe(true)
      await waitFor(async () => !(await runtime.status()).runningWorkflowIds.includes('workflow-1'))
    } finally {
      runtime.stop()
    }
  })

  it('denies internal HTTP requests when the stored workflow secret is empty', async () => {
    const port = await findAvailablePort()
    const store = createStore(settingsWith([makeWorkflow()], port, ''))
    const runtime = new WorkflowRuntime({
      store: store as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn()
    })
    runtime.sync(store.read())

    try {
      await expect(requestInternal(port, '/workflow/internal/list', undefined, 'anything')).resolves.toMatchObject({
        status: 401,
        json: { ok: false, message: 'Unauthorized.' }
      })
    } finally {
      runtime.stop()
    }
  })

  it('starts an agent-callable workflow without awaiting terminal completion', async () => {
    const port = await findAvailablePort()
    const store = createStore(settingsWith([makeWorkflow()], port))
    const runtime = new WorkflowRuntime({
      store: store as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn()
    })
    runtime.sync(store.read())
    const runtimeInternals = runtime as unknown as {
      runWorkflowInternal: (...args: unknown[]) => Promise<never>
    }
    vi.spyOn(runtimeInternals, 'runWorkflowInternal').mockImplementation(
      () => new Promise<never>(() => undefined)
    )

    try {
      await expect(runtime.runWorkflowForTool('workflow-1', { topic: 'biology' })).resolves.toMatchObject({
        ok: true,
        status: 'running',
        message: 'Workflow started.',
        output: '',
        runId: expect.any(String)
      })
    } finally {
      runtime.stop()
    }
  })

  it('marks persisted in-flight runs as interrupted after a runtime restart', async () => {
    const port = await findAvailablePort()
    const workflow = makeWorkflow({
      lastStatus: 'running',
      lastMessage: 'Running',
      runs: [{
        id: 'orphaned-run',
        trigger: 'agent',
        status: 'running',
        startedAt: now,
        finishedAt: '',
        message: '',
        nodeResults: []
      }]
    })
    const store = createStore(settingsWith([workflow], port))
    const runtime = new WorkflowRuntime({
      store: store as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn()
    })

    try {
      runtime.sync(store.read())
      await waitFor(async () => store.read().workflow.workflows[0]?.lastStatus === 'error')

      expect(store.read().workflow.workflows[0]).toMatchObject({
        lastStatus: 'error',
        lastMessage: 'Workflow was interrupted before completion.',
        runs: [{
          id: 'orphaned-run',
          status: 'error',
          message: 'Workflow was interrupted before completion.',
          finishedAt: expect.any(String)
        }]
      })
    } finally {
      runtime.stop()
    }
  })

  it('runs the generic research-search and paper-download nodes through user approval', async () => {
    const port = await findAvailablePort()
    const pdfServer = await startPdfServer()
    const workspace = await mkdtemp(join(tmpdir(), 'workflow-research-'))
    mockedResearch.pdfUrl = pdfServer.url
    const workflow = makeWorkflow({
      id: 'research-loop',
      name: 'Research loop',
      nodes: [
        {
          id: 'trigger-1',
          type: 'manual-trigger',
          name: 'Input',
          position: { x: 0, y: 0 },
          disabled: false,
          config: {
            workspaceRoot: workspace,
            inputSchema: [
              { key: 'query', label: 'Query', type: 'text', required: true, options: [], defaultValue: '', description: '' },
              { key: 'limit', label: 'Limit', type: 'number', required: false, options: [], defaultValue: '1', description: '' }
            ]
          }
        },
        {
          id: 'search-1',
          type: 'research-search',
          name: 'Search',
          position: { x: 220, y: 0 },
          disabled: false,
          config: {
            query: '{{json.query}}',
            intent: 'overview',
            domain: 'general',
            sinceYear: 0,
            maxResults: 5,
            sources: []
          },
          inputs: [{ key: 'maxResults', type: 'number', source: '{{json.limit}}' }]
        },
        {
          id: 'download-1',
          type: 'paper-download',
          name: 'Download',
          position: { x: 440, y: 0 },
          disabled: false,
          config: { outputDir: 'downloads', maxFiles: 5 },
          inputs: [{ key: 'maxFiles', type: 'number', source: '{{json.limit}}' }]
        },
        {
          id: 'review-1',
          type: 'ai-agent',
          name: 'Review',
          position: { x: 660, y: 0 },
          disabled: false,
          config: {
            prompt: 'Summarize the upstream search and downloads.',
            workspaceRoot: '',
            providerId: '',
            model: '',
            reasoningEffort: 'medium',
            mode: 'agent'
          }
        },
        {
          id: 'approval-1',
          type: 'human-approval',
          name: 'Confirm',
          position: { x: 880, y: 0 },
          disabled: false,
          config: { title: 'Confirm', instruction: '{{text}}', timeoutMs: 0, onTimeout: 'rejected' }
        },
        {
          id: 'output-1',
          type: 'output',
          name: 'Output',
          position: { x: 1100, y: 0 },
          disabled: false,
          config: { mode: 'auto', textTemplate: '', jsonPath: '' }
        }
      ],
      connections: [
        { id: 'edge-1', source: 'trigger-1', sourceHandle: 'out', target: 'search-1', targetHandle: 'in' },
        { id: 'edge-2', source: 'search-1', sourceHandle: 'out', target: 'download-1', targetHandle: 'in' },
        { id: 'edge-3', source: 'download-1', sourceHandle: 'out', target: 'review-1', targetHandle: 'in' },
        { id: 'edge-4', source: 'review-1', sourceHandle: 'out', target: 'approval-1', targetHandle: 'in' },
        { id: 'edge-5', source: 'approval-1', sourceHandle: 'approved', target: 'output-1', targetHandle: 'in' }
      ],
      runs: []
    })
    const store = createStore(settingsWith([workflow], port, ''))
    const runtime = new WorkflowRuntime({
      store: store as never,
      logError: vi.fn(),
      agentRuntime: {
        startThread: vi.fn(async () => ({ id: 'thread-1' }) as never),
        startTurn: vi.fn(async () => ({ threadId: 'thread-1', turnId: 'turn-1' }) as never),
        readThread: vi.fn(async () => ({
          turns: [{
            id: 'turn-1',
            status: 'completed',
            items: [{ kind: 'assistant_text', turnId: 'turn-1', text: 'Synthesized review draft.' }]
          }]
        }) as never)
      }
    })

    try {
      await expect(runtime.runWorkflow('research-loop', { query: 'generic materials discovery', limit: 1 })).resolves.toMatchObject({
        ok: true,
        status: 'running'
      })
      await waitFor(async () => (await runtime.status()).pendingApprovals.length === 1, 8_000)
      const pending = (await runtime.status()).pendingApprovals[0]
      expect(pending.instruction).toContain('Synthesized review draft.')
      expect(runtime.resolveApproval(pending.token, 'approved')).toBe(true)
      await waitFor(async () => !(await runtime.status()).runningWorkflowIds.includes('research-loop'), 5_000)

      const saved = store.read().workflow.workflows[0]
      expect(saved.lastStatus).toBe('success')
      const run = saved.runs.at(-1)
      expect(run?.status).toBe('success')
      expect(run?.nodeResults.map((result) => [result.nodeId, result.status, result.message])).toEqual([
        ['trigger-1', 'success', 'Triggered'],
        ['search-1', 'success', 'found 1 paper(s)'],
        ['download-1', 'success', 'downloaded 1/1'],
        ['review-1', 'success', 'Synthesized review draft.'],
        ['approval-1', 'success', 'approved'],
        ['output-1', 'success', 'output']
      ])
      const downloadOutput = JSON.parse(run?.nodeResults.find((result) => result.nodeId === 'download-1')?.outputJson ?? '{}')
      expect(downloadOutput.downloads).toMatchObject([{ status: 'downloaded', title: 'Generic workflow paper' }])
      expect(downloadOutput.downloads[0].localPath).toContain(workspace)
    } finally {
      runtime.stop()
      await closeHttpServer(pdfServer.server)
      await rm(workspace, { recursive: true, force: true })
    }
  }, 12_000)
})
