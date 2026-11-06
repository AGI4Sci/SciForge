import { createProjectCoordinatorCapabilityFactory, type ProjectCoordinatorCapabilityOptions } from '../main.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { TEST_IDS, TEST_TIMESTAMP, projectFixture } from '@sciforge/collaboration-contracts/testing'

import { PROJECT_COORDINATOR_CAPABILITY_IDS, projectCoordinatorWorkspaceSchema } from '../contract.js'
import { DELIVERY_CONTENT_ACTIONS } from '../delivery-content-contract.js'
import {
  createProjectCoordinatorRendererClient,
  ProjectCoordinatorCloudAccessError,
  ProjectCoordinatorRequirementsCompletionClientError,
  ProjectCoordinatorTransientFaultError
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

test('stale Project revisions are refreshed and replayed once', async () => {
  const projectId = 'prj_ReplayProject01'
  const invocations: Array<Readonly<{ actionId: string; input: unknown }>> = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invocations.push({ actionId: contract.actionId, input })
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        return { connection: { state: 'ready' }, projects: [{ project: { projectId, revision: 4, coordinatorAuthorityEpoch: 9 }, memberships: [] }] } as never
      }
      const stale = (input as Readonly<{ expectedProjectRevision?: number }>).expectedProjectRevision !== 4
      if (stale) {
        throw new Error('Handler for collaboration.adoption.decide failed: handler_failed: SciForge Cloud request failed: revision_conflict: The resource revision is stale.')
      }
      return { recorded: true } as never
    }
  })

  assert.deepEqual(await client.decideAdoption({
    projectId,
    expectedProjectRevision: 3,
    expectedCoordinatorAuthorityEpoch: 9
  } as never), { recorded: true })
  assert.deepEqual(invocations.map(({ actionId }) => actionId), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide
  ])
  assert.equal(
    (invocations[2]?.input as Readonly<{ expectedProjectRevision: number }>).expectedProjectRevision,
    4
  )
})

test('a repeated self-healing fault surfaces a localized message instead of the protocol error', async () => {
  const invocations: string[] = []
  const rejection = new Error('handler_failed: SciForge Cloud request failed: revision_conflict: The resource revision is stale.')
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract) => {
      invocations.push(contract.actionId)
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready' }, projects: [] } as never
      throw rejection
    }
  })

  await assert.rejects(() => client.addMember({ projectId: 'prj_ReplayProject02' } as never), (cause: unknown) => {
    assert.ok(cause instanceof ProjectCoordinatorTransientFaultError)
    assert.equal(cause.code, 'revision_conflict')
    assert.equal(cause.cause, rejection)
    assert.match(cause.message, /项目已被其他成员更新/u)
    return true
  })
  assert.deepEqual(invocations, [
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd
  ])
})

test('structured broker rejection reasons recover without depending on English messages', async () => {
  let writes = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready' }, projects: [] } as never
      if (++writes === 1) throw Object.assign(new Error('项目版本发生变化'), {
        code: 'handler_failed', details: { reasonCode: 'revision_conflict' }
      })
      return {} as never
    }
  })
  await client.addMember({ projectId: 'prj_StructuredRecovery' } as never)
  assert.equal(writes, 2)
})

test('membership removal recovery focuses the exact owner Project and Membership after invitation acceptance', async () => {
  const attempts: unknown[] = []
  const projectId = TEST_IDS.projectId
  const otherProjectId = 'prj_OtherOwnerProject01'
  const memberships = [
    { projectMembershipId: TEST_IDS.projectMembershipId, revision: 2, userId: TEST_IDS.secondUserId },
    { projectMembershipId: 'pmb_AnotherMember0001', revision: 5, userId: 'usr_AnotherUser00001' }
  ].map((entry) => ({
    ...entry, schemaVersion: 1, type: 'project_membership', projectId,
    createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    state: 'active', authorityEpoch: 1, activatedAt: TEST_TIMESTAMP,
    removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null
  }))
  // Match ports.ts: two owner Projects have no non-focused Membership facts.
  // Only the explicitly focused Project supplies its complete Membership list.
  const workspace = (focusedProjectId?: string) => projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP, availableWorkerUsers: [],
    ...(focusedProjectId ? { focusedProjectId } : {}),
    projects: [otherProjectId, projectId].map((id) => ({
      project: { ...projectFixture, projectId: id, ownerUserId: TEST_IDS.userId, revision: id === projectId ? 4 : 99 },
      plan: null, memberUsers: [], workerGroups: [], tasks: [], offers: [], deliveryDrive: null,
      records: [], pendingHumanNeeded: [], finalSummary: null,
      memberships: id === focusedProjectId && id === projectId ? memberships : []
    }))
  })
  assert.deepEqual(workspace().projects.map((view) => view.memberships), [[], []])
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        assert.deepEqual(input, { projectId })
        return workspace((input as { projectId: string }).projectId) as never
      }
      attempts.push(input)
      if (attempts.length % 2 === 1) throw Object.assign(new Error('stale membership'), { code: 'revision_conflict' })
      const command = input as { projectId: string; projectMembershipId: string; expectedProjectRevision: number; expectedMembershipRevision: number }
      assert.equal(command.projectId, projectId)
      assert.equal(command.expectedProjectRevision, 4)
      assert.equal(command.expectedMembershipRevision, memberships.find((member) => member.projectMembershipId === command.projectMembershipId)?.revision)
      return {} as never
    }
  })
  for (const membership of memberships) {
    await client.removeMember({ projectId, projectMembershipId: membership.projectMembershipId,
      expectedProjectRevision: 2, expectedMembershipRevision: 1 })
  }
  assert.deepEqual(attempts, memberships.flatMap(({ projectMembershipId, revision }) => [
    { projectId, projectMembershipId, expectedProjectRevision: 2, expectedMembershipRevision: 1 },
    { projectId, projectMembershipId, expectedProjectRevision: 4, expectedMembershipRevision: revision }
  ]))
})

test('structured business rejections take precedence over old fault names in diagnostic text', async () => {
  for (const priorFault of ['revision_conflict', 'cloud_timeout']) {
    const rejection = Object.assign(new Error(`permission_denied after ${priorFault}`), {
      code: 'handler_failed', details: { reasonCode: 'permission_denied' }
    })
    let attempts = 0
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('not observed') },
      invoke: async () => { attempts++; throw rejection }
    })
    await assert.rejects(client.createProject({} as never), error => error === rejection)
    assert.equal(attempts, 1)
  }
})

test('recovery reads share cancellation and never replay after cancellation', async () => {
  const controller = new AbortController()
  const reason = new Error('caller cancelled')
  const actions: string[] = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, _input, options) => {
      actions.push(contract.actionId)
      if (actions.length === 1) throw Object.assign(new Error('disconnected'), { code: 'authority_unverified' })
      assert.equal(options?.signal, controller.signal)
      controller.abort(reason)
      return { connection: { state: 'ready' }, projects: [] } as never
    }
  })
  await assert.rejects(client.readSessionProjection({ signal: controller.signal }), error => error === reason)
  assert.equal(actions.length, 2)
})

test('non-transient failures propagate without a replay', async () => {
  const invocations: string[] = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract) => {
      invocations.push(contract.actionId)
      throw new Error('canonical create failed')
    }
  })

  await assert.rejects(() => client.createProject({} as never), /canonical create failed/u)
  assert.deepEqual(invocations, [PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate])
})

test('Cloud access failures are localized without an extra renderer replay', async () => {
  for (const [code, message] of [
    ['cloud_unavailable', /无法连接云端/u],
    ['cloud_timeout', /超时/u],
    ['identity_required', /重新登录/u],
    ['device_required', /设备.*授权/u]
  ] as const) {
    let invocations = 0
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('not observed') },
      invoke: async () => {
        invocations += 1
        throw new Error(`Handler for collaboration.workspace.read failed: ${code}: internal transport text`)
      }
    })
    await assert.rejects(client.readWorkspace(), (error: unknown) => {
      assert.ok(error instanceof ProjectCoordinatorCloudAccessError)
      assert.equal(error.code, code)
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /Handler for|internal transport/u)
      return true
    })
    assert.equal(invocations, 1)
  }
})

test('structured broker Cloud access reasons are localized without replay', async () => {
  for (const code of ['cloud_unavailable', 'cloud_timeout', 'identity_required', 'device_required']) {
    let attempts = 0
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('not observed') },
      invoke: async () => {
        attempts++
        throw Object.assign(new Error('连接失败'), { code: 'handler_failed', details: { reasonCode: code } })
      }
    })
    await assert.rejects(client.readWorkspace(), error => error instanceof ProjectCoordinatorCloudAccessError && error.code === code)
    assert.equal(attempts, 1)
  }
})

test('failed recovery reads stop the mutation and report the actual Cloud error', async () => {
  const actions: string[] = []
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract) => {
      actions.push(contract.actionId)
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        throw Object.assign(new Error('connection failed'), { code: 'cloud_timeout' })
      }
      throw new Error('revision_conflict')
    }
  })
  await assert.rejects(client.addMember({ projectId: 'prj_ReplayProject02' } as never), (error: unknown) => {
    assert.ok(error instanceof ProjectCoordinatorCloudAccessError)
    assert.equal(error.code, 'cloud_timeout')
    return true
  })
  assert.deepEqual(actions, [PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead])
})

test('a different business rejection after recovery is not mislabeled as the original conflict', async () => {
  const rejection = new Error('permission_denied: Membership changes are not allowed.')
  let attempts = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready' }, projects: [] } as never
      if (++attempts === 1) throw new Error('revision_conflict')
      throw rejection
    }
  })
  await assert.rejects(client.addMember({ projectId: 'prj_ReplayProject02' } as never), error => error === rejection)
  assert.equal(attempts, 2)
})

test('a successful workspace read that reports unavailable authority cannot authorize a replay', async () => {
  for (const connection of [
    { state: 'identity_required' },
    { state: 'device_required', reason: 'Device unavailable' },
    { state: 'cloud_unavailable', reason: 'Network unavailable' },
    { state: 'cloud_unavailable', reasonCode: 'authority_unverified', reason: 'Device revalidation pending' }
  ] as const) {
    const actions: string[] = []
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('not observed') },
      invoke: async (contract) => {
        actions.push(contract.actionId)
        if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection, projects: [] } as never
        throw Object.assign(new Error('Connection interrupted'), { code: 'authority_unverified' })
      }
    })
    await assert.rejects(client.addMember({} as never), {
      code: 'reasonCode' in connection ? connection.reasonCode : connection.state
    })
    assert.deepEqual(actions, [PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead])
  }
})
