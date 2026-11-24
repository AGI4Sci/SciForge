import { describe, expect, it } from 'vitest'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import { IdentityCloudSettingsService } from './cloud-settings.js'

describe('IdentityCloudSettingsService', () => {
  it('persists the deployment endpoints as non-secret package settings', async () => {
    const host = memorySettings()
    const service = new IdentityCloudSettingsService(host)

    const written = await service.configure({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })

    expect(written.settings).toEqual({
      schemaVersion: 1,
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })
    await expect(service.read()).resolves.toEqual({
      revision: 1,
      settings: written.settings
    })
  })

  it('trims values and removes cleared fields while keeping the other endpoint', async () => {
    const service = new IdentityCloudSettingsService(memorySettings())
    await service.configure({
      oidcIssuer: ' https://identity.example.test/realms/SciForge ',
      cloudBaseUrl: 'https://cloud.example.test'
    })

    const cleared = await service.configure({
      oidcIssuer: '',
      cloudBaseUrl: 'https://cloud.example.test'
    })

    expect(cleared.settings).toEqual({
      schemaVersion: 1,
      cloudBaseUrl: 'https://cloud.example.test'
    })
  })

  it('rejects a non-loopback HTTP endpoint before writing settings', async () => {
    const host = memorySettings()
    const service = new IdentityCloudSettingsService(host)

    await expect(service.configure({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'http://cloud.example.test'
    })).rejects.toThrow('must use HTTPS')
    await expect(service.read()).resolves.toEqual({ revision: 0, settings: null })
  })

  it('retries exactly once when another writer advanced the revision', async () => {
    let revision = 0
    let value: DomainPackageJsonValue = null
    const host: DomainMainPackageSettingsHost = {
      read: async () => ({ revision, value }),
      write: async (next, expectedRevision) => {
        if (expectedRevision !== revision) throw new Error('Package settings revision conflict.')
        revision += 1
        value = structuredClone(next)
        return { revision, value }
      },
      clear: async () => ({ revision, value: null })
    }
    let reads = 0
    // A concurrent write advances the revision after the first snapshot.
    const racingHost: DomainMainPackageSettingsHost = {
      ...host,
      read: async () => {
        reads += 1
        const snapshot = { revision, value }
        if (reads === 1) {
          revision += 1
          value = { schemaVersion: 1 }
        }
        return snapshot
      }
    }
    const service = new IdentityCloudSettingsService(racingHost)

    const written = await service.configure({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })
    expect(reads).toBe(2)
    expect(written.revision).toBe(2)
    expect(written.settings).toMatchObject({
      cloudBaseUrl: 'https://cloud.example.test'
    })
  })
})

function memorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: DomainPackageJsonValue = null
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('Package settings revision conflict.')
      revision += 1
      value = structuredClone(next)
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('Package settings revision conflict.')
      revision += 1
      value = null
      return { revision, value }
    }
  }
}
