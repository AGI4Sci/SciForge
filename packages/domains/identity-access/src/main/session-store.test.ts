import { describe, expect, it, vi } from 'vitest'
import { PrivateVaultDesktopIdentitySessionStore, parsePendingDesktopRefresh } from './session-store.js'

const session = { version: 1 as const, issuer: 'https://identity.example.test', clientId: 'desktop', refreshToken: 'trusted-refresh-token', identity: { subject: 'subject', userId: 'user' } }

describe('private vault pending refresh escrow', () => {
  it('durably round trips unverified pending tokens separately from trusted credentials', async () => {
    let value: string | null = null
    const vault = { read: vi.fn(async () => value), write: vi.fn(async (_ref, next: string) => { value = next }), remove: vi.fn(async () => { value = null }), has: vi.fn(async () => value !== null) }
    const store = new PrivateVaultDesktopIdentitySessionStore(vault)
    const pendingRefresh = { accessToken: 'unverified-access', refreshToken: 'rotated-refresh-token' }
    await store.save({ ...session, pendingRefresh })
    expect(await new PrivateVaultDesktopIdentitySessionStore(vault).load()).toEqual({ ...session, pendingRefresh })
    await store.save(session)
    expect(await store.load()).toEqual(session)
    await store.clear()
    expect(await store.load()).toBeNull()
  })
  it.each([null, [], { accessToken: '' }, { accessToken: 'x'.repeat(100001) }, { accessToken: 'ok', refreshToken: 12 }, { accessToken: 'ok', tokenEndpoint: 'https://evil.invalid' }])('rejects malformed or unbounded pending data %j', (pending) => {
    expect(() => parsePendingDesktopRefresh(pending)).toThrow()
  })
  it('rejects invalid escrow loaded from the vault rather than granting authentication', async () => {
    const vault = { read: vi.fn(async () => JSON.stringify({ ...session, pendingRefresh: { accessToken: 'ok', arbitrary: {} } })), write: vi.fn(), remove: vi.fn(), has: vi.fn() }
    await expect(new PrivateVaultDesktopIdentitySessionStore(vault).load()).rejects.toThrow('invalid or cannot be read')
  })
})
