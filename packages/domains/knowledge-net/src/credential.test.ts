import { describe, expect, it } from 'vitest'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'
import { createDomainMainEntry } from './main.js'
import { domainMainPackageSecretKeySchema } from '@sciforge/domain-sdk/package-storage'

/**
 * Gate 0.4: the Host's owner-scoped secret facility works for a non-Provider
 * consumer. Knowledge Net exercises the same `packageSecrets` port the Host
 * already hands every domain (see `installed-domain-main.ts`), and must be able
 * to store, read and remove a connector credential without it ever appearing in
 * the non-secret `packageSettings` document.
 *
 * This test is the facility check, not a connector: the Zotero read (3.1) and
 * write-back (3.2) are the actual consumers and remain behind the egress policy
 * decision and the bundled-domain enablement switch (0.3).
 */

function inMemorySecrets(): DomainMainPackageSecretStoreHost {
  const store = new Map<string, string>()
  return {
    has: async (key) => store.has(domainMainPackageSecretKeySchema.parse(key)),
    read: async (key) => store.get(domainMainPackageSecretKeySchema.parse(key)) ?? null,
    write: async (key, value) => { store.set(domainMainPackageSecretKeySchema.parse(key), value) },
    remove: async (key) => { store.delete(domainMainPackageSecretKeySchema.parse(key)) }
  }
}

function inMemorySettings(): DomainMainPackageSettingsHost {
  let value: unknown = null
  let revision = 0
  const snapshot = (): DomainMainPackageSettingsSnapshot => ({ revision, value: value as never })
  return {
    read: async () => snapshot(),
    write: async (next) => { value = next; revision += 1; return snapshot() },
    clear: async () => { value = null; revision += 1; return snapshot() }
  }
}

describe('secure credential facility for knowledge-net', () => {
  it('uses valid Host secret keys when an unconfigured Zotero connector is called', async () => {
    const entry = createDomainMainEntry({
      getUserDataDir: () => '',
      defineCapability: (definition: unknown) => definition,
      packageSecrets: inMemorySecrets()
    } as never)
    const factory = entry.contributions[0]!.value as { createDefinitions(): Array<{
      id: string; handler(input: unknown, context: unknown): Promise<unknown>
    }> }
    const read = factory.createDefinitions().find(definition => definition.id === 'knowledge-net.zotero.read')!
    await expect(read.handler({}, { caller: {} })).rejects.toThrow('Zotero is not configured')
  })
  it('exposes the owner-scoped secret store and settings store as separate ports', async () => {
    const secrets = inMemorySecrets()
    const settings = inMemorySettings()
    const entry = createDomainMainEntry({
      getUserDataDir: () => '',
      defineCapability: (definition: unknown) => definition,
      packageSecrets: secrets,
      packageSettings: settings
    } as never)

    expect(entry.contributions[0]!.kind).toBe('main.capability-factory')

    await secrets.write('zotero.api-key', 'zk-EXAMPLE-1234567890abcdef')
    expect(await secrets.has('zotero.api-key')).toBe(true)
    expect(await secrets.read('zotero.api-key')).toBe('zk-EXAMPLE-1234567890abcdef')
    await secrets.remove('zotero.api-key')
    expect(await secrets.read('zotero.api-key')).toBeNull()
  })

  it('never surfaces a secret through the non-secret settings document', async () => {
    const secrets = inMemorySecrets()
    const settings = inMemorySettings()
    createDomainMainEntry({
      getUserDataDir: () => '',
      defineCapability: (definition: unknown) => definition,
      packageSecrets: secrets,
      packageSettings: settings
    } as never)

    await secrets.write('zotero.api-key', 'zk-SECRET-do-not-leak')
    await settings.write({ connector: { configured: true } }, 0)

    const snapshot = await settings.read()
    expect(JSON.stringify(snapshot)).not.toContain('zk-SECRET-do-not-leak')
    expect(JSON.stringify(snapshot)).not.toContain('apiKey')
  })
})
