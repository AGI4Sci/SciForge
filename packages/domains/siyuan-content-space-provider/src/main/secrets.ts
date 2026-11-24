import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import { createHash } from 'node:crypto'

import { SiYuanError } from './client.js'

/** One endpoint-scoped key per service token.
 * The value never leaves the main process and is never echoed by a capability. */

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
  secrets: DomainMainPackageSecretStoreHost | undefined,
  serviceUrl: string
): SiYuanTokenStore {
  const key = 'siyuan.service.token.' + createHash('sha256').update(serviceUrl).digest('hex')
  return Object.freeze({
    available: () => secrets !== undefined,
    state: async () => {
      if (!secrets) return 'unavailable'
      try {
        return (await secrets.has(key)) ? 'configured' : 'absent'
      } catch {
        // Introspection can report an unavailable store; endpoint resolution
        // uses read(), which fails explicitly rather than guessing credentials.
        return 'unavailable'
      }
    },
    read: async () => {
      if (!secrets) return undefined
      try {
        const value = await secrets.read(key)
        return value?.trim() || undefined
      } catch {
        throw new SiYuanError('secure_storage_unavailable')
      }
    },
    write: async (token) => {
      if (!secrets) throw new SiYuanError('secure_storage_unavailable')
      const value = normalizedToken(token)
      try { await secrets.write(key, value) }
      catch { throw new SiYuanError('secure_storage_unavailable') }
    },
    clear: async () => {
      if (!secrets) throw new SiYuanError('secure_storage_unavailable')
      try { await secrets.remove(key) }
      catch { throw new SiYuanError('secure_storage_unavailable') }
    }
  })
}
