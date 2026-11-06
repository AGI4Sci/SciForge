import { describe, expect, it } from 'vitest'
import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import { createSiYuanTokenStore } from './secrets.js'

function memorySecrets(): Readonly<{
  values: Map<string, string>
  host: DomainMainPackageSecretStoreHost
}> {
  const values = new Map<string, string>()
  return {
    values,
    host: {
      has: async (key) => values.has(key),
      read: async (key) => values.get(key) ?? null,
      write: async (key, value) => { values.set(key, value) },
      remove: async (key) => { values.delete(key) }
    }
  }
}

describe('SiYuan token store', () => {
  it('stores one token, reports it as configured and clears it again', async () => {
    const secrets = memorySecrets()
    const store = createSiYuanTokenStore(secrets.host)
    expect(store.available()).toBe(true)
    await expect(store.state()).resolves.toBe('absent')
    await expect(store.read()).resolves.toBeUndefined()

    await store.write('  siyuan-token  ')
    // The value is trimmed before it is stored, so a pasted token with trailing
    // whitespace still matches what the service expects.
    expect(secrets.values.get('siyuan.service.token')).toBe('siyuan-token')
    await expect(store.state()).resolves.toBe('configured')
    await expect(store.read()).resolves.toBe('siyuan-token')

    await store.clear()
    await expect(store.state()).resolves.toBe('absent')
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('fails closed when the Host has no encrypted store', async () => {
    const store = createSiYuanTokenStore(undefined)
    expect(store.available()).toBe(false)
    await expect(store.state()).resolves.toBe('unavailable')
    await expect(store.read()).resolves.toBeUndefined()
    await expect(store.write('token')).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
    await expect(store.clear()).rejects.toMatchObject({ code: 'secure_storage_unavailable' })
  })

  it('rejects blank, multiline and oversized tokens before they reach storage', async () => {
    const secrets = memorySecrets()
    const store = createSiYuanTokenStore(secrets.host)
    for (const value of ['   ', 'line\nbreak', 'x'.repeat(2_049)]) {
      await expect(store.write(value)).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(secrets.values.size).toBe(0)
  })

  it('reports an unusable keychain instead of failing the page', async () => {
    const store = createSiYuanTokenStore({
      has: async () => { throw new Error('keychain locked') },
      read: async () => { throw new Error('keychain locked') },
      write: async () => { throw new Error('keychain locked') },
      remove: async () => { throw new Error('keychain locked') }
    })
    await expect(store.state()).resolves.toBe('unavailable')
    await expect(store.read()).resolves.toBeUndefined()
  })
})