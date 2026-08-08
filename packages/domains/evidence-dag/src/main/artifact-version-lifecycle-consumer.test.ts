import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type {
  ArtifactVersionEventListPortV1,
  ArtifactVersionLifecycleEventV1,
  ArtifactVersionReadPortV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { createEvidenceArtifactVersionClient } from './artifact-version-client.js'
import {
  EvidenceArtifactVersionLifecycleConsumer,
  type EvidenceArtifactLifecycleThread,
  type EvidenceArtifactLifecycleThreadKey
} from './artifact-version-lifecycle-consumer.js'
import type { EvidenceDagQueueInput } from './queue.js'

const workspaceRoot = '/workspace/lifecycle'
const occurredAt = '2026-08-06T08:00:00.000Z'
const accessPolicy = {
  visibility: 'workspace' as const,
  principals: [],
  allowExport: true
}

test('durably drains every lifecycle page and enqueues only affected threads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-artifact-lifecycle-'))
  const storagePath = join(root, 'lifecycle.json')
  const alpha = artifactRef('alpha', 'a')
  const beta = artifactRef('beta', 'b')
  const events = Array.from({ length: 5 }, (_, index) => lifecycleEvent(index + 1, alpha))
  const calls: number[] = []
  const enqueued: EvidenceDagQueueInput[] = []
  const client = createEvidenceArtifactVersionClient(() => ({
    commit: async () => { throw new Error('Explicit refs must not commit.') }
  }), lifecycleReadFactory)
  const threads = [thread('alpha-thread', alpha), thread('beta-thread', beta)]
  const consumer = new EvidenceArtifactVersionLifecycleConsumer({
    storagePath,
    eventListPort: pagedEvents(events, calls),
    discoverThreads: async () => threads,
    prepareThread: prepareKnownThread(client, threads),
    identities: client.identities,
    withLifecycle: client.withLifecycle,
    enqueue: async (input) => {
      enqueued.push(input)
      return { jobId: `job-${enqueued.length}`, coalesced: false, itemCount: input.trace.length }
    },
    pageSize: 2,
    pollIntervalMs: 60_000,
    now: () => new Date(occurredAt)
  })

  await consumer.start(true)
  await consumer.pollNow()
  await consumer.close()

  assert.deepEqual(calls, [0, 2, 4])
  assert.equal(enqueued.length, 3)
  assert.ok(enqueued.every((input) => input.threadId === 'alpha-thread'))
  assert.ok(enqueued.every((input) => input.reason === 'artifact_version_lifecycle'))
  assert.deepEqual(enqueued.map((input) => input.targetWatermark), [
    '7:artifact-lifecycle:2',
    '7:artifact-lifecycle:4',
    '7:artifact-lifecycle:5'
  ])
  assert.equal(new Set(enqueued.map((input) => input.idempotencyKey)).size, 3)
  const projections = enqueued.map((input) => input.trace.find((item) =>
    'evidenceArtifactVersions' in item
  )?.evidenceArtifactVersions as { lifecycleEvents: unknown[]; lifecyclePending: boolean })
  assert.deepEqual(projections.map((value) => value.lifecycleEvents.length), [2, 2, 1])
  assert.deepEqual(projections.map((value) => value.lifecyclePending), [true, true, false])

  const state = JSON.parse(await readFile(storagePath, 'utf8')) as {
    workspaces: Array<{ cursor: number }>
    receipts: unknown[]
  }
  assert.equal(state.workspaces[0]?.cursor, 5)
  assert.equal(state.receipts.length, 3)

  const replayCalls: number[] = []
  let replayEnqueues = 0
  const restarted = new EvidenceArtifactVersionLifecycleConsumer({
    storagePath,
    eventListPort: pagedEvents(events, replayCalls),
    discoverThreads: async () => threads,
    prepareThread: prepareKnownThread(client, threads),
    identities: client.identities,
    withLifecycle: client.withLifecycle,
    enqueue: async () => {
      replayEnqueues += 1
      return { jobId: 'unexpected', coalesced: false, itemCount: 1 }
    },
    pageSize: 2,
    pollIntervalMs: 60_000,
    now: () => new Date(occurredAt)
  })
  await restarted.start(true)
  await restarted.pollNow()
  await restarted.close()

  assert.deepEqual(replayCalls, [5])
  assert.equal(replayEnqueues, 0)
})

test('does not advance a cursor while a durably tracked affected thread is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-artifact-lifecycle-blocked-'))
  const storagePath = join(root, 'lifecycle.json')
  const alpha = artifactRef('alpha', 'a')
  const client = createEvidenceArtifactVersionClient(() => ({
    commit: async () => { throw new Error('Explicit refs must not commit.') }
  }), lifecycleReadFactory)
  const tracked = thread('alpha-thread', alpha)
  const logs: string[] = []
  const first = new EvidenceArtifactVersionLifecycleConsumer({
    storagePath,
    eventListPort: pagedEvents([], []),
    discoverThreads: async () => [],
    prepareThread: prepareKnownThread(client, [tracked]),
    identities: client.identities,
    withLifecycle: client.withLifecycle,
    enqueue: async () => ({ jobId: 'unused', coalesced: false, itemCount: 1 }),
    now: () => new Date(occurredAt)
  })
  await first.start(false)
  await first.rememberThread({
    ...tracked,
    trace: await client.pinTrace(tracked.trace, pinContext(tracked))
  })
  await first.close()

  const blocked = new EvidenceArtifactVersionLifecycleConsumer({
    storagePath,
    eventListPort: pagedEvents([lifecycleEvent(1, alpha)], []),
    discoverThreads: async () => [],
    prepareThread: prepareKnownThread(client, [tracked]),
    identities: client.identities,
    withLifecycle: client.withLifecycle,
    enqueue: async () => ({ jobId: 'must-not-enqueue', coalesced: false, itemCount: 1 }),
    now: () => new Date(occurredAt),
    log: (entry) => logs.push(entry.message)
  })
  await blocked.start(true)
  await blocked.pollNow()
  await blocked.close()

  const state = JSON.parse(await readFile(storagePath, 'utf8')) as {
    workspaces: Array<{ cursor: number }>
    receipts: unknown[]
  }
  assert.equal(state.workspaces[0]?.cursor, 0)
  assert.equal(state.receipts.length, 0)
  assert.ok(logs.some((message) => message.includes('lifecycle pull failed')))
})

test('activation actively drains an exact full page and clears backlog state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-artifact-lifecycle-active-'))
  const alpha = artifactRef('alpha', 'a')
  const events = [lifecycleEvent(1, alpha), lifecycleEvent(2, alpha)]
  const calls: number[] = []
  const enqueued: EvidenceDagQueueInput[] = []
  const client = createEvidenceArtifactVersionClient(() => ({
    commit: async () => { throw new Error('Explicit refs must not commit.') }
  }), lifecycleReadFactory)
  const activeThread = thread('alpha-thread', alpha)
  const consumer = new EvidenceArtifactVersionLifecycleConsumer({
    storagePath: join(root, 'lifecycle.json'),
    eventListPort: pagedEvents(events, calls),
    discoverThreads: async () => [activeThread],
    prepareThread: prepareKnownThread(client, [activeThread]),
    identities: client.identities,
    withLifecycle: client.withLifecycle,
    enqueue: async (input) => {
      enqueued.push(input)
      return { jobId: 'job-active', coalesced: false, itemCount: input.trace.length }
    },
    pageSize: 2,
    pollIntervalMs: 60_000,
    now: () => new Date(occurredAt)
  })

  await consumer.start(true)
  await waitFor(() => enqueued.length === 1)
  await consumer.close()

  assert.deepEqual(calls, [0, 2])
  const projection = enqueued[0]?.trace.find((item) =>
    'evidenceArtifactVersions' in item
  )?.evidenceArtifactVersions as { lifecyclePending: boolean }
  assert.equal(projection.lifecyclePending, false)
})

function artifactRef(name: string, digestPrefix: string): ArtifactVersionRefV1 {
  const bytes = Buffer.from(`${name}:${digestPrefix}`, 'utf8')
  return {
    artifactId: `artifact:${name}`,
    versionId: `artifact-version:${name}-1`,
    contentDigest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'text/csv',
    availability: 'available',
    retention: 'reference',
    accessPolicy
  }
}

const lifecycleReadFactory = (): ArtifactVersionReadPortV1 => ({
  read: async ({ versionId }) => {
    const match = /^artifact-version:(alpha|beta)-1$/u.exec(versionId)
    if (!match) {
      return {
        ok: false,
        issue: { code: 'version-not-found', message: `Unknown lifecycle version ${versionId}.` }
      }
    }
    const name = match[1]!
    const digestPrefix = name === 'alpha' ? 'a' : 'b'
    const canonicalRef = artifactRef(name, digestPrefix)
    const bytes = Buffer.from(`${name}:${digestPrefix}`, 'utf8')
    return {
      ok: true,
      value: {
        artifact: {
          artifactId: canonicalRef.artifactId,
          kind: 'dataset',
          createdAt: occurredAt,
          updatedAt: occurredAt,
          currentVersionId: canonicalRef.versionId,
          versionCount: 1
        },
        version: {
          schemaVersion: 1,
          versionId: canonicalRef.versionId,
          artifactId: canonicalRef.artifactId,
          sequence: 1,
          transactionId: `artifact-commit:${name}`,
          createdAt: occurredAt,
          intent: 'observe',
          storage: {
            mode: 'reference',
            locator: `workspace:${name}.csv`,
            contentDigest: canonicalRef.contentDigest,
            byteLength: canonicalRef.byteLength,
            mediaType: canonicalRef.mediaType,
            availability: canonicalRef.availability
          },
          dependencies: [],
          accessPolicy: canonicalRef.accessPolicy,
          metadata: {}
        },
        ref: canonicalRef,
        dataBase64: bytes.toString('base64')
      }
    }
  }
})

function lifecycleEvent(
  sequence: number,
  ref: ArtifactVersionRefV1
): ArtifactVersionLifecycleEventV1 {
  return {
    schemaVersion: 1,
    eventId: `artifact-event:${sequence}`,
    sequence,
    type: sequence % 2 === 0 ? 'artifact-moved' : 'artifact-content-changed',
    artifactId: ref.artifactId,
    versionId: ref.versionId,
    createdAt: occurredAt,
    detail: sequence % 2 === 0
      ? { locator: `workspace:data-${sequence}.csv` }
      : { contentDigest: String(sequence).repeat(64).slice(0, 64) }
  }
}

function thread(
  threadId: string,
  ref: ArtifactVersionRefV1
): EvidenceArtifactLifecycleThread {
  return {
    runtimeId: 'codex',
    threadId,
    workspaceRoot,
    targetWatermark: '7',
    trace: [{ id: `${threadId}:artifact`, artifactVersionRef: ref }]
  }
}

function pinContext(value: EvidenceArtifactLifecycleThread) {
  return {
    runtimeId: value.runtimeId,
    threadId: value.threadId,
    operationId: `lifecycle:${value.targetWatermark}`,
    workspaceRoot: value.workspaceRoot,
    occurredAt
  }
}

function prepareKnownThread(
  client: ReturnType<typeof createEvidenceArtifactVersionClient>,
  threads: readonly EvidenceArtifactLifecycleThread[]
) {
  return async (key: EvidenceArtifactLifecycleThreadKey): Promise<EvidenceArtifactLifecycleThread> => {
    const value = threads.find((thread) =>
      thread.runtimeId === key.runtimeId && thread.threadId === key.threadId
    )
    if (!value) throw new Error(`Unknown test thread: ${key.runtimeId}:${key.threadId}`)
    return {
      ...value,
      trace: await client.pinTrace(value.trace, pinContext(value))
    }
  }
}

function pagedEvents(
  events: readonly ArtifactVersionLifecycleEventV1[],
  calls: number[]
): (workspaceRoot: string) => ArtifactVersionEventListPortV1 {
  return (scope) => ({
    listEvents: async (input) => {
      assert.equal(scope, workspaceRoot)
      const after = input.afterSequence ?? 0
      const limit = input.limit ?? 250
      calls.push(after)
      const page = events.filter((event) => event.sequence > after).slice(0, limit)
      return {
        ok: true,
        value: {
          events: page,
          lastSequence: page.at(-1)?.sequence ?? after
        }
      }
    }
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
