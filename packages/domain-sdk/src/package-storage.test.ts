import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  domainMainProviderCredentialAccessSchema,
  domainMainProviderCredentialBindingSchema,
  domainMainPackageSecretKeySchema,
  domainMainPackageSettingsSnapshotSchema,
  type DomainMainPackageSecretStoreHost,
  type DomainMainPackageSettingsHost
} from './package-storage.js'

describe('package-owned storage contracts', () => {
  it('keeps non-secret settings JSON behind an exact revision', async () => {
    let snapshot = domainMainPackageSettingsSnapshotSchema.parse({
      revision: 0,
      value: null
    })
    const settings: DomainMainPackageSettingsHost = {
      read: async () => snapshot,
      write: async (value, expectedRevision) => {
        assert.equal(expectedRevision, snapshot.revision)
        snapshot = domainMainPackageSettingsSnapshotSchema.parse({
          revision: snapshot.revision + 1,
          value
        })
        return snapshot
      },
      clear: async (expectedRevision) => {
        assert.equal(expectedRevision, snapshot.revision)
        snapshot = domainMainPackageSettingsSnapshotSchema.parse({
          revision: snapshot.revision + 1,
          value: null
        })
        return snapshot
      }
    }

    assert.deepEqual(await settings.write({ serverUrl: 'https://example.invalid' }, 0), {
      revision: 1,
      value: { serverUrl: 'https://example.invalid' }
    })
    assert.deepEqual(await settings.clear(1), { revision: 2, value: null })
    assert.throws(() => domainMainPackageSettingsSnapshotSchema.parse({
      revision: 2,
      value: {},
      token: 'must-not-be-a-setting-field'
    }), z.ZodError)
  })

  it('exposes opaque main-only secret operations without listing or exporting values', async () => {
    const values = new Map<string, string>()
    const secrets: DomainMainPackageSecretStoreHost = {
      has: async (key) => values.has(key),
      read: async (key) => values.get(key) ?? null,
      write: async (key, value) => { values.set(key, value) },
      remove: async (key) => { values.delete(key) }
    }
    const key = domainMainPackageSecretKeySchema.parse('device.token')
    await secrets.write(key, 'opaque-value')
    assert.equal(await secrets.has(key), true)
    assert.equal(await secrets.read(key), 'opaque-value')
    await secrets.remove(key)
    assert.equal(await secrets.read(key), null)
    assert.throws(() => domainMainPackageSecretKeySchema.parse('../other-package'), z.ZodError)
    assert.equal('list' in secrets, false)
  })

  it('keeps the provider binding local and requires an exact Principal lease', () => {
    assert.deepEqual(domainMainProviderCredentialBindingSchema.parse({
      providerInstanceRef: 'opencontent.demo',
      connectionId: 'connection-a'
    }), {
      providerInstanceRef: 'opencontent.demo',
      connectionId: 'connection-a'
    })
    assert.throws(() => domainMainProviderCredentialBindingSchema.parse({
      providerInstanceRef: 'opencontent.demo',
      connectionId: 'connection-a',
      principalId: 'caller-must-not-supply-this'
    }), z.ZodError)
    assert.throws(() => domainMainProviderCredentialBindingSchema.parse({
      providerInstanceRef: 'https://caller.invalid',
      connectionId: 'connection-a'
    }), z.ZodError)
    const expectedPrincipal = {
      authority: 'sciforge.local-account',
      subject: 'local-account-a',
      assurance: 'local-selection',
      deviceId: 'test-device',
      identityVersion: 7
    } as const
    assert.deepEqual(domainMainProviderCredentialAccessSchema.parse({
      binding: {
        providerInstanceRef: 'opencontent.demo',
        connectionId: 'connection-a'
      },
      expectedPrincipal
    }), {
      binding: {
        providerInstanceRef: 'opencontent.demo',
        connectionId: 'connection-a'
      },
      expectedPrincipal
    })
    assert.throws(() => domainMainProviderCredentialAccessSchema.parse({
      binding: {
        providerInstanceRef: 'opencontent.demo',
        connectionId: 'connection-a'
      },
      acceptedPrincipalAssurances: ['local-selection']
    }), z.ZodError)
  })
})
