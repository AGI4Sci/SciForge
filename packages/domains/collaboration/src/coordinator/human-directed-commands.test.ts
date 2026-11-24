import assert from 'node:assert/strict'
import test from 'node:test'
import { createHumanDirectedCommands } from './human-directed-commands.js'
import type { ProjectCoordinatorWorkspace } from './contract.js'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'

function fixture(overrides: { owner?: string; mode?: string; key?: string; status?: string; device?: string } = {}) {
  const deferred: unknown[] = []
  const retried: string[] = []
  const projectId = 'prj_TestProject0001'
  const key = 'a'.repeat(64)
  const workspace = { connection: { state: 'ready', userId: 'usr_Owner000001', deviceId: overrides.device ?? 'dev_Owner000001' }, projects: [{
    project: { projectId, ownerUserId: overrides.owner ?? 'usr_Owner000001', executionMode: overrides.mode ?? 'ai_leader', status: overrides.status ?? 'active' },
    leaderProposal: { key: overrides.key ?? key }
  }] } as unknown as ProjectCoordinatorWorkspace
  const service = createHumanDirectedCommands({
    transport: { status: () => ({ state: 'ready', userId: 'usr_Owner000001', deviceId: 'dev_Owner000001' }) } as AuthenticatedCloudTransport,
    workspace: { readWorkspace: async () => workspace },
    dispatch: { reconcileProject: async () => { throw new Error('Deferral must not dispatch.') }, reconcileVisibleProjects: async () => undefined },
    retryProposal: async id => { retried.push(id) },
    deferProposal: async (id, proposalKey) => { deferred.push({ projectId: id, key: proposalKey }) }
  })
  return { service, deferred, retried, projectId, key, workspace }
}

test('Owner defers the exact current recommendation without dispatching or writing Cloud state', async () => {
  const f = fixture()
  assert.equal(await f.service.deferLeaderProposal(f.projectId, f.key), f.workspace)
  assert.deepEqual(f.deferred, [{ projectId: f.projectId, key: f.key }])
})
for (const overrides of [{ owner: 'usr_Other000001' }, { mode: 'manual' }, { key: 'b'.repeat(64) }]) {
  test(`deferral rejects stale authority or proposal ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(overrides)
    await assert.rejects(f.service.deferLeaderProposal(f.projectId, f.key), /current Owner/)
    assert.deepEqual(f.deferred, [])
  })
}


test('Owner can retry recommendation planning without dispatch authority', async () => {
  const f = fixture()
  await f.service.retryLeaderProposal(f.projectId)
  assert.deepEqual(f.retried, [f.projectId])
  assert.deepEqual(f.deferred, [])
})
for (const overrides of [{ owner: 'usr_Other000001' }, { mode: 'manual' }, { device: 'dev_Other000001' }, { status: 'completed' }, { status: 'cancelled' }]) {
  test(`leader retry rejects changed authority ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(overrides)
    await assert.rejects(f.service.retryLeaderProposal(f.projectId), /current Owner/)
    assert.deepEqual(f.retried, [])
  })
}

for (const status of ['draft', 'paused', 'active']) {
  test(`Owner explicitly requests planning in ${status} without changing project or dispatching`, async () => {
    const f = fixture({ status })
    const before = structuredClone(f.workspace)
    await f.service.retryLeaderProposal(f.projectId)
    assert.deepEqual(f.retried, [f.projectId])
    assert.deepEqual(f.workspace, before)
  })
}

for (const mode of ['manual', 'ai_leader'] as const) {
  test(`UI dispatch authorization follows committed ${mode} mode and preserves the exact requirements tuple`, async () => {
    const projectId = 'prj_ManualStartup01'
    const calls: any[] = []
    const reconciled: string[] = []
    const project = {
      schemaVersion: 1, type: 'project', revision: 7,
      createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z',
      projectId, ownerUserId: 'usr_Owner0000001', displayName: 'Startup', goal: 'Work',
      coordinatorAgentId: 'agt_Coordinator01', coordinatorAuthorityEpoch: 2, executionAuthorityEpoch: 3,
      status: 'paused', executionMode: mode, dispatchAuthorization: null,
      budget: { maxTasks: 8, maxTasksPerRound: 4, maxTaskRetries: 2, maxCoordinationRounds: 4 }
    }
    const workspace = { projects: [{ project, memberships: [] }] } as unknown as ProjectCoordinatorWorkspace
    const transport = {
      execute: async ({ payload: command }: any) => {
        calls.push(command)
        if (command.type === 'project.transition') {
          assert.equal(command.expectedRevision, 7)
          assert.equal(command.expectedCoordinatorAuthorityEpoch, 2)
          assert.equal(command.expectedExecutionAuthorityEpoch, 3)
          project.status = 'active'
        }
        return { status: 200, body: { protocolVersion: '1.0', type: 'rest.entity', entity: project } }
      }
    } as unknown as AuthenticatedCloudTransport
    const service = createHumanDirectedCommands({ transport, workspace: { readWorkspace: async () => workspace }, deferProposal: async () => {},
      dispatch: { reconcileProject: async id => { reconciled.push(id) }, reconcileVisibleProjects: async () => {} } })
    const input = { projectId, expectedRevision: 6, requirementsDocumentId: 'rqd_ManualStartup000000001',
      requirementsDocumentRevision: 4, requirementsContentDigest: 'a'.repeat(64),
      assignments: [{ planItemId: 'item_Startup01', workerUserId: 'usr_Worker000001' }], expiresAt: '2026-11-17T00:00:00.000Z' }
    await service.execute('project.dispatch.authorize', input, 'idem_manual-startup01', true)
    assert.deepEqual(calls[0], { ...input, protocolVersion: '1.0', requestId: calls[0].requestId,
      type: 'project.dispatch.authorize', idempotencyKey: 'idem_manual-startup01' })
    assert.deepEqual(calls.map(command => command.type), mode === 'manual' ? ['project.dispatch.authorize', 'project.transition'] : ['project.dispatch.authorize'])
    assert.deepEqual(reconciled, mode === 'manual' ? [] : [projectId])
  })
}
