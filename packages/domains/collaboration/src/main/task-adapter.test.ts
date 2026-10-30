import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  agentInboxMessageSchema,
  cloudResourceRefSchema,
  createCollaborationError,
  deliveryCandidateSchema,
  deliveryManifestDigest,
  deliveryManifestSchema,
  restRequestSchema,
  restResponseSchema,
  taskOfferSchema,
  taskExecutionPreflightSchema,
  taskExecutionSchema,
  taskSchema,
  workerDeliveryConfirmationDigest,
  type DeliveryCandidate,
  type DeliveryRevisionRecord,
  type RestRequest,
  type RestResponse,
  type Task,
  type TaskExecution
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_HASH,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  humanAnswerFixture,
  humanNeededFixture,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  domainMainAgentExecutionSessionRequestSchema,
  type DomainMainAgentExecutionHost,
  type DomainMainHumanActionsHost
} from '@sciforge/domain-sdk/host'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { AgentCloudRuntimeError } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DeviceFactAttestationSigningService } from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import { collaborationTaskViewSchema } from '../contract.js'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  FileCollaborationStateBackend,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { TaskInteractionJournal } from './task-interaction-journal.js'
import {
  CollaborationTaskAdapter,
  collaborationWorkerSessionTitle
} from './task-adapter.js'
import { collaborationTaskViewForRun } from './runtime.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'
import {
  WORKER_RESULT_SUMMARY_MAX_CODE_POINTS,
  workerRuntimeResultOutputSchema
} from '../worker-runtime-result.js'

const OFFER_ID = 'ofr_Offer0000001'
const SUPERSEDING_EXECUTION_ID = 'exe_Exec00000002'
const INPUT_RESOURCE_ID = 'rrf_InputFile0001'
const INPUT_MATERIAL_REVISION_ID = 'mat_Material00001'
const INPUT_BYTES = new TextEncoder().encode('a,b\n')
const INPUT_OBJECT = {
  objectId: 'obj_InputObject001',
  objectKey: 'cloud/input-object-alpha',
  revision: 2,
  sha256: createHash('sha256').update(INPUT_BYTES).digest('hex'),
  byteCount: INPUT_BYTES.byteLength,
  mediaType: 'text/csv',
  projectId: 'prj_Proj00000001',
  visibility: 'project_public' as const,
  ownerUserId: 'usr_User00000002',
  retentionUntil: null
}
const FILE_LOCATOR = {
  kind: 'collaboration.object-reference' as const,
  source: { kind: 'shared_material' as const, materialRevisionId: INPUT_MATERIAL_REVISION_ID },
  object: INPUT_OBJECT
}
const FILE_LOCATOR_DIGEST = digestFixture(FILE_LOCATOR)
const DELETED_PROJECT_FENCE = {
  kind: 'permanent',
  reason: 'Cloud deleted this Project; local execution was fenced.'
} as const

type SessionAdmissionSnapshot = Awaited<ReturnType<NonNullable<DomainMainAgentExecutionHost['readAdmission']>>>
type SessionOutputEvent = Parameters<CollaborationTaskAdapter['acceptSessionOutput']>[0]

test('Slice C selected files persist with summary CAS and freeze through the existing multi-object saga', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  const created = await startSliceAWorker(cloud)
  const run = created.store.snapshot().taskRuns[0]!
  await mkdir(join(run.workspaceRoot, 'figures'), { recursive: true })
  await writeFile(join(run.workspaceRoot, 'figures/analysis.md'), 'Same basename, different bytes')
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'x,y\n1,2')
  const before = created.adapter.workerDeliveryView(deliveryIdentity()).draft!
  const saved = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Three exact files',
    expectedDraftRevision: before.revision, selectedMaterials: [{ relativePath: 'figures/analysis.md' }, { relativePath: 'data.csv' }] })
  assert.equal(saved.draft!.outputs.length, 3)
  await assert.rejects(created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Stale selection',
    expectedDraftRevision: before.revision, selectedMaterials: [] }), /更新/u)
  assert.equal(created.adapter.workerDeliveryView(deliveryIdentity()).draft!.selectedMaterials.length, 2)
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'x,y\n3,4')
  await assert.rejects(created.adapter.submitWorkerDelivery({ target: saved.confirmationTarget! }), /新改动/u)
  const submitted = await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  assert.equal(submitted.state, 'sealed')
  const frozen = created.store.snapshot().taskRuns[0]!.frozenCandidate!
  assert.equal(frozen.bundle.schemaVersion, 2)
  assert.equal(frozen.outputFiles.length, 3)
  assert.equal(new Set(frozen.outputFiles.map(({ path }) => path)).size, 3)
  assert.deepEqual(frozen.bundle.outputs.map(({ role }) => role), ['declared', 'member', 'member'])
  assert.equal(await readFile(frozen.outputFiles[2]!.path, 'utf8'), 'x,y\n3,4')
  assert.equal(cloud.commands.filter((command) => command === 'object.stage').length, 4)
  assert.equal(submitted.history[0]!.manifest.outputs!.length, 3)
})

test('Slice C missing selected material keeps the saved selection and explanation, blocks confirmation, and recovers', async () => {
  const created = await startSliceAWorker(new FakeWorkerCloud())
  const run = created.store.snapshot().taskRuns[0]!
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'preserved data')
  const saved = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Keep my explanation',
    expectedDraftRevision: created.adapter.workerDeliveryView(deliveryIdentity()).draft!.revision,
    selectedMaterials: [{ relativePath: 'data.csv' }] })
  await unlink(join(run.workspaceRoot, 'data.csv'))
  const missing = await created.adapter.refreshWorkerDelivery(deliveryIdentity())
  assert.match(missing.draft!.materialError!, /data.csv/u)
  assert.equal(missing.confirmationTarget, null)
  assert.equal(missing.draft!.summary, 'Keep my explanation')
  assert.deepEqual(missing.draft!.selectedMaterials, saved.draft!.selectedMaterials)
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'restored data')
  const restored = await created.adapter.refreshWorkerDelivery(deliveryIdentity())
  assert.equal(restored.draft!.materialError, null)
  assert.ok(restored.confirmationTarget)
})

test('Slice C local schema migration preserves edited explanation and sealed v1 bytes without inventing file provenance', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  const created = await startSliceAWorker(cloud)
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const raw = JSON.parse(JSON.stringify(created.store.snapshot()))
  const run = raw.taskRuns[0]
  const legacyBundle = { ...run.frozenCandidate.bundle, schemaVersion: 1,
    outputs: run.frozenCandidate.bundle.outputs.map(({ fileName, mediaType, byteCount, sha256 }: { fileName: string; mediaType: string; byteCount: number; sha256: string }) => ({ fileName, mediaType, byteCount, sha256 })) }
  const legacyDigest = digestFixture(legacyBundle)
  run.frozenCandidate.bundle = legacyBundle
  run.frozenCandidate.contract.inputReferences = [{ kind: 'project_result', referenceId: 'res_LegacyInput001', revision: 1, digest: TEST_HASH }]
  run.frozenCandidate.bundleDigest = legacyDigest
  run.deliveryHistory[0].candidate = structuredClone(run.frozenCandidate)
  run.deliveryHistory[0].manifest.contract = structuredClone(run.frozenCandidate.contract)
  delete run.deliveryHistory[0].manifest.outputs
  run.deliveryHistory[0].manifest.bundleDigest = legacyDigest
  const legacyBytes = Buffer.from(canonicalFixture(legacyBundle))
  const manifestBundle = run.deliveryHistory[0].manifest.objects.find((object: { objectId: string }) => object.objectId === run.deliveryHistory[0].manifest.bundleObjectId)
  manifestBundle.sha256 = legacyDigest
  manifestBundle.byteCount = legacyBytes.length
  delete run.deliveryHistory[0].manifest.manifestDigest
  run.deliveryHistory[0].manifest.manifestDigest = deliveryManifestDigest(run.deliveryHistory[0].manifest)
  run.deliverySaga = null
  run.state = 'waiting-result-confirm'
  run.completedAt = null
  run.deliveryDraft.summary = 'Preserve my editable explanation'
  run.deliveryDraft.summaryEdited = true
  run.deliveryDraft.outputs = legacyBundle.outputs
  delete run.deliveryDraft.selectedMaterials
  delete run.deliveryDraft.materialError
  raw.schemaVersion = 3
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-delivery-migration-'))
  try {
    const path = join(directory, 'state.json')
    const bundlePath = join(directory, 'legacy-bundle.json')
    await writeFile(bundlePath, legacyBytes)
    for (const candidate of [run.frozenCandidate, run.deliveryHistory[0].candidate]) {
      candidate.bundleFile = { ...candidate.bundleFile, path: bundlePath, sha256: legacyDigest, byteCount: legacyBytes.length }
    }
    await writeFile(path, JSON.stringify(raw))
    const store = new CollaborationLocalStore(new FileCollaborationStateBackend(path))
    const migrated = await store.open()
    assert.equal(migrated.schemaVersion, 4)
    assert.equal(migrated.taskRuns[0]!.deliveryDraft!.summary, 'Preserve my editable explanation')
    assert.equal(migrated.taskRuns[0]!.deliveryDraft!.summaryEdited, true)
    assert.deepEqual(migrated.taskRuns[0]!.deliveryDraft!.outputs, [])
    assert.deepEqual(migrated.taskRuns[0]!.deliveryHistory[0]!.candidate.bundle, legacyBundle)
    assert.equal(migrated.taskRuns[0]!.deliveryHistory[0]!.candidate.bundleDigest, legacyDigest)
    assert.deepEqual(migrated.taskRuns[0]!.deliveryHistory[0]!.candidate.contract.inputReferences, [{ kind: 'project_result', referenceId: 'res_LegacyInput001', revision: 1, digest: TEST_HASH }])
    assert.deepEqual(await readFile(migrated.taskRuns[0]!.deliveryHistory[0]!.candidate.bundleFile.path), legacyBytes)
    const reopened = await new CollaborationLocalStore(new FileCollaborationStateBackend(path)).open()
    assert.deepEqual(reopened.taskRuns[0]!.deliveryHistory, migrated.taskRuns[0]!.deliveryHistory)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('Slice C adopted snapshot input uses exact object bytes and pins manifest plus object in the frozen Contract', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  cloud.adoptedInput = true
  const created = await startSliceAWorker(cloud)
  const run = created.store.snapshot().taskRuns[0]!
  assert.deepEqual(await readFile(join(run.workspaceRoot, 'input.csv')), Buffer.from(INPUT_BYTES))
  assert.deepEqual(cloud.objectReadRequests, [{ projectId: TEST_IDS.projectId, deliveryManifestId: 'mft_AdoptedInput001', objectId: INPUT_OBJECT.objectId }])
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  assert.deepEqual(created.store.snapshot().taskRuns[0]!.frozenCandidate!.contract.inputReferences, [{
    kind: 'adopted_delivery', referenceId: 'mft_AdoptedInput001', objectId: INPUT_OBJECT.objectId,
    revision: INPUT_OBJECT.revision, digest: INPUT_OBJECT.sha256
  }])
})

test('Slice C a failed object upload resumes the same frozen bundle and ordered files without a second submission path', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  let failed = false
  const staged = new Map<string, Awaited<ReturnType<DurableCloudOutbox['stageAndWait']>>>()
  const created = await startSliceAWorker(cloud, 'completed', undefined, { outboxFactory: () => {
    const outbox = cloud.outbox()
    const stage = outbox.stageAndWait.bind(outbox)
    outbox.stageAndWait = async (request, path) => {
      const previous = staged.get(request.idempotencyKey)
      if (previous) return previous
      if (request.idempotencyKey.endsWith('output.1') && !failed) { failed = true; throw new Error('Transient object upload failure') }
      const result = await stage(request, path)
      staged.set(request.idempotencyKey, result)
      return result
    }
    return outbox
  } })
  const run = created.store.snapshot().taskRuns[0]!
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'original selected bytes')
  const saved = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Preserved submission',
    expectedDraftRevision: created.adapter.workerDeliveryView(deliveryIdentity()).draft!.revision,
    selectedMaterials: [{ relativePath: 'data.csv' }] })
  const input = { target: saved.confirmationTarget! }
  await assert.rejects(created.adapter.submitWorkerDelivery(input), /upload failure/u)
  const interrupted = created.store.snapshot().taskRuns[0]!
  const candidateId = interrupted.frozenCandidate!.candidateId
  assert.equal(interrupted.deliveryDraft!.summary, 'Preserved submission')
  assert.deepEqual(interrupted.deliveryDraft!.selectedMaterials, [{ relativePath: 'data.csv' }])
  await writeFile(join(run.workspaceRoot, 'data.csv'), 'workspace changed after freeze')
  const submitted = await created.adapter.submitWorkerDelivery(input)
  assert.equal(submitted.state, 'sealed')
  assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate!.candidateId, candidateId)
  assert.equal(await readFile(created.store.snapshot().taskRuns[0]!.frozenCandidate!.outputFiles[1]!.path, 'utf8'), 'original selected bytes')
  assert.equal(cloud.commands.filter((command) => command === 'object.stage').length, 3)
  assert.equal(cloud.commands.filter((command) => command === 'delivery.candidate.create').length, 1)
})

test('Slice C submits an A-era accepted Project Result Contract unchanged using the authoritative dashboard reference', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  cloud.historicalInput = true
  const created = await startSliceAWorker(cloud)
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const contract = created.store.snapshot().taskRuns[0]!.frozenCandidate!.contract
  assert.deepEqual(contract.inputReferences, [{ kind: 'project_result', referenceId: 'res_LegacyInput001',
    revision: INPUT_OBJECT.revision, digest: INPUT_OBJECT.sha256 }])
  assert.equal(contract.contractDigest, cloud.execution.contractDigest)
})

test('Slice C submission fails recoverably when the exact accepted Contract cannot be synchronized', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  const created = await startSliceAWorker(cloud)
  const input = await deliverySubmitInput(created.adapter)
  cloud.dashboardAvailable = false
  await assert.rejects(created.adapter.submitWorkerDelivery(input), /任务要求尚未同步/u)
  assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
  assert.equal(created.adapter.workerDeliveryView(deliveryIdentity()).draft!.summary, 'Initial AI summary')
  cloud.dashboardAvailable = true
  assert.equal((await created.adapter.submitWorkerDelivery(input)).state, 'sealed')
})

test('Slice C dashboard refresh cannot redirect frozen snapshot writes through a replaced task root', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  const created = await startSliceAWorker(cloud)
  const input = await deliverySubmitInput(created.adapter)
  const workspaceRoot = created.store.snapshot().taskRuns[0]!.workspaceRoot
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-delivery-root-swap-'))
  const backup = join(directory, 'original')
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'analysis.md'), 'Initial file')
  let swapped = false
  cloud.dashboardRefreshHook = async () => {
    await rename(workspaceRoot, backup)
    await symlink(outside, workspaceRoot)
    swapped = true
  }
  try {
    await assert.rejects(created.adapter.submitWorkerDelivery(input), /工作目录.*符号链接|工作目录.*改动/u)
    assert.deepEqual(await readdir(outside), ['analysis.md'])
    assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
    assert.equal(cloud.commands.includes('object.stage'), false)
  } finally {
    if (swapped) { await unlink(workspaceRoot); await rename(backup, workspaceRoot) }
    await rm(directory, { recursive: true, force: true })
  }
})

test('Slice A ordinary member text marks the existing draft changed without a strict JSON error', async () => {
  const cloud = new FakeWorkerCloud()
  const created = await startSliceAWorker(cloud)
  const run = created.store.snapshot().taskRuns[0]!
  await created.adapter.acceptSessionOutput({ runtimeId: run.runtimeId!, threadId: run.threadId!,
    turnId: 'member-plain-text', revision: 1, state: 'completed' }, async () => ({
    id: run.threadId!, runtimeId: run.runtimeId!, watermark: '1', artifacts: [], turns: [{
      id: 'member-plain-text', artifacts: [], messages: [{ itemId: 'plain-final', kind: 'assistant-final', text: 'README 已按你的要求改好。' }]
    }]
  }))
  assert.equal(created.store.snapshot().taskRuns[0]!.error, null)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft?.summary, 'Initial AI summary')
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft?.changed, true)
  assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
})

test('Slice A AI completion only prefills a local draft and never freezes a candidate', async () => {
  const created = await startSliceAWorker(new FakeWorkerCloud())
  assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft?.summary, 'Initial AI summary')
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft?.resultRevision, 1)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft?.changed, false, 'the first completed draft is ready; later turns mark changes')
})

test('Slice A edited summary and file-only changes freeze at submission and keep copied bytes immutable', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  const created = await startSliceAWorker(cloud)
  const run = created.store.snapshot().taskRuns[0]!
  const draft = created.adapter.workerDeliveryView(TEST_IDS).draft!
  const saved = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Member confirmed explanation',
    expectedDraftRevision: draft.revision })
  await writeFile(join(run.workspaceRoot, 'analysis.md'), 'Only a file edit, no new Session message')
  await assert.rejects(created.adapter.submitWorkerDelivery({ target: saved.confirmationTarget! }), /新改动/u)
  const submitted = await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const frozen = created.store.snapshot().taskRuns[0]!.frozenCandidate!
  assert.equal(submitted.state, 'sealed')
  assert.equal(frozen.bundle.summary, 'Member confirmed explanation')
  assert.equal(frozen.bundle.outputs[0]!.sha256, createHash('sha256').update('Only a file edit, no new Session message').digest('hex'))
  assert.notEqual(frozen.outputFiles[0]!.path, join(run.workspaceRoot, 'analysis.md'))
  await writeFile(join(run.workspaceRoot, 'analysis.md'), 'Later workspace changes')
  assert.equal(await readFile(frozen.outputFiles[0]!.path, 'utf8'), 'Only a file edit, no new Session message')
  await assert.rejects(created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Cannot edit sealed delivery',
    expectedDraftRevision: saved.draft!.revision }), /已提交|只读/u)
})

test('Slice A local draft save preserves member edits when a later AI result offers a replacement', async () => {
  const created = await startSliceAWorker(new FakeWorkerCloud())
  const initial = created.adapter.workerDeliveryView(TEST_IDS).draft!
  const saved = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'My own explanation', expectedDraftRevision: initial.revision })
  const run = created.store.snapshot().taskRuns[0]!
  await created.adapter.acceptSessionOutput({ runtimeId: run.runtimeId!, threadId: run.threadId!, turnId: 'new-ai-summary', revision: 1,
    state: 'completed' }, async () => ({ id: run.threadId!, runtimeId: run.runtimeId!, watermark: '1', artifacts: [], turns: [{
    id: 'new-ai-summary', artifacts: [], messages: [{ itemId: 'final', kind: 'assistant-final', text: completedWorkerResultText('A newer AI explanation') }]
  }] }))
  const changed = created.adapter.workerDeliveryView(TEST_IDS).draft!
  assert.equal(changed.summary, 'My own explanation')
  assert.equal(changed.aiSummary, 'A newer AI explanation')
  await assert.rejects(created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Stale save', expectedDraftRevision: saved.draft!.revision }), /更新/u)
  const kept = await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: changed.summary,
    expectedDraftRevision: changed.revision, aiSummaryDecision: 'keep' })
  assert.equal(kept.draft!.aiSummary, null)
  assert.equal(created.store.snapshot().taskRuns[0]!.deliveryDraft?.summary, 'My own explanation')
})

test('Slice A a stopped adapter turn keeps its Cloud execution open and its draft editable', async () => {
  const created = await startSliceAWorker(new FakeWorkerCloud(), 'cancelled')
  const run = created.store.snapshot().taskRuns[0]!
  assert.equal(run.execution!.state, 'running')
  assert.equal(run.completedAt, null)
  assert.equal(run.agentJournal.at(-1)!.runtimeState, 'cancelled')
  assert.ok(created.adapter.workerDeliveryView(TEST_IDS).draft)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.summary, '')
  created.adapter.wake()
  await created.adapter.waitForIdle()
  assert.equal(created.store.snapshot().taskRuns[0]!.agentJournal.length, 1, 'heartbeat cannot restart a stopped turn without a new member input')
})

for (const failure of [
  { state: 'cancelled', code: 'runtime_interrupted', message: '本轮执行已中断。', retryable: false },
  { state: 'cancelled', code: 'runtime_cancelled', message: '本轮执行已取消。', retryable: false },
  { state: 'failed', code: 'model_capacity', message: 'Upstream returned HTTP 429.', retryable: true },
  { state: 'failed', code: 'runtime_failed', message: 'Agent turn failed.', retryable: false }
] as const) {
  test(`ended ${failure.code} turn allows editing, human submission and explicit reexecution`, async () => {
    const cloud = new FakeWorkerCloud()
    cloud.validDeliveryManifest = true
    let attempts = 0
    const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, run: async (input) => {
      attempts += 1
      await mkdir(input.workspaceRoot!, { recursive: true })
      await writeFile(join(input.workspaceRoot!, 'analysis.md'), 'Retained output from an unfinished turn')
      return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: `ended-turn-${attempts}`,
        state: failure.state, text: '', failure: { code: failure.code, message: failure.message, retryable: failure.retryable } }
    } }, emptyState())
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await created.adapter.waitForIdle()
    let run = created.store.snapshot().taskRuns[0]!
    const view = collaborationTaskViewForRun(run)
    assert.equal(view.failure?.code, failure.code, JSON.stringify(run.agentJournal))
    assert.equal(view.failure?.retryState, 'available')
    assert.ok(view.reexecutionInputId)
    assert.equal(run.execution!.state, 'running')
    created.adapter.wake()
    await created.adapter.waitForIdle()
    assert.equal(attempts, 1, 'an ended turn never causes automatic reexecution')
    await created.adapter.submitTaskInteraction({ ...deliveryIdentity(), kind: 'retry' })
    assert.equal(attempts, 2, 'one explicit retry dispatches exactly one new turn')
    run = created.store.snapshot().taskRuns[0]!
    await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Member completed and reviewed the output.',
      expectedDraftRevision: run.deliveryDraft!.revision })
    await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).state, 'sealed')
    assert.equal(cloud.commands.includes('task.execution.fail'), false)
  })
}

test('Slice A empty member explanation is rejected without losing the saved draft', async () => {
  const created = await startSliceAWorker(new FakeWorkerCloud())
  const prior = await deliverySubmitInput(created.adapter)
  await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: '',
    expectedDraftRevision: created.adapter.workerDeliveryView(TEST_IDS).draft!.revision })
  await assert.rejects(created.adapter.submitWorkerDelivery(prior), /请填写结果说明/u)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.summary, '')
  assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
})

test('Slice A submission rejects both internal and external output symlinks before staging bytes', async () => {
  for (const outside of [false, true]) {
    const cloud = new FakeWorkerCloud('offered', true)
    const created = await startSliceAWorker(cloud)
    const run = created.store.snapshot().taskRuns[0]!
    const input = await deliverySubmitInput(created.adapter)
    const output = join(run.workspaceRoot, 'analysis.md')
    const target = outside ? join(tmpdir(), `sciforge-outside-${Date.now()}.txt`) : join(run.workspaceRoot, 'other.txt')
    await writeFile(target, 'These bytes must never be staged through a symlink')
    await unlink(output)
    await symlink(target, output)
    try {
      await assert.rejects(created.adapter.submitWorkerDelivery(input), /符号链接/u)
      assert.equal(cloud.commands.includes('object.stage'), false)
      assert.equal(created.store.snapshot().taskRuns[0]!.frozenCandidate, null)
    } finally { await unlink(output); await unlink(target) }
  }
})

test('Slice A member draft and pending AI suggestion survive reopening the local store', async () => {
  const cloud = new FakeWorkerCloud()
  const created = await startSliceAWorker(cloud)
  await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(), summary: 'Persisted explanation',
    expectedDraftRevision: created.adapter.workerDeliveryView(TEST_IDS).draft!.revision })
  const reopened = await createRunner(cloud, neverAgent(), created.store.snapshot())
  assert.deepEqual(reopened.adapter.workerDeliveryView(TEST_IDS).draft, created.adapter.workerDeliveryView(TEST_IDS).draft)
})

test('Slice A the human proof captures exactly the confirmed wrapped target after rechecking current bytes', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  const native = fakeHumanActions()
  let expected: Parameters<DomainMainHumanActionsHost['capture']>[0] | undefined
  let captures = 0
  const created = await startSliceAWorker(cloud, 'completed', {
    capture: (input) => {
      assert.deepEqual(input, expected, 'the Host confirmed input is exactly {target}, without draft fields')
      captures += 1
      return native.capture(input)
    }, validate: (input) => native.validate(input)
  })
  const view = await created.adapter.refreshWorkerDelivery(TEST_IDS)
  assert.equal(view.candidate, null, 'computing a confirmation target does not freeze a candidate')
  expected = { target: view.confirmationTarget! }
  await created.adapter.submitWorkerDelivery({ target: view.confirmationTarget! })
  assert.equal(captures, 1)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).candidate!.target.bundleDigest, view.confirmationTarget!.bundleDigest)
})

for (const state of ['failed', 'cancelled'] as const) {
  test(`confirmed nonretryable Session ${state} remains visible without regressing duplicate terminal admission`, async () => {
    const cloud = new FakeWorkerCloud()
    let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
    const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, readAdmission: async () => admission,
      run: async (input) => ({ runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'initial-ai', state: 'completed',
        text: completedWorkerResultText('An existing editable explanation') }) })
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await created.adapter.waitForIdle()
    const run = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
    const failure = { code: state === 'failed' ? 'turn_failed' : 'runtime_cancelled',
      message: state === 'failed' ? 'unexpected status 503 Service Unavailable' : '本轮执行已停止。', retryable: false }
    admission = { ...admission, revision: 1, receipts: [{ clientDirectiveId: 'confirmed-failed-input', revision: 1,
      payloadDigest: TEST_HASH, mode: 'direct', delivery: 'delivered', turnId: 'confirmed-failed-turn', execution: 'output_pending' }] }
    await created.adapter.acceptSessionOutput({ ...ref, turnId: 'confirmed-failed-turn', revision: 1, state }, async () => ({
      ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [{ id: 'confirmed-failed-turn', artifacts: [], messages: [], failure }]
    }))
    admission = { ...admission, receipts: admission.receipts.map((receipt) => ({ ...receipt, execution: state })) }
    await created.adapter.acceptSessionAdmission({ ...ref, kind: 'direct', revision: 1, clientDirectiveId: 'confirmed-failed-input' })
    assert.equal(created.store.snapshot().taskRuns[0]!.error, failure.message, 'terminal admission preserves the observed failure')
    const terminalJournal = created.store.snapshot().taskRuns[0]!.agentJournal
    admission = { ...admission, receipts: admission.receipts.map((receipt) => ({ ...receipt, execution: 'output_pending' })) }
    await created.adapter.acceptSessionAdmission({ ...ref, kind: 'direct', revision: 1, clientDirectiveId: 'confirmed-failed-input' })
    assert.deepEqual(created.store.snapshot().taskRuns[0]!.agentJournal, terminalJournal, 'a stale active receipt cannot regress the terminal journal')
    const projected = collaborationTaskViewForRun(created.store.snapshot().taskRuns[0]!)
    assert.equal(projected.failure?.code, failure.code)
    assert.equal(projected.failure?.retryable, false)
    assert.equal(projected.failure?.retryState, 'available', 'an explicit reexecution remains available for every failed turn')
    assert.equal(projected.reexecutionInputId, 'confirmed-failed-input', 'a new member input can reference the failed source')
    assert.equal(projected.error, failure.message)
    created.adapter.wake()
    await created.adapter.waitForIdle()
    assert.equal(created.store.snapshot().taskRuns[0]!.agentJournal.length, 2, 'the heartbeat does not repeat a nonretryable Session turn')
    admission = { ...admission, revision: 2, receipts: [...admission.receipts, { clientDirectiveId: 'fresh-member-input', revision: 1,
      payloadDigest: TEST_HASH, mode: 'queue', delivery: 'accepted', execution: 'not_started' }] }
    await created.adapter.acceptSessionAdmission({ ...ref, kind: 'queue', revision: 2, clientDirectiveId: 'fresh-member-input' })
    const fresh = collaborationTaskViewForRun(created.store.snapshot().taskRuns[0]!)
    assert.equal(fresh.failure, undefined)
    assert.equal(fresh.reexecutionInputId, undefined, 'the new accepted input supersedes the old failure presentation')
  })
}

for (const phase of ['direct-delivering-active', 'direct-output-pending', 'queue-accepted', 'queue-before-receipt'] as const) {
  test(`Session admission ${phase} atomically parks the adapter before a heartbeat and observes the member output`, async () => {
    const cloud = new FakeWorkerCloud()
    let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
    let runtimeCalls = 0, memberReads = 0
    let memberEvent: SessionOutputEvent
    let readMember: Parameters<CollaborationTaskAdapter['acceptSessionOutput']>[1]
    const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, readAdmission: async () => admission,
      run: async (input) => {
        runtimeCalls += 1
        if (runtimeCalls > 1) await created.adapter.acceptSessionOutput(memberEvent, readMember)
        return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: `adapter-turn-${runtimeCalls}`,
          state: 'completed', text: completedWorkerResultText(`Adapter result ${runtimeCalls}`) }
      } })
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await created.adapter.waitForIdle()
    const run = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
    memberEvent = { ...ref, revision: 1, turnId: 'member-turn', state: 'completed' }
    readMember = async () => {
      memberReads += 1
      return { ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [{ id: 'member-turn', artifacts: [],
        messages: [{ itemId: 'member-final', kind: 'assistant-final', text: completedWorkerResultText('Member requested result') }] }] }
    }
    const receipt = { clientDirectiveId: 'member-input', revision: 1, payloadDigest: TEST_HASH, mode: 'queue' as const,
      ...(phase === 'direct-delivering-active' ? { delivery: 'delivering' as const, execution: 'active' as const, turnId: 'member-turn' }
        : phase === 'direct-output-pending' ? { delivery: 'delivered' as const, execution: 'output_pending' as const, turnId: 'member-turn' }
          : { delivery: 'accepted' as const, execution: 'not_started' as const }) }
    admission = { ...admission, revision: phase === 'queue-before-receipt' ? 0 : 1,
      receipts: phase === 'queue-before-receipt' ? [] : [receipt] }
    const transact = created.store.transact.bind(created.store)
    let heartbeatInjected = false
    created.store.transact = async (update) => {
      const value = await transact(update)
      const current = created.store.snapshot().taskRuns[0]!
      if (!heartbeatInjected && current.state === 'running' && current.resultSummary === null) {
        heartbeatInjected = true
        created.adapter.wake()
        await created.adapter.waitForIdle()
      }
      return value
    }
    await created.adapter.acceptSessionAdmission({ ...ref, kind: phase.startsWith('direct') ? 'direct' : 'queue',
      clientDirectiveId: 'member-input', revision: admission.revision })
    assert.equal(heartbeatInjected, true)
    admission = { ...admission, revision: 1, receipts: [{ ...receipt, delivery: 'delivered', execution: 'output_pending', turnId: 'member-turn' }] }
    if (runtimeCalls === 1) await created.adapter.acceptSessionOutput(memberEvent, readMember)
    assert.equal(runtimeCalls, 1, 'an ordinary in-flight input must never start an adapter-owned turn')
    assert.equal(memberReads, 1, 'the member output must reach the required observer instead of being skipped as adapter-owned')
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.sourceTurnId, 'member-turn')
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.summary, 'Member requested result')
  })
}

for (const { intervention, structured } of [
  { intervention: 'queue', structured: true }, { intervention: 'steer', structured: true },
  { intervention: 'queue', structured: false }, { intervention: 'steer', structured: false }
] as const) {
  test(`active collaboration turn accepts standard ${intervention} with ${structured ? 'Worker JSON' : 'ordinary text'}, settles ownership and submits without an extra automatic turn`, async () => {
    const cloud = new FakeWorkerCloud('offered', true)
    cloud.validDeliveryManifest = true
    const started = deferred<void>(), release = deferred<void>()
    let calls = 0
    let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
    const created = await createRunner(cloud, {
      runtimeReadiness: readyRuntimeReadiness,
      readAdmission: async () => admission,
      run: async (input) => {
        calls += 1
        assert.ok(input.metadata && typeof input.metadata === 'object' && 'source' in input.metadata)
        assert.equal(input.metadata.source, 'collaboration.worker-task')
        assert.deepEqual(input.outputSchema, workerRuntimeResultOutputSchema)
        admission = { ...admission, receipts: [{ clientDirectiveId: input.clientDirectiveId!, revision: 1,
          payloadDigest: TEST_HASH, mode: 'direct', delivery: 'delivered', execution: 'active', turnId: 'collaboration-active-turn' }] }
        await mkdir(input.workspaceRoot!, { recursive: true })
        await writeFile(join(input.workspaceRoot!, 'analysis.md'), 'Active task output')
        started.resolve()
        await release.promise
        admission = { ...admission, receipts: admission.receipts.map((receipt) => receipt.turnId === 'collaboration-active-turn'
          ? { ...receipt, execution: 'output_pending' } : receipt) }
        // This is the required Host output boundary while runAgent still owns
        // the current turn; the ordinary observer must not parse it a second time.
        await created.adapter.acceptSessionOutput({ runtimeId: input.runtimeId!, threadId: input.threadId!,
          turnId: 'collaboration-active-turn', revision: admission.revision, state: 'completed' }, async () => {
          throw new Error('Adapter-owned output is handled once by runAgent')
        })
        return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'collaboration-active-turn',
          state: 'completed', text: intervention === 'steer' && !structured ? '已按照刚才的补充要求完成修改。'
            : completedWorkerResultText(intervention === 'steer' ? 'Steered task explanation' : 'Initial task explanation') }
      }
    })
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await started.promise
    const run = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
    admission = { ...admission, revision: 1, receipts: [...admission.receipts, {
      clientDirectiveId: 'member-active-input', revision: 1, payloadDigest: TEST_HASH,
      mode: 'queue', delivery: 'accepted', execution: 'not_started' }] }
    await created.adapter.acceptSessionAdmission({ ...ref, kind: 'queue', clientDirectiveId: 'member-active-input', revision: 1 })
    if (intervention === 'steer') {
      admission = { ...admission, revision: 2, receipts: admission.receipts.map((receipt) => receipt.clientDirectiveId === 'member-active-input'
        ? { ...receipt, mode: 'steer', delivery: 'delivered', execution: 'active', turnId: 'collaboration-active-turn' } : receipt) }
      await created.adapter.acceptSessionAdmission({ ...ref, kind: 'steer', clientDirectiveId: 'member-active-input', revision: 2 })
    }
    created.adapter.wake()
    release.resolve()
    await created.adapter.waitForIdle()
    admission = { ...admission, receipts: admission.receipts.map((receipt) => receipt.turnId === 'collaboration-active-turn'
      ? { ...receipt, execution: 'completed' } : receipt) }
    if (intervention === 'queue') {
      // The standard composer dispatches this accepted input after the active
      // call. It is a Member call, not another collaboration adapter call.
      calls += 1
      admission = { ...admission, receipts: admission.receipts.map((receipt) => receipt.clientDirectiveId === 'member-active-input'
        ? { ...receipt, delivery: 'delivered', execution: 'output_pending', turnId: 'member-follow-up-turn' } : receipt) }
      await created.adapter.acceptSessionOutput({ ...ref, turnId: 'member-follow-up-turn', revision: admission.revision, state: 'completed' }, async () => ({
        ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [{ id: 'member-follow-up-turn', artifacts: [],
          messages: [{ itemId: 'member-result', kind: 'assistant-final', text: structured ? completedWorkerResultText('Queued member explanation') : '已更新任务产出。' }] }]
      }))
      admission = { ...admission, receipts: admission.receipts.map((receipt) => receipt.turnId === 'member-follow-up-turn'
        ? { ...receipt, execution: 'completed' } : receipt) }
    }
    created.adapter.wake()
    await created.adapter.waitForIdle()
    const current = created.store.snapshot().taskRuns[0]!
    assert.equal(calls, intervention === 'queue' ? 2 : 1, 'heartbeat must not dispatch an extra collaboration turn')
    assert.equal(current.agentJournal.filter((entry) => entry.origin !== 'session').length, 1)
    assert.equal(current.agentJournal.find((entry) => entry.clientDirectiveId === 'member-active-input')?.state,
      'observed_success', 'same-turn steer must settle its Session journal instead of remaining dispatched')
    assert.equal(current.error, null)
    const view = created.adapter.workerDeliveryView(TEST_IDS)
    assert.equal(view.draft!.summary, intervention === 'queue'
      ? structured ? 'Queued member explanation' : 'Initial task explanation'
      : structured ? 'Steered task explanation' : '')
    assert.equal(view.draft!.changed, true)
    assert.equal(admission.receipts.every((receipt) => receipt.execution === 'completed'), true)
    if (!view.draft!.summary) await created.adapter.saveWorkerDeliveryDraft({ ...deliveryIdentity(),
      expectedDraftRevision: view.draft!.revision, summary: 'Member checked the steered task output' })
    assert.equal((await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))).state, 'sealed')
  })
}

test('a queued Member completion during owned-turn settlement keeps the newer draft and never repeats the adapter', async () => {
  const cloud = new FakeWorkerCloud()
  let admission: SessionAdmissionSnapshot = { revision: 1, receipts: [], submission: null, recovery: 'ready' }
  let memberCompletesNow = false, adapterCalls = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    readAdmission: async () => {
      if (memberCompletesNow) {
        memberCompletesNow = false
        const current = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: current.runtimeId!, threadId: current.threadId! }
        admission = { ...admission, receipts: admission.receipts.map((receipt) => ({ ...receipt,
          delivery: 'delivered', execution: 'output_pending', turnId: 'fast-member-turn' })) }
        await created.adapter.acceptSessionOutput({ ...ref, turnId: 'fast-member-turn', state: 'completed', revision: 1 }, async () => ({
          ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [{ id: 'fast-member-turn', artifacts: [],
            messages: [{ itemId: 'fast-member-result', kind: 'assistant-final', text: completedWorkerResultText('Newer Member explanation') }] }]
        }))
        admission = { ...admission, receipts: admission.receipts.map((receipt) => ({ ...receipt, execution: 'completed' })) }
      }
      return admission
    },
    run: async (input) => {
      adapterCalls += 1
      admission = { ...admission, receipts: [{ clientDirectiveId: 'fast-member-input', revision: 1, payloadDigest: TEST_HASH,
        mode: 'queue', delivery: 'accepted', execution: 'not_started' }] }
      await created.adapter.acceptSessionAdmission({ runtimeId: input.runtimeId!, threadId: input.threadId!,
        kind: 'queue', revision: 1, clientDirectiveId: 'fast-member-input' })
      memberCompletesNow = true
      return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'older-adapter-turn', state: 'completed',
        text: completedWorkerResultText('Older adapter explanation') }
    }
  })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  created.adapter.wake()
  await created.adapter.waitForIdle()
  const draft = created.adapter.workerDeliveryView(TEST_IDS).draft!
  assert.equal(adapterCalls, 1)
  assert.equal(draft.summary, 'Newer Member explanation')
  assert.equal(draft.sourceTurnId, 'fast-member-turn')
  assert.equal(draft.changed, true)
  assert.equal(created.store.snapshot().taskRuns[0]!.error, null)
})

for (const unproven of ['different-turn', 'undelivered', 'queue-mode'] as const) {
  test(`a ${unproven} receipt never relaxes strict Worker output for an owned turn`, async () => {
    const cloud = new FakeWorkerCloud()
    let admission: SessionAdmissionSnapshot = { revision: 1, receipts: [], submission: null, recovery: 'ready' }
    const created = await createRunner(cloud, {
      runtimeReadiness: readyRuntimeReadiness,
      readAdmission: async () => admission,
      run: async (input) => {
        admission = { ...admission, receipts: [{ clientDirectiveId: 'unproven-input', revision: 1, payloadDigest: TEST_HASH,
          mode: unproven === 'queue-mode' ? 'queue' : 'steer', delivery: unproven === 'undelivered' ? 'uncertain' : 'delivered',
          turnId: unproven === 'different-turn' ? 'unrelated-turn' : 'owned-turn', execution: 'active' }] }
        await created.adapter.acceptSessionAdmission({ runtimeId: input.runtimeId!, threadId: input.threadId!,
          kind: 'steer', revision: 1, clientDirectiveId: 'unproven-input' })
        return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'owned-turn', state: 'completed', text: '普通回复。' }
      }
    })
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await created.adapter.waitForIdle()
    const run = created.store.snapshot().taskRuns[0]!
    assert.match(run.agentJournal.find((entry) => entry.origin !== 'session')!.safeError ?? '', /strict Worker JSON result/u)
    assert.equal(run.deliveryDraft!.sourceTurnId, null)
    assert.equal(run.deliveryDraft!.changed, false)
  })
}

async function startSliceAWorker(cloud: FakeWorkerCloud, state: 'completed' | 'cancelled' = 'completed', humanActions?: DomainMainHumanActionsHost, runnerOptions: Parameters<typeof createRunner>[3] = {}) {
  const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, run: async (input) => {
    await mkdir(input.workspaceRoot!, { recursive: true })
    await writeFile(join(input.workspaceRoot!, 'analysis.md'), 'Initial file')
    return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'initial-ai-turn', state,
      text: state === 'completed' ? completedWorkerResultText('Initial AI summary') : '' }
  } }, emptyState(), { ...runnerOptions, ...(humanActions ? { humanActions } : {}) })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  return created
}

function deliveryIdentity() {
  return { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId }
}

async function deliverySubmitInput(adapter: CollaborationTaskAdapter) {
  const view = await adapter.refreshWorkerDelivery(TEST_IDS)
  assert.ok(view.confirmationTarget)
  return { target: view.confirmationTarget }
}

function workerWorkspaceRoot(executionId: string): string {
  return join(tmpdir(), `sciforge-worker-${executionId}`)
}

function completedWorkerResultText(summary: string): string {
  return JSON.stringify({
    result: { schemaVersion: 1, outcome: 'completed', summary }
  })
}

function needsHumanWorkerResultText(question: string): string {
  return JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'needs_human',
      question,
      requiredAssurance: 'verified'
    }
  })
}

test('Worker Session titles are single-line and bounded before crossing the Host contract', () => {
  assert.equal(
    collaborationWorkerSessionTitle('Analyze\r\nsamples\u0085with\u2028all\u2029controls'),
    'Analyze samples with all controls'
  )
  assert.equal(collaborationWorkerSessionTitle('x'.repeat(250)).length, 200)
  const unicodeBoundary = collaborationWorkerSessionTitle(`${'x'.repeat(198)}😀z`)
  assert.equal(unicodeBoundary, `${'x'.repeat(198)}😀`)
  assert.equal(unicodeBoundary.length, 200)
  const splitBoundary = collaborationWorkerSessionTitle(`${'x'.repeat(199)}😀`)
  assert.equal(splitBoundary, 'x'.repeat(199))
})

test('duplicate User offers persist once and a Device dismissal remains local', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()

  const [offer] = store.snapshot().pendingTaskOffers
  assert.equal(offer?.state, 'awaiting-manual')
  assert.deepEqual(offer?.preflightReasons, [])
  assert.equal(store.snapshot().tasks[0]?.title, cloud.task.title)
  assert.equal(store.snapshot().pendingTaskOffers.length, 1)
  assert.equal(store.snapshot().taskRuns.length, 0)
  assert.equal(cloud.commands.filter((type) => !type.startsWith('worker.')).length, 0)

  await adapter.decideOffer(OFFER_ID, {
    decision: 'dismiss'
  })
  await adapter.waitForIdle()
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'dismissed')
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('historical failed Offer revalidates on restart and remains a manual decision', async () => {
  const cloud = new FakeWorkerCloud()
  const backend = new MemoryBackend(emptyState())
  const first = await createRunner(cloud, neverAgent(), emptyState(), { backend })
  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.store.transact((draft) => {
    Object.assign(draft.pendingTaskOffers[0]!, {
      state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical transport authority failure'
    })
  })
  first.adapter.stop()
  const restored = await createRunner(cloud, neverAgent(), emptyState(), { backend })
  await restored.adapter.recover()
  await restored.adapter.waitForIdle()
  restored.adapter.wake()
  restored.adapter.wake()
  await restored.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await restored.adapter.waitForIdle()
  assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual',
    restored.store.snapshot().pendingTaskOffers[0]?.error ?? '')
  assert.equal(restored.store.snapshot().taskRuns.length, 0)
  assert.equal(cloud.commands.includes('task.offer.accept'), false)
})

test('awaiting manual Offer reconciles Cloud withdrawal without a notification', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  cloud.offer = taskOfferSchema.parse({ ...cloud.offer, state: 'withdrawn',
    revision: 2, respondedAt: TEST_LATER_TIMESTAMP, reassignmentTaskRevision: 2 })
  cloud.task = taskSchema.parse({ ...cloud.task, revision: 2, status: 'revision_requested' })
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'closed', store.snapshot().pendingTaskOffers[0]?.error ?? '')
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('duplicate offered notification after acceptance cannot recreate a manual decision', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Controlled Runtime outage' }),
    run: async () => { throw new Error('Runtime remains unavailable') }
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await Promise.all([adapter.decideOffer(OFFER_ID, { decision: 'accept' }),
    adapter.decideOffer(OFFER_ID, { decision: 'accept' })])
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns.length, 1)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
})

for (const outcome of ['expired', 'withdrawn', 'reassigned', 'contract-changed', 'membership-removed'] as const) {
  test(`historical failed Offer safely converges as ${outcome} without claiming`, async () => {
    const cloud = new FakeWorkerCloud()
    const { adapter, store } = await historicalFailedOffer(cloud)
    if (outcome === 'expired') cloud.offer = taskOfferSchema.parse({ ...cloud.offer,
      createdAt: new Date(Date.parse(TEST_TIMESTAMP) - 1_000).toISOString(),
      offeredAt: new Date(Date.parse(TEST_TIMESTAMP) - 1_000).toISOString(), expiresAt: TEST_TIMESTAMP })
    if (outcome === 'withdrawn' || outcome === 'reassigned') {
      cloud.offer = taskOfferSchema.parse({ ...cloud.offer, state: 'withdrawn', revision: 2,
        respondedAt: TEST_LATER_TIMESTAMP, reassignmentTaskRevision: 2 })
      cloud.task = taskSchema.parse({ ...cloud.task, revision: 2, status: 'revision_requested' })
    }
    if (outcome === 'contract-changed') {
      cloud.offer = taskOfferSchema.parse({ ...cloud.offer, contractRevision: 2, contractDigest: 'b'.repeat(64) })
      cloud.task = taskSchema.parse({ ...cloud.task, contractRevision: 2, contractDigest: 'b'.repeat(64) })
    }
    if (outcome === 'membership-removed') cloud.recoveryMembershipActive = false
    adapter.wake()
    adapter.wake()
    await adapter.waitForIdle()
    assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'closed', store.snapshot().pendingTaskOffers[0]?.error ?? '')
    assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, false)
    assert.equal(store.snapshot().taskRuns.length, 0)
    assert.equal(cloud.commands.includes('task.offer.accept'), false)
  })
}

test('historical failed Offer stays blocked without the pinned Contract proof', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await historicalFailedOffer(cloud)
  await store.transact((draft) => { delete draft.pendingTaskOffers[0]!.contractDigest })
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.equal(adapter.offerAvailability(OFFER_ID).reason, 'recovery_evidence_missing')
  await assert.rejects(adapter.decideOffer(OFFER_ID, { decision: 'accept' }))
  assert.equal(store.snapshot().outbox.length, 0)
})

test('explicit Device revocation permanently fences an Offer even when Cloud still projects it pending', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit Device revocation')
  adapter.wake()
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.equal(adapter.offerAvailability(OFFER_ID).reason, 'authority_changed')
  assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, false)
  assert.equal(cloud.commands.includes('task.offer.accept'), false)
})

for (const decision of ['accept', 'reject'] as const) {
for (const queuedState of ['pending', 'reconciling'] as const) {
  test(`explicit identity loss prevents an already queued ${decision} (${queuedState}) from dispatching after restart`, async () => {
    const cloud = new FakeWorkerCloud()
    const backend = new MemoryBackend(emptyState())
    const queued = deferred<void>()
    const sent: RestRequest[] = []
    const outboxFactory = (store: CollaborationLocalStore) => {
      const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
        agentCloudRuntime: createTestAgentCloudRuntime({
          authorityStatus: async (agentId) => ({ state: 'ready', agentId, userId: TEST_IDS.userId,
            deviceId: TEST_IDS.deviceId, generation: 1, runtimeId: null, capabilityTags: [] }),
          execute: async (_agentId, request) => {
            sent.push(structuredClone(request))
            return cloud.outbox().enqueueAndWait('task.offer-decision', request)
          }
        })
      })
      const enqueue = outbox.enqueue.bind(outbox)
      outbox.enqueue = async (...args) => { await enqueue(...args); queued.resolve() }
      outbox.stop()
      return outbox
    }
    const first = await createRunner(cloud, neverAgent(), emptyState(), { backend, outboxFactory })
    await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await first.adapter.waitForIdle()
    await first.adapter.decideOffer(OFFER_ID, { decision })
    await queued.promise
    const original = first.store.snapshot().outbox[0]!
    if (queuedState === 'reconciling') await first.store.transact((draft) => { draft.outbox[0]!.state = 'reconciling' })
    assert.equal(original.attempts, 0)
    await first.adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit account change',
      new AgentCloudRuntimeError('agent_authority_invalid', 'Explicit account change', 'identity_changed'))
    first.outbox.start()
    await first.outbox.waitForIdle()
    assert.equal(sent.length, 0, 'a locally revoked Human decision must never become a fresh Cloud write')
    await first.adapter.waitForIdle()
    first.adapter.stop()
    first.outbox.stop()

    const restored = await createRunner(cloud, neverAgent(), emptyState(), { backend, outboxFactory })
    restored.outbox.start()
    await restored.outbox.waitForIdle()
    await restored.outbox.retry(original.outboxId)
    await restored.outbox.waitForIdle()
    assert.equal(sent.length, 0)
    const retained = restored.store.snapshot().outbox[0]!
    assert.deepEqual(retained.body, original.body)
    assert.equal(retained.idempotencyKey, original.idempotencyKey)
    assert.equal(retained.attempts, 0)
    assert.equal(retained.authorityFence?.deliveryAtFence, 'not_dispatched')
    assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.state, 'failed')
    assert.equal(restored.store.snapshot().taskRuns.length, 0)
  })
}
}

for (const result of ['late-success', 'response-lost'] as const) {
  test(`permanent loss during a sent acceptance retains ${result} evidence without resending`, async () => {
    const cloud = new FakeWorkerCloud()
    const started = deferred<void>()
    const release = deferred<void>()
    let sends = 0
    const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
      store, localAgentId: () => TEST_IDS.agentId,
      agentCloudRuntime: createTestAgentCloudRuntime({
        authorityStatus: async (agentId) => ({ state: 'ready', agentId, userId: TEST_IDS.userId,
          deviceId: TEST_IDS.deviceId, generation: 1, runtimeId: null, capabilityTags: [] }),
        execute: async (_agentId, request) => {
          sends += 1
          const response = await cloud.outbox().enqueueAndWait('task.offer-decision', request)
          started.resolve()
          await release.promise
          if (result === 'response-lost') throw new Error('Response lost after actual commit')
          return response
        }
      })
    })
    const { adapter, store, outbox } = await createRunner(cloud, neverAgent(), emptyState(), { outboxFactory })
    await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await adapter.waitForIdle()
    await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await started.promise
    const original = store.snapshot().outbox[0]!
    await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit Device revocation')
    assert.equal(store.snapshot().outbox[0]?.authorityFence?.deliveryAtFence, 'outcome_unknown')
    release.resolve()
    await outbox.waitForIdle()
    await adapter.waitForIdle()
    const retained = store.snapshot().outbox[0]!
    assert.deepEqual(retained.body, original.body)
    assert.equal(retained.idempotencyKey, original.idempotencyKey)
    assert.equal(retained.authorityFence?.deliveryAtFence, 'outcome_unknown')
    assert.equal(retained.state, result === 'late-success' ? 'delivered' : 'failed')
    if (result === 'late-success') {
      assert.equal(retained.response?.type, 'rest.collection')
      const receipt = await outbox.resumeAndWait('task.offer-decision', retained.idempotencyKey, () => undefined)
      assert.deepEqual(receipt?.response, retained.response)
    } else {
      await assert.rejects(outbox.resumeAndWait('task.offer-decision', retained.idempotencyKey, () => undefined),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'authority_lost')
    }
    await outbox.retry(retained.outboxId)
    outbox.start()
    await outbox.waitForIdle()
    assert.equal(sends, 1)
    assert.equal(store.snapshot().taskRuns.length, 0)
    assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  })
}

test('permanent loss while the drain is checking authority prevents the selected original decision from sending', async () => {
  const cloud = new FakeWorkerCloud()
  const checking = deferred<void>()
  const release = deferred<void>()
  let sends = 0
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => {
        checking.resolve()
        await release.promise
        return { state: 'ready', agentId, userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId,
          generation: 1, runtimeId: null, capabilityTags: [] }
      },
      execute: async (_agentId, request) => { sends += 1; return cloud.outbox().enqueueAndWait('task.offer-decision', request) }
    })
  })
  const { adapter, store, outbox } = await createRunner(cloud, neverAgent(), emptyState(), { outboxFactory })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await checking.promise
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit Device revocation')
  release.resolve()
  await outbox.waitForIdle()
  await adapter.waitForIdle()
  assert.equal(sends, 0)
  assert.equal(store.snapshot().outbox[0]?.attempts, 0)
  assert.equal(store.snapshot().outbox[0]?.authorityFence?.deliveryAtFence, 'not_dispatched')
})

test('permanent Worker authority loss stops its queued start and late enqueues while ordinary failure remains separate', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, { state: 'accepting', startedAt: null })]
  const queued = deferred<void>()
  let sends = 0
  const outboxFactory = (store: CollaborationLocalStore) => {
    const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
      agentCloudRuntime: createTestAgentCloudRuntime({
        authorityStatus: async (agentId) => ({ state: 'ready', agentId, userId: TEST_IDS.userId,
          deviceId: TEST_IDS.deviceId, generation: 1, runtimeId: null, capabilityTags: [] }),
        execute: async (_agentId, request) => { sends += 1; return cloud.outbox().enqueueAndWait('task.progress', request) }
      })
    })
    const enqueue = outbox.enqueue.bind(outbox)
    outbox.enqueue = async (...args) => { await enqueue(...args); queued.resolve() }
    outbox.stop()
    return outbox
  }
  const { adapter, store, outbox } = await createRunner(cloud, neverAgent(), initial, { outboxFactory })
  await adapter.recover()
  await queued.promise
  const original = store.snapshot().outbox[0]!
  assert.equal(original.body.type, 'task.execution.start')
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit identity change')
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns[0]?.state, 'fenced')
  assert.ok(store.snapshot().taskRuns[0]?.authorityFencedAt)
  const late = restRequestSchema.parse({ ...original.body, requestId: 'req_LateWorkerStart01',
    idempotencyKey: 'idem_late-worker-start01' })
  await outbox.enqueue('task.progress', late)
  outbox.start()
  await outbox.waitForIdle()
  await outbox.retry()
  await outbox.waitForIdle()
  assert.equal(sends, 0)
  assert.equal(store.snapshot().outbox.length, 2)
  assert.ok(store.snapshot().outbox.every(({ authorityFence }) => authorityFence?.deliveryAtFence === 'not_dispatched'))
})

test('permanent Worker loss fences staged bytes and candidate writes through their original execution ownership', async () => {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({ runtimeId: 'codex', threadId: 'authority-fence-delivery', turnId: 'turn-fence-delivery',
      state: 'completed', text: completedWorkerResultText('Exact confirmed evidence.') })
  })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const candidate = created.store.snapshot().taskRuns[0]!.frozenCandidate!
  const commands = cloud.requests.filter(({ type }) => ['delivery.candidate.create', 'delivery.candidate.review',
    'delivery.manifest.seal'].includes(type))
  assert.equal(commands.length, 3)
  let sends = 0
  const outbox = new DurableCloudOutbox({ store: created.store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({
      execute: async () => { sends += 1; throw new Error('Fenced writes cannot send') }
    }),
    authenticatedCloudTransport: { ...cloud.objectTransport(),
      stageObject: async () => { sends += 1; throw new Error('Fenced bytes cannot upload') },
      execute: async () => { sends += 1; throw new Error('Fenced candidate writes cannot send') }
    }
  })
  outbox.stop()
  for (const command of commands) await outbox.enqueue('delivery.command', command)
  const stageRequest = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_AuthorityFenceStage1', idempotencyKey: 'idem_authority-fence-stage1',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    mediaType: candidate.bundleFile.mediaType, sha256: candidate.bundleFile.sha256, byteCount: candidate.bundleFile.byteCount }
  await assert.rejects(outbox.stageAndWait(stageRequest, candidate.bundleFile.path))
  // Candidate replacement may drop the current UI/saga pointer; original creation remains the ownership proof.
  await created.store.transact((draft) => { draft.taskRuns[0]!.frozenCandidate = null; draft.taskRuns[0]!.deliverySaga = null })
  await created.adapter.fenceLocalAgent(TEST_IDS.agentId, 'Explicit account authority loss')
  outbox.start()
  await outbox.waitForIdle()
  await outbox.retry()
  await outbox.waitForIdle()
  await assert.rejects(outbox.stageAndWait(stageRequest, candidate.bundleFile.path))
  assert.equal(sends, 0)
  assert.equal(created.store.snapshot().outbox.length, 4)
  assert.ok(created.store.snapshot().outbox.every(({ authorityFence }) => authorityFence?.deliveryAtFence === 'not_dispatched'))
})

test('same actor reauthentication restores only an unclicked manual Offer through Cloud reconciliation', async () => {
  const cloud = new FakeWorkerCloud()
  let authenticated = true
  const authenticatedCloudTransport: AuthenticatedCloudTransport = {
    ...cloud.objectTransport(),
    status: () => authenticated ? { state: 'ready', baseUrl: 'https://cloud.invalid',
      userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
      : { state: 'identity_required', baseUrl: 'https://cloud.invalid' }
  }
  const { adapter, store } = await createRunner(cloud, neverAgent(), emptyState(), { authenticatedCloudTransport })
  await Promise.all([adapter.acceptOffer(offerPayload(), TEST_IDS.agentId),
    adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)])
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers.length, 1)
  authenticated = false
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'The Human signed out',
    new AgentCloudRuntimeError('identity_required', 'The Human signed out', 'identity_changed'))
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Connect while signed out',
    new AgentCloudRuntimeError('identity_required', 'Connect while signed out'))
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, false)
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns.length, 0)
  authenticated = true
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, true)
  assert.equal(cloud.commands.includes('task.offer.accept'), false)
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('client clock skew cannot permanently expire a Cloud-valid historical Offer or extend its deadline', async () => {
  const cloud = new FakeWorkerCloud()
  const deadline = cloud.offer.expiresAt
  const { adapter, store } = await createRunner(cloud, neverAgent(), emptyState(), {
    now: () => new Date(Date.parse(deadline) + 86_400_000)
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await store.transact((draft) => Object.assign(draft.pendingTaskOffers[0]!, {
    state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical temporary authority loss'
  }))
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual',
    store.snapshot().pendingTaskOffers[0]?.error ?? '')
  assert.equal(store.snapshot().pendingTaskOffers[0]?.expiresAt, deadline)
  assert.equal(cloud.offer.expiresAt, deadline)
  assert.equal(cloud.commands.includes('task.offer.extend'), false)
})

test('dismissal wins a Cloud reconciliation read race and is never revived', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  const started = deferred<void>()
  const release = deferred<void>()
  cloud.recoveryReadStarted = () => started.resolve()
  cloud.recoveryReadRelease = release.promise
  adapter.wake()
  await started.promise
  await adapter.decideOffer(OFFER_ID, { decision: 'dismiss' })
  release.resolve()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'dismissed')
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('transport outage preserves offline queued acceptance but unverified authority blocks a decision', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  cloud.recoveryReadError = Object.assign(new Error('Controlled transport outage'), { code: 'cloud_unavailable' })
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(adapter.offerAvailability(OFFER_ID).reason, 'offline_queue_available')
  assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, true)
  await adapter.suspendLocalAgent(TEST_IDS.agentId, 'Device authority is temporarily unverified')
  assert.equal(adapter.offerAvailability(OFFER_ID).reason, 'authority_unverified')
  await assert.rejects(adapter.decideOffer(OFFER_ID, { decision: 'accept' }))
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  cloud.recoveryReadError = null
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, true)
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('historical failed rejection replays its original durable decision without accepting', async () => {
  const cloud = new FakeWorkerCloud()
  const backend = new MemoryBackend(emptyState())
  const sent: RestRequest[] = []
  let failOnce = true
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({ state: 'ready', agentId, userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId, generation: 1, runtimeId: null, capabilityTags: [] }),
      execute: async (_agentId, request) => {
        sent.push(structuredClone(request))
        if (failOnce) { failOnce = false; throw new Error('Controlled response loss before rejection commit') }
        return cloud.outbox().enqueueAndWait('task.offer-decision', request)
      }
    })
  })
  const first = await createRunner(cloud, neverAgent(), emptyState(), { backend, outboxFactory })
  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.adapter.decideOffer(OFFER_ID, { decision: 'reject' })
  await first.adapter.waitForIdle()
  await first.store.transact((draft) => Object.assign(draft.pendingTaskOffers[0]!, {
    state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical identity loss during rejection'
  }))
  first.adapter.stop()
  first.outbox.stop()
  const restored = await createRunner(cloud, neverAgent(), emptyState(), { backend, outboxFactory })
  await restored.adapter.recover()
  await restored.adapter.waitForIdle()
  assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.state, 'closed',
    restored.store.snapshot().pendingTaskOffers[0]?.error ?? '')
  assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.closedOutcome, 'rejected')
  assert.deepEqual(sent[1], sent[0])
  assert.equal(sent.length, 2)
  assert.equal(restored.store.snapshot().taskRuns.length, 0)
})

for (const switched of ['account', 'device'] as const) {
  test(`${switched} switch during reconciliation cannot restore a historical Offer`, async () => {
    const cloud = new FakeWorkerCloud()
    let userId: string = TEST_IDS.userId
    let deviceId: string = TEST_IDS.deviceId
    const authenticatedCloudTransport: AuthenticatedCloudTransport = {
      ...cloud.objectTransport(),
      status: () => ({ state: 'ready', baseUrl: 'https://cloud.invalid', userId, deviceId, deviceRevision: 1 })
    }
    const { adapter, store } = await createRunner(cloud, neverAgent(), emptyState(), { authenticatedCloudTransport })
    await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await adapter.waitForIdle()
    await store.transact((draft) => Object.assign(draft.pendingTaskOffers[0]!, {
      state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical authority loss'
    }))
    const started = deferred<void>()
    const release = deferred<void>()
    cloud.recoveryReadStarted = () => started.resolve()
    cloud.recoveryReadRelease = release.promise
    adapter.wake()
    await started.promise
    if (switched === 'account') userId = TEST_IDS.secondUserId
    else deviceId = 'dev_OtherDevice00001'
    release.resolve()
    await adapter.waitForIdle()
    assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
    assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, false)
    assert.equal(store.snapshot().taskRuns.length, 0)
    assert.equal(store.snapshot().outbox.length, 0)
  })
}

for (const fenced of [false, true]) {
  test(`historical failed Offer cannot revive ${fenced ? 'a fenced Execution' : 'another Device winner'}`, async () => {
    const cloud = new FakeWorkerCloud()
    const { adapter, store } = await historicalFailedOffer(cloud)
    await cloud.outbox().enqueueAndWait('task.offer-decision', restRequestSchema.parse({
      protocolVersion: '1.0', requestId: 'req_OtherDeviceClaim001', type: 'task.offer.accept',
      idempotencyKey: 'idem_other-device-claim001', taskOfferId: OFFER_ID, taskId: TEST_IDS.taskId,
      agentId: TEST_IDS.agentId, interaction: 'explicit_click', expectedTaskRevision: 1,
      expectedOfferRevision: 1, expectedContractRevision: 1, expectedContractDigest: TEST_HASH
    }))
    if (fenced) {
      cloud.execution = taskExecutionSchema.parse({ ...cloud.execution, state: 'cancelled',
        terminalAt: TEST_LATER_TIMESTAMP, fence: { ...cloud.execution.fence,
          status: 'fenced', reason: 'execution_cancelled', fencedAt: TEST_LATER_TIMESTAMP } })
      cloud.task = taskSchema.parse({ ...cloud.task, status: 'cancelled', currentExecutionState: 'cancelled',
        completedAt: TEST_LATER_TIMESTAMP })
    } else {
      cloud.execution = taskExecutionSchema.parse({ ...cloud.execution,
        assigneeAgentId: TEST_IDS.secondAgentId, assigneeDeviceId: 'dev_OtherDevice00001',
        fence: { ...cloud.execution.fence, assigneeAgentId: TEST_IDS.secondAgentId,
          assigneeDeviceId: 'dev_OtherDevice00001' } })
    }
    adapter.wake()
    await adapter.waitForIdle()
    assert.equal(store.snapshot().pendingTaskOffers[0]?.state, fenced ? 'closed' : 'claimed_elsewhere',
      store.snapshot().pendingTaskOffers[0]?.error ?? '')
    assert.equal(adapter.offerAvailability(OFFER_ID).canAccept, false)
    assert.equal(store.snapshot().taskRuns.length, 0)
    assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
  })
}

test('temporary authority suspension aborts an active turn without failing its Execution and permanent revocation stays fenced', async () => {
  const cloud = new FakeWorkerCloud()
  const started = deferred<void>()
  let runtimeTurns = 0
  let signalAborted = false
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async ({ signal }) => {
      runtimeTurns += 1
      started.resolve()
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          signalAborted = true
          reject(signal.reason)
        }, { once: true })
      })
    }
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await started.promise
  await adapter.suspendLocalAgent(TEST_IDS.agentId, 'Device revalidation is pending')
  await adapter.waitForIdle()
  assert.equal(signalAborted, true)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'running')
  assert.equal(store.snapshot().taskRuns[0]?.agentJournal[0]?.state, 'dispatched')
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  await adapter.fenceLocalAgent(TEST_IDS.agentId, 'Device was explicitly revoked')
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns[0]?.state, 'fenced')
  assert.equal(runtimeTurns, 1)
})

async function historicalFailedOffer(cloud: FakeWorkerCloud) {
  const created = await createRunner(cloud)
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.store.transact((draft) => Object.assign(draft.pendingTaskOffers[0]!, {
    state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical authority outage'
  }))
  return created
}

test('a revision offer keeps its instruction through claim and Worker execution', async () => {
  const prompts: string[] = []
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (input) => {
      prompts.push(input.prompt)
      return {
        runtimeId: 'codex',
        threadId: 'revision-worker-thread',
        turnId: 'revision-worker-turn',
        state: 'completed',
        text: completedWorkerResultText('Revised evidence is ready.')
      }
    }
  })
  const revisionInstruction = 'Add the missing exact authority evidence.'

  await adapter.acceptOffer({ ...offerPayload(), revisionInstruction }, TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.revisionInstruction, revisionInstruction)

  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()

  assert.equal(store.snapshot().taskRuns[0]?.offer.revisionInstruction, revisionInstruction)
  assert.match(prompts[0] ?? '', /Coordinator revision request:/u)
  assert.match(prompts[0] ?? '', /Add the missing exact authority evidence\./u)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
})

test('an extended offer updates an awaiting-manual Device before it claims', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'offer-extension-thread',
      turnId: 'offer-extension-turn',
      state: 'completed',
      text: completedWorkerResultText('Claimed.')
    })
  })

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')

  cloud.offer = taskOfferSchema.parse({
    ...cloud.offer,
    expiresAt: new Date(Date.parse(TEST_LATER_TIMESTAMP) + 60_000).toISOString(),
    revision: cloud.offer.revision + 1,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  await adapter.acceptOffer({ ...offerPayload(), offerRevision: cloud.offer.revision }, TEST_IDS.agentId)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.offerRevision, cloud.offer.revision)

  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(store.snapshot().taskRuns[0]?.offer.offerRevision, cloud.offer.revision)
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
})

test('a slow presentation Task read cannot gate a manual claim', async () => {
  const cloud = new FakeWorkerCloud()
  const started = deferred<void>()
  const release = deferred<void>()
  cloud.delayNextTaskRead(() => started.resolve(), release.promise)
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Runtime unavailable' }),
    run: async () => { throw new Error('Must wait for Runtime.') }
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await started.promise
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()
  assert.equal(cloud.execution.state, 'accepted')
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-runtime')
  release.resolve()
})

test('a claimed Task waits when the local runtime lacks one exact required capability tag', async () => {
  const cloud = new FakeWorkerCloud()
  let runCalls = 0
  const { adapter, store } = await createRunner(cloud, {
    // The Task requires agent-runtime.codex (makeTask); this Device provides
    // only model access, so the same tag rule dispatch uses must deny it.
    runtimeReadiness: async () => ({
      state: 'ready',
      runtimeId: 'codex',
      capabilityTags: ['model-access.api']
    }),
    run: async () => {
      runCalls += 1
      throw new Error('A Task missing an executable tag must not run.')
    }
  })

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()

  const run = store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'waiting-runtime')
  assert.match(run?.error ?? '', /capability_unavailable/u)
  assert.equal(runCalls, 0)
})

test('a stale claim is retried when an offer extension wins the Cloud CAS', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'offer-extension-retry-thread',
      turnId: 'offer-extension-retry-turn',
      state: 'completed',
      text: completedWorkerResultText('Claimed after retry.')
    })
  })

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  let releaseClaim!: () => void
  let claimStarted!: () => void
  const claimGateStarted = new Promise<void>((resolve) => { claimStarted = resolve })
  const claimGateRelease = new Promise<void>((resolve) => { releaseClaim = resolve })
  cloud.delayNextClaim(claimStarted, claimGateRelease)
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await claimGateStarted

  cloud.offer = taskOfferSchema.parse({
    ...cloud.offer,
    expiresAt: new Date(Date.parse(TEST_LATER_TIMESTAMP) + 60_000).toISOString(),
    revision: cloud.offer.revision + 1,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  await adapter.acceptOffer({ ...offerPayload(), offerRevision: cloud.offer.revision }, TEST_IDS.agentId)
  releaseClaim()
  await adapter.waitForIdle()
  await adapter.waitForIdle()

  assert.equal(store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(store.snapshot().taskRuns[0]?.offer.offerRevision, cloud.offer.revision)
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 2)
})

test('manual rejection closes the User offer globally at the exact Task and Offer revisions', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'reject' })
  await adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.reject'
  ])
  const rejection = cloud.requests.find((request) => request.type === 'task.offer.reject')
  assert.deepEqual(rejection && 'expectedTaskRevision' in rejection ? {
    taskOfferId: rejection.taskOfferId,
    taskId: rejection.taskId,
    expectedTaskRevision: rejection.expectedTaskRevision,
    expectedOfferRevision: rejection.expectedOfferRevision
  } : null, {
    taskOfferId: OFFER_ID,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1
  })
  const rejected = store.snapshot().pendingTaskOffers[0]
  assert.deepEqual(rejected ? {
    state: rejected.state,
    currentTaskRevision: rejected.currentTaskRevision,
    offerRevision: rejected.offerRevision,
    error: rejected.error
  } : null, {
    state: 'closed',
    currentTaskRevision: 2,
    offerRevision: 2,
    error: 'The Worker User rejected the Task offer.'
  })
  assert.equal(cloud.offer.reassignmentTaskRevision, 2)
})

test('a rejected offer fanout closes the same User offer on another Device', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_OfferRejectedFanout1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.closed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: OFFER_ID,
      audience: 'worker',
      outcome: 'rejected',
      taskRevision: 2,
      offerRevision: 2
    }
  })

  await adapter.handleInbox(message)
  await adapter.handleInbox(agentInboxMessageSchema.parse({
    ...message,
    inboxMessageId: 'ibx_OfferRejectedFanout2',
    sequence: 3
  }))

  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'closed')
  assert.equal(store.snapshot().pendingTaskOffers[0]?.currentTaskRevision, 2)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.offerRevision, 2)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.error, 'The Worker User rejected the Task offer.')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
})

test('manual acceptance claims without Runtime readiness and waits before execution', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Runtime is unavailable.' }),
    run: async () => { throw new Error('Unavailable Runtime must not execute a Task.') }
  })

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  assert.deepEqual(store.snapshot().pendingTaskOffers[0]?.preflightReasons, [])
  assert.equal(store.snapshot().tasks[0]?.title, cloud.task.title)
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), ['task.offer.accept'])
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-runtime')
  assert.equal(cloud.execution.state, 'accepted')
})

test('manual text execution journals before Agent and uses explicit vNext commands only', async () => {
  const cloud = new FakeWorkerCloud()
  const projectDisplayName = 'Project\r\nOne\u0085with\u2028all\u2029breaks'
  cloud.projectDisplayName = projectDisplayName
  let store!: CollaborationLocalStore
  const directives: string[] = []
  const sessionTitles: string[] = []
  const workspaceDisplayNames: Array<string | undefined> = []
  let outputSchema: unknown
  const agentExecution: DomainMainAgentExecutionHost = {
    runtimeReadiness: readyRuntimeReadiness,
    prepareSession: async (request) => {
      const parsed = domainMainAgentExecutionSessionRequestSchema.parse(request)
      sessionTitles.push(parsed.title ?? '')
      workspaceDisplayNames.push(parsed.workspaceDisplayName)
      return { runtimeId: 'codex', threadId: 'worker-thread-stable' }
    },
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      outputSchema = request.outputSchema
      const run = store.snapshot().taskRuns[0]
      assert.equal(run?.agentJournal[0]?.state, 'dispatched', 'Agent effect must follow durable dispatch journal')
      assert.deepEqual({
        runtimeId: run?.runtimeId,
        threadId: run?.threadId,
        journalRuntimeId: run?.agentJournal[0]?.runtimeId,
        journalThreadId: run?.agentJournal[0]?.threadId
      }, {
        runtimeId: request.runtimeId,
        threadId: request.threadId,
        journalRuntimeId: request.runtimeId,
        journalThreadId: request.threadId
      }, 'Runtime Session binding must be durable before turn dispatch')
      return {
        runtimeId: 'codex',
        threadId: 'worker-thread-stable',
        turnId: 'worker-turn-stable',
        state: 'completed',
        text: completedWorkerResultText('Result ready.')
      }
    }
  }
  const created = await createRunner(cloud, agentExecution)
  store = created.store

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
  assert.equal(cloud.commands.includes('task.transition'), false)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  assert.equal(directives.length, 1)
  assert.deepEqual(sessionTitles, [cloud.task.title])
  assert.deepEqual(workspaceDisplayNames, ['Project One with all breaks'])
  assert.equal(cloud.projectDisplayName, projectDisplayName)
  assert.deepEqual(outputSchema, workerRuntimeResultOutputSchema)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.equal(store.snapshot().taskRuns[0]?.resultSummary, 'Result ready.')
  const completed = store.snapshot().taskRuns[0]
  assert.ok(completed)
  const boundedView = collaborationTaskViewForRun({
    ...completed,
    resultSummary: 'x'.repeat(5_000)
  })
  assert.equal([...boundedView.resultSummary!].length, 4_000)
  assert.match(boundedView.resultSummary!, /…$/u)
  const boundedAstralView = collaborationTaskViewForRun({
    ...completed,
    resultSummary: '😀'.repeat(3_000)
  })
  assert.ok(boundedAstralView.resultSummary!.length <= 4_000)
  assert.doesNotThrow(() => collaborationTaskViewSchema.parse(boundedAstralView))

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  assert.equal(directives.length, 1, 'duplicate offer must not replay a completed execution')
})

test('a maximum-length Unicode Worker summary reaches local state and Cloud unchanged', async () => {
  const cloud = new FakeWorkerCloud()
  const summary = '🧬'.repeat(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-unicode-summary-thread',
      turnId: 'worker-unicode-summary-turn',
      state: 'completed',
      text: completedWorkerResultText(summary)
    })
  })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'waiting-result-confirm')
  assert.equal(run?.resultSummary, summary)
  // The editable local draft carries the exact summary; freezing waits for a human click.
  assert.equal(run?.deliveryDraft?.summary, summary)
  assert.equal(run?.frozenCandidate, null)
  assert.equal(cloud.commands.filter((type) => type.startsWith('delivery.') || type === 'object.stage').length, 0)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('a malformed Worker result gets one same-Session repair turn before fencing', async () => {
  const cloud = new FakeWorkerCloud()
  const directives: string[] = []
  let store!: CollaborationLocalStore
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      if (directives.length === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-thread-stable',
          turnId: 'worker-invalid-turn',
          state: 'completed',
          text: 'The research is complete, but this is not the Worker result protocol.'
        }
      }
      assert.equal(request.runtimeId, 'codex')
      assert.equal(request.threadId, 'worker-thread-stable')
      assert.match(request.prompt, /previous Worker response did not match/u)
      assert.match(request.prompt, /exactly one JSON object/u)
      return {
        runtimeId: 'codex',
        threadId: 'worker-thread-stable',
        turnId: 'worker-repaired-turn',
        state: 'completed',
        text: completedWorkerResultText('Repaired Worker result.')
      }
    }
  })
  store = created.store

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.equal(directives.length, 2)
  assert.notEqual(directives[0], directives[1])
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.equal(created.store.snapshot().taskRuns[0]?.resultSummary, 'Repaired Worker result.')
  assert.deepEqual(created.store.snapshot().taskRuns[0]?.agentJournal.map(({ state }) => state), [
    'observed_failure',
    'observed_success'
  ])
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
})

test('a placeholder needs_human question gets one same-Session repair turn before HumanNeeded', async () => {
  const cloud = new FakeWorkerCloud()
  const directives: string[] = []
  const question = '用哪个物种？'
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      if (directives.length === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-question-thread',
          turnId: 'worker-placeholder-question-turn',
          state: 'completed',
          text: needsHumanWorkerResultText('请')
        }
      }
      assert.equal(request.runtimeId, 'codex')
      assert.equal(request.threadId, 'worker-question-thread')
      assert.match(request.prompt, /previous Worker response did not match/u)
      assert.match(request.prompt, /complete question the Worker User can answer directly/u)
      return {
        runtimeId: 'codex',
        threadId: 'worker-question-thread',
        turnId: 'worker-question-repaired-turn',
        state: 'completed',
        text: needsHumanWorkerResultText(question)
      }
    }
  })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.equal(directives.length, 2)
  assert.notEqual(directives[0], directives[1])
  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'needs-human')
  assert.ok(run)
  assert.equal(collaborationTaskViewForRun(run).needsHumanQuestion, question)
  assert.deepEqual(run?.agentJournal.map(({ state }) => state), [
    'observed_failure',
    'observed_success'
  ])
  assert.equal(run?.agentJournal[0]?.safeError?.includes('strict Worker JSON result'), true)
  const humanRequests = cloud.requests.filter((request) => request.type === 'human.needed.create')
  assert.equal(humanRequests.length, 1)
  const [humanRequest] = humanRequests
  assert.equal(
    humanRequest?.type === 'human.needed.create' ? humanRequest.prompt : null,
    question
  )
})

test('overlong and malformed Worker results journal both failures and fail Cloud exactly once', async () => {
  const cloud = new FakeWorkerCloud()
  let runtimeRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-invalid-thread',
        turnId: `worker-invalid-turn-${runtimeRuns}`,
        state: 'completed',
        text: runtimeRuns === 1
          ? completedWorkerResultText('🧬'.repeat(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS + 1))
          : JSON.stringify({
              schemaVersion: 1,
              outcome: 'completed',
              summary: 'Legacy flat Worker result.'
            })
      }
    }
  })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(runtimeRuns, 2)
  assert.equal(run?.state, 'failed')
  assert.deepEqual(run?.agentJournal.map(({ state }) => state), [
    'observed_failure',
    'observed_failure'
  ])
  assert.equal(run?.agentJournal.every(({ safeError }) => (
    safeError?.includes('strict Worker JSON result') === true
  )), true)
  assert.equal(cloud.commands.filter((type) => type === 'task.execution.fail').length, 1)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  const failure = cloud.requests.find((request) => request.type === 'task.execution.fail')
  assert.equal(
    failure?.type === 'task.execution.fail' ? failure.safeFailureCode : null,
    'invalid_runtime_result'
  )
})

test('a paused Worker result resumes submission without repeating the Agent turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const runtimeStarted = deferred<void>()
  const releaseRuntime = deferred<void>()
  let runtimeRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeRuns += 1
      runtimeStarted.resolve(undefined)
      await releaseRuntime.promise
      return {
        runtimeId: 'codex',
        threadId: 'worker-paused-thread',
        turnId: 'worker-paused-turn',
        state: 'completed',
        text: completedWorkerResultText('Result held while paused.')
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await runtimeStarted.promise
  const paused = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'pause'
  })
  assert.equal(paused.state, 'applied')
  releaseRuntime.resolve(undefined)
  await created.adapter.waitForIdle()

  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'running')
  assert.equal(created.store.snapshot().taskRuns[0]?.resultSummary, 'Result held while paused.')
  assert.equal(cloud.commands.includes('task.result.submit'), false)

  const resumed = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'resume'
  })
  assert.equal(resumed.state, 'applied')
  await created.adapter.waitForIdle()

  assert.equal(runtimeRuns, 1)

  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.equal(created.store.snapshot().taskRuns[0]?.deliveryDraft?.summary, 'Result held while paused.')
  assert.equal(cloud.commands.filter((type) => type.startsWith('delivery.') || type === 'object.stage').length, 0)
})

test('Worker HumanNeeded targets its Worker User and resumes the same execution and Runtime Session', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const runtimeRequests: Array<Readonly<{
    runtimeId?: string
    threadId?: string
    clientDirectiveId?: string
    prompt: string
    outputSchema?: unknown
  }>> = []
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      runtimeRequests.push(request)
      if (runtimeRequests.length === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-human-thread',
          turnId: 'worker-human-question-turn',
          state: 'completed',
          text: needsHumanWorkerResultText('Should the ambiguous samples remain in the analysis?')
        }
      }
      assert.equal(request.runtimeId, 'codex')
      assert.equal(request.threadId, 'worker-human-thread')
      assert.match(request.prompt, /authenticated Worker User/u)
      assert.match(request.prompt, new RegExp(humanAnswerFixture.answer, 'u'))
      return {
        runtimeId: 'codex',
        threadId: 'worker-human-thread',
        turnId: 'worker-human-answer-turn',
        state: 'completed',
        text: completedWorkerResultText('The Worker-User-confirmed analysis is complete.')
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  const pending = created.store.snapshot().taskRuns[0]
  assert.equal(pending?.state, 'needs-human')
  assert.equal(pending?.humanRequestId, TEST_IDS.humanRequestId)
  assert.equal(pending?.task?.revision, cloud.task.revision)
  assert.equal(pending?.execution?.revision, cloud.execution.revision)
  assert.equal(pending?.execution?.state, 'needs_human')
  assert.equal(pending?.expectedTaskRevision, cloud.task.revision)
  assert.equal(pending?.expectedExecutionRevision, cloud.execution.revision)
  assert.ok(pending)
  assert.deepEqual(collaborationTaskViewForRun(pending), {
    taskId: TEST_IDS.taskId,
    projectId: TEST_IDS.projectId,
    taskOfferId: OFFER_ID,
    workerUserId: TEST_IDS.userId,
    executionId: TEST_IDS.executionId,
    assigneeAgentId: TEST_IDS.agentId,
    contractRevision: 1,
    contractDigest: TEST_HASH,
    hasDedicatedSession: true,
    revision: cloud.task.revision,
    title: cloud.task.title,
    state: 'needs-human',
    decisionRequired: false,
    preflightReasons: [],
    localTurnId: 'worker-human-question-turn',
    needsHumanQuestion: 'Should the ambiguous samples remain in the analysis?',
    updatedAt: TEST_TIMESTAMP
  })
  const humanRequest = cloud.requests.find((request) => request.type === 'human.needed.create')
  assert.equal(humanRequest?.type, 'human.needed.create')
  if (humanRequest?.type !== 'human.needed.create') throw new Error('Missing Worker HumanNeeded command.')
  assert.deepEqual(humanRequest.context, {
    scope: 'worker_execution',
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 2
  })
  assert.equal(humanRequest.targetUserId, TEST_IDS.userId)
  assert.equal(humanRequest.confirmableAction, null)

  await created.store.transact((draft) => {
    const run = draft.taskRuns[0]
    if (!run) throw new Error('Missing local Worker run.')
    run.humanRequestId = null
    draft.outbox.push({
      outboxId: 'obx_WorkerHumanNeeded01',
      idempotencyKey: humanRequest.idempotencyKey,
      kind: 'task.human-needed',
      body: humanRequest,
      state: 'delivered',
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
      deliveredAt: TEST_TIMESTAMP,
      response: entityResponse(humanRequest, {
        ...humanNeededFixture,
        requiredAssurance: humanRequest.requiredAssurance,
        prompt: humanRequest.prompt,
        expiresAt: humanRequest.expiresAt
      })
    })
  })

  cloud.answerHumanNeeded()
  const answerMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_WorkerHumanAnswer1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: humanAnswerFixture
    }
  })
  await created.adapter.handleInbox(answerMessage)
  await created.adapter.waitForIdle()

  const completed = created.store.snapshot().taskRuns[0]
  assert.equal(completed?.state, 'waiting-result-confirm')
  assert.equal(completed?.resultSummary, 'The Worker-User-confirmed analysis is complete.')
  assert.ok(completed)
  assert.equal(
    collaborationTaskViewForRun(completed).resultSummary,
    'The Worker-User-confirmed analysis is complete.'
  )
  assert.equal(collaborationTaskViewForRun(completed).needsHumanQuestion, undefined)
  assert.equal(runtimeRequests.length, 2)
  assert.deepEqual(
    runtimeRequests.map((request) => request.outputSchema),
    [workerRuntimeResultOutputSchema, workerRuntimeResultOutputSchema]
  )
  assert.notEqual(runtimeRequests[0]?.clientDirectiveId, runtimeRequests[1]?.clientDirectiveId)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'human.needed.create'
  ])
  const reconciliationIndex = cloud.preflightExpectedRevisions.findIndex((revision, index, all) => (
    revision.task === 4 &&
    revision.execution === 3 &&
    all[index + 1]?.task === 5 &&
    all[index + 1]?.execution === 4
  ))
  assert.notEqual(reconciliationIndex, -1)
  assert.equal(cloud.preflightExpectedRevisions.slice(reconciliationIndex + 1).every((revision) => (
    revision.task === 5 && revision.execution === 4
  )), true)

  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...answerMessage,
    inboxMessageId: 'ibx_WorkerHumanAnswerDuplicate',
    sequence: 3
  }))
  await created.adapter.waitForIdle()
  assert.equal(runtimeRequests.length, 2)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
})

test('Worker HumanNeeded preserves an answer received while its Cloud revisions are refreshing', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const refreshStarted = deferred<void>()
  const releaseRefresh = deferred<void>()
  cloud.delayNextPreflight('needs_human', refreshStarted.resolve, releaseRefresh.promise)
  let runtimeRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeRuns += 1
      if (runtimeRuns === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-human-race-thread',
          turnId: 'worker-human-race-question',
          state: 'completed',
          text: needsHumanWorkerResultText('Continue after the revision refresh?')
        }
      }
      return {
        runtimeId: 'codex',
        threadId: 'worker-human-race-thread',
        turnId: 'worker-human-race-answer',
        state: 'completed',
        text: completedWorkerResultText('The concurrent HumanNeeded answer resumed the Worker.')
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await refreshStarted.promise
  cloud.answerHumanNeeded()
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_WorkerHumanAnswerDuringRefresh',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: humanAnswerFixture
    }
  }))
  releaseRefresh.resolve()
  await created.adapter.waitForIdle()

  const completed = created.store.snapshot().taskRuns[0]
  assert.equal(runtimeRuns, 2)
  assert.equal(completed?.state, 'waiting-result-confirm')
  assert.equal(completed?.resultSummary, 'The concurrent HumanNeeded answer resumed the Worker.')
})

test('Worker recovery refreshes a durable needs-human run without restarting its Runtime', async () => {
  const cloud = new FakeWorkerCloud('running')
  const legacyRun = durableTaskRun(cloud, {
    state: 'needs-human',
    runtimeId: 'codex',
    threadId: 'worker-human-thread',
    humanRequestId: TEST_IDS.humanRequestId
  })
  cloud.enterHumanNeeded()
  const initial = emptyState()
  if (!legacyRun.task) throw new Error('Missing legacy Worker Task.')
  initial.tasks = [legacyRun.task]
  initial.taskRuns = [legacyRun]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('A pending HumanNeeded recovery must not restart the Worker Runtime.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  const recovered = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(recovered?.state, 'needs-human')
  assert.equal(recovered?.humanRequestId, TEST_IDS.humanRequestId)
  assert.equal(recovered?.task?.revision, cloud.task.revision)
  assert.equal(recovered?.execution?.revision, cloud.execution.revision)
  assert.equal(recovered?.execution?.state, 'needs_human')
  assert.equal(recovered?.expectedTaskRevision, cloud.task.revision)
  assert.equal(recovered?.expectedExecutionRevision, cloud.execution.revision)
})

test('Worker recovery does not rerun a needs-human journal while its Cloud transition is pending', async () => {
  const cloud = new FakeWorkerCloud('running')
  const pendingRun = durableTaskRun(cloud, {
    state: 'needs-human',
    runtimeId: 'codex',
    threadId: 'worker-human-thread',
    humanRequestId: null
  })
  const initial = emptyState()
  if (!pendingRun.task) throw new Error('Missing pending Worker Task.')
  initial.tasks = [pendingRun.task]
  initial.taskRuns = [pendingRun]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: async () => ({
      state: 'unavailable',
      reason: 'Runtime remains unavailable while the HumanNeeded transition is pending.'
    }),
    run: async () => {
      agentRuns += 1
      throw new Error('Recovery must not rerun a Worker awaiting its HumanNeeded transition.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  const recovered = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(recovered?.state, 'needs-human')
  assert.equal(recovered?.execution?.state, 'running')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
})

test('post-claim Cloud authority denial closes the execution through the canonical failure command', async () => {
  const cloud = new FakeWorkerCloud('running')
  cloud.denyPreflight()
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1
  })]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('Denied authority must not reach Runtime.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 0)
  assert.deepEqual(cloud.preflightExpectedRevisions, [{ task: 1, execution: 1 }])
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), ['task.execution.fail'])
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'failed')
})

test('a claimed Device waits for Runtime and wakes exactly once on recovery', async () => {
  const cloud = new FakeWorkerCloud()
  let ready = false
  let runs = 0
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ready ? readyRuntimeReadiness()
      : ({ state: 'unavailable', reason: 'Temporarily unavailable' }),
    run: async () => {
      runs += 1
      return { runtimeId: 'codex', threadId: 'wait-runtime-thread', turnId: 'wait-runtime-turn',
        state: 'completed', text: completedWorkerResultText('Recovered once.') }
    }
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-runtime')
  assert.equal(cloud.execution.state, 'accepted')
  assert.equal(runs, 0)
  ready = true
  adapter.wake()
  adapter.wake()
  await adapter.waitForIdle()
  adapter.wake()
  await adapter.waitForIdle()
  assert.equal(runs, 1)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
})

test('a terminal AgentRuntime failure is journaled while the member keeps execution authority', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-failed-thread',
      turnId: 'worker-failed-turn',
      state: 'failed',
      text: 'Bounded Runtime failure.'
    })
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'running')
  assert.equal(run?.execution?.state, 'running')
  assert.equal(run?.agentJournal.length, 1)
  assert.equal(run?.agentJournal[0]?.state, 'observed_failure')
  assert.equal(run?.agentJournal[0]?.runtimeId, 'codex')
  assert.equal(run?.agentJournal[0]?.threadId, 'worker-failed-thread')
  assert.equal(run?.agentJournal[0]?.turnId, 'worker-failed-turn')
  assert.equal(run?.agentJournal[0]?.runtimeState, 'failed')
  assert.equal(run?.lateOutcomes.length, 0)
  assert.deepEqual(collaborationTaskViewForRun(run!).failure, {
    code: 'runtime_failed',
    message: 'Agent turn ended in failed.',
    retryable: false,
    retryState: 'available'
  })
})

test('a retryable failure parks until each explicit retry creates exactly one new turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  let attempts = 0
  const directives: string[] = []
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    prepareSession: async () => ({ runtimeId: 'codex', threadId: 'worker-retry-thread' }),
    run: async (request) => {
      attempts += 1
      directives.push(request.clientDirectiveId ?? '')
      return attempts < 3 ? {
        runtimeId: 'codex',
        threadId: 'worker-retry-thread',
        turnId: `worker-retry-turn-${attempts}`,
        state: 'failed' as const,
        text: '',
        failure: {
          code: attempts === 1 ? 'model_capacity' : 'runtime_connection_interrupted',
          message: attempts === 1
            ? 'Selected model is at capacity. Please try again.'
            : 'Runtime stream disconnected before completion.',
          retryable: true
        }
      } : {
        runtimeId: 'codex',
        threadId: 'worker-retry-thread',
        turnId: 'worker-retry-turn-3',
        state: 'completed' as const,
        text: completedWorkerResultText('Succeeded after capacity cleared.')
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.equal(attempts, 1)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  const initialFailedRun = created.store.snapshot().taskRuns[0]
  assert.ok(initialFailedRun)
  assert.deepEqual(
    collaborationTaskViewForRun(initialFailedRun).failure,
    {
      code: 'model_capacity',
      message: 'Selected model is at capacity. Please try again.',
      retryable: true,
      retryState: 'available'
    }
  )

  const firstRetry = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry'
  })
  assert.equal(firstRetry.state, 'failed')
  assert.equal(attempts, 2)
  const secondFailedRun = created.store.snapshot().taskRuns[0]
  assert.ok(secondFailedRun)
  assert.deepEqual(collaborationTaskViewForRun(
    secondFailedRun,
    created.store.snapshot().taskInteractions
  ).failure, {
    code: 'runtime_connection_interrupted',
    message: 'Runtime stream disconnected before completion.',
    retryable: true,
    retryState: 'failed'
  })

  const secondRetry = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry'
  })
  await created.adapter.waitForIdle()

  assert.equal(secondRetry.state, 'applied')
  assert.equal(attempts, 3)
  assert.equal(new Set(directives).size, 3)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'waiting-result-confirm')
  assert.equal(run?.agentJournal.length, 3)
  assert.deepEqual(run?.agentJournal.map(({ runtimeState }) => runtimeState), [
    'failed', 'failed', 'completed'
  ])
  assert.match(run?.agentJournal[0]?.safeError ?? '', /at capacity/u)
})

test('sanitizes a structured Runtime failure before durable storage and Task rendering', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const created = await createRunner(
    cloud,
    {
      runtimeReadiness: readyRuntimeReadiness,
      run: async () => ({
        runtimeId: 'codex', threadId: 'worker-sanitized-failure-thread', turnId: 'sanitized-failure',
        state: 'failed', text: '',
        failure: {
          code: 'model_capacity',
          message: 'Selected model is at capacity. credential=secret-value',
          retryable: true
        }
      })
    },
    initial,
    {
      backend: new MemoryBackend(initial),
      sanitizeText: (value) => value.replace(/secret-value/gu, '[REDACTED]')
    }
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  const run = created.store.snapshot().taskRuns[0]!
  assert.equal(run.agentJournal[0]?.failure?.message.includes('secret-value'), false)
  assert.equal(collaborationTaskViewForRun(run).failure?.message.includes('secret-value'), false)
  assert.match(run.agentJournal[0]?.failure?.message ?? '', /\[REDACTED\]/u)
})

test('duplicate concurrent retry clicks share one durable interaction and one Runtime turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const retryStarted = deferred<void>()
  const releaseRetry = deferred<void>()
  let attempts = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      attempts += 1
      if (attempts > 1) {
        retryStarted.resolve()
        await releaseRetry.promise
      }
      return {
        runtimeId: 'codex',
        threadId: 'worker-concurrent-retry-thread',
        turnId: `worker-concurrent-retry-turn-${attempts}`,
        state: 'failed' as const,
        text: '',
        failure: {
          code: 'model_capacity',
          message: 'Selected model is at capacity.',
          retryable: true
        }
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  assert.equal(attempts, 1)

  const input = {
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry' as const
  }
  const first = created.adapter.submitTaskInteraction(input)
  await retryStarted.promise
  const second = created.adapter.submitTaskInteraction(input)
  const secondResult = await second
  releaseRetry.resolve()
  const firstResult = await first

  assert.equal(attempts, 2)
  assert.equal(firstResult.interactionId, secondResult.interactionId)
  assert.equal(created.store.snapshot().taskInteractions.filter(({ kind }) => kind === 'retry').length, 1)
})

test('a retry without an explicit execution id dispatches immediately against the resolved run', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  let attempts = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      attempts += 1
      return {
        runtimeId: 'codex', threadId: 'worker-resolved-retry-thread',
        turnId: `worker-resolved-retry-turn-${attempts}`,
        state: 'failed', text: '',
        failure: { code: 'model_capacity', message: 'Selected model is at capacity.', retryable: true }
      }
    }
  }, initial)
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  const retry = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    kind: 'retry'
  })

  assert.equal(attempts, 2)
  assert.equal(retry.state, 'failed')
})

test('a nonretryable turn failure keeps the draft open without automatic recovery', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  let attempts = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      attempts += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-permanent-retry-thread',
        turnId: `worker-permanent-retry-turn-${attempts}`,
        state: 'failed' as const,
        text: '',
        failure: attempts === 1 ? {
          code: 'model_capacity',
          message: 'Selected model is at capacity.',
          retryable: true
        } : {
          code: 'authentication_required',
          message: 'Runtime authentication is required.',
          retryable: false
        }
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  const retry = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry'
  })
  await created.adapter.waitForIdle()

  assert.equal(retry.state, 'failed')
  assert.equal(attempts, 2)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'running')
  assert.equal(cloud.commands.filter((type) => type === 'task.execution.fail').length, 0)

  await created.adapter.recover()
  await created.adapter.waitForIdle()
  assert.equal(attempts, 2)
})

test('an interrupted prepared retry is quarantined until a fresh click creates a fresh Runtime directive', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const first = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex', threadId: 'worker-retry-crash-thread', turnId: 'initial-failure',
      state: 'failed', text: '',
      failure: { code: 'model_capacity', message: 'Selected model is at capacity.', retryable: true }
    })
  }, initial)
  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await first.adapter.waitForIdle()

  const journal = new TaskInteractionJournal(first.store, () => new Date(TEST_TIMESTAMP))
  const interrupted = await journal.enqueue({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry',
    idempotencyKey: 'idem_interrupted_retry_0001'
  })
  await journal.markDispatching(interrupted.interactionId)
  await first.store.transact((draft) => {
    const run = draft.taskRuns[0]!
    run.agentJournal.push({
      logicalInvocationId: `agent.${TEST_IDS.executionId}.2`,
      clientDirectiveId: 'collab-worker-interrupted-retry',
      retryInteractionId: interrupted.interactionId,
      state: 'prepared',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: null,
      observedAt: null,
      runtimeId: run.runtimeId,
      threadId: run.threadId,
      turnId: null,
      runtimeState: null,
      safeResultText: null,
      safeError: null
    })
  })

  const directives: string[] = []
  const restarted = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      return {
        runtimeId: 'codex', threadId: 'worker-retry-crash-thread', turnId: 'fresh-retry',
        state: 'completed', text: completedWorkerResultText('Recovered with a fresh click.')
      }
    }
  }, first.store.snapshot())

  await restarted.adapter.recover()
  await restarted.adapter.waitForIdle()
  assert.equal(directives.length, 0)

  await restarted.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry'
  })
  await restarted.adapter.waitForIdle()
  assert.equal(directives.length, 1)
  assert.notEqual(directives[0], 'collab-worker-interrupted-retry')
})

test('recovery finalizes an already observed retry success without starting another Runtime turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const first = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex', threadId: 'worker-retry-observed-thread', turnId: 'initial-failure',
      state: 'failed', text: '',
      failure: { code: 'model_capacity', message: 'Selected model is at capacity.', retryable: true }
    })
  }, initial)
  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await first.adapter.waitForIdle()

  const journal = new TaskInteractionJournal(first.store, () => new Date(TEST_TIMESTAMP))
  const interrupted = await journal.enqueue({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry',
    idempotencyKey: 'idem_observed_retry_0001'
  })
  await journal.markDispatching(interrupted.interactionId)
  await first.store.transact((draft) => {
    const run = draft.taskRuns[0]!
    run.agentJournal.push({
      logicalInvocationId: `agent.${TEST_IDS.executionId}.2`,
      clientDirectiveId: 'collab-worker-observed-retry',
      retryInteractionId: interrupted.interactionId,
      state: 'observed_success',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_TIMESTAMP,
      runtimeId: run.runtimeId,
      threadId: run.threadId,
      turnId: 'observed-retry-turn',
      runtimeState: 'completed',
      safeResultText: completedWorkerResultText('Recovered observed retry result.'),
      safeError: null,
      failure: null
    })
  })

  let runtimeTurns = 0
  const restarted = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeTurns += 1
      throw new Error('Recovery must not start another Runtime turn.')
    }
  }, first.store.snapshot())
  await restarted.adapter.recover()
  await restarted.adapter.waitForIdle()

  assert.equal(runtimeTurns, 0)
  assert.equal(restarted.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.equal(cloud.commands.filter((type) => type === 'task.result.submit').length, 0)
})

test('recovery preserves the draft after an observed nonretryable turn without another Runtime turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const first = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex', threadId: 'worker-retry-permanent-thread', turnId: 'initial-failure',
      state: 'failed', text: '',
      failure: { code: 'model_capacity', message: 'Selected model is at capacity.', retryable: true }
    })
  }, initial)
  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await first.adapter.waitForIdle()

  const journal = new TaskInteractionJournal(first.store, () => new Date(TEST_TIMESTAMP))
  const interrupted = await journal.enqueue({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'retry',
    idempotencyKey: 'idem_permanent_retry_0001'
  })
  await journal.markDispatching(interrupted.interactionId)
  await first.store.transact((draft) => {
    const run = draft.taskRuns[0]!
    run.agentJournal.push({
      logicalInvocationId: `agent.${TEST_IDS.executionId}.2`,
      clientDirectiveId: 'collab-worker-permanent-retry',
      retryInteractionId: interrupted.interactionId,
      state: 'observed_failure',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_TIMESTAMP,
      runtimeId: run.runtimeId,
      threadId: run.threadId,
      turnId: 'permanent-retry-turn',
      runtimeState: 'failed',
      safeResultText: '',
      safeError: 'Runtime authentication is required.',
      failure: {
        code: 'authentication_required',
        message: 'Runtime authentication is required.',
        retryable: false
      }
    })
  })

  let runtimeTurns = 0
  const restarted = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeTurns += 1
      throw new Error('Recovery must not start another Runtime turn.')
    }
  }, first.store.snapshot())
  await restarted.adapter.recover()
  await restarted.adapter.waitForIdle()

  assert.equal(runtimeTurns, 0)
  assert.equal(restarted.store.snapshot().taskRuns[0]?.state, 'running')
  assert.equal(cloud.commands.filter((type) => type === 'task.execution.fail').length, 0)
})

test('local cancellation does not restart a parked transient Runtime failure', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const firstAttemptFinished = deferred<void>()
  let attempts = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      attempts += 1
      firstAttemptFinished.resolve()
      return {
        runtimeId: 'codex',
        threadId: 'worker-cancelled-retry-thread',
        turnId: `worker-cancelled-retry-turn-${attempts}`,
        state: 'failed' as const,
        text: '',
        failure: {
          code: 'runtime_connection_interrupted',
          message: 'Runtime stream disconnected before completion.',
          retryable: true
        }
      }
    }
  }, initial, { backend: new MemoryBackend(initial) })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await firstAttemptFinished.promise
  const cancelled = await created.adapter.submitTaskInteraction({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'cancel'
  })
  await created.adapter.waitForIdle()

  assert.equal(cancelled.state, 'applied')
  assert.equal(attempts, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
})

test('restart after accept starts and completes the same execution without accepting it twice', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-accepted-restart-thread',
        turnId: 'worker-accepted-restart-turn',
        state: 'completed',
        text: completedWorkerResultText('Recovered.')
      }
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 1)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start'
  ])
  assert.equal(created.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
})

for (const legacyFailed of [false, true]) {
test(`a response lost after the Cloud offer claim resumes its durable receipt into the original execution${legacyFailed ? ' from historical failed state' : ''}`, async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const backend = new MemoryBackend(initial)
  const acceptedRequests: RestRequest[] = []
  let acceptedResponse: RestResponse | undefined
  let acceptAttempts = 0
  let businessCommits = 0
  let loseFirstResponse = true
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type !== 'task.offer.accept') {
          return cloud.outbox().enqueueAndWait('task.progress', request)
        }
        acceptAttempts += 1
        acceptedRequests.push(structuredClone(request))
        if (!acceptedResponse) {
          acceptedResponse = await cloud.outbox().enqueueAndWait('task.offer-decision', request)
          businessCommits += 1
        }
        if (loseFirstResponse) {
          loseFirstResponse = false
          throw new Error('response lost after canonical Cloud claim commit')
        }
        return acceptedResponse
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    { backend: backend, outboxFactory: outboxFactory }
  )

  await interrupted.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await interrupted.adapter.waitForIdle()
  await interrupted.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await interrupted.adapter.waitForIdle()

  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(interrupted.store.snapshot().taskRuns.length, 0)
  assert.equal(interrupted.store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(acceptAttempts, 1)
  assert.equal(businessCommits, 1)
  if (legacyFailed) await interrupted.store.transact((draft) => Object.assign(draft.pendingTaskOffers[0]!, {
    state: 'failed', completedAt: TEST_TIMESTAMP, error: 'Historical authority loss after a Cloud commit'
  }))
  await interrupted.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_SelfClaimAfterLostResponse1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.claimed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: OFFER_ID,
      claimedByAgentId: TEST_IDS.agentId,
      executionId: TEST_IDS.executionId,
      offerRevision: 2
    }
  }))
  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, legacyFailed ? 'failed' : 'claiming')
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-claim-response-loss-thread',
        turnId: 'worker-claim-response-loss-turn',
        state: 'completed',
        text: completedWorkerResultText('Recovered the original accepted execution.')
      }
    }
  }, initial, { backend, outboxFactory })

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  assert.equal(acceptAttempts, 2)
  assert.equal(businessCommits, 1)
  assert.deepEqual(acceptedRequests[1], acceptedRequests[0])
  assert.equal(agentRuns, 1)
  assert.equal(resumed.store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(resumed.store.snapshot().taskRuns.length, 1)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
})
}

test('an offer claim remains resumable when its outbox retry is already reconciling', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const outboxFactory = (store: CollaborationLocalStore) => ({
    enqueueAndWait: async (kind: string, rawRequest: RestRequest): Promise<RestResponse> => {
      const request = restRequestSchema.parse(rawRequest)
      assert.equal(kind, 'task.offer-decision')
      assert.equal(request.type, 'task.offer.accept')
      if (request.type !== 'task.offer.accept') throw new Error('Invalid claim race fixture.')
      await store.transact((draft) => {
        draft.outbox.push({
          outboxId: 'obx_WorkerClaimReconciling1',
          idempotencyKey: request.idempotencyKey,
          kind: 'task.offer-decision',
          body: request,
          state: 'reconciling',
          attempts: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_LATER_TIMESTAMP
        })
      })
      throw new Error('response outcome is still being reconciled')
    }
  }) as unknown as DurableCloudOutbox
  const created = await createRunner(
    cloud,
    neverAgent(),
    initial,
    { backend: new MemoryBackend(initial), outboxFactory: outboxFactory }
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.equal(created.store.snapshot().outbox[0]?.state, 'reconciling')
  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(created.store.snapshot().taskRuns.length, 0)
})

test('a strict Cloud offer-claim conflict is terminal locally and is not retried', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  let claimAttempts = 0
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'task.offer.accept')
        claimAttempts += 1
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: request.requestId,
          error: createCollaborationError(
            'revision_conflict',
            'Another Device already claimed this User offer.'
          )
        })
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const created = await createRunner(
    cloud,
    neverAgent(),
    initial,
    { backend: new MemoryBackend(initial), outboxFactory: outboxFactory }
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(claimAttempts, 1)
  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.equal(created.store.snapshot().taskRuns.length, 0)
  assert.equal(created.store.snapshot().outbox[0]?.state, 'delivered')
})

test('restart after a durable offer claim receipt persists and runs the same Cloud execution', async () => {
  const cloud = new FakeWorkerCloud()
  const offeredTask = structuredClone(cloud.task)
  const requestFacts = {
    taskOfferId: OFFER_ID,
    taskId: TEST_IDS.taskId,
    agentId: TEST_IDS.agentId,
    interaction: 'explicit_click' as const,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedContractRevision: 1,
    expectedContractDigest: TEST_HASH
  }
  const claimRequest = restRequestSchema.parse({
    protocolVersion: '1.0',
    requestId: 'req_WorkerClaimCrash01',
    type: 'task.offer.accept',
    idempotencyKey: `idem_task.offer.accept.${digestFixture(requestFacts).slice(0, 48)}`,
    ...requestFacts
  })
  if (claimRequest.type !== 'task.offer.accept') throw new Error('Invalid claim fixture.')
  const claimResponse = await cloud.outbox().enqueueAndWait('task.offer-decision', claimRequest)
  const initial = emptyState()
  initial.tasks = [offeredTask]
  initial.pendingTaskOffers = [{
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    taskOfferId: OFFER_ID,
    workerUserId: TEST_IDS.userId,
    currentTaskRevision: 1,
    offerRevision: 1,
    contractRevision: 1,
    contractDigest: TEST_HASH,
    recipientAgentId: TEST_IDS.agentId,
    receivedAt: TEST_TIMESTAMP,
    preflightReasons: [],
    state: 'claiming',
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  initial.outbox = [{
    outboxId: 'obx_WorkerClaimCrash01',
    idempotencyKey: claimRequest.idempotencyKey,
    kind: 'task.offer-decision',
    body: claimRequest,
    state: 'delivered',
    attempts: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    deliveredAt: TEST_LATER_TIMESTAMP,
    response: claimResponse
  }]
  const backend = new FailOnceTaskRunBackend(initial)
  const interrupted = await createRunner(cloud, neverAgent(), initial, { backend })

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()

  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(interrupted.store.snapshot().taskRuns.length, 0)
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
  interrupted.adapter.stop()

  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-claim-crash-thread',
        turnId: 'worker-claim-crash-turn',
        state: 'completed',
        text: completedWorkerResultText('Recovered claim.')
      }
    }
  }, initial, { backend })

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 1)
  assert.equal(created.store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(created.store.snapshot().taskRuns.length, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
})

test('restart after the delivered execution start restores its Cloud timestamp before result submission', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  const backend = new FailOnceStartedRunBackend(initial)
  let startBusinessCommits = 0
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type === 'task.execution.start') startBusinessCommits += 1
        return cloud.outbox().enqueueAndWait('task.progress', request)
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    { backend: backend, outboxFactory: outboxFactory }
  )

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()
  await interrupted.outbox.waitForIdle()

  const interruptedRun = interrupted.store.snapshot().taskRuns[0]
  assert.equal(interruptedRun?.state, 'accepting')
  assert.equal(interruptedRun?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.equal(interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')?.state, 'delivered')
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-start-checkpoint-thread',
        turnId: 'worker-start-checkpoint-turn',
        state: 'completed',
        text: completedWorkerResultText('Completed after restoring the Cloud start provenance.')
      }
    }
  }, initial, { backend, outboxFactory })

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  const startRequest = cloud.requests.find((request) => request.type === 'task.execution.start')
  assert.equal(startRequest?.type, 'task.execution.start')
  const resumedRun = resumed.store.snapshot().taskRuns[0]
  assert.equal(resumed.store.snapshot().taskRuns.length, 1)
  assert.equal(resumedRun?.state, 'waiting-result-confirm')
  assert.equal(resumedRun?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.equal(agentRuns, 1)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start'
  ])
})

test('a lost execution-start response replays one receipt and resumes with the original Cloud start provenance', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  const backend = new MemoryBackend(initial)
  const startAttempts: RestRequest[] = []
  let startResponse: RestResponse | undefined
  let startBusinessCommits = 0
  let loseFirstResponse = true
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type !== 'task.execution.start') {
          return cloud.outbox().enqueueAndWait('task.progress', request)
        }
        startAttempts.push(structuredClone(request))
        if (!startResponse) {
          startResponse = await cloud.outbox().enqueueAndWait('task.progress', request)
          startBusinessCommits += 1
        }
        if (loseFirstResponse) {
          loseFirstResponse = false
          throw new Error('response lost after canonical Cloud execution start')
        }
        return startResponse
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    { backend: backend, outboxFactory: outboxFactory }
  )

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()

  const failedStart = interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')
  assert.equal(failedStart?.state, 'failed')
  assert.equal(interrupted.store.snapshot().taskRuns[0]?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.ok(failedStart)
  await interrupted.outbox.retry(failedStart.idempotencyKey)
  await interrupted.outbox.waitForIdle()
  assert.equal(interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')?.state, 'delivered')
  assert.equal(startAttempts.length, 2)
  assert.deepEqual(startAttempts[1], startAttempts[0])
  assert.equal(startBusinessCommits, 1)
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-start-response-loss-thread',
        turnId: 'worker-start-response-loss-turn',
        state: 'completed',
        text: completedWorkerResultText('Completed after the execution-start response was recovered.')
      }
    }
  }, initial, { backend, outboxFactory })

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  const resumedRun = resumed.store.snapshot().taskRuns[0]
  assert.equal(resumedRun?.state, 'waiting-result-confirm')
  assert.equal(resumedRun?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startAttempts[0]?.type === 'task.execution.start' ? startAttempts[0].startedAt : null, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.equal(agentRuns, 1)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start'
  ])
})

test('Worker return stops and fences the active Runtime, reports failure once and rejects late output', async () => {
  const cloud = new FakeWorkerCloud()
  const started = deferred<void>()
  const release = deferred<void>()
  let signal: AbortSignal | undefined
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      signal = request.signal
      started.resolve()
      await release.promise
      return { runtimeId: 'codex', threadId: 'worker-thread-stable', turnId: 'late-return',
        state: 'completed', text: completedWorkerResultText('Too late to submit.') }
    }
  })
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await started.promise
  const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId, reason: '  模型服务不可用，无法完成  ' }
  const returnStarted = deferred<void>()
  const releaseReturn = deferred<void>()
  cloud.delayNextTaskRead(() => returnStarted.resolve(), releaseReturn.promise)
  const returning = adapter.returnTask(input, TEST_IDS.userId)
  await returnStarted.promise
  await assert.rejects(adapter.submitWorkerDelivery({ target: { ...deliveryIdentity(), contractRevision: 1, resultRevision: 1, bundleDigest: TEST_HASH, decision: 'approved' } }), /退回|只读|更新/u)
  const repeated = adapter.returnTask(input, TEST_IDS.userId)
  releaseReturn.resolve()
  await Promise.all([returning, repeated])
  assert.equal(signal?.aborted, true)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'fenced')
  assert.equal(store.snapshot().taskRuns[0]?.execution?.fence.status, 'fenced')
  const failures = cloud.requests.filter((request) => request.type === 'task.execution.fail')
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.safeFailureCode, 'worker_returned')
  assert.equal(failures[0]?.safeMessage, input.reason.trim())
  release.resolve()
  await adapter.waitForIdle()
  await adapter.recover()
  await adapter.waitForIdle()
  assert.equal(store.snapshot().taskRuns[0]?.state, 'fenced')
  assert.equal(store.snapshot().taskRuns[0]?.frozenCandidate, null)
  assert.equal(store.snapshot().taskRuns[0]?.agentJournal[0]?.state, 'late_outcome')
  assert.equal(cloud.commands.some((type) => type.startsWith('delivery.')), false)
  await adapter.returnTask(input, TEST_IDS.userId)
  assert.equal(cloud.commands.filter((type) => type === 'task.execution.fail').length, 1)
})

test('Worker return requires a reason, exact local assignee and current execution', async () => {
  const cloud = new FakeWorkerCloud('running')
  const initial = emptyState()
  initial.taskRuns = [durableTaskRun(cloud)]
  const { adapter } = await createRunner(cloud, neverAgent(), initial)
  const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId, reason: '无法启动运行环境' }
  await assert.rejects(adapter.returnTask({ ...input, reason: '  ' }, TEST_IDS.userId))
  await assert.rejects(adapter.returnTask({ ...input, reason: '字'.repeat(501) }, TEST_IDS.userId))
  await assert.rejects(adapter.returnTask(input, 'usr_other000001'), /被派成员/u)
  await assert.rejects(adapter.returnTask({ ...input, taskId: 'tsk_other000001' }, TEST_IDS.userId), /被派成员/u)
  cloud.task = taskSchema.parse({ ...cloud.task, currentExecutionId: 'exe_other000000001' })
  await assert.rejects(adapter.returnTask(input, TEST_IDS.userId), /已结束或执行归属已变化/u)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
})

test('Worker return works while waiting for Runtime or an answer and surfaces a Cloud error without reopening the run', async () => {
  for (const state of ['waiting-runtime', 'needs-human', 'failed'] as const) {
    const cloud = new FakeWorkerCloud('running')
    const initial = emptyState()
    initial.taskRuns = [durableTaskRun(cloud, { state, completedAt: state === 'failed' ? TEST_TIMESTAMP : null })]
    let fail = true
    const { adapter, store } = await createRunner(cloud, neverAgent(), initial, {
      outboxFactory: () => {
        const outbox = cloud.outbox()
        return { ...outbox, enqueueAndWait: async (...args: Parameters<DurableCloudOutbox['enqueueAndWait']>) => {
          if (args[0] === 'task.failed' && fail) throw new Error('退回上报失败')
          return outbox.enqueueAndWait(...args)
        } } as DurableCloudOutbox
      }
    })
    const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId, reason: '本机无法继续' }
    await assert.rejects(adapter.returnTask(input, TEST_IDS.userId), /退回上报失败/u)
    assert.ok(['failed', 'fenced'].includes(store.snapshot().taskRuns[0]!.state))
    fail = false
    await adapter.returnTask(input, TEST_IDS.userId)
    assert.equal(store.snapshot().taskRuns[0]?.execution?.state, 'failed')
    assert.equal(cloud.commands.filter((type) => type === 'task.execution.fail').length, 1)
  }
})

test('a terminal execution event aborts the active Runtime and journals its fenced late outcome', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const runtimeStarted = deferred<void>()
  const runtimeAborted = deferred<void>()
  const releaseRuntime = deferred<void>()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      runtimeStarted.resolve()
      const signal = request.signal
      const aborted = new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      await Promise.race([aborted, releaseRuntime.promise])
      if (signal?.aborted) {
        runtimeAborted.resolve()
        throw new Error('Runtime stopped after the execution fence.')
      }
      return {
        runtimeId: 'codex',
        threadId: 'worker-fenced-thread',
        turnId: 'worker-fenced-turn',
        state: 'completed',
        text: completedWorkerResultText('Too late.')
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await runtimeStarted.promise
  cloud.denyPreflight()
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_ExecutionFence1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'collaboration.state.changed',
      event: {
        protocolVersion: '1.0',
        eventId: 'evt_ExecutionFence1',
        causedByRequestId: TEST_IDS.requestId,
        occurredAt: TEST_LATER_TIMESTAMP,
        type: 'task.execution.changed',
        projectId: TEST_IDS.projectId,
        taskId: TEST_IDS.taskId,
        executionId: TEST_IDS.executionId,
        state: 'superseded',
        revision: cloud.execution.revision
      }
    }
  }))
  const abortedBeforeRelease = await Promise.race([
    runtimeAborted.promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25))
  ])
  releaseRuntime.resolve()
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(abortedBeforeRelease, true)
  assert.equal(run?.state, 'fenced')
  assert.equal(run?.agentJournal[0]?.state, 'late_outcome')
  assert.equal(run?.lateOutcomes[0]?.outcome, 'failed_after_fence')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('Project deletion closes active offers and fences the matching active Runtime exactly once', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const runtimeStarted = deferred<void>()
  const runtimeAborted = deferred<void>()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      runtimeStarted.resolve()
      if (!request.signal?.aborted) {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      }
      runtimeAborted.resolve()
      throw new Error('Runtime stopped because its Cloud Project was deleted.')
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await runtimeStarted.promise
  await created.store.transact((draft) => {
    draft.pendingTaskOffers.push({
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: 'ofr_DeletePending001',
      workerUserId: TEST_IDS.userId,
      currentTaskRevision: cloud.task.revision,
      offerRevision: 1,
      recipientAgentId: TEST_IDS.agentId,
      receivedAt: TEST_TIMESTAMP,
      preflightReasons: [],
      state: 'awaiting-manual',
      updatedAt: TEST_TIMESTAMP,
      completedAt: null,
      error: null
    }, {
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: 'ofr_DeleteDismissed01',
      workerUserId: TEST_IDS.userId,
      currentTaskRevision: cloud.task.revision,
      offerRevision: 1,
      recipientAgentId: TEST_IDS.agentId,
      receivedAt: TEST_TIMESTAMP,
      preflightReasons: [],
      state: 'dismissed',
      updatedAt: TEST_TIMESTAMP,
      completedAt: TEST_TIMESTAMP,
      error: null
    })
  })

  await created.adapter.handleProjectUnavailable(TEST_IDS.projectId, DELETED_PROJECT_FENCE)
  await runtimeAborted.promise
  await created.adapter.waitForIdle()

  const deleted = created.store.snapshot()
  assert.equal(deleted.tasks.length, 1, 'durable Task history remains available locally')
  assert.equal(deleted.taskRuns.length, 1, 'durable execution history remains available locally')
  assert.equal(deleted.taskRuns[0]?.state, 'fenced')
  assert.match(deleted.taskRuns[0]?.error ?? '', /Cloud deleted this Project/u)
  assert.equal(deleted.taskRuns[0]?.agentJournal[0]?.state, 'late_outcome')
  assert.equal(deleted.taskRuns[0]?.lateOutcomes[0]?.outcome, 'failed_after_fence')
  assert.deepEqual(deleted.pendingTaskOffers.map(({ state }) => state), ['closed', 'dismissed'])
  assert.deepEqual(deleted.projectUnavailableFences.map(({ kind }) => kind), ['permanent'])
  assert.match(deleted.pendingTaskOffers[0]?.error ?? '', /Cloud deleted this Project/u)
  assert.equal(cloud.commands.includes('task.result.submit'), false)

  const revisionAfterCleanup = deleted.revision
  await created.adapter.handleProjectUnavailable(TEST_IDS.projectId, DELETED_PROJECT_FENCE)
  assert.equal(created.store.snapshot().revision, revisionAfterCleanup)
})

test('Project deletion wins a manual offer decision race inside the store transaction', async () => {
  const cloud = new FakeWorkerCloud()
  let deleteOnNextClock = false
  let deletion: Promise<void> | undefined
  let deleteProject = async (): Promise<void> => undefined
  const created = await createRunner(
    cloud,
    neverAgent(),
    emptyState(),
    {
      backend: new MemoryBackend(emptyState()),
      now: () => {
        if (deleteOnNextClock) {
          deleteOnNextClock = false
          deletion = deleteProject()
        }
        return new Date(TEST_TIMESTAMP)
      }
    }
  )
  deleteProject = () => created.adapter.handleProjectUnavailable(
    TEST_IDS.projectId,
    DELETED_PROJECT_FENCE
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')

  deleteOnNextClock = true
  await assert.rejects(
    created.adapter.decideOffer(OFFER_ID, { decision: 'accept' }),
    /Only an offer awaiting a manual decision/u
  )
  await deletion

  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'closed')
  assert.deepEqual(created.store.snapshot().projectUnavailableFences.map(({ kind }) => kind), ['permanent'])
  assert.equal(cloud.commands.includes('task.offer.accept'), false)
})

test('Project deletion during presentation refresh cannot resurrect or claim the closed offer', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const taskReadStarted = deferred<void>()
  const releaseTaskRead = deferred<void>()
  cloud.delayNextTaskRead(() => taskReadStarted.resolve(), releaseTaskRead.promise)
  const created = await createRunner(cloud, neverAgent(), initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await taskReadStarted.promise
  await created.adapter.handleProjectUnavailable(TEST_IDS.projectId, DELETED_PROJECT_FENCE)
  await assert.rejects(created.adapter.decideOffer(OFFER_ID, { decision: 'accept' }), /manual decision/u)
  releaseTaskRead.resolve()
  await created.adapter.waitForIdle()

  const offer = created.store.snapshot().pendingTaskOffers[0]
  assert.equal(offer?.state, 'closed')
  assert.match(offer?.error ?? '', /Cloud deleted this Project/u)
  assert.equal(cloud.commands.includes('task.offer.accept'), false)
  assert.equal(created.store.snapshot().taskRuns.length, 0)
})

test('Project deletion while HumanNeeded is in flight cannot restore a fenced run', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const humanNeededStarted = deferred<void>()
  const releaseHumanNeeded = deferred<void>()
  const baseOutbox = cloud.outbox()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-delete-human-thread',
      turnId: 'worker-delete-human-turn',
      state: 'completed',
      text: needsHumanWorkerResultText('Should this deleted Project continue?')
    })
  }, initial, { backend: new MemoryBackend(initial), outboxFactory: () => ({
    enqueue: baseOutbox.enqueue.bind(baseOutbox),
    enqueueAndWait: async (
      kind: Parameters<DurableCloudOutbox['enqueueAndWait']>[0],
      request: RestRequest
    ) => {
      if (request.type === 'human.needed.create') {
        humanNeededStarted.resolve()
        await releaseHumanNeeded.promise
      }
      return baseOutbox.enqueueAndWait(kind, request)
    }
  } as unknown as DurableCloudOutbox) })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await humanNeededStarted.promise
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'needs-human')
  await created.adapter.handleProjectUnavailable(TEST_IDS.projectId, DELETED_PROJECT_FENCE)
  releaseHumanNeeded.resolve()
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'fenced')
  assert.equal(run?.humanRequestId, null)
  assert.match(run?.error ?? '', /Cloud deleted this Project/u)
})

test('Project deletion during the Delivery saga cannot seal a fenced run', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const candidateStarted = deferred<void>()
  const releaseCandidate = deferred<void>()
  const baseOutbox = cloud.outbox()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-delete-submit-thread',
      turnId: 'worker-delete-submit-turn',
      state: 'completed',
      text: completedWorkerResultText('This result raced with Project deletion.')
    })
  }, initial, { backend: new MemoryBackend(initial), outboxFactory: () => ({
    enqueue: baseOutbox.enqueue.bind(baseOutbox),
    enqueueAndWait: async (
      kind: Parameters<DurableCloudOutbox['enqueueAndWait']>[0],
      request: RestRequest
    ) => {
      if (request.type === 'delivery.candidate.create') {
        candidateStarted.resolve()
        await releaseCandidate.promise
      }
      return baseOutbox.enqueueAndWait(kind, request)
    },
    stageAndWait: baseOutbox.stageAndWait.bind(baseOutbox),
    resumeAndWait: baseOutbox.resumeAndWait.bind(baseOutbox)
  } as unknown as DurableCloudOutbox) })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()

  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
  const submission = created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  await candidateStarted.promise
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'submitting')
  await created.adapter.handleProjectUnavailable(TEST_IDS.projectId, DELETED_PROJECT_FENCE)
  releaseCandidate.resolve()
  await submission.catch(() => undefined)
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'fenced')
  assert.match(run?.error ?? '', /Cloud deleted this Project/u)
  assert.equal(run?.deliverySaga?.state === 'sealed', false)
  assert.equal(cloud.manifests.size, 0)
})

test('completed Worker authority loss cannot be reopened by a later Owner revision notification', async () => {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  let runtimeTurns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (input) => {
      runtimeTurns += 1
      return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: `turn-fenced-rework-${runtimeTurns}`,
        state: 'completed', text: completedWorkerResultText('Original confirmed result') }
    }
  })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  cloud.completeAfterSeal()
  await created.adapter.fenceLocalAgent(TEST_IDS.agentId, 'The Human signed out',
    new AgentCloudRuntimeError('identity_required', 'The Human signed out', 'identity_changed'))
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
  assert.ok(created.store.snapshot().taskRuns[0]?.authorityFencedAt)
  cloud.execution = taskExecutionSchema.parse({ ...cloud.execution, state: 'running', terminalAt: null, currentResultSubmissionId: null,
    revision: cloud.execution.revision + 1, stateRevision: cloud.execution.stateRevision + 1,
    fence: { ...cloud.execution.fence, status: 'open', reason: null, fencedAt: null } })
  cloud.task = taskSchema.parse({ ...cloud.task, status: 'revision_requested', currentExecutionState: 'running',
    revision: cloud.task.revision + 1, completedAt: null })
  cloud.revisionRequest = { revisionRequestId: 'revision_request_fenced', projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, executionRevision: cloud.execution.revision,
    deliveryManifestId: [...cloud.manifests.values()][0]!.deliveryManifestId,
    instruction: 'Add revised evidence', requestedByUserId: TEST_IDS.secondUserId, requestedAt: TEST_LATER_TIMESTAMP }
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({ ...agentInboxMessageFixture, payload: {
    protocolVersion: '1.0', type: 'task.delivery.revision_requested', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId, revisionRequestId: cloud.revisionRequest.revisionRequestId,
    executionRevision: cloud.execution.revision
  } }))
  created.adapter.wake()
  await created.adapter.waitForIdle()
  assert.equal(runtimeTurns, 1, 'a permanently fenced execution grant cannot authorize a new Runtime turn')
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
})

test('Owner revision preserves the sealed version while the same Session prepares draft r(N+1)', async () => {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  const revisionStarted = deferred<void>(), releaseRevision = deferred<void>()
  const prompts: string[] = []
  const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, run: async (input) => {
    prompts.push(input.prompt)
    if (prompts.length === 2) { revisionStarted.resolve(); await releaseRevision.promise }
    return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: `turn-revision-${prompts.length}`,
      state: 'completed', text: completedWorkerResultText(prompts.length === 1 ? 'Original result' : 'Revised evidence') }
  } })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const first = created.adapter.workerDeliveryView(TEST_IDS).candidate!
  const firstBytes = await readFile(created.store.snapshot().taskRuns[0]!.frozenCandidate!.bundleFile.path)
  cloud.completeAfterSeal()
  cloud.execution = taskExecutionSchema.parse({ ...cloud.execution, state: 'running', terminalAt: null, currentResultSubmissionId: null,
    revision: cloud.execution.revision + 1, stateRevision: cloud.execution.stateRevision + 1,
    fence: { ...cloud.execution.fence, status: 'open', reason: null, fencedAt: null } })
  cloud.task = taskSchema.parse({ ...cloud.task, status: 'revision_requested', currentExecutionState: 'running',
    revision: cloud.task.revision + 1, completedAt: null })
  cloud.revisionRequest = { revisionRequestId: 'revision_request_001', projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, executionRevision: cloud.execution.revision,
    deliveryManifestId: [...cloud.manifests.values()][0]!.deliveryManifestId,
    instruction: 'Add revised evidence', requestedByUserId: TEST_IDS.secondUserId, requestedAt: TEST_LATER_TIMESTAMP }
  const message = agentInboxMessageSchema.parse({ ...agentInboxMessageFixture, payload: {
    protocolVersion: '1.0', type: 'task.delivery.revision_requested', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId, revisionRequestId: cloud.revisionRequest.revisionRequestId,
    executionRevision: cloud.execution.revision } })
  await created.adapter.handleInbox(message)
  await revisionStarted.promise
  const draft = created.adapter.workerDeliveryView(TEST_IDS).draft!
  assert.equal(draft.resultRevision, 2)
  assert.equal(draft.basedOnResultRevision, 1)
  assert.equal(draft.summary, 'Original result')
  await assert.rejects(created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter)), /AI 正在修改/u)
  await created.adapter.handleInbox(message)
  releaseRevision.resolve()
  await created.adapter.waitForIdle()
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.summary, 'Revised evidence')
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).candidate!.bundle.summary, first.bundle.summary)
  assert.match(prompts[1]!, /Add revised evidence/u)
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const revised = created.adapter.workerDeliveryView(TEST_IDS)
  assert.equal(revised.candidate!.bundle.resultRevision, 2)
  assert.equal(revised.history.length, 2)
  assert.equal(revised.history[0]!.bundle.summary, 'Original result')
  assert.equal(revised.history[0]!.manifest.bundleDigest, first.target.bundleDigest)
  assert.deepEqual(await readFile(created.store.snapshot().taskRuns[0]!.deliveryHistory[0]!.candidate.bundleFile.path), firstBytes)
  assert.equal(prompts.length, 2)
})

test('ordinary Session completion updates the draft once and submission freezes the latest files', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  cloud.validDeliveryManifest = true
  let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
  const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, readAdmission: async () => admission,
    run: async (input) => { await mkdir(input.workspaceRoot!, { recursive: true }); await writeFile(join(input.workspaceRoot!, 'analysis.md'), 'Original file')
      return { runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'original-turn', state: 'completed', text: completedWorkerResultText('Original summary') } }
  })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId); await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' }); await created.adapter.waitForIdle()
  const initial = await deliverySubmitInput(created.adapter)
  const run = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
  const event: SessionOutputEvent = { ...ref, turnId: 'member-revised', revision: 1, state: 'completed' }
  admission = { ...admission, revision: 1, receipts: [{ clientDirectiveId: 'member-input', revision: 1, payloadDigest: TEST_HASH,
    mode: 'direct', delivery: 'delivered', execution: 'output_pending', turnId: event.turnId }] }
  await created.adapter.acceptSessionAdmission({ ...ref, kind: 'direct', revision: 1, clientDirectiveId: 'member-input' })
  await assert.rejects(created.adapter.submitWorkerDelivery(initial), /未完成|核验/u)
  await created.adapter.acceptSessionOutput(event, async () => ({ ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [] }))
  assert.match(created.store.snapshot().taskRuns[0]!.error!, /turn was not found/u)
  await writeFile(join(run.workspaceRoot, 'analysis.md'), 'Revised current bytes')
  const readThread: Parameters<CollaborationTaskAdapter['acceptSessionOutput']>[1] = async () => ({ ...ref, id: ref.threadId,
    watermark: '1', artifacts: [], turns: [{ id: event.turnId, artifacts: [], messages: [{ itemId: 'final', kind: 'assistant-final', text: completedWorkerResultText('Revised summary') }] }] })
  await created.adapter.acceptSessionOutput(event, readThread)
  const revised = created.adapter.workerDeliveryView(TEST_IDS).draft!
  assert.equal(revised.resultRevision, 1, 'AI turns do not consume result versions')
  assert.equal(revised.summary, 'Revised summary')
  await created.adapter.acceptSessionOutput(event, readThread)
  assert.deepEqual(created.adapter.workerDeliveryView(TEST_IDS).draft, revised)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).candidate, null)
  admission = { ...admission, receipts: admission.receipts.map((receipt) => ({ ...receipt, execution: 'completed' })) }
  await assert.rejects(created.adapter.submitWorkerDelivery(initial), /新改动/u)
  await created.adapter.acceptSessionAdmission({ ...ref, kind: 'direct', revision: 1, clientDirectiveId: 'member-input' })
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).state, 'waiting_confirmation')
  await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
  const frozen = created.adapter.workerDeliveryView(TEST_IDS).candidate!
  assert.equal(frozen.bundle.summary, 'Revised summary')
  assert.equal(frozen.bundle.outputs[0]!.sha256, createHash('sha256').update('Revised current bytes').digest('hex'))
})

for (const outcome of ['failed', 'cancelled', 'plain-text', 'needs-human'] as const) {
  test(`ordinary Session ${outcome} preserves the draft and a later new successful input can submit`, async () => {
    const cloud = new FakeWorkerCloud(); cloud.validDeliveryManifest = true
    let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
    const created = await createRunner(cloud, { runtimeReadiness: readyRuntimeReadiness, readAdmission: async () => admission,
      run: async (input) => ({ runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'original-turn', state: 'completed', text: completedWorkerResultText('Original summary') }) })
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId); await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' }); await created.adapter.waitForIdle()
    const run = created.store.snapshot().taskRuns[0]!, ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
    const state = outcome === 'plain-text' || outcome === 'needs-human' ? 'completed' : outcome
    const event: SessionOutputEvent = { ...ref, turnId: `member-${outcome}`, revision: 1, state }
    admission = { ...admission, revision: 1, receipts: [{ clientDirectiveId: 'first-member-input', revision: 1, payloadDigest: TEST_HASH,
      mode: 'direct', delivery: 'delivered', execution: 'output_pending', turnId: event.turnId }] }
    await created.adapter.acceptSessionOutput(event, async () => ({ ...ref, id: ref.threadId, watermark: '1', artifacts: [], turns: [{ id: event.turnId,
      artifacts: [], messages: [{ itemId: 'final', kind: 'assistant-final', text: outcome === 'needs-human' ? needsHumanWorkerResultText('Which organism should we use?') : 'Changes complete.' }] }] }))
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).draft!.summary, 'Original summary')
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).candidate, null)
    assert.equal(created.store.snapshot().taskRuns[0]!.humanRequestId, null)
    if (state === 'completed') assert.equal(created.store.snapshot().taskRuns[0]!.error, null)
    else assert.match(created.store.snapshot().taskRuns[0]!.error!, state === 'failed' ? /本轮执行失败/u : /已取消/u)
    admission = { ...admission, revision: 2, receipts: [{ ...admission.receipts[0]!, execution: state }, {
      clientDirectiveId: 'new-member-input', revision: 1, payloadDigest: TEST_HASH, mode: 'direct', delivery: 'delivered', execution: 'output_pending', turnId: 'new-turn' }] }
    await created.adapter.acceptSessionOutput({ ...ref, turnId: 'new-turn', revision: 2, state: 'completed' }, async () => ({ ...ref, id: ref.threadId,
      watermark: '2', artifacts: [], turns: [{ id: 'new-turn', artifacts: [], messages: [{ itemId: 'new-final', kind: 'assistant-final', text: completedWorkerResultText('Recovered summary') }] }] }))
    admission = { ...admission, receipts: admission.receipts.map((receipt) => receipt.turnId === 'new-turn' ? { ...receipt, execution: 'completed' } : receipt) }
    await created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter))
    assert.equal(created.adapter.workerDeliveryView(TEST_IDS).state, 'sealed')
    assert.equal(admission.receipts[0]!.delivery, 'delivered', 'known terminal failures need no abandonment or replay')
  })
}

for (const phase of ['candidate', 'review'] as const) {
  test(`Delivery saga keeps its checkpoint when a heartbeat races with ${phase}`, () => deliveryHeartbeatRace(phase))
}

async function deliveryHeartbeatRace(phase: 'candidate' | 'review') {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  const candidateStarted = deferred<void>()
  const releaseCandidate = deferred<void>()
  const baseOutbox = cloud.outbox()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex', threadId: 'worker-delivery-race', turnId: 'turn-delivery-race',
      state: 'completed', text: completedWorkerResultText('Ready for delivery.')
    })
  }, emptyState(), { outboxFactory: () => ({
    ...baseOutbox,
    enqueueAndWait: async (kind: Parameters<DurableCloudOutbox['enqueueAndWait']>[0], request: RestRequest) => {
      if (phase === 'candidate' && request.type === 'delivery.candidate.create') {
        candidateStarted.resolve()
        await releaseCandidate.promise
      }
      const response = await baseOutbox.enqueueAndWait(kind, request)
      if (phase === 'review' && request.type === 'delivery.candidate.review') {
        candidateStarted.resolve()
        await releaseCandidate.promise
      }
      return response
    }
  } as unknown as DurableCloudOutbox) })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  const input = await deliverySubmitInput(created.adapter)
  const submission = created.adapter.submitWorkerDelivery(input)
  const outcome = submission.then(() => null, (error: unknown) => error)
  await candidateStarted.promise
  const candidate = created.store.snapshot().taskRuns[0]!.frozenCandidate!
  const operationId = created.store.snapshot().taskRuns[0]!.deliverySaga!.operationId
  await assert.rejects(created.adapter.submitWorkerDelivery(input), /already in progress/u)
  if (phase === 'review') assert.equal(cloud.candidates.get(candidate.candidateId)?.status, 'submitted')
  created.adapter.wake()
  await created.adapter.waitForIdle()
  releaseCandidate.resolve()
  assert.equal(await outcome, null)
  const run = created.store.snapshot().taskRuns[0]!
  assert.equal(run.frozenCandidate?.candidateId, candidate.candidateId)
  assert.equal(run.deliverySaga?.operationId, operationId)
  assert.equal(run.deliverySaga?.state, 'sealed')
  assert.equal(cloud.manifests.size, 1)
  await created.adapter.submitWorkerDelivery(input)
  assert.equal(cloud.manifests.size, 1, 'retrying an already sealed operation is a read of the completed result')
}

test('a local checkpoint failure after Cloud seal leaves a complete saga that reopens cleanly', async () => {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  const backend = new FailOnceSealedRunBackend(emptyState())
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-delivery-checkpoint-thread',
      turnId: 'worker-delivery-checkpoint-turn',
      state: 'completed',
      text: completedWorkerResultText('The exact README is ready.')
    })
  }, emptyState(), { backend })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  await assert.rejects(created.adapter.submitWorkerDelivery(await deliverySubmitInput(created.adapter)), /simulated crash/u)
  assert.equal(cloud.manifests.size, 1, 'Cloud seal committed before the local checkpoint failed')
  const persisted = (await backend.read()) as CollaborationLocalState
  const persistedSaga = persisted.taskRuns[0]?.deliverySaga
  assert.equal(persistedSaga?.state, 'seal')
  assert.ok(persistedSaga?.operationId)
  assert.ok(persistedSaga?.candidateId)
  assert.ok(persistedSaga?.proof)
  assert.equal(persistedSaga?.manifest, null)

  // A restart must parse the durable checkpoint instead of failing strict
  // local-state validation. The normal wake path can reconcile the completed
  // Cloud execution when its terminal facts are available.
  cloud.completeAfterSeal()
  const reopened = await createRunner(cloud, neverAgent(), emptyState(), { backend })
  await reopened.adapter.recover()
  await reopened.adapter.waitForIdle()
  assert.equal(reopened.store.snapshot().taskRuns[0]?.state, 'completed', reopened.store.snapshot().taskRuns[0]?.error ?? '')
  assert.equal(reopened.store.snapshot().taskRuns[0]?.deliverySaga?.state, 'sealed')
})

test('restart resumes the same dispatched Agent directive instead of creating another execution', async () => {
  const cloud = new FakeWorkerCloud('running')
  cloud.execution = taskExecutionSchema.parse({
    ...cloud.execution,
    startedAt: TEST_TIMESTAMP
  })
  const stableDirective = 'collab-worker-stable-restart'
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [{
    offer: offerJournal(),
    task: cloud.task,
    execution: cloud.execution,
    latestPreflight: {
      cloud: cloud.preflight(),
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision,
    state: 'running',
    workspaceRoot: '/tmp/sciforge-worker-restart',
    runtimeId: 'codex',
    threadId: 'worker-thread-stable',
    humanRequestId: null,
    humanAnswer: null,
    resources: [],
    frozenCandidate: null,
    deliveryDraft: null,
    deliveryHistory: [],
    deliverySaga: null,
    agentJournal: [{
      logicalInvocationId: `agent.${TEST_IDS.executionId}.1`,
      clientDirectiveId: stableDirective,
      state: 'dispatched',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      observedAt: null,
      runtimeId: 'codex',
      threadId: 'worker-thread-stable',
      turnId: null,
      runtimeState: null,
      safeResultText: null,
      safeError: null
    }],
    externalJournal: [],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    lateOutcomes: [],
    startedAt: cloud.execution.startedAt,
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  const directives: string[] = []
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      return {
        runtimeId: 'codex',
        threadId: 'worker-thread-stable',
        turnId: 'worker-turn-recovered',
        state: 'completed',
        text: completedWorkerResultText('Recovered.')
      }
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()
  assert.deepEqual(directives, [stableDirective])
  assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'waiting-result-confirm')
})

test('Desktop restart reconciles one persisted Session/directive without a second Runtime turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  const firstRunStarted = deferred<void>()
  const directives: string[] = []
  const sessions: string[] = []
  let hostRunAttempts = 0
  let providerTurns = 0
  const delivered = new Map<string, Readonly<{
    runtimeId: string
    threadId: string
    turnId: string
    state: 'completed'
    text: string
  }>>()
  const result = {
    runtimeId: 'codex',
    threadId: 'worker-shutdown-recovery-thread',
    turnId: 'worker-shutdown-recovery-turn',
    state: 'completed' as const,
    text: completedWorkerResultText('Reconciled.')
  }
  const first = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    prepareSession: async () => ({
      runtimeId: result.runtimeId,
      threadId: result.threadId
    }),
    run: async (request) => {
      hostRunAttempts += 1
      directives.push(request.clientDirectiveId ?? '')
      sessions.push(`${request.runtimeId}:${request.threadId}`)
      const key = `${request.runtimeId}:${request.threadId}:${request.clientDirectiveId}`
      const reconciled = delivered.get(key)
      if (reconciled) return reconciled
      providerTurns += 1
      delivered.set(key, result)
      firstRunStarted.resolve()
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('Desktop stopped while the Agent Host request was in flight.')
    }
  }, initial)

  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await first.adapter.waitForIdle()
  await first.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await firstRunStarted.promise
  first.adapter.stop()
  await first.adapter.waitForIdle()

  const stoppedState = first.store.snapshot()
  assert.equal(stoppedState.taskRuns[0]?.agentJournal[0]?.state, 'dispatched')
  assert.deepEqual({
    runtimeId: stoppedState.taskRuns[0]?.runtimeId,
    threadId: stoppedState.taskRuns[0]?.threadId,
    journalRuntimeId: stoppedState.taskRuns[0]?.agentJournal[0]?.runtimeId,
    journalThreadId: stoppedState.taskRuns[0]?.agentJournal[0]?.threadId
  }, {
    runtimeId: result.runtimeId,
    threadId: result.threadId,
    journalRuntimeId: result.runtimeId,
    journalThreadId: result.threadId
  })
  const second = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      hostRunAttempts += 1
      directives.push(request.clientDirectiveId ?? '')
      sessions.push(`${request.runtimeId}:${request.threadId}`)
      const key = `${request.runtimeId}:${request.threadId}:${request.clientDirectiveId}`
      const reconciled = delivered.get(key)
      if (!reconciled) throw new Error('Restart attempted a second Runtime turn.')
      return reconciled
    }
  }, stoppedState)

  await second.adapter.recover()
  await second.adapter.waitForIdle()

  assert.equal(hostRunAttempts, 2)
  assert.equal(providerTurns, 1)
  assert.equal(directives[0], directives[1])
  assert.deepEqual(sessions, [
    `${result.runtimeId}:${result.threadId}`,
    `${result.runtimeId}:${result.threadId}`
  ])
  assert.equal(second.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start'
  ])
})

async function createRunner(
  cloud: FakeWorkerCloud,
  agentExecution: DomainMainAgentExecutionHost = neverAgent(),
  initial: CollaborationLocalState = emptyState(),
  options: Readonly<{
    humanActions?: DomainMainHumanActionsHost
    signing?: DeviceFactAttestationSigningService
    authenticatedCloudTransport?: AuthenticatedCloudTransport
    backend?: CollaborationStateBackend
    outboxFactory?: (store: CollaborationLocalStore) => DurableCloudOutbox
    now?: () => Date
    sanitizeText?: (value: string) => string
  }> = {}
) {
  const store = new CollaborationLocalStore(options.backend ?? new MemoryBackend(initial))
  await store.open()
  cloud.store = store
  const outbox = options.outboxFactory?.(store) ?? cloud.outbox()
  const adapter = new CollaborationTaskAdapter({
    store,
    connection: cloud.connection(),
    outbox,
    agentExecution: {
      ...agentExecution,
      prepareSession: agentExecution.prepareSession ?? (async (request) => ({
        runtimeId: request.runtimeId ?? 'codex',
        threadId: 'worker-thread-stable'
      })),
      readAdmission: agentExecution.readAdmission ?? (async () => ({
        revision: 0,
        receipts: [],
        submission: null,
        recovery: 'ready' as const
      })),
      acquireSubmission: agentExecution.acquireSubmission ?? (async (input) => ({
        revision: input.expectedRevision,
        receipts: [],
        submission: {
          operationId: input.operationId,
          targetDigest: input.targetDigest,
          acquiredAt: TEST_TIMESTAMP
        },
        recovery: 'ready' as const
      })),
      releaseSubmission: agentExecution.releaseSubmission ?? (async () => undefined)
    },
    humanActions: options.humanActions ?? fakeHumanActions(),
    signing: options.signing ?? fakeSigning(),
    ...(options.authenticatedCloudTransport || cloud.fileMode
      ? { authenticatedCloudTransport: options.authenticatedCloudTransport ?? cloud.objectTransport() }
      : {}),
    localAgentId: () => TEST_IDS.agentId,
    workspaceRootForExecution: workerWorkspaceRoot,
    workspaceDisplayNameForProject: (projectId) => store.snapshot().projects.find(
      (project) => project.projectId === projectId
    )?.displayName ?? (projectId === TEST_IDS.projectId ? cloud.projectDisplayName : undefined),
    now: options.now ?? (() => new Date(TEST_TIMESTAMP)),
    ...(options.sanitizeText ? { sanitizeText: options.sanitizeText } : {})
  })
  return { adapter, store, outbox }
}

function fakeHumanActions(): DomainMainHumanActionsHost {
  let actions = 0
  return {
    capture: ({ target }) => ({
      actionId: `act_WorkerReview${String(++actions).padStart(4, '0')}`,
      interaction: 'explicit_click',
      occurredAt: TEST_TIMESTAMP,
      confirmedInputDigest: workerDeliveryConfirmationDigest(
        target as Parameters<typeof workerDeliveryConfirmationDigest>[0]
      ),
      sourceMessageDigest: null
    }),
    validate: ({ action }) => ({
      principal: {
        authority: 'sciforge.oidc',
        subject: TEST_IDS.userId,
        assurance: 'cloud-authenticated',
        deviceId: TEST_IDS.deviceId,
        identityVersion: 1
      },
      assertCurrent: () => undefined,
      ...(action ? {} : {})
    }) as ReturnType<DomainMainHumanActionsHost['validate']>
  }
}

function fakeSigning(): DeviceFactAttestationSigningService {
  return {
    signDeviceFact: async (request) => ({
      purpose: request.purpose,
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      deviceKeyId: 'key_Device000001',
      deviceKeyRevision: 1,
      signatureAlgorithm: 'Ed25519' as const,
      canonicalPayloadDigest: request.factDigest,
      factRevision: request.factRevision,
      observedAt: request.observedAt,
      issuedAt: TEST_LATER_TIMESTAMP,
      signature: Buffer.alloc(64, 9).toString('base64url')
    })
  }
}

function durableTaskRun(
  cloud: FakeWorkerCloud,
  overrides: Partial<CollaborationLocalState['taskRuns'][number]> = {}
): CollaborationLocalState['taskRuns'][number] {
  return {
    offer: offerJournal(),
    task: cloud.task,
    execution: cloud.execution,
    latestPreflight: {
      cloud: cloud.preflight(),
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision,
    state: 'running',
    workspaceRoot: workerWorkspaceRoot(TEST_IDS.executionId),
    runtimeId: null,
    threadId: null,
    humanRequestId: null,
    humanAnswer: null,
    resources: [],
    agentJournal: [],
    externalJournal: [],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    frozenCandidate: null,
    deliveryDraft: null,
    deliveryHistory: [],
    deliverySaga: null,
    lateOutcomes: [],
    startedAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null,
    ...overrides
  }
}

type FakeWorkerExecutionState = 'accepted' | 'running' | 'needs_human' | 'failed'
type FakeWorkerTaskState = 'offered' | FakeWorkerExecutionState

class FakeWorkerCloud {
  projectDisplayName = 'Project One'
  task: Task
  execution: TaskExecution
  offer: ReturnType<typeof taskOfferSchema.parse>
  commands: string[] = []
  requests: RestRequest[] = []
  readonly candidates = new Map<string, DeliveryCandidate>()
  readonly reviews = new Map<string, unknown>()
  readonly manifests = new Map<string, ReturnType<typeof deliveryManifestSchema.parse>>()
  readonly stagedBytes = new Map<string, Buffer>()
  readonly stagedObjects = new Map<string, {
    objectId: string
    objectKey: string
    revision: number
    sha256: string
    byteCount: number
    mediaType: string
    projectId: string
    visibility: 'staged'
    ownerUserId: string
    retentionUntil: null
  }>()
  historicalInput = false
  dashboardAvailable = true
  dashboardRefreshHook: (() => Promise<void>) | null = null
  adoptedInput = false
  objectReadRequests: unknown[] = []
  validDeliveryManifest = false
  revisionRequest: DeliveryRevisionRecord | null = null
  preflightExpectedRevisions: Array<Readonly<{ task: number; execution: number }>> = []
  store: CollaborationLocalStore | null = null
  recoveryReadError: Error | null = null
  recoveryMembershipActive = true
  recoveryReadStarted: (() => void) | undefined
  recoveryReadRelease: Promise<void> | undefined
  private preflightDenial: 'none' | 'execution_fenced' | 'membership_removal' = 'none'
  private preflightDelay: Readonly<{
    state: FakeWorkerExecutionState
    started: () => void
    release: Promise<void>
  }> | null = null
  private taskReadGate: Readonly<{
    started: () => void
    release: Promise<void>
  }> | null = null
  private claimGate: Readonly<{
    started: () => void
    release: Promise<void>
  }> | null = null

  constructor(
    state: 'offered' | 'accepted' | 'running' = 'offered',
    readonly fileMode = false
  ) {
    this.task = makeTask(state, state === 'offered' ? 1 : 3, fileMode)
    this.execution = makeExecution(
      state === 'offered' ? 'accepted' : state,
      this.task.revision,
      fileMode,
      state === 'offered' ? 2 : 1
    )
    this.offer = taskOfferSchema.parse({
      schemaVersion: 1,
      type: 'task_offer',
      taskOfferId: OFFER_ID,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: state === 'offered' ? null : TEST_IDS.executionId,
      workerUserId: TEST_IDS.userId,
      offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
      contractRevision: 1,
      contractDigest: TEST_HASH,
      state: state === 'offered' ? 'pending' : 'accepted',
      reassignmentTaskRevision: null,
      offeredAt: TEST_TIMESTAMP,
      expiresAt: TEST_LATER_TIMESTAMP,
      respondedAt: state === 'offered' ? null : TEST_TIMESTAMP,
      revision: state === 'offered' ? 1 : 2,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
  }

  preflight(
    requestedTaskRevision = this.task.revision,
    requestedExecutionRevision = this.execution.revision
  ) {
    const membershipRemoved = this.preflightDenial === 'membership_removal'
    const decisionReasons = [
      ...(membershipRemoved
        ? [
            'membership_not_active' as const,
            'user_authority_not_eligible' as const,
            'execution_fenced' as const
          ]
        : this.preflightDenial === 'execution_fenced' || this.execution.fence.status === 'fenced'
          ? ['execution_fenced' as const]
        : []),
      ...(this.task.currentExecutionId === this.execution.executionId
        ? []
        : ['execution_not_current' as const]),
      ...(requestedTaskRevision === this.task.revision ? [] : ['task_revision_mismatch' as const]),
      ...(requestedExecutionRevision === this.execution.revision
        ? []
        : ['execution_revision_mismatch' as const])
    ]
    return taskExecutionPreflightSchema.parse({
      schemaVersion: 1,
      type: 'task_execution_preflight',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      currentExecutionId: TEST_IDS.executionId,
      taskKind: this.fileMode ? 'file' : 'text',
      projectStatus: 'active',
      projectRevision: 1,
      projectExecutionAuthorityEpoch: 1,
      requestedTaskRevision,
      currentTaskRevision: this.task.revision,
      requestedExecutionRevision,
      membership: {
        schemaVersion: 1,
        type: 'project_membership',
        projectMembershipId: 'pmb_Member000001',
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        state: membershipRemoved ? 'membership_removal_pending' : 'active',
        authorityEpoch: membershipRemoved ? 2 : 1,
        activatedAt: TEST_TIMESTAMP,
        removalRequestedAt: membershipRemoved ? TEST_LATER_TIMESTAMP : null,
        removalRequestedByUserId: membershipRemoved ? TEST_IDS.secondUserId : null,
        removedAt: null,
        revision: membershipRemoved ? 2 : 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      },
      taskAuthorities: [{
        schemaVersion: 1,
        type: 'task_authority',
        taskAuthorityId: 'tau_Authority001',
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        scope: this.fileMode ? 'file_tasks' : 'text_tasks',
        state: membershipRemoved ? 'fenced' : 'eligible',
        authorityEpoch: membershipRemoved ? 2 : 1,
        reason: membershipRemoved ? 'membership_removal_pending' : null,
        effectiveAt: TEST_TIMESTAMP,
        revision: 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      }],
      device: {
        deviceId: TEST_IDS.deviceId,
        userId: TEST_IDS.userId,
        revision: 1,
        status: 'active'
      },
      agent: {
        agentId: TEST_IDS.agentId,
        ownerUserId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        revision: 1,
        lifecycleStatus: 'active',
        connectionStatus: 'online'
      },
      execution: this.execution,
      decision: decisionReasons.length > 0
        ? { outcome: 'denied', reasons: decisionReasons }
        : { outcome: 'allowed', reasons: [] },
      evaluatedAt: TEST_TIMESTAMP
    })
  }

  delayNextTaskRead(started: () => void, release: Promise<void>): void {
    this.taskReadGate = { started, release }
  }

  delayNextClaim(started: () => void, release: Promise<void>): void {
    this.claimGate = { started, release }
  }

  connection(): CollaborationConnection {
    return {
      refreshDashboards: async () => { await this.dashboardRefreshHook?.() },
      cloudDashboards: () => this.dashboardAvailable ? [{ projectId: TEST_IDS.projectId, stale: false, offline: false, revoked: false, tasks: [{
        taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, contract: { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
          contractRevision: this.execution.contractRevision, contractDigest: this.execution.contractDigest,
          inputReferences: this.fileMode ? [this.historicalInput
            ? { kind: 'project_result', referenceId: 'res_LegacyInput001', revision: INPUT_OBJECT.revision, digest: INPUT_OBJECT.sha256 }
            : this.adoptedInput ? { kind: 'adopted_delivery', referenceId: 'mft_AdoptedInput001', objectId: INPUT_OBJECT.objectId, revision: INPUT_OBJECT.revision, digest: INPUT_OBJECT.sha256 }
              : { kind: 'material_revision', referenceId: INPUT_MATERIAL_REVISION_ID, revision: INPUT_OBJECT.revision, digest: INPUT_OBJECT.sha256 }] : []
        } }] }] : [],
      executeAsUser: async (request: RestRequest) => {
        this.recoveryReadStarted?.()
        await this.recoveryReadRelease
        if (this.recoveryReadError) throw this.recoveryReadError
        assert.equal(request.type, 'project.coordination.read')
        if (request.type !== 'project.coordination.read') throw new Error('Invalid recovery query.')
        return restResponseSchema.parse({
          protocolVersion: '1.0', type: 'rest.project_coordination', requestId: request.requestId,
          project: projectFixture, observedAt: TEST_TIMESTAMP, finalSummary: null,
          pages: request.collections.map(({ collection, limit }) => ({ collection, limit,
            items: collection === 'tasks' ? [this.task] : collection === 'offers' ? [this.offer]
              : collection === 'executions' ? this.task.currentExecutionId ? [this.execution] : []
              : collection === 'memberships' ? [{
                  schemaVersion: 1, type: 'project_membership', projectMembershipId: 'pmb_Member000001',
                  projectId: TEST_IDS.projectId, userId: TEST_IDS.userId,
                  state: this.recoveryMembershipActive ? 'active' : 'removed', authorityEpoch: 1,
                  activatedAt: TEST_TIMESTAMP, removalRequestedAt: this.recoveryMembershipActive ? null : TEST_TIMESTAMP,
                  removalRequestedByUserId: this.recoveryMembershipActive ? null : TEST_IDS.secondUserId,
                  removedAt: this.recoveryMembershipActive ? null : TEST_TIMESTAMP,
                  revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
                }] : collection === 'task_authorities' ? ['text_tasks', 'file_tasks'].map((scope, index) => ({
                  schemaVersion: 1, type: 'task_authority', taskAuthorityId: `tau_Authority00${index + 1}`,
                  projectId: TEST_IDS.projectId, userId: TEST_IDS.userId, scope,
                  state: 'eligible', authorityEpoch: 1, reason: null, effectiveAt: TEST_TIMESTAMP,
                  revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
                })) : []
          }))
        })
      },
      executeAsAgent: async (request: RestRequest) => {
        if (request.type === 'task.execution.preflight.get') {
          const delay = this.preflightDelay
          if (delay?.state === this.execution.state) {
            this.preflightDelay = null
            delay.started()
            await delay.release
          }
          this.preflightExpectedRevisions.push({
            task: request.expectedTaskRevision,
            execution: request.expectedExecutionRevision
          })
          return {
            protocolVersion: '1.0',
            type: 'rest.task_execution_preflight',
            requestId: request.requestId,
            preflight: this.preflight(
              request.expectedTaskRevision,
              request.expectedExecutionRevision
            )
          }
        }
        if (request.type === 'resource.get' && this.fileMode) {
          const resource = fileResources(this.execution.fence.assignmentTaskRevision).find(({ resourceRefId }) => (
            resourceRefId === request.resourceRefId
          ))
          if (!resource) throw new Error('Unknown ResourceRef.')
          const locator = this.historicalInput ? { ...resource.locator, source: { kind: 'project_result', projectResultId: 'res_LegacyInput001', deliveryManifestId: 'mft_AdoptedInput001' } }
            : this.adoptedInput ? { ...resource.locator, source: { kind: 'adopted_delivery', deliveryManifestId: 'mft_AdoptedInput001' } } : resource.locator
          return entityResponse(request, { ...resource, locator, locatorDigest: digestFixture(locator) })
        }
        if (request.type === 'delivery.task.get') {
          return {
            protocolVersion: '1.0',
            type: 'rest.task.delivery',
            requestId: request.requestId,
            facts: this.deliveryFacts(request.taskId)
          }
        }
        assert.equal(request.type, 'task.get')
        const gate = this.taskReadGate
        if (gate) {
          this.taskReadGate = null
          gate.started()
          await gate.release
        }
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: this.task
        }
      }
    } as unknown as CollaborationConnection
  }

  outbox(): DurableCloudOutbox {
    return {
      enqueue: async (_kind: string, request: RestRequest) => {
        this.requests.push(request)
        this.commands.push(request.type)
      },
      enqueueAndWait: async (_kind: string, request: RestRequest): Promise<RestResponse> => {
        this.requests.push(request)
        this.commands.push(request.type)
        if (request.type === 'task.offer.reject') {
          assert.equal(request.taskOfferId, this.offer.taskOfferId)
          assert.equal(request.expectedTaskRevision, this.task.revision)
          assert.equal(request.expectedOfferRevision, this.offer.revision)
          this.task = taskSchema.parse({
            ...this.task,
            status: 'revision_requested',
            currentExecutionId: null,
            currentExecutionState: null,
            completedAt: null,
            revision: this.task.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.offer = taskOfferSchema.parse({
            ...this.offer,
            state: 'rejected',
            reassignmentTaskRevision: this.task.revision,
            respondedAt: TEST_LATER_TIMESTAMP,
            revision: this.offer.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          return collectionResponse(request, [this.task, this.offer])
        }
        if (request.type === 'task.offer.accept') {
          const claimGate = this.claimGate
          if (claimGate) {
            this.claimGate = null
            claimGate.started()
            await claimGate.release
          }
          if (request.expectedOfferRevision !== this.offer.revision ||
              request.expectedTaskRevision !== this.task.revision) {
            return {
              protocolVersion: '1.0',
              type: 'rest.error',
              requestId: request.requestId,
              error: createCollaborationError(
                'revision_conflict',
                'The Task offer revision changed while this Device was claiming it.'
              )
            }
          }
          assert.equal(request.taskOfferId, this.offer.taskOfferId)
          assert.equal(request.expectedTaskRevision, this.task.revision)
          assert.equal(request.expectedOfferRevision, this.offer.revision)
          this.task = { ...makeTask('accepted', this.task.revision + 1, this.fileMode),
            ...(this.task.contractRevision !== undefined ? {
              contractRevision: this.task.contractRevision, contractDigest: this.task.contractDigest
            } : {}) }
          this.execution = taskExecutionSchema.parse({
            ...makeExecution('accepted', this.task.revision, this.fileMode, this.task.revision),
            ...(this.task.contractRevision !== undefined ? {
              contractRevision: this.task.contractRevision, contractDigest: this.task.contractDigest
            } : {}),
            stateRevision: 1,
            revision: 1,
            createdAt: TEST_LATER_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.offer = taskOfferSchema.parse({
            ...this.offer,
            executionId: this.execution.executionId,
            state: 'accepted',
            respondedAt: TEST_LATER_TIMESTAMP,
            revision: this.offer.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          return collectionResponse(request, [this.task, this.execution, this.offer])
        }
        if (request.type === 'task.execution.start') {
          this.advance('running', request.startedAt)
          return collectionResponse(request, [this.task, this.execution])
        }
        if (request.type === 'task.execution.fail') {
          this.advance('failed')
          return collectionResponse(request, [this.task, this.execution])
        }
        if (request.type === 'human.needed.create') {
          assert.deepEqual(request.context, {
            scope: 'worker_execution',
            taskId: TEST_IDS.taskId,
            executionId: TEST_IDS.executionId,
            expectedTaskRevision: this.task.revision,
            expectedExecutionRevision: this.execution.revision
          })
          this.advance('needs_human')
          return entityResponse(request, {
            ...humanNeededFixture,
            requiredAssurance: request.requiredAssurance,
            prompt: request.prompt,
            expiresAt: request.expiresAt
          })
        }
        if (request.type === 'delivery.candidate.create') {
          assert.equal(request.candidateId.length > 0, true)
          const candidate = deliveryCandidateSchema.parse({
            candidateId: request.candidateId,
            projectId: request.projectId,
            taskId: request.taskId,
            executionId: request.executionId,
            workerUserId: request.workerUserId,
            contractRevision: request.contractRevision,
            resultRevision: request.resultRevision,
            bundleDigest: request.bundleDigest,
            bundleObjectId: request.bundleObjectId,
            outputObjectIds: request.outputObjectIds,
            outputs: (JSON.parse(this.stagedBytes.get(request.bundleObjectId)!.toString('utf8')) as { outputs: object[] }).outputs.map((output, index) => ({ ...output, objectId: request.outputObjectIds[index] })),
            status: 'private',
            createdAt: TEST_LATER_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.candidates.set(candidate.candidateId, candidate)
          return entityResponse(request, { type: 'delivery_candidate', ...candidate })
        }
        if (request.type === 'delivery.candidate.review') {
          const candidate = this.candidates.get(request.candidateId)
          if (!candidate || candidate.resultRevision !== request.resultRevision ||
              candidate.bundleDigest !== request.bundleDigest) {
            return {
              protocolVersion: '1.0',
              type: 'rest.error',
              requestId: request.requestId,
              error: createCollaborationError('revision_conflict', 'The Delivery candidate changed.')
            }
          }
          const reviewed = deliveryCandidateSchema.parse({
            ...candidate,
            status: request.decision === 'approved' ? 'submitted' : 'returned',
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.candidates.set(reviewed.candidateId, reviewed)
          this.reviews.set(reviewed.candidateId, request.humanAction)
          return entityResponse(request, { type: 'delivery_candidate', ...reviewed })
        }
        if (request.type === 'delivery.manifest.seal') {
          const candidate = this.candidates.get(request.candidateId)
          if (!candidate || candidate.status !== 'submitted') {
            return {
              protocolVersion: '1.0',
              type: 'rest.error',
              requestId: request.requestId,
              error: createCollaborationError('invalid_state_transition', 'Only an approved candidate can be sealed.')
            }
          }
          const stagedObject = this.stagedObjects.get(candidate.bundleObjectId) ?? (() => {
            throw new Error('The bundle object was not staged.')
          })()
          const manifestPayload = {
            schemaVersion: 1,
            revision: 1,
            createdAt: TEST_LATER_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP,
            type: 'delivery_manifest',
            deliveryManifestId: 'mft_Manifest0001',
            projectId: candidate.projectId,
            taskId: candidate.taskId,
            executionId: candidate.executionId,
            contract: request.contract,
            resultRevision: candidate.resultRevision,
            workerAttestationId: 'wat_Attestation01',
            bundleDigest: candidate.bundleDigest,
            bundleObjectId: candidate.bundleObjectId,
            outputObjectIds: candidate.outputObjectIds,
            outputs: candidate.outputs,
            objects: [stagedObject, ...candidate.outputObjectIds.map((id) => this.stagedObjects.get(id)!)].map((object) =>
              this.validDeliveryManifest ? { ...object, visibility: 'project_public' as const } : object),
            workerDecision: 'approved',
            verificationEvidence: request.verificationEvidence,
            operationId: request.operationId,
            sealedAt: TEST_LATER_TIMESTAMP
          }
          const manifest = deliveryManifestSchema.parse({
            ...manifestPayload,
            manifestDigest: this.validDeliveryManifest
              ? deliveryManifestDigest(manifestPayload)
              : 'e'.repeat(64)
          })
          this.manifests.set(manifest.deliveryManifestId, manifest)
          this.candidates.set(candidate.candidateId, deliveryCandidateSchema.parse({
            ...candidate,
            status: 'sealed',
            updatedAt: TEST_LATER_TIMESTAMP
          }))
          return entityResponse(request, manifest)
        }
        throw new Error(`Unexpected command ${request.type}.`)
      },
      stageAndWait: async (request: {
        objectId?: string
        projectId: string
        sha256: string
        byteCount: number
        mediaType: string
        requestId: string
      }, _path: string) => {
        const object = {
          objectId: `obj_StagedObject${String(this.stagedObjects.size + 1).padStart(4, '0')}`,
          objectKey: `cloud/staged-${request.sha256.slice(0, 12)}`,
          revision: 1,
          sha256: request.sha256,
          byteCount: request.byteCount,
          mediaType: request.mediaType,
          projectId: request.projectId,
          visibility: 'staged' as const,
          ownerUserId: TEST_IDS.userId,
          retentionUntil: null
        }
        this.stagedObjects.set(object.objectId, object)
        this.stagedBytes.set(object.objectId, await readFile(_path))
        this.commands.push('object.stage')
        return {
          protocolVersion: '1.0',
          type: 'rest.object.staged',
          requestId: request.requestId,
          object
        }
      },
      resumeAndWait: async (
        kind: string,
        idempotencyKey: string,
        validateRequest: (request: RestRequest) => void
      ) => {
        const entry = this.store?.snapshot().outbox.find((candidate) => (
          candidate.idempotencyKey === idempotencyKey
        ))
        if (!entry) return null
        assert.equal(entry.kind, kind)
        assert.equal(entry.state, 'delivered')
        assert.ok(entry.response)
        const request = restRequestSchema.parse(entry.body)
        validateRequest(request)
        return {
          request,
          response: restResponseSchema.parse(entry.response)
        }
      }
    } as unknown as DurableCloudOutbox
  }

  denyPreflight(reason: 'execution_fenced' | 'membership_removal' = 'execution_fenced'): void {
    this.preflightDenial = reason
  }

  delayNextPreflight(state: FakeWorkerExecutionState, started: () => void, release: Promise<void>): void {
    assert.equal(this.preflightDelay, null)
    this.preflightDelay = { state, started, release }
  }

  objectTransport(): AuthenticatedCloudTransport {
    return {
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.invalid',
        userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async () => {
        throw new Error('Unexpected authenticated User command outside the durable outbox.')
      },
      stageObject: async () => {
        throw new Error('Object bytes stage only through the durable outbox.')
      },
      readObject: async (input: { request: unknown; expected: { objectId: string } }) => {
        this.objectReadRequests.push(structuredClone(input.request))
        if (input.expected.objectId !== INPUT_OBJECT.objectId) throw new Error('Unknown Cloud object.')
        return { body: new Uint8Array(INPUT_BYTES), object: INPUT_OBJECT, versionId: 'v1' }
      }
    } as unknown as AuthenticatedCloudTransport
  }

  deliveryFacts(taskId: string) {
    assert.equal(taskId, TEST_IDS.taskId)
    const manifest = [...this.manifests.values()].find((candidate) => candidate.taskId === taskId) ?? null
    return {
      taskId,
      candidate: [...this.candidates.values()].find((candidate) => candidate.taskId === taskId) ?? null,
      manifest,
      receipt: null,
      result: null,
      revisionRequest: this.revisionRequest
    }
  }

  answerHumanNeeded(): void {
    assert.equal(this.execution.state, 'needs_human')
    this.advance('running')
  }

  completeAfterSeal(): void {
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state: 'completed',
      stateRevision: this.execution.stateRevision + 1,
      revision: this.execution.revision + 1,
      currentResultSubmissionId: TEST_IDS.resultSubmissionId,
      terminalAt: TEST_LATER_TIMESTAMP,
      fence: {
        ...this.execution.fence,
        status: 'fenced',
        reason: 'completed',
        fencedAt: TEST_LATER_TIMESTAMP
      },
      updatedAt: TEST_LATER_TIMESTAMP
    })
    this.task = taskSchema.parse({
      ...this.task,
      status: 'completed',
      currentExecutionState: 'completed',
      completedAt: TEST_LATER_TIMESTAMP,
      revision: this.task.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
  }

  enterHumanNeeded(): void {
    assert.equal(this.execution.state, 'running')
    this.advance('needs_human')
  }

  private advance(state: FakeWorkerExecutionState, startedAt = TEST_LATER_TIMESTAMP): void {
    const taskRevision = this.task.revision + 1
    const assignmentTaskRevision = this.execution.fence.assignmentTaskRevision
    const terminal = state === 'failed'
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state,
      stateRevision: this.execution.stateRevision + 1,
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP,
      acceptedAt: this.execution.acceptedAt,
      startedAt: state === 'running' || state === 'needs_human' || state === 'failed'
        ? this.execution.startedAt ?? startedAt
        : null,
      terminalAt: terminal ? TEST_LATER_TIMESTAMP : null,
      fence: {
        ...this.execution.fence,
        assignmentTaskRevision,
        status: terminal ? 'fenced' : 'open',
        reason: state === 'failed' ? 'execution_failed' : null,
        fencedAt: terminal ? TEST_LATER_TIMESTAMP : null
      },
      fileIntent: this.fileMode ? fileExecutionIntent(assignmentTaskRevision) : null
    })
    this.task = makeTask(state, taskRevision, this.fileMode)
  }

}

function makeTask(state: FakeWorkerTaskState, revision: number, fileMode = false): Task {
  const unclaimed = state === 'offered'
  return taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId: TEST_IDS.taskId,
    projectId: TEST_IDS.projectId,
    createdByCoordinatorAgentId: TEST_IDS.secondAgentId,
    title: 'Analyze meeting notes',
    objective: 'Produce the agreed concise result.',
    completionCriteria: ['Return a reviewable summary'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['agent-runtime.codex'],
    fileIntent: fileMode ? taskFileIntent() : null,
    currentExecutionId: unclaimed ? null : TEST_IDS.executionId,
    currentExecutionState: unclaimed ? null : state,
    status: state === 'failed'
      ? 'failed'
      : state === 'needs_human'
        ? 'needs_human'
      : state === 'running' || state === 'accepted'
        ? 'in_progress'
        : 'offered',
    executionCount: unclaimed ? 0 : 1,
    contractRevision: 1,
    contractDigest: TEST_HASH,
    maxRetries: 2,
    completedAt: state === 'failed' ? TEST_LATER_TIMESTAMP : null,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function makeExecution(
  state: 'accepted' | 'running',
  taskRevision: number,
  fileMode = false,
  assignmentTaskRevision = 1
): TaskExecution {
  return taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
    assigneeUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state,
    stateRevision: 3,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision,
      projectExecutionAuthorityEpoch: 1,
      userTaskAuthorityEpoch: 1,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: fileMode ? fileExecutionIntent(assignmentTaskRevision) : null,
    currentResultSubmissionId: null,
    contractRevision: 1,
    contractDigest: TEST_HASH,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_LATER_TIMESTAMP,
    startedAt: state === 'running' ? TEST_LATER_TIMESTAMP : null,
    terminalAt: null,
    revision: 3,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function offerPayload() {
  return {
    protocolVersion: '1.0' as const,
    type: 'task.offered' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    taskOfferId: OFFER_ID,
    workerUserId: TEST_IDS.userId,
    currentTaskRevision: 1,
    offerRevision: 1,
    contractRevision: 1,
    contractDigest: TEST_HASH
  }
}

function offerJournal() {
  return {
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    taskOfferId: OFFER_ID,
    currentTaskRevision: 1,
    currentExecutionRevision: 1,
    offerRevision: 1,
    contractRevision: 1,
    contractDigest: TEST_HASH,
    recipientAgentId: TEST_IDS.agentId,
    receivedAt: TEST_TIMESTAMP
  }
}

function fileExecutionIntent(assignmentTaskRevision: number) {
  return {
    schemaVersion: 1 as const,
    type: 'task_execution_file_intent' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    assignmentTaskRevision,
    declarationDigest: TEST_HASH,
    inputs: [{ resourceRefId: INPUT_RESOURCE_ID, destinationName: 'input.csv' }],
    output: {
      kind: 'delivery.output' as const,
      fileName: 'analysis.md',
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
}

function taskFileIntent() {
  return {
    schemaVersion: 1 as const,
    inputs: [{
      kind: 'collaboration.object-input' as const,
      locator: FILE_LOCATOR,
      destinationName: 'input.csv'
    }],
    output: {
      kind: 'delivery.output' as const,
      fileName: 'analysis.md',
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
}

function fileResources(assignmentTaskRevision: number) {
  const metadata = {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
  return [
    cloudResourceRefSchema.parse({
      ...metadata,
      type: 'resource_ref',
      resourceRefId: INPUT_RESOURCE_ID,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision,
      intentDigest: TEST_HASH,
      role: 'input-file',
      ordinal: 0,
      locator: FILE_LOCATOR,
      locatorDigest: FILE_LOCATOR_DIGEST,
      status: 'available',
      invalidatedAt: null
    })
  ]
}

function digestFixture(input: unknown): string {
  return createHash('sha256').update(canonicalFixture(input)).digest('hex')
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function canonicalFixture(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') {
    return JSON.stringify(input)
  }
  if (Array.isArray(input)) return `[${input.map(canonicalFixture).join(',')}]`
  if (!input || typeof input !== 'object') throw new TypeError('Unsupported canonical fixture.')
  return `{${Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${canonicalFixture(value)}`)
    .join(',')}}`
}

function emptyState(): CollaborationLocalState {
  return {
    schemaVersion: 4,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [agentNodeFixture],
    projections: [],
    projects: [],
    projectUnavailableFences: [],
    tasks: [],
    taskRuns: [],
    taskInteractions: [],
    taskCheckpoints: [],
    pendingTaskOffers: [],
    queue: [],
    receipts: [],
    outbox: [],
    outboxWait: null,
    diagnostics: [],
    remoteApprovals: []
  }
}

function entityResponse(request: RestRequest, entity: unknown): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity
  } as unknown as RestResponse
}

function collectionResponse(request: RestRequest, items: unknown[]): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items
  } as unknown as RestResponse
}

function neverAgent(): DomainMainAgentExecutionHost {
  return {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => { throw new Error('Agent Runtime must not run.') }
  }
}

async function readyRuntimeReadiness() {
  return {
    state: 'ready' as const,
    runtimeId: 'codex',
    capabilityTags: ['agent-runtime.codex', 'model-access.api']
  }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

class FailOnceTaskRunBackend implements CollaborationStateBackend {
  private failed = false

  constructor(private value: unknown) {}

  async read(): Promise<unknown> { return structuredClone(this.value) }

  async write(value: CollaborationLocalState): Promise<void> {
    if (!this.failed && value.taskRuns.length > 0) {
      this.failed = true
      throw new Error('simulated crash before the local TaskRun checkpoint')
    }
    this.value = structuredClone(value)
  }
}

class FailOnceStartedRunBackend implements CollaborationStateBackend {
  private failed = false

  constructor(private value: unknown) {}

  async read(): Promise<unknown> { return structuredClone(this.value) }

  async write(value: CollaborationLocalState): Promise<void> {
    const run = value.taskRuns[0]
    if (!this.failed && run?.state === 'running' && run.startedAt !== null) {
      this.failed = true
      throw new Error('simulated crash before the local execution-start checkpoint')
    }
    this.value = structuredClone(value)
  }
}

class FailOnceSealedRunBackend implements CollaborationStateBackend {
  private failed = false

  constructor(private value: unknown) {}

  async read(): Promise<unknown> { return structuredClone(this.value) }

  async write(value: CollaborationLocalState): Promise<void> {
    if (!this.failed && value.taskRuns.some((run) => (
      run.state === 'completed' && run.deliverySaga?.state === 'sealed'
    ))) {
      this.failed = true
      throw new Error('simulated crash after Cloud seal')
    }
    this.value = structuredClone(value)
  }
}

for (const reason of ['membership_removal', 'execution_fenced'] as const) {
  test(`retry rechecks ${reason} before dispatching a Runtime turn`, async () => {
    const cloud = new FakeWorkerCloud()
    const initial = emptyState()
    let attempts = 0
    const created = await createRunner(cloud, {
      runtimeReadiness: readyRuntimeReadiness,
      prepareSession: async () => ({ runtimeId: 'codex', threadId: 'worker-retry-thread' }),
      run: async () => {
        attempts += 1
        return {
          runtimeId: 'codex', threadId: 'worker-retry-thread', turnId: `turn-${attempts}`,
          state: 'failed', text: '',
          failure: { code: 'model_capacity', message: 'Model at capacity.', retryable: true }
        }
      }
    }, initial)
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await created.adapter.waitForIdle()
    assert.equal(attempts, 1)

    cloud.denyPreflight(reason)
    await created.adapter.submitTaskInteraction({
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId, kind: 'retry'
    })
    await created.adapter.waitForIdle()
    assert.equal(attempts, 1)
    assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
    assert.equal(created.store.snapshot().taskRuns[0]?.state, 'fenced')
    assert.equal(cloud.commands.includes('task.result.submit'), false)
  })
}

for (const outcome of ['accepted', 'expired', 'contract-conflict', 'claimed-elsewhere'] as const) {
  test(`fully offline manual intent survives restart and resolves as ${outcome} through durable Outbox`, async () => {
    const cloud = new FakeWorkerCloud()
    const contract = { contractRevision: 1, contractDigest: 'a'.repeat(64) }
    Object.assign(cloud.task, contract)
    Object.assign(cloud.offer, contract)
    const connection = cloud.connection()
    let online = false
    cloud.connection = () => ({
      ...connection,
      executeAsAgent: async (request: RestRequest) => {
        if (!online) throw new Error('Cloud network unavailable')
        return connection.executeAsAgent(request)
      }
    }) as CollaborationConnection
    const initial = emptyState()
    const backend = new MemoryBackend(initial)
    const claims: RestRequest[] = []
    let commits = 0
    const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
      store, localAgentId: () => TEST_IDS.agentId, now: () => new Date(TEST_TIMESTAMP),
      agentCloudRuntime: createTestAgentCloudRuntime({
        authorityStatus: async (agentId) => ({
          state: 'ready', agentId, userId: agentNodeFixture.ownerUserId,
          deviceId: agentNodeFixture.deviceId!, generation: agentNodeFixture.credentialVersion,
          runtimeId: null, capabilityTags: []
        }),
        execute: async (_agentId, request) => {
          if (!online) throw new Error('Cloud network unavailable')
          if (request.type === 'worker.availability.publish') return entityResponse(request, agentNodeFixture)
          if (request.type === 'task.offer.accept') {
            claims.push(structuredClone(request))
            if (outcome !== 'accepted') return {
              protocolVersion: '1.0', type: 'rest.error', requestId: request.requestId,
              error: createCollaborationError(outcome === 'expired' ? 'expired' : 'revision_conflict',
                outcome === 'expired' ? 'Offer expired at Cloud receipt' : 'The Contract has changed')
            }
            commits += 1
          }
          return cloud.outbox().enqueueAndWait('task.offer-decision', request)
        }
      })
    })
    const unavailableRuntime: DomainMainAgentExecutionHost = {
      runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Runtime missing' }),
      run: async () => { throw new Error('Pending/parked claims must not run') }
    }
    const interrupted = await createRunner(cloud, unavailableRuntime, initial,
      { backend, outboxFactory })
    await interrupted.adapter.acceptOffer({ ...offerPayload(), ...contract }, TEST_IDS.agentId)
    await interrupted.adapter.waitForIdle()
    await interrupted.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await interrupted.adapter.waitForIdle()
    const queued = interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.offer-decision')!
    assert.equal(queued.body.type, 'task.offer.accept')
    assert.equal(queued.body.expectedContractRevision, contract.contractRevision)
    assert.equal(queued.body.expectedContractDigest, contract.contractDigest)
    assert.equal(queued.state, 'failed')
    assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
    assert.equal(interrupted.store.snapshot().taskRuns.length, 0)
    await assert.rejects(interrupted.adapter.acceptOffer({ ...offerPayload(),
      contractRevision: 2, contractDigest: 'b'.repeat(64), currentTaskRevision: 2, offerRevision: 2
    }, TEST_IDS.agentId), /new Offer and manual acceptance/u)
    interrupted.adapter.stop()
    interrupted.outbox.stop()
    online = true
    const restored = await createRunner(cloud, unavailableRuntime, initial,
      { backend, outboxFactory })
    await restored.adapter.recover()
    await restored.adapter.waitForIdle()
    restored.adapter.wake()
    await restored.adapter.waitForIdle()
    if (outcome === 'claimed-elsewhere') await restored.adapter.handleInbox(agentInboxMessageSchema.parse({
      ...agentInboxMessageFixture, inboxMessageId: 'ibx_OfflineCompetingClaim01', sequence: 2,
      payload: { protocolVersion: '1.0', type: 'task.offer.claimed',
        projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, taskOfferId: OFFER_ID,
        executionId: TEST_IDS.executionId, claimedByAgentId: 'agt_OtherDevice000001', offerRevision: 2,
        ...contract }
    }))
    if (outcome === 'expired') {
      const timeout = agentInboxMessageSchema.parse({
        ...agentInboxMessageFixture, inboxMessageId: 'ibx_OfflineTimedOut01', sequence: 2,
        payload: { protocolVersion: '1.0', type: 'task.offer.closed',
          projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, taskOfferId: OFFER_ID,
          audience: 'worker', outcome: 'timed_out', taskRevision: 2, offerRevision: 2 }
      })
      await restored.adapter.handleInbox(timeout)
      await restored.adapter.handleInbox(timeout)
      assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.offerRevision, 2)
    }
    assert.equal(claims.length, 1)
    assert.deepEqual(claims[0], queued.body)
    assert.equal(commits, outcome === 'accepted' ? 1 : 0)
    if (outcome === 'accepted') {
      assert.equal(restored.store.snapshot().taskRuns[0]?.state, 'waiting-runtime')
      assert.equal(cloud.execution.state, 'accepted')
    } else {
      assert.equal(restored.store.snapshot().taskRuns.length, 0)
      assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.state, outcome === 'expired' ? 'closed' : outcome === 'claimed-elsewhere' ? 'claimed_elsewhere' : 'failed')
      if (outcome === 'expired') assert.equal(restored.store.snapshot().pendingTaskOffers[0]?.closedOutcome, 'timed_out')
    }
  })
}


for (const failure of [
  { code: 'upstream_unavailable', message: 'Upstream returned HTTP 502', retryable: true },
  { code: 'response_schema_incompatible', message: 'Chat Completions returned an incompatible response schema.', retryable: true }
]) {
test(`a delivered failed Session input (${failure.code}) projects failure, fresh-input admission runs, and its success prepares the editable draft`, async () => {
  const cloud = new FakeWorkerCloud()
  let admission: SessionAdmissionSnapshot = { revision: 0, receipts: [], submission: null, recovery: 'ready' }
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness, readAdmission: async () => admission,
    run: async (input) => ({ runtimeId: input.runtimeId!, threadId: input.threadId!, turnId: 'original-turn',
      state: 'completed', text: completedWorkerResultText('Original result') })
  })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  const original = created.adapter.workerDeliveryView(TEST_IDS).draft!
  const run = created.store.snapshot().taskRuns[0]!
  const ref = { runtimeId: run.runtimeId!, threadId: run.threadId! }
  admission = { ...admission, revision: 1, receipts: [{ clientDirectiveId: 'failed-source', revision: 1,
    payloadDigest: TEST_HASH, mode: 'direct', delivery: 'delivered', turnId: 'failed-turn', execution: 'output_pending' }] }
  const event: SessionOutputEvent = { ...ref, revision: 1, turnId: 'failed-turn', state: 'failed' }
  await created.adapter.acceptSessionOutput(event, async () => ({ ...ref, id: ref.threadId, watermark: '1', artifacts: [],
    turns: [{ id: event.turnId, failure, messages: [], artifacts: [] }] }))
  const failed = collaborationTaskViewForRun(created.store.snapshot().taskRuns[0]!)
  assert.equal(failed.failure?.code, failure.code)
  assert.equal(failed.reexecutionInputId, 'failed-source')
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  assert.equal(created.adapter.workerDeliveryView(TEST_IDS).candidate, null)
  // The canonical fresh-input action accepts a NEW queue id and abandons the old
  // failed receipt. It never changes that old receipt back to executable.
  admission = { ...admission, revision: 3, receipts: [
    { ...admission.receipts[0]!, delivery: 'abandoned', execution: 'failed', revision: 2 },
    { clientDirectiveId: 'fresh-input', revision: 1, payloadDigest: TEST_HASH, mode: 'queue',
      delivery: 'accepted', execution: 'not_started' }
  ] }
  await created.adapter.acceptSessionAdmission({ ...ref, revision: 3, kind: 'direct', clientDirectiveId: 'fresh-input' })
  assert.equal(collaborationTaskViewForRun(created.store.snapshot().taskRuns[0]!).failure, undefined)
  const staleRetry = await created.adapter.submitTaskInteraction({ projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, kind: 'retry' })
  assert.notEqual(staleRetry.state, 'applied', 'a previous failure cannot authorize an adapter retry beside the new Session input')
  created.adapter.wake()
  await created.adapter.waitForIdle()
  assert.equal(created.store.snapshot().taskRuns[0]!.agentJournal.filter((entry) => entry.origin !== 'session').length, 1,
    'ordinary input observation cannot cause an adapter-owned turn')
  admission = { ...admission, receipts: [admission.receipts[0]!, { ...admission.receipts[1]!,
    delivery: 'delivered', execution: 'output_pending', turnId: 'fresh-turn' }] }
  const readThread: Parameters<CollaborationTaskAdapter['acceptSessionOutput']>[1] = async () => ({ ...ref, id: ref.threadId,
    watermark: '3', artifacts: [], turns: [{ id: 'fresh-turn', artifacts: [], messages: [{ itemId: 'new-final', kind: 'assistant-final',
      text: completedWorkerResultText('New candidate after reexecution') }] }] })
  await created.adapter.acceptSessionOutput({ ...ref, revision: 3, turnId: 'fresh-turn', state: 'completed' }, readThread)
  const draft = created.adapter.workerDeliveryView(TEST_IDS).draft!
  assert.equal(draft.resultRevision, original.resultRevision)
  assert.equal(draft.sourceTurnId, 'fresh-turn')
  assert.equal(draft.summary, 'New candidate after reexecution')
  await created.adapter.acceptSessionOutput(event, async () => { throw new Error('old output must not be reread') })
  assert.deepEqual(created.adapter.workerDeliveryView(TEST_IDS).draft, draft, 'late old failure cannot replace the new draft')
  assert.equal(collaborationTaskViewForRun(created.store.snapshot().taskRuns[0]!).failure, undefined)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
})
}

test('submission exposes Device signing before any upload, then seals one exact operation', async () => {
  const cloud = new FakeWorkerCloud()
  cloud.validDeliveryManifest = true
  const started = deferred<void>()
  const release = deferred<void>()
  const signer = fakeSigning()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({ runtimeId: 'codex', threadId: 'signing-progress', turnId: 'turn-signing-progress',
      state: 'completed', text: completedWorkerResultText('Ready to submit.') })
  }, emptyState(), { signing: { signDeviceFact: async (...args) => {
    started.resolve()
    await release.promise
    return signer.signDeviceFact(...args)
  } } })
  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await created.adapter.waitForIdle()
  const input = await deliverySubmitInput(created.adapter)
  const pending = created.adapter.submitWorkerDelivery(input)
  await started.promise
  const during = created.adapter.workerDeliveryView(input.target)
  assert.equal(during.state, 'submitting')
  assert.equal(during.submissionProgress, 'signing')
  assert.equal(cloud.candidates.size, 0)
  assert.equal(cloud.manifests.size, 0)
  await assert.rejects(created.adapter.submitWorkerDelivery(input), /already in progress/u)
  release.resolve()
  assert.equal((await pending).state, 'sealed')
  assert.equal(cloud.manifests.size, 1)
  assert.equal(created.adapter.workerDeliveryView(input.target).submissionProgress, undefined)
})

test('offline acceptance enters the canonical User outbox and resumes once authority recovers without another decision', async () => {
  const cloud = new FakeWorkerCloud()
  const enqueued = deferred<void>()
  let identityReady = true
  let sends = 0
  const transport: AuthenticatedCloudTransport = {
    status: () => identityReady ? { state: 'ready', baseUrl: 'https://cloud.example.test',
      userId: agentNodeFixture.ownerUserId, deviceId: agentNodeFixture.deviceId!, deviceRevision: 1 }
      : { state: 'unavailable', reasonCode: 'authority_unverified', reason: 'Reconnecting' },
    execute: async (command) => {
      sends += 1
      const request = restRequestSchema.parse(command.payload)
      assert.equal(request.type, 'task.offer.accept')
      const response = await cloud.outbox().enqueueAndWait('task.offer-decision', request)
      assert.equal(response.type, 'rest.collection')
      if (response.type === 'rest.collection') {
        const proof = { userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId,
          acceptedAt: TEST_LATER_TIMESTAMP, proofDigest: TEST_HASH, interaction: 'explicit_click' as const }
        cloud.execution = taskExecutionSchema.parse({ ...cloud.execution, workerAcceptanceProof: proof,
          fence: { ...cloud.execution.fence, workerAcceptanceProof: proof } })
        response.items[1] = cloud.execution
      }
      return { contractVersion: 1, status: 200, body: response }
    },
    stageObject: async () => { throw new Error('No upload before acceptance') },
    readObject: async () => { throw new Error('No file read before acceptance') }
  }
  const created = await createRunner(cloud, {
    runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Runtime missing' }),
    run: async () => { throw new Error('Offline intent must not run') }
  }, emptyState(), {
    authenticatedCloudTransport: transport,
    outboxFactory: (store) => {
      const outbox = new DurableCloudOutbox({ store, authenticatedCloudTransport: transport,
        localAgentId: () => TEST_IDS.agentId,
        agentCloudRuntime: createTestAgentCloudRuntime({
          authorityStatus: async (agentId) => ({ state: 'ready', agentId,
            userId: agentNodeFixture.ownerUserId, deviceId: agentNodeFixture.deviceId!,
            generation: 1, runtimeId: null, capabilityTags: [] }),
          execute: async (_id, request) => {
            assert.notEqual(request.type, 'task.offer.accept', 'acceptance must use User credentials')
            return cloud.outbox().enqueueAndWait('task.progress', request)
          }
        })
      })
      const enqueue = outbox.enqueue.bind(outbox)
      outbox.enqueue = async (kind, request) => {
        await enqueue(kind, request)
        if (request.type === 'task.offer.accept') enqueued.resolve()
      }
      return outbox
    }
  })
  try {
    await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
    await created.adapter.waitForIdle()
    cloud.recoveryReadError = Object.assign(new Error('Cloud network unavailable'), { code: 'cloud_unavailable' })
    created.adapter.wake()
    await created.adapter.waitForIdle()
    assert.equal(created.adapter.offerAvailability(OFFER_ID).reason, 'offline_queue_available')
    created.outbox.stop()
    await created.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await enqueued.promise
    const original = created.store.snapshot().outbox.find((entry) => entry.body.type === 'task.offer.accept')!
    assert.equal(original.state, 'pending')
    assert.equal(original.attempts, 0)
    assert.equal(created.adapter.offerAvailability(OFFER_ID).state, 'sync_pending')
    assert.equal(created.store.snapshot().taskRuns.length, 0)
    identityReady = false
    created.outbox.start()
    await created.outbox.waitForIdle()
    assert.equal(created.store.snapshot().outboxWait?.reason, 'user_identity')
    assert.equal(sends, 0)
    identityReady = true
    cloud.recoveryReadError = null
    created.outbox.wake()
    await created.adapter.waitForIdle()
    const delivered = created.store.snapshot().outbox.find((entry) => entry.outboxId === original.outboxId)!
    assert.equal(delivered.state, 'delivered', delivered.error)
    assert.equal(delivered.attempts, 1)
    assert.deepEqual(delivered.body, original.body)
    assert.equal(sends, 1)
    assert.equal(created.store.snapshot().taskRuns.length, 1)
    assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 0)
  } finally { created.adapter.stop(); created.outbox.stop() }
})
