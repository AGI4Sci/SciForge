import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { DesktopIdentityService } from './oidc-service.js'

const issuer = 'http://127.0.0.1:8080/realms/SciForge'

async function callbackUri(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing callback port')
  const uri = `http://127.0.0.1:${address.port}/oidc/callback`
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return uri
}

async function attemptLogin(
  visit: (uri: string, state: string) => Promise<void>
) {
  const redirectUri = await callbackUri()
  const tokenRequests: URLSearchParams[] = []
  const service = new DesktopIdentityService({
    issuer,
    clientId: 'sciforge-desktop',
    audience: 'sciforge-cloud-api',
    redirectUri,
    identityClient: { getCurrentUser: vi.fn() },
    sessionStore: { load: async () => null, save: vi.fn(), clear: vi.fn() },
    fetchImpl: vi.fn(async (input, init) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/certs`
        })
      }
      if (String(input) === `${issuer}/token`) {
        tokenRequests.push(new URLSearchParams(String(init?.body)))
        // Stop after the real callback hands its code to the token exchange;
        // signature verification is covered by the service tests.
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      throw new Error('Unexpected identity request')
    }) as typeof fetch,
    openExternal: async (url) => {
      const state = new URL(url).searchParams.get('state')
      if (!state) throw new Error('Missing authorization state')
      await visit(redirectUri, state)
    }
  })
  try {
    return { result: await service.login(), tokenRequests }
  } finally {
    service.close()
  }
}

describe('OAuth loopback callback isolation', () => {
  it.each([
    ['missing state with code', 'code=stale-code'],
    ['wrong state with code', 'state=stale-state&code=stale-code'],
    ['missing state with cancellation', 'error=access_denied'],
    ['wrong state with cancellation', 'state=stale-state&error=access_denied'],
    ['missing state with provider failure', 'error=server_error&error_description=stale-error'],
    ['wrong state with provider failure', 'state=stale-state&error=server_error&error_description=stale-error']
  ])('ignores %s and accepts the pending login callback', async (_name, staleQuery) => {
    const { tokenRequests } = await attemptLogin(async (uri, state) => {
      const stale = await fetch(`${uri}?${staleQuery}`)
      expect(stale.status).toBe(400)
      expect(stale.headers.get('cache-control')).toBe('no-store')
      expect(await stale.text()).toContain('SciForge login failed')
      const valid = await fetch(`${uri}?state=${encodeURIComponent(state)}&code=current-code`)
      expect(valid.status).toBe(200)
      const page = await valid.text()
      expect(page).toContain('SciForge authorization received')
      expect(page).toContain('check the login result')
      expect(page).not.toContain('SciForge login completed')
    })
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0].get('code')).toBe('current-code')
  })

  it('honors provider cancellation only for the pending login state', async () => {
    const { result, tokenRequests } = await attemptLogin(async (uri, state) => {
      const response = await fetch(`${uri}?state=${encodeURIComponent(state)}&error=access_denied`)
      expect(response.status).toBe(200)
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'OIDC_LOGIN_CANCELLED' } })
    expect(tokenRequests).toHaveLength(0)
  })

  it('reports a provider failure only for the pending login state', async () => {
    const { result, tokenRequests } = await attemptLogin(async (uri, state) => {
      await fetch(`${uri}?state=${encodeURIComponent(state)}&error=invalid_scope&error_description=Missing%20scope`)
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OIDC_LOGIN_FAILED', message: 'OIDC authorization failed: invalid_scope (Missing scope)' }
    })
    expect(tokenRequests).toHaveLength(0)
  })
})
