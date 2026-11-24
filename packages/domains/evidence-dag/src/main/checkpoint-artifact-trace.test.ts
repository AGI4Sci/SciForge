import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { DomainArtifactConsumer, DomainMainBeforeTurnEvent, DomainMainRuntimeLifecycleContext, DomainMainRuntimeLifecycleContribution, DomainTurnArtifactEvent } from '@sciforge/domain-sdk/host'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS, ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS, artifactVersionListResultV2Schema, createArtifactVersionEventListPortV1, type ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import { createDomainMainEntry as createArtifacts, type ArtifactVersionsCapabilityFactory, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import { createDomainMainEntry as createCheckpoints, type ResearchCheckpointsCapabilityFactory, type ResearchCheckpointsCapabilityOptions } from '@sciforge/domain-research-checkpoints/main'
import { researchCheckpointRecordV1Schema } from '@sciforge/domain-research-checkpoints/contract'
import { ResearchRecordRuntime } from './research-record.js'
import { appendCheckpointArtifactTrace, readCheckpointTurnArtifactReferences } from './checkpoint-artifact-trace.js'
import { createEvidenceArtifactVersionClient } from './artifact-version-client.js'
import { EvidenceArtifactVersionLifecycleConsumer } from './artifact-version-lifecycle-consumer.js'
import { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } from './evidence-delta.js'

const at = '2026-11-10T00:00:00.000Z'
const scope = { runtimeId: 'fixture', threadId: 'thread', workspaceRoot: resolve('/fixture/research'), knownTurnIds: ['turn'] }
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const policy = { visibility: 'workspace' as const, principals: [], allowExport: false }
function reference(name: string, bytes: Buffer): ArtifactVersionRefV1 {
  return { artifactId: `artifact:${name}`, versionId: `artifact-version:${name}`, contentDigest: hash(bytes), byteLength: bytes.length, mediaType: 'application/json', availability: 'available', retention: 'snapshot', accessPolicy: policy }
}
function fixture() {
  const outputBytes = Buffer.from('measured output')
  const output = reference('output', outputBytes)
  const manifest = { contractVersion: 1, kind: 'sciforge.research-checkpoint-manifest.v1',
    recording: { recordingId: 'research-recording:fixture', origin: 'live', runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceBindingDigest: 'b'.repeat(64) },
    turn: { turnId: 'turn', targetWatermark: '1', sequence: 1, occurredAt: at }, title: '实验结果', changeReason: '保留计算输出',
    narrative: { canonicalText: '保留输出，尚未独立复核', contentDigest: hash('保留输出，尚未独立复核') },
    sources: [], declaredFiles: [{ path: 'result.json', role: 'output', capture: 'host-turn-boundary-exact', artifactVersionRef: output }],
    artifactDependencies: [], computeRuns: [], gitCheckpoints: [], untrackedOperations: [], breakpoints: [],
    status: { execution: 'formal-references-present', provenance: 'pending', control: 'isolated-attested', reproduction: 'not-run', evidence: 'pending' } }
  const checkpointBytes = Buffer.from(JSON.stringify(manifest)), checkpoint = reference('checkpoint', checkpointBytes)
  const record = researchCheckpointRecordV1Schema.parse({ manifest, status: {
    runtimeId: scope.runtimeId, threadId: scope.threadId, turnId: 'turn', recordingId: manifest.recording.recordingId,
    operationId: `research-checkpoint-operation:${'a'.repeat(64)}`, changeReason: manifest.changeReason, attempts: 1, createdAt: at, updatedAt: at,
    state: 'committed', changeKind: 'new', title: manifest.title, artifactRef: checkpoint, ordinal: 1, inputs: [], outputs: ['result.json'],
    outputArtifacts: [{ path: 'result.json', role: 'output', capture: 'host-turn-boundary-exact', artifactOrdinal: 1, ref: output }],
    reproduction: { status: 'not-run' }, provenance: { status: 'pending' }, control: { status: 'isolated-attested' }, untrackedOperationCount: 0, evidence: { status: 'pending' }
  } })
  const calls: { action: string; input: Record<string, unknown> }[] = []
  let failRead = false, corruption = false, denyOutput = false, pending = false
  let statusOverride: unknown
  let pages = [{ ok: true, value: { records: [record] } }] as unknown[]
  const invoke = async (contract: { actionId: string }, input: Record<string, unknown>, options: { workspaceId: string }) => {
    assert.equal(options.workspaceId, scope.workspaceRoot)
    calls.push({ action: contract.actionId, input })
    if (contract.actionId === 'research-checkpoints.list') return pages[Math.min(calls.filter(call => call.action === contract.actionId).length - 1, pages.length - 1)]
    if (contract.actionId === 'research-checkpoints.read') return failRead ? { ok: false, issue: { code: 'not-found', message: 'missing checkpoint', retryable: false } } : { ok: true, value: record }
    if (contract.actionId === 'research-checkpoints.turn-status') {
      if (statusOverride) return { ok: true, value: statusOverride }
      if (pending) {
        const { state: _state, artifactRef: _ref, ordinal: _ordinal, title: _title, changeKind: _changeKind, inputs: _inputs, outputs: _outputs, outputArtifacts: _outputsRef, reproduction: _reproduction, provenance: _provenance, control: _control, untrackedOperationCount: _count, evidence: _evidence, ...base } = record.status
        return { ok: true, value: { ...base, state: 'pending' } }
      }
      return { ok: true, value: record.status }
    }
    if (contract.actionId !== 'artifact-versions.read') throw new Error(`Unexpected write or API: ${contract.actionId}`)
    const ref = input.versionId === checkpoint.versionId ? checkpoint : output
    if (denyOutput && ref === output) return { ok: false, issue: { code: 'access-restricted', message: 'denied' } }
    const bytes = ref === checkpoint ? checkpointBytes : corruption ? Buffer.from('corrupted') : outputBytes
    return { ok: true, value: { artifact: { artifactId: ref.artifactId, kind: ref === checkpoint ? 'research-checkpoint' : 'research-output', label: '实验材料', createdAt: at, updatedAt: at, currentVersionId: ref.versionId, versionCount: 1 },
      version: { schemaVersion: 1, versionId: ref.versionId, artifactId: ref.artifactId, sequence: 1, transactionId: 'artifact-commit:fixture', createdAt: at, intent: 'save', storage: { mode: 'snapshot', contentDigest: ref.contentDigest, byteLength: ref.byteLength, mediaType: ref.mediaType }, dependencies: [], accessPolicy: ref.accessPolicy, metadata: {} }, ref, dataBase64: bytes.toString('base64') } }
  }
  const context = { signal: new AbortController().signal, capabilities: { invoke } } as unknown as DomainMainRuntimeLifecycleContext
  return { context, record, checkpoint, output, calls, setPages: (value: unknown[]) => { pages = value }, setStatus: (value: unknown) => { statusOverride = value }, pending: (value: boolean) => { pending = value }, failRead: () => { failRead = true }, corrupt: () => { corruption = true }, deny: () => { denyOutput = true } }
}

test('initial checkpoint binds first exact output refs without writing or losing raw sources', async () => {
  const f = fixture(), raw = [{ content: 'first raw' }, { content: 'second raw' }]
  const trace = await appendCheckpointArtifactTrace(f.context, scope, raw)
  assert.deepEqual(trace.slice(0, 2), raw)
  assert.equal(trace.length, 4)
  assert.deepEqual(trace.slice(2).map(row => (row.artifactVersionRef as ArtifactVersionRefV1).versionId), [f.checkpoint.versionId, f.output.versionId])
  assert.ok(f.calls.every(call => call.action.endsWith('.read') || call.action.endsWith('.list') || call.action.endsWith('.turn-status')))
  assert.deepEqual(await appendCheckpointArtifactTrace(f.context, scope, trace), trace)
})

test('pagination is complete, repeated cursors and a bounded read never silently truncate', async () => {
  const f = fixture(), cursor = `research-checkpoint-operation:${'c'.repeat(64)}`
  f.setPages([{ ok: true, value: { records: [], nextCursor: cursor } }, { ok: true, value: { records: [f.record] } }])
  assert.equal((await appendCheckpointArtifactTrace(f.context, scope, [])).length, 2)
  assert.equal(f.calls.filter(call => call.action.endsWith('.list'))[1].input.cursor, cursor)
  const repeated = fixture()
  repeated.setPages([{ ok: true, value: { records: [], nextCursor: cursor } }])
  await assert.rejects(appendCheckpointArtifactTrace(repeated.context, scope, []), /repeated/)
  const bounded = fixture()
  bounded.setPages(Array.from({ length: 16 }, (_, index) => ({ ok: true, value: { records: [], nextCursor: `research-checkpoint-operation:${index.toString(16).padStart(64, '0')}` } })))
  await assert.rejects(appendCheckpointArtifactTrace(bounded.context, scope, []), /page budget/)
})

test('exact source read, current ACL, bytes, and fixed turn scope are required', async () => {
  const missing = fixture(); missing.failRead()
  await assert.rejects(appendCheckpointArtifactTrace(missing.context, scope, []), /unavailable/)
  const denied = fixture(); denied.deny()
  await assert.rejects(appendCheckpointArtifactTrace(denied.context, scope, []), /denied/)
  const corrupt = fixture(); corrupt.corrupt()
  await assert.rejects(appendCheckpointArtifactTrace(corrupt.context, scope, []), /bytes/)
  const other = fixture(); other.record.manifest.recording.threadId = 'other'
  await assert.rejects(appendCheckpointArtifactTrace(other.context, scope, []), /scope/)
  const future = fixture()
  await assert.rejects(appendCheckpointArtifactTrace(future.context, { ...scope, knownTurnIds: [] }, []), /scope/)
})

test('first lifecycle page gains checkpoint outputs and failure never acknowledges its cursor', async () => {
  for (const denied of [false, true]) {
    const f = fixture(); if (denied) f.deny()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'checkpoint-projection-'))), storagePath = join(root, 'state.json')
    const client = createEvidenceArtifactVersionClient(() => ({ commit: async () => { throw new Error('No commit') } }), () => ({ read: async () => { throw new Error('Already verified') } }))
    const chain = new EvidenceDeltaChain(`${scope.runtimeId}:${scope.threadId}`)
    let appended = 0
    const consumer = new EvidenceArtifactVersionLifecycleConsumer({ storagePath,
      eventListPort: () => ({ listEvents: async input => ({ ok: true, value: { events: input.afterSequence ? [] : [{ schemaVersion: 1, eventId: 'artifact-event:initial', sequence: 1, type: 'version-committed', artifactId: f.output.artifactId, versionId: f.output.versionId, createdAt: at, detail: {} }], lastSequence: 1 } }) }),
      discoverThreads: async () => [scope],
      prepareThread: async () => ({ ...scope, targetWatermark: '1', trace: await appendCheckpointArtifactTrace(f.context, scope, []) }),
      identities: client.identities, withLifecycle: client.withLifecycle,
      append: async input => { appended++; return chain.append(evidenceDagDeltaInputFromTrace({ ...input, threadId: `${scope.runtimeId}:${scope.threadId}` })) }
    })
    await consumer.start(false)
    if (denied) await assert.rejects(consumer.pollNow(true, scope), /denied/)
    else await consumer.pollNow(true, scope)
    await consumer.close()
    assert.equal(appended, denied ? 0 : 1)
    if (!denied) {
      const stored = JSON.parse(await readFile(storagePath, 'utf8'))
      assert.equal(stored.workspaces[0].cursor, 1)
      assert.ok(stored.threads[0].versionIds.includes(f.output.versionId))
    }
  }
})

test('committed Artifact with pending checkpoint receipt cannot acknowledge an empty projection', async () => {
  const f = fixture()
  f.setPages([{ ok: true, value: { records: [] } }]); f.pending(true)
  await assert.rejects(appendCheckpointArtifactTrace(f.context, scope, []), /not settled/)
  f.pending(false)
  await assert.rejects(appendCheckpointArtifactTrace(f.context, scope, []), /changed during projection/)
  f.setPages([{ ok: true, value: { records: [f.record] } }])
  assert.equal((await appendCheckpointArtifactTrace(f.context, scope, [])).length, 2)
})


test('settled archival failures do not block healthy refs, while retryable unknown outcomes do', async () => {
  for (const state of ['stale-conflict', 'failed'] as const) {
    const f = fixture()
    const { runtimeId, threadId, turnId, recordingId, operationId, changeReason, attempts, createdAt, updatedAt } = f.record.status
    const base = { runtimeId, threadId, turnId, recordingId, operationId, changeReason, attempts, createdAt, updatedAt }
    f.setStatus({ ...base, state, error: 'known terminal rejection', retryable: state === 'stale-conflict' })
    assert.equal((await appendCheckpointArtifactTrace(f.context, scope, [])).length, 2)
    f.setStatus({ ...base, state: 'failed', error: 'unknown transport outcome', retryable: true })
    await assert.rejects(appendCheckpointArtifactTrace(f.context, scope, []), /not settled/)
  }
})

test('legacy import from other fixed source turns stays out of this projection without cross-thread acceptance', async () => {
  const f = fixture()
  const legacy = structuredClone(f.record)
  legacy.manifest.recording.origin = 'legacy-import'
  legacy.manifest.turn.turnId = 'legacy-import-turn'
  legacy.manifest.importedTranscriptDigest = 'c'.repeat(64)
  legacy.manifest.importedTurnIds = ['older-turn']
  legacy.manifest.declaredFiles = []
  legacy.manifest.untrackedOperations = [{ kind: 'unknown', summary: 'historical import' }]
  legacy.manifest.breakpoints = [{ code: 'legacy-import', blocking: true, message: 'historical evidence unavailable' }]
  legacy.manifest.status = { execution: 'observed-untracked', provenance: 'incomplete', control: 'untracked', reproduction: 'not-run', evidence: 'unavailable' }
  legacy.status.turnId = 'legacy-import-turn'
  legacy.status.outputArtifacts = []; legacy.status.outputs = []
  const parsed = researchCheckpointRecordV1Schema.parse(legacy)
  f.setPages([{ ok: true, value: { records: [parsed, f.record] } }])
  assert.equal((await appendCheckpointArtifactTrace(f.context, scope, [])).length, 2)
  parsed.manifest.recording.threadId = 'another-thread'
  await assert.rejects(appendCheckpointArtifactTrace(f.context, scope, []), /scope/)
})


// Both owners are activated through their published main entries. Only the Host
// event source and capability routing are synthetic; no checkpoint status,
// Artifact receipt, lifecycle page, or Evidence delta is fabricated here.
for (const terminalState of ['failed', 'cancelled'] as const) test(`real ${terminalState} checkpoint reaches Evidence lifecycle delta once with exact output bytes`, async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'terminal-evidence-chain-')))
  const workspaceRoot = join(userDataDir, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  const localScope = { runtimeId: 'fixture', threadId: 'terminal-thread', workspaceRoot, knownTurnIds: ['terminal-turn'] }
  const listeners = new Set<(event: DomainMainBeforeTurnEvent) => void | Promise<void>>()
  const artifactEntry = createArtifacts<ArtifactVersionsCapabilityOptions>({ defineCapability: (value: ArtifactVersionsCapabilityOptions) => value } as never)
  const checkpointEntry = createCheckpoints<ResearchCheckpointsCapabilityOptions>({ defineCapability: (value: ResearchCheckpointsCapabilityOptions) => value } as never)
  const artifactFactory = artifactEntry.contributions.find(item => item.kind === 'main.capability-factory')!.value as ArtifactVersionsCapabilityFactory<ArtifactVersionsCapabilityOptions>
  const checkpointFactory = checkpointEntry.contributions.find(item => item.kind === 'main.capability-factory')!.value as ResearchCheckpointsCapabilityFactory<ResearchCheckpointsCapabilityOptions>
  const artifacts = new Map(artifactFactory.createDefinitions().map(item => [item.id, item]))
  const checkpoints = new Map(checkpointFactory.createDefinitions().map(item => [item.id, item]))
  const calls: string[] = []
  let corruptRead = false, denyRead = false, outputVersionId = ''
  const context = {
    owner: { moduleId: 'sciforge.research-checkpoints', moduleVersion: '1.0.0' }, principal: null,
    signal: new AbortController().signal, userDataDir, appRoot: userDataDir, environment: {},
    agentThreads: { list: async () => [], read: async () => ({ id: localScope.threadId, runtimeId: localScope.runtimeId, workspaceRoot, watermark: '0', turns: [], artifacts: [] }), hasActiveTurns: () => false },
    enablement: { isEnabled: async () => true, subscribe: () => () => undefined },
    turnEvents: { subscribe: () => () => undefined,
      subscribeRequiredBeforeTurn: (listener: (event: DomainMainBeforeTurnEvent) => void | Promise<void>) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'integration-epoch', nextDeliveryAttemptOrdinal: 1, retiredThroughOrdinal: 0, retiredOrdinalRanges: [], owners: [] }) },
    capabilities: { invoke: async (contract: { actionId: string }, input: unknown, options?: { workspaceId?: string }) => {
      calls.push(contract.actionId)
      assert.equal(options?.workspaceId, workspaceRoot)
      if (contract.actionId === 'git-checkpoints.list') return { ok: true, value: [] }
      const definition = artifacts.get(contract.actionId) ?? checkpoints.get(contract.actionId)
      assert.ok(definition, `Missing public capability ${contract.actionId}`)
      if (denyRead && contract.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.read) return { ok: false, issue: { code: 'access-restricted', message: 'Host revoked workspace read authorization' } }
      const result = await definition.handler(definition.inputSchema.parse(input), { caller: { audience: 'system', callerId: 'domain-runtime:sciforge.research-checkpoints', workspaceId: workspaceRoot,
        capabilityGrants: [ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities] } })
      const output = definition.outputSchema.parse(result.output)
      if (corruptRead && contract.actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.read && (input as { versionId: string }).versionId === outputVersionId) {
        const changed = structuredClone(output) as { ok: true; value: { dataBase64: string } }
        changed.value.dataBase64 = Buffer.from('tampered transport bytes').toString('base64')
        return changed
      }
      return output
    }, createApprovedBatch: () => { throw new Error('unexpected approval batch') } },
    log: () => undefined
  } as unknown as DomainMainRuntimeLifecycleContext
  const artifactLifecycle = artifactEntry.contributions.find(item => item.kind === 'main.runtime-lifecycle')!.value as DomainMainRuntimeLifecycleContribution
  const checkpointLifecycle = checkpointEntry.contributions.find(item => item.kind === 'main.runtime-lifecycle')!.value as DomainMainRuntimeLifecycleContribution
  const disposeArtifacts = await artifactLifecycle.activate(context)
  const disposeCheckpoints = await checkpointLifecycle.activate(context)
  let consumer: EvidenceArtifactVersionLifecycleConsumer | undefined
  try {
    const bytes = Buffer.from('x,y\n1,2\n'), patch = bytes.toString()
    const event: DomainTurnArtifactEvent = { contractVersion: 1, kind: 'turn-terminated', terminalState,
      runtimeId: localScope.runtimeId, threadId: localScope.threadId, turnId: 'terminal-turn', targetWatermark: '1', sequence: 1, workspaceRoot, occurredAt: at,
      issuerEpoch: 'integration-epoch', deliveryAttemptOrdinal: 1, boundaryLeaseId: 'terminal-lease', deliveryAttemptId: 'terminal-attempt', clientDirectiveId: 'terminal-directive',
      artifacts: [{ kind: 'assistant_message', text: 'Partial result only; execution terminated.' }],
      fileEffects: { contractVersion: 1, capture: 'host-turn-boundary', baselineDigest: hash('baseline'), baselineCapturedAt: at, terminalCapturedAt: at, issues: [],
        effects: [{ contractVersion: 1, kind: 'created', path: 'result.csv', byteLength: bytes.length, contentDigest: hash(bytes), dataBase64: bytes.toString('base64'), mediaType: 'text/csv' }] },
      filePatchReceipts: [{ contractVersion: 1, kind: 'host-authenticated-file-patch', issuer: 'sciforge.agent-runtime-host', source: 'codex-app-server-file-change', callId: 'write-result', executorSequence: 1,
        path: 'result.csv', operation: 'add', patchFormat: 'full-content', patchText: patch, patchDigest: hash(patch) }] }
    for (const listener of listeners) await listener({ ...event, kind: 'before-turn', state: 'starting', issuerEpoch: event.issuerEpoch!, deliveryAttemptOrdinal: 1,
      boundaryLeaseId: event.boundaryLeaseId!, deliveryAttemptId: event.deliveryAttemptId!, clientDirectiveId: event.clientDirectiveId! })
    await writeFile(join(workspaceRoot, 'result.csv'), 'external replacement after terminal boundary')
    const consume = (checkpointEntry.contributions.find(item => item.kind === 'main.artifact-consumer')!.value as DomainArtifactConsumer).consume
    await consume(event)
    const listDefinition = checkpoints.get('research-checkpoints.list')!
    let records: ReturnType<typeof researchCheckpointRecordV1Schema.parse>[] = []
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const result = await listDefinition.handler({ runtimeId: localScope.runtimeId, threadId: localScope.threadId }, { caller: { workspaceId: workspaceRoot } })
      const output = result.output as { ok: boolean; value?: { records: typeof records } }
      if (output.ok && output.value?.records.length) { records = output.value.records; break }
      await new Promise(resolveWait => setTimeout(resolveWait, 25))
    }
    assert.equal(records.length, 1)
    const record = researchCheckpointRecordV1Schema.parse(records[0])
    assert.equal(record.manifest.turn.terminalState, terminalState)
    assert.equal(record.status.outputArtifacts.length, 1)
    outputVersionId = record.status.outputArtifacts[0]!.ref.versionId
    assert.equal(record.status.outputArtifacts[0]!.ref.contentDigest, hash(bytes))
    const wrongWorkspaceRead = await artifacts.get(ARTIFACT_VERSIONS_CAPABILITY_IDS.read)!.handler({ versionId: outputVersionId },
      { caller: { audience: 'system', callerId: 'test-reader', workspaceId: join(userDataDir, 'unauthorized-workspace') } })
    assert.equal((wrongWorkspaceRead.output as { ok: boolean }).ok, false)
    const trace = await appendCheckpointArtifactTrace(context, localScope, [{ content: 'raw failure observation' }])
    assert.ok(trace.some(row => (row.artifactVersionRef as ArtifactVersionRefV1 | undefined)?.versionId === outputVersionId))
    const client = createEvidenceArtifactVersionClient(() => ({ commit: async () => { throw new Error('No Evidence writes') } }), () => ({ read: async () => { throw new Error('Trace already verified') } }))
    const chain = new EvidenceDeltaChain(`${localScope.runtimeId}:${localScope.threadId}`)
    const storagePath = join(userDataDir, 'lifecycle.json')
    let appended = 0
    consumer = new EvidenceArtifactVersionLifecycleConsumer({ storagePath,
      eventListPort: () => createArtifactVersionEventListPortV1(context.capabilities, workspaceRoot),
      discoverThreads: async () => [localScope], prepareThread: async () => ({ ...localScope, targetWatermark: '1', trace: await appendCheckpointArtifactTrace(context, localScope, []) }),
      identities: client.identities, withLifecycle: client.withLifecycle,
      append: async input => { appended++; return chain.append(evidenceDagDeltaInputFromTrace({ ...input, threadId: `${localScope.runtimeId}:${localScope.threadId}` })) } })
    await consumer.start(false)
    await consumer.pollNow(true, localScope)
    assert.equal(appended, 1)
    assert.ok(JSON.stringify(chain.auditSuffix({ deltas: 0, closures: 0, records: 0 }, 10).deltas).includes(outputVersionId))
    await consume(event)
    await consumer.pollNow(true, localScope)
    assert.equal(appended, 1)
    const historyDefinition = artifacts.get(ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2)!
    const history = artifactVersionListResultV2Schema.parse((await historyDefinition.handler({}, { caller: { audience: 'system', callerId: 'test-reader', workspaceId: workspaceRoot } })).output)
    if (!history.ok) assert.fail('Artifact history unavailable')
    assert.equal(history.value.items.length, 2)
    assert.ok(history.value.items.every(item => item.artifact.versionCount === 1))
    assert.equal(new Set(history.value.items.map(item => item.version.transactionId)).size, 1)
    await assert.rejects(async () => consume({ ...event, terminalState: terminalState === 'failed' ? 'cancelled' : 'failed' }), /boundary identity/)
    const cursor = JSON.parse(await readFile(storagePath, 'utf8')).workspaces[0].cursor
    denyRead = true
    await assert.rejects(appendCheckpointArtifactTrace(context, localScope, []), /authorization|restricted/)
    denyRead = false; corruptRead = true
    await assert.rejects(appendCheckpointArtifactTrace(context, localScope, []), /bytes/)
    assert.equal(JSON.parse(await readFile(storagePath, 'utf8')).workspaces[0].cursor, cursor)
    assert.equal(await readFile(join(workspaceRoot, 'result.csv'), 'utf8'), 'external replacement after terminal boundary')
    assert.ok(!calls.includes(ARTIFACT_VERSIONS_CAPABILITY_IDS.observe))
  } finally {
    await consumer?.close(); await disposeCheckpoints?.(); await disposeArtifacts?.()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('selected turn archive references are bounded and failures remain explicitly partial', async () => {
  const f = fixture()
  const value = await readCheckpointTurnArtifactReferences(f.context, scope)
  assert.deepEqual(value.refs.map(ref => ref.versionId), [f.checkpoint.versionId, f.output.versionId])
  assert.equal(value.limited, false)
  assert.equal(f.calls.some(call => call.action.endsWith('.list')), false)
  const one = await readCheckpointTurnArtifactReferences(f.context, scope, 1)
  assert.equal(one.refs.length, 1); assert.equal(one.limited, true)
  f.deny()
  const denied = await readCheckpointTurnArtifactReferences(f.context, scope)
  assert.equal(denied.limited, true)
  assert.ok(denied.refs.every(ref => ref.versionId !== f.output.versionId))
  f.pending(true)
  const pending = await readCheckpointTurnArtifactReferences(f.context, scope)
  assert.deepEqual(pending, { refs: [], limited: true })
})

test('record inspector resolves newly archived outputs through public owners while preserving raw text on archive failure', async () => {
  const f = fixture(), root = await realpath(await mkdtemp(join(tmpdir(), 'record-archive-bridge-')))
  const detail = { id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot, watermark: '1',
    artifacts: [], turns: [{ id: 'turn', status: 'failed', createdAt: at, artifacts: [{ id: 'answer', kind: 'assistant_message', text: '已写入部分结果，执行失败。' }], messages: [] }] }
  const context = { ...f.context, log: () => {}, agentThreads: { list: async () => [detail], read: async () => detail } } as unknown as DomainMainRuntimeLifecycleContext
  const runtime = new ResearchRecordRuntime({ userDataDir: root, pollMs: 60000 })
  runtime.start(context, true)
  try {
    await runtime.scan()
    let sourceId = ''
    const visit = async (nodeId = 'root'): Promise<void> => {
      const view = await runtime.view({ runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceRoot: scope.workspaceRoot, nodeId })
      for (const node of view.children) { if (node.source?.itemId === 'answer') sourceId = node.id; else if (!node.source) await visit(node.id) }
    }
    await visit()
    assert.ok(sourceId)
    const first = await runtime.view({ runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceRoot: scope.workspaceRoot, nodeId: sourceId, includeScientificReview: true })
    assert.ok(first.auditReferences?.refs.some(ref => ref.versionId === f.output.versionId))
    assert.equal(first.auditReferences?.limited, false)
    assert.ok(first.raw)
    f.failRead()
    const failed = await runtime.view({ runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceRoot: scope.workspaceRoot, nodeId: sourceId, includeScientificReview: true })
    assert.deepEqual(failed.raw, first.raw)
    assert.deepEqual(failed.auditReferences, { refs: [], limited: true })
    const beforeDenied = f.calls.length
    Object.assign(context.agentThreads, { readMetadata: async (input: { threadId: string }) => {
      if (input.threadId === 'other-session') return { ...detail, id: 'other-session' }
      throw new Error('source thread no longer authorized')
    } })
    const denied = await runtime.view({ runtimeId: scope.runtimeId, threadId: 'other-session', workspaceRoot: scope.workspaceRoot, nodeId: sourceId, includeScientificReview: true })
    assert.equal(denied.raw, undefined)
    assert.deepEqual(denied.auditReferences, { refs: [], limited: true })
    assert.equal(f.calls.length, beforeDenied)
  } finally { await runtime.close() }
})
