import { describe, expect, it } from 'vitest'
import { defineTrustedDomainPackage } from '@sciforge/domain-sdk'
import type { InstalledExtensionPackage } from './types'
import { createDomainExtensionsApi } from './domain-extensions-api'
import { createPluginInventoryService, PluginInventoryAccessError } from './plugin-inventory-service'

describe('host-owned plugin inventory read slice', () => {
  it('lets a neutral consumer read the canonical DomainExtensionsApi.list inventory', async () => {
    const bundled = defineTrustedDomainPackage({
      contractVersion: 1,
      kind: 'trusted-compile-time',
      packageName: '@sciforge/domain-inventory-neutral',
      publisher: { id: 'sciforge', displayName: 'SciForge' },
      module: { id: 'neutral.inventory', displayName: 'Neutral Inventory', version: '1.0.0', hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }, priority: 1 },
      contributionContracts: {},
      entrypoints: [{ process: 'renderer', export: './renderer', contributions: [{ id: 'neutral.panel', kind: 'renderer.panel', priority: 1 }] }]
    })
    const api = createDomainExtensionsApi({
      bundledDefinitions: [bundled],
      store: {
        install: async () => { throw new Error('not used') },
        list: async () => [] as InstalledExtensionPackage[],
        status: async () => null,
        setEnabled: async () => { throw new Error('not used') },
        rollback: async () => { throw new Error('not used') },
        uninstall: async () => false
      }
    })

    const admission = { caller: 'host-panel', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: { current: true }, signal: new AbortController().signal }
    const service = createPluginInventoryService(api, () => admission, (snapshot) => snapshot.lease === admission.lease && admission.lease.current)
    const consumer = { readInventory: () => service.list() }
    await expect(consumer.readInventory()).resolves.toEqual([
      expect.objectContaining({ packageName: '@sciforge/domain-inventory-neutral', source: 'bundled' })
    ])
  })
  it('accepts only synchronous exact true authorization', async () => {
    for (const produce of [() => 'yes', () => 1, () => ({}), () => Promise.resolve(false), () => Promise.reject(new Error('synthetic rejection'))]) {
      let calls = 0
      const service = createPluginInventoryService({ list: async () => { calls++; return [] } },
        () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal }),
        produce as unknown as () => boolean)
      await expect(service.list()).rejects.toBeInstanceOf(PluginInventoryAccessError)
      expect(calls).toBe(0)
    }
  })
  it('detaches captured identity and preserves the opaque lease', async () => {
    const fact = { caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal }
    let release!: (rows: []) => void
    const pending = new Promise<[]>(resolve => { release = resolve })
    const seen: unknown[] = []
    let generation = 7
    const service = createPluginInventoryService({ list: () => pending }, () => fact, snapshot => {
      seen.push(snapshot)
      return snapshot.generation === generation
    })
    const result = service.list()
    fact.caller = 'changed'; fact.packageName = '@example/changed'; fact.version = '2.0.0'; fact.generation = 8; generation = 8
    release([])
    await expect(result).rejects.toBeInstanceOf(PluginInventoryAccessError)
    expect(seen[0]).not.toBe(fact)
    expect(Object.isFrozen(seen[0])).toBe(true)
    expect(seen[0]).toEqual({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: fact.lease, signal: fact.signal })
    expect(Object.isFrozen(fact.lease)).toBe(false)
  })
  it('settles live cancellation without waiting for the canonical provider', async () => {
    const controller = new AbortController()
    let release!: (rows: []) => void
    let calls = 0
    const service = createPluginInventoryService({ list: () => { calls++; return new Promise<[]>(resolve => { release = resolve }) } },
      () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: controller.signal }), () => true)
    const result = service.list()
    const observed = result.then(() => 'delivered', error => error)
    controller.abort(new Error('SYNTHETIC_PRIVATE_ABORT'))
    const settled = await Promise.race([observed, new Promise(resolve => setTimeout(() => resolve('still pending'), 30))])
    release([])
    expect(calls).toBe(1)
    expect(settled).toBeInstanceOf(PluginInventoryAccessError)
    await expect(observed).resolves.toBeInstanceOf(PluginInventoryAccessError)
  })
  it('rejects missing or already aborted Host signals before dispatch', async () => {
    for (const signal of [undefined, AbortSignal.abort()]) {
      let calls = 0
      const service = createPluginInventoryService({ list: async () => { calls++; return [] } },
        () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: signal as AbortSignal }), () => true)
      await expect(service.list()).rejects.toBeInstanceOf(PluginInventoryAccessError)
      expect(calls).toBe(0)
    }
  })
  it('sanitizes capture, authorization and provider failures', async () => {
    for (const seam of ['capture', 'check', 'provider', 'post-check']) {
      const secret = new Error('SYNTHETIC_PRIVATE_PATH C:\\private\\plugin')
      let calls = 0
      let checks = 0
      const service = createPluginInventoryService({ list: async () => { calls++; if (seam === 'provider') throw secret; return [] } },
        () => { if (seam === 'capture') throw secret; return { caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal } },
        () => { checks++; if (seam === 'check' || (seam === 'post-check' && checks === 2)) throw secret; return true })
      const error = await service.list().catch(error => error)
      expect(error).not.toBe(secret)
      expect(error).toMatchObject({ code: seam === 'provider' ? 'PLUGIN_INVENTORY_UNAVAILABLE' : 'PLUGIN_INVENTORY_ACCESS_REVOKED' })
      expect(String(error)).not.toContain('SYNTHETIC_PRIVATE_PATH')
      expect(error.cause).toBeUndefined()
      expect(calls).toBe(seam === 'capture' || seam === 'check' ? 0 : 1)
    }
  })
  it('returns a detached deeply frozen snapshot without freezing Host references', async () => {
    const host = {
      packageName: '@example/neutral', moduleId: 'neutral', moduleDisplayName: 'Neutral', version: '1.0.0',
      publisher: { id: 'example', displayName: 'Example' }, source: 'bundled' as const, verification: 'bundled' as const,
      execution: 'trusted-compile-time' as const, status: 'active' as const, permissions: ['read'],
      contributionKinds: ['renderer.panel'], contributionCount: 1, canRollback: false,
      approvedPermissions: ['read'], deniedPermissions: [], hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }
    }
    const rows = [host]
    const service = createPluginInventoryService({ list: async () => rows },
      () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal }), () => true)
    const first = await service.list()
    expect(first).not.toBe(rows)
    expect(first[0]).not.toBe(host)
    for (const value of [first, first[0], first[0].publisher, first[0].permissions, first[0].contributionKinds, first[0].approvedPermissions, first[0].deniedPermissions, first[0].hostApi]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(Object.isFrozen(host)).toBe(false)
    expect(Object.isFrozen(host.publisher)).toBe(false)
    expect(Object.isFrozen(host.permissions)).toBe(false)
    expect(Reflect.set(first[0].publisher, 'displayName', 'client mutation')).toBe(false)
    host.publisher.displayName = 'Host updated'
    expect(first[0].publisher.displayName).toBe('Example')
    expect((await service.list())[0].publisher.displayName).toBe('Host updated')
  })
  it('projects canonical inventory through a field whitelist without private diagnostics', async () => {
    const record = {
      packageName: '@example/installed', moduleId: 'neutral', displayName: 'Neutral',
      publisherId: 'example', publisherDisplayName: 'Example', activeVersion: '1.0.0', enabled: true,
      versions: [{ version: '1.0.0', installedAt: '2026-01-01', runtime: { requestedPermissions: [], entrypoints: [] } }]
    }
    const api = createDomainExtensionsApi({ bundledDefinitions: [], store: {
      list: async () => [record] as unknown as InstalledExtensionPackage[],
      status: async () => ({ health: 'invalid', issue: 'SYNTHETIC_PRIVATE_PATH private-relative-or-opaque-detail' }) as never,
      install: async () => { throw new Error('unused') }, setEnabled: async () => { throw new Error('unused') },
      rollback: async () => { throw new Error('unused') }, uninstall: async () => false
    } })
    const canonical = await api.list()
    expect(canonical[0].diagnostic).toContain('SYNTHETIC_PRIVATE_PATH')
    const enriched = canonical.map(row => ({ ...row, privateMetadata: 'SYNTHETIC_PRIVATE_EXTRA',
      publisher: { ...row.publisher, privateMetadata: 'SYNTHETIC_PRIVATE_NESTED' } }))
    const service = createPluginInventoryService({ list: async () => enriched },
      () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal }), () => true)
    const rows = await service.list()
    expect(rows[0]).toMatchObject({ packageName: record.packageName, status: 'invalid', version: '1.0.0' })
    expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_PRIVATE')
    expect(rows[0]).not.toHaveProperty('diagnostic')
    expect(rows[0]).not.toHaveProperty('privateMetadata')
    expect(rows[0].publisher).toEqual({ id: 'example', displayName: 'Example' })
    expect(enriched[0]).toHaveProperty('diagnostic')
  })
  it('rejects asynchronous reauthorization after the provider boundary', async () => {
    for (const produce of [() => Promise.resolve(true), () => Promise.reject(new Error('SYNTHETIC_PRIVATE_CHECK'))]) {
      let checks = 0
      let calls = 0
      const service = createPluginInventoryService({ list: async () => { calls++; return [] } },
        () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: new AbortController().signal }),
        (() => ++checks === 1 ? true : produce()) as unknown as () => boolean)
      await expect(service.list()).rejects.toMatchObject({ code: 'PLUGIN_INVENTORY_ACCESS_REVOKED' })
      expect(calls).toBe(1)
      expect(checks).toBe(2)
    }
  })
  it('observes late provider rejection after cancellation without exposing its error', async () => {
    const controller = new AbortController()
    let reject!: (error: Error) => void
    const service = createPluginInventoryService({ list: () => new Promise((_, fail) => { reject = fail }) },
      () => ({ caller: 'neutral', packageName: '@example/neutral', version: '1.0.0', generation: 7, lease: {}, signal: controller.signal }), () => true)
    const result = service.list()
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'PLUGIN_INVENTORY_ACCESS_REVOKED' })
    reject(new Error('SYNTHETIC_PRIVATE_LATE'))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
