import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from '../main.js'
import { PROJECT_COORDINATOR_CAPABILITY_IDS } from '../contract.js'
import {
  createProjectCoordinatorRendererClient,
  ProjectCoordinatorPlanDraftGenerationClientError
} from './project-coordinator-capability-client.js'
import { subscribeProjectCoordinatorWorkspaceInvalidation } from './workspace-invalidation.js'

test('renderer invocation approvals stay aligned with the main capability definitions', async () => {
  const definitions = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {} as never,
    sessions: {} as never,
    projectCreation: {} as never
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
  await client.deleteProject(undefined as never)
  await client.acknowledgeProjectActivation(undefined as never)
  await client.readSessionProjection()
  await client.readPlanDraft(undefined as never)
  await client.generatePlanDraft(undefined as never)
  await client.editPlanDraft(undefined as never)
  await client.submitPlanDraft(undefined as never)
  await client.confirmPlan(undefined as never)
  await client.prepareWorkflow(undefined as never)
  await client.continueWorkflow(undefined as never)
  await client.reassignTaskOffer(undefined as never)
  await client.observeAndLinkRecovery(undefined as never)
  await client.abandonRecovery(undefined as never)
  await client.addMember(undefined as never)
  await client.acceptInvitation(undefined as never)
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

test('canonical create success invalidates readers without publishing optimistic Project data', async () => {
  let invalidations = 0
  const dispose = subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    invalidations += 1
  })
  const successful = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async () => ({}) as never
  })
  const failing = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async () => { throw new Error('canonical create failed') }
  })

  await successful.createProject(undefined as never)
  await assert.rejects(() => failing.createProject(undefined as never), /canonical create failed/u)
  dispose()

  assert.equal(invalidations, 1)
})

test('Task reassignment success invalidates mounted coordination-center readers', async () => {
  let invalidations = 0
  const dispose = subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    invalidations += 1
  })
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async () => ({}) as never
  })

  await client.reassignTaskOffer(undefined as never)
  dispose()

  assert.equal(invalidations, 1)
})

test('canonical delete invalidates only after a successful destructive invocation', async () => {
  const projectId = 'prj_CurrentProject1'
  let invalidations = 0
  const invoked: Array<Readonly<{
    actionId: string
    effect: string
    input: unknown
    approval: string | undefined
  }>> = []
  const dispose = subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    invalidations += 1
  })
  const successful = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input, options) => {
      invoked.push({
        actionId: contract.actionId,
        effect: contract.effect,
        input,
        approval: options?.approval?.mode
      })
      return { projectId, deleted: true } as never
    }
  })
  const failing = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async () => { throw new Error('canonical delete failed') }
  })

  try {
    assert.deepEqual(await successful.deleteProject({ projectId }), {
      projectId,
      deleted: true
    })
    await assert.rejects(
      () => failing.deleteProject({ projectId }),
      /canonical delete failed/u
    )
  } finally {
    dispose()
  }

  assert.equal(invalidations, 1)
  assert.deepEqual(invoked[0], {
    actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    effect: 'destructive',
    input: { projectId },
    approval: 'confirmation'
  })
})

test('renderer maps bounded Plan generation failures without exposing Runtime details', async () => {
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
