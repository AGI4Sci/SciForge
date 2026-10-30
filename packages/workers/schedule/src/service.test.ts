import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import {
  SCHEDULE_INTERNAL_ENDPOINTS,
  ScheduleWorkerError,
  type ScheduledTask
} from './contract.js'
import {
  ScheduleService,
  confirmationValueFor,
  createScheduleInternalHttpClient,
  isScheduleDryRunResult,
  type ScheduleAuditEvent,
  type ScheduleInternalHttpClient
} from './service.js'

test('service reads tasks through a real fake internal HTTP server', async () => {
  const requests: Array<{ path: string; auth: string; body: unknown }> = []
  const server = await listenFakeServer(async (req, res) => {
    const body = await readJsonBody(req)
    requests.push({
      path: req.url ?? '',
      auth: req.headers.authorization ?? '',
      body
    })
    writeJson(res, 200, { ok: true, tasks: [sampleTask({ id: 'task-1' })] })
  })

  try {
    const service = new ScheduleService({
      baseUrl: server.baseUrl,
      secret: 'test-secret',
      timeoutMs: 5_000
    })
    const result = await service.list()

    assert.equal(result.count, 1)
    assert.equal(result.tasks[0]?.id, 'task-1')
    assert.deepEqual(requests, [{
      path: SCHEDULE_INTERNAL_ENDPOINTS.list,
      auth: 'Bearer test-secret',
      body: {}
    }])
    assert.deepEqual(service.getAuditEvents(), [])
  } finally {
    await server.close()
  }
})

test('service reads internal secret from the GUI schedule environment fallback', async () => {
  const previousSecret = process.env.GUI_SCHEDULE_INTERNAL_SECRET
  process.env.GUI_SCHEDULE_INTERNAL_SECRET = 'env-secret'
  const requests: Array<{ auth: string }> = []
  const server = await listenFakeServer(async (req, res) => {
    requests.push({ auth: req.headers.authorization ?? '' })
    writeJson(res, 200, { ok: true, tasks: [] })
  })

  try {
    const service = new ScheduleService({
      baseUrl: server.baseUrl,
      timeoutMs: 5_000
    })
    const result = await service.list()

    assert.equal(result.count, 0)
    assert.deepEqual(requests, [{ auth: 'Bearer env-secret' }])
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GUI_SCHEDULE_INTERNAL_SECRET
    } else {
      process.env.GUI_SCHEDULE_INTERNAL_SECRET = previousSecret
    }
    await server.close()
  }
})

test('service maps tool inputs to internal HTTP payloads with an injected client', async () => {
  const client = new FakeInternalClient({
    [SCHEDULE_INTERNAL_ENDPOINTS.create]: { ok: true, task: sampleTask({ id: 'created' }) },
    [SCHEDULE_INTERNAL_ENDPOINTS.update]: { ok: true, task: sampleTask({ id: 'created', title: 'Updated' }) },
    [SCHEDULE_INTERNAL_ENDPOINTS.delete]: { ok: true },
    [SCHEDULE_INTERNAL_ENDPOINTS.run]: { ok: true, threadId: 'thread-1', turnId: 'turn-1', message: 'Started' },
    [SCHEDULE_INTERNAL_ENDPOINTS.detectFromText]: {
      kind: 'created',
      taskId: 'created',
      title: 'Updated',
      scheduleAt: '2026-06-24T09:00:00+08:00',
      confirmationText: 'Created.'
    },
    [SCHEDULE_INTERNAL_ENDPOINTS.status]: {
      internalServerRunning: true,
      internalUrl: 'http://127.0.0.1:8788',
      runningTaskIds: [],
      powerSaveBlockerActive: false
    },
    [SCHEDULE_INTERNAL_ENDPOINTS.list]: { ok: true, tasks: [sampleTask({ id: 'created', title: 'Updated' })] }
  })
  const service = new ScheduleService({ internalClient: client })

  const createInput = {
    title: 'Created',
    prompt: 'Do work.',
    schedule_kind: 'interval',
    every_minutes: 30,
    model: 'auto',
    reasoning_effort: 'medium',
    mode: 'agent',
    enabled: true
  } as const
  const createConfirmation = dryRunConfirmation(await service.create({
    ...createInput,
    dry_run: true
  }))
  await service.create({
    ...createInput,
    confirmed: true,
    confirmation_id: createConfirmation
  })
  const updateInput = { task_id: 'created', time_of_day: '10:30', schedule_kind: 'daily' } as const
  const updateConfirmation = dryRunConfirmation(await service.update({
    ...updateInput,
    dry_run: true
  }))
  await service.update({
    ...updateInput,
    confirmed: true,
    confirmation_id: updateConfirmation
  })
  await service.delete({ task_id: 'created', confirmation: confirmationValueFor('delete', 'created') })
  await service.run({ task_id: 'created', confirmation: confirmationValueFor('run', 'created') })
  await service.detectFromText({ text: 'Tomorrow at 9 remind me to write notes' })
  await service.status()
  const task = await service.getTask('created')

  assert.equal(task.title, 'Updated')
  assert.deepEqual(client.calls[0], {
    path: SCHEDULE_INTERNAL_ENDPOINTS.create,
    body: {
      input: {
        title: 'Created',
        prompt: 'Do work.',
        workspaceRoot: undefined,
        model: 'auto',
        reasoningEffort: 'medium',
        mode: 'agent',
        enabled: true,
        schedule: {
          kind: 'interval',
          atTime: undefined,
          timeOfDay: undefined,
          everyMinutes: 30
        }
      }
    }
  })
  assert.deepEqual(client.calls[1], {
    path: SCHEDULE_INTERNAL_ENDPOINTS.update,
    body: {
      taskId: 'created',
      patch: {
        schedule: {
          kind: 'daily',
          timeOfDay: '10:30'
        }
      }
    }
  })
})

test('service dry-runs write operations without internal side effects and audits redacted input', async () => {
  const auditSinkEvents: ScheduleAuditEvent[] = []
  const client = new FakeInternalClient({})
  const service = new ScheduleService({
    internalClient: client,
    auditSink: (event) => auditSinkEvents.push(event)
  })

  const secretPrompt = 'prompt content that must not appear in audit records'
  const createPreview = await service.create({
    title: 'Preview create',
    prompt: secretPrompt,
    schedule_kind: 'interval',
    every_minutes: 10,
    dry_run: true
  })
  const updatePreview = await service.update({
    task_id: 'task-preview',
    prompt: secretPrompt,
    preview: true
  })
  const deletePreview = await service.delete({ task_id: 'task-preview', dry_run: true })
  const runPreview = await service.run({ task_id: 'task-preview', preview: true })
  const detectPreview = await service.detectFromText({
    text: 'tomorrow morning run private prompt content',
    dry_run: true
  })

  assert.ok(isScheduleDryRunResult(createPreview))
  assert.ok(isScheduleDryRunResult(updatePreview))
  assert.ok(isScheduleDryRunResult(deletePreview))
  assert.ok(isScheduleDryRunResult(runPreview))
  assert.ok(isScheduleDryRunResult(detectPreview))
  assert.equal(createPreview.confirmation?.required, true)
  assert.equal(createPreview.confirmation?.value.startsWith('create:'), true)
  assert.equal(updatePreview.confirmation?.required, true)
  assert.equal(updatePreview.confirmation?.value.startsWith('update:task-preview:'), true)
  assert.equal(deletePreview.confirmation?.value, confirmationValueFor('delete', 'task-preview'))
  assert.equal(runPreview.confirmation?.value, confirmationValueFor('run', 'task-preview'))
  assert.deepEqual(client.calls, [])

  const auditEvents = service.getAuditEvents()
  assert.equal(auditEvents.length, 5)
  assert.equal(auditSinkEvents.length, 5)
  assert.deepEqual(auditEvents.map((event) => event.outcome), [
    'dry_run',
    'dry_run',
    'dry_run',
    'dry_run',
    'dry_run'
  ])
  assert.equal(auditEvents[0]?.request.promptLength, secretPrompt.length)
  assert.equal(auditEvents[0]?.request.prompt, undefined)
  assert.equal(auditEvents[1]?.request.promptLength, secretPrompt.length)
  assert.equal(auditEvents[1]?.request.prompt, undefined)
  assert.equal(auditEvents[4]?.request.textLength, 'tomorrow morning run private prompt content'.length)
  assert.equal(auditEvents[4]?.request.text, undefined)
  assert.doesNotMatch(JSON.stringify(auditEvents), /prompt content that must not appear/)
})

test('service requires confirmation for destructive operations and records structured audit failures', async () => {
  const client = new FakeInternalClient({
    [SCHEDULE_INTERNAL_ENDPOINTS.create]: { ok: true, task: sampleTask({ id: 'created-danger' }) },
    [SCHEDULE_INTERNAL_ENDPOINTS.update]: { ok: true, task: sampleTask({ id: 'danger', prompt: 'Updated prompt.' }) },
    [SCHEDULE_INTERNAL_ENDPOINTS.delete]: { ok: true },
    [SCHEDULE_INTERNAL_ENDPOINTS.run]: { ok: true, threadId: 'thread-1', turnId: 'turn-1', message: 'Started' }
  })
  const service = new ScheduleService({ internalClient: client })

  const dangerousCreate = {
    title: 'Danger create',
    prompt: 'Run later.',
    schedule_kind: 'interval',
    every_minutes: 60
  } as const
  const dangerousUpdate = { task_id: 'danger', prompt: 'Updated prompt.' } as const
  await assert.rejects(
    () => service.create(dangerousCreate),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'confirmation_required')
      assert.equal(error.confirmationRequired?.confirmationId?.startsWith('create:'), true)
      return true
    }
  )
  await assert.rejects(
    () => service.update(dangerousUpdate),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'confirmation_required')
      assert.equal(error.confirmationRequired?.confirmationId?.startsWith('update:danger:'), true)
      return true
    }
  )
  await assert.rejects(
    () => service.delete({ task_id: 'danger' }),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'confirmation_required')
      assert.equal(error.confirmationRequired?.confirmationId, 'delete:danger')
      return true
    }
  )
  await assert.rejects(
    () => service.run({ task_id: 'danger' }),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'confirmation_required')
      assert.equal(error.confirmationRequired?.confirmationId, 'run:danger')
      return true
    }
  )
  assert.deepEqual(client.calls, [])

  const failures = service.getAuditEvents()
  assert.equal(failures.length, 4)
  assert.deepEqual(failures.map((event) => event.outcome), [
    'confirmation_required',
    'confirmation_required',
    'confirmation_required',
    'confirmation_required'
  ])
  assert.equal(failures[0]?.error?.code, 'confirmation_required')
  assert.equal(failures[0]?.confirmationRequired, true)

  await service.create({
    ...dangerousCreate,
    confirmed: true,
    confirmation_id: dryRunConfirmation(await service.create({ ...dangerousCreate, dry_run: true }))
  })
  await service.update({
    ...dangerousUpdate,
    confirmed: true,
    confirmation_id: dryRunConfirmation(await service.update({ ...dangerousUpdate, dry_run: true }))
  })
  await service.delete({ task_id: 'danger', confirmation: confirmationValueFor('delete', 'danger') })
  await service.run({ task_id: 'danger', confirmed: true, confirmation_id: confirmationValueFor('run', 'danger') })
  assert.deepEqual(client.calls, [
    {
      path: SCHEDULE_INTERNAL_ENDPOINTS.create,
      body: {
        input: {
          title: 'Danger create',
          prompt: 'Run later.',
          workspaceRoot: undefined,
          model: undefined,
          reasoningEffort: undefined,
          mode: undefined,
          enabled: undefined,
          schedule: {
            kind: 'interval',
            atTime: undefined,
            timeOfDay: undefined,
            everyMinutes: 60
          }
        }
      }
    },
    {
      path: SCHEDULE_INTERNAL_ENDPOINTS.update,
      body: {
        taskId: 'danger',
        patch: {
          prompt: 'Updated prompt.'
        }
      }
    },
    {
      path: SCHEDULE_INTERNAL_ENDPOINTS.delete,
      body: { taskId: 'danger' }
    },
    {
      path: SCHEDULE_INTERNAL_ENDPOINTS.run,
      body: { taskId: 'danger' }
    }
  ])
})

test('service allows safe task metadata updates without confirmation', async () => {
  const client = new FakeInternalClient({
    [SCHEDULE_INTERNAL_ENDPOINTS.update]: { ok: true, task: sampleTask({ id: 'safe', title: 'Renamed', enabled: false }) }
  })
  const service = new ScheduleService({ internalClient: client })

  await service.update({ task_id: 'safe', title: 'Renamed', enabled: false })

  assert.deepEqual(client.calls, [{
    path: SCHEDULE_INTERNAL_ENDPOINTS.update,
    body: {
      taskId: 'safe',
      patch: {
        title: 'Renamed',
        enabled: false
      }
    }
  }])
})

test('service fails closed without a configured schedule internal secret', async () => {
  let requestCount = 0
  const server = await listenFakeServer(async (_req, res) => {
    requestCount += 1
    writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
  })

  try {
    const service = new ScheduleService({ baseUrl: server.baseUrl, timeoutMs: 5_000 })
    await assert.rejects(
      () => service.list(),
      (error) => {
        assert.ok(error instanceof ScheduleWorkerError)
        assert.equal(error.code, 'unauthorized')
        assert.equal(error.retryable, false)
        assert.match(error.suggestion, /secret/i)
        return true
      }
    )
    assert.equal(requestCount, 0)
  } finally {
    await server.close()
  }
})

test('service rejects non-local internal HTTP configuration and endpoint bypasses', async () => {
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true })
    }
  }

  assert.throws(
    () => createScheduleInternalHttpClient({
      baseUrl: 'https://example.com:8788',
      secret: 'test-secret',
      fetch: fetchImpl
    }),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'internal_http_unavailable')
      assert.match(error.message, /loopback HTTP/)
      return true
    }
  )

  const client = createScheduleInternalHttpClient({
    baseUrl: 'http://127.0.0.1:8788',
    secret: 'test-secret',
    fetch: fetchImpl
  })

  await assert.rejects(
    () => client.postJson('http://attacker.invalid/schedule/internal/list', {}),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'internal_http_unavailable')
      assert.match(error.message, /endpoint path/)
      return true
    }
  )
  await assert.rejects(
    () => client.postJson('/not/schedule/internal/list', {}),
    (error) => {
      assert.ok(error instanceof ScheduleWorkerError)
      assert.equal(error.code, 'internal_http_unavailable')
      assert.match(error.message, /not allowed/)
      return true
    }
  )
  assert.equal(fetchCount, 0)
})

class FakeInternalClient implements ScheduleInternalHttpClient {
  readonly calls: Array<{ path: string; body: Record<string, unknown> }> = []

  constructor(private readonly responses: Record<string, Record<string, unknown>>) {}

  async postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ path, body })
    const response = this.responses[path]
    if (!response) throw new Error(`unexpected path ${path}`)
    return response
  }
}

function dryRunConfirmation(result: unknown): string {
  if (!isScheduleDryRunResult(result) || !result.confirmation?.value) {
    throw new Error('Expected dry-run result with confirmation value.')
  }
  return result.confirmation.value
}

function sampleTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task',
    title: 'Task',
    enabled: true,
    prompt: 'Do work.',
    workspaceRoot: '/tmp',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    schedule: {
      kind: 'interval',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: ''
    },
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    agentThreadIds: {},
    ...overrides
  }
}

async function listenFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error) => {
      writeJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text ? JSON.parse(text) : {}
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
