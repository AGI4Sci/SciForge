import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  CollaborationIdentityClientError,
  type CollaborationIdentityClient
} from '@sciforge/collaboration-identity'
import type { CurrentUserResponse, VerifiedOidcClaims } from '@sciforge/collaboration-contracts'
import type {
  DesktopIdentityActionResult,
  DesktopIdentityErrorCode,
  DesktopIdentityStatus,
  DesktopIdentityUser
} from '../../shared/desktop-identity'

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43110/oidc/callback'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

type DesktopIdentityServiceOptions = {
  issuer: string
  clientId: string
  audience: string
  identityClient: Pick<CollaborationIdentityClient, 'getCurrentUser'>
  openExternal: (url: string) => Promise<unknown>
  redirectUri?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

export type DesktopIdentityStatusListener = (status: DesktopIdentityStatus) => void

type OidcDiscovery = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
}

type JsonWebKeySet = {
  keys: Array<JsonWebKey & { kid?: string }>
}

type JwtParts = {
  encodedHeader: string
  encodedClaims: string
  encodedSignature: string
  header: Record<string, unknown>
  claims: Record<string, unknown>
}

type TokenResponse = {
  accessToken: string
  idToken: string
}

class DesktopIdentityError extends Error {
  constructor(
    readonly code: DesktopIdentityErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DesktopIdentityError'
  }
}

function trimIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function decodeJwtPart(value: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('JWT section is not an object.')
    }
    return decoded as Record<string, unknown>
  } catch {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The identity provider returned an invalid token.')
  }
}

function parseJwt(token: string): JwtParts {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The identity provider returned an invalid token.')
  }
  return {
    encodedHeader: parts[0]!,
    encodedClaims: parts[1]!,
    encodedSignature: parts[2]!,
    header: decodeJwtPart(parts[0]!),
    claims: decodeJwtPart(parts[1]!)
  }
}

function requireTrustedUrl(value: string, issuer: string, label: string): string {
  let url: URL
  let issuerUrl: URL
  try {
    url = new URL(value)
    issuerUrl = new URL(issuer)
  } catch {
    throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', `${label} is not a valid URL.`)
  }

  const loopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', `${label} must use HTTPS.`)
  }
  if (url.origin !== issuerUrl.origin) {
    throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', `${label} must use the OIDC issuer origin.`)
  }
  return url.toString()
}

function audienceIncludes(claim: unknown, expected: string): boolean {
  return claim === expected || (Array.isArray(claim) && claim.includes(expected))
}

function assertCommonClaims(
  claims: Record<string, unknown>,
  issuer: string,
  expectedAudience: string,
  now: number
): void {
  if (claims.iss !== issuer) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token issuer does not match SciForge.')
  }
  if (!audienceIncludes(claims.aud, expectedAudience)) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token audience does not include SciForge.')
  }
  if (!readString(claims.sub)) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token is missing its subject.')
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token has expired.')
  }
}

async function verifyJwtSignature(parts: JwtParts, jwks: JsonWebKeySet): Promise<void> {
  if (parts.header.alg !== 'RS256') {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'SciForge only accepts RS256 identity tokens.')
  }
  const kid = readString(parts.header.kid)
  const jwk = kid
    ? jwks.keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA')
    : undefined
  if (!jwk) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'No matching OIDC signing key was found.')
  }

  try {
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const valid = await webcrypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(parts.encodedSignature, 'base64url'),
      Buffer.from(`${parts.encodedHeader}.${parts.encodedClaims}`)
    )
    if (!valid) throw new Error('Signature mismatch.')
  } catch {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The OIDC token signature is invalid.')
  }
}

function statusFromClaims(
  accessClaims: Record<string, unknown>,
  idClaims: Record<string, unknown>,
  currentUser: CurrentUserResponse
): DesktopIdentityStatus {
  const subject = readString(accessClaims.sub)!
  const username = readString(idClaims.preferred_username) ?? readString(accessClaims.preferred_username)
  const email = readString(idClaims.email) ?? readString(accessClaims.email)
  const displayName =
    readString(idClaims.name) ??
    readString(accessClaims.name) ??
    username ??
    email ??
    subject
  const user: DesktopIdentityUser = {
    userId: currentUser.user.userId,
    externalIdentityId: currentUser.identity.externalIdentityId,
    issuer: readString(accessClaims.iss)!,
    subject,
    displayName,
    ...(username ? { username } : {}),
    ...(email ? { email } : {}),
    ...(typeof idClaims.email_verified === 'boolean'
      ? { emailVerified: idClaims.email_verified }
      : typeof accessClaims.email_verified === 'boolean'
        ? { emailVerified: accessClaims.email_verified }
        : {})
  }
  return {
    state: 'signed-in',
    user,
    accessTokenExpiresAt: new Date((accessClaims.exp as number) * 1000).toISOString()
  }
}

function verifiedClaimsFromAccessToken(
  accessClaims: Record<string, unknown>,
  idClaims: Record<string, unknown>
): VerifiedOidcClaims {
  const issuedAt = typeof accessClaims.iat === 'number'
    ? new Date(accessClaims.iat * 1000).toISOString()
    : new Date().toISOString()
  const audiences = Array.isArray(accessClaims.aud)
    ? accessClaims.aud.filter((audience): audience is string => typeof audience === 'string')
    : typeof accessClaims.aud === 'string'
      ? [accessClaims.aud]
      : []
  const email = readString(idClaims.email) ?? readString(accessClaims.email)
  const displayName = readString(idClaims.name) ?? readString(accessClaims.name)
  return {
    type: 'verified_oidc_claims',
    issuer: readString(accessClaims.iss)!,
    subject: readString(accessClaims.sub)!,
    audiences,
    issuedAt,
    expiresAt: new Date((accessClaims.exp as number) * 1000).toISOString(),
    ...(email ? { email } : {}),
    ...(typeof idClaims.email_verified === 'boolean'
      ? { emailVerified: idClaims.email_verified }
      : typeof accessClaims.email_verified === 'boolean'
        ? { emailVerified: accessClaims.email_verified }
        : {}),
    ...(displayName ? { displayName } : {})
  }
}

function callbackHtml(success: boolean): string {
  const title = success ? 'SciForge login completed' : 'SciForge login failed'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#f7f9fc;color:#172033}.panel{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.5rem}p{color:#536078}</style></head><body><main class="panel"><h1>${title}</h1><p>You can close this tab and return to SciForge.</p></main></body></html>`
}

async function startCallbackServer(
  redirectUri: string,
  expectedState: string
): Promise<{ code: Promise<string>; close: () => void }> {
  const redirect = new URL(redirectUri)
  const port = Number(redirect.port)
  let server!: Server
  let settled = false
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  void code.catch(() => undefined)

  let timeout: ReturnType<typeof setTimeout>
  const finish = (action: () => void): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    server.close()
    action()
  }

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', redirectUri)
    if (requestUrl.pathname !== redirect.pathname) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }

    const error = requestUrl.searchParams.get('error')
    const authorizationCode = requestUrl.searchParams.get('code')
    const state = requestUrl.searchParams.get('state')
    const success = !error && Boolean(authorizationCode) && state === expectedState
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
    }).end(callbackHtml(success))

    if (error === 'access_denied') {
      finish(() => rejectCode(new DesktopIdentityError('OIDC_LOGIN_CANCELLED', 'Login was cancelled.')))
      return
    }
    if (error) {
      finish(() => rejectCode(new DesktopIdentityError('OIDC_LOGIN_FAILED', `OIDC authorization failed: ${error}`)))
      return
    }
    if (!authorizationCode || state !== expectedState) {
      finish(() => rejectCode(new DesktopIdentityError('OIDC_CALLBACK_INVALID', 'The login callback was invalid.')))
      return
    }
    finish(() => resolveCode(authorizationCode))
  })

  timeout = setTimeout(() => {
    finish(() => rejectCode(new DesktopIdentityError('OIDC_LOGIN_TIMEOUT', 'Login timed out after 5 minutes.')))
  }, LOGIN_TIMEOUT_MS)

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    server.listen(port, redirect.hostname)
  })

  return {
    code,
    close: () => finish(() => rejectCode(new DesktopIdentityError('OIDC_LOGIN_CANCELLED', 'Login was cancelled.')))
  }
}

export class DesktopIdentityService {
  private readonly issuer: string
  private readonly redirectUri: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private status: DesktopIdentityStatus = { state: 'signed-out' }
  private accessToken: string | null = null
  private loginPromise: Promise<DesktopIdentityActionResult> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<DesktopIdentityStatusListener>()

  constructor(private readonly options: DesktopIdentityServiceOptions) {
    this.issuer = trimIssuer(options.issuer)
    this.redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    requireTrustedUrl(this.issuer, this.issuer, 'OIDC issuer')
    const redirect = new URL(this.redirectUri)
    if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') {
      throw new DesktopIdentityError(
        'OIDC_CONFIGURATION_ERROR',
        'Desktop OIDC callbacks must use the 127.0.0.1 loopback address.'
      )
    }
  }

  getStatus(): DesktopIdentityStatus {
    if (this.status.state === 'signed-in' && Date.parse(this.status.accessTokenExpiresAt) <= this.now()) {
      this.setSession({ state: 'signed-out' }, null)
    }
    return this.status
  }

  getAccessToken(): string | null {
    return this.getStatus().state === 'signed-in' ? this.accessToken : null
  }

  subscribe(listener: DesktopIdentityStatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  login(): Promise<DesktopIdentityActionResult> {
    if (this.loginPromise) return this.loginPromise
    this.loginPromise = this.performLogin().finally(() => {
      this.loginPromise = null
    })
    return this.loginPromise
  }

  logout(): DesktopIdentityActionResult {
    this.setSession({ state: 'signed-out' }, null)
    return { ok: true, status: this.status }
  }

  close(): void {
    this.clearExpiryTimer()
    this.listeners.clear()
    this.accessToken = null
    this.status = { state: 'signed-out' }
  }

  private async performLogin(): Promise<DesktopIdentityActionResult> {
    let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | null = null
    try {
      const discovery = await this.readDiscovery()
      const codeVerifier = base64Url(randomBytes(32))
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      const state = base64Url(randomBytes(24))
      const nonce = base64Url(randomBytes(24))
      callbackServer = await startCallbackServer(this.redirectUri, state)

      const authorizationUrl = new URL(discovery.authorizationEndpoint)
      authorizationUrl.search = new URLSearchParams({
        client_id: this.options.clientId,
        redirect_uri: this.redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce
      }).toString()
      await this.options.openExternal(authorizationUrl.toString())

      const tokens = await this.exchangeCode(discovery, await callbackServer.code, codeVerifier)
      const verified = await this.verifyTokens(discovery, tokens, nonce)
      const currentUser = await this.options.identityClient.getCurrentUser({
        accessToken: tokens.accessToken,
        verifiedClaims: verifiedClaimsFromAccessToken(verified.accessClaims, verified.idClaims)
      })
      this.setSession(
        statusFromClaims(verified.accessClaims, verified.idClaims, currentUser),
        tokens.accessToken,
        true
      )
      return { ok: true, status: this.status }
    } catch (error) {
      callbackServer?.close()
      const normalized = this.normalizeError(error)
      return {
        ok: false,
        error: { code: normalized.code, message: normalized.message },
        status: this.getStatus()
      }
    }
  }

  private async readDiscovery(): Promise<OidcDiscovery> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.issuer}/.well-known/openid-configuration`)
    } catch {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'Cannot reach the SciForge login service.')
    }
    if (!response.ok) {
      throw new DesktopIdentityError(
        'OIDC_PROVIDER_UNAVAILABLE',
        `SciForge login discovery failed with HTTP ${response.status}.`
      )
    }
    const payload = await response.json() as Record<string, unknown>
    if (payload.issuer !== this.issuer) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC discovery returned a different issuer.')
    }
    const authorizationEndpoint = readString(payload.authorization_endpoint)
    const tokenEndpoint = readString(payload.token_endpoint)
    const jwksUri = readString(payload.jwks_uri)
    if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC discovery is missing required endpoints.')
    }
    return {
      issuer: this.issuer,
      authorizationEndpoint: requireTrustedUrl(authorizationEndpoint, this.issuer, 'Authorization endpoint'),
      tokenEndpoint: requireTrustedUrl(tokenEndpoint, this.issuer, 'Token endpoint'),
      jwksUri: requireTrustedUrl(jwksUri, this.issuer, 'JWKS endpoint')
    }
  }

  private async exchangeCode(
    discovery: OidcDiscovery,
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const response = await this.fetchImpl(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.options.clientId,
        redirect_uri: this.redirectUri,
        code,
        code_verifier: codeVerifier
      })
    })
    const payload = await response.json() as Record<string, unknown>
    const accessToken = readString(payload.access_token)
    const idToken = readString(payload.id_token)
    if (!response.ok || !accessToken || !idToken) {
      throw new DesktopIdentityError('OIDC_LOGIN_FAILED', 'SciForge could not exchange the login authorization code.')
    }
    return { accessToken, idToken }
  }

  private async verifyTokens(
    discovery: OidcDiscovery,
    tokens: TokenResponse,
    nonce: string
  ): Promise<{ accessClaims: Record<string, unknown>; idClaims: Record<string, unknown> }> {
    const jwksResponse = await this.fetchImpl(discovery.jwksUri)
    if (!jwksResponse.ok) {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'SciForge could not load OIDC signing keys.')
    }
    const jwks = await jwksResponse.json() as JsonWebKeySet
    if (!Array.isArray(jwks.keys)) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The OIDC signing key response is invalid.')
    }
    const accessParts = parseJwt(tokens.accessToken)
    const idParts = parseJwt(tokens.idToken)
    await verifyJwtSignature(accessParts, jwks)
    await verifyJwtSignature(idParts, jwks)
    assertCommonClaims(accessParts.claims, this.issuer, this.options.audience, this.now())
    assertCommonClaims(idParts.claims, this.issuer, this.options.clientId, this.now())
    if (accessParts.claims.azp !== this.options.clientId) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token was issued to another client.')
    }
    if (idParts.claims.nonce !== nonce) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The OIDC login nonce does not match.')
    }
    return { accessClaims: accessParts.claims, idClaims: idParts.claims }
  }

  private normalizeError(error: unknown): DesktopIdentityError {
    if (error instanceof DesktopIdentityError) return error
    if (error instanceof CollaborationIdentityClientError) {
      if (error.code === 'authentication_required' || error.code === 'credential_revoked') {
        return new DesktopIdentityError('SCIFORGE_CLOUD_AUTH_FAILED', error.message)
      }
      return new DesktopIdentityError('SCIFORGE_CLOUD_UNAVAILABLE', error.message)
    }
    if (error instanceof TypeError && /identity|user|response|parse/iu.test(error.message)) {
      return new DesktopIdentityError('SCIFORGE_CLOUD_RESPONSE_INVALID', error.message)
    }
    if (error instanceof Error && /EADDRINUSE/.test(error.message)) {
      return new DesktopIdentityError(
        'OIDC_LOGIN_FAILED',
        'The Desktop login callback port is already in use. Close the other login attempt and retry.'
      )
    }
    return new DesktopIdentityError(
      'OIDC_LOGIN_FAILED',
      error instanceof Error ? error.message : 'Desktop login failed.'
    )
  }

  private setSession(
    status: DesktopIdentityStatus,
    accessToken: string | null,
    forcePublish = false
  ): void {
    const changed = forcePublish || !sameIdentityStatus(this.status, status)
    this.clearExpiryTimer()
    this.status = status
    this.accessToken = accessToken
    if (status.state === 'signed-in') this.scheduleExpiry(status.accessTokenExpiresAt)
    if (!changed) return
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch {
        // Identity observers cannot interrupt a completed authentication transition.
      }
    }
  }

  private scheduleExpiry(expiresAt: string): void {
    const remaining = Date.parse(expiresAt) - this.now()
    if (remaining <= 0) {
      this.setSession({ state: 'signed-out' }, null)
      return
    }
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null
      if (Date.parse(expiresAt) <= this.now()) {
        this.setSession({ state: 'signed-out' }, null)
      } else {
        this.scheduleExpiry(expiresAt)
      }
    }, Math.min(remaining, 2_147_483_647))
    this.expiryTimer.unref?.()
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer === null) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }
}

function sameIdentityStatus(
  left: DesktopIdentityStatus,
  right: DesktopIdentityStatus
): boolean {
  if (left.state !== right.state) return false
  if (left.state === 'signed-out' || right.state === 'signed-out') return true
  return left.user.issuer === right.user.issuer &&
    left.user.subject === right.user.subject &&
    left.user.userId === right.user.userId &&
    left.accessTokenExpiresAt === right.accessTokenExpiresAt
}
