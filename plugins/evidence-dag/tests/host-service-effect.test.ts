import { it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { HostServiceProviderRegistry } from '@sciforge/plugin-sdk'

it('authenticates read capability effect before Evidence operation dispatch', async () => {
  const root = join(tmpdir(), `evidence-effect-${process.pid}`)
  const options = { executable: '/bin/false', wheelPath: '/dev/null', wheelSha256: '0'.repeat(64), storageRoot: join(root, 'state'), home: root, tmpDir: root, reasoner: async () => '{}' }
  let reads = 0
  let reasonerCalls = 0
  const artifactCalls: string[] = []
  const scope = { runtimeId: 'runtime', threadId: 'thread', workspaceRoot: join(root, 'workspace') }
  const production = createEvidenceProductionService({
    identity: { pluginId: 'evidence', version: '1', profileId: 'profile' },
    storageRoot: join(root, 'state'),
    clientModule: 'unused',
    worker: { ...options, reasoner: async () => { reasonerCalls++; return '{}' } },
    threads: { read: async () => { reads++; return { ...scope, watermark: '1', trace: [] } }, list: async () => [] },
    artifacts: { invoke: async operation => { artifactCalls.push(operation); return {} } },
  })
  const workerRequests = vi.spyOn(production.worker, 'request')
  const registry = new HostServiceProviderRegistry(production.providers)
  const owner = { connectionId: 'connection', pluginId: 'evidence', packageName: 'evidence', version: '1', generation: 1, invocationId: 'invocation', authority: { caller: { workspaceId: scope.workspaceRoot }, ordinarySession: scope, capabilityId: 'evidence.snapshot-status', effect: 'read' } }
  const base = { serviceId: 'evidenceDagPorts', owner, assertCurrent() {}, signal: new AbortController().signal }
  try {
    await registry.dispatch({ ...base, requestId: 'read', operation: 'threads.read', input: { protocol: 'sciforge-evidence-ports.v1', identity: production.providers.evidenceDagPorts ? { pluginId: 'evidence', version: '1', profileId: 'profile' } : {}, operation: 'threads.read', scope, input: {} } })
    expect(reads).toBe(1)
    const writeOwner = { ...owner, authority: { ...owner.authority, effect: 'workspace-write' } }
    for (const operation of ['threads.read', 'threads.list', 'artifacts.read', 'artifacts.listEvents', 'artifacts.commit']) {
      await registry.dispatch({ ...base, owner: writeOwner, requestId: `write-${operation}`, operation, input: { protocol: 'sciforge-evidence-ports.v1', identity: { pluginId: 'evidence', version: '1', profileId: 'profile' }, operation, scope, input: {} } })
    }
    expect(reads).toBe(2)
    expect(artifactCalls).toEqual(['artifacts.read', 'artifacts.listEvents', 'artifacts.commit'])
    await expect(registry.dispatch({ ...base, requestId: 'write', operation: 'sidecar.commitSnapshot', input: { protocol: 'sciforge-evidence-ports.v1', identity: { pluginId: 'evidence', version: '1', profileId: 'profile' }, operation: 'sidecar.commitSnapshot', scope, input: {} } })).rejects.toThrow(/effect|authorized|read/i)
    expect(reasonerCalls).toBe(0)
    expect(workerRequests).not.toHaveBeenCalled()
    expect(production.worker.pid).toBeUndefined()
    for (const [operation, effect] of [
      ['artifacts.commit', 'read'], ['threads.read', 'compute'], ['threads.read', 'unknown'], ['threads.read', undefined], ['sidecar.extract', 'read'], ['sidecar.commitSnapshot', 'compute'], ['artifacts.commit', undefined], ['unknown.operation', 'workspace-write']
    ] as const) {
      const requestOwner = { ...owner, authority: { ...owner.authority, effect } }
      await expect(registry.dispatch({ ...base, owner: requestOwner, requestId: `bad-${operation}`, operation, input: { protocol: 'sciforge-evidence-ports.v1', identity: { pluginId: 'evidence', version: '1', profileId: 'profile' }, operation, scope, input: {} } })).rejects.toThrow(/effect|authorized|operation/i)
    }
    expect(reasonerCalls).toBe(0)
    expect(reads).toBe(2)
    expect(artifactCalls).toEqual(['artifacts.read', 'artifacts.listEvents', 'artifacts.commit'])
    expect(workerRequests).not.toHaveBeenCalled()
    expect(production.worker.pid).toBeUndefined()
  } finally { await production.close() }
})
