import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  frozenDeliveryBundleSchema,
  frozenDeliveryBundleDigest,
  objectStagedResponseSchema,
  restRequestSchema,
  workerDeliveryConfirmationDigest,
  type DeliveryCandidate
} from '@sciforge/collaboration-contracts'
import {
  frozenWorkerCandidateSchema,
  workerDeliverySagaSchema,
  type CollaborationOutboxEntry,
  type CollaborationTaskRun
} from './store.js'

/** Reconstruct only an already approved operation, from its original durable evidence. */
export async function restoreWorkerDeliveryCheckpoint(
  run: CollaborationTaskRun,
  candidate: DeliveryCandidate,
  entries: readonly CollaborationOutboxEntry[]
) {
  const execution = run.execution
  const frozen = run.frozenCandidate
  if (!execution || !frozen || candidate.projectId !== run.offer.projectId ||
      candidate.taskId !== run.offer.taskId || candidate.executionId !== run.offer.executionId ||
      candidate.workerUserId !== execution.assigneeUserId ||
      candidate.contractRevision !== execution.contractRevision ||
      frozen.contract.contractRevision !== candidate.contractRevision ||
      frozen.contract.contractDigest !== execution.contractDigest ||
      !['submitted', 'sealed'].includes(candidate.status)) {
    throw new Error('Delivery recovery does not match the current Worker Execution and Contract.')
  }
  const reviewEntry = entries.find(({ body }) => body.type === 'delivery.candidate.review' &&
    body.candidateId === candidate.candidateId && body.decision === 'approved')
  const review = restRequestSchema.parse(reviewEntry?.body)
  if (review.type !== 'delivery.candidate.review') throw new Error('The original signed Delivery review is missing.')
  const proof = review.humanAction
  const operationId = `dop_${createHash('sha256').update(proof.actionId).digest('hex').slice(0, 32)}`
  const target = {
    projectId: candidate.projectId, taskId: candidate.taskId, executionId: candidate.executionId,
    contractRevision: candidate.contractRevision, resultRevision: candidate.resultRevision,
    bundleDigest: candidate.bundleDigest, decision: 'approved' as const
  }
  if (review.idempotencyKey !== `idem_delivery.candidate.review.${operationId}` ||
      review.resultRevision !== candidate.resultRevision || review.bundleDigest !== candidate.bundleDigest ||
      proof.confirmedInputDigest !== workerDeliveryConfirmationDigest(target) ||
      proof.deviceSignature.userId !== execution.assigneeUserId ||
      proof.deviceSignature.deviceId !== execution.assigneeDeviceId) {
    throw new Error('The original human proof does not confirm this exact Delivery.')
  }
  const created = restRequestSchema.parse(entries.find(({ idempotencyKey }) => (
    idempotencyKey === `idem_delivery.candidate.create.${operationId}`
  ))?.body)
  if (created.type !== 'delivery.candidate.create' ||
      created.candidateId !== candidate.candidateId || created.projectId !== candidate.projectId ||
      created.taskId !== candidate.taskId || created.executionId !== candidate.executionId ||
      created.workerUserId !== candidate.workerUserId || created.contractRevision !== candidate.contractRevision ||
      created.resultRevision !== candidate.resultRevision || created.bundleDigest !== candidate.bundleDigest ||
      created.bundleObjectId !== candidate.bundleObjectId ||
      JSON.stringify(created.outputObjectIds) !== JSON.stringify(candidate.outputObjectIds)) {
    throw new Error('The original Delivery create checkpoint conflicts with Cloud.')
  }
  const stagedFile = (suffix: string, objectId: string) => {
    const entry = entries.find(({ idempotencyKey }) => idempotencyKey === `idem_object.stage.${operationId}.${suffix}`)
    const receipt = objectStagedResponseSchema.parse(entry?.response)
    const file = entry?.stageFile
    if (!entry || entry.kind !== 'delivery.stage' || entry.state !== 'delivered' || !file ||
        entry.body.projectId !== candidate.projectId || entry.body.taskId !== candidate.taskId ||
        entry.body.executionId !== candidate.executionId || receipt.requestId !== entry.body.requestId ||
        receipt.object.objectId !== objectId ||
        receipt.object.projectId !== candidate.projectId || receipt.object.ownerUserId !== candidate.workerUserId ||
        receipt.object.sha256 !== file.sha256 || receipt.object.byteCount !== file.byteCount) {
      throw new Error('The exact Delivery object staging checkpoint is missing or conflicting.')
    }
    return { ...file, mediaType: receipt.object.mediaType }
  }
  const bundleFile = stagedFile('bundle', candidate.bundleObjectId)
  const bytes = await readFile(bundleFile.path)
  if (bytes.byteLength !== bundleFile.byteCount ||
      createHash('sha256').update(bytes).digest('hex') !== bundleFile.sha256) {
    throw new Error('The original frozen Delivery bundle bytes changed.')
  }
  const bundle = frozenDeliveryBundleSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (bundle.projectId !== candidate.projectId || bundle.taskId !== candidate.taskId ||
      bundle.executionId !== candidate.executionId || bundle.contractRevision !== candidate.contractRevision ||
      bundle.resultRevision !== candidate.resultRevision || frozenDeliveryBundleDigest(bundle) !== candidate.bundleDigest) {
    throw new Error('The original frozen bundle does not match the approved Cloud candidate.')
  }
  const outputFiles = candidate.outputObjectIds.map((objectId, index) => stagedFile(`output.${index}`, objectId))
  if (bundle.outputs.length !== outputFiles.length || outputFiles.some((file, index) => (
    file.sha256 !== bundle.outputs[index].sha256 || file.byteCount !== bundle.outputs[index].byteCount ||
    file.mediaType !== bundle.outputs[index].mediaType
  ))) throw new Error('The staged Delivery outputs do not match the frozen bundle.')
  return {
    frozenCandidate: frozenWorkerCandidateSchema.parse({
      ...frozen, candidateId: candidate.candidateId, frozenAt: proof.occurredAt,
      bundle, bundleDigest: candidate.bundleDigest, bundleFile, outputFiles, dirty: false
    }),
    deliverySaga: workerDeliverySagaSchema.parse({
      operationId, candidateId: candidate.candidateId, proof, state: 'seal', manifest: null, error: null
    })
  }
}
