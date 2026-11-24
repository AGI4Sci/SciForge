import {
  cloudSpaceIdSchema, cloudSpaceSessionGrantSchema, cloudSpaceBootstrapRequestSchema
} from '@sciforge/cloud-spaces-contracts'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { SiYuanError } from './client.js'

export type NotesBrowserSession = Readonly<{ fetch: typeof fetch }>
export type ManagedCloudSpaceEndpoint = Readonly<{ baseUrl: string; spaceId: string; expiresAt: string; fetchImpl: typeof fetch }>

/** One project-scoped browser jar is shared by the editor and every Notes API call. */
export function createCloudSpaceSessions(options: Readonly<{
  transport: () => AuthenticatedCloudTransport
  identity: () => CurrentUserProfile
  browser: (url: string, identity: CurrentUserProfile) => NotesBrowserSession
  now?: () => number
}>) {
  type SessionEntry = { value?: ManagedCloudSpaceEndpoint; pending?: Promise<ManagedCloudSpaceEndpoint> }
  const sessions = new Map<string, SessionEntry>()
  const now = options.now ?? Date.now
  const authority = () => {
    const transport = options.transport()
    const status = transport.status()
    const identity = options.identity()
    if (identity.state !== 'signed-in' || status.state === 'identity_required') throw new SiYuanError('identity_required')
    if (status.state !== 'ready') throw new SiYuanError(status.state === 'device_required' || status.reasonCode === 'authority_rejected' ? 'unauthorized' : 'provider_unavailable')
    if (status.userId !== identity.userId) throw new SiYuanError('identity_required')
    return { transport, status, identity, key: `${status.userId}:${status.deviceId}:${status.deviceRevision}` }
  }
  let recovery: Promise<unknown> | undefined
  const recoverAuthority = async () => {
    const transport = options.transport()
    const status = transport.status()
    if (status.state !== 'unavailable' || status.reasonCode !== 'authority_unverified') return
    const identity = options.identity()
    if (identity.state !== 'signed-in') throw new SiYuanError('identity_required')
    // The canonical authenticated read owns device revalidation. Do not reuse a
    // browser cookie while verification is pending, and never replay a mutation.
    const pending = recovery ??= transport.listCloudSpaces()
    try {
      await pending
      const current = options.identity()
      if (current.state !== 'signed-in' || current.userId !== identity.userId) throw new SiYuanError('identity_required')
    } finally { if (recovery === pending) recovery = undefined }
  }
  const ensure = async (rawSpaceId: string, refresh: Readonly<{ fresh?: boolean }> = {}): Promise<ManagedCloudSpaceEndpoint> => {
    const spaceId = cloudSpaceIdSchema.parse(rawSpaceId)
    await recoverAuthority()
    const initial = authority()
    const key = `${initial.key}:${spaceId}`
    const assertCurrent = async () => {
      await recoverAuthority()
      if (authority().key !== initial.key) throw new SiYuanError('identity_required')
    }
    const entry = sessions.get(key) ?? {}
    // Concurrent callers share the same authorization exchange, including
    // explicit refresh. A later, separate refresh still obtains a new grant.
    if (entry.pending) {
      const value = await entry.pending
      await assertCurrent()
      return value
    }
    if (!refresh.fresh && entry.value && Date.parse(entry.value.expiresAt) > now() + 60_000) return entry.value
    sessions.set(key, entry)
    const pending = (async () => {
      const grant = cloudSpaceSessionGrantSchema.parse(await initial.transport.createCloudSpaceSession({ spaceId }))
      await assertCurrent()
      if (grant.spaceId !== spaceId || Date.parse(grant.expiresAt) <= now()) throw new SiYuanError('provider_contract_violation')
      const browser = options.browser(grant.editorUrl, initial.identity)
      const response = await browser.fetch(grant.bootstrapUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cloudSpaceBootstrapRequestSchema.parse({ code: grant.bootstrapCode })), credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15_000)
      })
      try { await assertCurrent() } finally { await response.body?.cancel() }
      if (!response.ok) throw new SiYuanError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'provider_unavailable')
      const origin = new URL(grant.editorUrl).origin
      const fetchImpl: typeof fetch = async (input, init) => {
        await assertCurrent()
        const target = new URL(input instanceof Request ? input.url : String(input))
        if (target.origin !== origin) throw new SiYuanError('invalid_configuration')
        if (Date.parse(grant.expiresAt) <= now()) throw new SiYuanError('unauthorized')
        const headers = new Headers(init?.headers)
        headers.set('Origin', origin)
        const result = await browser.fetch(input, { ...init, headers, credentials: 'include', redirect: 'error' })
        try { await assertCurrent() } catch (error) { await result.body?.cancel(); throw error }
        return result
      }
      return { baseUrl: grant.editorUrl.replace(/\/$/u, ''), spaceId, expiresAt: grant.expiresAt, fetchImpl }
    })()
    entry.pending = pending
    try {
      const value = await pending
      await assertCurrent()
      entry.value = value
      return value
    } catch (error) {
      if (sessions.get(key) === entry) sessions.delete(key)
      throw error
    } finally { if (entry.pending === pending) entry.pending = undefined }
  }
  return {
    ensure,
    async forUrl(url: string): Promise<ManagedCloudSpaceEndpoint> {
      await recoverAuthority()
      const current = authority()
      for (const [key, entry] of sessions) {
        if (!key.startsWith(`${current.key}:`)) continue
        const endpoint = entry.value
        // Only addresses from completed authorization exchanges are accepted.
        // An unrelated space's in-flight login must not delay this viewport.
        if (endpoint && `${endpoint.baseUrl}/` === url) return ensure(endpoint.spaceId)
      }
      throw new SiYuanError('space_required')
    },
    clear() { sessions.clear() }
  }
}
