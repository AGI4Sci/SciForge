import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'

import { SiYuanError } from './client.js'

/** One key, one secret: the API token of the service this package talks to.
 * The value never leaves the main process and is never echoed by a capability. */
const TOKEN_KEY = 'siyuan.service.token'

export type SiYuanTokenState = 'configured' | 'absent' | 'unavailable'

export type SiYuanTokenStore = Readonly<{
  /** Whether this Host exposes owner-scoped encrypted storage at all. */
  available: () => boolean
  state: () => Promise<SiYuanTokenState>
  /** `undefined` means "no stored token", which is not an error: the caller may
   * still be configured through the environment. */
  read: () => Promise<string | undefined>
  write: (token: string) => Promise<void>
  clear: () => Promise<void>
}>

const normalizedToken = (token: string): string => {
  const value = token.trim()
  if (!value || value.length > 2_048 || /[\r\n]/u.test(value)) throw new SiYuanError('invalid_input')
  return value
}

/**
 * SiYuan API token stored in the Host's owner-scoped encrypted secret store.
 *
 * A package may not reach the platform keychain directly; the Host hands over
 * this port only after binding it to the activating package owner. When a Host
 * predates the port, every accessor fails closed instead of silently keeping a
 * token in plain text.
 */
export function createSiYuanTokenStore(
  secrets?: DomainMainPackageSecretStoreHost
): SiYuanTokenStore {
  return Object.freeze({
    available: () => secrets !== undefined,
    state: async () => {
      if (!secrets) return 'unavailable'
      try {
        return (await secrets.has(TOKEN_KEY)) ? 'configured' : 'absent'
      } catch {
        // A broken keychain must not break the page: report it, and let the
        // environment variable remain a working fallback.
        return 'unavailable'
      }
    },
    read: async () => {
      if (!secrets) return undefined
      try {
        const value = await secrets.read(TOKEN_KEY)
        return value?.trim() || undefined
      } catch {
        return undefined
      }
    },
    write: async (token) => {
      if (!secrets) throw new SiYuanError('secure_storage_unavailable')
      await secrets.write(TOKEN_KEY, normalizedToken(token))
    },
    clear: async () => {
      if (!secrets) throw new SiYuanError('secure_storage_unavailable')
      await secrets.remove(TOKEN_KEY)
    }
  })
}