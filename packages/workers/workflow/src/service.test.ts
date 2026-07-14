import assert from 'node:assert/strict'
import test from 'node:test'

import type { WorkflowInternalHttpClient, WorkflowFetch } from './service.js'
import {
  createWorkflowInternalHttpClient,
  createWorkflowService,
  WorkflowRuntimeHttpError
} from './service.js'
import { InMemoryWorkflowAuditRecorder } from './audit.js'

test('uses fake internal HTTP fetch for list and run', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch: WorkflowFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const pathname = new URL(String(url)).pathname
    if (pathname === '/workflow/internal/list') {
      return jsonResponse({
        ok: true,
        workflows: [{
          id: 'wf-1',
          name: 'Paper digest',
          description: 'Digest a topic',
          inputs: [{ key: 'topic', type: 'text', required: true }]
        }]
      })
    }
    if (pathname === '/workflow/internal/run') {
      return jsonResponse({
        ok: true,
        runId: 'run-1',
        status: 'running',
        message: 'Workflow started.',
        output: ''
      })
    }
    return jsonResponse({ ok: false, message: 'not found' }, 404)
  }

  const service = createWorkflowService({
    client: createWorkflowInternalHttpClient({
      baseUrl: 'http://127.0.0.1:8787',
      secret: 'secret',
      fetch
    })
  })

  const listed = await service.list()
  assert.equal(listed.ok, true)
  assert.equal(listed.ok ? listed.workflows[0]?.schemaResourceUri : '', 'workflow://schema/wf-1')

  const run = await service.run({ workflow_id: 'wf-1', input: { topic: 'biology' }, confirmed: true })
  assert.equal(run.ok, true)
  assert.equal(run.ok ? run.runId : '', 'run-1')
  assert.equal(run.ok ? run.status : '', 'running')
  assert.equal(run.ok ? run.message : '', 'Workflow started.')

  const runCall = calls.find((call) => new URL(call.url).pathname === '/workflow/internal/run')
  assert.ok(runCall)
  assert.equal(asHeaderRecord(runCall.init.headers).Authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(String(runCall.init.body)), {
    workflowId: 'wf-1',
    input: { topic: 'biology' }
  })
})

test('internal HTTP client fails closed when no workflow secret is configured', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch: WorkflowFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return jsonResponse({ ok: true, workflows: [] })
  }
  const service = createWorkflowService({
    client: createWorkflowInternalHttpClient({
      baseUrl: 'http://127.0.0.1:8787',
      secret: '',
      fetch
    })
  })

  const result = await service.list()

  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.error.code, 'runtime_http_error')
  assert.match(result.ok ? '' : result.error.reason, /secret is not configured/i)
  assert.equal(calls.length, 0)
})

test('run dry-run previews without invoking runtime run endpoint', async () => {
  const client = new FakeWorkflowClient({
    '/workflow/internal/list': {
      ok: true,
      workflows: [{
        id: 'wf-1',
        name: 'Paper digest',
        inputs: [{ key: 'topic', type: 'text', required: true }]
      }]
    }
  })
  const service = createWorkflowService({ client })

  const result = await service.run({
    workflow_id: 'wf-1',
    input: { topic: 'biology' },
    dry_run: true
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.wouldRun : false, true)
  assert.deepEqual(client.paths, ['/workflow/internal/list'])
})

test('write tools require confirmation before invoking runtime write endpoints', async () => {
  const client = new FakeWorkflowClient({})
  const service = createWorkflowService({ client })

  const run = await service.run({ workflow_id: 'wf-1', input: { topic: 'biology' } })
  const imported = await service.importWorkflow({
    workflow: {
      id: 'wf-2',
      name: 'Imported',
      nodes: [{ id: 'trigger', type: 'manual-trigger', config: {} }]
    }
  })

  assert.equal(run.ok, false)
  assert.equal(run.ok ? '' : run.error.code, 'confirmation_required')
  assert.equal(imported.ok, false)
  assert.equal(imported.ok ? '' : imported.error.code, 'confirmation_required')
  assert.deepEqual(client.paths, [])

  const records = service.auditRecords()
  assert.deepEqual(records.map((record) => record.action), ['run', 'import'])
  assert.deepEqual(records.map((record) => record.confirmationRequired), [true, true])
})

test('confirmed import reports the runtime-staged disabled state', async () => {
  const client = new FakeWorkflowClient({
    '/workflow/internal/import': {
      ok: true,
      workflowId: 'wf-imported',
      workflow: {
        id: 'wf-imported',
        name: 'Imported workflow',
        enabled: false,
        callableByAgent: false
      },
      message: 'Workflow imported disabled and not callable by agents. Enable it and allow agent access in the SciForge workflow editor before running it.'
    }
  })
  const service = createWorkflowService({ client })

  const result = await service.importWorkflow({
    workflow: {
      id: 'wf-imported',
      name: 'Imported workflow',
      enabled: true,
      callableByAgent: true,
      nodes: [{ id: 'trigger', type: 'manual-trigger', config: {} }]
    },
    confirmed: true
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.workflow?.enabled : true, false)
  assert.equal(result.ok ? result.workflow?.callableByAgent : true, false)
  assert.match(result.ok ? result.message : '', /Enable it and allow agent access/)
  assert.deepEqual(client.paths, ['/workflow/internal/import'])
})

test('stop preview avoids confirmation and live stop requires confirmation', async () => {
  const client = new FakeWorkflowClient({})
  const service = createWorkflowService({ client })

  const preview = await service.stop({ run_id: 'run-1', preview: true })
  const denied = await service.stop({ run_id: 'run-1' })

  assert.equal(preview.ok, true)
  assert.equal(preview.ok ? preview.wouldStop : false, true)
  assert.equal(denied.ok, false)
  assert.equal(denied.ok ? '' : denied.error.code, 'confirmation_required')
  assert.deepEqual(client.paths, [])

  const stopRecords = service.auditRecords().filter((record) => record.action === 'stop')
  assert.equal(stopRecords.length, 2)
  assert.equal(stopRecords[0]?.preview, true)
  assert.equal(stopRecords[1]?.confirmationRequired, true)
  assert.equal(stopRecords[1]?.errorCode, 'confirmation_required')
})

test('confirmed stop calls runtime without forwarding confirmation text', async () => {
  const client = new FakeWorkflowClient({
    '/workflow/internal/stop': {
      ok: true,
      runId: 'run-1',
      status: 'stopping',
      message: 'Stop requested'
    }
  })
  const service = createWorkflowService({ client })

  const stopped = await service.stop({ run_id: 'run-1', confirmation: 'stop run-1' })

  assert.equal(stopped.ok, true)
  assert.deepEqual(client.paths, ['/workflow/internal/stop'])
  assert.deepEqual(client.requests[0]?.request?.body, { runId: 'run-1' })
})

test('validate delegates to the runtime internal validate endpoint', async () => {
  const client = new FakeWorkflowClient({
    '/workflow/internal/validate': {
      ok: true,
      valid: false,
      workflowId: 'wf-1',
      issues: [{ code: 'missing_required_input', message: 'Missing required input: topic', path: 'topic' }],
      inputSchema: [{ key: 'topic', type: 'text', required: true }]
    }
  })
  const service = createWorkflowService({ client })

  const result = await service.validate({ workflow_id: 'wf-1', input: {} })

  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.valid : true, false)
  assert.deepEqual(client.paths, ['/workflow/internal/validate'])
  assert.deepEqual(client.requests[0]?.request?.body, {
    workflowId: 'wf-1',
    input: {}
  })
  assert.equal(result.ok ? result.workflowId : '', 'wf-1')
  assert.equal(result.ok ? result.inputSchema?.[0]?.key : '', 'topic')
})

test('maps runtime HTTP failures to model-readable error results', async () => {
  const client = new FakeWorkflowClient({})
  client.error = new WorkflowRuntimeHttpError(503, { ok: false, message: 'runtime offline' }, 'runtime offline')
  const service = createWorkflowService({ client })

  const result = await service.status({ run_id: 'run-1' })

  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.error.code, 'runtime_unavailable')
  assert.equal(result.ok ? false : result.error.retryable, true)
  assert.match(result.ok ? '' : result.error.suggestion, /Start SciForge|workflow runtime/)
})

test('previews import and export without calling write endpoints', async () => {
  const client = new FakeWorkflowClient({
    '/workflow/internal/list': {
      ok: true,
      workflows: [{
        id: 'wf-1',
        name: 'Paper digest',
        inputs: []
      }]
    }
  })
  const service = createWorkflowService({ client })

  const imported = await service.importWorkflow({
    workflow: {
      id: 'wf-2',
      name: 'Imported',
      nodes: [{ id: 'trigger', type: 'manual-trigger', config: {} }]
    },
    preview: true
  })
  const exported = await service.exportWorkflow({ workflow_id: 'wf-1', preview: true })

  assert.equal(imported.ok, true)
  assert.equal(imported.ok ? imported.wouldImport : false, true)
  assert.equal(exported.ok, true)
  assert.equal(exported.ok ? exported.preview : false, true)
  assert.deepEqual(client.paths, ['/workflow/internal/list'])
})

test('records sanitized workflow audit events without input, output, or import payloads', async () => {
  const audit = new InMemoryWorkflowAuditRecorder({
    nowIso: () => '2026-06-23T00:00:00.000Z',
    nextId: (prefix) => `${prefix}_test`
  })
  const client = new FakeWorkflowClient({
    '/workflow/internal/list': {
      ok: true,
      workflows: [{
        id: 'wf-secret',
        name: 'Private workflow name',
        inputs: [{ key: 'topic', type: 'text', required: true }]
      }]
    }
  })
  const service = createWorkflowService({ client, auditRecorder: audit })

  await service.run({
    workflow_id: 'wf-secret',
    input: { topic: 'biology', apiKey: 'super-secret-input' },
    workspace_root: '/Users/example/private-project',
    dry_run: true
  })
  await service.importWorkflow({
    workflow: {
      id: 'wf-import',
      name: 'Secret import name',
      nodes: [{ id: 'trigger', type: 'manual-trigger', config: { token: 'node-secret' } }],
      env: [{ value: 'env-secret' }]
    },
    preview: true
  })

  const serializedAudit = JSON.stringify(audit.records())
  assert.match(serializedAudit, /wf-secret/)
  assert.match(serializedAudit, /wf-import/)
  assert.doesNotMatch(serializedAudit, /super-secret-input|private-project|Secret import name|node-secret|env-secret/)
})

class FakeWorkflowClient implements WorkflowInternalHttpClient {
  readonly paths: string[] = []
  readonly requests: Array<{ path: string; request?: { method?: string; body?: Record<string, unknown> } }> = []
  error: unknown

  constructor(private readonly responses: Record<string, unknown>) {}

  async request(path: string, request?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<unknown> {
    this.paths.push(path)
    this.requests.push({ path, request })
    if (this.error) throw this.error
    return this.responses[path] ?? { ok: false, message: `No fake response for ${path}` }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function asHeaderRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers || Array.isArray(headers) || headers instanceof Headers) return {}
  return headers
}
