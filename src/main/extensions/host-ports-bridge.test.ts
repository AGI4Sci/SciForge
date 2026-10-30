import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { CapabilityRegistry } from '../capabilities/registry'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

const name = 'ports-probe-plugin'
const dshRuntimeVersion = '0.2.0-rc.2'

const fixtureMain = `
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
function probeDescriptor(id) {
  return { contractVersion: 3, id, version: '1.0.0', title: id, description: 'Host ports bridge probe.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: ['ports-probe'] }
}
async function probe(input) {
  const ports = globalThis.__sciforgeHostPorts
  if (!ports) return { output: { ok: false, code: 'bridge_missing' } }
  const scopeRoot = input.scopeRoot ?? input.workspaceRoot
  try {
    const value = await ports.request({
      operation: input.operation,
      input: input.portInput ?? {},
      ...(input.scope !== false && typeof scopeRoot === 'string' ? { scope: { workspaceRoot: scopeRoot } } : {})
    })
    return { output: { ok: true, value } }
  } catch (error) {
    return { output: { ok: false, code: error?.code ?? 'unknown', message: error?.message } }
  }
}
export function getCapabilityDefinitions() {
  return [
    { descriptor: probeDescriptor('portsprobe.workspace'), handler: probe },
    { descriptor: { ...probeDescriptor('portsprobe.global'), scope: 'global' }, handler: probe }
  ]
}
`

async function createPortsFixture(options: Readonly<{
  ports?: readonly string[]
  versionKeyed?: boolean
  portsExecutor?: (execution: Readonly<{ operation: string; input: unknown; workspaceId: string }>) => Promise<unknown>
}> = {}): Promise<Readonly<{
  root: string
  service: DevelopmentExternalPluginService
  registry: CapabilityRegistry
  executions: Array<{ operation: string; input: unknown; workspaceId: string }>
  contracts: Map<string, PluginAdapterContract>
}>> {
  const root = await mkdtemp(join(tmpdir(), 'host-ports-bridge-'))
  temporaryDirectories.push(root)
  const plugin = join(root, 'plugins', name)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({
    name, version: '1.0.0', private: true, type: 'module',
    exports: { '.': './main.js' },
    dsh: { bundle: { patch: './patch.yml' } }
  }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'sciforge.adapter.json'), JSON.stringify({
    schemaVersion: 1, kind: 'capability', namespace: 'portsprobe', hostApiRange: '^1.0.0', permissions: [], reloadPolicy: 'live'
  }))
  await writeFile(join(plugin, 'main.js'), fixtureMain)
  const contract: PluginAdapterContract = {
    hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: {
      packageName: name, packageVersion: '1.0.0', dshRuntimeVersion,
      ...(options.ports ? { ports: [...options.ports] } : {})
    }
  }
  // The production loader keys contracts by exact name@version; direct
  // construction may still use the plain-name legacy key.
  const contracts = new Map<string, PluginAdapterContract>([
    [options.versionKeyed ? `${name}@1.0.0` : name, contract]
  ])
  const executions: Array<{ operation: string; input: unknown; workspaceId: string }> = []
  const service = new DevelopmentExternalPluginService({
    root: join(root, 'plugins'),
    userDataPath: join(root, 'data'),
    hostApiVersion: '1.0.0',
    dshRuntimeVersion,
    adapterContracts: contracts,
    portsExecutor: options.portsExecutor ?? (async (execution) => {
      executions.push(execution)
      return { executed: execution.operation, input: execution.input }
    })
  })
  await service.initialize()
  const registry = new CapabilityRegistry()
  await service.attachCapabilityRegistry(registry)
  await service.setEnabled(name, true)
  return { root, service, registry, executions, contracts }
}

describe('development plugin host ports bridge', () => {
  it('executes approved operations through the Host executor with the bound workspace', async () => {
    const { service, registry, executions } = await createPortsFixture({ ports: ['artifacts.commit', 'artifacts.read'] })
    try {
      const definition = registry.require('portsprobe.workspace')
      const caller = { caller: { workspaceId: '/ws/one' } } as never
      const result = await definition.handler(
        { workspaceRoot: '/ignored-by-host-binding', operation: 'artifacts.commit', portInput: { x: 1 } }, caller)
      expect(result.output).toEqual({
        ok: true,
        value: { executed: 'artifacts.commit', input: { x: 1 } }
      })
      expect(executions).toEqual([{ operation: 'artifacts.commit', input: { x: 1 }, workspaceId: '/ws/one' }])
      const read = await definition.handler({ operation: 'artifacts.read' }, caller)
      expect(read.output).toMatchObject({ ok: true, value: { executed: 'artifacts.read' } })
      expect(executions[1]).toMatchObject({ operation: 'artifacts.read', workspaceId: '/ws/one' })
    } finally {
      await service.dispose()
    }
  })

  it('executes approved operations when the host contract is keyed by exact name@version (production loader shape)', async () => {
    const { service, registry, executions } = await createPortsFixture({ ports: ['artifacts.read'], versionKeyed: true })
    try {
      const definition = registry.require('portsprobe.workspace')
      const result = await definition.handler(
        { operation: 'artifacts.read', portInput: { id: 7 } }, { caller: { workspaceId: '/ws/one' } } as never)
      expect(result.output).toMatchObject({ ok: true })
      expect(executions).toEqual([{ operation: 'artifacts.read', input: { id: 7 }, workspaceId: '/ws/one' }])
    } finally {
      await service.dispose()
    }
  })

  it('keeps the ports bridge wired across a candidate hot-swap generation change', async () => {
    const f = await createPortsFixture({ ports: ['artifacts.read'] })
    try {
      const caller = { caller: { workspaceId: '/ws/one' } } as never
      const first = await f.registry.require('portsprobe.workspace').handler({ operation: 'artifacts.read' }, caller)
      expect(first.output).toMatchObject({ ok: true })

      // An approved 1.0.1 candidate under the managed root; hot-swap applies it live.
      const candidate = join(f.root, 'plugins', '.candidates', 'v2')
      await mkdir(candidate, { recursive: true })
      await writeFile(join(candidate, 'package.json'), JSON.stringify({
        name, version: '1.0.1', private: true, type: 'module',
        exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } }
      }))
      await writeFile(join(candidate, 'patch.yml'), '[]')
      await writeFile(join(candidate, 'sciforge.adapter.json'), JSON.stringify({
        schemaVersion: 1, kind: 'capability', namespace: 'portsprobe', hostApiRange: '^1.0.0', permissions: [], reloadPolicy: 'live'
      }))
      await writeFile(join(candidate, 'main.js'), fixtureMain)
      f.contracts.set(`${name}@1.0.1`, {
        hostApiRange: '^1.0.0', permissions: [], approved: true,
        dshAuthorization: { packageName: name, packageVersion: '1.0.1', dshRuntimeVersion, ports: ['artifacts.read'] }
      })

      await f.service.checkCandidate(name, candidate)
      await f.service.applyCandidate(name)

      // The new generation must keep the bridge: same authorization, same executor.
      const second = await f.registry.require('portsprobe.workspace').handler({ operation: 'artifacts.read' }, caller)
      expect(second.output).toMatchObject({ ok: true, value: { executed: 'artifacts.read' } })
    } finally {
      await f.service.dispose()
    }
  })

  it('rejects operations missing from the contract allowlist with a structured error', async () => {
    const { service, registry, executions } = await createPortsFixture({ ports: ['artifacts.commit'] })
    try {
      const definition = registry.require('portsprobe.workspace')
      const result = await definition.handler(
        { operation: 'artifacts.delete' }, { caller: { workspaceId: '/ws/one' } } as never)
      expect(result.output).toMatchObject({ ok: false, code: 'unsupported_operation' })
      expect(executions).toEqual([])
    } finally {
      await service.dispose()
    }
  })

  it('rejects every operation when the contract declares no ports allowlist', async () => {
    const { service, registry, executions } = await createPortsFixture()
    try {
      const definition = registry.require('portsprobe.workspace')
      const result = await definition.handler(
        { operation: 'artifacts.commit' }, { caller: { workspaceId: '/ws/one' } } as never)
      expect(result.output).toMatchObject({ ok: false, code: 'unsupported_operation' })
      expect(executions).toEqual([])
    } finally {
      await service.dispose()
    }
  })

  it('rejects scopes that diverge from the runner-attested invocation workspace', async () => {
    const { service, registry, executions } = await createPortsFixture({ ports: ['artifacts.commit'] })
    try {
      const definition = registry.require('portsprobe.workspace')
      const result = await definition.handler(
        { operation: 'artifacts.commit', scopeRoot: '/ws/two' },
        { caller: { workspaceId: '/ws/one' } } as never)
      expect(result.output).toMatchObject({ ok: false, code: 'scope_mismatch' })
      expect(executions).toEqual([])
    } finally {
      await service.dispose()
    }
  })

  it('rejects ports requests without an in-flight workspace-bound invocation', async () => {
    const { service, registry, executions } = await createPortsFixture({ ports: ['artifacts.commit'] })
    try {
      const definition = registry.require('portsprobe.global')
      const result = await definition.handler({ operation: 'artifacts.commit' }, { caller: {} } as never)
      expect(result.output).toMatchObject({ ok: false, code: 'no_active_invocation' })
      expect(executions).toEqual([])
    } finally {
      await service.dispose()
    }
  })

  it('surfaces executor failures as structured errors with the original code', async () => {
    const { service, registry } = await createPortsFixture({
      ports: ['artifacts.commit'],
      portsExecutor: async () => {
        throw Object.assign(new Error('executor refused'), { code: 'unsupported_operation' })
      }
    })
    try {
      const definition = registry.require('portsprobe.workspace')
      const result = await definition.handler(
        { operation: 'artifacts.commit' }, { caller: { workspaceId: '/ws/one' } } as never)
      expect(result.output).toMatchObject({ ok: false, code: 'unsupported_operation', message: 'executor refused' })
    } finally {
      await service.dispose()
    }
  })
})
