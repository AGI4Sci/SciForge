import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
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

test('coalescing preserves the maximum composite and batch watermark under reordering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-watermark-order-'))
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async () => snapshot
  })
  await queue.start(false)

  await queue.enqueue(queueInput('20:event-new'))
  await queue.enqueue(queueInput('19:event-old'))
  assert.equal(await queue.workspaceRoot('codex', 'thread-1'), '/workspace')
  assert.equal(
    (await queue.pending('codex', 'thread-1'))?.targetWatermark,
    '20:event-new'
  )

  await queue.enqueue(queueInput('20:event-new:batch:3/4', 'normal', 'batch-thread'))
  await queue.enqueue(queueInput('20:event-new:batch:1/4', 'normal', 'batch-thread'))
  assert.equal(
    (await queue.pending('codex', 'batch-thread'))?.targetWatermark,
    '20:event-new:batch:3/4'
  )
  await queue.enqueue(queueInput('20:event-new:batch:4/4', 'normal', 'batch-thread'))
  assert.equal(
    (await queue.pending('codex', 'batch-thread'))?.targetWatermark,
    '20:event-new:batch:4/4'
  )
  await queue.close()
})

test('incomparable watermarks remain independent durable jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-watermark-incomparable-'))
  const storagePath = join(root, 'queue.json')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)

  const first = await queue.enqueue(queueInput('20:event-a'))
  const second = await queue.enqueue(queueInput('20:event-b'))

  assert.equal(first.coalesced, false)
  assert.equal(second.coalesced, false)
  const persisted = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: readonly { targetWatermark: string }[]
  }
  assert.deepEqual(
    new Set(persisted.jobs.map(({ targetWatermark }) => targetWatermark)),
    new Set(['20:event-a', '20:event-b'])
  )
  await queue.close()
})

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

test('rejects a cross-thread service snapshot before it can pollute durable authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-snapshot-binding-'))
  const storagePath = join(root, 'queue.json')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => ({ ...snapshot, threadId: 'codex:forged-thread' })
  })
  await queue.start(true)
  await queue.enqueue(queueInput('1'))
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  assert.equal(await queue.committed('codex', 'thread-1'), null)
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ status: string; snapshot?: unknown }>
    threads: Array<{ engineThreadId: string; committed?: unknown }>
  }
  assert.equal(stored.jobs[0]?.status, 'failed')
  assert.equal(stored.jobs[0]?.snapshot, undefined)
  assert.equal(stored.threads[0]?.engineThreadId, 'codex:thread-1')
  assert.equal(stored.threads[0]?.committed, undefined)
  await queue.close()

  const restarted = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await restarted.start(false)
  assert.equal(await restarted.committed('codex', 'thread-1'), null)
  await restarted.close()
})

test('never rebinds one canonical Evidence thread identity across workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-workspace-binding-'))
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async (input) => ({
      ...snapshot,
      threadId: input.engineThreadId,
      inputWatermark: input.targetWatermark
    })
  })
  await queue.start(true)
  await queue.enqueue(queueInput('1'))
  await waitFor(async () => (await queue.committed('codex', 'thread-1')) !== null)

  await assert.rejects(
    queue.enqueue({
      ...queueInput('2'),
      workspaceRoot: '/different-workspace'
    }),
    /multiple workspaces/u
  )
  assert.equal(
    (await queue.committed('codex', 'thread-1', '/different-workspace')),
    null
  )
  assert.equal(
    (await queue.committed('codex', 'thread-1', '/workspace'))?.inputWatermark,
    '1'
  )
  await queue.close()
})

test('retains committed snapshots and workspace authority after job compaction and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-thread-registry-'))
  const storagePath = join(root, 'queue.json')
  await writeV3QueueFile(
    storagePath,
    Array.from({ length: 200 }, (_, index) => storedQueueJob(index, 'succeeded'))
  )

  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  assert.equal((await queue.committed('codex', 'thread-0'))?.version, 0)
  assert.equal(await queue.workspaceRoot('codex', 'thread-0'), '/workspace')

  await queue.enqueue(queueInput('new', 'normal', 'thread-new'))
  assert.equal((await queue.committed('codex', 'thread-0'))?.version, 0)
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    version: number
    jobs: Array<{ id: string }>
    threads: Array<{ engineThreadId: string; committed?: EvidenceDagCommittedSnapshot }>
  }
  assert.equal(stored.version, 3)
  assert.equal(stored.jobs.some((job) => job.id === 'job-0'), false)
  assert.equal(stored.threads.length, 201)
  assert.equal(
    stored.threads.find((state) => state.engineThreadId === 'codex:thread-0')
      ?.committed?.version,
    0
  )
  await queue.close()

  const restarted = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await restarted.start(false)
  assert.equal((await restarted.committed('codex', 'thread-0'))?.version, 0)
  assert.equal(await restarted.workspaceRoot('codex', 'thread-0'), '/workspace')
  await assert.rejects(
    restarted.enqueue({
      ...queueInput('rebind', 'normal', 'thread-0'),
      workspaceRoot: '/different-workspace'
    }),
    /multiple workspaces/u
  )
  await restarted.close()
})

test('canonicalizes workspace authority and rejects relative or NUL paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-canonical-workspace-'))
  const storagePath = join(root, 'queue.json')
  const canonical = join(root, 'workspace')
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)

  await queue.enqueue({
    ...queueInput('1'),
    workspaceRoot: `${canonical}/nested/..`
  })
  assert.equal(await queue.workspaceRoot('codex', 'thread-1'), canonical)
  const replay = await queue.enqueue({ ...queueInput('2'), workspaceRoot: canonical })
  assert.equal(replay.coalesced, true)
  await assert.rejects(
    queue.enqueue({ ...queueInput('3', 'normal', 'relative-thread'), workspaceRoot: 'relative' }),
    /absolute path/u
  )
  await assert.rejects(
    queue.enqueue({ ...queueInput('4', 'normal', 'nul-thread'), workspaceRoot: '/bad\0path' }),
    /absolute path/u
  )
  assert.equal(await queue.workspaceRoot('codex', 'relative-thread'), null)
  assert.equal(await queue.workspaceRoot('codex', 'nul-thread'), null)
  await queue.close()
})

test('rejects a workspace symlink that is retargeted after thread binding', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-workspace-retarget-'))
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  const workspaceLink = join(root, 'workspace-current')
  await mkdir(workspaceA)
  await mkdir(workspaceB)
  await symlink(workspaceA, workspaceLink)
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async () => snapshot
  })
  await queue.start(true)
  await queue.enqueue({ ...queueInput('1'), workspaceRoot: workspaceLink })
  await waitFor(async () => (await queue.committed('codex', 'thread-1')) !== null)

  await unlink(workspaceLink)
  await symlink(workspaceB, workspaceLink)
  await assert.rejects(
    queue.enqueue({ ...queueInput('2'), workspaceRoot: workspaceLink }),
    /changed its physical target/u
  )
  await assert.rejects(
    queue.committed('codex', 'thread-1', workspaceLink),
    /changed its physical target/u
  )
  await assert.rejects(
    queue.workspaceRoot('codex', 'thread-1'),
    /changed its physical target/u
  )
  await queue.close()

  const restarted = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async () => snapshot
  })
  await restarted.start(false)
  await assert.rejects(
    restarted.committed('codex', 'thread-1', workspaceLink),
    /changed its physical target/u
  )
  await restarted.close()
})

test('fails a delayed job before submit when its lexical workspace link is retargeted', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-delayed-retarget-'))
  const storagePath = join(root, 'queue.json')
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  const workspaceLink = join(root, 'workspace-current')
  await mkdir(workspaceA)
  await mkdir(workspaceB)
  await symlink(workspaceA, workspaceLink)
  let submissions = 0
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => {
      submissions += 1
      return snapshot
    }
  })
  await queue.start(false)
  await queue.enqueue({ ...queueInput('1'), workspaceRoot: workspaceLink })
  await unlink(workspaceLink)
  await symlink(workspaceB, workspaceLink)

  await queue.setEnabled(true)
  await waitFor(async () => {
    const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
      jobs: Array<{ status: string }>
    }
    return stored.jobs[0]?.status === 'failed'
  })
  assert.equal(submissions, 0)
  await assert.rejects(
    queue.pending('codex', 'thread-1'),
    /changed its physical target/u
  )
  await queue.close()
})

test('rejects delimiter-colliding runtime and thread tuples with the same engine identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-identity-collision-'))
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async () => snapshot
  })
  await queue.start(false)
  await queue.enqueue({
    ...queueInput('1'),
    runtimeId: 'domain:x',
    threadId: 'y',
    engineThreadId: 'domain:x:y'
  })

  await assert.rejects(
    queue.enqueue({
      ...queueInput('2'),
      runtimeId: 'domain',
      threadId: 'x:y',
      engineThreadId: 'domain:x:y'
    }),
    /collides with another scope/u
  )
  assert.equal((await queue.pending('domain:x', 'y'))?.targetWatermark, '1')
  assert.equal(await queue.pending('domain', 'x:y'), null)
  await queue.close()
})

test('restart quarantines a v2 queue whose workspace authority cannot be proven', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-migration-'))
  const storagePath = join(root, 'queue.json')
  const failedAt = '2026-07-21T01:02:03.000Z'
  const legacy = JSON.stringify({
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
  })
  await writeFile(storagePath, legacy, 'utf8')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)
  assert.equal(await queue.pending('codex', 'thread-1'), null)
  const current = JSON.parse(await readFile(storagePath, 'utf8')) as {
    version: number
    jobs: unknown[]
    threads: unknown[]
  }
  assert.deepEqual(current, { version: 3, jobs: [], threads: [] })
  const [legacyName] = (await readdir(root)).filter((name) =>
    /^queue\.json\.legacy-v2\..+\.json$/u.test(name)
  )
  assert.ok(legacyName)
  assert.equal(await readFile(join(root, legacyName), 'utf8'), legacy)
  await queue.close()
})

test('v2 quarantine never reauthorizes a snapshot after a workspace symlink retarget', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-legacy-retarget-'))
  const storagePath = join(root, 'queue.json')
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  const workspaceLink = join(root, 'workspace-current')
  await mkdir(workspaceA)
  await mkdir(workspaceB)
  await symlink(workspaceA, workspaceLink)
  const legacyJob = {
    ...storedQueueJob(1, 'succeeded'),
    runtimeId: 'codex',
    threadId: 'thread-1',
    engineThreadId: 'codex:thread-1',
    workspaceRoot: workspaceLink,
    snapshot
  }
  await writeFile(
    storagePath,
    JSON.stringify({ version: 2, jobs: [legacyJob] }),
    'utf8'
  )
  await unlink(workspaceLink)
  await symlink(workspaceB, workspaceLink)

  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)

  assert.equal(await queue.committed('codex', 'thread-1', workspaceLink), null)
  assert.equal(await queue.workspaceRoot('codex', 'thread-1'), null)
  assert.equal(
    (await readdir(root)).filter((name) => /^queue\.json\.legacy-v2\./u.test(name)).length,
    1
  )
  await queue.close()
})

test('quarantines a malformed legacy payload instead of failing every startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-legacy-malformed-'))
  const storagePath = join(root, 'queue.json')
  const legacy = JSON.stringify({
    version: 1,
    jobs: [null, { status: 'corrupt', workspaceRoot: '../relative' }]
  })
  await writeFile(storagePath, legacy, 'utf8')
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })

  await queue.start(false)

  assert.equal(await queue.pending('codex', 'thread-1'), null)
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')), {
    version: 3,
    jobs: [],
    threads: []
  })
  const [legacyName] = (await readdir(root)).filter((name) =>
    /^queue\.json\.legacy-v1\..+\.json$/u.test(name)
  )
  assert.ok(legacyName)
  assert.equal(await readFile(join(root, legacyName), 'utf8'), legacy)
  await queue.close()
})

test('quarantines malformed legacy roots before applying the v3 schema', async () => {
  const fixtures = [
    { version: 1, jobs: null },
    { version: 2, jobs: [], metadata: { untrusted: true } }
  ] as const

  for (const fixture of fixtures) {
    const root = await mkdtemp(join(tmpdir(), `evidence-domain-legacy-v${fixture.version}-root-`))
    const storagePath = join(root, 'queue.json')
    const legacy = JSON.stringify(fixture)
    await writeFile(storagePath, legacy, 'utf8')
    const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })

    await queue.start(false)

    assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')), {
      version: 3,
      jobs: [],
      threads: []
    })
    const [legacyName] = (await readdir(root)).filter((name) =>
      new RegExp(`^queue\\.json\\.legacy-v${fixture.version}\\..+\\.json$`, 'u').test(name)
    )
    assert.ok(legacyName)
    assert.equal(await readFile(join(root, legacyName), 'utf8'), legacy)
    await queue.close()
  }
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

test('rejects a final snapshot that regresses behind committed batch progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-snapshot-regression-'))
  const progressed = {
    ...snapshot,
    version: 2,
    inputWatermark: '2',
    digest: `sha256:${'e'.repeat(64)}`
  }
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async (_input, reportActivity) => {
      await reportActivity({ completedBatches: 1, totalBatches: 2, snapshot: progressed })
      return snapshot
    }
  })
  await queue.start(true)
  await queue.enqueue(queueInput('2'))
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')

  const committed = await queue.committed('codex', 'thread-1')
  assert.equal(committed?.version, 2)
  assert.equal(committed?.digest, progressed.digest)
  await queue.close()
})

test('close joins an in-flight submit and no queue write occurs after it resolves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-close-join-'))
  const storagePath = join(root, 'queue.json')
  let release: ((value: EvidenceDagCommittedSnapshot) => void) | undefined
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => new Promise<EvidenceDagCommittedSnapshot>((resolve) => {
      release = resolve
    })
  })
  await queue.start(true)
  await queue.enqueue(queueInput('1'))
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'running')

  let settled = false
  const closing = queue.close().then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(settled, false)
  release!(snapshot)
  await closing

  const afterClose = await readFile(storagePath, 'utf8')
  const stored = JSON.parse(afterClose) as {
    jobs: Array<{ status: string }>
    threads: Array<{ committed?: EvidenceDagCommittedSnapshot }>
  }
  assert.equal(stored.jobs[0]?.status, 'succeeded')
  assert.equal(stored.threads[0]?.committed?.digest, digest)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(await readFile(storagePath, 'utf8'), afterClose)
})

test('restart resumes after the last durably committed batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-resume-'))
  const storagePath = join(root, 'queue.json')
  await writeV3QueueFile(storagePath, [{
      ...queueInput('2'),
      id: 'job-resume',
      status: 'running',
      attempt: 1,
      consecutiveNoProgressFailures: 0,
      createdAt: '2026-07-26T06:00:00.000Z',
      updatedAt: '2026-07-26T06:01:00.000Z',
      completedBatches: 1,
      totalBatches: 2,
      snapshot
  }])
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

test('a quarantined v1 retry is never resumed under newly inferred authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-streak-migration-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-07-26T06:00:00.000Z'
  const legacy = JSON.stringify({
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
  })
  await writeFile(storagePath, legacy, 'utf8')
  let submissions = 0
  const queue = new EvidenceDagQueue({
    storagePath,
    now: () => new Date(timestamp),
    submit: async () => {
      submissions += 1
      return snapshot
    }
  })

  await queue.start(true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(submissions, 0)
  assert.equal(await queue.pending('codex', 'thread-1'), null)
  const [legacyName] = (await readdir(root)).filter((name) =>
    /^queue\.json\.legacy-v1\..+\.json$/u.test(name)
  )
  assert.ok(legacyName)
  assert.equal(await readFile(join(root, legacyName), 'utf8'), legacy)
  await queue.close()
})

test('manual retry revives one failed lane and preserves only an identical batch cursor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-failed-resume-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-07-26T06:00:00.000Z'
  const trace = Array.from({ length: 204 }, (_, index) => ({
    id: `artifact-${index}`
  }))
  await writeV3QueueFile(storagePath, [{
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
  }])
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
  await writeV3QueueFile(storagePath, [{
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
  }])
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

test('durably deduplicates lifecycle enqueue receipts across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-idempotent-lifecycle-'))
  const storagePath = join(root, 'queue.json')
  const first = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await first.start(false)
  const accepted = await first.enqueue({
    ...queueInput('7', 'background'),
    idempotencyKey: 'artifact-lifecycle:receipt-1:codex:thread-1',
    reason: 'artifact_version_lifecycle'
  })
  await first.close()

  const restarted = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await restarted.start(false)
  const replay = await restarted.enqueue({
    ...queueInput('7', 'background'),
    idempotencyKey: 'artifact-lifecycle:receipt-1:codex:thread-1',
    reason: 'artifact_version_lifecycle'
  })
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ id: string; idempotencyKey?: string }>
  }

  assert.equal(replay.jobId, accepted.jobId)
  assert.equal(replay.coalesced, true)
  assert.equal(stored.jobs.length, 1)
  assert.equal(stored.jobs[0]?.idempotencyKey, 'artifact-lifecycle:receipt-1:codex:thread-1')
  await restarted.close()
})

test('never evicts active lifecycle jobs and fails closed at active capacity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-active-retention-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-08-06T08:00:00.000Z'
  await writeV3QueueFile(storagePath, Array.from({ length: 205 }, (_, index) => ({
      id: `active-${index}`,
      idempotencyKey: `artifact-lifecycle:active-${index}`,
      runtimeId: 'codex',
      threadId: `thread-${index}`,
      engineThreadId: `codex:thread-${index}`,
      targetWatermark: '7',
      reason: 'artifact_version_lifecycle',
      priority: 'background',
      trace: [{ id: `artifact-${index}` }],
      workspaceRoot: '/workspace',
      status: 'queued',
      attempt: 0,
      consecutiveNoProgressFailures: 0,
      createdAt: timestamp,
      updatedAt: timestamp
  })))
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  await assert.rejects(
    queue.enqueue({
      ...queueInput('8', 'background', 'thread-new'),
      idempotencyKey: 'artifact-lifecycle:active-new',
      reason: 'artifact_version_lifecycle'
    }),
    /at capacity/u
  )
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as { jobs: unknown[] }

  assert.equal(stored.jobs.length, 205)
  await queue.close()
})

test('retains unresolved lifecycle failures beyond the ordinary terminal history cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-failure-retention-'))
  const storagePath = join(root, 'queue.json')
  const timestamp = '2026-08-06T08:00:00.000Z'
  const error = evidenceDagTypedErrorSchema.parse({
    code: 'internal_error',
    message: 'Lifecycle compilation failed.',
    retryable: false,
    occurredAt: timestamp
  })
  await writeV3QueueFile(storagePath, Array.from({ length: 205 }, (_, index) => ({
      id: `failed-${index}`,
      idempotencyKey: `artifact-lifecycle:failed-${index}`,
      runtimeId: 'codex',
      threadId: `thread-${index}`,
      engineThreadId: `codex:thread-${index}`,
      targetWatermark: `7:artifact-lifecycle:${index + 1}`,
      reason: 'artifact_version_lifecycle',
      priority: 'background',
      trace: [{ id: `artifact-${index}` }],
      workspaceRoot: '/workspace',
      status: 'failed',
      attempt: 5,
      consecutiveNoProgressFailures: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      error
  })))
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  await queue.enqueue({
    ...queueInput('8', 'background', 'thread-new'),
    idempotencyKey: 'artifact-lifecycle:active-after-failures',
    reason: 'artifact_version_lifecycle'
  })
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as { jobs: unknown[] }

  assert.equal(stored.jobs.length, 206)
  await queue.close()
})

test('later ordinary success cannot hide a failed lifecycle receipt and immediate retry revives it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-lifecycle-revive-'))
  const storagePath = join(root, 'queue.json')
  const failedAt = '2026-08-06T08:00:00.000Z'
  const succeededAt = '2026-08-06T08:01:00.000Z'
  const error = evidenceDagTypedErrorSchema.parse({
    code: 'internal_error',
    message: 'Lifecycle compilation failed.',
    retryable: false,
    occurredAt: failedAt
  })
  await writeV3QueueFile(storagePath, [{
      id: 'lifecycle-failed',
      idempotencyKey: 'artifact-lifecycle:receipt-failed:codex:thread-1',
      ...queueInput('7:artifact-lifecycle:4'),
      reason: 'artifact_version_lifecycle',
      status: 'failed',
      attempt: 5,
      consecutiveNoProgressFailures: 5,
      createdAt: failedAt,
      updatedAt: failedAt,
      error
    }, {
      id: 'ordinary-success',
      ...queueInput('8'),
      status: 'succeeded',
      attempt: 1,
      consecutiveNoProgressFailures: 0,
      createdAt: succeededAt,
      updatedAt: succeededAt,
      snapshot: { ...snapshot, version: 2, inputWatermark: '8' }
  }])
  const initial = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await initial.start(false)

  assert.equal((await initial.pending('codex', 'thread-1'))?.state, 'failed')
  await initial.close()
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  const retry = await queue.enqueue({
    ...queueInput('8', 'immediate'),
    reason: 'manual_immediate'
  })
  const pending = await queue.pending('codex', 'thread-1')
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{
      id: string
      idempotencyKey?: string
      targetWatermark: string
      traceRef: string
      traceItemCount: number
    }>
  }
  const revived = stored.jobs.find((job) => job.id === 'lifecycle-failed')

  assert.equal(retry.jobId, 'lifecycle-failed')
  assert.equal(pending?.state, 'queued')
  assert.match(pending?.targetWatermark ?? '', /^8:artifact-lifecycle-retry:/u)
  assert.equal(revived?.idempotencyKey, 'artifact-lifecycle:receipt-failed:codex:thread-1')
  assert.match(revived?.targetWatermark ?? '', /^8:artifact-lifecycle-retry:/u)
  assert.match(revived?.traceRef ?? '', /^sha256:[a-f0-9]{64}$/u)
  assert.equal(revived?.traceItemCount, 2)
  await queue.close()
})

test('holds later lifecycle pages behind an earlier failure until immediate retry succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-lifecycle-order-'))
  const submissions: string[] = []
  let failFirst = true
  const queue = new EvidenceDagQueue({
    storagePath: join(root, 'queue.json'),
    submit: async (input) => {
      submissions.push(input.targetWatermark)
      if (failFirst && input.targetWatermark === '7:artifact-lifecycle:2') {
        failFirst = false
        throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
          code: 'internal_error',
          message: 'First lifecycle page failed.',
          retryable: false,
          occurredAt: '2026-08-06T08:00:00.000Z'
        }))
      }
      return {
        ...snapshot,
        version: submissions.length,
        inputWatermark: input.targetWatermark
      }
    }
  })
  await queue.start(false)
  await queue.enqueue({
    ...queueInput('7:artifact-lifecycle:2', 'background'),
    idempotencyKey: 'artifact-lifecycle:page-1',
    reason: 'artifact_version_lifecycle'
  })
  await queue.enqueue({
    ...queueInput('7:artifact-lifecycle:4', 'background'),
    idempotencyKey: 'artifact-lifecycle:page-2',
    reason: 'artifact_version_lifecycle'
  })
  await queue.setEnabled(true)
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(submissions, ['7:artifact-lifecycle:2'])

  await queue.enqueue({
    ...queueInput('7', 'immediate'),
    reason: 'manual_immediate'
  })
  await waitFor(async () => submissions.length === 3)
  assert.match(submissions[1] ?? '', /^7:artifact-lifecycle-retry:/u)
  assert.equal(submissions[2], '7:artifact-lifecycle:4')
  await queue.close()
})

test('load and restart preserve every active job above the history capacity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-active-overflow-'))
  const storagePath = join(root, 'queue.json')
  const activeJobs = Array.from({ length: 205 }, (_, index) =>
    storedQueueJob(index, 'running'))
  await writeV3QueueFile(storagePath, activeJobs)

  const first = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await first.start(false)
  let stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ status: string }>
  }
  assert.equal(stored.jobs.length, 205)
  assert.ok(stored.jobs.every((job) => job.status === 'queued'))
  assert.equal((await first.pending('codex', 'thread-0'))?.state, 'queued')
  assert.equal((await first.pending('codex', 'thread-204'))?.state, 'queued')
  await first.close()

  const restarted = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await restarted.start(false)
  assert.equal((await restarted.pending('codex', 'thread-0'))?.state, 'queued')
  assert.equal((await restarted.pending('codex', 'thread-204'))?.state, 'queued')
  stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ status: string }>
  }
  assert.equal(stored.jobs.length, 205)
  await restarted.close()
})

test('enqueue fails closed when all capacity slots contain active jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-capacity-'))
  const storagePath = join(root, 'queue.json')
  const activeJobs = Array.from({ length: 200 }, (_, index) => storedQueueJob(index))
  await writeV3QueueFile(storagePath, activeJobs)
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)
  const before = await readFile(storagePath, 'utf8')

  await assert.rejects(
    queue.enqueue(queueInput('overflow', 'normal', 'overflow-thread')),
    /at capacity/u
  )

  assert.equal(await readFile(storagePath, 'utf8'), before)
  assert.equal(await queue.pending('codex', 'overflow-thread'), null)
  assert.equal((await queue.pending('codex', 'thread-0'))?.state, 'queued')
  assert.equal((await queue.pending('codex', 'thread-199'))?.state, 'queued')
  await queue.close()
})

test('capacity pruning removes only the deterministically oldest terminal job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-terminal-prune-'))
  const storagePath = join(root, 'queue.json')
  const activeJobs = Array.from({ length: 198 }, (_, index) => storedQueueJob(index))
  const oldestTerminal = {
    ...storedQueueJob(198, 'failed'),
    id: 'terminal-oldest',
    threadId: 'terminal-oldest',
    engineThreadId: 'codex:terminal-oldest',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  }
  const newerTerminal = {
    ...storedQueueJob(199, 'failed'),
    id: 'terminal-newer',
    threadId: 'terminal-newer',
    engineThreadId: 'codex:terminal-newer',
    createdAt: '2025-01-02T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z'
  }
  await writeV3QueueFile(storagePath, [...activeJobs, newerTerminal, oldestTerminal])
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)
  await queue.enqueue(queueInput('new', 'normal', 'new-thread'))

  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    jobs: Array<{ id: string; status: string }>
  }
  const ids = new Set(stored.jobs.map((job) => job.id))
  assert.equal(stored.jobs.length, 200)
  assert.equal(ids.has('terminal-oldest'), false)
  assert.equal(ids.has('terminal-newer'), true)
  assert.equal(stored.jobs.filter((job) => job.status === 'queued').length, 199)
  await queue.close()
})

test('load rejects a malformed job instead of silently discarding it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-strict-load-'))
  const storagePath = join(root, 'queue.json')
  await writeV3QueueFile(
    storagePath,
    [storedQueueJob(0), { ...storedQueueJob(1), status: 'corrupt' }]
  )
  const contents = await readFile(storagePath, 'utf8')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })

  await assert.rejects(queue.start(false), /invalid job at index 1/u)
  assert.equal(await readFile(storagePath, 'utf8'), contents)
  await queue.close()
})

test('v3 load rejects legacy aliases and omitted canonical job fields', async () => {
  const base = storedV3QueueJob(1)
  const failed = storedV3QueueJob(1, 'failed')
  const retrying = storedV3QueueJob(1, 'retrying')
  const succeeded = storedV3QueueJob(1, 'succeeded')
  const variants: Array<Readonly<{ name: string; job: Record<string, unknown> }>> = [
    { name: 'embedded-trace', job: { ...base, trace: [{ id: 'legacy' }] } },
    { name: 'phase', job: { ...base, phase: 'evidence' } },
    { name: 'attempts', job: { ...base, attempts: 0 } },
    { name: 'last-error', job: { ...base, lastError: 'legacy failure' } },
    { name: 'cursor-completed-only', job: { ...base, completedBatches: 1 } },
    { name: 'cursor-total-only', job: { ...base, totalBatches: 2 } },
    {
      name: 'cursor-without-snapshot',
      job: { ...base, completedBatches: 1, totalBatches: 2 }
    },
    { name: 'queued-error', job: { ...base, error: failed.error } },
    { name: 'queued-next-attempt', job: { ...base, nextAttemptAt: base.updatedAt } },
    { name: 'running-zero-attempt', job: { ...base, status: 'running', attempt: 0 } },
    { name: 'retrying-zero-attempt', job: { ...retrying, attempt: 0 } },
    { name: 'succeeded-zero-attempt', job: { ...succeeded, attempt: 0 } },
    ...(['reason', 'priority', 'status', 'attempt', 'consecutiveNoProgressFailures'] as const)
      .map((field) => {
        const job = { ...base }
        delete job[field]
        return { name: `missing-${field}`, job }
      })
  ]

  for (const variant of variants) {
    const root = await mkdtemp(join(tmpdir(), `evidence-domain-v3-${variant.name}-`))
    const storagePath = join(root, 'queue.json')
    const contents = JSON.stringify({
      version: 3,
      jobs: [variant.job],
      threads: [storedQueueThread(1)]
    })
    await writeFile(storagePath, contents, 'utf8')
    const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })

    await assert.rejects(queue.start(false), /invalid job at index 0/u)
    assert.equal(await readFile(storagePath, 'utf8'), contents)
    await queue.close()
  }
})

test('load fails closed when one stored Evidence identity spans workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-cross-workspace-load-'))
  const storagePath = join(root, 'queue.json')
  const first = storedQueueJob(1)
  const second = {
    ...storedQueueJob(2),
    runtimeId: 'codex',
    threadId: 'thread-1',
    engineThreadId: 'codex:thread-1',
    workspaceRoot: '/different-workspace'
  }
  await writeV3QueueFile(storagePath, [first, second])
  const contents = await readFile(storagePath, 'utf8')
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })

  await assert.rejects(queue.start(false), /spans multiple workspaces/u)
  assert.equal(await readFile(storagePath, 'utf8'), contents)
  await queue.close()
})

test('v3 thread registry fails closed on missing, conflicting, or malformed authority', async () => {
  const job = storedV3QueueJob(1, 'succeeded')
  const committed = (job.snapshot as EvidenceDagCommittedSnapshot)
  const cases: Array<Readonly<{ name: string; threads: unknown[]; pattern: RegExp }>> = [
    { name: 'missing', threads: [], pattern: /no thread authority/u },
    {
      name: 'workspace-conflict',
      threads: [{
        ...storedQueueThread(1, committed),
        workspaceRoot: '/different-workspace',
        workspacePhysicalRoot: '/different-workspace',
        workspaceScopeKey: `lexical:sha256:${createHash('sha256').update('/different-workspace').digest('hex')}`
      }],
      pattern: /spans multiple workspaces/u
    },
    {
      name: 'snapshot-identity',
      threads: [storedQueueThread(1, { ...committed, threadId: 'codex:other-thread' })],
      pattern: /invalid thread at index 0/u
    },
    {
      name: 'snapshot-conflict',
      threads: [storedQueueThread(1, { ...committed, digest: `sha256:${'b'.repeat(64)}` })],
      pattern: /conflicting committed snapshot version/u
    },
    {
      name: 'duplicate',
      threads: [storedQueueThread(1, committed), storedQueueThread(1, committed)],
      pattern: /invalid thread at index 1/u
    }
  ]

  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), `evidence-domain-v3-${item.name}-`))
    const storagePath = join(root, 'queue.json')
    const contents = JSON.stringify({ version: 3, jobs: [job], threads: item.threads })
    await writeFile(storagePath, contents, 'utf8')
    const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
    await assert.rejects(queue.start(false), item.pattern)
    assert.equal(await readFile(storagePath, 'utf8'), contents)
    await queue.close()
  }
})

test('v3 thread registry fails closed instead of evicting authority above capacity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-v3-thread-capacity-'))
  const storagePath = join(root, 'queue.json')
  const contents = JSON.stringify({
    version: 3,
    jobs: [],
    threads: Array.from({ length: 10_001 }, (_, index) => storedQueueThread(index))
  })
  await writeFile(storagePath, contents, 'utf8')
  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })

  await assert.rejects(queue.start(false), /thread registry exceeds its capacity/u)
  assert.equal(await readFile(storagePath, 'utf8'), contents)
  await queue.close()
})

test('v3 registry never regresses a committed snapshot to an older job version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-v3-monotonic-'))
  const storagePath = join(root, 'queue.json')
  const historicalJob = storedV3QueueJob(1, 'succeeded')
  const newest = {
    ...(historicalJob.snapshot as EvidenceDagCommittedSnapshot),
    version: 9,
    inputWatermark: '9',
    digest: `sha256:${'c'.repeat(64)}`
  }
  await writeFile(storagePath, JSON.stringify({
    version: 3,
    jobs: [historicalJob],
    threads: [storedQueueThread(1, newest)]
  }), 'utf8')

  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  assert.equal((await queue.committed('codex', 'thread-1'))?.version, 9)
  await queue.enqueue(queueInput('10'))
  await queue.setEnabled(true)
  await waitFor(async () => (await queue.pending('codex', 'thread-1'))?.state === 'failed')
  assert.equal((await queue.committed('codex', 'thread-1'))?.version, 9)
  await queue.close()

  const restarted = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await restarted.start(false)
  const committed = await restarted.committed('codex', 'thread-1')
  assert.equal(committed?.version, 9)
  assert.equal(committed?.digest, newest.digest)
  if (committed) committed.version = 0
  assert.equal((await restarted.committed('codex', 'thread-1'))?.version, 9)
  await restarted.close()
})

test('load and atomic replacement enforce private directory and file modes', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-permissions-'))
  const directory = join(root, 'private-queue')
  const storagePath = join(directory, 'queue.json')
  await mkdir(directory, { mode: 0o755 })
  await writeFile(storagePath, JSON.stringify({ version: 3, jobs: [], threads: [] }), 'utf8')
  await chmod(directory, 0o755)
  await chmod(storagePath, 0o644)
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })

  await queue.start(false)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.equal((await stat(storagePath)).mode & 0o777, 0o600)
  await queue.enqueue(queueInput('1'))
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.equal((await stat(storagePath)).mode & 0o777, 0o600)
  assert.deepEqual((await readdir(directory)).sort(), ['queue.json', 'queue.json.traces'])
  assert.equal((await stat(`${storagePath}.traces`)).mode & 0o777, 0o700)
  const [traceAsset] = await readdir(`${storagePath}.traces`)
  assert.ok(traceAsset)
  assert.equal((await stat(join(`${storagePath}.traces`, traceAsset))).mode & 0o777, 0o600)
  await queue.close()
})

test('large terminal traces are stored once outside the bounded queue index and survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-large-trace-'))
  const storagePath = join(root, 'queue.json')
  const largePayload = 'x'.repeat(4 * 1024 * 1024)
  let submittedPayloadLength = 0
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async (input) => {
      submittedPayloadLength = String(input.trace[0]?.payload ?? '').length
      return snapshot
    }
  })
  await queue.start(true)
  const enqueued = await queue.enqueue({
    ...queueInput('large-terminal'),
    trace: [{ id: 'large-artifact', payload: largePayload }]
  })
  assert.equal((await queue.waitForCommitted(enqueued.jobId)).digest, digest)
  await queue.close()

  assert.equal(submittedPayloadLength, largePayload.length)
  assert.ok((await stat(storagePath)).size < 16 * 1024)
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    version: number
    jobs: Array<{ trace?: unknown; traceRef: string; traceItemCount: number }>
  }
  assert.equal(stored.version, 3)
  assert.equal(stored.jobs[0]?.trace, undefined)
  assert.equal(stored.jobs[0]?.traceItemCount, 1)
  assert.match(stored.jobs[0]?.traceRef ?? '', /^sha256:[a-f0-9]{64}$/u)

  const restarted = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await restarted.start(false)
  assert.equal((await restarted.committed('codex', 'thread-1'))?.digest, digest)
  await restarted.close()
})

test('quarantines a legacy large trace without trusting its committed snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-legacy-large-trace-'))
  const storagePath = join(root, 'queue.json')
  const legacy = {
    ...storedQueueJob(1, 'succeeded'),
    runtimeId: 'codex',
    threadId: 'thread-1',
    engineThreadId: 'codex:thread-1',
    trace: [{ id: 'legacy-large', payload: 'y'.repeat(4 * 1024 * 1024) }],
    snapshot
  }
  const legacyContents = JSON.stringify({ version: 1, jobs: [legacy] })
  await writeFile(storagePath, legacyContents, 'utf8')
  assert.ok((await stat(storagePath)).size > 4 * 1024 * 1024)

  const queue = new EvidenceDagQueue({ storagePath, submit: async () => snapshot })
  await queue.start(false)
  assert.equal(await queue.committed('codex', 'thread-1'), null)
  await queue.close()

  assert.ok((await stat(storagePath)).size < 16 * 1024)
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    version: number
    jobs: unknown[]
    threads: unknown[]
  }
  assert.deepEqual(stored, { version: 3, jobs: [], threads: [] })
  const [legacyName] = (await readdir(root)).filter((name) =>
    /^queue\.json\.legacy-v1\..+\.json$/u.test(name)
  )
  assert.ok(legacyName)
  assert.equal(await readFile(join(root, legacyName), 'utf8'), legacyContents)
  assert.ok((await stat(join(root, legacyName))).size > 4 * 1024 * 1024)
})

test('a failed atomic write rolls back the complete in-memory mutation and cleans its temp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-domain-write-rollback-'))
  const storagePath = join(root, 'queue.json')
  const backupPath = join(root, 'queue.backup.json')
  await writeV3QueueFile(storagePath, [storedQueueJob(1)])
  const queue = new EvidenceDagQueue({
    storagePath,
    submit: async () => snapshot
  })
  await queue.start(false)
  await rename(storagePath, backupPath)
  await mkdir(storagePath)

  await assert.rejects(
    queue.enqueue(queueInput('2', 'normal', 'new-thread')),
    /Failed to persist the Evidence DAG update queue/u
  )
  const pending = await queue.pending('codex', 'thread-1')
  assert.equal(pending?.state, 'queued')
  assert.equal(pending?.targetWatermark, '1')
  assert.equal(await queue.workspaceRoot('codex', 'new-thread'), null)
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.endsWith('.tmp')),
    []
  )

  await rmdir(storagePath)
  await rename(backupPath, storagePath)
  const retried = await queue.enqueue(queueInput('2', 'normal', 'new-thread'))
  assert.equal(retried.coalesced, false)
  assert.equal((await queue.pending('codex', 'new-thread'))?.targetWatermark, '2')
  assert.equal(await queue.workspaceRoot('codex', 'new-thread'), '/workspace')
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

function storedQueueJob(
  index: number,
  status: 'queued' | 'running' | 'retrying' | 'failed' | 'succeeded' = 'queued'
): Record<string, unknown> {
  const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString()
  const base = {
    id: `job-${index}`,
    runtimeId: 'codex',
    threadId: `thread-${index}`,
    engineThreadId: `codex:thread-${index}`,
    targetWatermark: String(index),
    reason: 'turn_committed',
    priority: 'normal',
    trace: [{ id: `artifact-${index}` }],
    workspaceRoot: '/workspace',
    status,
    attempt: status === 'queued' || status === 'failed' ? 0 : 1,
    consecutiveNoProgressFailures: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  if (status === 'retrying' || status === 'failed') {
    return {
      ...base,
      ...(status === 'retrying' ? { nextAttemptAt: timestamp } : {}),
      error: {
        code: 'upstream_timeout',
        message: 'Timed out.',
        retryable: true,
        occurredAt: timestamp
      }
    }
  }
  if (status === 'succeeded') {
    return {
      ...base,
      snapshot: {
        ...snapshot,
        threadId: `codex:thread-${index}`,
        inputWatermark: String(index),
        version: index
      }
    }
  }
  return base
}

function storedV3QueueJob(
  index: number,
  status: 'queued' | 'running' | 'retrying' | 'failed' | 'succeeded' = 'queued'
): Record<string, unknown> {
  const { trace: _trace, ...job } = storedQueueJob(index, status)
  return {
    ...job,
    traceRef: `sha256:${'d'.repeat(64)}`,
    traceItemCount: 1
  }
}

function storedQueueThread(
  index: number,
  committed?: EvidenceDagCommittedSnapshot
): Record<string, unknown> {
  const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString()
  return {
    runtimeId: 'codex',
    threadId: `thread-${index}`,
    engineThreadId: `codex:thread-${index}`,
    workspaceRoot: '/workspace',
    workspacePhysicalRoot: '/workspace',
    workspaceScopeKey: `lexical:sha256:${createHash('sha256').update('/workspace').digest('hex')}`,
    updatedAt: timestamp,
    ...(committed ? { committed } : {})
  }
}

async function writeV3QueueFile(
  storagePath: string,
  inputJobs: readonly Record<string, unknown>[]
): Promise<void> {
  const jobs: Record<string, unknown>[] = []
  const threads = new Map<string, Record<string, unknown>>()
  for (const input of inputJobs) {
    const job = structuredClone(input)
    const trace = Array.isArray(job.trace)
      ? job.trace as readonly Record<string, unknown>[]
      : undefined
    if (trace) {
      const contents = `${JSON.stringify({ version: 1, trace })}\n`
      const traceRef = `sha256:${createHash('sha256').update(contents).digest('hex')}`
      const traceDirectory = `${storagePath}.traces`
      await mkdir(traceDirectory, { recursive: true })
      await writeFile(
        join(traceDirectory, `${traceRef.slice('sha256:'.length)}.json`),
        contents,
        'utf8'
      )
      delete job.trace
      job.traceRef = traceRef
      job.traceItemCount = trace.length
    }
    const runtimeId = String(job.runtimeId)
    const threadId = String(job.threadId)
    const engineThreadId = String(job.engineThreadId)
    const lexicalWorkspace = resolve(String(job.workspaceRoot))
    let physicalWorkspace = lexicalWorkspace
    let workspaceKind = 'lexical'
    try {
      physicalWorkspace = resolve(await realpath(lexicalWorkspace))
      workspaceKind = 'real'
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
    job.workspaceRoot = physicalWorkspace
    jobs.push(job)

    const committed = job.snapshot as EvidenceDagCommittedSnapshot | undefined
    const updatedAt = String(job.updatedAt)
    const existing = threads.get(engineThreadId)
    const existingCommitted = existing?.committed as EvidenceDagCommittedSnapshot | undefined
    if (!existing) {
      threads.set(engineThreadId, {
        runtimeId,
        threadId,
        engineThreadId,
        workspaceRoot: lexicalWorkspace,
        workspacePhysicalRoot: physicalWorkspace,
        workspaceScopeKey: `${workspaceKind}:sha256:${createHash('sha256')
          .update(physicalWorkspace).digest('hex')}`,
        updatedAt,
        ...(committed ? { committed } : {})
      })
    } else {
      if (updatedAt > String(existing.updatedAt)) existing.updatedAt = updatedAt
      if (committed && (!existingCommitted || committed.version > existingCommitted.version)) {
        existing.committed = committed
      }
    }
  }
  await writeFile(storagePath, JSON.stringify({
    version: 3,
    jobs,
    threads: [...threads.values()]
  }), 'utf8')
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
