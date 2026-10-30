import { createProjectCoordinatorCapabilityFactory, type ProjectCoordinatorCapabilityOptions } from '../main.js'
import assert from 'node:assert/strict'
import test from 'node:test'

import { PROJECT_COORDINATOR_CAPABILITY_IDS } from '../contract.js'
import { DELIVERY_CONTENT_ACTIONS } from '../delivery-content-contract.js'
import {
  createProjectCoordinatorRendererClient,
  ProjectCoordinatorRequirementsCompletionClientError
} from './project-coordinator-capability-client.js'
import { subscribeProjectCoordinatorWorkspaceInvalidation } from './workspace-invalidation.js'

test('coordination reads forward cancellation signals to the generic capability broker', async () => {
  const controller = new AbortController()
  const received: AbortSignal[] = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (_contract, _input, options) => {
      if (options?.signal) received.push(options.signal)
      return undefined as never
    }
  })

  await client.readWorkspace({}, { signal: controller.signal })
  await client.readSessionProjection({ signal: controller.signal })
  assert.deepEqual(received, [controller.signal, controller.signal])
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

test('Delivery object content reads bind the issued resource handle', async () => {
  const resource = { token: 'delivery-object-token', semanticRevision: 'obj_1:2:sha', expiresAt: '2026-10-16T01:00:00.000Z' }
  const invoked: Array<Readonly<{ actionId: string; input: unknown; resource: unknown }>> = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input, options) => {
      invoked.push({ actionId: contract.actionId, input, resource: options?.resource })
      return undefined as never
    }
  })
  await client.describeDeliveryObject(resource)
  await client.readDeliveryObjectRange(resource, { range: { offset: 0, length: 128 } })
  assert.deepEqual(invoked, [
    { actionId: DELIVERY_CONTENT_ACTIONS.describe, input: {}, resource },
    { actionId: DELIVERY_CONTENT_ACTIONS.readRange, input: { range: { offset: 0, length: 128 } }, resource }
  ])
})


test('requirements completion retains typed reasons and specific user-facing messages', async () => {
  for (const [reason, message] of [
    ['completion_in_progress', /已有补全正在进行/u],
    ['write_failed', /写入云端失败/u],
    ['runtime_unavailable', /Runtime 不可用/u],
    ['placeholder_generated_content', /含纯标点或占位内容，每项须包含文字或数字，请重新补全/u]
  ] as const) {
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('not observed') },
      invoke: async () => ({ status: 'failed', reason }) as never
    })
    await assert.rejects(client.completeRequirements({ projectId: 'prj_Requirements01' }), (cause: unknown) => {
      assert.ok(cause instanceof ProjectCoordinatorRequirementsCompletionClientError)
      assert.equal(cause.reason, reason)
      assert.match(cause.message, message)
      return true
    })
  }
})

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
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) {
        return { status: 'completed', document: undefined } as never
      }
      return undefined as never
    }
  })

  await client.openDeliveryObject(undefined as never)
  await client.readWorkspace(undefined)
  await client.createProject(undefined as never)
  await client.deleteProject(undefined as never)
  await client.acknowledgeProjectActivation(undefined as never)
  await client.readSessionOwnership()
  await client.readSessionProjection()
  await client.saveRequirementsDraft(undefined as never)
  await client.completeRequirements(undefined as never)
  await client.confirmRequirements(undefined as never)
  await client.withdrawTaskOffer(undefined as never)
  await client.extendTaskOffer(undefined as never)
  await client.reassignTaskOffer(undefined as never)
  await client.addMember(undefined as never)
  await client.acceptInvitation(undefined as never)
  await client.removeMember(undefined as never)
  await client.createHumanNeeded(undefined as never)
  await client.answerHumanNeeded(undefined as never)
  await client.transferCoordinator(undefined as never)
  await client.readDelivery(undefined as never)
  await client.listDrive(undefined as never)
  await client.decideAdoption(undefined as never)
  await client.requestRevision(undefined as never)
  await client.publishResult(undefined as never)
  await client.completeProject(undefined as never)

  // Resource-scoped byte reads are only invocable through an issued Delivery
  // object handle; the plain renderer client cannot reach them directly.
  assert.deepEqual(
    definitions.filter(({ scope }) => scope === 'resource').map(({ id, approval }) => ({ actionId: id, approval })),
    [
      { actionId: DELIVERY_CONTENT_ACTIONS.describe, approval: 'none' },
      { actionId: DELIVERY_CONTENT_ACTIONS.readRange, approval: 'none' }
    ]
  )
  assert.deepEqual(
    invoked,
    definitions.filter(({ scope }) => scope !== 'resource').map(({ id: actionId, approval }) => ({ actionId, approval }))
  )
})
