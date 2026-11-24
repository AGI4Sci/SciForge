import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectCoordinatorStateHost, ProjectCoordinatorStateStore } from './state.js'
import { createProjectCoordinatorCapabilityFactory, type ProjectCoordinatorCapabilityOptions } from './main.js'
import { DELIVERY_VALIDATION_ACTION, deliveryValidationRecordSchema } from './delivery-validation-contract.js'
import type { DeliveryValidationSpec } from './delivery-validation-contract.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryManifestDigest, projectCompletionTargetDigest, type ProjectCompletionTarget,
  type RestRequest, type RestResponse } from '@sciforge/collaboration-contracts'
import { TEST_IDS, TEST_TIMESTAMP, projectFixture } from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { DELIVERY_CONTENT_ACTIONS } from './delivery-content-contract.js'
import type { ProjectCoordinatorCapabilityInvocationContext } from './main.js'
import { createProjectCoordinatorDeliveryPort } from './delivery.js'
import type { ProjectCoordinatorWorkspace } from './contract.js'
import { coordinatorCloudCommandSchema, coordinatorUserCloudCommandSchema } from '../coordinator-cloud-command.js'

const manifestId = 'mft_DeliveryManifest01'
const receiptId = 'irc_Integration00001'
const resultId = 'res_ProjectResult001'
const requestId = TEST_IDS.requestId
const metadata = { schemaVersion: 1 as const, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }
const manifestPayload = {
  ...metadata, type: 'delivery_manifest' as const, deliveryManifestId: manifestId,
  projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
  contract: { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, contractRevision: 1,
    contractDigest: 'b'.repeat(64), inputReferences: [] },
  objects: [{ revision: 1, ownerUserId: TEST_IDS.userId, retentionUntil: null, objectId: 'obj_DeliveryObject01', projectId: TEST_IDS.projectId,
    objectKey: 'projects/test/results/one', sha256: 'a'.repeat(64), byteCount: 4,
    mediaType: 'text/plain', visibility: 'project_public' as const }],
  workerDecision: 'approved' as const, verificationEvidence: ['Checked controls'],
  operationId: 'operation_seal_001', sealedAt: TEST_TIMESTAMP
}
const manifest = { ...manifestPayload, manifestDigest: deliveryManifestDigest(manifestPayload) }
const receipt = { ...metadata, type: 'integration_receipt' as const, integrationReceiptId: receiptId,
  projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifestId,
  integrationRevision: 1, validationEvidence: ['Checked controls'], operationId: 'operation_adopt_001', disposition: 'adopted' as const }
const result = { ...metadata, type: 'project_result' as const, projectResultId: resultId,
  projectId: TEST_IDS.projectId, deliveryManifestId: manifestId, integrationReceiptId: receiptId,
  projectVersion: 1, adoptedAt: TEST_TIMESTAMP, disposition: 'adopted' as const }
const target: ProjectCompletionTarget = { projectId: TEST_IDS.projectId,
  expectedProjectRevision: 1, expectedCoordinatorAuthorityEpoch: 1, expectedExecutionAuthorityEpoch: 1,
  projectPlanId: TEST_IDS.projectPlanId, confirmedPlanRevision: 1, projectResultIds: [resultId], summary: 'Validated output.' }
const action = { actionId: 'owner_completion_001', interaction: 'explicit_click' as const,
  occurredAt: TEST_TIMESTAMP, confirmedInputDigest: projectCompletionTargetDigest(target), sourceMessageDigest: null }

function setup(validation?: { state: ProjectCoordinatorStateStore; manifest: typeof manifest; readBytes(): Promise<Uint8Array> }) {
  let revoked = false
  const activeManifest = validation?.manifest ?? manifest
  const writes: RestRequest[] = []
  const reads: RestRequest[] = []
  const signals: (AbortSignal | undefined)[] = []
  let approved: unknown
  let failHuman = false
  let expectedRevision = 1
  const workspace = (): ProjectCoordinatorWorkspace => ({
    connection: { state: 'ready', userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId }, observedAt: TEST_TIMESTAMP,
    availableWorkerUsers: [], projects: [{ project: { ...projectFixture, ownerUserId: TEST_IDS.userId,
      status: approved ? 'completed' : 'active', revision: expectedRevision,
      coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1 }, coordinatorTransferFeedback: null,
    requirementsDraft: null, confirmedRequirements: null,
    // Only completion authority fields are consumed by this port; Cloud workspace parsing is tested separately.
    plan: { plan: { projectPlanId: TEST_IDS.projectPlanId, revision: 1, state: 'confirmed' } } as ProjectCoordinatorWorkspace['projects'][number]['plan'],
    memberUsers: [], workerGroups: [], tasks: [], offers: [], memberships: [], pendingHumanNeeded: [], records: [],
    deliveryDrive: { projectId: TEST_IDS.projectId, sharedMaterials: [], taskDeliveries: [manifest], projectResults: [result] },
    legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
    finalSummary: approved ? { type: 'project_result_final_summary', ownerApproval: approved,
      summary: target.summary, projectResultIds: [resultId] } as ProjectCoordinatorWorkspace['projects'][number]['finalSummary'] : null }]
  })
  const transport: AuthenticatedCloudTransport = {
    status: () => ({ state: 'ready', baseUrl: 'https://cloud.test', userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
    lookupDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    createDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    revokeDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    readDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
    mutateDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
    listCloudSpaces: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
    ensureCloudSpace: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
    createCloudSpaceSession: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
    stageObject: async () => { throw new Error('No object upload on Coordinator read path.') },
    readObject: async (_input, options) => { signals.push(options?.signal); if (revoked || !validation) throw new Error('Byte read permission denied.'); return { object: activeManifest.objects[0]!, body: new Uint8Array(await validation.readBytes()), versionId: null } },
    execute: async ({ payload }, options) => {
      signals.push(options?.signal)
      if (revoked) throw new Error('Membership permission revoked.')
      reads.push(payload)
      return { contractVersion: 1, status: 200, body: { protocolVersion: '1.0', requestId: payload.requestId,
        type: 'rest.delivery', delivery: { manifest: activeManifest, workerAttestation: null, revisionRequests: [] } } }
    }
  }
  const port = createProjectCoordinatorDeliveryPort({ transport, validationState: validation?.state, workspace: { readWorkspace: async () => workspace() },
    requestId: () => requestId,
    humanActions: { capture: () => { if (failHuman) throw new Error('No native human grant'); return action },
      validate: () => ({ principal: {} as never, assertCurrent: () => undefined }) },
    signing: { signDeviceFact: async (request, confirmation) => {
      assert.deepEqual(confirmation, { purpose: 'project-completion-approval', target, action })
      return { purpose: request.purpose, canonicalPayloadDigest: request.factDigest, factRevision: request.factRevision,
        observedAt: request.observedAt, issuedAt: TEST_TIMESTAMP, userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId,
        deviceKeyId: 'device-key-owner', deviceKeyRevision: 1, signatureAlgorithm: 'Ed25519', signature: Buffer.alloc(64, 1).toString('base64url') }
    } },
    commands: { resumeUser: async () => null, executeUser: async (command) => {
      writes.push(command)
      if (command.type === 'project.final_summary.submit') approved = command.ownerApproval
      const entity = command.type === 'delivery.adoption.record' ? receipt : result
      return (command.type === 'project.final_summary.submit'
        ? { protocolVersion: '1.0', requestId, type: 'rest.collection', items: [] }
        : { protocolVersion: '1.0', requestId, type: 'rest.entity', entity }) as RestResponse
    } }
  })
  return { port, writes, reads, signals, revoke: () => { revoked = true }, failHuman: () => { failHuman = true }, stale: () => { expectedRevision++ } }
}

test('Coordinator reads exact sealed Delivery through current User transport', async () => {
  const setupResult = setup()
  const read = await setupResult.port.read({ deliveryManifestId: manifestId })
  assert.equal(read.manifest.deliveryManifestId, manifestId)
  assert.equal(setupResult.reads[0]?.type, 'delivery.get')
  assert.equal(setupResult.writes.length, 0)
})

test('canonical content factory forwards one cancellation lease through both manifest reads and object transport', async () => {
  const controller = new AbortController()
  let resolveRead: ((bytes: Uint8Array) => void) | undefined
  const fixture = setup({ state: {} as ProjectCoordinatorStateStore, manifest,
    readBytes: () => new Promise(resolve => { resolveRead = resolve }) })
  const open = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: definition => definition, ports: { delivery: fixture.port } as never,
    sessions: {} as never, projectCreation: {} as never
  }).createDefinitions().find(definition => definition.id === DELIVERY_CONTENT_ACTIONS.open)!
  let issued = false
  const context = { caller: { audience: 'ui' }, signal: controller.signal, assertPrincipalCurrent: () => undefined,
    issueResource: () => { issued = true; return {} } } as unknown as ProjectCoordinatorCapabilityInvocationContext
  const result = assert.rejects(open.handler({ deliveryManifestId: manifestId, objectId: manifest.objects[0]!.objectId }, context), /Cancelled production read/)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(fixture.signals.length, 3)
  assert.ok(fixture.signals.every(signal => signal === fixture.signals[0] && signal instanceof AbortSignal))
  controller.abort(new Error('Cancelled production read'))
  assert.equal(fixture.signals[2]!.aborted, true)
  resolveRead!(new Uint8Array(4)); await result
  assert.equal(issued, false)
})

test('adoption and publication are disjoint User commands and retain exact receipts', async () => {
  const { port, writes } = setup()
  const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifestId,
    integrationRevision: 1, validationEvidence: ['Checked controls'], operationId: 'operation_adopt_001', disposition: 'adopted' as const }
  assert.equal((await port.decideAdoption(input, 'idem_adoption_00001')).integrationReceiptId, receiptId)
  assert.equal((await port.publishResult({ integrationReceiptId: receiptId, projectVersion: 1 }, 'idem_publish_00001')).projectResultId, resultId)
  for (const command of writes) {
    assert.equal(coordinatorCloudCommandSchema.safeParse(command).success, false)
    assert.equal(coordinatorUserCloudCommandSchema.safeParse(command).success, true)
  }
})

test('Project completion binds Host confirmation to exact target and signed User write', async () => {
  const { port, writes } = setup()
  const workspace = await port.completeProject({ target }, 'idem_complete_00001')
  assert.equal(workspace.projects[0]?.project.status, 'completed')
  const command = writes[0]
  assert.equal(command?.type, 'project.final_summary.submit')
  assert.equal(coordinatorCloudCommandSchema.safeParse(command).success, false)
  assert.equal(coordinatorUserCloudCommandSchema.safeParse(command).success, true)
})

test('missing native confirmation and stale exact Project version cannot complete', async () => {
  const denied = setup(); denied.failHuman()
  await assert.rejects(denied.port.completeProject({ target }, 'idem_complete_00002'), /native human/)
  assert.equal(denied.writes.length, 0)
  const stale = setup(); stale.stale()
  await assert.rejects(stale.port.completeProject({ target }, 'idem_complete_00003'), /no longer matches/)
  assert.equal(stale.writes.length, 0)
})


test('frozen checks read real sealed JSON, survive restart, gate adoption, and never alter Cloud wire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-validation-'))
  try {
    const file = join(directory, 'measurement.json')
    const body = Buffer.from('{"score":0.95,"controls":{"matched":true}}')
    await writeFile(file, body)
    const payload = { ...manifestPayload, objects: [{ ...manifestPayload.objects[0]!, mediaType: 'application/json',
      sha256: createHash('sha256').update(body).digest('hex'), byteCount: body.length }] }
    const sealed = { ...payload, manifestDigest: deliveryManifestDigest(payload) }
    const legacy = { read: async () => ({ revision: 0, value: null }), write: async () => { throw new Error('Unexpected legacy write') },
      clear: async () => ({ revision: 0, value: null }) }
    const statePath = join(directory, 'coordinator.json')
    const openState = () => new ProjectCoordinatorStateStore(createProjectCoordinatorStateHost(statePath, legacy))
    const spec: DeliveryValidationSpec = { version: 1, target: { projectId: sealed.projectId, taskId: sealed.taskId,
      deliveryManifestId: sealed.deliveryManifestId, manifestDigest: sealed.manifestDigest, object: sealed.objects[0]! },
      assertions: [{ kind: 'range', path: ['score'], min: 0.9, max: 1 }, { kind: 'equals', path: ['controls', 'matched'], expected: true }] }
    const prior = setup({ state: openState(), manifest: sealed, readBytes: async () => { throw new Error('Interrupted before bytes') } })
    const unknown = await prior.port.validate(spec)
    assert.equal(unknown.status, 'unknown')
    const negativeSpec = { ...spec, assertions: [{ kind: 'range' as const, path: ['score'], min: 0, max: 0.5 }] }
    const negative = setup({ state: openState(), manifest: sealed, readBytes: () => readFile(file) })
    const negativeResult = await negative.port.validate(negativeSpec)
    assert.equal(negativeResult.status, 'failed')
    const first = setup({ state: openState(), manifest: sealed, readBytes: async () => {
      const snapshot = JSON.parse(await readFile(statePath, 'utf8'))
      assert.equal(snapshot.value.deliveryValidations.at(-1).status, 'unknown', 'spec must be durably frozen before bytes are read')
      return readFile(file)
    } })
    const capability = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
      defineCapability: definition => definition, ports: { delivery: first.port } as never,
      sessions: {} as never, projectCreation: {} as never
    }).createDefinitions().find(definition => definition.id === DELIVERY_VALIDATION_ACTION)!
    const passed = deliveryValidationRecordSchema.parse((await capability.handler(spec,
      { caller: { audience: 'ui' }, assertPrincipalCurrent: () => undefined } as never)).output)
    assert.equal(passed.status, 'passed')
    const retained = await openState().readDeliveryValidationHistory(sealed.projectId)
    assert.deepEqual(retained.map(record => record.status), ['unknown', 'failed', 'passed'])
    assert.equal(new Set(retained.map(record => record.checkId)).size, 3)
    // The same negative specification is later checked against the same immutable bytes.
    await negative.port.validate(negativeSpec)
    assert.equal((await openState().readDeliveryValidationHistory(sealed.projectId)).filter(record => record.checkId === negativeResult.checkId).length, 1)
    const concurrentState = openState()
    const concurrent = setup({ state: concurrentState, manifest: sealed, readBytes: () => readFile(file) })
    const runs = await Promise.all([concurrent.port.validate(spec), concurrent.port.validate(spec)])
    assert.equal(new Set(runs.map(record => record.checkId)).size, 2)
    assert.ok(runs.every(record => record.status === 'passed'))
    const older = { ...passed, checkId: randomUUID(), status: 'unknown' as const }
    const latest = { ...passed, checkId: randomUUID(), status: 'unknown' as const }
    await concurrentState.persistDeliveryValidation(older)
    await concurrentState.persistDeliveryValidation(latest)
    await concurrentState.persistDeliveryValidation({ ...older, status: 'passed' })
    assert.equal((await openState().readDeliveryValidation(passed.specDigest, passed.targetDigest, TEST_IDS.userId))?.status, 'unknown', 'an older late pass must never revive over the latest unknown')
    await concurrentState.persistDeliveryValidation({ ...latest, status: 'failed' })
    await concurrent.port.validate(spec)
    assert.equal((await openState().readDeliveryValidationHistory(sealed.projectId)).find(record => record.checkId === latest.checkId)?.status, 'failed', 'later same-spec pass preserves the negative attempt')
    const reference = { specDigest: passed.specDigest, targetDigest: passed.targetDigest }
    const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifestId,
      integrationRevision: 1, validationEvidence: ['Human review'], operationId: 'operation_adopt_001', disposition: 'adopted' as const,
      deliveryValidation: reference }
    const restarted = setup({ state: openState(), manifest: sealed, readBytes: () => readFile(file) })
    await restarted.port.decideAdoption(input, 'idem_validation_00001')
    assert.equal(restarted.writes.length, 1)
    assert.equal(Object.hasOwn(restarted.writes[0]!, 'deliveryValidation'), false)
    assert.equal(coordinatorUserCloudCommandSchema.safeParse(restarted.writes[0]).success, true)
    await assert.rejects(restarted.port.decideAdoption({ ...input, deliveryManifestId: 'mft_OtherManifest01' }, 'idem_validation_00002'), /matching passed/)
    await assert.rejects(restarted.port.decideAdoption({ ...input, deliveryValidation: { ...reference, specDigest: 'f'.repeat(64) } }, 'idem_validation_00003'), /matching passed/)
    const failed = await restarted.port.validate({ ...spec, assertions: [{ kind: 'range', path: ['score'], min: 0, max: 0.5 }] })
    assert.equal(failed.status, 'failed')
    await assert.rejects(restarted.port.decideAdoption({ ...input, deliveryValidation: { specDigest: failed.specDigest, targetDigest: failed.targetDigest } }, 'idem_validation_00004'), /matching passed/)
    assert.equal((await restarted.port.validate({ ...spec, assertions: [{ kind: 'equals', path: ['absent'], expected: null }] })).status, 'failed')
    const invalidBody = Buffer.from('not JSON')
    await writeFile(file, invalidBody)
    const invalidPayload = { ...payload, objects: [{ ...payload.objects[0]!, byteCount: invalidBody.length,
      sha256: createHash('sha256').update(invalidBody).digest('hex') }] }
    const invalidManifest = { ...invalidPayload, manifestDigest: deliveryManifestDigest(invalidPayload) }
    const invalid = setup({ state: openState(), manifest: invalidManifest, readBytes: () => readFile(file) })
    const invalidResult = await invalid.port.validate({ ...spec, target: { ...spec.target,
      manifestDigest: invalidManifest.manifestDigest, object: invalidManifest.objects[0]! } })
    assert.equal(invalidResult.status, 'unknown')
    assert.match(invalidResult.detail, /UTF-8 JSON/)
    const oversizedPayload = { ...payload, objects: [{ ...payload.objects[0]!, byteCount: 1_048_577 }] }
    const oversizedManifest = { ...oversizedPayload, manifestDigest: deliveryManifestDigest(oversizedPayload) }
    let oversizedReads = 0
    const oversized = setup({ state: openState(), manifest: oversizedManifest, readBytes: async () => { oversizedReads++; return body } })
    const oversizedResult = await oversized.port.validate({ ...spec, target: { ...spec.target,
      manifestDigest: oversizedManifest.manifestDigest, object: oversizedManifest.objects[0]! } })
    assert.equal(oversizedResult.status, 'unknown')
    assert.equal(oversizedReads, 0)
    await writeFile(file, body)
    const changedPayload = { ...payload, objects: [{ ...payload.objects[0]!, sha256: 'c'.repeat(64) }] }
    const changed = setup({ state: openState(), manifest: { ...changedPayload, manifestDigest: deliveryManifestDigest(changedPayload) }, readBytes: () => readFile(file) })
    await assert.rejects(changed.port.decideAdoption(input, 'idem_validation_00009'), /did not pass/)
    assert.equal(changed.writes.length, 0)
    await restarted.port.validate(spec)
    await writeFile(file, '{"score":0.01}')
    await assert.rejects(restarted.port.decideAdoption(input, 'idem_validation_00005'), /did not pass/)
    assert.equal((await openState().readDeliveryValidation(reference.specDigest, reference.targetDigest, TEST_IDS.userId))?.status, 'unknown')
    await writeFile(file, body)
    await restarted.port.validate(spec)
    restarted.revoke()
    await assert.rejects(restarted.port.decideAdoption(input, 'idem_validation_00006'), /did not pass/)
    assert.equal(restarted.writes.length, 1)
    // Manual adoption remains a human decision and carries no independent verification claim.
    const manual = setup()
    const { deliveryValidation: _verification, ...ordinary } = input
    await manual.port.decideAdoption(ordinary, 'idem_validation_00007')
    assert.equal(manual.reads.length, 0)
    const history = await openState().readDeliveryValidationHistory(sealed.projectId)
    assert.equal(history.find(record => record.checkId === unknown.checkId)?.status, 'unknown')
    assert.equal(history.find(record => record.checkId === negativeResult.checkId)?.status, 'failed')
    // Directly tampered persisted specs cannot reuse their previous passed identity.
    const data = JSON.parse(await readFile(statePath, 'utf8'))
    const record = data.value.deliveryValidations.findLast((item: { specDigest: string }) => item.specDigest === reference.specDigest)
    record.spec.assertions[0].min = 0
    record.status = 'passed'
    await writeFile(statePath, JSON.stringify(data))
    const tampered = setup({ state: openState(), manifest: sealed, readBytes: () => readFile(file) })
    await assert.rejects(tampered.port.decideAdoption(input, 'idem_validation_00008'), /matching passed/)
    assert.equal(tampered.writes.length, 0)
    const full = JSON.parse(await readFile(statePath, 'utf8'))
    while (full.value.deliveryValidations.length < 1000) full.value.deliveryValidations.push({ ...passed, checkId: randomUUID() })
    await writeFile(statePath, JSON.stringify(full))
    let fullReads = 0
    const capacity = setup({ state: openState(), manifest: sealed, readBytes: async () => { fullReads++; return readFile(file) } })
    await assert.rejects(capacity.port.validate(spec), /history is full/)
    assert.equal(fullReads, 0)
    assert.equal((await openState().readDeliveryValidationHistory(sealed.projectId)).length, 1000)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
