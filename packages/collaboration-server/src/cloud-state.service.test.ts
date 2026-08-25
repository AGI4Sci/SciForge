import { createHash, generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  canonicalProjectContentProvisioningAttestationFactualPayloadBytes,
  canonicalProjectContentProvisioningAttestationSignatureBytes,
  canonicalProvisionedMemberSetBytes,
  type CloudStateCommand,
  type ProjectContentProvisioningAttestation,
  type ProjectCreateCommand
} from '@sciforge/collaboration-contracts'
import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import type { AgentActor, HumanEndpointActor, UserActor } from './actor.js'
import { stableDigest } from './crypto.js'
import { CollaborationService } from './service.js'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from './test-fixtures/collaboration-identity.js'

const at = new Date('2026-08-24T08:00:00.000Z')
const now = () => at
const RUNTIME_CAPABILITY_TAGS = ['content.read', 'content.write', 'research.execute']

async function registeredAgent(
  service: CollaborationService,
  user: UserActor,
  deviceId: string,
  label: string
): Promise<AgentActor> {
  const result = await service.registerAgent(user, {
    deviceId,
    displayName: `${label} Agent`,
    nodeType: 'desktop',
    capabilities: RUNTIME_CAPABILITY_TAGS,
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
    idempotencyKey: `idem_agent_register_${label}`
  })
  return {
    kind: 'agent_device',
    actorKey: `agent:${result.agent.agentId}:test`,
    userId: user.userId,
    agentId: result.agent.agentId,
    deviceId,
    credentialId: `credential_${label}`,
    credentialGeneration: result.agent.credentialGeneration,
    assurance: 'device'
  }
}

async function heartbeatReadyAgent(
  service: CollaborationService,
  actor: AgentActor,
  idempotencyKey: string
) {
  return service.heartbeatAgent(actor, {
    expectedRevision: 1,
    connectionStatus: 'online',
    capabilities: RUNTIME_CAPABILITY_TAGS,
    idempotencyKey
  })
}

async function addActiveDeviceForUser(
  repository: FakeCollaborationRepository,
  sourceDeviceId: string,
  userId: string,
  label: string
): Promise<string> {
  const suffix = stableDigest(label).slice(0, 24)
  const deviceId = `dev_${suffix}`
  await repository.transaction(async (tx) => {
    const source = await tx.getDeviceForUpdate(sourceDeviceId)
    if (!source) throw new Error('Source Device was not found.')
    await tx.insertDevice({
      ...source,
      deviceId,
      userId,
      installationId: `ins_${suffix}`,
      displayName: `${label} Device`,
      revision: 1,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString()
    })
  })
  return deviceId
}

async function publishReadyAvailability(
  service: CollaborationService,
  actor: AgentActor,
  label: string
) {
  const heartbeat = await heartbeatReadyAgent(service, actor, `idem_${label}_heartbeat`)
  return service.publishWorkerAvailability(actor, {
    protocolVersion: '1.0',
    type: 'worker.availability.publish',
    requestId: `req_${label}_availability`,
    idempotencyKey: `idem_${label}_availability`,
    agentId: actor.agentId,
    expectedAgentRevision: heartbeat.revision,
    connectionStatus: 'online',
    lastHeartbeatAt: heartbeat.lastSeenAt,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS,
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: at.toISOString()
  })
}

function providerFactCommand(
  actor: UserActor,
  deviceId: string,
  principalId: string,
  idempotencyKey: string
): Extract<CloudStateCommand, { type: 'provider_directory_principal.publish' }> {
  return {
    protocolVersion: '1.0',
    type: 'provider_directory_principal.publish',
    requestId: `req_${idempotencyKey.slice(-16).padStart(16, '0')}`,
    idempotencyKey,
    providerPrincipalFactId: null,
    expectedFactRevision: null,
    deviceId,
    expectedDeviceRevision: 1,
    providerPrincipal: {
      schemaVersion: 1,
      type: 'provider_directory_principal_reference',
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        providerInstanceRef: 'opencontent.run0'
      },
      principalKind: 'user',
      principalId
    },
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'a'.repeat(64),
    readiness: 'ready',
    readinessReason: null,
    observedAt: at.toISOString()
  }
}

function signProvisioningAttestation(
  factual: Omit<ProjectContentProvisioningAttestation,
    'schemaVersion' | 'type' | 'deviceSignature' | 'revision' | 'createdAt' | 'updatedAt'>,
  key: Readonly<{ privateKey: KeyObject }>,
  deviceId: string,
  deviceKeyId: string,
  deviceKeyRevision: number
): ProjectContentProvisioningAttestation {
  const placeholder: ProjectContentProvisioningAttestation = {
    schemaVersion: 1,
    type: 'project_content_provisioning_attestation',
    ...factual,
    deviceSignature: {
      purpose: 'project-content-provisioning-attestation',
      userId: factual.ownerUserId,
      deviceId,
      deviceKeyId,
      deviceKeyRevision,
      signatureAlgorithm: 'Ed25519',
      canonicalPayloadDigest: '0'.repeat(64),
      factRevision: factual.provisioningRevision,
      observedAt: factual.observationCompletedAt,
      issuedAt: factual.observationCompletedAt,
      signature: 'A'.repeat(86)
    },
    revision: 1,
    createdAt: factual.observationCompletedAt,
    updatedAt: factual.observationCompletedAt
  }
  const factualDigest = createHash('sha256')
    .update(canonicalProjectContentProvisioningAttestationFactualPayloadBytes(placeholder))
    .digest('hex')
  const withDigest: ProjectContentProvisioningAttestation = {
    ...placeholder,
    deviceSignature: { ...placeholder.deviceSignature, canonicalPayloadDigest: factualDigest }
  }
  return {
    ...withDigest,
    deviceSignature: {
      ...withDigest.deviceSignature,
      signature: signBytes(
        null,
        canonicalProjectContentProvisioningAttestationSignatureBytes(withDigest),
        key.privateKey
      ).toString('base64url')
    }
  }
}

async function contentRecoveryProjectFixture(suffix: string) {
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now })
  const owner = await seedOidcUserDevice(repository, `${suffix}-owner`, at)
  const worker = await seedOidcUserDevice(repository, `${suffix}-worker`, at)
  const coordinator = await registeredAgent(service, owner.user, owner.deviceId, `${suffix}-owner`)
  const ownerFact = await service.publishProviderDirectoryPrincipalFact(
    owner.user,
    providerFactCommand(owner.user, owner.deviceId, `${suffix}-provider-owner`, `idem_${suffix}_owner_fact`)
  )
  const workerFact = await service.publishProviderDirectoryPrincipalFact(
    worker.user,
    providerFactCommand(worker.user, worker.deviceId, `${suffix}-provider-worker`, `idem_${suffix}_worker_fact`)
  )
  const created = await service.createProject(owner.user, {
    protocolVersion: '1.0',
    type: 'project.create',
    requestId: `req_${suffix}_project`,
    idempotencyKey: `idem_${suffix}_project`,
    displayName: `${suffix} Project`,
    goal: 'Exercise exact Project Content recovery semantics.',
    coordinatorAgentId: coordinator.agentId,
    expectedCoordinatorAgentRevision: 1,
    budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
    content: {
      mode: 'required',
      contentOwnerUserId: owner.userId,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      containerDisplayName: `${suffix} Content`,
      members: [
        {
          userId: owner.userId,
          providerPrincipalFactId: ownerFact.providerPrincipalFactId,
          expectedFactRevision: ownerFact.revision
        },
        {
          userId: worker.userId,
          providerPrincipalFactId: workerFact.providerPrincipalFactId,
          expectedFactRevision: workerFact.revision
        }
      ]
    }
  })
  return { repository, service, owner, worker, coordinator, ownerFact, workerFact, created }
}

async function activeTextOfferFixture(suffix: string) {
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now })
  const owner = await seedOidcUserDevice(repository, `${suffix}-owner`, at)
  const firstWorker = await seedOidcUserDevice(repository, `${suffix}-first-worker`, at)
  const nextCoordinatorDeviceId = await addActiveDeviceForUser(
    repository,
    owner.deviceId,
    owner.userId,
    `${suffix}-next-coordinator`
  )
  const coordinator = await registeredAgent(service, owner.user, owner.deviceId, `${suffix}-owner`)
  const firstWorkerAgent = await registeredAgent(
    service,
    firstWorker.user,
    firstWorker.deviceId,
    `${suffix}-first-worker`
  )
  const nextCoordinatorAgent = await registeredAgent(
    service,
    owner.user,
    nextCoordinatorDeviceId,
    `${suffix}-next-coordinator`
  )
  const publishAvailability = async (actor: AgentActor, idempotencyKey: string) => (
    service.publishWorkerAvailability(actor, {
      protocolVersion: '1.0',
      type: 'worker.availability.publish',
      requestId: `req_${idempotencyKey}`,
      idempotencyKey,
      agentId: actor.agentId,
      expectedAgentRevision: (await heartbeatReadyAgent(
        service,
        actor,
        `${idempotencyKey}_heartbeat`
      )).revision,
      connectionStatus: 'online',
      lastHeartbeatAt: at.toISOString(),
      runtimeReadiness: 'ready',
      runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS,
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: at.toISOString()
    })
  )
  const firstAvailability = await publishAvailability(
    firstWorkerAgent,
    `idem_${suffix}_first_availability`
  )
  const nextAvailability = await publishAvailability(
    nextCoordinatorAgent,
    `idem_${suffix}_next_availability`
  )
  const created = await service.createProject(owner.user, {
    protocolVersion: '1.0',
    type: 'project.create',
    requestId: `req_${suffix}_project`,
    idempotencyKey: `idem_${suffix}_project`,
    displayName: `${suffix} workflow`,
    goal: 'Exercise exact workflow authority and execution fencing.',
    coordinatorAgentId: coordinator.agentId,
    expectedCoordinatorAgentRevision: 1,
    budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 2 },
    content: {
      mode: 'none',
      members: [
        { userId: owner.userId },
        { userId: firstWorker.userId }
      ]
    }
  })
  const runtimeProvenance = {
    runtimeId: `runtime_${suffix}_coordinator`,
    modelId: null,
    generatedByCoordinatorAgentId: coordinator.agentId,
    generatedAt: at.toISOString()
  }
  const tasks = [{
    planItemId: 'item_workflow_task',
    title: 'Exercise workflow authority',
    objective: 'Produce one bounded result through the exact current execution.',
    completionCriteria: ['The current Coordinator can review the immutable result.'],
    dependencyPlanItemIds: [],
    requiredCapabilityTags: ['research.execute'],
    fileIntent: null
  }]
  const planFacts = {
    projectId: created.project.projectId,
    expectedProjectRevision: created.project.revision,
    expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks,
    rationale: 'One exact Worker execution is sufficient.',
    runtimeProvenance
  }
  const submittedPlan = await service.submitProjectPlan(coordinator, {
    protocolVersion: '1.0',
    type: 'project.plan.submit',
    requestId: `req_${suffix}_plan_submit`,
    idempotencyKey: `idem_${suffix}_plan_submit`,
    ...planFacts,
    planDigest: stableDigest(planFacts)
  })
  const confirmedPlan = await service.confirmProjectPlan(owner.user, {
    protocolVersion: '1.0',
    type: 'project.plan.confirm',
    requestId: `req_${suffix}_plan_confirm`,
    idempotencyKey: `idem_${suffix}_plan_confirm`,
    projectId: created.project.projectId,
    projectPlanId: submittedPlan.projectPlanId,
    expectedProjectRevision: created.project.revision + 1,
    expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
    expectedPlanRevision: submittedPlan.revision,
    planDigest: submittedPlan.planDigest
  })
  const activeProject = await service.transitionProject(owner.user, {
    protocolVersion: '1.0',
    type: 'project.transition',
    requestId: `req_${suffix}_activate`,
    idempotencyKey: `idem_${suffix}_activate`,
    projectId: created.project.projectId,
    expectedRevision: created.project.revision + 2,
    expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: created.project.executionAuthorityEpoch,
    status: 'active'
  })
  const offered = await service.createTaskOffer(coordinator, {
    protocolVersion: '1.0',
    type: 'task.offer.create',
    requestId: `req_${suffix}_offer`,
    idempotencyKey: `idem_${suffix}_offer`,
    projectId: activeProject.projectId,
    expectedProjectRevision: activeProject.revision,
    expectedCoordinatorAuthorityEpoch: activeProject.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: activeProject.executionAuthorityEpoch,
    projectPlanId: confirmedPlan.projectPlanId,
    expectedPlanRevision: confirmedPlan.revision,
    planItemId: tasks[0]!.planItemId,
    assigneeAgentId: firstWorkerAgent.agentId,
    expectedAvailabilityRevision: firstAvailability.revision,
    offerExpiresAt: new Date(at.getTime() + 60_000).toISOString()
  })
  return {
    service,
    owner,
    firstWorker,
    coordinator,
    firstWorkerAgent,
    nextCoordinatorAgent,
    nextAvailability,
    confirmedPlan,
    activeProject,
    offered
  }
}

async function manualRecoveryFileOfferFixture(suffix: string) {
  const fixture = await contentRecoveryProjectFixture(suffix)
  const signing = generateKeyPairSync('ed25519')
  const publicJwk = signing.publicKey.export({ format: 'jwk' })
  const deviceKeyId = `${suffix}-owner-device-key`
  await fixture.repository.transaction(async (tx) => {
    const device = (await tx.getDeviceForUpdate(fixture.owner.deviceId))!
    await tx.updateDevice({
      ...device,
      publicKeyJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: deviceKeyId,
        x: publicJwk.x!
      },
      revision: device.revision + 1,
      updatedAt: at.toISOString()
    }, device.revision)
  })
  const workerAgent = await registeredAgent(
    fixture.service,
    fixture.worker.user,
    fixture.worker.deviceId,
    `${suffix}-worker`
  )
  const heartbeat = await heartbeatReadyAgent(
    fixture.service,
    workerAgent,
    `idem_${suffix}_worker_heartbeat`
  )
  const availability = await fixture.service.publishWorkerAvailability(workerAgent, {
    protocolVersion: '1.0',
    type: 'worker.availability.publish',
    requestId: `req_${suffix}_worker_availability`,
    idempotencyKey: `idem_${suffix}_worker_availability`,
    agentId: workerAgent.agentId,
    expectedAgentRevision: heartbeat.revision,
    connectionStatus: 'online',
    lastHeartbeatAt: heartbeat.lastSeenAt,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS,
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: at.toISOString()
  })

  const intent = fixture.created.provisioningIntent!
  const provisioningRequestDigest = stableDigest({ suffix, operation: 'create-root' })
  const preparedProvisioning = await fixture.service.prepareExternalOperation(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.prepare',
    requestId: `req_${suffix}_prepare_root`,
    idempotencyKey: `idem_${suffix}_prepare_root`,
    scope: 'project_provisioning',
    projectId: fixture.created.project.projectId,
    taskId: null,
    executionId: null,
    preparedTaskRevision: null,
    preparedExecutionRevision: null,
    provisioningIntentId: intent.provisioningIntentId,
    provisioningRevision: intent.provisioningRevision,
    logicalInvocationId: `${suffix}.create-root`,
    operation: 'create_shared_container',
    requestDigest: provisioningRequestDigest
  })
  const dispatchedProvisioning = await fixture.service.dispatchExternalOperation(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.dispatch',
    requestId: `req_${suffix}_dispatch_root`,
    idempotencyKey: `idem_${suffix}_dispatch_root`,
    journalEntryId: preparedProvisioning.contentRecoveryJournalEntryId,
    expectedJournalRevision: preparedProvisioning.revision
  })
  const provisioningReceiptDigest = stableDigest({ suffix, receipt: 'create-root' })
  const provisioningObservationDigest = stableDigest({ suffix, observation: 'create-root' })
  const observedProvisioning = await fixture.service.observeExternalOperation(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.observe',
    requestId: `req_${suffix}_observe_root`,
    idempotencyKey: `idem_${suffix}_observe_root`,
    journalEntryId: dispatchedProvisioning.contentRecoveryJournalEntryId,
    expectedJournalRevision: dispatchedProvisioning.revision,
    outcome: 'observed_success',
    receiptDigest: provisioningReceiptDigest,
    observationDigest: provisioningObservationDigest,
    safeFailureCode: null
  })
  const rootLocator = {
    contractVersion: 1 as const,
    kind: 'content-space.container-reference' as const,
    authority: fixture.ownerFact.providerPrincipal.providerInstance.providerInstanceRef,
    identity: { containerId: `${suffix}-root` }
  }
  const memberObservations = intent.desiredMembers.map((member, index) => ({
    userId: member.userId,
    providerPrincipalFactId: member.providerPrincipalFactId,
    snapshottedFactRevision: member.snapshottedFactRevision,
    principal: member.principal,
    presence: 'present' as const,
    observationDigest: stableDigest({ suffix, member: index }),
    observedAt: at.toISOString()
  }))
  const attestation = signProvisioningAttestation({
    format: 'sciforge.project-content-provisioning-attestation.v1',
    provisioningAttestationId: `pca_${suffix.replaceAll('_', '')}01`,
    projectId: fixture.created.project.projectId,
    provisioningIntentId: intent.provisioningIntentId,
    provisioningRevision: intent.provisioningRevision,
    ownerUserId: fixture.owner.userId,
    principalIdentityRevision: fixture.ownerFact.principalIdentityRevision,
    providerBindingAttestationDigest: fixture.ownerFact.providerBindingAttestationDigest,
    providerInstance: fixture.ownerFact.providerPrincipal.providerInstance,
    rootLocator,
    rootLocatorDigest: stableDigest(rootLocator),
    observedOperations: [{
      operationId: preparedProvisioning.logicalInvocationId,
      operationRevision: observedProvisioning.journal.revision,
      kind: 'create_shared_container',
      subjectPrincipal: null,
      requestDigest: provisioningRequestDigest,
      receiptDigest: provisioningReceiptDigest,
      outcome: 'observed_success',
      safeFailureCode: null,
      observedAt: at.toISOString()
    }],
    memberObservations,
    memberSetDigest: createHash('sha256')
      .update(canonicalProvisionedMemberSetBytes(memberObservations))
      .digest('hex'),
    observationStartedAt: at.toISOString(),
    observationCompletedAt: at.toISOString()
  }, signing, fixture.owner.deviceId, deviceKeyId, 2)
  const activatedContent = await fixture.service.attestProjectContent(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'project.content.attest',
    requestId: `req_${suffix}_attest_root`,
    idempotencyKey: `idem_${suffix}_attest_root`,
    projectId: fixture.created.project.projectId,
    expectedProjectRevision: fixture.created.project.revision,
    expectedProvisioningRevision: intent.provisioningRevision,
    attestation
  })

  const fileIntent = {
    schemaVersion: 1 as const,
    bindingRevision: activatedContent.binding.revision,
    inputs: [],
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
      fileName: `${suffix}.recovery-1.md`,
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
  const tasks = [{
    planItemId: 'item_recovery_output',
    title: 'Recover one uncertain output',
    objective: 'Link only a freshly observed exact Provider output.',
    completionCriteria: ['The current execution submits one exact observed output.'],
    dependencyPlanItemIds: [],
    requiredCapabilityTags: ['research.execute'],
    fileIntent
  }]
  const planFacts = {
    projectId: fixture.created.project.projectId,
    expectedProjectRevision: activatedContent.project.revision,
    expectedCoordinatorAuthorityEpoch: activatedContent.project.coordinatorAuthorityEpoch,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks,
    rationale: 'Exercise one exact outcome-unknown recovery.',
    runtimeProvenance: {
      runtimeId: `runtime_${suffix}_coordinator`,
      modelId: null,
      generatedByCoordinatorAgentId: fixture.created.project.coordinatorAgentId,
      generatedAt: at.toISOString()
    }
  }
  const plan = await fixture.service.submitProjectPlan(fixture.coordinator, {
    protocolVersion: '1.0',
    type: 'project.plan.submit',
    requestId: `req_${suffix}_plan_submit`,
    idempotencyKey: `idem_${suffix}_plan_submit`,
    ...planFacts,
    planDigest: stableDigest(planFacts)
  })
  const projectAfterPlan = (await fixture.repository.getProject(fixture.created.project.projectId))!
  const confirmedPlan = await fixture.service.confirmProjectPlan(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'project.plan.confirm',
    requestId: `req_${suffix}_plan_confirm`,
    idempotencyKey: `idem_${suffix}_plan_confirm`,
    projectId: projectAfterPlan.projectId,
    projectPlanId: plan.projectPlanId,
    expectedProjectRevision: projectAfterPlan.revision,
    expectedCoordinatorAuthorityEpoch: projectAfterPlan.coordinatorAuthorityEpoch,
    expectedPlanRevision: plan.revision,
    planDigest: plan.planDigest
  })
  const projectAfterConfirmation = (await fixture.repository.getProject(projectAfterPlan.projectId))!
  const activeProject = await fixture.service.transitionProject(fixture.owner.user, {
    protocolVersion: '1.0',
    type: 'project.transition',
    requestId: `req_${suffix}_activate`,
    idempotencyKey: `idem_${suffix}_activate`,
    projectId: projectAfterConfirmation.projectId,
    expectedRevision: projectAfterConfirmation.revision,
    expectedCoordinatorAuthorityEpoch: projectAfterConfirmation.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectAfterConfirmation.executionAuthorityEpoch,
    status: 'active'
  })
  const offered = await fixture.service.createTaskOffer(fixture.coordinator, {
    protocolVersion: '1.0',
    type: 'task.offer.create',
    requestId: `req_${suffix}_offer`,
    idempotencyKey: `idem_${suffix}_offer`,
    projectId: activeProject.projectId,
    expectedProjectRevision: activeProject.revision,
    expectedCoordinatorAuthorityEpoch: activeProject.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: activeProject.executionAuthorityEpoch,
    projectPlanId: confirmedPlan.projectPlanId,
    expectedPlanRevision: confirmedPlan.revision,
    planItemId: tasks[0]!.planItemId,
    assigneeAgentId: workerAgent.agentId,
    expectedAvailabilityRevision: availability.revision,
    offerExpiresAt: new Date(at.getTime() + 60_000).toISOString()
  })
  const accepted = await fixture.service.acceptTaskOffer(workerAgent, {
    protocolVersion: '1.0',
    type: 'task.offer.accept',
    requestId: `req_${suffix}_accept`,
    idempotencyKey: `idem_${suffix}_accept`,
    taskOfferId: offered.offer.taskOfferId,
    taskId: offered.task.taskId,
    executionId: offered.execution.executionId,
    expectedTaskRevision: offered.task.revision,
    expectedExecutionRevision: offered.execution.revision,
    expectedOfferRevision: offered.offer.revision
  })
  const running = await fixture.service.startTaskExecution(workerAgent, {
    protocolVersion: '1.0',
    type: 'task.execution.start',
    requestId: `req_${suffix}_start`,
    idempotencyKey: `idem_${suffix}_start`,
    taskId: accepted.task.taskId,
    executionId: accepted.execution.executionId,
    expectedTaskRevision: accepted.task.revision,
    expectedExecutionRevision: accepted.execution.revision,
    startedAt: at.toISOString()
  })
  const requestDigest = stableDigest({
    operation: 'upload_new',
    rootLocator,
    name: fileIntent.output.fileName,
    projectId: activeProject.projectId,
    taskId: running.task.taskId,
    executionId: running.execution.executionId
  })
  const logicalInvocationId = `upload.${running.execution.executionId}.output`
  const prepared = await fixture.service.prepareExternalOperation(workerAgent, {
    protocolVersion: '1.0',
    type: 'external_operation.prepare',
    requestId: `req_${suffix}_prepare_upload`,
    idempotencyKey: `idem_${suffix}_prepare_upload`,
    scope: 'task_content_transfer',
    projectId: activeProject.projectId,
    taskId: running.task.taskId,
    executionId: running.execution.executionId,
    preparedTaskRevision: running.task.revision,
    preparedExecutionRevision: running.execution.revision,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId,
    operation: 'upload_new',
    requestDigest
  })
  const dispatched = await fixture.service.dispatchExternalOperation(workerAgent, {
    protocolVersion: '1.0',
    type: 'external_operation.dispatch',
    requestId: `req_${suffix}_dispatch_upload`,
    idempotencyKey: `idem_${suffix}_dispatch_upload`,
    journalEntryId: prepared.contentRecoveryJournalEntryId,
    expectedJournalRevision: prepared.revision
  })
  const unknown = await fixture.service.observeExternalOperation(workerAgent, {
    protocolVersion: '1.0',
    type: 'external_operation.observe',
    requestId: `req_${suffix}_unknown_upload`,
    idempotencyKey: `idem_${suffix}_unknown_upload`,
    journalEntryId: dispatched.contentRecoveryJournalEntryId,
    expectedJournalRevision: dispatched.revision,
    outcome: 'outcome_unknown',
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: 'provider_outcome_unknown'
  })
  return {
    ...fixture,
    workerAgent,
    availability,
    activeProject,
    rootLocator,
    fileIntent,
    requestDigest,
    logicalInvocationId,
    unknown
  }
}

describe('vNext Cloud application service', () => {
  it('publishes one global exact User/ACTIVE Device Provider fact with CAS', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'owner', at)
    const command = providerFactCommand(
      owner.user,
      owner.deviceId,
      'provider-owner',
      'idem_provider_fact_owner_create'
    )

    const created = await service.publishProviderDirectoryPrincipalFact(owner.user, command)
    expect(created.userId).toBe(owner.userId)
    expect(created.publishedByDeviceId).toBe(owner.deviceId)
    expect(created.revision).toBe(1)

    await expect(service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...command,
      idempotencyKey: 'idem_provider_fact_owner_duplicate_slot'
    })).rejects.toMatchObject({ code: 'revision_conflict' })

    const other = await seedOidcUserDevice(repository, 'other', at)
    await expect(service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...command,
      deviceId: other.deviceId,
      idempotencyKey: 'idem_provider_fact_cross_user_device'
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('binds Worker availability to the exact current Agent heartbeat revision and Runtime tags', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const worker = await seedOidcUserDevice(repository, 'availability-worker', at)
    const workerAgent = await registeredAgent(
      service,
      worker.user,
      worker.deviceId,
      'availability-worker'
    )
    const heartbeat = await heartbeatReadyAgent(
      service,
      workerAgent,
      'idem_availability_worker_heartbeat'
    )
    const command = {
      protocolVersion: '1.0' as const,
      type: 'worker.availability.publish' as const,
      requestId: 'req_availability_worker_publish',
      idempotencyKey: 'idem_availability_worker_publish',
      agentId: workerAgent.agentId,
      expectedAgentRevision: heartbeat.revision,
      connectionStatus: 'online' as const,
      lastHeartbeatAt: heartbeat.lastSeenAt ?? null,
      runtimeReadiness: 'ready' as const,
      runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS,
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: at.toISOString()
    }

    await expect(service.publishWorkerAvailability(workerAgent, {
      ...command,
      requestId: 'req_availability_forged_tags',
      idempotencyKey: 'idem_availability_forged_tags',
      runtimeCapabilityTags: ['forged.runtime.tag']
    })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(service.publishWorkerAvailability(workerAgent, {
      ...command,
      requestId: 'req_availability_forged_heartbeat',
      idempotencyKey: 'idem_availability_forged_heartbeat',
      lastHeartbeatAt: new Date(at.getTime() - 1_000).toISOString()
    })).rejects.toMatchObject({ code: 'validation_failed' })

    await expect(service.publishWorkerAvailability(workerAgent, command)).resolves.toMatchObject({
      agentId: workerAgent.agentId,
      connectionStatus: 'online',
      lastHeartbeatAt: heartbeat.lastSeenAt,
      runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS,
      activeTaskCount: 0,
      revision: 1
    })
  })

  it('joins current Provider identity and Project readiness without duplicating them into global availability', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'availability-owner', at)
    const worker = await seedOidcUserDevice(repository, 'availability-project-worker', at)
    const coordinator = await registeredAgent(
      service,
      owner.user,
      owner.deviceId,
      'availability-owner'
    )
    const workerAgent = await registeredAgent(
      service,
      worker.user,
      worker.deviceId,
      'availability-project-worker'
    )
    const ownerFact = await service.publishProviderDirectoryPrincipalFact(
      owner.user,
      providerFactCommand(
        owner.user,
        owner.deviceId,
        'availability-provider-owner',
        'idem_availability_provider_owner'
      )
    )
    const workerFact = await service.publishProviderDirectoryPrincipalFact(
      worker.user,
      providerFactCommand(
        worker.user,
        worker.deviceId,
        'availability-provider-worker',
        'idem_availability_provider_worker'
      )
    )
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_availability_project',
      idempotencyKey: 'idem_availability_project', displayName: 'Availability Project',
      goal: 'Compose independent Worker and Content readiness facts.',
      coordinatorAgentId: coordinator.agentId, expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'required', contentOwnerUserId: owner.userId,
        providerInstance: ownerFact.providerPrincipal.providerInstance,
        containerDisplayName: 'Availability Project Content', members: [
          { userId: owner.userId, providerPrincipalFactId: ownerFact.providerPrincipalFactId,
            expectedFactRevision: ownerFact.revision },
          { userId: worker.userId, providerPrincipalFactId: workerFact.providerPrincipalFactId,
            expectedFactRevision: workerFact.revision }
        ] }
    })
    const heartbeat = await heartbeatReadyAgent(
      service,
      workerAgent,
      'idem_availability_project_worker_heartbeat'
    )
    await service.publishWorkerAvailability(workerAgent, {
      protocolVersion: '1.0', type: 'worker.availability.publish',
      requestId: 'req_availability_project_worker',
      idempotencyKey: 'idem_availability_project_worker', agentId: workerAgent.agentId,
      expectedAgentRevision: heartbeat.revision, connectionStatus: 'online',
      lastHeartbeatAt: heartbeat.lastSeenAt ?? null, runtimeReadiness: 'ready',
      runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS, acceptsNewOffers: true,
      activeTaskCount: 0, observedAt: at.toISOString()
    })

    const matching = await service.listWorkerAvailability(owner.user, {
      protocolVersion: '1.0', type: 'worker.availability.list',
      requestId: 'req_availability_project_list_match', projectId: created.project.projectId,
      limit: 10
    })
    expect(matching.items).toEqual([expect.objectContaining({
      agentId: workerAgent.agentId,
      runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS
    })])
    expect(matching.projectItems).toEqual([expect.objectContaining({
      availability: expect.objectContaining({ agentId: workerAgent.agentId }),
      membership: expect.objectContaining({ userId: worker.userId, state: 'active' }),
      providerPrincipalFact: expect.objectContaining({
        providerPrincipalFactId: workerFact.providerPrincipalFactId,
        revision: workerFact.revision
      }),
      providerPrincipalSnapshotStatus: 'match',
      contentReadiness: expect.objectContaining({
        userId: worker.userId,
        state: 'pending',
        providerPrincipalFactId: workerFact.providerPrincipalFactId,
        snapshottedFactRevision: workerFact.revision
      })
    })])

    await service.publishProviderDirectoryPrincipalFact(worker.user, {
      ...providerFactCommand(
        worker.user,
        worker.deviceId,
        'availability-provider-worker',
        'idem_availability_provider_worker_revision_2'
      ),
      providerPrincipalFactId: workerFact.providerPrincipalFactId,
      expectedFactRevision: workerFact.revision,
      principalIdentityRevision: 2
    })
    const stale = await service.listWorkerAvailability(owner.user, {
      protocolVersion: '1.0', type: 'worker.availability.list',
      requestId: 'req_availability_project_list_stale', projectId: created.project.projectId,
      limit: 10
    })
    expect(stale.projectItems).toEqual([expect.objectContaining({
      providerPrincipalFact: expect.objectContaining({ revision: 2 }),
      providerPrincipalSnapshotStatus: 'stale',
      contentReadiness: expect.objectContaining({ snapshottedFactRevision: 1 })
    })])
  })

  it('atomically derives Owner and snapshots exact ready facts into a paused Project', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'owner-project', at)
    const worker = await seedOidcUserDevice(repository, 'worker-project', at)
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'owner-project')
    await registeredAgent(service, worker.user, worker.deviceId, 'worker-project')
    const ownerFact = await service.publishProviderDirectoryPrincipalFact(owner.user, providerFactCommand(
      owner.user,
      owner.deviceId,
      'provider-owner-project',
      'idem_provider_fact_owner_project'
    ))
    const workerFact = await service.publishProviderDirectoryPrincipalFact(worker.user, providerFactCommand(
      worker.user,
      worker.deviceId,
      'provider-worker-project',
      'idem_provider_fact_worker_project'
    ))
    const command: ProjectCreateCommand = {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: 'req_project_create_001',
      idempotencyKey: 'idem_project_create_vnext',
      displayName: 'Multi-user design review',
      goal: 'Produce reviewed meeting artifacts.',
      coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: {
        maxTasks: 20,
        maxTasksPerRound: 10,
        maxTaskRetries: 2,
        maxCoordinationRounds: 5
      },
      content: {
        mode: 'required',
        contentOwnerUserId: owner.userId,
        providerInstance: ownerFact.providerPrincipal.providerInstance,
        containerDisplayName: 'Multi-user design review',
        members: [
          {
            userId: owner.userId,
            providerPrincipalFactId: ownerFact.providerPrincipalFactId,
            expectedFactRevision: ownerFact.revision
          },
          {
            userId: worker.userId,
            providerPrincipalFactId: workerFact.providerPrincipalFactId,
            expectedFactRevision: workerFact.revision
          }
        ]
      }
    }

    const created = await service.createProject(owner.user, command)
    expect(created.project).toMatchObject({
      ownerUserId: owner.userId,
      coordinatorAgentId: coordinator.agentId,
      status: 'paused',
      contentMode: 'required',
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1
    })
    expect(created.memberships).toHaveLength(2)
    expect(created.memberships.every((membership) => membership.state === 'active')).toBe(true)
    expect(created.provisioningIntent?.desiredMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: owner.userId,
        providerPrincipalFactId: ownerFact.providerPrincipalFactId,
        snapshottedFactRevision: ownerFact.revision
      }),
      expect.objectContaining({
        userId: worker.userId,
        providerPrincipalFactId: workerFact.providerPrincipalFactId,
        snapshottedFactRevision: workerFact.revision
      })
    ]))
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toHaveLength(2)
    expect(await repository.listTaskAuthorities(created.project.projectId)).toHaveLength(4)
  })

  it('lets only the Owner abandon one exact outcome-unknown Project provisioning tuple', async () => {
    const { repository, service, owner, worker, created } =
      await contentRecoveryProjectFixture('recovery-provisioning')
    const intent = created.provisioningIntent!
    const prepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_recovery_prepare_01',
      idempotencyKey: 'idem_recovery_prepare_01', scope: 'project_provisioning',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: intent.provisioningIntentId,
      provisioningRevision: intent.provisioningRevision,
      logicalInvocationId: 'recovery-create-root-01', operation: 'create_shared_container',
      requestDigest: 'b'.repeat(64)
    })
    const dispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_recovery_dispatch_01',
      idempotencyKey: 'idem_recovery_dispatch_01', journalEntryId: prepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: prepared.revision
    })
    const observed = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_recovery_unknown_01',
      idempotencyKey: 'idem_recovery_unknown_01', journalEntryId: dispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: dispatched.revision, outcome: 'outcome_unknown',
      receiptDigest: null, observationDigest: null, safeFailureCode: 'provider_outcome_unknown'
    })
    const action = observed.recoveryAction!
    const recoveringIntent = observed.provisioningIntent!
    expect(action).toMatchObject({ audience: 'owner', action: 'resume_provisioning',
      status: 'available', requiresFreshObservation: true })
    expect(recoveringIntent.state).toBe('manual_recovery_required')
    const readinessBefore = await repository.listProjectContentReadiness(created.project.projectId)

    const command = {
      protocolVersion: '1.0' as const,
      type: 'project.content.recovery.abandon' as const,
      requestId: 'req_recovery_abandon_01',
      idempotencyKey: 'idem_recovery_abandon_01',
      projectId: created.project.projectId,
      provisioningIntentId: recoveringIntent.provisioningIntentId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: observed.journal.contentRecoveryJournalEntryId,
      expectedProjectRevision: created.project.revision,
      expectedProvisioningRevision: recoveringIntent.provisioningRevision,
      expectedProvisioningIntentRevision: recoveringIntent.revision,
      expectedRecoveryActionRevision: action.revision,
      expectedJournalRevision: observed.journal.revision,
      reason: 'Stop this exact uncertain provisioning attempt.'
    }
    await expect(service.abandonProjectContentRecovery(worker.user, {
      ...command,
      requestId: 'req_recovery_non_owner',
      idempotencyKey: 'idem_recovery_non_owner'
    })).rejects.toMatchObject({ code: 'permission_denied' })

    const abandoned = await service.abandonProjectContentRecovery(owner.user, command)
    expect(abandoned.project.revision).toBe(created.project.revision)
    expect(abandoned.journal).toMatchObject({ state: 'abandoned', safeFailureCode: null,
      revision: observed.journal.revision + 1, resolvedAt: at.toISOString() })
    expect(abandoned.recoveryAction).toMatchObject({ status: 'completed',
      revision: action.revision + 1, completedAt: at.toISOString() })
    expect(abandoned.provisioningIntent).toMatchObject({ state: 'cancelled',
      revision: recoveringIntent.revision + 1 })
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toEqual(readinessBefore)
    expect(await repository.getProjectContentSpaceBinding(created.project.projectId)).toBeNull()
    await expect(service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_recovery_after_abandon',
      idempotencyKey: 'idem_recovery_after_abandon', journalEntryId: abandoned.journal.contentRecoveryJournalEntryId,
      expectedJournalRevision: abandoned.journal.revision, outcome: 'observed_success',
      receiptDigest: 'c'.repeat(64), observationDigest: 'd'.repeat(64), safeFailureCode: null
    })).rejects.toMatchObject({ code: 'invalid_state_transition' })
  })

  it('abandons observed-failure membership recovery without rolling back removal fences or factual state', async () => {
    const { repository, service, owner, worker, created } =
      await contentRecoveryProjectFixture('recovery-membership')
    const membership = created.memberships.find(({ userId }) => userId === worker.userId)!
    const removal = await service.removeProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.remove', requestId: 'req_recovery_member_remove',
      idempotencyKey: 'idem_recovery_member_remove', projectId: created.project.projectId,
      projectMembershipId: membership.projectMembershipId,
      expectedProjectRevision: created.project.revision, expectedMembershipRevision: membership.revision
    })
    const intent = removal.provisioningIntent!
    expect(removal.membership.state).toBe('membership_removal_pending')
    expect(removal.taskAuthorities.every(({ state, reason }) =>
      state === 'fenced' && reason === 'membership_removal_pending')).toBe(true)
    const prepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_recovery_member_prepare',
      idempotencyKey: 'idem_recovery_member_prepare', scope: 'project_membership',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: intent.provisioningIntentId, provisioningRevision: intent.provisioningRevision,
      logicalInvocationId: 'recovery-remove-member-01', operation: 'remove_member',
      requestDigest: 'e'.repeat(64)
    })
    const dispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_recovery_member_dispatch',
      idempotencyKey: 'idem_recovery_member_dispatch', journalEntryId: prepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: prepared.revision
    })
    const observed = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_recovery_member_failure',
      idempotencyKey: 'idem_recovery_member_failure', journalEntryId: dispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: dispatched.revision, outcome: 'observed_failure',
      receiptDigest: null, observationDigest: null, safeFailureCode: 'provider_member_remove_failed'
    })
    const action = observed.recoveryAction!
    const recoveringIntent = observed.provisioningIntent!
    expect(action).toMatchObject({ audience: 'owner', action: 'reconcile_provider_membership',
      status: 'available', requiresFreshObservation: false })
    const readinessBefore = await repository.listProjectContentReadiness(created.project.projectId)

    const abandoned = await service.abandonProjectContentRecovery(owner.user, {
      protocolVersion: '1.0', type: 'project.content.recovery.abandon', requestId: 'req_recovery_member_abandon',
      idempotencyKey: 'idem_recovery_member_abandon', projectId: created.project.projectId,
      provisioningIntentId: recoveringIntent.provisioningIntentId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: observed.journal.contentRecoveryJournalEntryId,
      expectedProjectRevision: removal.project.revision,
      expectedProvisioningRevision: recoveringIntent.provisioningRevision,
      expectedProvisioningIntentRevision: recoveringIntent.revision,
      expectedRecoveryActionRevision: action.revision,
      expectedJournalRevision: observed.journal.revision,
      reason: 'Stop this failed membership reconciliation attempt.'
    })
    expect(abandoned.journal).toEqual(observed.journal)
    expect(abandoned.recoveryAction.status).toBe('completed')
    expect(abandoned.provisioningIntent.state).toBe('cancelled')
    expect(await repository.getProjectMember(created.project.projectId, worker.userId))
      .toMatchObject({ state: 'membership_removal_pending', revision: removal.membership.revision })
    expect(await repository.listTaskAuthoritiesForUser(created.project.projectId, worker.userId))
      .toEqual(removal.taskAuthorities)
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toEqual(readinessBefore)
    expect(await repository.getProjectContentSpaceBinding(created.project.projectId)).toBeNull()
  })

  it('links only a fresh exact Task output observation and then accepts the same Worker execution result', async () => {
    const fixture = await manualRecoveryFileOfferFixture('task_recovery_link')
    const task = fixture.unknown.task!
    const execution = fixture.unknown.execution!
    const action = fixture.unknown.recoveryAction!
    const journal = fixture.unknown.journal
    const locator = {
      contractVersion: 1 as const,
      kind: 'content-space.file-reference' as const,
      authority: fixture.rootLocator.authority,
      identity: { fileId: 'recovered-output-linked-by-observation' }
    }
    const observation = {
      schemaVersion: 1 as const,
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      assignmentTaskRevision: execution.fence.assignmentTaskRevision,
      bindingRevision: execution.fence.bindingRevision!,
      logicalInvocationId: fixture.logicalInvocationId,
      requestDigest: fixture.requestDigest,
      rootLocator: fixture.rootLocator,
      rootLocatorDigest: stableDigest(fixture.rootLocator),
      expectedName: fixture.fileIntent.output.fileName,
      locator,
      locatorDigest: stableDigest(locator),
      contentObservationReceiptDigest: '4'.repeat(64),
      observationDigest: '5'.repeat(64),
      providerObservationDigest: '6'.repeat(64),
      observedAt: at.toISOString()
    }
    const command = {
      protocolVersion: '1.0' as const,
      type: 'task.recovery.link_observed_output' as const,
      requestId: 'req_task_recovery_link_exact',
      idempotencyKey: 'idem_task_recovery_link_exact',
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: journal.contentRecoveryJournalEntryId,
      expectedTaskRevision: task.revision,
      expectedExecutionRevision: execution.revision,
      expectedRecoveryActionRevision: action.revision,
      expectedCoordinatorAuthorityEpoch: fixture.activeProject.coordinatorAuthorityEpoch,
      observation
    }

    await expect(fixture.service.linkObservedRecoveryOutput(fixture.owner.user, {
      ...command,
      requestId: 'req_task_recovery_link_wrong_digest',
      idempotencyKey: 'idem_task_recovery_link_wrong_digest',
      observation: { ...observation, requestDigest: '7'.repeat(64) }
    })).rejects.toMatchObject({ code: 'validation_failed' })

    const linked = await fixture.service.linkObservedRecoveryOutput(fixture.owner.user, command)
    const output = {
      executionId: execution.executionId,
      assignmentTaskRevision: observation.assignmentTaskRevision,
      locator,
      locatorDigest: observation.locatorDigest,
      rootLocatorDigest: observation.rootLocatorDigest,
      bindingRevision: observation.bindingRevision,
      transferReceiptDigest: observation.contentObservationReceiptDigest,
      observationDigest: observation.observationDigest,
      preflightObservationDigest: observation.providerObservationDigest
    }
    expect(linked).toMatchObject({
      task: { status: 'manual_recovery_required', revision: task.revision },
      execution: { state: 'manual_recovery_required', revision: execution.revision },
      journal: {
        state: 'observed_success',
        receiptDigest: observation.contentObservationReceiptDigest,
        observationDigest: observation.observationDigest,
        revision: journal.revision + 1
      },
      recoveryAction: { status: 'completed', revision: action.revision + 1 },
      resource: {
        role: 'output-file',
        locator,
        locatorDigest: observation.locatorDigest,
        status: 'available'
      }
    })
    const workerInbox = await fixture.repository.pullInbox(
      { kind: 'agent', id: fixture.workerAgent.agentId },
      0,
      200,
      at.toISOString()
    )
    expect(workerInbox.map(({ payload }) => payload)).toContainEqual(expect.objectContaining({
      type: 'task.recovery.output_linked',
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: journal.contentRecoveryJournalEntryId,
      journalRevision: journal.revision + 1,
      output
    }))

    const historicalRuntimeAt = new Date(at.getTime() - 48 * 60 * 60_000).toISOString()
    const resultFacts = {
      taskId: task.taskId,
      executionId: execution.executionId,
      expectedTaskRevision: task.revision,
      expectedExecutionRevision: execution.revision,
      summary: 'The exact observed recovery output is ready for Coordinator review.',
      runtimeProvenance: {
        runtimeId: 'runtime_task_recovery_worker',
        modelId: null,
        startedAt: historicalRuntimeAt,
        completedAt: historicalRuntimeAt
      },
      outputs: [output],
      recoveryJournalEntryIds: [journal.contentRecoveryJournalEntryId]
    }
    const submitted = await fixture.service.submitTaskResult(fixture.workerAgent, {
      protocolVersion: '1.0',
      type: 'task.result.submit',
      requestId: 'req_task_recovery_submit_result',
      idempotencyKey: 'idem_task_recovery_submit_result',
      ...resultFacts,
      submissionDigest: stableDigest(resultFacts)
    })
    expect(submitted).toMatchObject({
      task: { status: 'awaiting_review' },
      execution: { state: 'result_submitted' },
      submission: {
        outputs: [output],
        recoveryJournalEntryIds: [journal.contentRecoveryJournalEntryId]
      }
    })

    const reviewProject = (await fixture.repository.getProject(fixture.activeProject.projectId))!
    const reviewBase = {
      protocolVersion: '1.0' as const,
      type: 'task.result.review' as const,
      projectId: fixture.activeProject.projectId,
      taskId: submitted.task.taskId,
      executionId: submitted.execution.executionId,
      resultSubmissionId: submitted.submission.resultSubmissionId,
      expectedProjectRevision: reviewProject.revision,
      expectedTaskRevision: submitted.task.revision,
      expectedExecutionRevision: submitted.execution.revision,
      expectedResultRevision: submitted.submission.revision,
      expectedCoordinatorAuthorityEpoch: fixture.activeProject.coordinatorAuthorityEpoch,
      decision: 'request_revision' as const,
      instruction: 'Revise the recovered report under one newly approved output name.',
      nextAssigneeAgentId: fixture.workerAgent.agentId,
      expectedNextAssigneeAvailabilityRevision: fixture.availability.revision,
      nextOfferExpiresAt: new Date(at.getTime() + 60_000).toISOString()
    }
    await expect(fixture.service.reviewTaskResult(fixture.coordinator, {
      ...reviewBase,
      requestId: 'req_task_recovery_revision_same_name',
      idempotencyKey: 'idem_task_recovery_revision_same_name',
      nextFileIntent: fixture.fileIntent
    })).rejects.toMatchObject({ code: 'validation_failed' })
    const nextFileIntent = {
      ...fixture.fileIntent,
      output: { ...fixture.fileIntent.output, fileName: 'task-recovery-reviewed-2.md' }
    }
    const revised = await fixture.service.reviewTaskResult(fixture.coordinator, {
      ...reviewBase,
      requestId: 'req_task_recovery_revision_new_name',
      idempotencyKey: 'idem_task_recovery_revision_new_name',
      nextFileIntent
    })
    expect(revised.execution.executionId).toBe(submitted.execution.executionId)
    expect(revised.execution).toMatchObject({
      state: 'superseded',
      fence: { status: 'fenced', reason: 'reassigned' }
    })
    expect(revised.offer?.executionId).not.toBe(submitted.execution.executionId)
    expect((await fixture.repository.getTask(revised.task.taskId))?.fileIntent)
      .toEqual(nextFileIntent)
  })

  it('abandons one exact Task recovery tuple and fences the Worker without claiming success', async () => {
    const fixture = await manualRecoveryFileOfferFixture('task_recovery_abandon')
    const task = fixture.unknown.task!
    const execution = fixture.unknown.execution!
    const action = fixture.unknown.recoveryAction!
    const journal = fixture.unknown.journal
    const command = {
      protocolVersion: '1.0' as const,
      type: 'task.recovery.abandon' as const,
      requestId: 'req_task_recovery_abandon_exact',
      idempotencyKey: 'idem_task_recovery_abandon_exact',
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: journal.contentRecoveryJournalEntryId,
      expectedTaskRevision: task.revision,
      expectedExecutionRevision: execution.revision,
      expectedRecoveryActionRevision: action.revision,
      expectedCoordinatorAuthorityEpoch: fixture.activeProject.coordinatorAuthorityEpoch,
      reason: 'The exact output was not observed; retry under a new execution and output name.'
    }

    await expect(fixture.service.abandonTaskRecovery(fixture.worker.user, {
      ...command,
      requestId: 'req_task_recovery_abandon_non_owner',
      idempotencyKey: 'idem_task_recovery_abandon_non_owner'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const abandoned = await fixture.service.abandonTaskRecovery(fixture.owner.user, command)
    expect(abandoned).toMatchObject({
      task: { status: 'revision_requested', revision: task.revision + 1 },
      execution: {
        state: 'cancelled',
        revision: execution.revision + 1,
        fence: { status: 'fenced', reason: 'manual_recovery_abandoned' }
      },
      journal: { state: 'abandoned', revision: journal.revision + 1 },
      recoveryAction: { status: 'completed', revision: action.revision + 1 }
    })
    const workerInbox = await fixture.repository.pullInbox(
      { kind: 'agent', id: fixture.workerAgent.agentId },
      0,
      200,
      at.toISOString()
    )
    expect(workerInbox.map(({ payload }) => payload)).toContainEqual(expect.objectContaining({
      type: 'task.recovery.abandoned',
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: action.recoveryActionId,
      taskRevision: task.revision + 1,
      executionRevision: execution.revision + 1,
      reason: command.reason
    }))
  })

  it('lets only the Coordinator Agent create a newly named successor after Human recovery abandon', async () => {
    const fixture = await manualRecoveryFileOfferFixture('task_recovery_successor')
    const task = fixture.unknown.task!
    const execution = fixture.unknown.execution!
    const action = fixture.unknown.recoveryAction!
    const journal = fixture.unknown.journal
    const abandoned = await fixture.service.abandonTaskRecovery(fixture.owner.user, {
      protocolVersion: '1.0',
      type: 'task.recovery.abandon',
      requestId: 'req_task_recovery_successor_abandon',
      idempotencyKey: 'idem_task_recovery_successor_abandon',
      projectId: fixture.activeProject.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: action.recoveryActionId,
      journalEntryId: journal.contentRecoveryJournalEntryId,
      expectedTaskRevision: task.revision,
      expectedExecutionRevision: execution.revision,
      expectedRecoveryActionRevision: action.revision,
      expectedCoordinatorAuthorityEpoch: fixture.activeProject.coordinatorAuthorityEpoch,
      reason: 'The exact output was not observed; approve one newly named successor.'
    })
    const project = (await fixture.repository.getProject(fixture.activeProject.projectId))!
    const base = {
      protocolVersion: '1.0' as const,
      type: 'task.offer.reassign' as const,
      taskId: abandoned.task.taskId,
      previousExecutionId: abandoned.execution.executionId,
      expectedProjectRevision: project.revision,
      expectedTaskRevision: abandoned.task.revision,
      expectedExecutionRevision: abandoned.execution.revision,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch,
      assigneeAgentId: fixture.workerAgent.agentId,
      expectedAvailabilityRevision: fixture.availability.revision,
      offerExpiresAt: new Date(at.getTime() + 60_000).toISOString()
    }
    await expect(fixture.service.reassignTaskOffer(fixture.coordinator, {
      ...base,
      requestId: 'req_task_recovery_successor_same_name',
      idempotencyKey: 'idem_task_recovery_successor_same_name',
      nextFileIntent: fixture.fileIntent
    })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(fixture.service.reassignTaskOffer(fixture.coordinator, {
      ...base,
      requestId: 'req_task_recovery_successor_fact_drift',
      idempotencyKey: 'idem_task_recovery_successor_fact_drift',
      nextFileIntent: {
        ...fixture.fileIntent,
        output: {
          ...fixture.fileIntent.output,
          fileName: 'recovered-output-successor-2.md',
          maxBytes: fixture.fileIntent.output.maxBytes + 1
        }
      }
    })).rejects.toMatchObject({ code: 'validation_failed' })

    const nextFileIntent = {
      ...fixture.fileIntent,
      output: {
        ...fixture.fileIntent.output,
        fileName: 'recovered-output-successor-2.md'
      }
    }
    await expect(fixture.service.reassignTaskOffer(fixture.workerAgent, {
      ...base,
      requestId: 'req_task_recovery_successor_worker_bypass',
      idempotencyKey: 'idem_task_recovery_successor_worker_bypass',
      nextFileIntent
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const successor = await fixture.service.reassignTaskOffer(fixture.coordinator, {
      ...base,
      requestId: 'req_task_recovery_successor_create',
      idempotencyKey: 'idem_task_recovery_successor_create',
      nextFileIntent
    })
    expect(successor.execution.executionId).not.toBe(abandoned.execution.executionId)
    expect(successor.execution.fileIntent?.output.fileName).toBe(nextFileIntent.output.fileName)
    expect(successor.task).toMatchObject({
      currentExecutionId: successor.execution.executionId,
      status: 'offered',
      fileIntent: nextFileIntent
    })
    expect(await fixture.repository.getTaskExecution(abandoned.execution.executionId)).toMatchObject({
      state: 'cancelled',
      revision: abandoned.execution.revision,
      fence: { status: 'fenced', reason: 'manual_recovery_abandoned' }
    })
  })

  it('activates Project Content only after exact journal observations and a current Owner Device signature', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'content-owner', at)
    const worker = await seedOidcUserDevice(repository, 'content-worker', at)
    const signing = generateKeyPairSync('ed25519')
    const publicJwk = signing.publicKey.export({ format: 'jwk' })
    const deviceKeyId = 'content-owner-device-key'
    await repository.transaction(async (tx) => {
      const device = (await tx.getDeviceForUpdate(owner.deviceId))!
      await tx.updateDevice({ ...device,
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig',
          kid: deviceKeyId, x: publicJwk.x! },
        revision: device.revision + 1, updatedAt: at.toISOString() }, device.revision)
    })
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'content-owner')
    const ownerFact = await service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...providerFactCommand(owner.user, owner.deviceId, 'content-provider-owner', 'idem_content_owner_fact'),
      expectedDeviceRevision: 2
    })
    const workerFact = await service.publishProviderDirectoryPrincipalFact(worker.user,
      providerFactCommand(worker.user, worker.deviceId, 'content-provider-worker', 'idem_content_worker_fact'))
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_content_project_01',
      idempotencyKey: 'idem_content_project_01', displayName: 'Signed Content meeting',
      goal: 'Verify the exact Provider root and member roster.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'required', contentOwnerUserId: owner.userId,
        providerInstance: ownerFact.providerPrincipal.providerInstance,
        containerDisplayName: 'Signed Content meeting', members: [
          { userId: owner.userId, providerPrincipalFactId: ownerFact.providerPrincipalFactId,
            expectedFactRevision: ownerFact.revision },
          { userId: worker.userId, providerPrincipalFactId: workerFact.providerPrincipalFactId,
            expectedFactRevision: workerFact.revision }
        ] }
    })
    const intent = created.provisioningIntent!
    const requestDigest = 'b'.repeat(64)
    const prepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_content_prepare_01',
      idempotencyKey: 'idem_content_prepare_01', scope: 'project_provisioning',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: intent.provisioningIntentId, provisioningRevision: intent.provisioningRevision,
      logicalInvocationId: 'create-content-root-01', operation: 'create_shared_container', requestDigest
    })
    const dispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_content_dispatch_01',
      idempotencyKey: 'idem_content_dispatch_01', journalEntryId: prepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: prepared.revision
    })
    const receiptDigest = 'c'.repeat(64)
    const operationObservationDigest = 'd'.repeat(64)
    const observed = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_content_observe_01',
      idempotencyKey: 'idem_content_observe_01', journalEntryId: dispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: dispatched.revision, outcome: 'observed_success',
      receiptDigest, observationDigest: operationObservationDigest, safeFailureCode: null
    })
    expect(observed.provisioningIntent?.state).toBe('awaiting_attestation')
    const rootLocator = { contractVersion: 1 as const, kind: 'content-space.container-reference' as const,
      authority: 'opencontent.sciforge.test', identity: { containerId: 'signed-content-root' } }
    const memberObservations = intent.desiredMembers.map((member, index) => ({
      userId: member.userId, providerPrincipalFactId: member.providerPrincipalFactId,
      snapshottedFactRevision: member.snapshottedFactRevision, principal: member.principal,
      presence: 'present' as const, observationDigest: String(index + 1).repeat(64),
      observedAt: at.toISOString()
    }))
    const attestation = signProvisioningAttestation({
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: 'pca_ContentSigned001', projectId: created.project.projectId,
      provisioningIntentId: intent.provisioningIntentId, provisioningRevision: intent.provisioningRevision,
      ownerUserId: owner.userId, principalIdentityRevision: ownerFact.principalIdentityRevision,
      providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      rootLocator, rootLocatorDigest: stableDigest(rootLocator),
      observedOperations: [{ operationId: prepared.logicalInvocationId,
        operationRevision: observed.journal.revision, kind: 'create_shared_container', subjectPrincipal: null,
        requestDigest, receiptDigest, outcome: 'observed_success', safeFailureCode: null,
        observedAt: at.toISOString() }],
      memberObservations,
      memberSetDigest: createHash('sha256').update(canonicalProvisionedMemberSetBytes(memberObservations)).digest('hex'),
      observationStartedAt: at.toISOString(), observationCompletedAt: at.toISOString()
    }, signing, owner.deviceId, deviceKeyId, 2)
    const activated = await service.attestProjectContent(owner.user, {
      protocolVersion: '1.0', type: 'project.content.attest', requestId: 'req_content_attest_01',
      idempotencyKey: 'idem_content_attest_01', projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision,
      expectedProvisioningRevision: intent.provisioningRevision,
      attestation
    })
    expect(activated.binding).toMatchObject({ status: 'active', rootLocatorDigest: stableDigest(rootLocator) })
    expect(activated.readiness).toHaveLength(2)
    expect(activated.readiness.every(({ state }) => state === 'ready')).toBe(true)

    const workerMembership = created.memberships.find(({ userId }) => userId === worker.userId)!
    const removal = await service.removeProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.remove', requestId: 'req_content_remove_01',
      idempotencyKey: 'idem_content_remove_01', projectId: created.project.projectId,
      projectMembershipId: workerMembership.projectMembershipId,
      expectedProjectRevision: activated.project.revision,
      expectedMembershipRevision: workerMembership.revision
    })
    expect(removal.membership.state).toBe('membership_removal_pending')
    const pendingRead = await service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_pending_read',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', limit: 1 }]
    })
    expect(pendingRead).toMatchObject({ project: { projectId: created.project.projectId },
      pages: [{ collection: 'memberships', items: [expect.any(Object)], nextCursor: expect.any(String) }] })
    const membershipCursor = pendingRead.pages[0]!.nextCursor
    if (membershipCursor === undefined) throw new Error('The first Membership page must have a continuation.')
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_pending_next',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', cursor: membershipCursor, limit: 1 }]
    })).resolves.toMatchObject({ pages: [{ collection: 'memberships', cursor: membershipCursor,
      items: [expect.any(Object)] }] })
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_wrong_cursor',
      projectId: created.project.projectId,
      collections: [{ collection: 'task_authorities', cursor: membershipCursor, limit: 1 }]
    })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(service.listProjects(worker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_content_pending_list', limit: 10
    })).resolves.toMatchObject({ projects: [{ projectId: created.project.projectId }] })
    const removalIntent = removal.provisioningIntent!
    const removalRequestDigest = 'e'.repeat(64)
    const removalPrepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_content_remove_prepare',
      idempotencyKey: 'idem_content_remove_prepare', scope: 'project_membership',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: removalIntent.provisioningIntentId,
      provisioningRevision: removalIntent.provisioningRevision,
      logicalInvocationId: 'remove-content-worker-01', operation: 'remove_member',
      requestDigest: removalRequestDigest
    })
    const removalDispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_content_remove_dispatch',
      idempotencyKey: 'idem_content_remove_dispatch',
      journalEntryId: removalPrepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: removalPrepared.revision
    })
    const removalReceiptDigest = 'f'.repeat(64)
    const removalOperationDigest = 'a'.repeat(64)
    const removalObserved = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_content_remove_observe',
      idempotencyKey: 'idem_content_remove_observe',
      journalEntryId: removalDispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: removalDispatched.revision, outcome: 'observed_success',
      receiptDigest: removalReceiptDigest, observationDigest: removalOperationDigest,
      safeFailureCode: null
    })
    const removalMembers = [
      { userId: owner.userId, providerPrincipalFactId: ownerFact.providerPrincipalFactId,
        snapshottedFactRevision: ownerFact.revision, principal: ownerFact.providerPrincipal,
        presence: 'present' as const, observationDigest: 'b'.repeat(64), observedAt: at.toISOString() },
      { userId: worker.userId, providerPrincipalFactId: workerFact.providerPrincipalFactId,
        snapshottedFactRevision: workerFact.revision, principal: workerFact.providerPrincipal,
        presence: 'absent' as const, observationDigest: 'c'.repeat(64), observedAt: at.toISOString() }
    ]
    const removalAttestation = signProvisioningAttestation({
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: 'pca_ContentRemoval01', projectId: created.project.projectId,
      provisioningIntentId: removalIntent.provisioningIntentId,
      provisioningRevision: removalIntent.provisioningRevision,
      ownerUserId: owner.userId, principalIdentityRevision: ownerFact.principalIdentityRevision,
      providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      rootLocator, rootLocatorDigest: stableDigest(rootLocator),
      observedOperations: [{ operationId: removalPrepared.logicalInvocationId,
        operationRevision: removalObserved.journal.revision, kind: 'remove_member',
        subjectPrincipal: workerFact.providerPrincipal, requestDigest: removalRequestDigest,
        receiptDigest: removalReceiptDigest, outcome: 'observed_success', safeFailureCode: null,
        observedAt: at.toISOString() }],
      memberObservations: removalMembers,
      memberSetDigest: createHash('sha256').update(canonicalProvisionedMemberSetBytes(removalMembers)).digest('hex'),
      observationStartedAt: at.toISOString(), observationCompletedAt: at.toISOString()
    }, signing, owner.deviceId, deviceKeyId, 2)
    const removed = await service.attestProjectContent(owner.user, {
      protocolVersion: '1.0', type: 'project.content.attest', requestId: 'req_content_remove_attest',
      idempotencyKey: 'idem_content_remove_attest', projectId: created.project.projectId,
      expectedProjectRevision: removal.project.revision,
      expectedProvisioningRevision: removalIntent.provisioningRevision,
      attestation: removalAttestation
    })
    expect(removed.binding.status).toBe('active')
    expect(removed.memberships).toEqual([
      expect.objectContaining({ userId: worker.userId, state: 'removed' })
    ])
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_removed_read',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', limit: 10 }]
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.listProjects(worker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_content_removed_list', limit: 10
    })).resolves.toMatchObject({ projects: [] })
  })

  it('keeps a dynamic content-required member pending with suspended Task authority until provisioning', async () => {
    const { repository, service, owner, created } =
      await contentRecoveryProjectFixture('dynamic-content-member')
    const addedWorker = await seedOidcUserDevice(repository, 'dynamic-content-added-worker', at)
    const addedWorkerFact = await service.publishProviderDirectoryPrincipalFact(
      addedWorker.user,
      providerFactCommand(
        addedWorker.user,
        addedWorker.deviceId,
        'dynamic-content-provider-added-worker',
        'idem_dynamic_content_added_worker_fact'
      )
    )

    const added = await service.addProjectMembership(owner.user, {
      protocolVersion: '1.0',
      type: 'project.membership.add',
      requestId: 'req_dynamic_content_member_add',
      idempotencyKey: 'idem_dynamic_content_member_add',
      projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision,
      userId: addedWorker.user.userId,
      providerPrincipalFactId: addedWorkerFact.providerPrincipalFactId,
      expectedProviderPrincipalFactRevision: addedWorkerFact.revision
    })

    expect(added.membership).toMatchObject({
      userId: addedWorker.user.userId,
      state: 'pending_membership',
      activatedAt: null
    })
    expect(added.contentReadiness).toMatchObject({
      userId: addedWorker.user.userId,
      state: 'pending',
      reason: 'provisioning_pending'
    })
    expect(added.taskAuthorities).toHaveLength(2)
    expect(added.taskAuthorities.every(({ state }) => state === 'suspended')).toBe(true)
    expect(added.provisioningIntent).toMatchObject({
      kind: 'membership_change',
      desiredMembers: expect.arrayContaining([
        expect.objectContaining({
          userId: addedWorker.user.userId,
          providerPrincipalFactId: addedWorkerFact.providerPrincipalFactId,
          snapshottedFactRevision: addedWorkerFact.revision
        })
      ])
    })
  })

  it('activates a pending dynamic member only after exact observed Provider facts and Device attestation', async () => {
    const { repository, service, owner, ownerFact, created } =
      await contentRecoveryProjectFixture('dynamic-member-attestation')
    const signing = generateKeyPairSync('ed25519')
    const publicJwk = signing.publicKey.export({ format: 'jwk' })
    const deviceKeyId = 'dynamic-member-owner-device-key'
    await repository.transaction(async (tx) => {
      const device = (await tx.getDeviceForUpdate(owner.deviceId))!
      await tx.updateDevice({
        ...device,
        publicKeyJwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          alg: 'EdDSA',
          use: 'sig',
          kid: deviceKeyId,
          x: publicJwk.x!
        },
        revision: device.revision + 1,
        updatedAt: at.toISOString()
      }, device.revision)
    })
    const addedWorker = await seedOidcUserDevice(repository, 'dynamic-attested-worker', at)
    const addedWorkerFact = await service.publishProviderDirectoryPrincipalFact(
      addedWorker.user,
      providerFactCommand(
        addedWorker.user,
        addedWorker.deviceId,
        'dynamic-attested-provider-worker',
        'idem_dynamic_attested_worker_fact'
      )
    )
    const added = await service.addProjectMembership(owner.user, {
      protocolVersion: '1.0',
      type: 'project.membership.add',
      requestId: 'req_dynamic_attested_member_add',
      idempotencyKey: 'idem_dynamic_attested_member_add',
      projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision,
      userId: addedWorker.user.userId,
      providerPrincipalFactId: addedWorkerFact.providerPrincipalFactId,
      expectedProviderPrincipalFactRevision: addedWorkerFact.revision
    })
    const intent = added.provisioningIntent!
    const requestDigest = '2'.repeat(64)
    const prepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0',
      type: 'external_operation.prepare',
      requestId: 'req_dynamic_attested_prepare',
      idempotencyKey: 'idem_dynamic_attested_prepare',
      scope: 'project_membership',
      projectId: created.project.projectId,
      taskId: null,
      executionId: null,
      preparedTaskRevision: null,
      preparedExecutionRevision: null,
      provisioningIntentId: intent.provisioningIntentId,
      provisioningRevision: intent.provisioningRevision,
      logicalInvocationId: 'dynamic-attested-add-member',
      operation: 'add_member',
      requestDigest
    })
    const dispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0',
      type: 'external_operation.dispatch',
      requestId: 'req_dynamic_attested_dispatch',
      idempotencyKey: 'idem_dynamic_attested_dispatch',
      journalEntryId: prepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: prepared.revision
    })
    const receiptDigest = '3'.repeat(64)
    const observed = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0',
      type: 'external_operation.observe',
      requestId: 'req_dynamic_attested_observe',
      idempotencyKey: 'idem_dynamic_attested_observe',
      journalEntryId: dispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: dispatched.revision,
      outcome: 'observed_success',
      receiptDigest,
      observationDigest: '4'.repeat(64),
      safeFailureCode: null
    })
    expect(await repository.getProjectMember(created.project.projectId, addedWorker.user.userId))
      .toMatchObject({ state: 'pending_membership', activatedAt: null })

    const rootLocator = {
      contractVersion: 1 as const,
      kind: 'content-space.container-reference' as const,
      authority: 'opencontent.sciforge.test',
      identity: { containerId: 'dynamic-attested-content-root' }
    }
    const memberObservations = intent.desiredMembers.map((member, index) => ({
      userId: member.userId,
      providerPrincipalFactId: member.providerPrincipalFactId,
      snapshottedFactRevision: member.snapshottedFactRevision,
      principal: member.principal,
      presence: 'present' as const,
      observationDigest: String(index + 5).repeat(64),
      observedAt: at.toISOString()
    }))
    const attestation = signProvisioningAttestation({
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: 'pca_DynamicMemberAttested01',
      projectId: created.project.projectId,
      provisioningIntentId: intent.provisioningIntentId,
      provisioningRevision: intent.provisioningRevision,
      ownerUserId: owner.user.userId,
      principalIdentityRevision: ownerFact.principalIdentityRevision,
      providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      rootLocator,
      rootLocatorDigest: stableDigest(rootLocator),
      observedOperations: [{
        operationId: prepared.logicalInvocationId,
        operationRevision: observed.journal.revision,
        kind: 'add_member',
        subjectPrincipal: addedWorkerFact.providerPrincipal,
        requestDigest,
        receiptDigest,
        outcome: 'observed_success',
        safeFailureCode: null,
        observedAt: at.toISOString()
      }],
      memberObservations,
      memberSetDigest: createHash('sha256')
        .update(canonicalProvisionedMemberSetBytes(memberObservations))
        .digest('hex'),
      observationStartedAt: at.toISOString(),
      observationCompletedAt: at.toISOString()
    }, signing, owner.deviceId, deviceKeyId, 2)
    const attested = await service.attestProjectContent(owner.user, {
      protocolVersion: '1.0',
      type: 'project.content.attest',
      requestId: 'req_dynamic_attested_content',
      idempotencyKey: 'idem_dynamic_attested_content',
      projectId: created.project.projectId,
      expectedProjectRevision: added.project.revision,
      expectedProvisioningRevision: intent.provisioningRevision,
      attestation
    })

    expect(attested.memberships).toEqual([
      expect.objectContaining({
        userId: addedWorker.user.userId,
        state: 'active',
        activatedAt: at.toISOString()
      })
    ])
    expect(await repository.getProjectMember(created.project.projectId, addedWorker.user.userId))
      .toMatchObject({ state: 'active', activatedAt: at.toISOString() })
  })

  it('adds and safely removes dynamic content-free Membership without a Provider ACL saga', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'membership-owner', at)
    const originalWorker = await seedOidcUserDevice(repository, 'membership-original-worker', at)
    const addedWorker = await seedOidcUserDevice(repository, 'membership-added-worker', at)
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'membership-owner')
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_membership_project_01',
      idempotencyKey: 'idem_membership_project_01', displayName: 'Dynamic meeting team',
      goal: 'Exercise User-level membership authority.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }, { userId: originalWorker.userId }] }
    })
    const added = await service.addProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.add', requestId: 'req_membership_add_01',
      idempotencyKey: 'idem_membership_add_01', projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision, userId: addedWorker.userId,
      providerPrincipalFactId: null, expectedProviderPrincipalFactRevision: null
    })
    expect(added).toMatchObject({ membership: { userId: addedWorker.userId, state: 'active' },
      contentReadiness: null, provisioningIntent: null })
    expect(added.taskAuthorities).toHaveLength(2)
    const removed = await service.removeProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.remove', requestId: 'req_membership_remove_01',
      idempotencyKey: 'idem_membership_remove_01', projectId: created.project.projectId,
      projectMembershipId: added.membership.projectMembershipId,
      expectedProjectRevision: added.project.revision,
      expectedMembershipRevision: added.membership.revision
    })
    expect(removed.membership).toMatchObject({ state: 'removed', removedAt: at.toISOString() })
    expect(removed.taskAuthorities.every(({ state, reason }) =>
      state === 'fenced' && reason === 'membership_removed')).toBe(true)
    expect(removed.provisioningIntent).toBeNull()

    const secondProject = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_membership_project_02',
      idempotencyKey: 'idem_membership_project_02', displayName: 'Second dynamic meeting',
      goal: 'Exercise an actor-bound Project list continuation.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }] }
    })
    const firstPage = await service.listProjects(owner.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_page_1', limit: 1
    })
    expect(firstPage.projects).toHaveLength(1)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    const secondPage = await service.listProjects(owner.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_page_2',
      cursor: firstPage.nextCursor!, limit: 1
    })
    expect(new Set([...firstPage.projects, ...secondPage.projects].map(({ projectId }) => projectId))).toEqual(
      new Set([created.project.projectId, secondProject.project.projectId])
    )
    expect(secondPage.observedAt).toBe(firstPage.observedAt)
    await expect(service.listProjects(originalWorker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_wrong_actor',
      cursor: firstPage.nextCursor!, limit: 1
    })).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('transfers Coordinator authority only between exact Agents owned by the Project Owner', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'transfer-owner', at)
    const member = await seedOidcUserDevice(repository, 'transfer-member', at)
    const secondOwnerDeviceId = await addActiveDeviceForUser(
      repository,
      owner.deviceId,
      owner.userId,
      'transfer-owner-second'
    )
    const coordinator = await registeredAgent(
      service,
      owner.user,
      owner.deviceId,
      'transfer-owner-current'
    )
    const successor = await registeredAgent(
      service,
      owner.user,
      secondOwnerDeviceId,
      'transfer-owner-successor'
    )
    const memberAgent = await registeredAgent(
      service,
      member.user,
      member.deviceId,
      'transfer-member-agent'
    )
    const successorAvailability = await publishReadyAvailability(
      service,
      successor,
      'transfer_successor'
    )
    const memberAvailability = await publishReadyAvailability(
      service,
      memberAgent,
      'transfer_member'
    )
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: 'req_transfer_owner_project',
      idempotencyKey: 'idem_transfer_owner_project',
      displayName: 'Owner-only Coordinator transfer',
      goal: 'Fence the old Coordinator without creating a role account.',
      coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: {
        maxTasks: 5,
        maxTasksPerRound: 5,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      },
      content: {
        mode: 'none',
        members: [{ userId: owner.userId }, { userId: member.userId }]
      }
    })
    const currentAvailability = await publishReadyAvailability(
      service,
      coordinator,
      'transfer_current'
    )
    const transferFacts = {
      protocolVersion: '1.0' as const,
      type: 'project.transfer_coordinator' as const,
      projectId: created.project.projectId,
      expectedRevision: created.project.revision,
      expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch
    }

    await expect(service.transferCoordinator(owner.user, {
      ...transferFacts,
      requestId: 'req_transfer_member_forbidden',
      idempotencyKey: 'idem_transfer_member_forbidden',
      coordinatorAgentId: memberAgent.agentId,
      expectedCoordinatorAvailabilityRevision: memberAvailability.revision
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.transferCoordinator(owner.user, {
      ...transferFacts,
      requestId: 'req_transfer_same_forbidden',
      idempotencyKey: 'idem_transfer_same_forbidden',
      coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAvailabilityRevision: currentAvailability.revision
    })).rejects.toMatchObject({ code: 'invalid_state_transition' })

    const transferred = await service.transferCoordinator(owner.user, {
      ...transferFacts,
      requestId: 'req_transfer_owner_successor',
      idempotencyKey: 'idem_transfer_owner_successor',
      coordinatorAgentId: successor.agentId,
      expectedCoordinatorAvailabilityRevision: successorAvailability.revision
    })
    expect(transferred).toMatchObject({
      coordinatorAgentId: successor.agentId,
      coordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch + 1,
      revision: created.project.revision + 1
    })

    for (const recipient of [coordinator, successor]) {
      const inbox = await service.pullInbox(recipient, { afterSequence: 0, limit: 100 })
      const notifications = inbox.messages.filter(({ payload }) => (
        payload.type === 'coordinator.transferred'
      ))
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        recipient: { kind: 'agent', id: recipient.agentId },
        payload: {
          type: 'coordinator.transferred',
          projectId: transferred.projectId,
          previousCoordinatorAgentId: coordinator.agentId,
          coordinatorAgentId: successor.agentId,
          coordinatorAuthorityEpoch: transferred.coordinatorAuthorityEpoch,
          revision: transferred.revision
        }
      })
    }

    const tasks = [{
      planItemId: 'item_transfer_fence',
      title: 'Verify transferred authority',
      objective: 'Only the successor Coordinator may submit this plan.',
      completionCriteria: ['The old Coordinator write is rejected.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['research.execute'],
      fileIntent: null
    }]
    const oldPlanFacts = {
      projectId: transferred.projectId,
      expectedProjectRevision: created.project.revision,
      expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks,
      rationale: 'The transfer itself supplies the authority fence.',
      runtimeProvenance: {
        runtimeId: 'runtime_transfer_old_coordinator',
        modelId: null,
        generatedByCoordinatorAgentId: coordinator.agentId,
        generatedAt: at.toISOString()
      }
    }
    await expect(service.submitProjectPlan(coordinator, {
      protocolVersion: '1.0',
      type: 'project.plan.submit',
      requestId: 'req_transfer_old_plan',
      idempotencyKey: 'idem_transfer_old_plan',
      ...oldPlanFacts,
      planDigest: stableDigest(oldPlanFacts)
    })).rejects.toMatchObject({ code: 'permission_denied' })

    const successorPlanFacts = {
      ...oldPlanFacts,
      expectedProjectRevision: transferred.revision,
      expectedCoordinatorAuthorityEpoch: transferred.coordinatorAuthorityEpoch,
      runtimeProvenance: {
        ...oldPlanFacts.runtimeProvenance,
        runtimeId: 'runtime_transfer_successor',
        generatedByCoordinatorAgentId: successor.agentId
      }
    }
    const plan = await service.submitProjectPlan(successor, {
      protocolVersion: '1.0',
      type: 'project.plan.submit',
      requestId: 'req_transfer_successor_plan',
      idempotencyKey: 'idem_transfer_successor_plan',
      ...successorPlanFacts,
      planDigest: stableDigest(successorPlanFacts)
    })
    expect(plan.runtimeProvenance.generatedByCoordinatorAgentId).toBe(successor.agentId)
  })

  it('reassigns only from the caller-observed Project and execution authority epochs after transfer', async () => {
    const fixture = await activeTextOfferFixture('reassign-fence')
    const rejected = await fixture.service.rejectTaskOffer(fixture.firstWorkerAgent, {
      protocolVersion: '1.0',
      type: 'task.offer.reject',
      requestId: 'req_reassign_reject',
      idempotencyKey: 'idem_reassign_reject',
      taskOfferId: fixture.offered.offer.taskOfferId,
      taskId: fixture.offered.task.taskId,
      executionId: fixture.offered.execution.executionId,
      expectedTaskRevision: fixture.offered.task.revision,
      expectedExecutionRevision: fixture.offered.execution.revision,
      expectedOfferRevision: fixture.offered.offer.revision,
      reason: 'human_rejected',
      safeReasonDetail: null
    })
    const projectAfterOffer = (
      await fixture.service.getProject(fixture.owner.user, fixture.activeProject.projectId)
    ).project
    const transferred = await fixture.service.transferCoordinator(fixture.owner.user, {
      protocolVersion: '1.0',
      type: 'project.transfer_coordinator',
      requestId: 'req_reassign_transfer',
      idempotencyKey: 'idem_reassign_transfer',
      projectId: projectAfterOffer.projectId,
      expectedRevision: projectAfterOffer.revision,
      expectedCoordinatorAuthorityEpoch: projectAfterOffer.coordinatorAuthorityEpoch,
      coordinatorAgentId: fixture.nextCoordinatorAgent.agentId,
      expectedCoordinatorAvailabilityRevision: fixture.nextAvailability.revision
    })
    const command = {
      protocolVersion: '1.0' as const,
      type: 'task.offer.reassign' as const,
      taskId: rejected.task.taskId,
      previousExecutionId: rejected.execution.executionId,
      expectedProjectRevision: transferred.revision,
      expectedTaskRevision: rejected.task.revision,
      expectedExecutionRevision: rejected.execution.revision,
      expectedCoordinatorAuthorityEpoch: transferred.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: transferred.executionAuthorityEpoch,
      assigneeAgentId: fixture.nextCoordinatorAgent.agentId,
      expectedAvailabilityRevision: fixture.nextAvailability.revision,
      offerExpiresAt: new Date(at.getTime() + 60_000).toISOString(),
      nextFileIntent: null
    }

    await expect(fixture.service.reassignTaskOffer(fixture.nextCoordinatorAgent, {
      ...command,
      requestId: 'req_reassign_stale_project',
      idempotencyKey: 'idem_reassign_stale_project',
      expectedProjectRevision: projectAfterOffer.revision
    })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(fixture.service.reassignTaskOffer(fixture.nextCoordinatorAgent, {
      ...command,
      requestId: 'req_reassign_stale_coordinator_epoch',
      idempotencyKey: 'idem_reassign_stale_coordinator_epoch',
      expectedCoordinatorAuthorityEpoch: transferred.coordinatorAuthorityEpoch - 1
    })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(fixture.service.reassignTaskOffer(fixture.nextCoordinatorAgent, {
      ...command,
      requestId: 'req_reassign_stale_execution_epoch',
      idempotencyKey: 'idem_reassign_stale_execution_epoch',
      expectedExecutionAuthorityEpoch: transferred.executionAuthorityEpoch + 1
    })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(fixture.service.reassignTaskOffer(fixture.coordinator, {
      ...command,
      requestId: 'req_reassign_old_coordinator',
      idempotencyKey: 'idem_reassign_old_coordinator'
    })).rejects.toMatchObject({ code: 'permission_denied' })

    const reassigned = await fixture.service.reassignTaskOffer(fixture.nextCoordinatorAgent, {
      ...command,
      requestId: 'req_reassign_current',
      idempotencyKey: 'idem_reassign_current'
    })
    expect(reassigned.execution.executionId).not.toBe(rejected.execution.executionId)
    expect(reassigned.offer.executionId).toBe(reassigned.execution.executionId)

    const fresh = await fixture.service.readProjectCoordination(fixture.owner.user, {
      protocolVersion: '1.0',
      type: 'project.coordination.read',
      requestId: 'req_reassign_fresh_read',
      projectId: transferred.projectId,
      collections: [
        { collection: 'tasks', limit: 10 },
        { collection: 'executions', limit: 10 },
        { collection: 'offers', limit: 10 }
      ]
    })
    const tasks = fresh.pages.flatMap((page) => page.collection === 'tasks' ? page.items : [])
    const executions = fresh.pages.flatMap((page) => page.collection === 'executions' ? page.items : [])
    const oldExecution = executions.find(({ executionId }) => (
      executionId === rejected.execution.executionId
    ))!
    expect(oldExecution).toMatchObject({
      state: 'superseded',
      fence: { status: 'fenced', reason: 'reassigned' }
    })
    await expect(fixture.service.startTaskExecution(fixture.firstWorkerAgent, {
      protocolVersion: '1.0',
      type: 'task.execution.start',
      requestId: 'req_reassign_late_start',
      idempotencyKey: 'idem_reassign_late_start',
      taskId: rejected.task.taskId,
      executionId: rejected.execution.executionId,
      expectedTaskRevision: tasks[0]!.revision,
      expectedExecutionRevision: oldExecution.revision,
      startedAt: at.toISOString()
    })).rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('request_revision creates a fresh offered execution while preserving the reviewed result provenance', async () => {
    const fixture = await activeTextOfferFixture('review-revision')
    const accepted = await fixture.service.acceptTaskOffer(fixture.firstWorkerAgent, {
      protocolVersion: '1.0',
      type: 'task.offer.accept',
      requestId: 'req_review_revision_accept',
      idempotencyKey: 'idem_review_revision_accept',
      taskOfferId: fixture.offered.offer.taskOfferId,
      taskId: fixture.offered.task.taskId,
      executionId: fixture.offered.execution.executionId,
      expectedTaskRevision: fixture.offered.task.revision,
      expectedExecutionRevision: fixture.offered.execution.revision,
      expectedOfferRevision: fixture.offered.offer.revision
    })
    const running = await fixture.service.startTaskExecution(fixture.firstWorkerAgent, {
      protocolVersion: '1.0',
      type: 'task.execution.start',
      requestId: 'req_review_revision_start',
      idempotencyKey: 'idem_review_revision_start',
      taskId: accepted.task.taskId,
      executionId: accepted.execution.executionId,
      expectedTaskRevision: accepted.task.revision,
      expectedExecutionRevision: accepted.execution.revision,
      startedAt: at.toISOString()
    })
    const resultFacts = {
      taskId: running.task.taskId,
      executionId: running.execution.executionId,
      expectedTaskRevision: running.task.revision,
      expectedExecutionRevision: running.execution.revision,
      summary: 'The first result requires one bounded revision.',
      runtimeProvenance: {
        runtimeId: 'runtime_review_revision_worker',
        modelId: null,
        startedAt: at.toISOString(),
        completedAt: at.toISOString()
      },
      outputs: [],
      recoveryJournalEntryIds: []
    }
    const result = await fixture.service.submitTaskResult(fixture.firstWorkerAgent, {
      protocolVersion: '1.0',
      type: 'task.result.submit',
      requestId: 'req_review_revision_submit',
      idempotencyKey: 'idem_review_revision_submit',
      ...resultFacts,
      submissionDigest: stableDigest(resultFacts)
    })
    const project = (
      await fixture.service.getProject(fixture.owner.user, fixture.activeProject.projectId)
    ).project
    const reviewed = await fixture.service.reviewTaskResult(fixture.coordinator, {
      protocolVersion: '1.0',
      type: 'task.result.review',
      requestId: 'req_review_revision_decide',
      idempotencyKey: 'idem_review_revision_decide',
      projectId: project.projectId,
      taskId: result.task.taskId,
      executionId: result.execution.executionId,
      resultSubmissionId: result.submission.resultSubmissionId,
      expectedProjectRevision: project.revision,
      expectedTaskRevision: result.task.revision,
      expectedExecutionRevision: result.execution.revision,
      expectedResultRevision: result.submission.revision,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      decision: 'request_revision',
      instruction: 'Address the missing exact authority evidence.',
      nextAssigneeAgentId: fixture.nextCoordinatorAgent.agentId,
      expectedNextAssigneeAvailabilityRevision: fixture.nextAvailability.revision,
      nextOfferExpiresAt: new Date(at.getTime() + 60_000).toISOString(),
      nextFileIntent: null
    })
    expect(reviewed).toMatchObject({
      task: { status: 'offered' },
      execution: { executionId: result.execution.executionId, state: 'superseded' },
      review: { decision: 'request_revision' },
      offer: { state: 'pending' }
    })

    const fresh = await fixture.service.readProjectCoordination(fixture.owner.user, {
      protocolVersion: '1.0',
      type: 'project.coordination.read',
      requestId: 'req_review_revision_read',
      projectId: project.projectId,
      collections: [
        { collection: 'tasks', limit: 10 },
        { collection: 'executions', limit: 10 },
        { collection: 'offers', limit: 10 },
        { collection: 'result_submissions', limit: 10 },
        { collection: 'review_decisions', limit: 10 },
        { collection: 'project_records', limit: 10 }
      ]
    })
    const tasks = fresh.pages.flatMap((page) => page.collection === 'tasks' ? page.items : [])
    const executions = fresh.pages.flatMap((page) => page.collection === 'executions' ? page.items : [])
    const offers = fresh.pages.flatMap((page) => page.collection === 'offers' ? page.items : [])
    const submissions = fresh.pages.flatMap((page) => (
      page.collection === 'result_submissions' ? page.items : []
    ))
    const reviews = fresh.pages.flatMap((page) => (
      page.collection === 'review_decisions' ? page.items : []
    ))
    const records = fresh.pages.flatMap((page) => (
      page.collection === 'project_records' ? page.items : []
    ))
    expect(tasks).toEqual([expect.objectContaining({
      status: 'offered',
      currentExecutionId: reviewed.review.nextExecutionId
    })])
    expect(executions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        executionId: result.execution.executionId,
        state: 'superseded',
        fence: expect.objectContaining({ status: 'fenced', reason: 'reassigned' })
      }),
      expect.objectContaining({
        executionId: reviewed.review.nextExecutionId,
        state: 'offered',
        fence: expect.objectContaining({ status: 'open' })
      })
    ]))
    expect(offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ executionId: reviewed.review.nextExecutionId, state: 'pending' })
    ]))
    expect(submissions).toEqual([expect.objectContaining({
      resultSubmissionId: result.submission.resultSubmissionId
    })])
    expect(reviews).toEqual([expect.objectContaining({
      resultSubmissionId: result.submission.resultSubmissionId,
      decision: 'request_revision',
      nextExecutionId: reviewed.review.nextExecutionId
    })])
    expect(records).toEqual([])
  })

  it('keeps Worker HumanNeeded execution-bound and runs review before Coordinator decision/completion', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'meeting-owner', at)
    const worker = await seedOidcUserDevice(repository, 'meeting-worker', at)
    const endpointChallenge = await service.createEndpointChallenge(owner.user, {
      provider: 'zulip', realmId: 'realm-meeting', expectedProviderUserId: 'owner-zulip-user',
      idempotencyKey: 'idem_meeting_owner_endpoint_challenge'
    })
    await service.verifyEndpointChallengeFromProvider({
      provider: 'zulip', realmId: 'realm-meeting', providerUserId: 'owner-zulip-user',
      providerDisplayName: 'Meeting Owner', challengeCode: String(endpointChallenge.challengeCode),
      providerEventId: 'provider-event-meeting-owner-verify', assurance: 'verified'
    })
    const verifiedChallenge = await service.getEndpointChallenge(owner.user, String(endpointChallenge.challengeId))
    const ownerEndpointId = String(verifiedChallenge.humanEndpointId)
    const ownerEndpoint: HumanEndpointActor = {
      kind: 'human_endpoint', actorKey: `endpoint:${ownerEndpointId}:test`, userId: owner.userId,
      humanEndpointId: ownerEndpointId, assurance: 'verified'
    }
    const projectLocator = {
      type: 'provider_locator' as const, provider: 'zulip', realmId: 'realm-meeting',
      containerId: 'stream-meeting', topicId: 'topic-meeting', topicDisplayName: 'Meeting decisions'
    }
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'meeting-owner')
    const workerAgent = await registeredAgent(service, worker.user, worker.deviceId, 'meeting-worker')
    const workerHeartbeat = await heartbeatReadyAgent(
      service,
      workerAgent,
      'idem_worker_available_heartbeat_01'
    )
    const availability = await service.publishWorkerAvailability(workerAgent, {
      protocolVersion: '1.0', type: 'worker.availability.publish', requestId: 'req_worker_available_01',
      idempotencyKey: 'idem_worker_available_01', agentId: workerAgent.agentId,
      expectedAgentRevision: workerHeartbeat.revision, connectionStatus: 'online',
      lastHeartbeatAt: workerHeartbeat.lastSeenAt ?? null,
      runtimeReadiness: 'ready', runtimeCapabilityTags: RUNTIME_CAPABILITY_TAGS, acceptsNewOffers: true,
      activeTaskCount: 0, observedAt: at.toISOString()
    })
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_text_project_001',
      idempotencyKey: 'idem_text_project_001', displayName: 'Meeting synthesis',
      goal: 'Synthesize and approve meeting decisions.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }, { userId: worker.userId }] }
    })
    await service.bindProjectEndpoint(owner.user, {
      projectId: created.project.projectId, locator: projectLocator, expectedRevision: null,
      idempotencyKey: 'idem_meeting_project_endpoint_bind'
    })
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toEqual([])

    const runtimeProvenance = { runtimeId: 'runtime_meeting_coordinator', modelId: null,
      generatedByCoordinatorAgentId: coordinator.agentId, generatedAt: at.toISOString() }
    const tasks = [{ planItemId: 'item_meeting_summary', title: 'Summarize decisions',
      objective: 'Produce a bounded meeting decision summary.', completionCriteria: ['Owner can review it'],
      dependencyPlanItemIds: [], requiredCapabilityTags: ['research.execute'], fileIntent: null }]
    const planFacts = { projectId: created.project.projectId, expectedProjectRevision: 1,
      expectedCoordinatorAuthorityEpoch: 1, supersedesProjectPlanId: null,
      sourceInputLocators: [], tasks, rationale: 'One Worker can synthesize the meeting.', runtimeProvenance }
    const submittedPlan = await service.submitProjectPlan(coordinator, {
      protocolVersion: '1.0', type: 'project.plan.submit', requestId: 'req_plan_submit_001',
      idempotencyKey: 'idem_plan_submit_001', ...planFacts, planDigest: stableDigest(planFacts)
    })
    const confirmedPlan = await service.confirmProjectPlan(owner.user, {
      protocolVersion: '1.0', type: 'project.plan.confirm', requestId: 'req_plan_confirm_001',
      idempotencyKey: 'idem_plan_confirm_001', projectId: created.project.projectId,
      projectPlanId: submittedPlan.projectPlanId, expectedProjectRevision: 2,
      expectedCoordinatorAuthorityEpoch: 1, expectedPlanRevision: submittedPlan.revision,
      planDigest: submittedPlan.planDigest
    })
    const activeProject = await service.transitionProject(owner.user, {
      protocolVersion: '1.0', type: 'project.transition', requestId: 'req_project_active_001',
      idempotencyKey: 'idem_project_active_001', projectId: created.project.projectId,
      expectedRevision: 3, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, status: 'active'
    })
    const offered = await service.createTaskOffer(coordinator, {
      protocolVersion: '1.0', type: 'task.offer.create', requestId: 'req_offer_create_001',
      idempotencyKey: 'idem_offer_create_001', projectId: activeProject.projectId,
      expectedProjectRevision: activeProject.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, projectPlanId: confirmedPlan.projectPlanId,
      expectedPlanRevision: confirmedPlan.revision, planItemId: 'item_meeting_summary',
      assigneeAgentId: workerAgent.agentId, expectedAvailabilityRevision: availability.revision,
      offerExpiresAt: new Date(at.getTime() + 60_000).toISOString()
    })
    const accepted = await service.acceptTaskOffer(workerAgent, {
      protocolVersion: '1.0', type: 'task.offer.accept', requestId: 'req_offer_accept_001',
      idempotencyKey: 'idem_offer_accept_001', taskOfferId: offered.offer.taskOfferId,
      taskId: offered.task.taskId, executionId: offered.execution.executionId,
      expectedTaskRevision: offered.task.revision, expectedExecutionRevision: offered.execution.revision,
      expectedOfferRevision: offered.offer.revision
    })
    expect((await service.getTaskExecutionPreflight(workerAgent, {
      protocolVersion: '1.0', type: 'task.execution.preflight.get', requestId: 'req_preflight_001',
      taskId: accepted.task.taskId, executionId: accepted.execution.executionId,
      expectedTaskRevision: accepted.task.revision, expectedExecutionRevision: accepted.execution.revision
    })).decision).toEqual({ outcome: 'allowed', reasons: [] })
    const running = await service.startTaskExecution(workerAgent, {
      protocolVersion: '1.0', type: 'task.execution.start', requestId: 'req_execution_start_001',
      idempotencyKey: 'idem_execution_start_001', taskId: accepted.task.taskId,
      executionId: accepted.execution.executionId, expectedTaskRevision: accepted.task.revision,
      expectedExecutionRevision: accepted.execution.revision, startedAt: at.toISOString()
    })
    const workerRequest = await service.createHumanNeeded(workerAgent, {
      protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_worker_human_needed_1',
      idempotencyKey: 'idem_worker_human_needed_1', projectId: activeProject.projectId,
      context: {
        scope: 'worker_execution', taskId: running.task.taskId, executionId: running.execution.executionId,
        expectedTaskRevision: running.task.revision, expectedExecutionRevision: running.execution.revision
      },
      requiredAssurance: 'verified', prompt: 'Confirm the ambiguous input interpretation.',
      confirmableAction: null, expiresAt: new Date(at.getTime() + 60_000).toISOString()
    })
    expect(workerRequest.context).toEqual({
      scope: 'worker_execution', taskId: running.task.taskId, executionId: running.execution.executionId
    })
    await expect(service.answerHumanNeeded(worker.user, {
      protocolVersion: '1.0', type: 'human.answer', requestId: 'req_worker_human_answer_non_owner',
      idempotencyKey: 'idem_worker_human_answer_non_owner',
      humanRequestId: workerRequest.humanRequestId,
      requestRevision: workerRequest.revision,
      answer: 'A non-Owner must not answer this request.'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const stillPending = await service.readProjectCoordination(owner.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_worker_human_pending_read',
      projectId: activeProject.projectId,
      collections: [{ collection: 'pending_human_needed', limit: 10 }]
    })
    expect(stillPending.pages.flatMap((page) => (
      page.collection === 'pending_human_needed' ? page.items : []
    ))).toEqual([expect.objectContaining({ humanRequestId: workerRequest.humanRequestId })])
    const workerAnswer = await service.answerHumanNeeded(owner.user, {
      protocolVersion: '1.0', type: 'human.answer', requestId: 'req_worker_human_answer_1',
      idempotencyKey: 'idem_worker_human_answer_1', humanRequestId: workerRequest.humanRequestId,
      requestRevision: workerRequest.revision, answer: 'Interpret it using the frozen baseline.'
    })
    expect(workerAnswer.context).toEqual(workerRequest.context)
    const afterAnswer = await service.readProjectCoordination(owner.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_worker_human_answer_read',
      projectId: activeProject.projectId,
      collections: [
        { collection: 'pending_human_needed', limit: 10 },
        { collection: 'tasks', limit: 10 },
        { collection: 'executions', limit: 10 }
      ]
    })
    expect(afterAnswer.pages.flatMap((page) => (
      page.collection === 'pending_human_needed' ? page.items : []
    ))).toEqual([])
    expect(afterAnswer.pages.flatMap((page) => page.collection === 'tasks' ? page.items : []))
      .toEqual([expect.objectContaining({ status: 'in_progress' })])
    expect(afterAnswer.pages.flatMap((page) => page.collection === 'executions' ? page.items : []))
      .toEqual([expect.objectContaining({ state: 'running' })])
    const resumedTask = (await repository.getTask(running.task.taskId))!
    const resumedExecution = (await repository.getTaskExecution(running.execution.executionId))!
    expect(resumedTask.status).toBe('in_progress')
    expect(resumedExecution.state).toBe('running')
    const resultFacts = { taskId: running.task.taskId, executionId: running.execution.executionId,
      expectedTaskRevision: resumedTask.revision, expectedExecutionRevision: resumedExecution.revision,
      summary: 'The meeting froze one Coordinator Agent and dynamic Worker membership.',
      runtimeProvenance: { runtimeId: 'runtime_meeting_worker', modelId: null,
        startedAt: at.toISOString(), completedAt: at.toISOString() }, outputs: [], recoveryJournalEntryIds: [] }
    const result = await service.submitTaskResult(workerAgent, {
      protocolVersion: '1.0', type: 'task.result.submit', requestId: 'req_result_submit_001',
      idempotencyKey: 'idem_result_submit_001', ...resultFacts, submissionDigest: stableDigest(resultFacts)
    })
    const reviewCommand = {
      protocolVersion: '1.0', type: 'task.result.review', requestId: 'req_result_review_001',
      idempotencyKey: 'idem_result_review_001', projectId: activeProject.projectId,
      taskId: result.task.taskId, executionId: result.execution.executionId,
      resultSubmissionId: result.submission.resultSubmissionId,
      expectedProjectRevision: (await repository.getProject(activeProject.projectId))!.revision,
      expectedTaskRevision: result.task.revision, expectedExecutionRevision: result.execution.revision,
      expectedResultRevision: result.submission.revision, expectedCoordinatorAuthorityEpoch: 1,
      decision: 'accept', instruction: null, nextAssigneeAgentId: null,
      expectedNextAssigneeAvailabilityRevision: null, nextOfferExpiresAt: null, nextFileIntent: null
    } satisfies Extract<CloudStateCommand, { type: 'task.result.review' }>
    await expect(service.reviewTaskResult(workerAgent, {
      ...reviewCommand,
      idempotencyKey: 'idem_result_review_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const reviewed = await service.reviewTaskResult(coordinator, reviewCommand)
    expect(reviewed).toMatchObject({ task: { status: 'completed' },
      execution: { state: 'completed', fence: { status: 'fenced', reason: 'completed' } },
      review: { decision: 'accept', decidedByUserId: owner.userId,
        decidedByCoordinatorAgentId: coordinator.agentId } })
    const observation = await repository.getProjectRecord(reviewed.review.acceptedProjectRecordId!)
    expect(observation).toMatchObject({
      kind: 'observation',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceTaskId: result.task.taskId,
      sourceResultSubmissionId: result.submission.resultSubmissionId,
      sourceHumanAnswerId: undefined
    })
    const projectAfterReview = (await repository.getProject(activeProject.projectId))!
    const coordinatorRequestCommand = {
      protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_human_needed_001',
      idempotencyKey: 'idem_human_needed_001', projectId: activeProject.projectId,
      context: {
        scope: 'coordinator_project', expectedProjectRevision: projectAfterReview.revision,
        expectedCoordinatorAuthorityEpoch: projectAfterReview.coordinatorAuthorityEpoch
      },
      requiredAssurance: 'verified', prompt: 'Which confirmed decision should lead the summary?',
      confirmableAction: null, expiresAt: new Date(at.getTime() + 60_000).toISOString()
    } satisfies Extract<import('@sciforge/collaboration-contracts').RestRequest, { type: 'human.needed.create' }>
    await expect(service.createHumanNeeded(workerAgent, {
      ...coordinatorRequestCommand,
      idempotencyKey: 'idem_human_needed_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const humanRequest = await service.createHumanNeeded(coordinator, coordinatorRequestCommand)
    expect(humanRequest.context).toEqual({ scope: 'coordinator_project', coordinatorAuthorityEpoch: 1 })
    const humanAnswer = await service.answerHumanNeeded(ownerEndpoint, {
      protocolVersion: '1.0', type: 'human.answer', requestId: 'req_human_answer_001',
      idempotencyKey: 'idem_human_answer_001', humanRequestId: humanRequest.humanRequestId,
      requestRevision: humanRequest.revision, answer: 'Lead with the frozen role boundary.',
      sourceLocator: projectLocator
    })
    expect(humanAnswer.context).toEqual({ scope: 'coordinator_project', coordinatorAuthorityEpoch: 1 })
    expect(humanAnswer.answeredFrom).toEqual({ type: 'human_endpoint', humanEndpointId: ownerEndpointId })
    const coordinatorInbox = await service.pullInbox(coordinator, { afterSequence: 0, limit: 200 })
    expect(coordinatorInbox.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageType: 'human.answer.received',
        payload: expect.objectContaining({
          answer: expect.objectContaining({ humanAnswerId: humanAnswer.humanAnswerId })
        })
      })
    ]))
    const decisionCommand = {
      protocolVersion: '1.0', type: 'project.decision.submit', requestId: 'req_project_decision_001',
      idempotencyKey: 'idem_project_decision_001', projectId: activeProject.projectId,
      humanRequestId: humanRequest.humanRequestId, humanAnswerId: humanAnswer.humanAnswerId,
      expectedProjectRevision: projectAfterReview.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedHumanRequestRevision: humanRequest.revision + 1,
      expectedHumanAnswerRevision: humanAnswer.revision,
      decision: 'The frozen Coordinator boundary will lead the meeting summary.'
    } satisfies Extract<CloudStateCommand, { type: 'project.decision.submit' }>
    await expect(service.submitProjectDecision(workerAgent, {
      ...decisionCommand,
      idempotencyKey: 'idem_project_decision_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const decision = await service.submitProjectDecision(coordinator, decisionCommand)
    expect(decision.record).toMatchObject({
      kind: 'decision',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceTaskId: undefined,
      sourceHumanAnswerId: humanAnswer.humanAnswerId,
      sourceResultSubmissionId: undefined
    })
    await expect(service.submitProjectDecision(coordinator, {
      ...decisionCommand,
      idempotencyKey: 'idem_project_decision_duplicate_answer',
      expectedProjectRevision: decision.project.revision
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    const acceptedRead = await service.readProjectCoordination(owner.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_result_accept_read',
      projectId: activeProject.projectId,
      collections: [
        { collection: 'tasks', limit: 10 },
        { collection: 'executions', limit: 10 },
        { collection: 'result_submissions', limit: 10 },
        { collection: 'review_decisions', limit: 10 },
        { collection: 'project_records', limit: 10 }
      ]
    })
    expect(acceptedRead.pages.flatMap((page) => (
      page.collection === 'review_decisions' ? page.items : []
    ))).toEqual([expect.objectContaining({
      resultSubmissionId: result.submission.resultSubmissionId,
      decision: 'accept'
    })])
    expect(acceptedRead.pages.flatMap((page) => (
      page.collection === 'project_records' ? page.items : []
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'observation', projectRecordId: observation!.projectRecordId }),
      expect.objectContaining({ kind: 'decision', projectRecordId: decision.record.projectRecordId })
    ]))
    const finalSummaryCommand = {
      protocolVersion: '1.0', type: 'project.final_summary.submit', requestId: 'req_final_summary_001',
      idempotencyKey: 'idem_final_summary_001', projectId: activeProject.projectId,
      expectedProjectRevision: decision.project.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, projectPlanId: confirmedPlan.projectPlanId,
      confirmedPlanRevision: confirmedPlan.revision,
      acceptedResultSubmissionIds: [result.submission.resultSubmissionId],
      summary: 'The meeting completed with a confirmed plan, Human answer, and accepted Worker result.'
    } satisfies Extract<CloudStateCommand, { type: 'project.final_summary.submit' }>
    await expect(service.submitProjectFinalSummary(workerAgent, {
      ...finalSummaryCommand,
      idempotencyKey: 'idem_final_summary_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const final = await service.submitProjectFinalSummary(coordinator, finalSummaryCommand)
    expect(final).toMatchObject({ project: { status: 'completed', executionAuthorityEpoch: 2 },
      finalSummary: { createdByUserId: owner.userId,
        acceptedResultSubmissionIds: [result.submission.resultSubmissionId] } })
    expect(final.record).toMatchObject({
      kind: 'summary',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceResultSubmissionId: undefined,
      sourceHumanAnswerId: undefined
    })
    expect(final.record.sourceTaskId).toBeUndefined()
    expect((await repository.listProjectRecords(activeProject.projectId, true)).map((record) => record.kind))
      .toEqual(['observation', 'decision', 'summary'])
    const completedRead = await service.readProjectCoordination(owner.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_final_summary_read',
      projectId: activeProject.projectId,
      collections: [
        { collection: 'plans', limit: 10 },
        { collection: 'tasks', limit: 10 },
        { collection: 'executions', limit: 10 },
        { collection: 'result_submissions', limit: 10 },
        { collection: 'review_decisions', limit: 10 },
        { collection: 'project_records', limit: 10 }
      ]
    })
    expect(completedRead.project.status).toBe('completed')
    expect(completedRead.finalSummary).toMatchObject({
      projectRecordId: final.record.projectRecordId,
      acceptedResultSubmissionIds: [result.submission.resultSubmissionId]
    })
  })
})
