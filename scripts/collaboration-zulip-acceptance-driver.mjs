/**
 * Read-only verification of a packaged-desktop Collaboration run (§9.19 R5).
 * The desktop supplies Project/Task/manifest IDs. This module never performs
 * human actions, registers participants, signs facts, or writes evidence files.
 * `verifyDesktopRun` reports missing evidence; it cannot accept R6 or check tasks.
 * Simulation uses supplied in-memory responses and never calls a network client.
 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  canonicalFrozenDeliveryBundleBytes,
  deliveryManifestWriteSchema,
  frozenDeliveryBundleSchema,
  objectReadQuerySchema,
  restRequestSchema,
  restResponseSchema,
  taskSchema,
  workerAttestationSchema
} from '@sciforge/collaboration-contracts'

const SLOTS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F'])
const READ_COMMANDS = Object.freeze([
  'project.get', 'project.coordination.read', 'project.membership.list',
  'task.get', 'delivery.candidate.get', 'delivery.get', 'delivery.task.get',
  'delivery.drive.list', 'receipt.get'
])
const REQUIRED_EXTERNAL_EVIDENCE = Object.freeze([
  'packaged-desktop-build-provenance', 'server-image-and-migration-provenance',
  'human-step-screenshots-and-operation-receipts', 'complete-cloud-command-ledger',
  'candidate-privacy-before-confirmation', 'agent-human-decision-denials',
  'stale-confirmation-denial', 'waiting-confirmation-restart', 'unknown-seal-recovery'
])
export const acceptanceEnvironmentContract = Object.freeze({
  common: Object.freeze(['SCIFORGE_COLLAB_ZULIP_SERVER_URL']),
  optionalCommon: Object.freeze(['SCIFORGE_COLLAB_ZULIP_TIMEOUT_MS']),
  perParticipant: Object.freeze([
    'SCIFORGE_COLLAB_ZULIP_<SLOT>_OIDC_ACCESS_TOKEN or ..._OIDC_ACCESS_TOKEN_FILE'
  ])
})

class AcceptanceDriverError extends Error {
  constructor(code) {
    super('The read-only acceptance verification did not complete.')
    this.name = 'AcceptanceDriverError'
    this.code = code
  }
}
const fail = (code) => { throw new AcceptanceDriverError(code) }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function required(value) {
  if (typeof value !== 'string' || !value.trim()) fail('ACCEPTANCE_CONFIGURATION_MISSING')
  return value.trim()
}
function serverBase(value) {
  let url
  try { url = new URL(required(value)) } catch { fail('ACCEPTANCE_CONFIGURATION_INVALID') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) fail('INSECURE_ENDPOINT_REJECTED')
  return `${url.toString().replace(/\/+$/u, '')}/`
}
async function readSecret(environment, name) {
  const inline = environment(name)
  const fileName = environment(`${name}_FILE`)
  if (inline && fileName) fail('SECRET_SOURCE_AMBIGUOUS')
  if (inline) return required(inline)
  const path = required(fileName)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096 ||
        (info.mode & 0o777) !== 0o600) fail('SECRET_FILE_PERMISSION_REJECTED')
    return required(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof AcceptanceDriverError) throw error
    fail('SECRET_FILE_UNAVAILABLE')
  }
}
function parse(schema, value, code = 'COLLABORATION_RESPONSE_INVALID') {
  const result = schema.safeParse(value)
  if (!result.success) fail(code)
  return result.data
}
function reportSafely(report, label) {
  if (typeof report === 'function') report(label)
}

export function createZulipAcceptanceDriver({ environment = (name) => process.env[name], report,
  mode = 'real', fixtures, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!['real', 'simulation'].includes(mode)) fail('ACCEPTANCE_CONFIGURATION_INVALID')
  if (mode === 'real' && fixtures !== undefined) fail('SIMULATION_FIXTURE_REJECTED')
  const serverUrl = mode === 'real' ? serverBase(environment('SCIFORGE_COLLAB_ZULIP_SERVER_URL')) : null
  const timeoutMs = Number(environment('SCIFORGE_COLLAB_ZULIP_TIMEOUT_MS') || 90000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) fail('ACCEPTANCE_CONFIGURATION_INVALID')
  const tokens = new Map()
  async function tokenFor(slot) {
    if (!SLOTS.includes(slot)) fail('PARTICIPANT_SLOT_INVALID')
    if (!tokens.has(slot)) tokens.set(slot, await readSecret(environment, `SCIFORGE_COLLAB_ZULIP_${slot}_OIDC_ACCESS_TOKEN`))
    return tokens.get(slot)
  }
  async function transport(slot, route, { method, body } = {}) {
    // These are the only two network routes. JSON queries use the Cloud's
    // existing POST envelope; byte reads can only be GET. No caller URL exists.
    if (!((route === 'v1/commands' && method === 'POST' && READ_COMMANDS.includes(body?.type)) ||
          (route.startsWith('v1/objects/read?') && method === 'GET' && body === undefined))) {
      fail('READ_ONLY_OPERATION_REQUIRED')
    }
    if (mode !== 'real') fail('SIMULATION_NETWORK_FORBIDDEN')
    const token = await tokenFor(slot)
    try {
      return await fetchImpl(new URL(route, serverUrl), {
        method, redirect: 'error', headers: { authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs)
      })
    } catch { fail('COLLABORATION_TRANSPORT_FAILED') }
  }
  async function readCommand({ slot = 'A', ...command }) {
    if (!READ_COMMANDS.includes(command.type)) fail('READ_ONLY_OPERATION_REQUIRED')
    const body = parse(restRequestSchema, { ...command, protocolVersion: '1.0',
      requestId: `req_${randomUUID().replaceAll('-', '')}` }, 'DRIVER_CONTRACT_INVALID')
    let raw
    let ok = true
    if (mode === 'simulation') {
      const key = JSON.stringify(command)
      if (!Object.hasOwn(fixtures?.commands ?? {}, key)) fail('SIMULATION_FIXTURE_MISSING')
      raw = structuredClone(fixtures.commands[key])
      raw.requestId = body.requestId
    } else {
      const response = await transport(slot, 'v1/commands', { method: 'POST', body })
      ok = response.ok
      try { raw = await response.json() } catch { fail('COLLABORATION_RESPONSE_INVALID') }
    }
    const parsed = parse(restResponseSchema, raw)
    if (parsed.requestId !== body.requestId) fail('COLLABORATION_RESPONSE_INVALID')
    if (parsed.type === 'rest.error') fail('COLLABORATION_READ_REJECTED')
    if (!ok) fail('COLLABORATION_REQUEST_FAILED')
    reportSafely(report, 'cloud.facts.read')
    return parsed
  }
  async function readObjectBytes({ slot = 'A', query, object, method = 'GET' }) {
    if (method !== 'GET') fail('READ_ONLY_OPERATION_REQUIRED')
    const parsed = parse(objectReadQuerySchema, query, 'DRIVER_CONTRACT_INVALID')
    if (object?.objectId !== parsed.objectId || object?.projectId !== parsed.projectId) fail('OBJECT_IDENTITY_MISMATCH')
    let bytes, versionId, sha256, objectId, revision
    if (mode === 'simulation') {
      const fixture = fixtures?.objects?.[parsed.objectId]
      if (!fixture) fail('SIMULATION_FIXTURE_MISSING')
      bytes = Buffer.from(fixture.bytes)
      ;({ versionId, sha256, objectId, revision } = fixture)
    } else {
      const response = await transport(slot, `v1/objects/read?${new URLSearchParams(parsed)}`, { method: 'GET' })
      if (!response.ok) fail('COLLABORATION_READ_REJECTED')
      try { bytes = Buffer.from(await response.arrayBuffer()) } catch { fail('COLLABORATION_RESPONSE_INVALID') }
      versionId = response.headers.get('x-sciforge-version-id')
      sha256 = response.headers.get('x-sciforge-sha256')
      objectId = response.headers.get('x-sciforge-object-id')
      revision = Number(response.headers.get('x-sciforge-object-revision'))
    }
    if (objectId !== object.objectId || revision !== object.revision || sha256 !== object.sha256 ||
        bytes.length !== object.byteCount || digest(bytes) !== object.sha256) fail('OBJECT_BYTES_MISMATCH')
    return { bytes, versionId: typeof versionId === 'string' && versionId.length > 0 ? versionId : null }
  }
  async function verifyDesktopRun({ ownerSlot = 'A', projectId, workerUserId, workerDeviceId,
    deliveryManifestIds, dependentTaskId } = {}) {
    if (!Array.isArray(deliveryManifestIds) || deliveryManifestIds.length < 1 ||
        new Set(deliveryManifestIds).size !== deliveryManifestIds.length) fail('DESKTOP_RECORD_REQUIRED')
    required(workerUserId)
    const checks = [], missing = [...REQUIRED_EXTERNAL_EVIDENCE]
    if (!workerDeviceId) missing.push('desktop-worker-device-identity')
    const projectRead = await readCommand({ slot: ownerSlot, type: 'project.get', projectId })
    if (projectRead.type !== 'rest.entity' || projectRead.entity.type !== 'project' ||
        projectRead.entity.projectId !== projectId) fail('PROJECT_IDENTITY_MISMATCH')
    if (projectRead.entity.ownerUserId === workerUserId) fail('TWO_DISTINCT_USERS_REQUIRED')
    const driveRead = await readCommand({ slot: ownerSlot, type: 'delivery.drive.list', projectId })
    if (driveRead.type !== 'rest.delivery.drive' || driveRead.drive.projectId !== projectId) fail('PROJECT_IDENTITY_MISMATCH')
    const deliveries = [], observations = []
    for (const deliveryManifestId of deliveryManifestIds) {
      const read = await readCommand({ slot: ownerSlot, type: 'delivery.get', deliveryManifestId })
      if (read.type !== 'rest.delivery') fail('COLLABORATION_RESPONSE_INVALID')
      const manifest = parse(deliveryManifestWriteSchema, read.delivery.manifest, 'CURRENT_DELIVERY_REQUIRED')
      if (!driveRead.drive.taskDeliveries.some((item) => item.deliveryManifestId === deliveryManifestId &&
          item.manifestDigest === manifest.manifestDigest)) fail('MANIFEST_READBACK_MISMATCH')
      const attestation = parse(workerAttestationSchema, read.delivery.workerAttestation, 'CLOUD_ATTESTATION_REQUIRED')
      if (manifest.deliveryManifestId !== deliveryManifestId || manifest.projectId !== projectId ||
          attestation.attestationId !== manifest.workerAttestationId || attestation.projectId !== projectId ||
          attestation.taskId !== manifest.taskId || attestation.executionId !== manifest.executionId ||
          attestation.contractRevision !== manifest.contract.contractRevision ||
          attestation.resultRevision !== manifest.resultRevision || attestation.bundleDigest !== manifest.bundleDigest ||
          attestation.workerUserId !== workerUserId || (workerDeviceId && attestation.deviceId !== workerDeviceId) ||
          Date.parse(attestation.attestedAt) > Date.parse(manifest.sealedAt)) fail('ATTESTATION_BINDING_MISMATCH')
      const byteReads = new Map()
      for (const object of manifest.objects) {
        const observed = await readObjectBytes({ slot: ownerSlot,
          query: { projectId, deliveryManifestId, objectId: object.objectId }, object })
        if (!observed.versionId) missing.push(`exact-storage-version:${deliveryManifestId}:${object.objectId}`)
        byteReads.set(object.objectId, observed)
      }
      let rawBundle
      try { rawBundle = JSON.parse(byteReads.get(manifest.bundleObjectId).bytes.toString('utf8')) }
      catch { fail('BUNDLE_BYTES_INVALID') }
      const bundle = parse(frozenDeliveryBundleSchema, rawBundle, 'BUNDLE_BYTES_INVALID')
      if (!Buffer.from(canonicalFrozenDeliveryBundleBytes(bundle)).equals(byteReads.get(manifest.bundleObjectId).bytes) ||
          bundle.projectId !== projectId || bundle.taskId !== manifest.taskId || bundle.executionId !== manifest.executionId ||
          bundle.contractRevision !== manifest.contract.contractRevision || bundle.resultRevision !== manifest.resultRevision ||
          bundle.outputs.length !== manifest.outputObjectIds.length) fail('BUNDLE_BINDING_MISMATCH')
      const taskRead = await readCommand({ slot: ownerSlot, type: 'task.get', taskId: manifest.taskId })
      if (taskRead.type !== 'rest.entity' || taskRead.entity.type !== 'task' ||
          taskRead.entity.projectId !== projectId || taskRead.entity.taskId !== manifest.taskId ||
          taskRead.entity.contractRevision !== manifest.contract.contractRevision ||
          taskRead.entity.contractDigest !== manifest.contract.contractDigest) fail('CONTRACT_BINDING_MISMATCH')
      const currentTask = parse(taskSchema, taskRead.entity, 'CURRENT_TASK_REQUIRED')
      const declaredOutput = currentTask.fileIntent?.output
      const declaredFiles = bundle.outputs.filter(({ role }) => role === 'declared')
      if ((declaredOutput ? 1 : 0) !== declaredFiles.length || (declaredOutput &&
          (declaredFiles[0].fileName !== declaredOutput.fileName || declaredFiles[0].relativePath !== declaredOutput.fileName ||
           declaredFiles[0].source !== 'ai' || declaredFiles[0].mediaType !== declaredOutput.mediaType ||
           declaredFiles[0].byteCount > declaredOutput.maxBytes))) fail('OUTPUT_ROLE_MISMATCH')
      for (const [index, objectId] of manifest.outputObjectIds.entries()) {
        const object = manifest.objects.find((item) => item.objectId === objectId)
        const output = bundle.outputs[index]
        const descriptor = manifest.outputs[index]
        if (descriptor.objectId !== objectId ||
            Object.entries(output).some(([key, value]) => descriptor[key] !== value) ||
            output.sha256 !== object.sha256 || output.byteCount !== object.byteCount || output.mediaType !== object.mediaType) {
          fail('OUTPUT_ROLE_MISMATCH')
        }
      }
      observations.push({ deliveryManifestId, manifestDigest: manifest.manifestDigest, operationId: manifest.operationId,
        taskId: manifest.taskId, executionId: manifest.executionId, resultRevision: manifest.resultRevision,
        attestationId: attestation.attestationId, attestationDigest: attestation.attestationDigest,
        workerUserId: attestation.workerUserId, proofDeviceId: attestation.deviceId, attestedAt: attestation.attestedAt,
        objects: manifest.objects.map((object) => ({ objectId: object.objectId, revision: object.revision,
          sha256: object.sha256, byteCount: object.byteCount, versionId: byteReads.get(object.objectId).versionId })) })
      checks.push(`delivery-bytes-and-attestation:${deliveryManifestId}`)
      deliveries.push({ manifest, revisionRequests: read.delivery.revisionRequests })
    }
    if (deliveries.some(({ manifest }) => manifest.taskId !== deliveries[0].manifest.taskId)) fail('SOURCE_TASK_IDENTITY_MISMATCH')
    const ordered = [...deliveries].sort((a, b) => a.manifest.resultRevision - b.manifest.resultRevision)
    let revisionObserved = false
    for (let index = 1; index < ordered.length; index++) {
      const before = ordered[index - 1], after = ordered[index]
      const revision = before.revisionRequests.find((item) => item.deliveryManifestId === before.manifest.deliveryManifestId &&
        item.executionId === before.manifest.executionId && item.taskId === before.manifest.taskId &&
        item.projectId === projectId && item.requestedByUserId === projectRead.entity.ownerUserId)
      if (before.manifest.resultRevision === after.manifest.resultRevision || !revision || before.manifest.executionId !== after.manifest.executionId ||
          before.manifest.contract.contractDigest !== after.manifest.contract.contractDigest ||
          Date.parse(revision.requestedAt) < Date.parse(before.manifest.sealedAt) ||
          Date.parse(revision.requestedAt) > Date.parse(after.manifest.sealedAt)) fail('SAME_EXECUTION_REVISION_MISMATCH')
      revisionObserved = true
    }
    if (revisionObserved) checks.push('same-execution-revision')
    else missing.push('same-execution-revision')
    const latest = ordered.at(-1).manifest
    const factsRead = await readCommand({ slot: ownerSlot, type: 'delivery.task.get', taskId: latest.taskId })
    if (factsRead.type !== 'rest.task.delivery' || factsRead.facts.taskId !== latest.taskId) fail('COLLABORATION_RESPONSE_INVALID')
    if (factsRead.facts.manifest?.manifestDigest !== latest.manifestDigest) fail('MANIFEST_READBACK_MISMATCH')
    const { result, receipt } = factsRead.facts
    if (!result || !receipt) missing.push('published-project-result')
    else {
      if (result.projectId !== projectId || result.deliveryManifestId !== latest.deliveryManifestId ||
          result.integrationReceiptId !== receipt.integrationReceiptId || result.disposition !== 'adopted' ||
          receipt.disposition !== 'adopted' || receipt.deliveryManifestId !== latest.deliveryManifestId ||
          receipt.taskId !== latest.taskId || receipt.projectId !== projectId ||
          !driveRead.drive.projectResults.some((item) => item.projectResultId === result.projectResultId &&
            item.deliveryManifestId === latest.deliveryManifestId && item.integrationReceiptId === receipt.integrationReceiptId &&
            item.projectVersion === result.projectVersion && item.disposition === 'adopted')) {
        fail('PROJECT_RESULT_BINDING_MISMATCH')
      }
      checks.push('published-project-result')
      missing.push('current-plan-result-version')
    }
    if (!dependentTaskId || !result) missing.push('dependent-task-exact-input')
    else {
      const dependent = await readCommand({ slot: ownerSlot, type: 'task.get', taskId: dependentTaskId })
      if (dependent.type !== 'rest.entity' || dependent.entity.type !== 'task' ||
          dependent.entity.taskId !== dependentTaskId || dependent.entity.projectId !== projectId ||
          !dependent.entity.dependencyTaskIds.includes(latest.taskId)) fail('DEPENDENCY_BINDING_MISMATCH')
      const currentDependent = parse(taskSchema, dependent.entity, 'CURRENT_TASK_REQUIRED')
      const inputs = currentDependent.fileIntent?.inputs ?? []
      const match = latest.outputs.length > 0 && latest.outputs.every((output) => inputs.some(({ locator }) =>
        (locator.source.kind === 'adopted_delivery' || (locator.source.kind === 'project_result' &&
          locator.source.projectResultId === result.projectResultId)) &&
        locator.source.deliveryManifestId === latest.deliveryManifestId && locator.object.objectId === output.objectId &&
        latest.objects.some((object) => object.objectId === output.objectId &&
          Object.entries(object).every(([key, value]) => locator.object[key] === value))))
      if (!match) fail('DEPENDENCY_BINDING_MISMATCH')
      checks.push('dependent-task-exact-input')
    }
    reportSafely(report, 'verification.readback-complete')
    return Object.freeze({ environment: mode === 'real' ? 'real_cloud_readback' : 'simulated_cloud',
      status: 'incomplete', accepted: false, checks, observations, missing: [...new Set(missing)],
      note: 'Cloud reads do not prove human UI actions, negative cases, or a complete command ledger. Independent evidence acceptance is required.' })
  }
  return Object.freeze({ mode, readCommand, readObjectBytes, verifyDesktopRun })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write('acceptance:read-only-library; desktop run identifiers required\n')
}
