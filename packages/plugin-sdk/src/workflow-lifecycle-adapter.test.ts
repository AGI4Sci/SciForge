import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WorkflowLifecycleAdapter,
  WorkflowLifecycleAdapterError,
  WORKFLOW_CONTROLLED_OPERATIONS,
} from './workflow-lifecycle-adapter.js'

test('aligns lifecycle contract with the owned registry shape', () => {
  assert.deepEqual(WORKFLOW_CONTROLLED_OPERATIONS, ['dispose'])
})

test('generates namespaced discover contract for all five operations', () => {
  const adapter = new WorkflowLifecycleAdapter({ namespace: 'agent-teams-fixture', version: '0.2.0' })
  const contracts = adapter.contracts()
  assert.equal(contracts.length, 5)
  for (const operation of ['start', 'status', 'advance', 'cancel', 'dispose'] as const) {
    const contract = contracts.find((c) => c.operation === operation)
    assert.ok(contract, `missing contract for ${operation}`)
    assert.equal(contract.capabilityId, `agent-teams-fixture.${operation}`)
  }
  const start = contracts.find((c) => c.operation === 'start')!
  assert.equal(start.category, 'workflow')
  assert.ok(start.tags.includes('workflow'))
  assert.ok(start.tags.includes('lifecycle'))
  assert.deepEqual(start.audiences, ['agent', 'system'])
  assert.equal(start.effect, 'compute')
  assert.equal(start.approval, 'none')
})

test('dispose is host-controlled: system-only audience, lifecycle tag, fail-closed gate', () => {
  const adapter = new WorkflowLifecycleAdapter({ namespace: 'agent-teams-fixture' })
  const dispose = adapter.contracts().find((c) => c.operation === 'dispose')!
  assert.equal(dispose.category, 'lifecycle')
  assert.equal(dispose.hostControlled, true)
  assert.ok(dispose.tags.includes('host-controlled'))
  assert.deepEqual(dispose.audiences, ['system'])
  assert.equal(dispose.effect, 'destructive')
  assert.equal(dispose.approval, 'system')

  // ordinary agent/UI audience is rejected fail-closed
  for (const audience of ['agent', 'ui', undefined]) {
    assert.throws(
      () => adapter.requireHostAuthorized('dispose', audience),
      (error: unknown) => error instanceof WorkflowLifecycleAdapterError && error.code === 'host_controlled',
    )
  }
  // system audience passes
  assert.doesNotThrow(() => adapter.requireHostAuthorized('dispose', 'system'))
})

test('non-controlled operations are never gated by audience', () => {
  const adapter = new WorkflowLifecycleAdapter({ namespace: 'agent-teams-fixture' })
  for (const operation of ['start', 'status', 'advance', 'cancel'] as const) {
    assert.doesNotThrow(() => adapter.requireHostAuthorized(operation, 'agent'))
    assert.doesNotThrow(() => adapter.requireHostAuthorized(operation, undefined))
  }
})

test('validates fixed input structures per operation', () => {
  const adapter = new WorkflowLifecycleAdapter({ namespace: 'agent-teams-fixture' })
  assert.deepEqual(adapter.validate('start', { teamId: 'p4-test' }), { teamId: 'p4-test' })
  assert.deepEqual(
    adapter.validate('advance', { teamId: 'p4-test', expectedRevision: 0 }),
    { teamId: 'p4-test', expectedRevision: 0 },
  )
  assert.deepEqual(adapter.validate('status', { teamId: 'p4-test' }), { teamId: 'p4-test' })
})

test('rejects malformed input fail-closed', () => {
  const adapter = new WorkflowLifecycleAdapter({ namespace: 'agent-teams-fixture' })
  for (const [operation, input] of [
    ['start', { teamId: '' }],
    ['start', { failTaskId: 'fixture.prepare' }], // missing teamId
    ['start', { teamId: 'p4-test', failTaskId: 'not-a-task' }],
    ['advance', { teamId: 'p4-test' }], // missing expectedRevision
    ['advance', { teamId: 'p4-test', expectedRevision: -1 }],
    ['advance', { teamId: 'p4-test', expectedRevision: 1.5 }],
    ['status', { teamId: 42 }],
    ['dispose', { teamId: 'p4-test' }], // dispose accepts no fields
  ] as const) {
    assert.throws(
      () => adapter.validate(operation, input),
      (error: unknown) => error instanceof WorkflowLifecycleAdapterError && error.code === 'invalid_input',
    )
  }
})