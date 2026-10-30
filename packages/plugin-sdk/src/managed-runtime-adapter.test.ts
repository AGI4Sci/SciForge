import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ManagedRuntimeAdapter } from './managed-runtime-adapter.js'

test('managed runtime adapter is fail-closed: only declared operations are discoverable', () => {
  const adapter = new ManagedRuntimeAdapter({
    namespace: 'mc',
    operations: { echo: { effect: 'read', approval: 'none', audiences: ['agent', 'system'] } }
  })
  const contracts = adapter.contracts(['echo', 'networkOp', 'unknown'])
  // undeclared / unknown operations are invisible (fail-closed) — never defaulted to read/none
  assert.equal(contracts.length, 1)
  assert.equal(contracts[0].capabilityId, 'mc.echo')
  assert.equal(contracts[0].effect, 'read')
  assert.equal(contracts[0].approval, 'none')
})

test('declared operations without explicit approval default to needs-approval (system)', () => {
  const adapter = new ManagedRuntimeAdapter({ namespace: 'mc', operations: { dangerous: {} } })
  const [contract] = adapter.contracts(['dangerous'])
  // no read+none declaration -> fail-closed: compute + system approval + system-only audience
  assert.equal(contract.effect, 'compute')
  assert.equal(contract.approval, 'system')
  assert.deepEqual(contract.audiences, ['system'])
})

test('a zero-declaration adapter exposes no operations (nothing defaults to open)', () => {
  const adapter = new ManagedRuntimeAdapter({ namespace: 'mc' })
  assert.equal(adapter.contracts(['readOnlyOp', 'networkOp']).length, 0)
})
