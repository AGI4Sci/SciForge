import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshPluginPolicyEntrySchema, policyContracts, readDshPluginPolicy, writeDshPluginPolicy, type DshPluginPolicyEntry } from './dsh-plugin-policy'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const entry: DshPluginPolicyEntry = {
  packageName: '@example/port-plugin', version: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', hostApiRange: '^1.0.0',
  integrity: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), tools: {}, hostDependencies: [],
  publisherId: null, approvedAt: '2026-11-03T00:00:00Z', source: 'test'
}

describe('Host-owned persisted port policy', () => {
  it('keeps version one entries optional and projects immutable exact approved operations after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-port-policy-'))
    roots.push(root)
    const path = join(root, 'policy.json')
    await writeDshPluginPolicy(path, { schemaVersion: 1, approved: [entry, { ...entry, version: '1.0.1', declaredPorts: ['agent-threads.read'], ports: ['agent-threads.read'] }] })
    const policy = await readDshPluginPolicy(path)
    const contracts = policyContracts(policy)
    expect(contracts.get('@example/port-plugin@1.0.0')?.dshAuthorization).not.toHaveProperty('ports')
    const authorization = contracts.get('@example/port-plugin@1.0.1')?.dshAuthorization
    expect(authorization).toMatchObject({ packageName: entry.packageName, packageVersion: '1.0.1', ports: ['agent-threads.read'] })
    expect(Object.isFrozen(authorization?.ports)).toBe(true)
    policy.approved[1].ports?.push('other.read')
    expect(authorization?.ports).toEqual(['agent-threads.read'])
    await expect(writeDshPluginPolicy(path, { schemaVersion: 1, approved: [{ ...entry, ports: ['agent-threads.read', 'agent-threads.read'] }] })).rejects.toThrow()
    expect((await readDshPluginPolicy(path)).approved[1].ports).toEqual(['agent-threads.read'])
  })

  it.each([null, 'agent-threads.read', ['read'], [' agent-threads.read'], ['service.Read'], ['service.read', 'service.read'], ['s.'.repeat(70)], Array.from({ length: 65 }, (_, n) => `service.read-${n}`)])('rejects invalid approved ports %#', ports => {
    expect(dshPluginPolicyEntrySchema.safeParse({ ...entry, ports }).success).toBe(false)
  })
})

describe('Host-approved port policy', () => {
  it('retains declarations without projecting them as grants', () => {
    const parsed = dshPluginPolicyEntrySchema.parse({ ...entry, declaredPorts: ['view.capture'] })
    const contract = policyContracts({ schemaVersion: 1, approved: [parsed] }).get(`${entry.packageName}@1.0.0`)!
    expect(contract.dshAuthorization?.ports).toBeUndefined()
  })

  it('projects only explicit exact-version approvals', () => {
    const parsed = dshPluginPolicyEntrySchema.parse({ ...entry, declaredPorts: ['view.capture', 'view.list'], ports: ['view.list'] })
    const contracts = policyContracts({ schemaVersion: 1, approved: [parsed] })
    expect(contracts.get(`${entry.packageName}@1.0.0`)?.dshAuthorization?.ports).toEqual(['view.list'])
    expect(contracts.has(`${entry.packageName}@1.0.1`)).toBe(false)
  })

  it('rejects unknown grants, conflicting hostServices and malformed operations', () => {
    for (const extra of [
      { declaredPorts: ['view.list'], ports: ['view.capture'] },
      { ports: ['view.list'] },
      { declaredPorts: ['view.list'], hostServices: 'none' },
      { declaredPorts: ['view.list'], ports: ['view.list'], hostServices: 'none' },
      { declaredPorts: ['view.list', ' view.list '] },
      { declaredPorts: [''] }, { declaredPorts: [42] },
      { declaredPorts: Array.from({ length: 65 }, (_, i) => `op.${i}`) },
      { declaredPorts: [], unexpected: true }
    ]) expect(dshPluginPolicyEntrySchema.safeParse({ ...entry, ...extra }).success).toBe(false)
  })
})
