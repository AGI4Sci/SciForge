import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalFrozenDeliveryBundleBytes, deliveryManifestDigest, scientificDigest } from '@sciforge/collaboration-contracts'
import { collaborationFixtures } from '@sciforge/collaboration-contracts/testing'
import { acceptanceEnvironmentContract, createZulipAcceptanceDriver } from './collaboration-zulip-acceptance-driver.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const timestamp = '2026-10-16T00:00:00.000Z'
const metadata = { schemaVersion: 1, revision: 1, createdAt: timestamp, updatedAt: timestamp }
const env = (name) => ({ SCIFORGE_COLLAB_ZULIP_SERVER_URL: 'https://cloud.example.invalid/',
  SCIFORGE_COLLAB_ZULIP_A_OIDC_ACCESS_TOKEN: 'sensitive-bearer-value' })[name]
const envelope = (body) => ({ protocolVersion: '1.0', requestId: 'req_ReadonlyFixture01', ...body })

function fixtureRun() {
  const project = structuredClone(collaborationFixtures.project)
  const workerUserId = 'usr_ReadonlyWorker01', workerDeviceId = 'dev_ReadonlyWorker01'
  const task = { ...structuredClone(collaborationFixtures.task), contractRevision: 1, contractDigest: 'a'.repeat(64),
    fileIntent: { schemaVersion: 1, inputs: [], output: { kind: 'delivery.output', fileName: 'result.txt',
      mediaType: 'text/plain', maxBytes: 1000 } } }
  const fixtures = { commands: {}, objects: {} }
  const add = (command, response) => { fixtures.commands[JSON.stringify(command)] = envelope(response) }
  add({ type: 'project.get', projectId: project.projectId }, { type: 'rest.entity', entity: project })
  add({ type: 'task.get', taskId: task.taskId }, { type: 'rest.entity', entity: task })
  const deliveries = [1, 2].map((revision) => {
    const outputBytes = Buffer.from(`Scientific output revision ${revision}`)
    const additionalFiles = [
      { fileName: 'measurements.csv', relativePath: 'data/measurements.csv', source: 'member',
        mediaType: 'text/csv', bytes: Buffer.from(`sample,value\nA,${revision}\n`) },
      { fileName: 'notes.json', relativePath: '.sciforge/uploads/thread-1/notes.json', source: 'attachment',
        mediaType: 'application/json', bytes: Buffer.from(JSON.stringify({ revision })) }
    ]
    const bundle = { schemaVersion: 2, projectId: project.projectId, taskId: task.taskId,
      executionId: 'exe_ReadonlyExecution1', contractRevision: 1, resultRevision: revision,
      summary: 'Reviewed scientific output.', outputs: [{ fileName: 'result.txt', relativePath: 'result.txt',
        role: 'declared', source: 'ai', mediaType: 'text/plain', byteCount: outputBytes.length, sha256: hash(outputBytes) },
      ...additionalFiles.map(({ bytes, ...file }) => ({ ...file, role: 'member', byteCount: bytes.length, sha256: hash(bytes) }))] }
    const bundleBytes = Buffer.from(canonicalFrozenDeliveryBundleBytes(bundle))
    const makeObject = (role, bytes, mediaType) => {
      const object = { objectId: `obj_Readonly${role}000${revision}`, objectKey: `objects/${role}/${revision}`, revision: 1,
        sha256: hash(bytes), byteCount: bytes.length, mediaType, projectId: project.projectId,
        visibility: 'project_public', ownerUserId: workerUserId, retentionUntil: null }
      fixtures.objects[object.objectId] = { bytes, versionId: `immutable-${role}-${revision}`,
        objectId: object.objectId, revision: object.revision, sha256: object.sha256 }
      return object
    }
    const bundleObject = makeObject('Bundle', bundleBytes, 'application/json')
    const outputObjects = [makeObject('Output', outputBytes, 'text/plain'),
      ...additionalFiles.map(({ bytes, mediaType }, index) => makeObject(`Additional${index}`, bytes, mediaType))]
    const attestationPayload = { schemaVersion: 1, type: 'worker_attestation', attestationId: `wra_ReadonlyAttest00${revision}`,
      projectId: project.projectId, taskId: task.taskId, executionId: bundle.executionId,
      candidateId: `dly_ReadonlyCandidate${revision}`, workerUserId, attestedByUserId: workerUserId,
      deviceId: workerDeviceId, interaction: 'explicit_click', sourceMessageDigest: null,
      contractRevision: 1, resultRevision: revision, bundleDigest: hash(bundleBytes), proofDigest: 'b'.repeat(64),
      humanActionId: `action-readonly-${revision}`, attestedAt: timestamp }
    const workerAttestation = { ...metadata, ...attestationPayload, attestationDigest: scientificDigest(attestationPayload) }
    const manifestPayload = { ...metadata, type: 'delivery_manifest', deliveryManifestId: `mft_ReadonlyManifest${revision}`,
      projectId: project.projectId, taskId: task.taskId, executionId: bundle.executionId,
      contract: { projectId: project.projectId, taskId: task.taskId, contractRevision: 1,
        contractDigest: task.contractDigest, inputReferences: [] }, resultRevision: revision,
      workerAttestationId: workerAttestation.attestationId, bundleDigest: hash(bundleBytes),
      bundleObjectId: bundleObject.objectId, outputObjectIds: outputObjects.map(({ objectId }) => objectId),
      outputs: bundle.outputs.map((output, index) => ({ ...output, objectId: outputObjects[index].objectId })),
      objects: [bundleObject, ...outputObjects], workerDecision: 'approved', verificationEvidence: ['Exact output reviewed.'],
      operationId: `seal-readonly-${revision}`, sealedAt: timestamp }
    const manifest = { ...manifestPayload, manifestDigest: deliveryManifestDigest(manifestPayload) }
    const revisionRequests = revision === 1 ? [{ revisionRequestId: 'revision-request-readonly', projectId: project.projectId,
      taskId: task.taskId, executionId: bundle.executionId, executionRevision: 2, deliveryManifestId: manifest.deliveryManifestId,
      instruction: 'Add the requested control.', requestedByUserId: project.ownerUserId, requestedAt: timestamp }] : []
    const delivery = { manifest, workerAttestation, revisionRequests }
    add({ type: 'delivery.get', deliveryManifestId: manifest.deliveryManifestId }, { type: 'rest.delivery', delivery })
    return delivery
  })
  const latest = deliveries[1].manifest
  const receipt = { ...metadata, type: 'integration_receipt', integrationReceiptId: 'irc_ReadonlyReceipt01',
    projectId: project.projectId, taskId: task.taskId, deliveryManifestId: latest.deliveryManifestId,
    integrationRevision: 1, validationEvidence: ['Reviewed exact results.'], operationId: 'adopt-readonly-1', disposition: 'adopted' }
  const result = { ...metadata, type: 'project_result', projectResultId: 'res_ReadonlyResult01',
    projectId: project.projectId, deliveryManifestId: latest.deliveryManifestId, integrationReceiptId: receipt.integrationReceiptId,
    projectVersion: 1, adoptedAt: timestamp, disposition: 'adopted' }
  add({ type: 'delivery.drive.list', projectId: project.projectId }, { type: 'rest.delivery.drive', drive: {
    projectId: project.projectId, sharedMaterials: [], taskDeliveries: deliveries.map(({ manifest }) => manifest), projectResults: [result] } })
  add({ type: 'delivery.task.get', taskId: task.taskId }, { type: 'rest.task.delivery', facts: {
    taskId: task.taskId, candidate: null, manifest: latest, receipt, result, revisionRequest: null } })
  const dependent = { ...task, taskId: 'tsk_ReadonlyDependent1', dependencyTaskIds: [task.taskId],
    fileIntent: { schemaVersion: 1, inputs: latest.outputs.map((output, index) => ({
      kind: 'collaboration.object-input', destinationName: `upstream-${index}-${output.fileName}`, locator: {
        kind: 'collaboration.object-reference', source: { kind: 'project_result', projectResultId: result.projectResultId,
          deliveryManifestId: latest.deliveryManifestId },
        object: latest.objects.find(({ objectId }) => objectId === output.objectId)
      } })), output: task.fileIntent.output } }
  add({ type: 'task.get', taskId: dependent.taskId }, { type: 'rest.entity', entity: dependent })
  return { fixtures, deliveries, task, dependent, result, options: { projectId: project.projectId, workerUserId, workerDeviceId,
    deliveryManifestIds: deliveries.map(({ manifest }) => manifest.deliveryManifestId), dependentTaskId: dependent.taskId } }
}

const denied = (code) => (error) => error?.code === code && !/sensitive-bearer-value/u.test(error.message)

test('real transport rejects every business write before reading credentials or using fetch', async () => {
  let reads = 0, requests = 0
  const driver = createZulipAcceptanceDriver({ environment(name) {
    if (name.endsWith('TOKEN')) reads++
    return env(name)
  }, fetch() { requests++; throw new Error('must not run') } })
  for (const type of ['project.create', 'task.offer.accept', 'delivery.candidate.create', 'delivery.candidate.review',
    'delivery.manifest.seal', 'delivery.adoption.record', 'project.result.publish', 'object.stage',
    'object.storage.reconcile', 'project.final_summary.submit', 'inbox.ack', 'agent.ensure']) {
    await assert.rejects(driver.readCommand({ type }), denied('READ_ONLY_OPERATION_REQUIRED'))
  }
  await assert.rejects(driver.readObjectBytes({ method: 'POST' }), denied('READ_ONLY_OPERATION_REQUIRED'))
  assert.equal(reads, 0); assert.equal(requests, 0)
  assert.deepEqual(Object.keys(driver).sort(), ['mode', 'readCommand', 'readObjectBytes', 'verifyDesktopRun'])
})

test('authenticated JSON reads use fixed routes, match request IDs, and reject redirects without logging secrets', async () => {
  const calls = [], reports = []
  const driver = createZulipAcceptanceDriver({ environment: env, report: (label) => reports.push(label), fetch: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ ...envelope({ type: 'rest.entity', entity: collaborationFixtures.project }),
      requestId: JSON.parse(options.body).requestId }), { status: 200 })
  } })
  await driver.readCommand({ type: 'project.get', projectId: collaborationFixtures.project.projectId })
  assert.equal(calls[0].url.pathname, '/v1/commands'); assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers.authorization, 'Bearer sensitive-bearer-value')
  assert.deepEqual(reports, ['cloud.facts.read'])
  const failing = createZulipAcceptanceDriver({ environment: env, fetch: () => { throw new Error('sensitive-bearer-value') } })
  await assert.rejects(failing.readCommand({ type: 'project.get', projectId: collaborationFixtures.project.projectId }), denied('COLLABORATION_TRANSPORT_FAILED'))
})

test('secret files require owner-only permissions and ambiguous sources are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collaboration-readonly-'))
  try {
    const path = join(directory, 'credential')
    await writeFile(path, 'sensitive-bearer-value', { mode: 0o644 }); await chmod(path, 0o644)
    const driver = createZulipAcceptanceDriver({ environment: (name) => name.endsWith('_TOKEN_FILE') ? path :
      name.endsWith('_TOKEN') ? undefined : env(name) })
    await assert.rejects(driver.readCommand({ type: 'project.get', projectId: collaborationFixtures.project.projectId }), denied('SECRET_FILE_PERMISSION_REJECTED'))
    const ambiguous = createZulipAcceptanceDriver({ environment: (name) => name.endsWith('_TOKEN_FILE') ? path : env(name) })
    await assert.rejects(ambiguous.readCommand({ type: 'project.get', projectId: collaborationFixtures.project.projectId }), denied('SECRET_SOURCE_AMBIGUOUS'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('simulation checks canonical bytes, role mapping, Cloud attestation readback, result lineage and same Execution without claiming acceptance', async () => {
  const { fixtures, options } = fixtureRun()
  const driver = createZulipAcceptanceDriver({ mode: 'simulation', fixtures, fetch() { assert.fail('simulation must not use network') } })
  const report = await driver.verifyDesktopRun(options)
  assert.equal(report.environment, 'simulated_cloud'); assert.equal(report.accepted, false); assert.equal(report.status, 'incomplete')
  assert.ok(report.checks.includes('same-execution-revision'))
  assert.ok(report.checks.includes('dependent-task-exact-input'))
  assert.ok(report.observations.every(({ objects }) => objects.length === 4),
    'Every immutable version includes its bundle and all three declared/member/attachment files.')
  assert.ok(report.missing.includes('complete-cloud-command-ledger'))
  assert.ok(report.missing.includes('human-step-screenshots-and-operation-receipts'))
})

test('mismatched output bytes, missing exact VersionId and altered Worker identity are not accepted as evidence', async () => {
  const run = fixtureRun()
  const object = run.deliveries[0].manifest.objects[1]
  run.fixtures.objects[object.objectId].bytes = Buffer.from('tampered')
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: run.fixtures }).verifyDesktopRun(run.options), denied('OBJECT_BYTES_MISMATCH'))
  const noVersion = fixtureRun()
  noVersion.fixtures.objects[object.objectId].versionId = null
  const report = await createZulipAcceptanceDriver({ mode: 'simulation', fixtures: noVersion.fixtures }).verifyDesktopRun(noVersion.options)
  assert.ok(report.missing.some((item) => item.startsWith('exact-storage-version:')))
  const foreign = fixtureRun()
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: foreign.fixtures }).verifyDesktopRun({
    ...foreign.options, workerDeviceId: 'dev_AnotherWorker01' }), denied('ATTESTATION_BINDING_MISMATCH'))
})

test('a missing same-Execution revision request or non-output dependency is rejected', async () => {
  const missingRequest = fixtureRun()
  missingRequest.deliveries[0].revisionRequests.splice(0)
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: missingRequest.fixtures }).verifyDesktopRun(missingRequest.options), denied('SAME_EXECUTION_REVISION_MISMATCH'))
  const wrongOutput = fixtureRun()
  wrongOutput.dependent.fileIntent.inputs[0].locator.object = wrongOutput.deliveries[1].manifest.objects[0]
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: wrongOutput.fixtures }).verifyDesktopRun(wrongOutput.options), denied('DEPENDENCY_BINDING_MISMATCH'))
})

test('multi-file readback rejects metadata that drifts from frozen bytes and any missing adopted file input', async () => {
  const drifted = fixtureRun()
  const manifest = drifted.deliveries[0].manifest
  manifest.outputs[1].relativePath = 'other/measurements.csv'
  const { manifestDigest: _digest, ...payload } = manifest
  manifest.manifestDigest = deliveryManifestDigest(payload)
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: drifted.fixtures })
    .verifyDesktopRun(drifted.options), denied('OUTPUT_ROLE_MISMATCH'))

  const missingFile = fixtureRun()
  missingFile.dependent.fileIntent.inputs.pop()
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: missingFile.fixtures })
    .verifyDesktopRun(missingFile.options), denied('DEPENDENCY_BINDING_MISMATCH'))

  const staleFile = fixtureRun()
  staleFile.dependent.fileIntent.inputs[2].locator.object = staleFile.deliveries[0].manifest.objects[3]
  await assert.rejects(createZulipAcceptanceDriver({ mode: 'simulation', fixtures: staleFile.fixtures })
    .verifyDesktopRun(staleFile.options), denied('DEPENDENCY_BINDING_MISMATCH'))
})

test('multi-file readback accepts the canonical adopted Delivery lineage for every downstream file', async () => {
  const run = fixtureRun()
  for (const input of run.dependent.fileIntent.inputs) {
    input.locator.source = { kind: 'adopted_delivery', deliveryManifestId: run.deliveries[1].manifest.deliveryManifestId }
  }
  const report = await createZulipAcceptanceDriver({ mode: 'simulation', fixtures: run.fixtures }).verifyDesktopRun(run.options)
  assert.ok(report.checks.includes('dependent-task-exact-input'))
})

test('public environment contract and driver contain no operational provider integration or result-writing API', async () => {
  assert.match(JSON.stringify(acceptanceEnvironmentContract), /OIDC_ACCESS_TOKEN/u)
  assert.doesNotMatch(JSON.stringify(acceptanceEnvironmentContract), /API_KEY|AGENT_CREDENTIAL|BOT_EMAIL/u)
  const source = await readFile(new URL('./collaboration-zulip-acceptance-driver.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /task\.result\.|createDeliveryCandidate|signBytes|generateKeyPairSync|opencontent|zulipRequest|WebSocket/u)
})

test('real-run orchestration reaches only allowlisted JSON reads and exact GET object bytes', async () => {
  const run = fixtureRun(), calls = []
  const driver = createZulipAcceptanceDriver({ environment: env, fetch: async (url, options) => {
    calls.push({ path: url.pathname, method: options.method, type: options.body && JSON.parse(options.body).type })
    if (url.pathname === '/v1/commands') {
      const { protocolVersion: _version, requestId, ...command } = JSON.parse(options.body)
      return new Response(JSON.stringify({ ...run.fixtures.commands[JSON.stringify(command)], requestId }), { status: 200 })
    }
    assert.equal(url.pathname, '/v1/objects/read'); assert.equal(options.method, 'GET')
    const object = run.fixtures.objects[url.searchParams.get('objectId')]
    return new Response(object.bytes, { status: 200, headers: {
      'x-sciforge-object-id': object.objectId, 'x-sciforge-object-revision': String(object.revision),
      'x-sciforge-sha256': object.sha256, 'x-sciforge-version-id': object.versionId
    } })
  } })
  const result = await driver.verifyDesktopRun(run.options)
  assert.equal(result.environment, 'real_cloud_readback'); assert.equal(result.accepted, false)
  assert.equal(result.observations.length, 2)
  assert.ok(result.observations.every((item) => item.objects.every((object) => object.versionId)))
  assert.ok(calls.every((call) => (call.method === 'GET' && call.path === '/v1/objects/read') ||
    (call.method === 'POST' && ['project.get', 'task.get', 'delivery.get', 'delivery.task.get', 'delivery.drive.list'].includes(call.type))))
  assert.doesNotMatch(JSON.stringify(result), /sensitive-bearer-value|Scientific output revision/u)
})
