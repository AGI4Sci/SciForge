import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopIdentityService } from './oidc-service.js'
import { CloudIdentityClientError } from './cloud-identity-client.js'
import {
  DesktopIdentitySessionStoreError,
  type StoredDesktopIdentitySession
} from './session-store.js'

const issuer = 'http://127.0.0.1:8080/realms/SciForge'
const clientId = 'sciforge-desktop'
const audience = 'sciforge-cloud-api'
const identityClient = {
  getCurrentUser: vi.fn(async () => ({
    schemaVersion: 1 as const,
    type: 'me' as const,
    userId: 'usr_CloudUser000001',
    displayName: 'Nem User',
    status: 'active' as const,
    oidcIdentityId: 'oid_CloudIdent0001',
    issuer,
    revision: 1,
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z'
  }))
}

function memorySessionStore(initial: StoredDesktopIdentitySession | null = null) {
  let stored = initial
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (next: StoredDesktopIdentitySession) => {
      stored = next
    }),
    clear: vi.fn(async () => {
      stored = null
    }),
    current: () => stored
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
    server.listen(0, '127.0.0.1')
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function createSigner() {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  const kid = 'test-key'

  return {
    publicJwk: { ...publicJwk, kid, use: 'sig', alg: 'RS256' },
    sign: async (claims: Record<string, unknown>): Promise<string> => {
      const header = encode({ alg: 'RS256', kid, typ: 'JWT' })
      const payload = encode(claims)
      const signature = await webcrypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keyPair.privateKey,
        Buffer.from(`${header}.${payload}`)
      )
      return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
    }
  }
}

function withoutClaim(
  claims: Record<string, unknown>,
  claim: string
): Record<string, unknown> {
  const next = { ...claims }
  delete next[claim]
  return next
}

async function loginWithAccessTimeClaims(
  mutateClaims: (claims: Record<string, unknown>) => Record<string, unknown>
) {
  const signer = await createSigner()
  const port = await unusedPort()
  const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
  const now = Date.parse('2026-08-18T12:00:00.000Z')
  const nowSeconds = Math.floor(now / 1000)
  let nonce = ''
  const sessionStore = memorySessionStore()
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`
      })
    }
    if (url.endsWith('/protocol/openid-connect/certs')) {
      return Response.json({ keys: [signer.publicJwk] })
    }
    if (url.endsWith('/protocol/openid-connect/token')) {
      const common = {
        iss: issuer,
        sub: 'keycloak-user-123',
        exp: nowSeconds + 300,
        iat: nowSeconds,
        nbf: nowSeconds,
        auth_time: nowSeconds
      }
      return Response.json({
        access_token: await signer.sign(mutateClaims({
          ...common,
          aud: audience,
          azp: clientId
        })),
        id_token: await signer.sign({
          ...common,
          aud: clientId,
          nonce
        }),
        refresh_token: 'refresh-token'
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as unknown as typeof fetch
  const service = new DesktopIdentityService({
    issuer,
    clientId,
    audience,
    identityClient,
    sessionStore,
    redirectUri,
    fetchImpl,
    now: () => now,
    openExternal: async (url) => {
      const authorizationUrl = new URL(url)
      nonce = authorizationUrl.searchParams.get('nonce') ?? ''
      const state = authorizationUrl.searchParams.get('state')
      await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state ?? '')}`)
    }
  })

  const result = await service.login()
  service.close()
  return result
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('durable refresh rotation escrow', () => {
  async function fixture() {
    const signer = await createSigner()
    let now = Date.parse('2026-08-18T12:00:00.000Z')
    const seconds = now / 1000
    const accessToken = await signer.sign({ iss: issuer, sub: 'original-subject', aud: audience, azp: clientId, exp: seconds + 300, iat: seconds, nbf: seconds, auth_time: seconds })
    const store = memorySessionStore({ version: 1, issuer, clientId, refreshToken: 'original-refresh-token', identity: { subject: 'original-subject', userId: 'usr_CloudUser000001' } })
    const tokenRequests: string[] = []
    const revokedTokens: string[] = []
    let failKeys = false
    let failMe = false
    let tokenBarrier: Promise<void> | undefined
    let tokenEntered: (() => void) | undefined
    const pauseNextToken = () => {
      let release!: () => void
      const entered = new Promise<void>((resolve) => { tokenEntered = resolve })
      tokenBarrier = new Promise<void>((resolve) => { release = resolve })
      return { entered, release }
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`, revocation_endpoint: `${issuer}/revoke` })
      if (url.endsWith('/revoke')) {
        revokedTokens.push(new URLSearchParams(String(init?.body)).get('token')!)
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/keys')) return failKeys ? new Response('', { status: 503 }) : Response.json({ keys: [signer.publicJwk] })
      if (url.endsWith('/token')) {
        const token = new URLSearchParams(String(init?.body)).get('refresh_token')!
        tokenRequests.push(token)
        if (tokenBarrier) {
          const barrier = tokenBarrier
          tokenBarrier = undefined
          tokenEntered?.()
          await barrier
        }
        if (tokenRequests.slice(0, -1).includes(token)) return new Response('', { status: 400 })
        const t = now / 1000
        return Response.json({ access_token: tokenRequests.length === 1 ? accessToken : await signer.sign({ iss: issuer, sub: 'original-subject', aud: audience, azp: clientId, exp: t + 300, iat: t, nbf: t, auth_time: seconds }), refresh_token: `rotated-refresh-token-${tokenRequests.length}` })
      }
      throw new Error('Unexpected request')
    }) as unknown as typeof fetch
    const me = vi.fn(async () => {
      if (failMe) throw new CloudIdentityClientError('provider_unavailable', 'Temporary cloud failure')
      return identityClient.getCurrentUser()
    })
    const make = () => new DesktopIdentityService({ issuer, clientId, audience, sessionStore: store, fetchImpl, identityClient: { getCurrentUser: me }, now: () => now, openExternal: async () => undefined })
    return { make, store, me, tokenRequests, revokedTokens, pauseNextToken, setKeysFailure: (v: boolean) => { failKeys = v }, setMeFailure: (v: boolean) => { failMe = v }, expire: () => { now += 600000 } }
  }

  it.each(['keys', 'me'])('retains R2 across %s failure and service restart without reusing R1 or publishing auth', async (stage) => {
    const f = await fixture()
    if (stage === 'keys') f.setKeysFailure(true)
    else f.setMeFailure(true)
    const first = f.make()
    expect((await first.initialize()).ok).toBe(false)
    expect(first.getAccessToken()).toBeNull()
    expect(first.getStatus().state).toBe('signed-out')
    expect(f.store.current()?.refreshToken).toBe('original-refresh-token')
    expect(f.store.current()?.pendingRefresh?.refreshToken).toBe('rotated-refresh-token-1')
    first.close()
    f.setKeysFailure(false)
    f.setMeFailure(false)
    const restarted = f.make()
    try {
      expect((await restarted.initialize()).ok).toBe(true)
      expect(restarted.getStatus().state).toBe('signed-in')
      expect(f.tokenRequests).toEqual(['original-refresh-token'])
      expect(f.store.current()?.refreshToken).toBe('rotated-refresh-token-1')
      expect(f.store.current()?.pendingRefresh).toBeUndefined()
    } finally { restarted.close() }
  })

  it.each(['keys', 'me'])('keeps the rotating credential owner when initialize joins refresh before %s failure', async (stage) => {
    const f = await fixture()
    const service = f.make()
    try {
      expect((await service.initialize()).ok).toBe(true)
      const rejected = service.getAccessToken()!
      const loadCount = f.store.load.mock.calls.length
      const blocked = f.pauseNextToken()
      if (stage === 'keys') f.setKeysFailure(true)
      else f.setMeFailure(true)
      const refreshing = service.renewAccessToken(rejected).catch((error: unknown) => error)
      await blocked.entered
      const initializing = service.initialize()
      // Let a concurrent vault load resolve before the provider rotates R1.
      await Promise.resolve()
      await Promise.resolve()
      blocked.release()
      expect((await initializing).ok).toBe(false)
      await refreshing
      expect(f.store.current()?.pendingRefresh?.refreshToken).toBe('rotated-refresh-token-2')
      f.setKeysFailure(false)
      f.setMeFailure(false)
      expect(await service.renewAccessToken(rejected)).toBeTruthy()
      expect(f.tokenRequests).toEqual(['original-refresh-token', 'rotated-refresh-token-1'])
      expect(f.store.current()?.refreshToken).toBe('rotated-refresh-token-2')
      expect(f.store.current()?.pendingRefresh).toBeUndefined()
      expect(f.store.clear).not.toHaveBeenCalled()
      expect(f.store.load).toHaveBeenCalledTimes(loadCount)
    } finally { service.close() }
  })

  it.each(['keys', 'me'])('revokes the pending rotated token on logout after %s failure', async (stage) => {
    const f = await fixture()
    if (stage === 'keys') f.setKeysFailure(true)
    else f.setMeFailure(true)
    const service = f.make()
    try {
      expect((await service.initialize()).ok).toBe(false)
      expect(f.store.current()?.pendingRefresh?.refreshToken).toBe('rotated-refresh-token-1')
      expect((await service.logout()).ok).toBe(true)
      expect(f.revokedTokens).toEqual(['rotated-refresh-token-1'])
      expect(f.store.current()).toBeNull()
      expect(service.getAccessToken()).toBeNull()
    } finally { service.close() }
  })

  it('renews expired escrow with verified R2 without granting expired access', async () => {
    const f = await fixture()
    f.setKeysFailure(true)
    const first = f.make()
    await first.initialize()
    first.close()
    f.expire()
    f.setKeysFailure(false)
    const restarted = f.make()
    try {
      expect((await restarted.initialize()).ok).toBe(true)
      expect(f.tokenRequests).toEqual(['original-refresh-token', 'rotated-refresh-token-1'])
      expect(restarted.getAccessToken()).not.toBeNull()
    } finally { restarted.close() }
  })

  it('rejects invalid escrow before /me or another refresh and clears it', async () => {
    const f = await fixture()
    await f.store.save({ ...f.store.current()!, pendingRefresh: { accessToken: 'invalid-jwt', refreshToken: 'rotated-refresh-token-1' } })
    const service = f.make()
    try {
      expect(await service.initialize()).toMatchObject({ ok: false, error: { code: 'OIDC_TOKEN_INVALID' } })
      expect(f.tokenRequests).toEqual([])
      expect(f.me).not.toHaveBeenCalled()
      expect(f.store.current()).toBeNull()
      expect(service.getAccessToken()).toBeNull()
    } finally { service.close() }
  })

  it.each(['subject', 'userId'])('rejects escrow that violates the trusted %s binding', async (field) => {
    const f = await fixture()
    await f.store.save({ ...f.store.current()!, identity: { subject: field === 'subject' ? 'different-subject' : 'original-subject', userId: field === 'userId' ? 'another-user' : 'usr_CloudUser000001' } })
    const service = f.make()
    try {
      expect((await service.initialize()).ok).toBe(false)
      expect(service.getAccessToken()).toBeNull()
      expect(f.store.current()).toBeNull()
      if (field === 'subject') expect(f.me).not.toHaveBeenCalled()
    } finally { service.close() }
  })

  it('rejects oversized stored pending data without requesting refresh or publishing auth', async () => {
    const f = await fixture()
    // The runtime validates pending data even when a custom session store is used.
    await f.store.save({ ...f.store.current()!, pendingRefresh: { accessToken: 'x'.repeat(100001) } })
    const service = f.make()
    try {
      expect((await service.initialize()).ok).toBe(true)
      expect(service.getAccessToken()).toBeNull()
      expect(f.store.current()).toBeNull()
      expect(f.tokenRequests).toEqual([])
    } finally { service.close() }
  })

  it('retries escrow persistence after storage failure without a second refresh', async () => {
    const f = await fixture()
    f.store.save.mockRejectedValueOnce(new DesktopIdentitySessionStoreError('vault unavailable'))
    const service = f.make()
    try {
      expect(await service.initialize()).toMatchObject({ ok: false, error: { code: 'OIDC_SESSION_STORAGE_UNAVAILABLE' } })
      expect(f.me).not.toHaveBeenCalled()
      expect(service.getAccessToken()).toBeNull()
      expect((await service.initialize()).ok).toBe(true)
      expect(f.tokenRequests).toEqual(['original-refresh-token'])
    } finally { service.close() }
  })

  it('shares concurrent refresh work and logout cannot resurrect an escrow save', async () => {
    const f = await fixture()
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const save = f.store.save.getMockImplementation()!
    f.store.save.mockImplementationOnce(async (session) => { entered(); await barrier; await save(session) })
    const service = f.make()
    const a = service.initialize()
    const b = service.initialize()
    expect(a).toBe(b)
    await started
    const logout = service.logout()
    release()
    await Promise.all([a, b, logout])
    expect(f.store.current()).toBeNull()
    expect(service.getStatus().state).toBe('signed-out')
    expect(service.getAccessToken()).toBeNull()
    service.close()
  })
})

describe('DesktopIdentityService', () => {
  it.each([
    { registeredUsername: 'nem', expectedName: 'Nem User' },
    { registeredUsername: 'researcher-b', expectedName: 'Nem User' },
    { registeredUsername: undefined, expectedName: 'Nem User' },
    { registeredUsername: '   ', expectedName: 'Nem User' }
  ])('uses the canonical cloud display name independently of login username $registeredUsername', async ({ registeredUsername, expectedName }) => {
    const signer = await createSigner()
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    let authorizationUrl: URL | null = null
    let now = Date.parse('2026-08-18T12:00:00.000Z')
    const sessionStore = memorySessionStore()

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        const nonce = authorizationUrl?.searchParams.get('nonce')
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000)
        }
        return Response.json({
          access_token: await signer.sign({
            ...common,
            aud: audience,
            azp: clientId,
            preferred_username: registeredUsername,
            email: 'nem@example.com'
          }),
          id_token: await signer.sign({
            ...common,
            aud: clientId,
            nonce,
            name: 'Nem User',
            preferred_username: registeredUsername,
            email: 'nem@example.com',
            email_verified: true
          }),
          refresh_token: 'refresh-token-initial'
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch

    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      redirectUri,
      fetchImpl,
      now: () => now,
      openExternal: async (url) => {
        authorizationUrl = new URL(url)
        // The Desktop session must outlive the browser SSO session of this login.
        expect(authorizationUrl.searchParams.get('scope')).toBe('openid profile email offline_access')
        // A browser SSO session from another account must not silently bind this Desktop.
        expect(authorizationUrl.searchParams.get('prompt')).toBe('login')
        expect(authorizationUrl.searchParams.get('max_age')).toBe('0')
        const state = authorizationUrl.searchParams.get('state')
        await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state ?? '')}`)
      }
    })
    const statusListener = vi.fn()
    service.subscribe(statusListener)

    const result = await service.login()

    expect(result).toEqual({
      ok: true,
      status: {
        state: 'signed-in',
        user: {
          userId: 'usr_CloudUser000001',
          oidcIdentityId: 'oid_CloudIdent0001',
          issuer,
          subject: 'keycloak-user-123',
          displayName: expectedName,
          ...(registeredUsername?.trim() ? { username: registeredUsername.trim() } : {}),
          email: 'nem@example.com',
          emailVerified: true
        },
        accessTokenExpiresAt: '2026-08-18T12:05:00.000Z'
      }
    })
    expect(JSON.stringify(result)).not.toContain('access_token')
    expect(service.getAccessToken()).toMatch(/^ey/)
    expect(statusListener).toHaveBeenLastCalledWith(result.status)
    expect(sessionStore.current()).toEqual({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-initial',
      idToken: expect.stringMatching(/^ey/),
      identity: { subject: 'keycloak-user-123', userId: 'usr_CloudUser000001' }
    })
    expect(JSON.stringify(sessionStore.current())).not.toContain(service.getAccessToken()!)

    const beforeRefresh = service.sessionIdentity()
    const profile = await identityClient.getCurrentUser()
    identityClient.getCurrentUser.mockResolvedValueOnce({ ...profile, displayName: 'Renamed Scientist', revision: 2 })
    const saveCount = sessionStore.save.mock.calls.length
    await service.refreshProfile()
    expect(service.getStatus()).toMatchObject({ state: 'signed-in', user: { displayName: 'Renamed Scientist' } })
    expect(service.sessionIdentity()).toEqual(beforeRefresh)
    expect(sessionStore.save).toHaveBeenCalledTimes(saveCount)
    expect(statusListener).toHaveBeenLastCalledWith(service.getStatus())

    const logout = await service.logout()
    expect(logout).toEqual({ ok: true, status: { state: 'signed-out' } })
    expect(service.getAccessToken()).toBeNull()
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(statusListener).toHaveBeenLastCalledWith({ state: 'signed-out' })
    service.close()
  })

  it('serializes an in-flight login save before logout clears the persisted session', async () => {
    const signer = await createSigner()
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const saveStarted = deferred<void>()
    const releaseSave = deferred<void>()
    const persistenceOrder: string[] = []
    let authorizationUrl: URL | null = null
    let stored: StoredDesktopIdentitySession | null = null
    const sessionStore = {
      load: vi.fn(async () => stored),
      save: vi.fn(async (next: StoredDesktopIdentitySession) => {
        persistenceOrder.push('save:start')
        saveStarted.resolve()
        await releaseSave.promise
        stored = next
        persistenceOrder.push('save:finish')
      }),
      clear: vi.fn(async () => {
        stored = null
        persistenceOrder.push('clear')
      }),
      current: () => stored
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000)
        }
        return Response.json({
          access_token: await signer.sign({ ...common, aud: audience, azp: clientId }),
          id_token: await signer.sign({
            ...common,
            aud: clientId,
            nonce: authorizationUrl?.searchParams.get('nonce')
          }),
          refresh_token: 'refresh-token-from-concurrent-login'
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      redirectUri,
      fetchImpl,
      now: () => now,
      openExternal: async (url) => {
        authorizationUrl = new URL(url)
        const state = authorizationUrl.searchParams.get('state')
        await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state ?? '')}`)
      }
    })

    const login = service.login()
    await saveStarted.promise
    let logoutSettled = false
    const logout = service.logout().finally(() => {
      logoutSettled = true
    })
    await Promise.resolve()
    expect(logoutSettled).toBe(false)

    releaseSave.resolve()
    await expect(logout).resolves.toEqual({ ok: true, status: { state: 'signed-out' } })
    await expect(login).resolves.toEqual({ ok: true, status: { state: 'signed-out' } })

    expect(persistenceOrder).toEqual(['save:start', 'save:finish', 'clear'])
    expect(sessionStore.current()).toBeNull()
    expect(sessionStore.save).toHaveBeenCalledOnce()
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    service.close()
  })

  it('fails closed when the interactive token response omits a refresh token', async () => {
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    const sessionStore = memorySessionStore()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        return Response.json({
          access_token: 'unsigned-access-token',
          id_token: 'unsigned-id-token'
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      redirectUri,
      fetchImpl,
      openExternal: async (url) => {
        const authorizationUrl = new URL(url)
        const state = authorizationUrl.searchParams.get('state')
        await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state ?? '')}`)
      }
    })

    const result = await service.login()

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OIDC_LOGIN_FAILED' },
      status: { state: 'signed-out' }
    })
    expect(sessionStore.save).not.toHaveBeenCalled()
    expect(sessionStore.current()).toBeNull()
    service.close()
  })

  it('surfaces the provider error_description when authorization fails', async () => {
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    const sessionStore = memorySessionStore()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      redirectUri,
      fetchImpl,
      openExternal: async (url) => {
        const authorizationUrl = new URL(url)
        const state = authorizationUrl.searchParams.get('state')
        const query = new URLSearchParams({
          error: 'invalid_scope',
          error_description: 'Invalid scopes: openid profile email offline_access',
          state: state ?? ''
        })
        await fetch(`${redirectUri}?${query.toString()}`)
      }
    })

    const result = await service.login()

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OIDC_LOGIN_FAILED',
        message: 'OIDC authorization failed: invalid_scope (Invalid scopes: openid profile email offline_access)'
      },
      status: { state: 'signed-out' }
    })
    expect(sessionStore.save).not.toHaveBeenCalled()
    expect(sessionStore.current()).toBeNull()
    service.close()
  })

  it('bounds the provider error_description and flattens line breaks', async () => {
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    const sessionStore = memorySessionStore()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      redirectUri,
      fetchImpl,
      openExternal: async (url) => {
        const authorizationUrl = new URL(url)
        const state = authorizationUrl.searchParams.get('state')
        const query = new URLSearchParams({
          error: 'server_error',
          error_description: `first\r\nsecond ${'x'.repeat(400)}`,
          state: state ?? ''
        })
        await fetch(`${redirectUri}?${query.toString()}`)
      }
    })

    const result = await service.login()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failed login')
    expect(result.error.message.startsWith('OIDC authorization failed: server_error (first second ')).toBe(true)
    expect(result.error.message.length).toBeLessThanOrEqual('OIDC authorization failed: server_error ()'.length + 300)
    expect(result.error.message).not.toMatch(/[\r\n]/u)
    service.close()
  })

  it.each([
    {
      name: 'missing iat',
      mutate: (claims: Record<string, unknown>) => withoutClaim(claims, 'iat'),
      message: 'The access token iat claim is missing or invalid.'
    },
    {
      name: 'missing nbf',
      mutate: (claims: Record<string, unknown>) => withoutClaim(claims, 'nbf'),
      message: 'The access token nbf claim is missing or invalid.'
    },
    {
      name: 'missing auth_time',
      mutate: (claims: Record<string, unknown>) => withoutClaim(claims, 'auth_time'),
      message: 'The access token auth_time claim is missing or invalid.'
    },
    {
      name: 'missing exp',
      mutate: (claims: Record<string, unknown>) => withoutClaim(claims, 'exp'),
      message: 'The token exp claim is missing or invalid.'
    },
    {
      name: 'future nbf',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        nbf: Number(claims.iat) + 61
      }),
      message: 'The access token nbf claim is in the future.'
    },
    {
      name: 'future iat',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        iat: Number(claims.iat) + 61
      }),
      message: 'The access token iat claim is in the future.'
    },
    {
      name: 'future auth_time',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        auth_time: Number(claims.iat) + 61
      }),
      message: 'The access token auth_time claim is in the future.'
    },
    {
      name: 'exp at nbf',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        nbf: Number(claims.iat) + 30,
        exp: Number(claims.iat) + 30
      }),
      message: 'The access token expires at or before its nbf claim.'
    },
    {
      name: 'exp at iat',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        iat: Number(claims.iat) + 30,
        exp: Number(claims.iat) + 30
      }),
      message: 'The access token expires at or before its iat claim.'
    },
    {
      name: 'auth_time after iat',
      mutate: (claims: Record<string, unknown>) => ({
        ...claims,
        auth_time: Number(claims.iat) + 30
      }),
      message: 'The access token auth_time claim is after its iat claim.'
    }
  ])('reports $name without exposing claim values', async ({ mutate, message }) => {
    const result = await loginWithAccessTimeClaims(mutate)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OIDC_TOKEN_INVALID', message },
      status: { state: 'signed-out' }
    })
  })

  it('restores a saved refresh session and persists refresh-token rotation without storing the access token', async () => {
    const signer = await createSigner()
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-before-restart'
    })
    let issuedAccessToken = ''
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token')
        expect(String(init?.body)).toContain('refresh_token=refresh-token-before-restart')
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000)
        }
        issuedAccessToken = await signer.sign({
          ...common,
          aud: audience,
          azp: clientId,
          preferred_username: 'nem'
        })
        return Response.json({
          access_token: issuedAccessToken,
          id_token: await signer.sign({ ...common, aud: clientId, name: 'Nem User' }),
          refresh_token: 'refresh-token-after-restart'
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      now: () => now,
      openExternal: vi.fn()
    })

    const result = await service.initialize()

    expect(result).toMatchObject({
      ok: true,
      status: { state: 'signed-in', user: { userId: 'usr_CloudUser000001', displayName: 'Nem User', username: 'nem' } }
    })
    expect(service.getAccessToken()).toBe(issuedAccessToken)
    expect(sessionStore.current()).toMatchObject({
      refreshToken: 'refresh-token-after-restart'
    })
    expect(JSON.stringify(sessionStore.current())).not.toContain(issuedAccessToken)
    service.close()
    expect(sessionStore.current()).toMatchObject({
      refreshToken: 'refresh-token-after-restart'
    })
  })

  it('coalesces concurrent rejected-token renewals into one refresh and one rotated token', async () => {
    const signer = await createSigner()
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-before-renewal'
    })
    let tokenRequests = 0
    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        tokenRequests += 1
        if (tokenRequests > 1) await refreshGate
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000),
          jti: `token-${tokenRequests}`
        }
        return Response.json({
          access_token: await signer.sign({ ...common, aud: audience, azp: clientId }),
          id_token: await signer.sign({ ...common, aud: clientId }),
          refresh_token: `refresh-token-rotated-${tokenRequests}`
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      now: () => now,
      openExternal: vi.fn()
    })

    try {
      await expect(service.initialize()).resolves.toMatchObject({ status: { state: 'signed-in' } })
      const rejectedToken = service.getAccessToken()!
      const renewals = Array.from({ length: 5 }, () => service.renewAccessToken(rejectedToken))
      const startedAt = Date.now()
      while (tokenRequests < 2 && Date.now() - startedAt < 1_000) {
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      expect(tokenRequests).toBe(2)
      releaseRefresh()
      const tokens = await Promise.all(renewals)
      expect(tokenRequests).toBe(2)
      expect(new Set(tokens).size).toBe(1)
      expect(tokens[0]).not.toBe(rejectedToken)
    } finally {
      service.close()
    }
  })

  it('does not replay a rejected token after the signed-in account switches', async () => {
    const signer = await createSigner()
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-user-a'
    })
    let activeUserId = 'usr_CloudUser000001'
    let tokenRequests = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        tokenRequests += 1
        const common = {
          iss: issuer,
          sub: activeUserId,
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000),
          jti: `token-${tokenRequests}`
        }
        return Response.json({
          access_token: await signer.sign({ ...common, aud: audience, azp: clientId }),
          id_token: await signer.sign({ ...common, aud: clientId }),
          refresh_token: `refresh-token-${activeUserId}-${tokenRequests}`
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const switchingIdentityClient = {
      getCurrentUser: vi.fn(async () => ({
        schemaVersion: 1 as const,
        type: 'me' as const,
        userId: activeUserId,
        displayName: activeUserId === 'usr_CloudUser000001' ? 'User A' : 'User B',
        status: 'active' as const,
        oidcIdentityId: `oid_${activeUserId}`,
        issuer,
        revision: 1,
        createdAt: '2026-08-18T12:00:00.000Z',
        updatedAt: '2026-08-18T12:00:00.000Z'
      }))
    }
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient: switchingIdentityClient,
      sessionStore,
      fetchImpl,
      now: () => now,
      openExternal: vi.fn()
    })

    try {
      await expect(service.initialize()).resolves.toMatchObject({
        status: { state: 'signed-in', user: { userId: 'usr_CloudUser000001' } }
      })
      const rejectedToken = service.getAccessToken()!
      const sessionA = service.sessionIdentity()
      expect(sessionA).not.toBeNull()

      await service.logout()
      await sessionStore.save({
        version: 1,
        issuer,
        clientId,
        refreshToken: 'refresh-token-user-b'
      })
      activeUserId = 'usr_CloudUser000002'
      await expect(service.initialize()).resolves.toMatchObject({
        status: { state: 'signed-in', user: { userId: 'usr_CloudUser000002' } }
      })
      const tokenB = service.getAccessToken()!
      const requestsBeforeRenewal = tokenRequests

      await expect(service.renewAccessToken(rejectedToken, sessionA!)).rejects.toMatchObject({
        code: 'OIDC_SESSION_EXPIRED'
      })
      expect(tokenRequests).toBe(requestsBeforeRenewal)
      expect(service.getAccessToken()).toBe(tokenB)
      expect(service.sessionIdentity()?.userId).toBe('usr_CloudUser000002')
    } finally {
      service.close()
    }
  })

  it('signs out only when the refresh token itself is rejected', async () => {
    const signer = await createSigner()
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-revoked'
    })
    let refreshRevoked = false
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        if (refreshRevoked) return Response.json({ error: 'invalid_grant' }, { status: 400 })
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000)
        }
        return Response.json({
          access_token: await signer.sign({ ...common, aud: audience, azp: clientId }),
          id_token: await signer.sign({ ...common, aud: clientId }),
          refresh_token: 'refresh-token-current'
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      now: () => now,
      openExternal: vi.fn()
    })

    try {
      await expect(service.initialize()).resolves.toMatchObject({ status: { state: 'signed-in' } })
      const rejectedToken = service.getAccessToken()!
      refreshRevoked = true
      await expect(service.renewAccessToken(rejectedToken)).rejects.toMatchObject({
        code: 'OIDC_SESSION_EXPIRED'
      })
      expect(service.getStatus()).toEqual({ state: 'signed-out' })
      expect(sessionStore.clear).toHaveBeenCalled()
    } finally {
      service.close()
    }
  })

  it('clears an unreadable saved session and returns to a stable signed-out state', async () => {
    const sessionStore = memorySessionStore()
    sessionStore.load.mockRejectedValueOnce(new DesktopIdentitySessionStoreError(
      'The saved login session is invalid or cannot be read from secure storage.'
    ))
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const openExternal = vi.fn()
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      openExternal
    })

    await expect(service.initialize()).resolves.toEqual({
      ok: true,
      status: { state: 'signed-out' }
    })
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    service.close()
  })

  it('coalesces concurrent logout calls without cancelling remote revocation or end-session', async () => {
    const signer = await createSigner()
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const revocationResponse = deferred<Response>()
    const revocationStarted = deferred<void>()
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-before-logout'
    })
    const openExternal = vi.fn(async (_url: string) => undefined)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`,
          revocation_endpoint: `${issuer}/protocol/openid-connect/revoke`,
          end_session_endpoint: `${issuer}/protocol/openid-connect/logout`
        })
      }
      if (url.endsWith('/protocol/openid-connect/certs')) {
        return Response.json({ keys: [signer.publicJwk] })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        const common = {
          iss: issuer,
          sub: 'keycloak-user-123',
          exp: Math.floor(now / 1000) + 300,
          iat: Math.floor(now / 1000),
          nbf: Math.floor(now / 1000),
          auth_time: Math.floor(now / 1000)
        }
        return Response.json({
          access_token: await signer.sign({ ...common, aud: audience, azp: clientId }),
          id_token: await signer.sign({ ...common, aud: clientId }),
          refresh_token: 'refresh-token-after-restore'
        })
      }
      if (url.endsWith('/protocol/openid-connect/revoke')) {
        revocationStarted.resolve()
        return revocationResponse.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const fetchImpl = fetchMock as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      now: () => now,
      openExternal
    })
    await expect(service.initialize()).resolves.toMatchObject({
      ok: true,
      status: { state: 'signed-in' }
    })

    const firstLogout = service.logout()
    await revocationStarted.promise
    const secondLogout = service.logout()
    expect(secondLogout).toBe(firstLogout)
    revocationResponse.resolve(new Response(null, { status: 200 }))

    await expect(firstLogout).resolves.toEqual({ ok: true, status: { state: 'signed-out' } })
    await expect(secondLogout).resolves.toEqual({ ok: true, status: { state: 'signed-out' } })
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/revoke'))).toHaveLength(1)
    expect(openExternal).toHaveBeenCalledOnce()
    expect(String(openExternal.mock.calls[0]?.[0])).toContain('/protocol/openid-connect/logout')
    service.close()
  })

  it('discards a deferred refresh after logout without restoring credentials or timers', async () => {
    vi.useFakeTimers()
    const refreshResponse = deferred<Response>()
    const refreshStarted = deferred<void>()
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-before-logout'
    })
    const linkAuthenticatedUser = vi.fn()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        refreshStarted.resolve()
        return refreshResponse.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      linkAuthenticatedUser,
      openExternal: vi.fn()
    })

    const initialization = service.initialize()
    await refreshStarted.promise
    await expect(service.logout()).resolves.toEqual({
      ok: true,
      status: { state: 'signed-out' }
    })
    refreshResponse.resolve(Response.json({
      access_token: 'stale-access-token',
      refresh_token: 'rotated-refresh-token'
    }))

    await expect(initialization).resolves.toEqual({
      ok: true,
      status: { state: 'signed-out' }
    })
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(sessionStore.save).not.toHaveBeenCalled()
    expect(linkAuthenticatedUser).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    service.close()
  })

  it('discards a deferred refresh after close without late persistence or publication', async () => {
    vi.useFakeTimers()
    const refreshResponse = deferred<Response>()
    const refreshStarted = deferred<void>()
    const sessionStore = memorySessionStore({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-before-close'
    })
    const linkAuthenticatedUser = vi.fn()
    const listener = vi.fn()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`
        })
      }
      if (url.endsWith('/protocol/openid-connect/token')) {
        refreshStarted.resolve()
        return refreshResponse.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      linkAuthenticatedUser,
      openExternal: vi.fn()
    })
    service.subscribe(listener)

    const initialization = service.initialize()
    await refreshStarted.promise
    service.close()
    refreshResponse.resolve(Response.json({
      access_token: 'stale-access-token',
      refresh_token: 'rotated-refresh-token'
    }))

    await expect(initialization).resolves.toEqual({
      ok: true,
      status: { state: 'signed-out' }
    })
    expect(sessionStore.save).not.toHaveBeenCalled()
    expect(linkAuthenticatedUser).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['logout', 'close'] as const)(
    'discards a deferred authorization-code exchange after %s',
    async (action) => {
      const port = await unusedPort()
      const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
      const tokenResponse = deferred<Response>()
      const tokenExchangeStarted = deferred<void>()
      const sessionStore = memorySessionStore()
      const linkAuthenticatedUser = vi.fn()
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
            token_endpoint: `${issuer}/protocol/openid-connect/token`,
            jwks_uri: `${issuer}/protocol/openid-connect/certs`
          })
        }
        if (url.endsWith('/protocol/openid-connect/token')) {
          tokenExchangeStarted.resolve()
          return tokenResponse.promise
        }
        throw new Error(`Unexpected request: ${url}`)
      }) as unknown as typeof fetch
      const service = new DesktopIdentityService({
        issuer,
        clientId,
        audience,
        identityClient,
        sessionStore,
        redirectUri,
        fetchImpl,
        linkAuthenticatedUser,
        openExternal: async (url) => {
          const authorizationUrl = new URL(url)
          const state = authorizationUrl.searchParams.get('state')
          await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state ?? '')}`)
        }
      })

      const login = service.login()
      await tokenExchangeStarted.promise
      if (action === 'logout') await service.logout()
      else service.close()
      tokenResponse.resolve(Response.json({
        access_token: 'stale-access-token',
        id_token: 'stale-id-token',
        refresh_token: 'stale-refresh-token'
      }))

      await expect(login).resolves.toEqual({
        ok: true,
        status: { state: 'signed-out' }
      })
      expect(service.getStatus()).toEqual({ state: 'signed-out' })
      expect(sessionStore.save).not.toHaveBeenCalled()
      expect(linkAuthenticatedUser).not.toHaveBeenCalled()
      if (action === 'logout') expect(sessionStore.clear).toHaveBeenCalledOnce()
      if (action === 'logout') service.close()
    }
  )

  it('discards a deferred restore after close before creating credentials or network work', async () => {
    const storedSession = deferred<StoredDesktopIdentitySession | null>()
    const sessionStore = memorySessionStore()
    sessionStore.load.mockImplementationOnce(() => storedSession.promise)
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const linkAuthenticatedUser = vi.fn()
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore,
      fetchImpl,
      linkAuthenticatedUser,
      openExternal: vi.fn()
    })

    const initialization = service.initialize()
    expect(sessionStore.load).toHaveBeenCalledOnce()
    service.close()
    storedSession.resolve({
      version: 1,
      issuer,
      clientId,
      refreshToken: 'refresh-token-after-close'
    })

    await expect(initialization).resolves.toEqual({
      ok: true,
      status: { state: 'signed-out' }
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(sessionStore.save).not.toHaveBeenCalled()
    expect(linkAuthenticatedUser).not.toHaveBeenCalled()
  })

  it('rejects a provider that cannot be reached without opening a browser', async () => {
    const openExternal = vi.fn()
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
      sessionStore: memorySessionStore(),
      openExternal,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch
    })

    const result = await service.login()

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OIDC_PROVIDER_UNAVAILABLE' },
      status: { state: 'signed-out' }
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    ['ENOTFOUND', 'DNS lookup failed'],
    ['ECONNREFUSED', 'connection refused'],
    ['UND_ERR_CONNECT_TIMEOUT', 'connection timed out'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS certificate chain could not be verified']
  ])('reports safe discovery cause %s without opening a browser', async (code, description) => {
    const openExternal = vi.fn()
    const service = new DesktopIdentityService({
      issuer, clientId, audience, identityClient,
      sessionStore: memorySessionStore(), openExternal,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('secret request content', {
          cause: Object.assign(new Error('Bearer secret-token https://private.example/'), { code })
        })
      }) as unknown as typeof fetch
    })
    const result = await service.login()
    expect(result).toMatchObject({ ok: false, error: {
      code: 'OIDC_PROVIDER_UNAVAILABLE',
      message: `Cannot reach the SciForge login service (discovery: ${description} [${code}]).`
    } })
    expect(JSON.stringify(result)).not.toMatch(/secret|private\.example|Bearer/)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('bounds aggregate causes and does not infer diagnostics from arbitrary error text', async () => {
    const unknown = Object.assign(new Error('ENOTFOUND token=secret'), { code: 'private-token' })
    const cycle = Object.assign(new Error('private-server-body'), { code: 'ECONNRESET', cause: unknown })
    Object.assign(unknown, { cause: cycle })
    const service = new DesktopIdentityService({
      issuer, clientId, audience, identityClient,
      sessionStore: memorySessionStore(), openExternal: vi.fn(),
      fetchImpl: vi.fn(async () => {
        throw new TypeError('fetch failed with private URL', { cause: new AggregateError([unknown, cycle], 'private headers') })
      }) as unknown as typeof fetch
    })
    expect(await service.login()).toMatchObject({ ok: false, error: {
      code: 'OIDC_PROVIDER_UNAVAILABLE',
      message: 'Cannot reach the SciForge login service (discovery: connection reset [ECONNRESET]).'
    } })
  })

  it('bounds hanging discovery and permits a subsequent explicit login attempt', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const openExternal = vi.fn()
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        signal = init?.signal
        return new Promise<Response>(() => undefined)
      })
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    const service = new DesktopIdentityService({
      issuer, clientId, audience, identityClient,
      sessionStore: memorySessionStore(), openExternal, fetchImpl
    })
    try {
      const first = service.login()
      await vi.advanceTimersByTimeAsync(14_999)
      expect(signal?.aborted).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(first).resolves.toMatchObject({ ok: false, error: {
        code: 'OIDC_PROVIDER_UNAVAILABLE',
        message: 'Cannot reach the SciForge login service (discovery: network request timed out [TimeoutError]).'
      } })
      expect(signal?.aborted).toBe(true)
      await expect(service.login()).resolves.toMatchObject({ ok: false, error: {
        message: 'SciForge login discovery failed with HTTP 503.'
      } })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(openExternal).not.toHaveBeenCalled()
    } finally {
      service.close()
    }
  })

  it.each(['discovery', 'token exchange', 'signing keys'] as const)(
    'bounds a stalled %s body without repeating token exchange', async (stage) => {
      vi.useFakeTimers()
      let stalledSignal: AbortSignal | null | undefined
      const sessionStore = memorySessionStore({ version: 1, issuer, clientId, refreshToken: 'saved-test-token' })
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        const current = url.endsWith('openid-configuration') ? 'discovery' :
          url.endsWith('/token') ? 'token exchange' : 'signing keys'
        if (current === stage) {
          stalledSignal = init?.signal
          return { ok: true, status: 200, json: () => new Promise(() => undefined) } as Response
        }
        if (current === 'discovery') return Response.json({
          issuer, authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/certs`
        })
        if (current === 'token exchange') return Response.json({ access_token: 'test-access-token' })
        throw new Error('Unexpected test endpoint')
      })
      const service = new DesktopIdentityService({
        issuer, clientId, audience, identityClient,
        sessionStore, openExternal: vi.fn(), fetchImpl
      })
      try {
        const restoring = service.initialize()
        await vi.advanceTimersByTimeAsync(15_000)
        await expect(restoring).resolves.toMatchObject({ ok: false, error: {
          code: 'OIDC_PROVIDER_UNAVAILABLE',
          message: `Cannot reach the SciForge login service (${stage}: network request timed out [TimeoutError]).`
        } })
        expect(stalledSignal?.aborted).toBe(true)
        expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(stage === 'discovery' ? 0 : 1)
        expect(sessionStore.clear).not.toHaveBeenCalled()
        if (stage === 'signing keys') expect(sessionStore.current()?.pendingRefresh?.accessToken).toBe('test-access-token')
        else expect(sessionStore.save).not.toHaveBeenCalled()
      } finally {
        service.close()
      }
    }
  )

  it('does not accept non-loopback HTTP issuers', () => {
    expect(() => new DesktopIdentityService({
      issuer: 'http://login.example.com/realms/SciForge',
      clientId,
      audience,
      identityClient,
      sessionStore: memorySessionStore(),
      openExternal: vi.fn()
    })).toThrow('must use HTTPS')
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
