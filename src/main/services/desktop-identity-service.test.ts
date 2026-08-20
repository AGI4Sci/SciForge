import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopIdentityService } from './desktop-identity-service'

const issuer = 'http://127.0.0.1:8080/realms/SciForge'
const clientId = 'sciforge-desktop'
const audience = 'sciforge-cloud-api'
const identityClient = {
  getCurrentUser: vi.fn(async () => ({
    protocolVersion: '1.0' as const,
    requestId: 'req_DesktopLogin0001',
    type: 'identity.me' as const,
    user: {
      schemaVersion: 1 as const,
      type: 'user_principal' as const,
      userId: 'usr_CloudUser000001',
      displayName: 'Nem User',
      status: 'active' as const,
      revision: 1,
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z'
    },
    identity: {
      schemaVersion: 1 as const,
      type: 'oidc_external_identity' as const,
      externalIdentityId: 'xid_CloudIdent0001',
      userId: 'usr_CloudUser000001',
      issuer,
      subject: 'keycloak-user-123',
      emailAtLinkTime: 'nem@example.com',
      status: 'active' as const,
      verifiedAt: '2026-08-18T12:00:00.000Z',
      revision: 1,
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z'
    }
  }))
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
  vi.restoreAllMocks()
})

describe('DesktopIdentityService', () => {
  it('completes browser PKCE login and exposes only a safe account status', async () => {
    const signer = await createSigner()
    const port = await unusedPort()
    const redirectUri = `http://127.0.0.1:${port}/oidc/callback`
    let authorizationUrl: URL | null = null
    let now = Date.parse('2026-08-18T12:00:00.000Z')

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
          iat: Math.floor(now / 1000)
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
          })
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as unknown as typeof fetch

    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
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
          externalIdentityId: 'xid_CloudIdent0001',
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

    now += 5 * 60 * 1000
    expect(service.getStatus()).toEqual({ state: 'signed-out' })
    expect(service.getAccessToken()).toBeNull()
    expect(statusListener).toHaveBeenLastCalledWith({ state: 'signed-out' })
    expect(service.logout()).toEqual({ ok: true, status: { state: 'signed-out' } })
    expect(statusListener).toHaveBeenLastCalledWith({ state: 'signed-out' })
    service.close()
  })

  it('rejects a provider that cannot be reached without opening a browser', async () => {
    const openExternal = vi.fn()
    const service = new DesktopIdentityService({
      issuer,
      clientId,
      audience,
      identityClient,
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
      openExternal: vi.fn()
    })).toThrow('must use HTTPS')
  })
})
