import { deliveryValidationSpecSchema, type DeliveryValidationSpec, type DeliveryValidationRecord } from './delivery-validation-contract.js'
import { checkDeliveryJson, validationDigest, VALIDATION_MAX_BYTES } from './delivery-validation.js'
import type { ProjectCoordinatorStateStore } from './state.js'
import { randomUUID } from 'node:crypto'
import {
  CURRENT_PROTOCOL_VERSION,
  deliveryReadViewSchema,
  deliveryDriveViewSchema,
  integrationReceiptSchema,
  deliveryRevisionRecordSchema,
  projectResultSchema,
  projectCompletionHumanActionFactDigest,
  projectCompletionTargetDigest,
  projectCompletionApprovalSchema,
  projectPlanCompletionTargetSchema,
  projectRequirementsCompletionTargetSchema,
  type ProjectCompletionTarget,
  type DeliveryReadView,
  type DeliveryDriveView,
  type IntegrationReceipt,
  type DeliveryRevisionRecord,
  type ProjectResult,
  type ObjectReference,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type { DomainMainHumanActionsHost } from '@sciforge/domain-sdk/host'
import { AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID, type AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DeviceFactAttestationSigningService } from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import {
  projectCoordinatorDeliveryReadInputSchema,
  projectCoordinatorDriveListInputSchema,
  projectCoordinatorAdoptionInputSchema,
  projectCoordinatorRevisionRequestInputSchema,
  projectCoordinatorResultPublishInputSchema,
  projectCoordinatorCompleteInputSchema,
  type ProjectCoordinatorDeliveryReadInput,
  type ProjectCoordinatorDriveListInput,
  type ProjectCoordinatorAdoptionInput,
  type ProjectCoordinatorRevisionRequestInput,
  type ProjectCoordinatorResultPublishInput,
  type ProjectCoordinatorCompleteInput,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import type { CoordinatorCloudCommandService } from '../coordinator-cloud-command.js'
import type { DeliveryObjectInput } from './delivery-content-contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'

export type ProjectCoordinatorDeliveryPort = Readonly<{
  validate(input: DeliveryValidationSpec): Promise<DeliveryValidationRecord>
  readObject(input: DeliveryObjectInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<{ object: ObjectReference; body: Uint8Array }>
  read(input: ProjectCoordinatorDeliveryReadInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<DeliveryReadView>
  listDrive(input: ProjectCoordinatorDriveListInput): Promise<DeliveryDriveView>
  decideAdoption(input: ProjectCoordinatorAdoptionInput, idempotencyKey: string): Promise<IntegrationReceipt>
  requestRevision(input: ProjectCoordinatorRevisionRequestInput, idempotencyKey: string): Promise<DeliveryRevisionRecord>
  publishResult(input: ProjectCoordinatorResultPublishInput, idempotencyKey: string): Promise<ProjectResult>
  completeProject(input: ProjectCoordinatorCompleteInput, idempotencyKey: string): Promise<ProjectCoordinatorWorkspace>
}>

/** All operations use current User credentials. Agent commands never enter this port. */
export function createProjectCoordinatorDeliveryPort(options: Readonly<{
  transport: AuthenticatedCloudTransport
  validationState?: Pick<ProjectCoordinatorStateStore, 'persistDeliveryValidation' | 'readDeliveryValidation'>
  commands: Pick<CoordinatorCloudCommandService, 'executeUser' | 'resumeUser'>
  workspace: ProjectCoordinatorWorkspacePort
  humanActions: DomainMainHumanActionsHost
  signing: DeviceFactAttestationSigningService
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorDeliveryPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const execute = async (
    payload: Parameters<AuthenticatedCloudTransport['execute']>[0]['payload'],
    requestOptions?: Readonly<{ signal?: AbortSignal }>
  ): Promise<RestResponse> => {
    requestOptions?.signal?.throwIfAborted()
    if (options.transport.status().state !== 'ready') throw new Error('Delivery requires an authenticated User and Device.')
    const response = await options.transport.execute({ contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID, payload }, requestOptions)
    requestOptions?.signal?.throwIfAborted()
    if (response.body.type === 'rest.error') throw new Error(`Delivery request failed: ${response.body.error.code}: ${response.body.error.message}`)
    if (response.status >= 400) throw new Error(`Delivery request failed: HTTP ${response.status}`)
    return response.body
  }
  const envelope = () => ({ protocolVersion: CURRENT_PROTOCOL_VERSION, requestId: requestId() })
  const validate = async (raw: DeliveryValidationSpec): Promise<DeliveryValidationRecord> => {
    const spec = deliveryValidationSpecSchema.parse(raw)
    const identity = options.transport.status()
    if (identity.state !== 'ready' || !options.validationState) throw new Error('Deterministic Delivery validation requires authenticated durable state.')
    const principalUserId = identity.userId
    const assertCurrent = () => {
      const current = options.transport.status()
      if (current.state !== 'ready' || current.userId !== principalUserId || current.deviceId !== identity.deviceId) {
        throw new Error('Validation Principal changed.')
      }
    }
    const record: DeliveryValidationRecord = { checkId: randomUUID(), spec, specDigest: validationDigest(spec), targetDigest: validationDigest(spec.target),
      principalUserId, status: 'unknown', checkedAt: new Date().toISOString(), detail: 'Frozen; exact bytes have not been checked.' }
    await options.validationState.persistDeliveryValidation(record)
    assertCurrent()
    try {
      const view = await port.read({ deliveryManifestId: spec.target.deliveryManifestId })
      assertCurrent()
      const object = view.manifest.objects.find(item => item.objectId === spec.target.object.objectId)
      if (view.manifest.projectId !== spec.target.projectId || view.manifest.taskId !== spec.target.taskId ||
        view.manifest.manifestDigest !== spec.target.manifestDigest || validationDigest(object ?? null) !== validationDigest(spec.target.object)) {
        throw new Error('Validation target does not match the exact sealed manifest and object.')
      }
      if (object!.byteCount > VALIDATION_MAX_BYTES) throw new Error('Object exceeds the JSON validation limit.')
      const bytes = await port.readObject({ deliveryManifestId: spec.target.deliveryManifestId, objectId: spec.target.object.objectId })
      assertCurrent()
      if (validationDigest(bytes.object) !== validationDigest(spec.target.object)) throw new Error('Sealed object identity changed.')
      Object.assign(record, checkDeliveryJson(spec, bytes.body))
    } catch (error) {
      record.status = 'unknown'
      record.detail = (error instanceof Error ? error.message : 'Validation interrupted.').slice(0, 1000)
    }
    record.checkedAt = new Date().toISOString()
    assertCurrent()
    await options.validationState.persistDeliveryValidation(record)
    return record
  }
  const port: ProjectCoordinatorDeliveryPort = Object.freeze({
    validate,
    read: async (raw, requestOptions) => {
      const input = projectCoordinatorDeliveryReadInputSchema.parse(raw)
      const response = await execute({ ...envelope(), type: 'delivery.get', ...input }, requestOptions)
      if (response.type !== 'rest.delivery' || response.delivery.manifest.deliveryManifestId !== input.deliveryManifestId) {
        throw new Error('Cloud did not return the exact requested Delivery.')
      }
      return deliveryReadViewSchema.parse(response.delivery)
    },
    readObject: async (input, requestOptions) => {
      const response = await execute({ ...envelope(), type: 'delivery.get', deliveryManifestId: input.deliveryManifestId }, requestOptions)
      if (response.type !== 'rest.delivery' || response.delivery.manifest.deliveryManifestId !== input.deliveryManifestId) {
        throw new Error('Cloud did not return the exact sealed Delivery.')
      }
      const manifest = deliveryReadViewSchema.parse(response.delivery).manifest
      const object = manifest.objects.find((item) => item.objectId === input.objectId)
      if (!object) throw new Error('The selected object is not part of this exact sealed Delivery.')
      const bytes = await options.transport.readObject({ request: { projectId: manifest.projectId,
        deliveryManifestId: input.deliveryManifestId, objectId: object.objectId }, expected: object }, requestOptions)
      requestOptions?.signal?.throwIfAborted()
      return { object: bytes.object, body: bytes.body }
    },
    listDrive: async (raw) => {
      const input = projectCoordinatorDriveListInputSchema.parse(raw)
      const response = await execute({ ...envelope(), type: 'delivery.drive.list', ...input })
      if (response.type !== 'rest.delivery.drive' || response.drive.projectId !== input.projectId) {
        throw new Error('Cloud did not return the exact requested Project Drive.')
      }
      return deliveryDriveViewSchema.parse(response.drive)
    },
    decideAdoption: async (raw, idempotencyKey) => {
      const { deliveryValidation, ...input } = projectCoordinatorAdoptionInputSchema.parse(raw)
      if (deliveryValidation) {
        const principal = options.transport.status()
        if (principal.state !== 'ready' || !options.validationState) throw new Error('Deterministic Delivery validation is unavailable.')
        const saved = await options.validationState.readDeliveryValidation(deliveryValidation.specDigest, deliveryValidation.targetDigest, principal.userId)
        if (!saved || saved.specDigest !== validationDigest(saved.spec) || saved.targetDigest !== validationDigest(saved.spec.target) ||
          saved.spec.target.projectId !== input.projectId || saved.spec.target.taskId !== input.taskId ||
          saved.spec.target.deliveryManifestId !== input.deliveryManifestId || saved.status !== 'passed') {
          throw new Error('Deterministic Delivery validation must reference a matching passed frozen check.')
        }
        const current = await validate(saved.spec)
        if (current.status !== 'passed') throw new Error(`Deterministic Delivery validation did not pass: ${current.detail}`)
        const now = options.transport.status()
        if (now.state !== 'ready' || now.userId !== principal.userId || now.deviceId !== principal.deviceId) {
          throw new Error('Adoption Principal changed during independent verification.')
        }
      }
      const response = await options.commands.executeUser({ ...envelope(), type: 'delivery.adoption.record', idempotencyKey, ...input })
      if (response.type !== 'rest.entity') throw new Error('Cloud did not return an Integration Receipt.')
      const receipt = integrationReceiptSchema.parse(response.entity)
      if (receipt.projectId !== input.projectId || receipt.taskId !== input.taskId ||
        receipt.deliveryManifestId !== input.deliveryManifestId || receipt.disposition !== input.disposition ||
        receipt.integrationRevision !== input.integrationRevision || receipt.operationId !== input.operationId) {
        throw new Error('Cloud returned an Integration Receipt for a different decision.')
      }
      return receipt
    },
    requestRevision: async (raw, idempotencyKey) => {
      const input = projectCoordinatorRevisionRequestInputSchema.parse(raw)
      const response = await options.commands.executeUser({ ...envelope(), type: 'delivery.revision.request', idempotencyKey, ...input })
      if (response.type !== 'rest.entity') throw new Error('Cloud did not return a revision request.')
      const { type: _type, ...entity } = response.entity
      const revision = deliveryRevisionRecordSchema.parse(entity)
      if (revision.projectId !== input.projectId || revision.taskId !== input.taskId ||
        revision.deliveryManifestId !== input.deliveryManifestId || revision.instruction !== input.instruction) {
        throw new Error('Cloud returned a different revision request.')
      }
      return revision
    },
    publishResult: async (raw, idempotencyKey) => {
      const input = projectCoordinatorResultPublishInputSchema.parse(raw)
      const response = await options.commands.executeUser({ ...envelope(), type: 'project.result.publish', idempotencyKey, ...input })
      if (response.type !== 'rest.entity') throw new Error('Cloud did not return a Project Result.')
      const result = projectResultSchema.parse(response.entity)
      if (result.integrationReceiptId !== input.integrationReceiptId || result.projectVersion !== input.projectVersion) {
        throw new Error('Cloud returned a different Project Result.')
      }
      return result
    },
    completeProject: async (raw, idempotencyKey) => {
      const { target } = projectCoordinatorCompleteInputSchema.parse(raw)
      const replay = await options.commands.resumeUser(idempotencyKey, (command) => {
        if (command.type !== 'project.final_summary.submit') throw new Error('Completion operation belongs to another command.')
        const { protocolVersion: _version, requestId: _request, type: _type,
          idempotencyKey: _key, ownerApproval: _proof, ...savedTarget } = command
        const replayTarget = completionTargetFromCommand(savedTarget)
        if (projectCompletionTargetDigest(replayTarget) !== projectCompletionTargetDigest(target)) throw new Error('Completion replay targets a different approved version.')
      })
      if (replay) {
        if (replay.response.type === 'rest.error') throw new Error(`Completion failed: ${replay.response.error.code}`)
        return options.workspace.readWorkspace({ projectId: target.projectId })
      }
      const action = options.humanActions.capture({ target })
      const lease = options.humanActions.validate({ target, action })
      const identity = options.transport.status()
      const before = await options.workspace.readWorkspace({ projectId: target.projectId })
      const current = before.projects.find((view) => view.project.projectId === target.projectId)
      if (identity.state !== 'ready' || before.connection.state !== 'ready' ||
        identity.userId !== before.connection.userId || current?.project.ownerUserId !== identity.userId ||
        current.project.revision !== target.expectedProjectRevision ||
        current.project.coordinatorAuthorityEpoch !== target.expectedCoordinatorAuthorityEpoch ||
        current.project.executionAuthorityEpoch !== target.expectedExecutionAuthorityEpoch ||
        ('requirementsDocumentId' in target
          ? current.confirmedRequirements?.requirementsDocumentId !== target.requirementsDocumentId ||
            current.confirmedRequirements.documentRevision !== target.confirmedRequirementsRevision ||
            target.adoptedTaskIds.length !== current.confirmedRequirements.workModules.length ||
            target.adoptedTaskIds.some((taskId) => {
              const task = current.tasks.find(({ task: candidate }) => candidate.taskId === taskId)
              return task?.task.status !== 'completed' || task.delivery?.receipt?.disposition !== 'adopted'
            })
          : current.plan?.plan.projectPlanId !== target.projectPlanId ||
            current.plan.plan.revision !== target.confirmedPlanRevision || current.plan.plan.state !== 'confirmed' ||
            !target.projectResultIds.every((id) => current.deliveryDrive?.projectResults.some((result) => result.projectResultId === id)))) {
        throw new Error('Owner approval no longer matches the exact Project completion baseline.')
      }
      lease.assertCurrent()
      const deviceSignature = await options.signing.signDeviceFact({
        purpose: 'project-completion-approval',
        factDigest: projectCompletionHumanActionFactDigest(target, action),
        factRevision: 'requirementsDocumentId' in target
          ? target.confirmedRequirementsRevision
          : target.confirmedPlanRevision,
        observedAt: action.occurredAt
      }, { purpose: 'project-completion-approval', target, action })
      lease.assertCurrent()
      const ownerApproval = projectCompletionApprovalSchema.parse({ ...action, deviceSignature })
      const response = await options.commands.executeUser({ ...envelope(), type: 'project.final_summary.submit',
        idempotencyKey, ...target, ownerApproval })
      if (response.type !== 'rest.collection') throw new Error('Cloud did not return the completed Project.')
      const after = await options.workspace.readWorkspace({ projectId: target.projectId })
      const completed = after.projects.find((view) => view.project.projectId === target.projectId)
      const summaryMatches = 'requirementsDocumentId' in target
        ? completed?.finalSummary?.type === 'requirements_final_summary' &&
          completed.finalSummary.requirementsDocumentId === target.requirementsDocumentId &&
          completed.finalSummary.confirmedRequirementsRevision === target.confirmedRequirementsRevision &&
          JSON.stringify(completed.finalSummary.adoptedTaskIds) === JSON.stringify(target.adoptedTaskIds)
        : completed?.finalSummary?.type === 'project_result_final_summary' &&
          JSON.stringify(completed.finalSummary.projectResultIds) === JSON.stringify(target.projectResultIds)
      const ownerApprovalMatches = completed?.finalSummary && 'ownerApproval' in completed.finalSummary
        ? completed.finalSummary.ownerApproval.actionId === action.actionId
        : false
      if (completed?.project.status !== 'completed' || !summaryMatches || !ownerApprovalMatches ||
        completed.finalSummary?.summary !== target.summary) {
        throw new Error('Exact Owner-approved completion is not visible in fresh Cloud facts.')
      }
      return after
    }
  })
  return port
}

function completionTargetFromCommand(command: Record<string, unknown>): ProjectCompletionTarget {
  if (command.baselineKind === 'requirements') {
    return projectRequirementsCompletionTargetSchema.parse({
      baselineKind: command.baselineKind, projectId: command.projectId,
      expectedProjectRevision: command.expectedProjectRevision,
      expectedCoordinatorAuthorityEpoch: command.expectedCoordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch,
      requirementsDocumentId: command.requirementsDocumentId,
      confirmedRequirementsRevision: command.confirmedRequirementsRevision,
      adoptedTaskIds: command.adoptedTaskIds, summary: command.summary
    })
  }
  return projectPlanCompletionTargetSchema.parse({
    projectId: command.projectId, expectedProjectRevision: command.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: command.expectedCoordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch,
    projectPlanId: command.projectPlanId, confirmedPlanRevision: command.confirmedPlanRevision,
    projectResultIds: command.projectResultIds, summary: command.summary
  })
}
