import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCollaborationRendererClient } from '../collaboration-capability-client.js'
import { createProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'
import { COLLABORATION_CAPABILITY_IDS } from '../../contract.js'
import { PROJECT_COORDINATOR_CAPABILITY_IDS } from '../../coordinator/contract.js'

function clients() {
  const calls: Array<{ id: string; input: unknown; approval?: unknown }> = []
  const invoker = async (contract: { actionId: string }, input: unknown, options?: unknown) => {
    calls.push({ id: contract.actionId, input, approval: options })
    if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) return { status: 'completed', document: {} }
    if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate) return {}
    return {}
  }
  const capabilityInvoker = { invoke: invoker }
  return { calls, coordinator: createProjectCoordinatorRendererClient(capabilityInvoker as never), collaboration: createCollaborationRendererClient(capabilityInvoker as never) }
}

test('workspace actions invoke the canonical capability IDs and confirmation policy', async () => {
  const { calls, coordinator, collaboration } = clients()
  await coordinator.createProject({} as never)
  await coordinator.saveRequirementsDraft({} as never)
  await coordinator.completeRequirements({} as never)
  await coordinator.confirmRequirements({} as never)
  await coordinator.addMember({} as never)
  await coordinator.acceptInvitation({} as never)
  await coordinator.reassignTaskOffer({} as never)
  await coordinator.answerHumanNeeded({} as never)
  await coordinator.decideAdoption({} as never)
  await coordinator.requestRevision({} as never)
  await collaboration.decideTaskOffer({} as never)
  await collaboration.submitWorkerDelivery({} as never)
  await collaboration.publishComment({} as never)
  assert.deepEqual(calls.map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide,
    PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest,
    COLLABORATION_CAPABILITY_IDS.taskOfferDecide,
    COLLABORATION_CAPABILITY_IDS.deliverySubmit,
    COLLABORATION_CAPABILITY_IDS.activityComment
  ])
  const confirmationIds = new Set<string>([PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm, PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept, PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign, PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide, PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest, COLLABORATION_CAPABILITY_IDS.taskOfferDecide, COLLABORATION_CAPABILITY_IDS.deliverySubmit, COLLABORATION_CAPABILITY_IDS.activityComment])
  const confirmed = calls.filter(({ id }) => confirmationIds.has(id)).every(({ approval }) => (approval as { approval?: { mode?: string } } | undefined)?.approval?.mode === 'confirmation')
  assert.equal(confirmed, true)
})
