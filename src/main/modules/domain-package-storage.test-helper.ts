import type { DomainPackageJsonValue } from '@sciforge/domain-sdk'
import type {
  DomainMainPackageStorageHost,
  DomainRuntimeContributionOwner
} from '@sciforge/domain-sdk/host'

type SettingsState = {
  revision: number
  value: DomainPackageJsonValue | null
}

export function createNonSecretPackageStorageForTest(): (
  owner: DomainRuntimeContributionOwner
) => DomainMainPackageStorageHost {
  const settingsByOwner = new Map<string, SettingsState>()

  return (owner) => {
    const key = `${owner.moduleId}@${owner.moduleVersion}`
    const state = () => settingsByOwner.get(key) ?? { revision: 0, value: null }
    const snapshot = () => {
      const current = state()
      return Object.freeze({
        revision: current.revision,
        value: current.value === null ? null : structuredClone(current.value)
      })
    }
    return Object.freeze({
      settings: Object.freeze({
        read: async () => snapshot(),
        write: async (value: DomainPackageJsonValue, expectedRevision: number) => {
          const current = state()
          if (current.revision !== expectedRevision) {
            throw new Error(`Package settings revision conflict for ${key}.`)
          }
          settingsByOwner.set(key, {
            revision: current.revision + 1,
            value: structuredClone(value)
          })
          return snapshot()
        },
        clear: async (expectedRevision: number) => {
          const current = state()
          if (current.revision !== expectedRevision) {
            throw new Error(`Package settings revision conflict for ${key}.`)
          }
          settingsByOwner.set(key, { revision: current.revision + 1, value: null })
          return snapshot()
        }
      }),
      secrets: Object.freeze({
        has: async () => false,
        read: async () => null,
        write: async () => {
          throw new Error('Secret writes are unavailable in this non-secret test host.')
        },
        remove: async () => undefined,
        providerCredentials: Object.freeze({
          has: async () => false,
          write: async () => {
            throw new Error('Provider credential writes are unavailable in this test host.')
          },
          use: async () => {
            throw new Error('Provider credentials are unavailable in this test host.')
          },
          remove: async () => undefined
        })
      })
    })
  }
}
