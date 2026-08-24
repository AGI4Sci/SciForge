import { afterEach, describe, expect, it, vi } from 'vitest'

import { startOidcFixtureServer } from './test-fixtures/oidc-fixture.mjs'
import {
  OidcAccessTokenVerifier,
  OidcVerificationError,
  type OidcAccessTokenVerifierOptions,
  type OidcVerificationErrorCode
} from './oidc.js'

const NOW = new Date('2026-08-18T12:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000)
const fixtures: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function openOidcFixture() {
  const fixture = await startOidcFixtureServer()
  fixtures.push(fixture)
  return fixture
}

function verifierFor(
  fixture: { issuer: string },
  overrides: Partial<OidcAccessTokenVerifierOptions> = {}
): OidcAccessTokenVerifier {
  return new OidcAccessTokenVerifier({
    issuer: fixture.issuer,
    allowInsecureLoopback: true,
    now: () => NOW,
    ...overrides
  })
}

async function expectOidcCode(
  promise: Promise<unknown>,
  code: OidcVerificationErrorCode
): Promise<OidcVerificationError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(OidcVerificationError)
    expect(error).toMatchObject({ code })
    return error as OidcVerificationError
  }
  throw new Error(`Expected OIDC verification error ${code}.`)
}

function jsonResponse(value: unknown, cacheControl = 'public, max-age=60'): Response {
  const body = JSON.stringify(value)
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': cacheControl,
      'content-length': String(Buffer.byteLength(body)),
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

describe('OIDC RS256 access-token verifier', () => {
  it('verifies a dynamic RS256 token and returns only bounded identity fields', async () => {
    const fixture = await openOidcFixture()
    const verifier = verifierFor(fixture)
    const token = fixture.mintToken({
      now: NOW_SECONDS,
      claims: {
        aud: 'sciforge-cloud-api',
        email: 'owner@example.invalid',
        email_verified: true,
        preferred_username: 'test-owner',
        name: 'Test Owner'
      }
    })

    await expect(verifier.verifyAccessToken(token)).resolves.toEqual({
      issuer: fixture.issuer,
      subject: 'oidc-sub-test-owner',
      audience: ['sciforge-cloud-api'],
      authorizedParty: 'sciforge-desktop',
      issuedAt: NOW_SECONDS,
      notBefore: NOW_SECONDS - 1,
      expiresAt: NOW_SECONDS + 300,
      authTime: NOW_SECONDS,
      email: 'owner@example.invalid',
      emailVerified: true,
      preferredUsername: 'test-owner',
      displayName: 'Test Owner'
    })
    await expect(verifier.verify(token)).resolves.toMatchObject({
      issuer: fixture.issuer,
      subject: 'oidc-sub-test-owner'
    })
  })

  it('accepts a standards-compliant token without nbf and uses iat as its effective activation time', async () => {
    const fixture = await openOidcFixture()
    const verifier = verifierFor(fixture)
    const issuedAt = NOW_SECONDS - 5
    const token = fixture.mintToken({
      now: NOW_SECONDS,
      claims: {
        nbf: undefined,
        iat: issuedAt,
        auth_time: issuedAt
      }
    })

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      issuer: fixture.issuer,
      issuedAt,
      notBefore: issuedAt,
      expiresAt: NOW_SECONDS + 300,
      authTime: issuedAt
    })
  })

  it('verifies an ID token against the confidential Portal client and one-time nonce', async () => {
    const fixture = await openOidcFixture()
    const verifier = verifierFor(fixture, {
      allowedAuthorizedParties: ['sciforge-desktop', 'sciforge-web-mobile', 'sciforge-cloud-console']
    })
    const nonce = 'A'.repeat(43)
    const token = fixture.mintToken({
      now: NOW_SECONDS,
      header: { typ: 'JWT' },
      claims: {
        aud: 'sciforge-cloud-console',
        azp: 'sciforge-cloud-console',
        nonce
      }
    })

    await expect(verifier.verifyIdToken(token, {
      clientId: 'sciforge-cloud-console',
      nonce
    })).resolves.toEqual({
      issuer: fixture.issuer,
      subject: 'oidc-sub-test-owner',
      audience: ['sciforge-cloud-console'],
      issuedAt: NOW_SECONDS,
      notBefore: NOW_SECONDS - 1,
      expiresAt: NOW_SECONDS + 300,
      authTime: NOW_SECONDS,
      nonce
    })

    await expectOidcCode(verifier.verifyIdToken(token, {
      clientId: 'sciforge-cloud-console',
      nonce: 'B'.repeat(43)
    }), 'oidc_claim_invalid')
    await expectOidcCode(verifier.verifyIdToken(fixture.mintToken({
      now: NOW_SECONDS,
      header: { typ: 'at+jwt' },
      claims: { aud: 'sciforge-cloud-console', azp: 'sciforge-cloud-console', nonce }
    }), { clientId: 'sciforge-cloud-console', nonce }), 'oidc_claim_invalid')
    await expectOidcCode(verifier.verifyIdToken(fixture.mintToken({
      now: NOW_SECONDS,
      claims: { aud: ['sciforge-cloud-console', 'another-client'], azp: undefined, nonce }
    }), { clientId: 'sciforge-cloud-console', nonce }), 'oidc_claim_invalid')
  })

  it('keeps public API and confidential Portal access-token authorized parties disjoint', async () => {
    const fixture = await openOidcFixture()
    const publicVerifier = verifierFor(fixture, {
      allowedAuthorizedParties: ['sciforge-desktop', 'sciforge-web-mobile']
    })
    const portalVerifier = verifierFor(fixture, {
      allowedAuthorizedParties: ['sciforge-cloud-console']
    })
    const portalToken = fixture.mintToken({
      now: NOW_SECONDS,
      claims: { azp: 'sciforge-cloud-console' }
    })
    const desktopToken = fixture.mintToken({
      now: NOW_SECONDS,
      claims: { azp: 'sciforge-desktop' }
    })

    await expect(portalVerifier.verifyAccessToken(portalToken)).resolves.toMatchObject({
      authorizedParty: 'sciforge-cloud-console'
    })
    await expectOidcCode(publicVerifier.verifyAccessToken(portalToken), 'oidc_claim_invalid')
    await expect(publicVerifier.verifyAccessToken(desktopToken)).resolves.toMatchObject({
      authorizedParty: 'sciforge-desktop'
    })
    await expectOidcCode(portalVerifier.verifyAccessToken(desktopToken), 'oidc_claim_invalid')
  })

  it('rejects exact issuer, audience, authorized-party, subject, and time claim violations', async () => {
    const fixture = await openOidcFixture()
    const verifier = verifierFor(fixture)
    const cases: Array<{
      label: string
      claims: Record<string, unknown>
      code: OidcVerificationErrorCode
    }> = [
      { label: 'issuer trailing slash', claims: { iss: `${fixture.issuer}/` }, code: 'oidc_claim_invalid' },
      { label: 'wrong audience', claims: { aud: ['another-api'] }, code: 'oidc_claim_invalid' },
      { label: 'duplicate audience', claims: { aud: ['sciforge-cloud-api', 'sciforge-cloud-api'] }, code: 'oidc_claim_invalid' },
      { label: 'wrong authorized party', claims: { azp: 'sciforge-zulip-bot' }, code: 'oidc_claim_invalid' },
      { label: 'missing subject', claims: { sub: undefined }, code: 'oidc_claim_invalid' },
      { label: 'expired', claims: { exp: NOW_SECONDS }, code: 'oidc_token_expired' },
      { label: 'future not-before', claims: { nbf: NOW_SECONDS + 1 }, code: 'oidc_token_not_active' },
      { label: 'string not-before', claims: { nbf: String(NOW_SECONDS - 1) }, code: 'oidc_claim_invalid' },
      { label: 'future issued-at', claims: { iat: NOW_SECONDS + 1 }, code: 'oidc_claim_invalid' },
      { label: 'future authentication time', claims: { auth_time: NOW_SECONDS + 1 }, code: 'oidc_claim_invalid' },
      { label: 'authentication after issuance', claims: {
        iat: NOW_SECONDS - 10, auth_time: NOW_SECONDS - 5
      }, code: 'oidc_claim_invalid' },
      { label: 'string expiration', claims: { exp: String(NOW_SECONDS + 300) }, code: 'oidc_claim_invalid' },
      { label: 'missing authentication time', claims: { auth_time: undefined }, code: 'oidc_claim_invalid' },
      { label: 'invalid selected profile claim', claims: { email_verified: 'true' }, code: 'oidc_claim_invalid' }
    ]

    for (const candidate of cases) {
      const token = fixture.mintToken({ now: NOW_SECONDS, claims: candidate.claims })
      const error = await expectOidcCode(verifier.verifyAccessToken(token), candidate.code)
      expect(error.message, candidate.label).not.toContain(token)
    }
  })

  it('rejects untrusted headers, malformed tokens, unknown keys, and a foreign signature with the same kid', async () => {
    const fixture = await openOidcFixture()
    const foreignFixture = await openOidcFixture()
    let fetchCount = 0
    const countingFetch: typeof fetch = async (input, init) => {
      fetchCount += 1
      return fetch(input, init)
    }
    const verifier = verifierFor(fixture, { fetch: countingFetch })
    const valid = fixture.mintToken({ now: NOW_SECONDS })
    await verifier.verifyAccessToken(valid)
    expect(fetchCount).toBe(2)

    const fetchesBeforeLocalRejections = fetchCount
    await expectOidcCode(verifier.verifyAccessToken(fixture.mintToken({
      now: NOW_SECONDS,
      header: { alg: 'HS256' }
    })), 'oidc_algorithm_rejected')
    await expectOidcCode(verifier.verifyAccessToken(fixture.mintToken({
      now: NOW_SECONDS,
      header: { kid: undefined }
    })), 'oidc_token_malformed')
    await expectOidcCode(verifier.verifyAccessToken(fixture.mintToken({
      now: NOW_SECONDS,
      header: { jku: 'https://attacker.example.invalid/jwks.json' }
    })), 'oidc_token_malformed')
    await expectOidcCode(verifier.verifyAccessToken('not-a-jwt'), 'oidc_token_malformed')
    expect(fetchCount).toBe(fetchesBeforeLocalRejections)

    const foreignToken = foreignFixture.mintToken({
      now: NOW_SECONDS,
      claims: { iss: fixture.issuer }
    })
    expect(foreignFixture.currentKid()).toBe(fixture.currentKid())
    await expectOidcCode(verifier.verifyAccessToken(foreignToken), 'oidc_signature_invalid')
    expect(fetchCount).toBe(fetchesBeforeLocalRejections)

    const unknownKidToken = fixture.mintToken({
      now: NOW_SECONDS,
      header: { kid: 'unknown-rs256-key' }
    })
    await expectOidcCode(verifier.verifyAccessToken(unknownKidToken), 'oidc_key_not_found')
    expect(fetchCount).toBe(fetchesBeforeLocalRejections + 1)
  })

  it('caches discovery and JWKS and coalesces one refresh when a rotated kid appears', async () => {
    const fixture = await openOidcFixture()
    const counts = { discovery: 0, jwks: 0 }
    const countingFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url === fixture.discoveryUrl) counts.discovery += 1
      if (url === fixture.jwksUri) counts.jwks += 1
      return fetch(input, init)
    }
    const verifier = verifierFor(fixture, { fetch: countingFetch })
    const firstToken = fixture.mintToken({ now: NOW_SECONDS })

    await verifier.verifyAccessToken(firstToken)
    await verifier.verifyAccessToken(firstToken)
    expect(counts).toEqual({ discovery: 1, jwks: 1 })

    fixture.rotateSigningKey({ keepPrevious: true })
    const rotatedToken = fixture.mintToken({ now: NOW_SECONDS })
    await Promise.all(Array.from({ length: 12 }, () => verifier.verifyAccessToken(rotatedToken)))
    expect(counts).toEqual({ discovery: 1, jwks: 2 })
    await expect(verifier.verifyAccessToken(firstToken)).resolves.toMatchObject({
      subject: 'oidc-sub-test-owner'
    })

    const unknownKid = fixture.mintToken({ now: NOW_SECONDS, header: { kid: 'unknown-concurrent-kid' } })
    const failures = await Promise.all(Array.from({ length: 12 }, async () => {
      try {
        await verifier.verifyAccessToken(unknownKid)
        return 'unexpected-success'
      } catch (error) {
        return error instanceof OidcVerificationError ? error.code : 'unexpected-error'
      }
    }))
    expect(new Set(failures)).toEqual(new Set(['oidc_key_not_found']))
    expect(counts).toEqual({ discovery: 1, jwks: 2 })
  })

  it('bounds sequential unknown-kid refreshes globally and recovers a real rotation after cooldown', async () => {
    const fixture = await openOidcFixture()
    expect(() => verifierFor(fixture, { unknownKidRefreshCooldownMs: 99 })).toThrowError(
      expect.objectContaining({ code: 'oidc_configuration_invalid' })
    )
    expect(() => verifierFor(fixture, { unknownKidRefreshCooldownMs: 60_001 })).toThrowError(
      expect.objectContaining({ code: 'oidc_configuration_invalid' })
    )
    let currentTime = NOW.getTime()
    const counts = { discovery: 0, jwks: 0 }
    const countingFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url === fixture.discoveryUrl) counts.discovery += 1
      if (url === fixture.jwksUri) counts.jwks += 1
      return fetch(input, init)
    }
    const verifier = verifierFor(fixture, {
      fetch: countingFetch,
      now: () => new Date(currentTime),
      unknownKidRefreshCooldownMs: 1_000
    })

    await verifier.verifyAccessToken(fixture.mintToken({ now: NOW_SECONDS }))
    expect(counts).toEqual({ discovery: 1, jwks: 1 })

    for (let index = 0; index < 100; index += 1) {
      const unknownKid = fixture.mintToken({
        now: NOW_SECONDS,
        header: { kid: `unknown-sequential-${index}` }
      })
      await expectOidcCode(verifier.verifyAccessToken(unknownKid), 'oidc_key_not_found')
    }
    expect(counts).toEqual({ discovery: 1, jwks: 2 })

    fixture.rotateSigningKey({ keepPrevious: true })
    const rotatedToken = fixture.mintToken({ now: NOW_SECONDS })
    await expectOidcCode(verifier.verifyAccessToken(rotatedToken), 'oidc_key_not_found')
    expect(counts).toEqual({ discovery: 1, jwks: 2 })

    currentTime += 1_001
    await expect(Promise.all(Array.from({ length: 12 }, () => verifier.verifyAccessToken(rotatedToken))))
      .resolves.toHaveLength(12)
    expect(counts).toEqual({ discovery: 1, jwks: 3 })
  })

  it('caps provider cache lifetime even when Discovery and JWKS advertise a longer max-age', async () => {
    const fixture = await openOidcFixture()
    let currentTime = NOW.getTime()
    const counts = { discovery: 0, jwks: 0 }
    const countingFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url === fixture.discoveryUrl) counts.discovery += 1
      if (url === fixture.jwksUri) counts.jwks += 1
      return fetch(input, init)
    }
    const verifier = verifierFor(fixture, {
      fetch: countingFetch,
      now: () => new Date(currentTime),
      defaultCacheTtlMs: 1_000,
      maxCacheTtlMs: 1_000
    })
    const token = fixture.mintToken({ now: NOW_SECONDS })

    await verifier.verifyAccessToken(token)
    currentTime += 999
    await verifier.verifyAccessToken(token)
    expect(counts).toEqual({ discovery: 1, jwks: 1 })

    currentTime += 2
    await verifier.verifyAccessToken(token)
    expect(counts).toEqual({ discovery: 2, jwks: 2 })
  })

  it('requires an exact Discovery issuer and refuses off-origin JWKS URLs without fetching them', async () => {
    const fixture = await openOidcFixture()
    const token = fixture.mintToken({ now: NOW_SECONDS })
    const mismatchFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (String(input) !== fixture.discoveryUrl) return response
      const discovery = await response.json() as Record<string, unknown>
      return jsonResponse({ ...discovery, issuer: `${fixture.issuer}/` })
    }
    await expectOidcCode(
      verifierFor(fixture, { fetch: mismatchFetch }).verifyAccessToken(token),
      'oidc_discovery_invalid'
    )

    const requestedUrls: string[] = []
    const offOriginFetch: typeof fetch = async (input, init) => {
      requestedUrls.push(String(input))
      const response = await fetch(input, init)
      if (String(input) !== fixture.discoveryUrl) return response
      const discovery = await response.json() as Record<string, unknown>
      return jsonResponse({ ...discovery, jwks_uri: 'https://attacker.example.invalid/jwks.json' })
    }
    await expectOidcCode(
      verifierFor(fixture, { fetch: offOriginFetch }).verifyAccessToken(token),
      'oidc_discovery_invalid'
    )
    expect(requestedUrls).toEqual([fixture.discoveryUrl])
  })

  it('accepts insecure HTTP only for explicitly enabled numeric loopback issuers', async () => {
    const fixture = await openOidcFixture()
    expect(() => new OidcAccessTokenVerifier({ issuer: fixture.issuer })).toThrowError(expect.objectContaining({
      code: 'oidc_configuration_invalid'
    }))
    expect(() => new OidcAccessTokenVerifier({
      issuer: 'http://localhost:8080/realms/SciForge',
      allowInsecureLoopback: true
    })).toThrowError(expect.objectContaining({ code: 'oidc_configuration_invalid' }))

    const verifier = verifierFor(fixture)
    await expect(verifier.verifyAccessToken(fixture.mintToken({ now: NOW_SECONDS }))).resolves.toMatchObject({
      issuer: fixture.issuer
    })
  })

  it('rejects non-RS256, non-RSA, duplicate, and private JWKS material', async () => {
    const fixture = await openOidcFixture()
    const token = fixture.mintToken({ now: NOW_SECONDS })
    const mutations: Array<{
      label: string
      mutate(value: { keys: Array<Record<string, unknown>> }): unknown
    }> = [
      {
        label: 'wrong key algorithm',
        mutate: (value) => ({ keys: value.keys.map((key) => ({ ...key, alg: 'PS256' })) })
      },
      {
        label: 'wrong key type',
        mutate: (value) => ({ keys: value.keys.map((key) => ({ ...key, kty: 'EC' })) })
      },
      {
        label: 'duplicate kid',
        mutate: (value) => ({ keys: [...value.keys, { ...value.keys[0] }] })
      },
      {
        label: 'private RSA field',
        mutate: (value) => ({ keys: value.keys.map((key) => ({ ...key, d: 'AQ' })) })
      }
    ]

    for (const mutation of mutations) {
      const mutatedFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, init)
        if (String(input) !== fixture.jwksUri) return response
        const jwks = await response.json() as { keys: Array<Record<string, unknown>> }
        return jsonResponse(mutation.mutate(jwks))
      }
      const error = await expectOidcCode(
        verifierFor(fixture, { fetch: mutatedFetch }).verifyAccessToken(token),
        'oidc_jwks_invalid'
      )
      expect(error.message, mutation.label).toBe('The OIDC signing-key document is invalid.')
    }
  })

  it('bounds response bodies and request timeouts with stable retry semantics', async () => {
    const fixture = await openOidcFixture()
    const syntheticIssuer = 'https://login-test.example.invalid/realms/SciForge'
    const token = fixture.mintToken({ now: NOW_SECONDS, claims: { iss: syntheticIssuer } })
    const oversizedFetch: typeof fetch = async () => new Response('x'.repeat(2_048), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '2048' }
    })
    await expectOidcCode(new OidcAccessTokenVerifier({
      issuer: syntheticIssuer,
      fetch: oversizedFetch,
      now: () => NOW,
      maxResponseBytes: 1_024
    }).verifyAccessToken(token), 'oidc_discovery_invalid')

    const timeoutFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    const timeoutError = await expectOidcCode(new OidcAccessTokenVerifier({
      issuer: syntheticIssuer,
      fetch: timeoutFetch,
      now: () => NOW,
      requestTimeoutMs: 20
    }).verifyAccessToken(token), 'oidc_discovery_unavailable')
    expect(timeoutError.retryable).toBe(true)
  })

  it('never emits tokens, claims, or authorization material through errors or console output', async () => {
    const fixture = await openOidcFixture()
    const marker = 'SENSITIVE-OIDC-CLAIM-MARKER'
    const token = fixture.mintToken({
      now: NOW_SECONDS,
      claims: { iss: `${fixture.issuer}/`, sub: marker }
    })
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ]

    const error = await expectOidcCode(verifierFor(fixture).verifyAccessToken(token), 'oidc_claim_invalid')
    const rendered = `${error.name}\n${error.code}\n${error.message}\n${error.stack ?? ''}`
    expect(rendered).not.toContain(token)
    expect(rendered).not.toContain(marker)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
