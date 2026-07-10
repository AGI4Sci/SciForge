import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeItem, AgentRuntimeThreadDetail } from '../../shared/agent-runtime-contract'
import {
  EvidenceDagUpdateQueue,
  completedTurnItems,
  isEvidenceDagAutoFeedEnabled,
  isEvidenceDagFeedEnabled,
  toEvidenceDagTraceItems
} from './evidence-dag-feed'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function queuePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-dag-queue-'))
  roots.push(root)
  return join(root, 'queue.json')
}

function committedSnapshot(threadId = 'sciforge:thread-1', watermark = '10') {
  return {
    threadId,
    version: 1,
    digest: `sha256:${watermark}`,
    inputWatermark: watermark,
    schemaVersion: '2',
    extractorVersion: 'extractor-2',
    verifierVersion: 'verifier-2',
    artifactDigests: ['sha256:artifact'],
    createdAt: '2026-07-10T00:00:00.000Z',
    status: 'committed'
  }
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

describe('Evidence DAG runtime feed', () => {
  it('accepts trace-free Artifact lifecycle work only through the durable queue', async () => {
    const storagePath = await queuePath()
    const fetchImpl = vi.fn(async () => ok({
      snapshot: { ...committedSnapshot('sciforge:thread-1', '41'), version: 2 }
    })) as typeof fetch
    const queue = new EvidenceDagUpdateQueue({
      storagePath,
      fetchImpl,
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://evidence.test',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'evidence-key'
      }
    })
    await queue.start()

    const queued = await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', items: [], targetWatermark: '41',
      reason: 'artifact_changed', priority: 'background'
    })
    await expect(queue.waitForJob(queued.jobId, 2_000)).resolves.toMatchObject({ version: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', items: [], targetWatermark: '41',
      reason: 'manual_immediate', priority: 'immediate'
    })).rejects.toThrow('no visible trace items')
  })

  it('maps raw and neutral Runtime records to the same canonical visible trace', () => {
    const rawItems = [
      { id: 'u1', kind: 'user_message', status: 'completed', text: 'question' },
      {
        id: 'a1', kind: 'assistant_text', status: 'completed',
        text: 'Study DOI 10.1234/example has a [supplement](docs/supp.pdf).'
      },
      {
        id: 'raw-call', kind: 'tool_call', status: 'completed', callId: 'call-1',
        toolName: 'read', arguments: { path: 'data/input.csv' }
      },
      {
        id: 'raw-result', kind: 'tool_result', status: 'completed', callId: 'call-1',
        toolName: 'read', isError: false,
        output: { relative_path: 'data/input.csv', content: 'x,y' }
      },
      {
        id: 'raw-error', kind: 'tool_result', status: 'completed', callId: 'call-2',
        toolName: 'read', isError: true, output: { relative_path: 'missing.csv' }
      }
    ]
    const neutralItems: AgentRuntimeItem[] = [
      { id: 'u1', kind: 'user_message', status: 'completed', text: 'question' },
      {
        id: 'a1', kind: 'assistant_message', status: 'completed',
        text: 'Study DOI 10.1234/example has a [supplement](docs/supp.pdf).'
      },
      {
        id: 'tool_call-1', kind: 'tool', status: 'running', detail: '{"path":"data/input.csv"}',
        meta: { sourceItemId: 'raw-call', callId: 'call-1', toolName: 'read' }
      },
      {
        id: 'tool_call-1', kind: 'tool', status: 'completed',
        detail: '{\n  "relative_path": "data/input.csv",\n  "content": "x,y"\n}',
        meta: { sourceItemId: 'raw-result', callId: 'call-1', toolName: 'read' }
      },
      {
        id: 'tool_call-2', kind: 'tool', status: 'error', detail: '{"relative_path":"missing.csv"}',
        meta: { sourceItemId: 'raw-error', callId: 'call-2', toolName: 'read' }
      }
    ]

    const expected = [
      { id: 'u1', type: 'message', role: 'user', content: 'question' },
      {
        id: 'a1', type: 'message', role: 'assistant',
        content: 'Study DOI 10.1234/example has a [supplement](docs/supp.pdf).',
        source_refs: [
          { kind: 'doi', value: '10.1234/example' },
          { kind: 'file', value: 'docs/supp.pdf' }
        ]
      },
      {
        id: 'tool_call-1', type: 'tool_result', tool_name: 'read', call_id: 'call-1',
        source_item_id: 'raw-result', content: '{"content":"x,y","relative_path":"data/input.csv"}',
        source_refs: [{ kind: 'file', value: 'data/input.csv' }]
      }
    ]
    expect(toEvidenceDagTraceItems(rawItems)).toEqual(expected)
    expect(toEvidenceDagTraceItems(neutralItems)).toEqual(expected)
  })

  it('surfaces an explicit tool file reference even when the result text omits it', () => {
    expect(toEvidenceDagTraceItems([{
      id: 'write-1', kind: 'tool', status: 'success', detail: 'saved',
      meta: { toolName: 'write', filePath: 'results/output.json' }
    } satisfies AgentRuntimeItem])).toEqual([{
      id: 'write-1', type: 'tool_result', tool_name: 'write',
      content: 'saved\nVISIBLE_SOURCE_REFERENCES [{"kind":"file","value":"results/output.json"}]',
      source_refs: [{ kind: 'file', value: 'results/output.json' }]
    }])
  })

  it('selects completed turn items from nested or flat runtime records', () => {
    const detail = {
      id: 'thread', runtimeId: 'claude', title: 'Thread', updatedAt: '2026-01-01T00:00:00.000Z', latestSeq: 1,
      turns: [{ id: 'turn-1', threadId: 'thread', status: 'completed', items: [{ id: 'nested', turnId: 'turn-1', kind: 'assistant_message', text: 'nested' }] }],
      items: [{ id: 'flat', turnId: 'turn-1', kind: 'assistant_message', text: 'flat' }]
    } satisfies AgentRuntimeThreadDetail
    expect(completedTurnItems(detail, 'turn-1').map((item) => item.id)).toEqual(['nested'])
    expect(completedTurnItems({ ...detail, turns: [] }, 'turn-1').map((item) => item.id)).toEqual(['flat'])
  })

  it('enables automatic durable feed by default and permits an explicit pause', () => {
    expect(isEvidenceDagFeedEnabled({ SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret' })).toBe(true)
    expect(isEvidenceDagAutoFeedEnabled({})).toBe(true)
    expect(isEvidenceDagAutoFeedEnabled({ SCIFORGE_EVIDENCE_DAG_AUTO_FEED: 'off' })).toBe(false)
  })

  it('persists before submitting the canonical /updates command', async () => {
    const storagePath = await queuePath()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const persisted = JSON.parse(await readFile(storagePath, 'utf8')) as { jobs: Array<{ status: string }> }
      expect(persisted.jobs[0]?.status).toBe('running')
      expect(String(input)).toBe('http://127.0.0.1:3897/updates')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        threadId: 'sciforge:thread-1',
        targetWatermark: '10',
        reason: 'turn_committed',
        priority: 'background',
        workspaceRoot: '/workspace/molclaw'
      })
      return ok({ snapshot: committedSnapshot() })
    })
    const queue = new EvidenceDagUpdateQueue({
      storagePath,
      env: { SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret' },
      fetchImpl
    })
    await queue.start()
    const enqueued = await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '10', reason: 'turn_committed', priority: 'background',
      items: [{ id: 'a1', kind: 'assistant_message', text: 'answer' }],
      projectContext: { projectKey: '/workspace/molclaw', workspaceRoot: '/workspace/molclaw', projectRoot: '/workspace/molclaw' }
    })
    expect(enqueued.state).toBe('queued')
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
  })

  it('coalesces a thread and never lowers a numeric desired watermark', async () => {
    vi.useFakeTimers()
    const queue = new EvidenceDagUpdateQueue({
      storagePath: await queuePath(),
      env: { SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret' },
      fetchImpl: vi.fn(async () => ok({ snapshot: committedSnapshot() }))
    })
    const newer = await queue.enqueue({ runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '694', reason: 'turn_committed', items: [{ id: 'new', kind: 'assistant_message', text: 'new' }] })
    const older = await queue.enqueue({ runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '690', reason: 'turn_committed', items: [{ id: 'old', kind: 'assistant_message', text: 'old' }] })
    expect(older.coalesced).toBe(true)
    expect(older.jobId).toBe(newer.jobId)
    expect(older.desiredWatermark).toBe('694')
  })

  it('uses the same Project /updates queue after an Evidence snapshot commit', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:3897') && url.includes('/updates/status')) {
        return ok({ snapshot: committedSnapshot('sciforge:thread-2', '8') })
      }
      if (url.startsWith('http://127.0.0.1:3898') && url.includes('/updates/status')) {
        return ok({
          status: 'fresh',
          pending: 0,
          committedSnapshot: {
            evidenceVector: [
              { threadId: 'sciforge:thread-1', digest: 'sha256:10' },
              { threadId: 'sciforge:thread-2', digest: 'sha256:8' }
            ]
          }
        })
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ url, body })
      return url.startsWith('http://127.0.0.1:3897')
        ? ok({ snapshot: committedSnapshot() })
        : ok({ update: { id: 'project-job-1', status: 'queued' } })
    })
    const queue = new EvidenceDagUpdateQueue({
      storagePath: await queuePath(),
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret',
        SCIFORGE_PROJECT_DAG_SERVICE_URL: 'http://127.0.0.1:3898', SCIFORGE_PROJECT_DAG_API_KEY: 'project-secret'
      },
      fetchImpl
    })
    await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '10', reason: 'turn_committed',
      items: [{ id: 'a1', kind: 'assistant_message', text: 'answer' }],
      projectContext: {
        projectKey: '/workspace/molclaw', workspaceRoot: '/workspace/molclaw', projectRoot: '/workspace/molclaw',
        includedSessions: ['sciforge:thread-1', 'sciforge:thread-2']
      }
    })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject({
      url: 'http://127.0.0.1:3898/updates',
      body: {
        reason: 'evidence_snapshot_committed',
        capturedScope: { includedSessions: ['sciforge:thread-1', 'sciforge:thread-2'] },
        evidenceVector: [
          { threadId: 'sciforge:thread-1', digest: 'sha256:10' },
          { threadId: 'sciforge:thread-2', digest: 'sha256:8' }
        ]
      }
    })
  })

  it('commits every same-priority Evidence job before coordinating a multi-session Project update', async () => {
    const order: string[] = []
    const snapshots = new Map<string, ReturnType<typeof committedSnapshot>>()
    const expectedVector = [
      { threadId: 'sciforge:thread-1', digest: 'sha256:10' },
      { threadId: 'sciforge:thread-2', digest: 'sha256:8' }
    ]
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:3897/updates') {
        const body = JSON.parse(String(init?.body)) as { threadId: string; targetWatermark: string }
        order.push(`evidence:${body.threadId}`)
        const snapshot = committedSnapshot(body.threadId, body.targetWatermark)
        snapshots.set(body.threadId, snapshot)
        return ok({ snapshot })
      }
      if (url.startsWith('http://127.0.0.1:3897/updates/status')) {
        const threadId = new URL(url).searchParams.get('threadId') ?? ''
        const snapshot = snapshots.get(threadId)
        if (!snapshot) throw new Error(`Evidence snapshot was requested before commit: ${threadId}`)
        return ok({ snapshot })
      }
      if (url === 'http://127.0.0.1:3898/updates') {
        order.push('project')
        return ok({ id: 'project-job-1', status: 'queued' })
      }
      if (url.startsWith('http://127.0.0.1:3898/updates/status')) {
        return ok({ state: 'fresh', pending: 0, committedSnapshot: { evidenceVector: expectedVector } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const queue = new EvidenceDagUpdateQueue({
      storagePath: await queuePath(),
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret',
        SCIFORGE_PROJECT_DAG_SERVICE_URL: 'http://127.0.0.1:3898', SCIFORGE_PROJECT_DAG_API_KEY: 'project-secret'
      },
      fetchImpl
    })
    const first = await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '10', reason: 'manual_immediate', priority: 'immediate',
      items: [{ id: 'a1', kind: 'assistant_message', text: 'answer one' }],
      projectContext: {
        projectKey: 'project-1', includedSessions: ['sciforge:thread-1', 'sciforge:thread-2'],
        updateReason: 'manual_immediate'
      }
    })
    const second = await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-2', targetWatermark: '8', reason: 'manual_immediate', priority: 'immediate',
      items: [{ id: 'a2', kind: 'assistant_message', text: 'answer two' }]
    })

    await expect(Promise.all([
      queue.waitForJob(first.jobId, 5_000),
      queue.waitForJob(second.jobId, 5_000)
    ])).resolves.toHaveLength(2)
    expect(order).toEqual(['evidence:sciforge:thread-1', 'evidence:sciforge:thread-2', 'project'])
  })

  it('waits for Project pending and running states to reach the exact committed vector', async () => {
    let statusReads = 0
    const expectedVector = [{ threadId: 'sciforge:thread-1', digest: 'sha256:10' }]
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:3897')) return ok({ snapshot: committedSnapshot() })
      if (url.includes('/updates/status')) {
        statusReads += 1
        if (statusReads === 1) return ok({ status: 'queued', pending: 1 })
        if (statusReads === 2) return ok({ status: 'running', running: true, pending: 0 })
        return ok({ status: 'fresh', pending: 0, running: false, committedSnapshot: { evidenceVector: expectedVector } })
      }
      return ok({ update: { id: 'project-job-1', status: 'queued' } })
    })
    const queue = new EvidenceDagUpdateQueue({
      storagePath: await queuePath(),
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret',
        SCIFORGE_PROJECT_DAG_SERVICE_URL: 'http://127.0.0.1:3898', SCIFORGE_PROJECT_DAG_API_KEY: 'project-secret'
      },
      fetchImpl
    })
    const job = await queue.enqueue({
      runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '10', reason: 'manual_immediate',
      items: [{ id: 'a1', kind: 'assistant_message', text: 'answer' }],
      projectContext: { projectKey: 'project-1', includedSessions: ['sciforge:thread-1'] }
    })
    await expect(queue.waitForJob(job.jobId, 5_000)).resolves.toMatchObject({ digest: 'sha256:10' })
    expect(statusReads).toBe(3)
  })

  it('backs off failures and recovers interrupted running jobs after restart', async () => {
    const storagePath = await queuePath()
    const failing = new EvidenceDagUpdateQueue({
      storagePath,
      env: { SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret' },
      fetchImpl: vi.fn(async () => { throw new Error('router unavailable') }),
      retryBaseMs: 60_000
    })
    await failing.enqueue({ runtimeId: 'sciforge', threadId: 'thread-1', targetWatermark: '10', reason: 'turn_committed', items: [{ id: 'a1', kind: 'assistant_message', text: 'answer' }] })
    await vi.waitFor(async () => expect((await failing.status('sciforge', 'thread-1')).state).toBe('failed'))
    const persisted = JSON.parse(await readFile(storagePath, 'utf8')) as { jobs: Array<Record<string, unknown>> }
    persisted.jobs[0] = { ...persisted.jobs[0], status: 'running', nextAttemptAt: undefined }
    await writeFile(storagePath, JSON.stringify(persisted), 'utf8')

    const recoveredFetch = vi.fn(async () => ok({ snapshot: committedSnapshot() }))
    const recovered = new EvidenceDagUpdateQueue({
      storagePath,
      env: { SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897', SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret' },
      fetchImpl: recoveredFetch
    })
    await recovered.start()
    await vi.waitFor(() => expect(recoveredFetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect((await recovered.status('sciforge', 'thread-1')).state).toBe('fresh'))
  })

  it('preserves a corrupt queue file and exposes degraded state', async () => {
    const storagePath = await queuePath()
    await writeFile(storagePath, '{not-json', 'utf8')
    const queue = new EvidenceDagUpdateQueue({ storagePath })
    await queue.start()
    await expect(queue.status('sciforge', 'thread-1')).resolves.toMatchObject({ state: 'degraded', lastError: expect.stringContaining('corrupt') })
    expect((await readdir(join(storagePath, '..'))).some((name) => name.includes('.corrupt-'))).toBe(true)
  })
})
