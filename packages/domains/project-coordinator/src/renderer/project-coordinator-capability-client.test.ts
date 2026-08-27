import assert from 'node:assert/strict'
import test from 'node:test'

import { createProjectCoordinatorCapabilityFactory } from '../main.js'
import {
  createProjectCoordinatorRendererClient,
  ProjectCoordinatorPlanDraftGenerationClientError
} from './project-coordinator-capability-client.js'
import { PROJECT_COORDINATOR_CAPABILITY_IDS } from '../contract.js'

test('renderer invocation approvals stay aligned with the main capability definitions', async () => {
  const definitions = createProjectCoordinatorCapabilityFactory({
    defineCapability: (input) => input,
    ports: {} as never
  }).createDefinitions()
  const invoked: Array<Readonly<{ actionId: string; approval: 'none' | 'confirmation' }>> = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, _input, options) => {
      invoked.push({
        actionId: contract.actionId,
        approval: options?.approval?.mode ?? 'none'
      })
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate) {
        return { status: 'generated', draft: undefined } as never
      }
      return undefined as never
    }
  })

  await client.readWorkspace(undefined)
  await client.createProject(undefined as never)
  await client.readPlanDraft(undefined as never)
  await client.generatePlanDraft(undefined as never)
  await client.editPlanDraft(undefined as never)
  await client.submitPlanDraft(undefined as never)
  await client.confirmPlanAndActivate(undefined as never)
  await client.previewProvisioning(undefined as never)
  await client.applyProvisioning(undefined as never)
  await client.observeAndLinkRecovery(undefined as never)
  await client.abandonRecovery(undefined as never)
  await client.retryRecoverySuccessor(undefined as never)
  await client.addMember(undefined as never)
  await client.removeMember(undefined as never)
  await client.createHumanNeeded(undefined as never)
  await client.answerHumanNeeded(undefined as never)
  await client.transferCoordinator(undefined as never)
  await client.prepareArtifactReview(undefined as never, { workspaceId: 'workspace-1' })
  await client.reviewResult(undefined as never)
  await client.completeProject(undefined as never)

  assert.deepEqual(
    invoked,
    definitions.map(({ id: actionId, approval }) => ({ actionId, approval }))
  )
})

test('renderer maps bounded Plan generation failure reasons without exposing Runtime details', async () => {
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async () => ({
      status: 'failed',
      reason: 'invalid_structured_output'
    }) as never
  })

  await assert.rejects(
    client.generatePlanDraft(undefined as never),
    (error) => error instanceof ProjectCoordinatorPlanDraftGenerationClientError &&
      error.reason === 'invalid_structured_output' &&
      !error.message.includes('provider')
  )
})
