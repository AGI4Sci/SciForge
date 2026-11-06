import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { readExactEvidenceClosure } from './EvidenceClosurePanel'
import { createEvidenceDagResourceNavigationContribution } from './evidence-dag-right-panel-contribution'
import { evidenceDagActivationPayloadSchema } from '../contract'

const digest = `sha256:${'a'.repeat(64)}`, other = `sha256:${'b'.repeat(64)}`
function invoker(subject = { closureDigest: digest }) {
  const calls: unknown[] = []
  const host: DomainRendererCapabilityInvoker = {
    invoke: async <Input, Output>(contract: { actionId: string }, input: Input, options?: { workspaceId?: string }) => {
      calls.push({ actionId: contract.actionId, input, workspaceId: options?.workspaceId })
      return { subject, records: [], completeness: { complete: false, gapCodes: ['missing_delta'] }, freshness: 'unknown', source: 'evidence-dag' } as Output
    }, observe: async () => { throw new Error('not observed') }
  }
  return { host, calls }
}
test('exact closure reads use the existing owner, preserve gaps, and never call graph or write actions', async () => {
  const { host, calls } = invoker()
  const value = await readExactEvidenceClosure(host, '/workspace', digest)
  assert.equal(value.completeness.complete, false); assert.equal(value.freshness, 'unknown')
  assert.deepEqual(calls, [{ actionId: 'evidence-dag.audit-query', input: { subject: { closureDigest: digest } }, workspaceId: '/workspace' }])
})
test('wrong closure and absent workspace fail closed', async () => {
  await assert.rejects(readExactEvidenceClosure(invoker({ closureDigest: other }).host, '/workspace', digest), /不同闭包/)
  const { host, calls } = invoker()
  await assert.rejects(readExactEvidenceClosure(host, '', digest), /工作区/)
  await assert.rejects(readExactEvidenceClosure(host, '/workspace', 'invalid-digest'))
  assert.equal(calls.length, 0)
})
test('closure resource has its own exact target and cannot be mistaken for a current snapshot', () => {
  const navigation = createEvidenceDagResourceNavigationContribution()
  const resolve = (resource: unknown) => navigation.resolve({ resource } as Parameters<typeof navigation.resolve>[0])
  const value = resolve({ resourceKind: 'evidence-closure', resourceId: digest, integrity: { algorithm: 'sha256', expectedDigest: digest } })
  assert.deepEqual(value?.activation?.payload, { view: 'closure', closureDigest: digest })
  assert.equal(resolve({ resourceKind: 'evidence-closure', resourceId: digest, integrity: { algorithm: 'sha256', expectedDigest: other } }), null)
  assert.equal(evidenceDagActivationPayloadSchema.safeParse({ view: 'closure' }).success, false)
})
