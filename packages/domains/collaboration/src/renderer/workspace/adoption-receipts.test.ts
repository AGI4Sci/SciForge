import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IntegrationReceipt } from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import { reconcileAdoptionReceipts } from './adoption-receipts.js'

function fixture() {
  const receipt = { projectId: 'project', taskId: 'task', deliveryManifestId: 'manifest', disposition: 'adopted' } as IntegrationReceipt
  const workspace = { focusedProjectId: 'project', connection: { state: 'ready', userId: 'owner' }, projects: [{ project: { projectId: 'project', ownerUserId: 'owner' }, tasks: [{ task: { taskId: 'task', status: 'awaiting_review', currentExecutionId: 'execution' }, delivery: { manifest: { deliveryManifestId: 'manifest', executionId: 'execution' }, receipt: null, revisionRequest: null }, executions: [] }] }] } as unknown as ProjectCoordinatorWorkspace
  return { receipt, workspace }
}

test('an exact successful receipt keeps adoption through stale reads and retires when authoritative facts catch up', () => {
  const { receipt, workspace } = fixture()
  const first = reconcileAdoptionReceipts(workspace, [receipt])
  assert.equal(first.workspace.projects[0]!.tasks[0]!.task.status, 'completed')
  assert.equal(first.workspace.projects[0]!.tasks[0]!.delivery!.receipt, receipt)
  assert.deepEqual(first.pending, [receipt])
  const stale = reconcileAdoptionReceipts(structuredClone(workspace), first.pending)
  assert.equal(stale.workspace.projects[0]!.tasks[0]!.delivery!.receipt, receipt)
  const caughtUp = reconcileAdoptionReceipts(first.workspace, first.pending)
  assert.deepEqual(caughtUp.pending, [])
  assert.equal(workspace.projects[0]!.tasks[0]!.task.status, 'awaiting_review')
})

for (const drift of ['principal', 'project', 'task', 'manifest', 'execution', 'revision', 'receipt', 'terminal'] as const) {
  test(`adoption receipt cannot override ${drift} drift`, () => {
    const { receipt, workspace } = fixture()
    const changed = structuredClone(workspace) as any
    const view = changed.projects[0].tasks[0]
    if (drift === 'principal') changed.connection.userId = 'other'
    if (drift === 'project') (receipt as any).projectId = 'other'
    if (drift === 'task') (receipt as any).taskId = 'other'
    if (drift === 'manifest') view.delivery.manifest.deliveryManifestId = 'new'
    if (drift === 'execution') view.task.currentExecutionId = 'new'
    if (drift === 'revision') view.delivery.revisionRequest = { deliveryManifestId: 'manifest' }
    if (drift === 'receipt') view.delivery.receipt = { disposition: 'rejected' }
    if (drift === 'terminal') view.task.status = 'cancelled'
    const result = reconcileAdoptionReceipts(changed, [receipt])
    assert.deepEqual(result.workspace.projects[0]!.tasks, changed.projects[0].tasks)
    assert.deepEqual(result.pending, [])
  })
}
