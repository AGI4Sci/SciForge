import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  evidenceDagTypedErrorSchema,
  type EvidenceDagCommittedSnapshot
} from '../contract.js'
import { EvidenceDagServiceError } from './client.js'
import { EvidenceDagQueue } from './queue.js'

const digest = `sha256:${'a'.repeat(64)}`
const snapshot: EvidenceDagCommittedSnapshot = {
  threadId: 'codex:thread-1',
  version: 1,
  digest,
  inputWatermark: '2',
  schemaVersion: '1',
  extractorVersion: '1',
  verifierVersion: '1',
  artifactDigests: [],
  createdAt: '2026-07-26T06:00:02.000Z'
}

test('a newer success makes an older terminal failure historical only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-queue-'))
  const storagePath = join(root, 'queue.json')
  let fail = true
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => {
      if (fail) {
        throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
          code: 'model_output_incomplete',
          message: 'Incomplete.',
          retryable: false,
          occurredAt: '2026-07-26T06:00:01.000Z'
        }))
      }
      return snapshot
    }
  })
  await queue.start(true)
  await queue.enqueue(queueInput('1'))
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')
  fail = false
  await queue.enqueue(queueInput('2'))
  await waitFor(async () => await queue.pending('codex', 'thread-1') === null)
  assert.equal(await queue.pending('codex', 'thread-1'), null)
  assert.equal((await queue.committed('codex', 'thread-1'))?.digest, digest)
  await queue.close()
})

test('restart preserves terminal timestamps and directly discards old project-phase jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-migration-'))
  const storagePath = join(root, 'queue.json')
  const failedAt = '2026-07-21T01:02:03.000Z'
  await writeFile(storagePath, JSON.stringify({
    version: 2,
    jobs: [
      {
        id: 'project-job',
        runtimeId: 'codex',
        threadId: 'thread-1',
        engineThreadId: 'codex:thread-1',
        targetWatermark: '1',
        reason: 'recovery',
        priority: 'normal',
        trace: [{ id: 'artifact-project' }],
        phase: 'project',
        status: 'failed',
        attempts: 5,
        createdAt: failedAt,
        updatedAt: failedAt,
        lastError: 'obsolete project timeout'
      },
      {
        id: 'evidence-job',
        runtimeId: 'codex',
        threadId: 'thread-1',
        engineThreadId: 'codex:thread-1',
        targetWatermark: '2',
        reason: 'recovery',
        priority: 'normal',
        trace: [{ id: 'artifact-evidence' }],
        workspaceRoot: '/workspace',
        phase: 'evidence',
        status: 'failed',
        attempts: 3,
        createdAt: failedAt,
        updatedAt: failedAt,
        lastError: 'evidence failure'
      }
    ]
  }), 'utf8')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)
  const pending = await queue.pending('codex', 'thread-1')
  assert.equal(pending?.state, 'failed')
  assert.equal(pending?.updatedAt, failedAt)
  const migrated = JSON.parse(await readFile(storagePath, 'utf8')) as {
    version: number
    jobs: Array<{ id: string; updatedAt: string }>
  }
  assert.equal(migrated.version, 1)
  assert.deepEqual(migrated.jobs.map(({ id }) => id), ['evidence-job'])
  assert.equal(migrated.jobs[0]?.updatedAt, failedAt)
  await queue.close()
})

test('pauses only background jobs while normal, high, and immediate work still runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-foreground-'))
  const submitted: string[] = []
  let canRunBackground = false
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    canRunBackground: () => canRunBackground,
    submit: async (input) => {
      submitted.push(input.priority)
      return {
        ...snapshot,
        threadId: input.engineThreadId,
        inputWatermark: input.targetWatermark,
        version: submitted.length
      }
    }
  })
  await queue.start(false)
  await queue.enqueue(queueInput('1', 'background', 'background-thread'))
  await queue.enqueue(queueInput('2', 'normal', 'normal-thread'))
  await queue.enqueue(queueInput('3', 'high', 'high-thread'))
  await queue.enqueue(queueInput('4', 'immediate', 'immediate-thread'))
  await queue.setEnabled(true)

  await waitFor(async () => submitted.length === 3)
  assert.deepEqual(submitted, ['immediate', 'high', 'normal'])
  assert.equal(
    (await queue.pending('codex', 'background-thread'))?.state,
    'queued'
  )

  canRunBackground = true
  await waitFor(async () => submitted.length === 4)
  assert.deepEqual(submitted, ['immediate', 'high', 'normal', 'background'])
  await queue.close()
})

test('persists real batch activity while an update remains running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-activity-'))
  let now = new Date('2026-07-26T06:00:00.000Z')
  let reportActivity: ((progress: {
    completedBatches: number
    totalBatches: number
    snapshot: EvidenceDagCommittedSnapshot
  }) => Promise<void>) | undefined
  let release: ((value: EvidenceDagCommittedSnapshot) => void) | undefined
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    now: () => now,
    submit: async (_input, activity) => {
      reportActivity = activity
      return new Promise<EvidenceDagCommittedSnapshot>((resolve) => {
        release = resolve
      })
    }
  })
  await queue.start(true)
  await queue.enqueue(queueInput('1'))
  await waitFor(async () => Boolean(reportActivity))
  assert.equal(
    (await queue.pending('codex', 'thread-1'))?.updatedAt,
    '2026-07-26T06:00:00.000Z'
  )

  now = new Date('2026-07-26T06:01:00.000Z')
  await reportActivity!({
    completedBatches: 1,
    totalBatches: 2,
    snapshot
  })
  const pending = await queue.pending('codex', 'thread-1')
  assert.equal(pending?.state, 'running')
  assert.equal(pending?.updatedAt, '2026-07-26T06:01:00.000Z')
  assert.equal((await queue.committed('codex', 'thread-1'))?.digest, snapshot.digest)
  const stored = JSON.parse(await readFile(join(root, 'queue.json'), 'utf8')) as {
    jobs: Array<{ updatedAt: string }>
  }
  assert.equal(stored.jobs[0]?.updatedAt, '2026-07-26T06:01:00.000Z')

  release!(snapshot)
  await waitFor(async () => await queue.pending('codex', 'thread-1') === null)
  await queue.close()
})

test('restart resumes after the last durably committed batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-resume-'))
  const storagePath = join(root, 'queue.json')
  await writeFile(storagePath, JSON.stringify({
    version: 1,
    jobs: [{
      ...queueInput('2'),
      id: 'job-resume',
      status: 'running',
      attempt: 1,
      createdAt: '2026-07-26T06:00:00.000Z',
      updatedAt: '2026-07-26T06:01:00.000Z',
      completedBatches: 1,
      totalBatches: 2,
      snapshot
    }]
  }), 'utf8')
  let resumedAt: number | undefined
  let resumedReason: string | undefined
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async (input, reportActivity) => {
      resumedAt = input.resumeAfterBatch
      resumedReason = input.reason
      await reportActivity({
        completedBatches: 2,
        totalBatches: 2,
        snapshot: { ...snapshot, version: 2, inputWatermark: '2' }
      })
      return { ...snapshot, version: 2, inputWatermark: '2' }
    }
  })

  await queue.start(true)
  await waitFor(async () => await queue.pending('codex', 'thread-1') === null)
  assert.equal(resumedAt, 1)
  assert.equal(resumedReason, 'turn_committed')
  assert.equal((await queue.committed('codex', 'thread-1'))?.version, 2)
  await queue.close()
})

test('retry budget counts only consecutive failures without committed progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-progress-budget-'))
  const storagePath = join(root, 'queue.json')
  let submissions = 0
  const retryable = () => new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
    code: 'upstream_timeout',
    message: 'Timed out.',
    retryable: true,
    occurredAt: '2026-07-26T06:00:00.000Z'
  }))
  const queue = new EvidenceDagQueue({
    storagePath,
    maxAttempts: 2,
    retryBaseMs: 1,
    submit: async (_input, reportActivity) => {
      submissions += 1
      if (submissions === 2) {
        await reportActivity({
          completedBatches: 1,
          totalBatches: 2,
          snapshot
        })
      }
      throw retryable()
    }
  })

  await queue.start(true)
  await queue.enqueue(queueInput('2'))
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  const pending = await queue.pending('codex', 'thread-1')
  assert.equal(submissions, 3)
  assert.equal(pending?.attempt, 3)
  await queue.close()
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ consecutiveNoProgressFailures: number }>
  }
  assert.equal(stored.jobs[0]?.consecutiveNoProgressFailures, 2)
})

test('legacy jobs default the no-progress streak independently from lifetime attempts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-streak-migration-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-07-26T06:00:00.000Z'
  await writeFile(storagePath, JSON.stringify({
    version: 1,
    jobs: [{
      ...queueInput('2'),
      id: 'legacy-job',
      status: 'retrying',
      attempt: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      error: {
        code: 'upstream_timeout',
        message: 'Timed out.',
        retryable: true,
        occurredAt: timestamp
      }
    }]
  }), 'utf8')
  const queue = new EvidenceDagQueue({
    storagePath,
    maxAttempts: 2,
    retryBaseMs: 60_000,
    now: () => new Date(timestamp),
    submit: async () => {
      throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
        code: 'upstream_timeout',
        message: 'Timed out again.',
        retryable: true,
        occurredAt: timestamp
      }))
    }
  })

  await queue.start(false)
  const migrated = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ consecutiveNoProgressFailures: number }>
  }
  assert.equal(migrated.jobs[0]?.consecutiveNoProgressFailures, 0)
  await queue.setEnabled(true)
  await waitFor(async () => {
    const pending = await queue.pending('codex', 'thread-1')
    return pending?.attempt === 6 && pending.state === 'retrying'
  })
  const pending = await queue.pending('codex', 'thread-1')
  assert.equal(pending?.state, 'retrying')
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ attempt: number; consecutiveNoProgressFailures: number }>
  }
  assert.equal(stored.jobs[0]?.attempt, 6)
  assert.equal(stored.jobs[0]?.consecutiveNoProgressFailures, 1)
  await queue.close()
})

test('manual retry revives one failed lane and preserves only an identical batch cursor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-failed-resume-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-07-26T06:00:00.000Z'
  const trace = Array.from({ length: 204 }, (_, index) => ({
    id: `artifact-${index}`
  }))
  await writeFile(storagePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: 'failed-job',
      runtimeId: 'codex',
      threadId: 'thread-1',
      engineThreadId: 'codex:thread-1',
      targetWatermark: '594',
      reason: 'manual_immediate',
      priority: 'immediate',
      trace,
      workspaceRoot: '/workspace',
      status: 'failed',
      attempt: 5,
      consecutiveNoProgressFailures: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedBatches: 13,
      totalBatches: 21,
      snapshot,
      error: {
        code: 'upstream_timeout',
        message: 'Timed out.',
        retryable: true,
        occurredAt: timestamp
      }
    }]
  }), 'utf8')
  const resumes: Array<number | undefined> = []
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async (input) => {
      resumes.push(input.resumeAfterBatch)
      throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
        code: 'internal_error',
        message: 'Stop after observing the resume cursor.',
        retryable: false,
        occurredAt: timestamp
      }))
    }
  })
  await queue.start(false)

  const identical = await queue.enqueue({
    ...queueInput('594', 'immediate'),
    reason: 'manual_immediate',
    trace
  })
  assert.deepEqual(identical, {
    jobId: 'failed-job',
    coalesced: true,
    itemCount: 204
  })
  let stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{
      completedBatches?: number
      totalBatches?: number
      consecutiveNoProgressFailures: number
    }>
  }
  assert.equal(stored.jobs[0]?.completedBatches, 13)
  assert.equal(stored.jobs[0]?.totalBatches, 21)
  assert.equal(stored.jobs[0]?.consecutiveNoProgressFailures, 0)

  await queue.setEnabled(true)
  await waitFor(async () => resumes.length === 1)
  assert.equal(resumes[0], 13)
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  await queue.setEnabled(false)
  const changed = await queue.enqueue({
    ...queueInput('595', 'immediate'),
    reason: 'manual_immediate',
    trace: [...trace, { id: 'artifact-new' }]
  })
  assert.equal(changed.jobId, 'failed-job')
  assert.equal(changed.coalesced, true)
  stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{
      completedBatches?: number
      totalBatches?: number
      consecutiveNoProgressFailures: number
    }>
  }
  assert.equal(stored.jobs[0]?.completedBatches, undefined)
  assert.equal(stored.jobs[0]?.totalBatches, undefined)
  assert.equal(stored.jobs[0]?.consecutiveNoProgressFailures, 0)

  await queue.setEnabled(true)
  await waitFor(async () => resumes.length === 2)
  assert.equal(resumes[1], undefined)
  await queue.close()
})

test('manual retry preserves appended suffixes but resets a changed committed prefix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-prefix-resume-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-07-26T06:00:00.000Z'
  const trace = Array.from({ length: 204 }, (_, index) => ({
    id: `artifact-${index}`,
    meta: { stable: index }
  }))
  await writeFile(storagePath, JSON.stringify({
    version: 1,
    jobs: [{
      id: 'failed-prefix-job',
      runtimeId: 'codex',
      threadId: 'thread-1',
      engineThreadId: 'codex:thread-1',
      targetWatermark: '594',
      reason: 'manual_immediate',
      priority: 'immediate',
      trace,
      workspaceRoot: '/workspace',
      status: 'failed',
      attempt: 5,
      consecutiveNoProgressFailures: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedBatches: 13,
      totalBatches: 21,
      snapshot,
      error: {
        code: 'upstream_timeout',
        message: 'Timed out.',
        retryable: true,
        occurredAt: timestamp
      }
    }]
  }), 'utf8')
  const resumes: Array<number | undefined> = []
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async (input) => {
      resumes.push(input.resumeAfterBatch)
      throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
        code: 'internal_error',
        message: 'Stop after observing the resume cursor.',
        retryable: false,
        occurredAt: timestamp
      }))
    }
  })
  await queue.start(false)

  const appendedTrace = [
    ...trace,
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `artifact-appended-${index}`,
      meta: { stable: 204 + index }
    }))
  ]
  await queue.enqueue({
    ...queueInput('594', 'immediate'),
    reason: 'manual_immediate',
    trace: appendedTrace
  })
  let stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ completedBatches?: number; totalBatches?: number }>
  }
  assert.equal(stored.jobs[0]?.completedBatches, 13)
  assert.equal(stored.jobs[0]?.totalBatches, 22)
  await queue.setEnabled(true)
  await waitFor(async () => resumes.length === 1)
  assert.equal(resumes[0], 13)
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  await queue.setEnabled(false)
  const changedMiddle = appendedTrace.map((item, index) =>
    index === 85
      ? { ...item, meta: { stable: 85, changed: true } }
      : item
  )
  await queue.enqueue({
    ...queueInput('594', 'immediate'),
    reason: 'manual_immediate',
    trace: changedMiddle
  })
  stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ completedBatches?: number; totalBatches?: number }>
  }
  assert.equal(stored.jobs[0]?.completedBatches, 8)
  assert.equal(stored.jobs[0]?.totalBatches, 22)
  await queue.setEnabled(true)
  await waitFor(async () => resumes.length === 2)
  assert.equal(resumes[1], 8)
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  await queue.setEnabled(false)
  const changedPrefix = [
    { ...trace[0]!, meta: { stable: 0, changed: true } },
    ...changedMiddle.slice(1)
  ]
  await queue.enqueue({
    ...queueInput('594', 'immediate'),
    reason: 'manual_immediate',
    trace: changedPrefix
  })
  stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ completedBatches?: number; totalBatches?: number }>
  }
  assert.equal(stored.jobs[0]?.completedBatches, undefined)
  assert.equal(stored.jobs[0]?.totalBatches, undefined)
  await queue.setEnabled(true)
  await waitFor(async () => resumes.length === 3)
  assert.equal(resumes[2], undefined)
  await queue.close()
})

function queueInput(
  targetWatermark: string,
  priority: 'background' | 'normal' | 'high' | 'immediate' = 'normal',
  threadId = 'thread-1'
) {
  return {
    runtimeId: 'codex',
    threadId,
    engineThreadId: `codex:${threadId}`,
    targetWatermark,
    reason: 'turn_committed',
    priority,
    workspaceRoot: '/workspace',
    trace: [{ id: `artifact-${targetWatermark}` }]
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
