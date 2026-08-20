import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopIdentityService } from './desktop-identity-service'
import type { StoredDesktopIdentitySession } from './desktop-identity-session-store'

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

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('DesktopIdentityService', () => {
  it('completes browser PKCE login and exposes only a safe account status', async () => {
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
            preferred_username: 'nem',
            email: 'nem@example.com'
          }),
          id_token: await signer.sign({
            ...common,
            aud: clientId,
            nonce,
            name: 'Nem User',
            preferred_username: 'nem',
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
          displayName: 'Nem User',
          username: 'nem',
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
      idToken: expect.stringMatching(/^ey/)
    })
    expect(JSON.stringify(sessionStore.current())).not.toContain(service.getAccessToken()!)

    const logout = await service.logout()
    expect(logout).toEqual({ ok: true, status: { state: 'signed-out' } })
    expect(service.getAccessToken()).toBeNull()
    expect(sessionStore.clear).toHaveBeenCalledOnce()
    expect(statusListener).toHaveBeenLastCalledWith({ state: 'signed-out' })
    service.close()
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
      status: { state: 'signed-in', user: { userId: 'usr_CloudUser000001' } }
    })
    expect(service.getAccessToken()).toBe(issuedAccessToken)
    expect(sessionStore.current()).toMatchObject({
      refreshToken: 'refresh-token-after-restart'
    })
    expect(JSON.stringify(sessionStore.current())).not.toContain(issuedAccessToken)
    service.close()
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
