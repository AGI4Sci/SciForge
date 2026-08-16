import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { artifactVersionCommitReceiptItemV1Schema } from '@sciforge/domain-artifact-versions/contract'
import type { DomainTurnArtifactEvent } from '@sciforge/domain-sdk/host'
import { extractCheckpointFromTurn } from './extract.js'
import { ResearchCheckpointStore } from './store.js'
import { outputVersionId } from './crypto.js'

const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: true }
const TEST_ISSUER_EPOCH = 'test-issuer-epoch'

function clock() {
  let tick = Date.parse('2026-08-11T08:00:00.000Z')
  return () => new Date(tick += 1_000)
}

async function startAtCurrentPolicy(
  store: ResearchCheckpointStore,
  workspaceRoot: string,
  input: Omit<Parameters<ResearchCheckpointStore['start']>[1], 'expectedPolicyRevision'>,
  boundary?: Parameters<ResearchCheckpointStore['start']>[2]
) {
  const status = await store.checkpointStatus(workspaceRoot, input.runtimeId, input.threadId)
  return store.start(workspaceRoot, {
    ...input,
    expectedPolicyRevision: status.policyRevision
  }, boundary)
}

async function stopAtCurrentPolicy(
  store: ResearchCheckpointStore,
  workspaceRoot: string,
  input: Omit<Parameters<ResearchCheckpointStore['stop']>[1], 'expectedPolicyRevision'>,
  boundary?: Parameters<ResearchCheckpointStore['stop']>[2]
) {
  const status = await store.checkpointStatus(workspaceRoot, input.runtimeId, input.threadId)
  return store.stop(workspaceRoot, {
    ...input,
    expectedPolicyRevision: status.policyRevision
  }, boundary)
}

function event(turnId: string, sequence: number): DomainTurnArtifactEvent {
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId,
    targetWatermark: `wm-${sequence}`,
    sequence,
    workspaceRoot: '/workspace/project',
    occurredAt: `2026-08-11T08:10:${String(sequence).padStart(2, '0')}.000Z`,
    artifacts: [
      { kind: 'user_message', text: `request ${turnId}` },
      { kind: 'assistant_message', text: `result ${turnId}` }
    ]
  }
}

function receipt(
  candidateId: string,
  versionOrdinal: number,
  parentVersionId?: string,
  artifactId = 'artifact:research-checkpoint'
) {
  const versionId = `artifact-version:checkpoint-${versionOrdinal}`
  const digest = String(versionOrdinal).repeat(64).slice(0, 64)
  const timestamp = `2026-08-11T09:00:0${versionOrdinal}.000Z`
  const ref = {
    artifactId,
    versionId,
    contentDigest: digest,
    byteLength: 100 + versionOrdinal,
    mediaType: 'application/vnd.sciforge.research-checkpoint+json',
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy
  }
  return artifactVersionCommitReceiptItemV1Schema.parse({
    candidateId,
    artifact: {
      artifactId,
      kind: 'research-checkpoint',
      createdAt: '2026-08-11T09:00:00.000Z',
      updatedAt: timestamp,
      currentVersionId: versionId,
      versionCount: versionOrdinal
    },
    version: {
      schemaVersion: 1,
      versionId,
      artifactId,
      ...(parentVersionId ? { parentVersionId } : {}),
      sequence: versionOrdinal,
      transactionId: `artifact-commit:checkpoint-${versionOrdinal}`,
      createdAt: timestamp,
      intent: 'save',
      storage: {
        mode: 'snapshot',
        contentDigest: digest,
        byteLength: 100 + versionOrdinal,
        mediaType: 'application/vnd.sciforge.research-checkpoint+json'
      },
      dependencies: [],
      accessPolicy,
      metadata: {}
    },
    ref
  })
}

function outputReceipt(
  candidateId: string,
  artifactId: string,
  versionId: string,
  contentDigest: string,
  byteLength: number,
  transactionId: string
) {
  return artifactVersionCommitReceiptItemV1Schema.parse({
    candidateId,
    artifact: {
      artifactId,
      kind: 'research-output',
      createdAt: '2026-08-11T09:00:00.000Z',
      updatedAt: '2026-08-11T09:00:01.000Z',
      currentVersionId: versionId,
      versionCount: 1
    },
    version: {
      schemaVersion: 1,
      versionId,
      artifactId,
      sequence: 1,
      transactionId,
      createdAt: '2026-08-11T09:00:01.000Z',
      intent: 'save',
      storage: { mode: 'snapshot', contentDigest, byteLength, mediaType: 'text/csv' },
      dependencies: [],
      accessPolicy,
      metadata: {}
    },
    ref: {
      artifactId,
      versionId,
      contentDigest,
      byteLength,
      mediaType: 'text/csv',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy
    }
  })
}

function exactOutputEvent(
  workspaceRoot: string,
  turnId: string,
  sequence: number,
  marker: string
): DomainTurnArtifactEvent {
  const bytes = Buffer.from(marker)
  const contentDigest = createHash('sha256').update(bytes).digest('hex')
  const patchDigest = createHash('sha256').update(marker).digest('hex')
  return {
    ...event(turnId, sequence),
    workspaceRoot,
    issuerEpoch: TEST_ISSUER_EPOCH,
    deliveryAttemptOrdinal: Math.max(1, sequence),
    clientDirectiveId: `directive-${turnId}`,
    boundaryLeaseId: `directive-${turnId}`,
    deliveryAttemptId: `directive-${turnId}`,
    fileEffects: {
      contractVersion: 1,
      capture: 'host-turn-boundary',
      baselineDigest: 'a'.repeat(64),
      baselineCapturedAt: '2026-08-11T08:09:00.000Z',
      terminalCapturedAt: '2026-08-11T08:10:00.000Z',
      effects: [{
        contractVersion: 1,
        kind: 'created',
        path: 'outputs/result.csv',
        contentDigest,
        byteLength: bytes.byteLength,
        mediaType: 'text/csv',
        dataBase64: bytes.toString('base64')
      }],
      issues: []
    },
    filePatchReceipts: [{
      contractVersion: 1,
      kind: 'host-authenticated-file-patch',
      issuer: 'sciforge.agent-runtime-host',
      source: 'codex-app-server-file-change',
      callId: `patch-${turnId}`,
      executorSequence: 1,
      path: 'outputs/result.csv',
      operation: 'add',
      patchFormat: 'full-content',
      patchText: marker,
      patchDigest
    }]
  }
}

test('store applies structural redaction again at its persistence boundary', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-redaction-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:redaction'
    })
    const workspace = join(userDataDir, 'workspace')
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Study password=title-secret',
      changeReason: 'Bearer reason-secret',
      idempotencyKey: 'redaction-start'
    })
    const extracted = extractCheckpointFromTurn(
      {
        ...event('turn-redaction', 1),
        artifacts: [{
          kind: 'assistant_message',
          text: 'Result https://example.test/data?X-Amz-Signature=opaque-signature.'
        }]
      },
      started.recording,
      workspace,
      new Map()
    )
    await store.enqueue(workspace, started.recording.recordingId, {
      ...extracted,
      manifest: {
        ...extracted.manifest,
        narrative: {
          canonicalText: 'Authorization: raw-secret',
          contentDigest: createHash('sha256').update('Authorization: raw-secret').digest('hex')
        }
      }
    }, 'redaction-commit')
    const serialized = await readFile(store.pathFor(workspace), 'utf8')
    for (const secret of ['title-secret', 'reason-secret', 'opaque-signature', 'raw-secret']) {
      assert.equal(serialized.includes(secret), false, secret)
    }
    assert.match(serialized, /REDACTED/u)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('store applies the Host opaque sanitizer to every persisted free-text boundary', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-host-sanitizer-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const opaqueSecret = 'opaque-secret-canary-93c7'
    const absolutePath = '/Users/researcher/private/project/raw.csv'
    const sanitizeText = (value: string) => value
      .replaceAll(opaqueSecret, '[HOST_SECRET]')
      .replaceAll(absolutePath, '[HOST_PATH]')
    const store = new ResearchCheckpointStore({ userDataDir, now: clock(), sanitizeText })
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'host-sanitizer-start',
      title: `Title ${opaqueSecret}`,
      changeReason: `Reason ${absolutePath}`
    })
    const extracted = extractCheckpointFromTurn(
      {
        ...event('turn-host-sanitizer', 1),
        artifacts: [{ kind: 'assistant_message', text: `Result ${opaqueSecret} ${absolutePath}` }]
      },
      started.recording,
      workspace,
      new Map()
    )
    const queued = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extracted,
      'host-sanitizer-commit'
    )
    await store.markAttempt(
      workspace,
      queued.operationId,
      `Attempt failed for ${opaqueSecret} at ${absolutePath}`
    )
    await store.markTerminalFailure(
      workspace,
      queued.operationId,
      'failed',
      `Terminal failure ${opaqueSecret} ${absolutePath}`,
      false
    )
    const journal = await readFile(store.pathFor(workspace), 'utf8')
    assert.equal(journal.includes(opaqueSecret), false)
    assert.equal(journal.includes(absolutePath), false)
    assert.match(journal, /\[HOST_SECRET\]/u)
    assert.match(journal, /\[HOST_PATH\]/u)

    const restoreUserDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-restore-host-sanitizer-'))
    try {
      const exactBytesByVersion = new Map<string, Uint8Array>()
      const restoreStore = new ResearchCheckpointStore({
        userDataDir: restoreUserDataDir,
        now: clock(),
        sanitizeText,
        committedManifestLoader: {
          load: async ({ ref }) => exactBytesByVersion.get(ref.versionId) ?? assert.fail('missing exact source bytes')
        }
      })
      const restoreWorkspace = join(restoreUserDataDir, 'workspace')
      const restoreStarted = await startAtCurrentPolicy(restoreStore, restoreWorkspace, {
        runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'restore-host-sanitizer-start'
      })
      const restoreQueued = await restoreStore.enqueue(
        restoreWorkspace,
        restoreStarted.recording.recordingId,
        extractCheckpointFromTurn(
          { ...event('turn-restore-host-sanitizer', 1), workspaceRoot: restoreWorkspace },
          restoreStarted.recording,
          restoreWorkspace,
          new Map()
        ),
        'restore-host-sanitizer-commit'
      )
      const restorePrepared = await restoreStore.prepareOperation(restoreWorkspace, restoreQueued.operationId)
      const sourceBytes = Buffer.from(JSON.stringify(restorePrepared.manifest))
      const sourceReceiptBase = receipt(restorePrepared.candidateId, 1)
      const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex')
      const sourceReceipt = artifactVersionCommitReceiptItemV1Schema.parse({
        ...sourceReceiptBase,
        ref: {
          ...sourceReceiptBase.ref,
          contentDigest: sourceDigest,
          byteLength: sourceBytes.byteLength
        },
        version: {
          ...sourceReceiptBase.version,
          storage: {
            ...sourceReceiptBase.version.storage,
            contentDigest: sourceDigest,
            byteLength: sourceBytes.byteLength
          }
        }
      })
      exactBytesByVersion.set(sourceReceipt.ref.versionId, sourceBytes)
      await restoreStore.markCommitted(
        restoreWorkspace,
        restorePrepared.operationId,
        sourceReceipt,
        sourceReceipt.version.transactionId
      )
      const restore = await restoreStore.enqueueRestore(restoreWorkspace, {
        recordingId: restoreStarted.recording.recordingId,
        artifactId: sourceReceipt.ref.artifactId,
        sourceVersionId: sourceReceipt.ref.versionId,
        expectedCurrentVersionId: sourceReceipt.ref.versionId,
        idempotencyKey: 'restore-host-sanitizer-operation'
      })
      await restoreStore.markRestoreAttempt(
        restoreWorkspace,
        restore.restoreOperationId,
        `Restore attempt ${opaqueSecret} ${absolutePath}`
      )
      await restoreStore.failRestore(
        restoreWorkspace,
        restore.restoreOperationId,
        `Restore failure ${opaqueSecret} ${absolutePath}`,
        false
      )
      const restoreJournal = await readFile(restoreStore.pathFor(restoreWorkspace), 'utf8')
      assert.equal(restoreJournal.includes(opaqueSecret), false)
      assert.equal(restoreJournal.includes(absolutePath), false)
      assert.match(restoreJournal, /\[HOST_SECRET\]/u)
      assert.match(restoreJournal, /\[HOST_PATH\]/u)
    } finally {
      await rm(restoreUserDataDir, { recursive: true, force: true })
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('start idempotency is content-bound and canonical workspace aliases share one store', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:stable'
    })
    const workspace = join(userDataDir, 'workspace')
    const input = {
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Study',
      changeReason: 'Initial question',
      expectedPolicyRevision: 0,
      idempotencyKey: 'start-idempotency-1'
    }
    const first = await store.start(workspace, input, { watermark: 'wm-start', knownTurnIds: ['turn-old'] })
    const replay = await store.start(join(workspace, '.'), input, { watermark: 'wm-new', knownTurnIds: [] })
    assert.equal(first.created, true)
    assert.equal(replay.created, true)
    assert.equal(replay.recording.recordingId, first.recording.recordingId)
    assert.equal(store.pathFor(workspace), store.pathFor(join(workspace, '.')))
    await assert.rejects(
      store.start(workspace, { ...input, threadId: 'thread-2' }),
      (error: unknown) => (error as { code?: string }).code === 'content-mismatch'
    )
    await assert.rejects(
      store.start(workspace, { ...input, title: 'Different title' }),
      (error: unknown) => (error as { code?: string }).code === 'content-mismatch'
    )
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('committed output journals compact raw patches and snapshots while pending restart retains them', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-compaction-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:compaction'
    })
    const workspace = join(userDataDir, 'workspace')
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'compaction-start'
    })
    const marker = 'RAW_OUTPUT_MARKER_MUST_BE_COMPACTED'
    const exactEvent = exactOutputEvent(workspace, 'turn-compact', 2, marker)
    await store.ensureAutomaticLease(workspace, {
      issuerEpoch: exactEvent.issuerEpoch!,
      deliveryAttemptOrdinal: exactEvent.deliveryAttemptOrdinal!,
      leaseId: exactEvent.clientDirectiveId!,
      deliveryAttemptId: exactEvent.deliveryAttemptId!,
      clientDirectiveId: exactEvent.clientDirectiveId!, runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-before-compact', knownTurnIds: [] }
    })
    const queued = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(exactEvent, started.recording, workspace, new Map()),
      'compaction-commit-key',
      {
        issuerEpoch: exactEvent.issuerEpoch!,
        deliveryAttemptOrdinal: exactEvent.deliveryAttemptOrdinal!,
        leaseId: exactEvent.boundaryLeaseId!,
        deliveryAttemptId: exactEvent.deliveryAttemptId!
      }
    )
    const pending = await store.operation(workspace, queued.operationId)
    assert.equal(pending?.filePlans[0]?.patchReceipts?.[0]?.patchText, marker)

    const restartedPending = await new ResearchCheckpointStore({ userDataDir }).operation(
      workspace,
      queued.operationId
    )
    assert.equal(restartedPending?.filePlans[0]?.patchReceipts?.[0]?.patchText, marker)

    const verified = await store.completeFilePatchVerification(
      workspace,
      queued.operationId,
      'outputs/result.csv',
      {
        ...queued.filePlans[0]!,
        terminalSnapshot: {
          contentDigest: createHash('sha256').update(marker).digest('hex'),
          byteLength: Buffer.byteLength(marker),
          mediaType: 'text/csv',
          dataBase64: Buffer.from(marker).toString('base64')
        }
      },
      queued.manifest
    )
    const prepared = await store.prepareOperation(workspace, verified.operationId)
    const checkpointReceipt = receipt(prepared.candidateId, 1)
    const plan = prepared.filePlans[0]!
    const output = outputReceipt(
      'output-candidate',
      plan.artifactId!,
      outputVersionId(prepared.operationId, plan.path),
      plan.terminalSnapshot!.contentDigest,
      plan.terminalSnapshot!.byteLength,
      checkpointReceipt.version.transactionId
    )
    await store.markCommitted(
      workspace,
      prepared.operationId,
      checkpointReceipt,
      checkpointReceipt.version.transactionId,
      [{ path: plan.path, item: output }]
    )
    const raw = await readFile(store.pathFor(workspace), 'utf8')
    assert.equal(raw.includes(marker), false)
    assert.equal(raw.includes(Buffer.from(marker).toString('base64')), false)
    const committed = await new ResearchCheckpointStore({ userDataDir }).operation(workspace, prepared.operationId)
    assert.equal(committed?.state, 'committed')
    assert.equal(committed?.filePlans[0]?.patchReceipts, undefined)
    assert.equal(committed?.filePlans[0]?.terminalSnapshot?.dataBase64, undefined)
    assert.equal(committed?.filePlans[0]?.terminalSnapshot?.contentDigest, plan.terminalSnapshot?.contentDigest)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('committed journal keeps only a summary and exact reads require a digest-verified owner loader', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-exact-loader-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    let exactBytes: Uint8Array | undefined
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      committedManifestLoader: {
        load: async ({ workspaceRoot, ref }) => {
          assert.equal(workspaceRoot, workspace)
          assert.equal(ref.contentDigest, exactBytes && createHash('sha256').update(exactBytes).digest('hex'))
          return exactBytes ?? assert.fail('exact manifest was not frozen')
        }
      }
    })
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'exact-loader-start'
    })
    const queued = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-exact-loader', 1), started.recording, workspace, new Map()),
      'exact-loader-commit'
    )
    const prepared = await store.prepareOperation(workspace, queued.operationId)
    exactBytes = Buffer.from(JSON.stringify(prepared.manifest))
    const baseReceipt = receipt(prepared.candidateId, 1)
    const exactDigest = createHash('sha256').update(exactBytes).digest('hex')
    const committedReceipt = artifactVersionCommitReceiptItemV1Schema.parse({
      ...baseReceipt,
      ref: { ...baseReceipt.ref, contentDigest: exactDigest, byteLength: exactBytes.byteLength },
      version: {
        ...baseReceipt.version,
        storage: {
          ...baseReceipt.version.storage,
          contentDigest: exactDigest,
          byteLength: exactBytes.byteLength
        }
      }
    })
    await store.markCommitted(
      workspace, prepared.operationId, committedReceipt, committedReceipt.version.transactionId
    )
    const journal = await readFile(store.pathFor(workspace), 'utf8')
    assert.equal(journal.includes(prepared.manifest.narrative.canonicalText), false)
    assert.equal(journal.includes(prepared.manifest.sources[0]?.uri ?? '__no_source__'), false)
    assert.equal((await store.read(workspace, { versionId: committedReceipt.ref.versionId })).manifest.narrative.canonicalText,
      prepared.manifest.narrative.canonicalText)

    const noLoader = new ResearchCheckpointStore({ userDataDir })
    await assert.rejects(
      noLoader.read(workspace, { versionId: committedReceipt.ref.versionId }),
      /loader is unavailable/u
    )
    const tampered = new ResearchCheckpointStore({
      userDataDir,
      committedManifestLoader: { load: async () => Buffer.from('tampered') }
    })
    await assert.rejects(
      tampered.read(workspace, { versionId: committedReceipt.ref.versionId }),
      /do not match the exact Artifact Version/u
    )
    const wrongScope = new ResearchCheckpointStore({
      userDataDir,
      committedManifestLoader: {
        load: async ({ workspaceRoot }) => {
          if (workspaceRoot !== join(userDataDir, 'another-workspace')) {
            throw new Error('wrong workspace scope')
          }
          return exactBytes ?? assert.fail()
        }
      }
    })
    await assert.rejects(
      wrongScope.read(workspace, { versionId: committedReceipt.ref.versionId }),
      /wrong workspace scope/u
    )
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('legacy committed journals scrub raw output bytes on first compatible read', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-migration-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir, now: clock() })
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'migration-start'
    })
    const queued = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-migrate', 1), started.recording, workspace, new Map()),
      'migration-commit-key'
    )
    const prepared = await store.prepareOperation(workspace, queued.operationId)
    const legacyManifestBytes = Buffer.from(JSON.stringify(prepared.manifest))
    const baseCommittedReceipt = receipt(prepared.candidateId, 1)
    const legacyManifestDigest = createHash('sha256').update(legacyManifestBytes).digest('hex')
    const committedReceipt = artifactVersionCommitReceiptItemV1Schema.parse({
      ...baseCommittedReceipt,
      ref: {
        ...baseCommittedReceipt.ref,
        contentDigest: legacyManifestDigest,
        byteLength: legacyManifestBytes.byteLength
      },
      version: {
        ...baseCommittedReceipt.version,
        storage: {
          ...baseCommittedReceipt.version.storage,
          contentDigest: legacyManifestDigest,
          byteLength: legacyManifestBytes.byteLength
        }
      }
    })
    await store.markCommitted(
      workspace, prepared.operationId, committedReceipt, committedReceipt.version.transactionId
    )
    const path = store.pathFor(workspace)
    const legacy = JSON.parse(await readFile(path, 'utf8')) as { operations: Array<Record<string, unknown>> }
    const marker = 'LEGACY_RAW_PATCH_MARKER'
    const operation = legacy.operations[0]!
    operation.manifest = prepared.manifest
    operation.manifestStorage = undefined
    operation.committedStatus = undefined
    operation.filePlans = [{
      path: 'outputs/legacy.csv', role: 'generated', expectedCurrentVersionId: null,
      patchReceipts: [{
        contractVersion: 1, kind: 'host-authenticated-file-patch', issuer: 'sciforge.agent-runtime-host',
        source: 'codex-app-server-file-change', callId: 'legacy-call', executorSequence: 1,
        path: 'outputs/legacy.csv', operation: 'add', patchFormat: 'full-content',
        patchText: marker, patchDigest: createHash('sha256').update(marker).digest('hex')
      }],
      terminalSnapshot: {
        contentDigest: createHash('sha256').update(marker).digest('hex'),
        byteLength: Buffer.byteLength(marker), dataBase64: Buffer.from(marker).toString('base64')
      }
    }]
    await writeFile(path, `${JSON.stringify(legacy)}\n`, 'utf8')

    const reopened = new ResearchCheckpointStore({
      userDataDir,
      committedManifestLoader: { load: async () => legacyManifestBytes }
    })
    assert.equal((await reopened.operation(workspace, prepared.operationId))?.state, 'committed')
    assert.equal(
      (await reopened.read(workspace, { versionId: committedReceipt.ref.versionId })).manifest.turn.turnId,
      prepared.manifest.turn.turnId
    )
    const scrubbed = await readFile(path, 'utf8')
    assert.equal(scrubbed.includes(marker), false)
    assert.equal(scrubbed.includes(Buffer.from(marker).toString('base64')), false)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('store byte budget rejects a mutation without replacing the last durable state', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-store-budget-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir, maxStoreBytes: 1_450 })
    await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'budget-start'
    })
    const before = await readFile(store.pathFor(workspace), 'utf8')
    await assert.rejects(store.start(workspace, {
      runtimeId: 'codex',
      threadId: 'thread-2',
      expectedPolicyRevision: 0,
      idempotencyKey: 'budget-second-start',
      title: 'x'.repeat(500)
    }), /serialized capacity/)
    assert.equal(await readFile(store.pathFor(workspace), 'utf8'), before)
    const reopened = new ResearchCheckpointStore({ userDataDir, maxStoreBytes: 1_450 })
    assert.equal((await reopened.status(workspace, 'codex', 'thread-1'))?.state, 'active')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('automatic lease and stop are atomic while an accepted turn keeps its bound recording', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-boundary-'))
  try {
    const store = new ResearchCheckpointStore({ userDataDir, now: clock() })
    const workspace = join(userDataDir, 'workspace')
    const leased = await store.ensureAutomaticLease(workspace, {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 1,
      leaseId: 'lease-before-stop', deliveryAttemptId: 'attempt-before-stop',
      clientDirectiveId: 'directive-before-stop', runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-start', knownTurnIds: ['turn-old'] }
    })
    assert.ok(leased)
    await stopAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: leased.recordingId,
      idempotencyKey: 'boundary-stop-1'
    }, { watermark: 'wm-stop', knownTurnIds: ['turn-old', 'turn-live'] })
    assert.equal((await store.recordingContextForLease(workspace, {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 1,
      leaseId: 'lease-before-stop', deliveryAttemptId: 'attempt-before-stop',
      clientDirectiveId: 'directive-before-stop', runtimeId: 'codex', threadId: 'thread-1'
    }))?.recording.recordingId, leased.recordingId)
    assert.equal(await store.ensureAutomaticLease(workspace, {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 2,
      leaseId: 'lease-after-stop', deliveryAttemptId: 'attempt-after-stop',
      clientDirectiveId: 'directive-after-stop', runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-after-stop', knownTurnIds: [] }
    }), null)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('a settled lease is an immutable idempotency receipt and never reopens', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-settled-lease-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    const input = {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 1,
      leaseId: 'lease-settled', deliveryAttemptId: 'attempt-settled',
      clientDirectiveId: 'directive-settled', runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-settled', knownTurnIds: [] as string[] }
    }
    const first = await store.ensureAutomaticLease(workspace, input)
    assert.ok(first)
    await store.settleTurnBoundaryLease(workspace, {
      issuerEpoch: input.issuerEpoch,
      deliveryAttemptOrdinal: input.deliveryAttemptOrdinal,
      leaseId: input.leaseId,
      deliveryAttemptId: input.deliveryAttemptId,
      clientDirectiveId: input.clientDirectiveId,
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      state: 'released',
      turnId: 'turn-settled'
    })
    await store.ensureAutomaticLease(workspace, input)
    assert.equal(await store.turnBoundaryLeaseState(workspace, input.leaseId), 'released')
    await assert.rejects(store.ensureAutomaticLease(workspace, {
      ...input,
      deliveryAttemptId: 'attempt-changed'
    }), (error: unknown) => (error as { code?: string }).code === 'content-mismatch')
    await assert.rejects(store.ensureAutomaticLease(workspace, {
      ...input,
      leaseId: 'lease-changed-with-reused-ordinal',
      deliveryAttemptId: 'attempt-changed-with-reused-ordinal',
      clientDirectiveId: 'directive-changed-with-reused-ordinal'
    }), (error: unknown) => (error as { code?: string }).code === 'content-mismatch')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('Host durable owner reconciliation retains owners and retires only locally settled exact ordinals', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-owner-reconcile-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    const ensure = async (leaseId: string, deliveryAttemptOrdinal: number) => store.ensureAutomaticLease(workspace, {
      issuerEpoch: TEST_ISSUER_EPOCH,
      deliveryAttemptOrdinal,
      leaseId,
      deliveryAttemptId: `attempt-${leaseId}`,
      clientDirectiveId: `directive-${leaseId}`,
      runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: `wm-${leaseId}`, knownTurnIds: [] }
    })
    await ensure('watching', 1)
    await ensure('completed', 2)
    await ensure('retired', 3)
    await store.settleTurnBoundaryLease(workspace, {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 3,
      leaseId: 'retired', deliveryAttemptId: 'attempt-retired',
      clientDirectiveId: 'directive-retired', runtimeId: 'codex', threadId: 'thread-1',
      state: 'released', turnId: 'turn-retired'
    })
    await store.reconcileTurnBoundaryOwners({
      issuerEpoch: TEST_ISSUER_EPOCH,
      nextDeliveryAttemptOrdinal: 4,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [{ first: 3, last: 3 }],
      owners: [{
        issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 1,
        boundaryLeaseId: 'watching', deliveryAttemptId: 'attempt-watching',
        clientDirectiveId: 'directive-watching', runtimeId: 'codex', threadId: 'thread-1',
        workspaceRoot: workspace, phase: 'watching'
      }, {
        issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 2,
        boundaryLeaseId: 'completed', deliveryAttemptId: 'attempt-completed',
        clientDirectiveId: 'directive-completed', runtimeId: 'codex', threadId: 'thread-1',
        workspaceRoot: workspace, phase: 'completed-intent', turnId: 'turn-completed'
      }]
    })
    assert.equal(await store.turnBoundaryLeaseState(workspace, 'watching'), 'open')
    assert.equal(await store.turnBoundaryLeaseState(workspace, 'completed'), 'consumed')
    assert.equal(await store.turnBoundaryLeaseState(workspace, 'retired'), null)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('a stopped recording can start a new identity even when both timestamps are equal', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-new-series-'))
  try {
    const fixed = new Date('2026-08-11T08:00:00.000Z')
    const ids = ['research-recording:first', 'research-recording:second']
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: () => fixed,
      createRecordingId: () => ids.shift() ?? 'research-recording:unexpected'
    })
    const workspace = join(userDataDir, 'workspace')
    const first = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'new-series-start-1'
    })
    await stopAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      recordingId: first.recording.recordingId,
      idempotencyKey: 'new-series-stop-1'
    })
    const second = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'new-series-start-2'
    })
    assert.equal(second.created, true)
    assert.equal(second.recording.recordingId, 'research-recording:second')
    assert.equal((await store.status(workspace, 'codex', 'thread-1'))?.recordingId, second.recording.recordingId)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('stop persists automatic opt-out and a new explicit start re-enables it', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-automatic-policy-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'policy-start-1'
    })
    await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'policy-start-active-alias'
    })
    assert.equal(await store.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), true)
    await stopAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      recordingId: started.recording.recordingId,
      idempotencyKey: 'policy-stop-1'
    })

    const reopened = new ResearchCheckpointStore({ userDataDir })
    assert.equal(await reopened.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), false)
    await reopened.start(workspace, {
      runtimeId: 'codex', threadId: 'thread-1', expectedPolicyRevision: 1,
      idempotencyKey: 'policy-start-active-alias'
    })
    assert.equal(await reopened.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), false)
    await reopened.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      expectedPolicyRevision: 3,
      recordingId: started.recording.recordingId,
      idempotencyKey: 'policy-stop-stopped-alias'
    })
    assert.equal(await reopened.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), false)
    await startAtCurrentPolicy(reopened, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'policy-start-2'
    })
    assert.equal(await reopened.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), true)
    await reopened.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      expectedPolicyRevision: 3,
      recordingId: started.recording.recordingId,
      idempotencyKey: 'policy-stop-stopped-alias'
    })
    assert.equal(await reopened.automaticRecordingEnabled(workspace, 'codex', 'thread-1'), true)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('stop before any recording persists opt-out and old replay cannot disable a later start', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-policy-before-recording-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    const stopped = await stopAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'stop-before-recording'
    })
    assert.equal(stopped.recording, null)
    assert.deepEqual(await store.checkpointStatus(workspace, 'codex', 'thread-1'), {
      recordingMode: 'automatic', automaticEnabled: false, policyRevision: 1, recording: null
    })
    const skippedInput = {
      issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 1,
      leaseId: 'lease-while-disabled', deliveryAttemptId: 'attempt-while-disabled',
      clientDirectiveId: 'directive-while-disabled', runtimeId: 'codex', threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-disabled', knownTurnIds: [] }
    }
    assert.equal(await store.ensureAutomaticLease(workspace, skippedInput), null)
    assert.equal(await store.turnBoundaryLeaseState(workspace, skippedInput.leaseId), 'skipped')

    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'start-after-empty-stop'
    })
    assert.equal(started.created, true)
    assert.equal((await store.checkpointStatus(workspace, 'codex', 'thread-1')).automaticEnabled, true)
    assert.equal(await store.ensureAutomaticLease(workspace, skippedInput), null)
    const newAttempt = await store.ensureAutomaticLease(workspace, {
      ...skippedInput,
      deliveryAttemptOrdinal: 2,
      leaseId: 'lease-after-start',
      deliveryAttemptId: 'attempt-after-start',
      clientDirectiveId: 'directive-after-start'
    })
    assert.equal(newAttempt?.recordingId, started.recording.recordingId)
    assert.equal((await store.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1', expectedPolicyRevision: 0,
      idempotencyKey: 'stop-before-recording'
    })).recording, null)
    const status = await store.checkpointStatus(workspace, 'codex', 'thread-1')
    assert.equal(status.automaticEnabled, true)
    assert.equal(status.recording?.recordingId, started.recording.recordingId)
    assert.equal(status.recording?.state, 'active')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('automatic policy receipts remain globally and per-scope bounded with stale replay fail-closed', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-policy-receipt-cap-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({
      userDataDir,
      maxAutomaticPolicyReceiptsPerScope: 2,
      maxAutomaticPolicyReceipts: 3,
      now: clock()
    })
    for (let index = 0; index < 6; index += 1) {
      await stopAtCurrentPolicy(store, workspace, {
        runtimeId: 'codex', threadId: `thread-${index}`, idempotencyKey: `scope-stop-${index}`
      })
    }
    for (let index = 0; index < 4; index += 1) {
      const status = await store.checkpointStatus(workspace, 'codex', 'thread-5')
      if (status.automaticEnabled) {
        await stopAtCurrentPolicy(store, workspace, {
          runtimeId: 'codex', threadId: 'thread-5', idempotencyKey: `single-stop-${index}`
        })
      } else {
        await startAtCurrentPolicy(store, workspace, {
          runtimeId: 'codex', threadId: 'thread-5', idempotencyKey: `single-start-${index}`
        })
      }
    }
    const persisted = JSON.parse(await readFile(store.pathFor(workspace), 'utf8')) as {
      automaticPolicyReceipts: Array<{ runtimeId: string, threadId: string }>
    }
    assert.ok(persisted.automaticPolicyReceipts.length <= 3)
    assert.ok(persisted.automaticPolicyReceipts.filter((item) => (
      item.runtimeId === 'codex' && item.threadId === 'thread-5'
    )).length <= 2)
    await assert.rejects(store.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-0', expectedPolicyRevision: 0,
      idempotencyKey: 'scope-stop-0'
    }), (error: unknown) => (error as { code?: string }).code === 'content-mismatch')
    assert.equal((await store.checkpointStatus(workspace, 'codex', 'thread-0')).automaticEnabled, false)
    const fresh = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-0', idempotencyKey: 'scope-start-fresh'
    })
    assert.equal(fresh.policyRevision, 2)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('explicit stop recording identity must be the canonical recording for its exact scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-stop-recording-scope-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const otherWorkspace = join(userDataDir, 'other-workspace')
    const store = new ResearchCheckpointStore({ userDataDir, now: clock() })
    const firstThread = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'scope-thread-one-start'
    })
    const secondThread = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-2', idempotencyKey: 'scope-thread-two-start'
    })
    await assert.rejects(store.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-2', expectedPolicyRevision: 1,
      recordingId: firstThread.recording.recordingId,
      idempotencyKey: 'scope-cross-thread-stop'
    }), (error: unknown) => (error as { code?: string }).code === 'scope-mismatch')
    assert.deepEqual(await store.checkpointStatus(workspace, 'codex', 'thread-2'), {
      recordingMode: 'automatic',
      automaticEnabled: true,
      policyRevision: 1,
      recording: secondThread.recording
    })

    await stopAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      recordingId: firstThread.recording.recordingId,
      idempotencyKey: 'scope-first-series-stop'
    })
    const latestThreadOne = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'scope-second-series-start'
    })
    const beforeStaleStop = await store.checkpointStatus(workspace, 'codex', 'thread-1')
    await assert.rejects(store.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      expectedPolicyRevision: beforeStaleStop.policyRevision,
      recordingId: firstThread.recording.recordingId,
      idempotencyKey: 'scope-stale-series-stop'
    }), (error: unknown) => (error as { code?: string }).code === 'scope-mismatch')
    assert.deepEqual(
      await store.checkpointStatus(workspace, 'codex', 'thread-1'),
      beforeStaleStop
    )
    assert.equal(beforeStaleStop.recording?.recordingId, latestThreadOne.recording.recordingId)

    const other = await startAtCurrentPolicy(store, otherWorkspace, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'scope-other-workspace-start'
    })
    await assert.rejects(store.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1',
      expectedPolicyRevision: beforeStaleStop.policyRevision,
      recordingId: other.recording.recordingId,
      idempotencyKey: 'scope-cross-workspace-stop'
    }), (error: unknown) => (error as { code?: string }).code === 'not-found')
    assert.deepEqual(
      await store.checkpointStatus(workspace, 'codex', 'thread-1'),
      beforeStaleStop
    )
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('policy receipt compaction retains the newest operation across equal and rolled-back clocks', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-policy-receipt-order-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const timestamps = [
      new Date('2026-08-11T08:00:00.000Z'),
      new Date('2026-08-11T08:00:00.000Z'),
      new Date('2020-01-01T00:00:00.000Z')
    ]
    const store = new ResearchCheckpointStore({
      userDataDir,
      maxAutomaticPolicyReceiptsPerScope: 2,
      maxAutomaticPolicyReceipts: 2,
      now: () => timestamps.shift() ?? new Date('2010-01-01T00:00:00.000Z')
    })
    for (const [threadId, idempotencyKey] of [
      ['thread-1', 'same-clock-z-receipt'],
      ['thread-2', 'same-clock-a-receipt'],
      ['thread-3', 'rolled-back-newest-receipt']
    ] as const) {
      await store.stop(workspace, {
        runtimeId: 'codex', threadId, expectedPolicyRevision: 0, idempotencyKey
      })
    }
    const persisted = JSON.parse(await readFile(store.pathFor(workspace), 'utf8')) as {
      automaticPolicyOperationOrdinal: number
      automaticPolicyReceipts: Array<{ idempotencyKey: string, operationOrdinal: number }>
    }
    assert.equal(persisted.automaticPolicyOperationOrdinal, 3)
    assert.deepEqual(persisted.automaticPolicyReceipts.map((receipt) => [
      receipt.idempotencyKey,
      receipt.operationOrdinal
    ]), [
      ['rolled-back-newest-receipt', 3],
      ['same-clock-a-receipt', 2]
    ])

    const restarted = new ResearchCheckpointStore({
      userDataDir,
      maxAutomaticPolicyReceiptsPerScope: 2,
      maxAutomaticPolicyReceipts: 2
    })
    const replay = await restarted.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-3', expectedPolicyRevision: 0,
      idempotencyKey: 'rolled-back-newest-receipt'
    })
    assert.equal(replay.policyRevision, 1)
    assert.equal(replay.recording, null)
    await assert.rejects(restarted.stop(workspace, {
      runtimeId: 'codex', threadId: 'thread-1', expectedPolicyRevision: 0,
      idempotencyKey: 'same-clock-z-receipt'
    }), (error: unknown) => (error as { code?: string }).code === 'content-mismatch')
    assert.equal((await restarted.checkpointStatus(
      workspace,
      'codex',
      'thread-1'
    )).automaticEnabled, false)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('exact Host retirement ranges compact terminal leases without false-positive rejection', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-lease-retirement-'))
  try {
    const workspace = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock()
    })
    const hanging = {
      issuerEpoch: TEST_ISSUER_EPOCH,
      deliveryAttemptOrdinal: 1,
      leaseId: 'lease-thread-a-hanging',
      deliveryAttemptId: 'attempt-thread-a-hanging',
      clientDirectiveId: 'directive-thread-a-hanging',
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Research thread-1',
      boundary: { watermark: 'wm-thread-a-hanging', knownTurnIds: [] as string[] }
    }
    await store.ensureAutomaticLease(workspace, hanging)
    const inputs = Array.from({ length: 64 }, (_, index) => ({
      issuerEpoch: TEST_ISSUER_EPOCH,
      deliveryAttemptOrdinal: index + 2,
      leaseId: `lease-thread-b-${index + 2}`,
      deliveryAttemptId: `attempt-thread-b-${index + 2}`,
      clientDirectiveId: `directive-thread-b-${index + 2}`,
      runtimeId: 'codex',
      threadId: 'thread-2',
      title: 'Research thread-2',
      boundary: { watermark: `wm-thread-b-${index + 2}`, knownTurnIds: [] as string[] }
    }))
    for (const input of inputs) {
      await store.ensureAutomaticLease(workspace, input)
      await store.settleTurnBoundaryLease(workspace, {
        issuerEpoch: input.issuerEpoch,
        deliveryAttemptOrdinal: input.deliveryAttemptOrdinal,
        leaseId: input.leaseId,
        deliveryAttemptId: input.deliveryAttemptId,
        clientDirectiveId: input.clientDirectiveId,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        state: 'released',
        turnId: `turn-thread-b-${input.deliveryAttemptOrdinal}`
      })
    }
    await store.reconcileTurnBoundaryOwners({
      issuerEpoch: TEST_ISSUER_EPOCH,
      nextDeliveryAttemptOrdinal: 66,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [{ first: 2, last: 65 }],
      owners: [{
        issuerEpoch: TEST_ISSUER_EPOCH,
        deliveryAttemptOrdinal: 1,
        boundaryLeaseId: hanging.leaseId,
        deliveryAttemptId: hanging.deliveryAttemptId,
        clientDirectiveId: hanging.clientDirectiveId,
        runtimeId: hanging.runtimeId,
        threadId: hanging.threadId,
        workspaceRoot: workspace,
        phase: 'watching'
      }]
    })
    const persisted = JSON.parse(await readFile(store.pathFor(workspace), 'utf8')) as {
      preTurnOutputBindingSnapshots: unknown[]
      turnBoundaryRetirement: {
        retiredOrdinalRanges: Array<{ first: number, last: number }>
      }
      recordings: unknown[]
    }
    assert.equal(persisted.preTurnOutputBindingSnapshots.length, 1)
    assert.deepEqual(persisted.turnBoundaryRetirement.retiredOrdinalRanges, [{ first: 2, last: 65 }])
    assert.equal(persisted.recordings.length, 2)
    const reopened = new ResearchCheckpointStore({ userDataDir })
    await reopened.ensureAutomaticLease(workspace, hanging)
    assert.equal(await reopened.turnBoundaryLeaseState(workspace, hanging.leaseId), 'open')
    await assert.rejects(
      reopened.ensureAutomaticLease(workspace, inputs[0]!),
      /retired delivery attempt/u
    )
    const fresh = await reopened.ensureAutomaticLease(workspace, {
      ...inputs[0]!, issuerEpoch: TEST_ISSUER_EPOCH, deliveryAttemptOrdinal: 66,
      leaseId: 'lease-new-random-uuid',
      deliveryAttemptId: 'attempt-new-random-uuid',
      clientDirectiveId: 'directive-new-random-uuid'
    })
    assert.ok(fresh)
    assert.equal((await reopened.checkpointStatus(workspace, 'codex', 'thread-1')).recording?.state, 'active')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('queued turns freeze identity only when drained and stale rebase/discard releases successors', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-queue-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:queue'
    })
    const workspace = join(userDataDir, 'workspace')
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'queue-start-1'
    }, { watermark: 'wm-start', knownTurnIds: [] })
    const firstExtracted = extractCheckpointFromTurn(
      event('turn-1', 1),
      started.recording,
      workspace,
      new Map()
    )
    const secondExtracted = extractCheckpointFromTurn(
      event('turn-2', 2),
      started.recording,
      workspace,
      new Map()
    )
    const first = await store.enqueue(workspace, started.recording.recordingId, firstExtracted, 'commit-key-turn-1')
    const second = await store.enqueue(workspace, started.recording.recordingId, secondExtracted, 'commit-key-turn-2')
    assert.equal(first.artifactId, undefined)
    assert.equal(second.artifactId, undefined)
    assert.equal((await store.nextProcessable(workspace, started.recording.recordingId))?.operationId, first.operationId)

    const preparedFirst = await store.prepareOperation(workspace, first.operationId)
    const firstReceipt = receipt(preparedFirst.candidateId, 1)
    await store.markCommitted(workspace, first.operationId, firstReceipt, firstReceipt.version.transactionId)
    const preparedSecond = await store.prepareOperation(workspace, second.operationId)
    assert.equal(preparedSecond.artifactId, firstReceipt.ref.artifactId)
    assert.equal(preparedSecond.expectedCurrentVersionId, firstReceipt.ref.versionId)

    await store.markTerminalFailure(workspace, second.operationId, 'stale-conflict', 'current changed', true)
    const third = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-3', 3), started.recording, workspace, new Map()),
      'commit-key-turn-3'
    )
    assert.equal(await store.nextProcessable(workspace, started.recording.recordingId), null)

    const externalCurrent = receipt('external', 2, firstReceipt.ref.versionId).ref
    const rebased = await store.resolveConflict(workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: started.recording.recordingId,
      operationId: second.operationId,
      resolution: 'rebase',
      idempotencyKey: 'resolve-rebase-1'
    }, { ref: externalCurrent, ordinal: 2 })
    assert.equal(rebased.state, 'pending')
    assert.equal(rebased.preparedAt, undefined)
    const preparedRebase = await store.prepareOperation(workspace, second.operationId)
    assert.equal(preparedRebase.artifactId, externalCurrent.artifactId)
    assert.equal(preparedRebase.expectedCurrentVersionId, externalCurrent.versionId)

    await store.markTerminalFailure(workspace, second.operationId, 'stale-conflict', 'changed again', true)
    const discardInput = {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: started.recording.recordingId,
      operationId: second.operationId,
      resolution: 'discard' as const,
      idempotencyKey: 'resolve-discard-1'
    }
    const discarded = await store.resolveConflict(workspace, discardInput)
    assert.equal(discarded.state, 'failed')
    assert.equal((await store.resolveConflict(workspace, discardInput)).state, 'failed')
    await assert.rejects(
      store.resolveConflict(workspace, { ...discardInput, resolution: 'rebase' }),
      (error: unknown) => (error as { code?: string }).code === 'content-mismatch'
    )
    assert.equal((await store.nextProcessable(workspace, started.recording.recordingId))?.operationId, third.operationId)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('an unbound v1 checkpoint can rebase an output-only stale conflict', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-output-rebase-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:unbound-output-rebase'
    })
    const workspace = join(userDataDir, 'workspace')
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'unbound-output-rebase-start'
    })
    const queued = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('unbound-output-rebase-turn', 1), started.recording, workspace, new Map()),
      'unbound-output-rebase-commit'
    )
    const prepared = await store.prepareOperation(workspace, queued.operationId)
    assert.equal(prepared.artifactId, undefined)
    await store.markTerminalFailure(
      workspace,
      queued.operationId,
      'stale-conflict',
      'A workspace output current advanced concurrently.',
      true
    )
    const resolved = await store.resolveConflict(workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: started.recording.recordingId,
      operationId: queued.operationId,
      resolution: 'rebase',
      idempotencyKey: 'unbound-output-rebase-resolution'
    })
    assert.equal(resolved.state, 'pending')
    assert.equal(resolved.artifactId, undefined)
    assert.equal(resolved.preparedAt, undefined)
    assert.equal(resolved.frozenCommitDigest, undefined)
    assert.notEqual(resolved.idempotencyKey, prepared.idempotencyKey)
    const refrozen = await store.prepareOperation(workspace, queued.operationId)
    assert.equal(refrozen.expectedCurrentVersionId, null)
    assert.ok(refrozen.preparedAt)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('restored current becomes the exact base for the next queued checkpoint', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-restore-base-'))
  try {
    const store = new ResearchCheckpointStore({
      userDataDir,
      now: clock(),
      createRecordingId: () => 'research-recording:restore-base'
    })
    const workspace = join(userDataDir, 'workspace')
    const started = await startAtCurrentPolicy(store, workspace, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'restore-base-start'
    }, { watermark: 'wm-start', knownTurnIds: [] })
    const first = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-1', 1), started.recording, workspace, new Map()),
      'restore-base-v1'
    )
    const preparedFirst = await store.prepareOperation(workspace, first.operationId)
    const firstReceipt = receipt(preparedFirst.candidateId, 1)
    await store.markCommitted(workspace, first.operationId, firstReceipt, firstReceipt.version.transactionId)
    const second = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-2', 2), started.recording, workspace, new Map()),
      'restore-base-v2'
    )
    const preparedSecond = await store.prepareOperation(workspace, second.operationId)
    const secondReceipt = receipt(preparedSecond.candidateId, 2, firstReceipt.ref.versionId)
    await store.markCommitted(workspace, second.operationId, secondReceipt, secondReceipt.version.transactionId)

    const restored = receipt('restore:v1', 3, secondReceipt.ref.versionId)
    const adopted = await store.adoptRestoredVersion(workspace, {
      recordingId: started.recording.recordingId,
      artifactId: firstReceipt.ref.artifactId,
      expectedCurrentVersionId: secondReceipt.ref.versionId,
      restoredRef: restored.ref,
      ordinal: 3
    })
    assert.equal(adopted.currentVersionId, restored.ref.versionId)
    assert.equal(adopted.currentOrdinal, 3)
    assert.equal((await store.adoptRestoredVersion(workspace, {
      recordingId: started.recording.recordingId,
      artifactId: firstReceipt.ref.artifactId,
      expectedCurrentVersionId: secondReceipt.ref.versionId,
      restoredRef: restored.ref,
      ordinal: 3
    })).currentVersionId, restored.ref.versionId)

    const fourth = await store.enqueue(
      workspace,
      started.recording.recordingId,
      extractCheckpointFromTurn(event('turn-4', 4), adopted, workspace, new Map()),
      'restore-base-v4'
    )
    const preparedFourth = await store.prepareOperation(workspace, fourth.operationId)
    assert.equal(preparedFourth.artifactId, restored.ref.artifactId)
    assert.equal(preparedFourth.expectedCurrentVersionId, restored.ref.versionId)
    assert.equal(preparedFourth.changeKind, 'updated')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
