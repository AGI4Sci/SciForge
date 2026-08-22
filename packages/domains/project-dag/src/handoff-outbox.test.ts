import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  ProjectDagHandoffOutbox
} from './handoff-outbox.js'

const now = '2026-07-26T05:30:20.000Z'
const digest = `sha256:${'a'.repeat(64)}`
const fingerprint = `project-update-desired:${'b'.repeat(64)}`

type HandoffInput = Readonly<{
  workspaceRoot: string
  runtimeId: string
  threadId: string
  targetWatermark: string
  sourceKind: 'agent-thread'
}>

function receipt() {
  return {
    projectKey: 'path:/workspace',
    jobId: 'pjob_0123456789ab',
    acceptedRequestVersion: 1,
    desiredFingerprint: fingerprint,
    desiredEvidenceVector: [
      { threadId: 'codex:thread-1', digest }
    ],
    capturedScope: {
      includedSessions: ['codex:thread-1'],
      excludedSessions: [],
      isolatedSessions: []
    },
    state: 'queued' as const,
    acceptedAt: now,
    updatedAt: now
  }
}

function handoffInput(index: number): HandoffInput {
  return {
    workspaceRoot: '/workspace',
    runtimeId: 'codex',
    threadId: `thread-${index}`,
    targetWatermark: String(index),
    sourceKind: 'agent-thread'
  }
}

function handoffId(input: HandoffInput): string {
  const identity = [
    input.workspaceRoot,
    input.runtimeId,
    input.threadId,
    input.targetWatermark,
    input.sourceKind,
    '',
    '',
    '',
    ''
  ].join('\u0000')
  return `project-handoff:${createHash('sha256').update(identity).digest('hex')}`
}

function pendingRecord(input: HandoffInput): Record<string, unknown> {
  return {
    id: handoffId(input),
    ...input,
    state: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now
  }
}

async function writePersisted(
  userDataDir: string,
  records: readonly Record<string, unknown>[]
): Promise<string> {
  const path = new ProjectDagHandoffOutbox(userDataDir).path
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 3, records }, null, 2)}\n`, 'utf8')
  return path
}

test('outbox coalesces duplicate turn events and persists accepted receipt across restart', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-outbox-'))
  try {
    const first = new ProjectDagHandoffOutbox(userDataDir)
    const input = {
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '186',
      sourceKind: 'agent-thread' as const
    }
    const left = await first.enqueue(input)
    const right = await first.enqueue(input)
    const normalizedDuplicate = await first.enqueue({
      ...input,
      runtimeId: ' codex ',
      targetWatermark: ' 186 '
    })
    assert.equal(left.id, right.id)
    assert.equal(left.id, normalizedDuplicate.id)
    assert.equal(first.all().length, 1)

    await first.markAcceptedBatch([left.id], receipt())

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.all()[0]?.state, 'accepted')
    assert.equal(recovered.ready().length, 0)
    const replay = await recovered.enqueue(input)
    assert.equal(replay.state, 'accepted')
    assert.equal(recovered.all().length, 1)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('finds only active records in the same authoritative lane covered by one commit', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-covered-lane-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const input = {
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      sourceKind: 'agent-thread' as const
    }
    const watermark10 = await outbox.enqueue({ ...input, targetWatermark: '10' })
    const watermark20 = await outbox.enqueue({ ...input, targetWatermark: '20' })
    const watermark30 = await outbox.enqueue({ ...input, targetWatermark: '30' })
    const lifecycle = await outbox.enqueue({
      ...input,
      targetWatermark: '7:artifact-lifecycle:1'
    })
    const otherThread = await outbox.enqueue({
      ...input,
      threadId: 'thread-2',
      targetWatermark: '10'
    })
    await outbox.markRetry(watermark20.id, 'wait for Evidence', 60_000)

    const covered = outbox.activeInLaneCoveredBy(watermark10, '25')

    assert.deepEqual(
      new Set(covered.map(({ id }) => id)),
      new Set([watermark10.id, watermark20.id])
    )
    assert.equal(outbox.active().length, 5)
    assert.equal(outbox.all().find(({ id }) => id === watermark30.id)?.state, 'pending')
    assert.equal(outbox.all().find(({ id }) => id === lifecycle.id)?.state, 'pending')
    assert.equal(outbox.all().find(({ id }) => id === otherThread.id)?.state, 'pending')

    const execution7 = await outbox.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-1',
      targetWatermark: '7:event-1',
      sourceKind: 'package-execution',
      producerModuleId: 'sciforge.create-loop',
      executionId: 'execution-1',
      hostAcceptanceSequence: 7,
      hostWorkspaceBinding: 'capability-caller'
    })
    const execution8 = await outbox.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-1',
      targetWatermark: '8:event-2',
      sourceKind: 'package-execution',
      producerModuleId: 'sciforge.create-loop',
      executionId: 'execution-1',
      hostAcceptanceSequence: 8,
      hostWorkspaceBinding: 'capability-caller'
    })
    assert.deepEqual(
      outbox.activeInLaneCoveredBy(execution7, '10:event-3').map(({ id }) => id),
      [execution7.id]
    )
    assert.equal(outbox.all().find(({ id }) => id === execution8.id)?.state, 'pending')
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('ready handoffs prioritize fresh pending work ahead of an overdue retry', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-ready-order-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const first = await outbox.enqueue(handoffInput(1))
    await outbox.markRetry(first.id, 'retry later', 0)
    const pending = await outbox.enqueue({
      ...handoffInput(1),
      targetWatermark: '20'
    })

    assert.deepEqual(outbox.ready().map(({ id }) => id), [pending.id, first.id])
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('batch acceptance persists one receipt atomically and keeps uncovered work active', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-batch-accept-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const input = {
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      sourceKind: 'agent-thread' as const
    }
    const watermark10 = await outbox.enqueue({ ...input, targetWatermark: '10' })
    const watermark20 = await outbox.enqueue({ ...input, targetWatermark: '20' })
    const watermark30 = await outbox.enqueue({ ...input, targetWatermark: '30' })
    await outbox.markRetry(watermark20.id, 'wait for Evidence', 60_000)
    const covered = outbox.activeInLaneCoveredBy(watermark10, '25')

    await outbox.markAcceptedBatch(
      [...covered.map(({ id }) => id), watermark10.id],
      receipt()
    )

    const accepted = outbox.all().filter(({ state }) => state === 'accepted')
    assert.deepEqual(
      new Set(accepted.map(({ id }) => id)),
      new Set([watermark10.id, watermark20.id])
    )
    assert.ok(accepted.every((record) => record.receipt?.desiredFingerprint === fingerprint))
    assert.equal(outbox.active().length, 1)
    assert.equal(outbox.active()[0]?.id, watermark30.id)

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    const replay10 = await recovered.enqueue({ ...input, targetWatermark: '10' })
    const replay20 = await recovered.enqueue({ ...input, targetWatermark: '20' })
    assert.equal(replay10.state, 'accepted')
    assert.equal(replay20.state, 'accepted')
    assert.equal(recovered.active()[0]?.id, watermark30.id)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('batch acceptance rejects mixed authoritative lanes without changing either record', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-batch-scope-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const first = await outbox.enqueue(handoffInput(1))
    const second = await outbox.enqueue(handoffInput(2))

    await assert.rejects(
      outbox.markAcceptedBatch([first.id, second.id], receipt()),
      /multiple authoritative lanes/u
    )

    assert.deepEqual(outbox.all().map(({ state }) => state), ['pending', 'pending'])
    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.deepEqual(recovered.all().map(({ state }) => state), ['pending', 'pending'])
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('batch acceptance ignores terminal and missing ids when validating active lanes', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-terminal-batch-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const first = await outbox.enqueue(handoffInput(1))
    const second = await outbox.enqueue(handoffInput(2))
    await outbox.markAcceptedBatch([first.id], receipt())

    await outbox.markAcceptedBatch(
      [first.id, 'project-handoff:missing', second.id],
      receipt()
    )
    assert.deepEqual(outbox.all().map(({ state }) => state), ['accepted', 'accepted'])
    await outbox.markAcceptedBatch([second.id, first.id], receipt())
    assert.deepEqual(outbox.all().map(({ state }) => state), ['accepted', 'accepted'])
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('quarantines legacy unbound records and starts with a safe v3 outbox', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-legacy-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    await mkdir(dirname(outbox.path), { recursive: true })
    await writeFile(outbox.path, `${JSON.stringify({
      version: 1,
      records: [{
        workspaceRoot: '/workspace/victim',
        runtimeId: 'sciforge.create-loop',
        threadId: 'workflow:legacy',
        targetWatermark: '1:legacy',
        state: 'pending'
      }]
    })}\n`, 'utf8')

    await outbox.load()

    assert.deepEqual(outbox.all(), [])
    const persisted = JSON.parse(await readFile(outbox.path, 'utf8')) as {
      version: number
      records: unknown[]
    }
    assert.equal(persisted.version, 3)
    assert.deepEqual(persisted.records, [])
    const backups = (await readdir(dirname(outbox.path))).filter((name) => (
      name.startsWith('turn-handoff-outbox.json.legacy-v1.')
    ))
    assert.equal(backups.length, 1)
    assert.match(
      await readFile(join(dirname(outbox.path), backups[0]!), 'utf8'),
      /workspace\/victim/u
    )
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('quarantines malformed legacy roots before applying the v3 schema', async () => {
  const fixtures = [
    { version: 1, records: null },
    { version: 2, records: [], metadata: { untrusted: true } }
  ] as const

  for (const fixture of fixtures) {
    const userDataDir = await mkdtemp(join(tmpdir(), `project-handoff-legacy-v${fixture.version}-`))
    try {
      const outbox = new ProjectDagHandoffOutbox(userDataDir)
      await mkdir(dirname(outbox.path), { recursive: true })
      const legacy = `${JSON.stringify(fixture)}\n`
      await writeFile(outbox.path, legacy, 'utf8')

      await outbox.load()

      assert.deepEqual(outbox.all(), [])
      assert.deepEqual(JSON.parse(await readFile(outbox.path, 'utf8')), {
        version: 3,
        records: []
      })
      const [backup] = (await readdir(dirname(outbox.path))).filter((name) => (
        name.startsWith(`turn-handoff-outbox.json.legacy-v${fixture.version}.`)
      ))
      assert.ok(backup)
      assert.equal(await readFile(join(dirname(outbox.path), backup), 'utf8'), legacy)
    } finally {
      await rm(userDataDir, { recursive: true })
    }
  }
})

test('pending record remains actionable after crash-style reload', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-recovery-'))
  try {
    const first = new ProjectDagHandoffOutbox(userDataDir)
    await first.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '186',
      sourceKind: 'agent-thread'
    })
    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.ready().length, 1)
    assert.equal(recovered.ready()[0]?.attempts, 0)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('package execution records require persisted authoritative Host binding facts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-host-binding-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    await assert.rejects(outbox.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-1',
      targetWatermark: '7:event-1',
      sourceKind: 'package-execution',
      producerModuleId: 'sciforge.create-loop',
      executionId: 'execution-1'
    }), /Host-bound producer identity/u)
    await assert.rejects(outbox.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-1',
      targetWatermark: 'opaque:event-invalid-sequence',
      sourceKind: 'package-execution',
      producerModuleId: 'sciforge.create-loop',
      executionId: 'execution-1',
      hostAcceptanceSequence: 0,
      hostWorkspaceBinding: 'capability-caller'
    }), /positive safe integer/u)
    const accepted = await outbox.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-1',
      targetWatermark: 'opaque:event-1',
      sourceKind: 'package-execution',
      producerModuleId: 'sciforge.create-loop',
      executionId: 'execution-1',
      hostAcceptanceSequence: 7,
      hostWorkspaceBinding: 'capability-caller'
    })
    assert.equal(accepted.hostAcceptanceSequence, 7)
    assert.equal(accepted.hostWorkspaceBinding, 'capability-caller')
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('capacity pruning removes only terminal receipts and fails closed when all slots are active', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-capacity-'))
  try {
    const activeRecords = Array.from({ length: 999 }, (_, index) =>
      pendingRecord(handoffInput(index))
    )
    const terminalInput = handoffInput(999)
    const terminalRecord = {
      ...pendingRecord(terminalInput),
      state: 'accepted',
      receipt: receipt()
    }
    await writePersisted(userDataDir, [...activeRecords, terminalRecord])

    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    await outbox.load()
    const added = await outbox.enqueue(handoffInput(1_000))
    const ids = new Set(outbox.all().map(({ id }) => id))
    assert.equal(outbox.all().length, 1_000)
    assert.equal(outbox.active().length, 1_000)
    assert.equal(ids.has(handoffId(terminalInput)), false)
    assert.equal(ids.has(added.id), true)
    for (const record of activeRecords) assert.equal(ids.has(String(record.id)), true)

    const persistedBeforeFull = await readFile(outbox.path, 'utf8')
    await assert.rejects(
      outbox.enqueue(handoffInput(1_001)),
      /outbox is full/u
    )
    assert.equal(outbox.all().length, 1_000)
    assert.equal(await readFile(outbox.path, 'utf8'), persistedBeforeFull)

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.active().length, 1_000)
    assert.deepEqual(
      new Set(recovered.all().map(({ id }) => id)),
      ids
    )
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('load rejects duplicate, denormalized, and state-inconsistent persisted records', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-strict-'))
  try {
    const record = pendingRecord(handoffInput(1))
    await writePersisted(userDataDir, [record, record])
    await assert.rejects(
      new ProjectDagHandoffOutbox(userDataDir).load(),
      /duplicate record ids/u
    )

    await writePersisted(userDataDir, [{ ...record, runtimeId: ' codex ' }])
    await assert.rejects(
      new ProjectDagHandoffOutbox(userDataDir).load(),
      /runtimeId is not normalized/u
    )

    await writePersisted(userDataDir, [{ ...record, nextAttemptAt: now }])
    await assert.rejects(
      new ProjectDagHandoffOutbox(userDataDir).load(),
      /incompatible state fields/u
    )

    await writePersisted(userDataDir, [{ ...record, unexpected: true }])
    await assert.rejects(
      new ProjectDagHandoffOutbox(userDataDir).load(),
      /unsupported field unexpected/u
    )
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('persistence is owner-only and load repairs permissive modes', {
  skip: process.platform === 'win32'
}, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-mode-'))
  try {
    const first = new ProjectDagHandoffOutbox(userDataDir)
    await first.enqueue(handoffInput(1))
    const directory = dirname(first.path)
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    assert.equal((await stat(first.path)).mode & 0o777, 0o600)

    await chmod(directory, 0o755)
    await chmod(first.path, 0o644)
    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    assert.equal((await stat(first.path)).mode & 0o777, 0o600)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('failed persistence rolls an in-memory state transition back', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-rollback-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const pending = await outbox.enqueue(handoffInput(1))
    const directory = dirname(outbox.path)
    await rm(directory, { recursive: true })
    await writeFile(directory, 'blocks directory recreation', 'utf8')

    await assert.rejects(
      outbox.markRetry(pending.id, 'temporary failure', 1_000)
    )
    assert.equal(outbox.all()[0]?.state, 'pending')
    assert.equal(outbox.all()[0]?.attempts, 0)

    await rm(directory)
    await mkdir(directory)
    await outbox.markRetry(pending.id, 'temporary failure', 1_000)
    assert.equal(outbox.all()[0]?.state, 'retry_scheduled')

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.all()[0]?.state, 'retry_scheduled')
    assert.equal(recovered.all()[0]?.attempts, 1)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('failed batch persistence leaves every covered record active', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-batch-rollback-'))
  try {
    const outbox = new ProjectDagHandoffOutbox(userDataDir)
    const input = {
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      sourceKind: 'agent-thread' as const
    }
    const first = await outbox.enqueue({ ...input, targetWatermark: '10' })
    const second = await outbox.enqueue({ ...input, targetWatermark: '20' })
    const directory = dirname(outbox.path)
    await rm(directory, { recursive: true })
    await writeFile(directory, 'blocks directory recreation', 'utf8')

    await assert.rejects(
      outbox.markAcceptedBatch([first.id, second.id], receipt())
    )
    assert.deepEqual(outbox.all().map(({ state }) => state), ['pending', 'pending'])

    await rm(directory)
    await mkdir(directory)
    await outbox.markAcceptedBatch([first.id, second.id], receipt())
    assert.deepEqual(outbox.all().map(({ state }) => state), ['accepted', 'accepted'])

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.deepEqual(recovered.all().map(({ state }) => state), ['accepted', 'accepted'])
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})
