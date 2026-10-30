import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryManifestDigest, projectCompletionTargetDigest, type ProjectCompletionTarget,
  type RestRequest, type RestResponse } from '@sciforge/collaboration-contracts'
import { TEST_IDS, TEST_TIMESTAMP, projectFixture } from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
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

function setup() {
  const writes: RestRequest[] = []
  const reads: RestRequest[] = []
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
    stageObject: async () => { throw new Error('No object upload on Coordinator read path.') },
    readObject: async () => { throw new Error('Unexpected byte read.') },
    execute: async ({ payload }) => {
      reads.push(payload)
      return { contractVersion: 1, status: 200, body: { protocolVersion: '1.0', requestId: payload.requestId,
        type: 'rest.delivery', delivery: { manifest, workerAttestation: null, revisionRequests: [] } } }
    }
  }
  const port = createProjectCoordinatorDeliveryPort({ transport, workspace: { readWorkspace: async () => workspace() },
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
  return { port, writes, reads, failHuman: () => { failHuman = true }, stale: () => { expectedRevision++ } }
}

test('Coordinator reads exact sealed Delivery through current User transport', async () => {
  const setupResult = setup()
  const read = await setupResult.port.read({ deliveryManifestId: manifestId })
  assert.equal(read.manifest.deliveryManifestId, manifestId)
  assert.equal(setupResult.reads[0]?.type, 'delivery.get')
  assert.equal(setupResult.writes.length, 0)
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
