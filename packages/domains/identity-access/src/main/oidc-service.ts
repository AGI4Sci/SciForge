import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  CloudIdentityClientError,
  type CloudIdentityClient
} from './cloud-identity-client.js'
import type { MeResponse } from '@sciforge/collaboration-contracts'
import type {
  DesktopIdentityActionResult,
  DesktopIdentityErrorCode,
  DesktopIdentityStatus,
  DesktopIdentityUser
} from '../contract.js'
import {
  DesktopIdentitySessionStoreError,
  type DesktopIdentitySessionStore,
  type StoredDesktopIdentitySession
} from './session-store.js'

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43110/oidc/callback'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const REFRESH_LEEWAY_MS = 60 * 1000
const REFRESH_RETRY_MS = 30 * 1000
const MAX_TIMER_MS = 2_147_483_647
const CLOCK_TOLERANCE_SECONDS = 60

export type DesktopIdentityServiceOptions = {
  issuer: string | null
  clientId: string
  audience: string
  identityClient: Pick<CloudIdentityClient, 'getCurrentUser'>
  sessionStore: DesktopIdentitySessionStore
  linkAuthenticatedUser?: (user: DesktopIdentityUser) => void | Promise<void>
  openExternal: (url: string) => Promise<unknown>
  configurationError?: string
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
  revocationEndpoint?: string
  endSessionEndpoint?: string
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
  idToken?: string
  refreshToken?: string
}

type VerifiedTokens = {
  accessClaims: Record<string, unknown>
  idClaims: Record<string, unknown>
}

type SessionCredentials = {
  refreshToken: string
  idToken?: string
}

type SessionOperation = Readonly<{
  generation: number
  promise: Promise<DesktopIdentityActionResult>
}>

type ActiveLoginCallback = Readonly<{
  generation: number
  close: () => void
}>

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

function numericDate(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
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
  const expiresAt = numericDate(claims.exp)
  if (expiresAt === null) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token exp claim is missing or invalid.')
  }
  if (expiresAt * 1000 <= now) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The token has expired.')
  }
}

function assertAccessTokenClaims(
  claims: Record<string, unknown>,
  issuer: string,
  audience: string,
  clientId: string,
  now: number
): void {
  assertCommonClaims(claims, issuer, audience, now)
  if (claims.azp !== clientId) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token was issued to another client.')
  }
  const issuedAt = numericDate(claims.iat)
  const notBefore = numericDate(claims.nbf)
  const authTime = numericDate(claims.auth_time)
  const expiresAt = numericDate(claims.exp)
  const nowSeconds = Math.floor(now / 1000)
  const latestAllowed = nowSeconds + CLOCK_TOLERANCE_SECONDS
  if (issuedAt === null) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token iat claim is missing or invalid.')
  }
  if (notBefore === null) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token nbf claim is missing or invalid.')
  }
  if (authTime === null) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token auth_time claim is missing or invalid.')
  }
  if (expiresAt === null) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token exp claim is missing or invalid.')
  }
  if (notBefore > latestAllowed) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token nbf claim is in the future.')
  }
  if (issuedAt > latestAllowed) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token iat claim is in the future.')
  }
  if (authTime > latestAllowed) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token auth_time claim is in the future.')
  }
  if (expiresAt <= notBefore) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token expires at or before its nbf claim.')
  }
  if (expiresAt <= issuedAt) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token expires at or before its iat claim.')
  }
  if (authTime > issuedAt) {
    throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The access token auth_time claim is after its iat claim.')
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
  currentUser: MeResponse
): DesktopIdentityStatus {
  const subject = readString(accessClaims.sub)!
  const username = readString(idClaims.preferred_username) ?? readString(accessClaims.preferred_username)
  const email = readString(idClaims.email) ?? readString(accessClaims.email)
  const displayName =
    readString(idClaims.name) ??
    readString(accessClaims.name) ??
    currentUser.displayName ??
    username ??
    email ??
    subject
  const user: DesktopIdentityUser = {
    userId: currentUser.userId,
    oidcIdentityId: currentUser.oidcIdentityId,
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
  private readonly issuer: string | null
  private readonly redirectUri: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private status: DesktopIdentityStatus = { state: 'signed-out' }
  private accessToken: string | null = null
  private credentials: SessionCredentials | null = null
  private loginOperation: SessionOperation | null = null
  private initializeOperation: SessionOperation | null = null
  private refreshOperation: SessionOperation | null = null
  private logoutOperation: SessionOperation | null = null
  private activeLoginCallback: ActiveLoginCallback | null = null
  private sessionGeneration = 1
  private sessionPersistence: Promise<void> = Promise.resolve()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly listeners = new Set<DesktopIdentityStatusListener>()

  constructor(private readonly options: DesktopIdentityServiceOptions) {
    this.issuer = options.issuer === null ? null : trimIssuer(options.issuer)
    this.redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    if (!this.issuer && !options.configurationError) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC issuer is required.')
    }
    if (this.issuer) requireTrustedUrl(this.issuer, this.issuer, 'OIDC issuer')
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
      if (this.credentials) void this.refreshSession()
    }
    return this.status
  }

  getAccessToken(): string | null {
    return this.getStatus().state === 'signed-in' ? this.accessToken : null
  }

  async useAccessToken<Result>(operation: (accessToken: string) => Promise<Result>): Promise<Result> {
    const accessToken = this.getAccessToken()
    if (!accessToken) {
      throw new DesktopIdentityError(
        'OIDC_SESSION_EXPIRED',
        'Sign in to SciForge Cloud before continuing.'
      )
    }
    return operation(accessToken)
  }

  subscribe(listener: DesktopIdentityStatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(): Promise<DesktopIdentityActionResult> {
    if (this.logoutOperation) {
      return this.logoutOperation.promise.then(() => this.initialize())
    }
    const generation = this.sessionGeneration
    if (!this.isSessionOperationCurrent(generation)) {
      return Promise.resolve(this.currentSessionResult())
    }
    if (this.initializeOperation?.generation === generation) {
      return this.initializeOperation.promise
    }
    const promise = this.restoreSession(generation).finally(() => {
      if (this.initializeOperation?.promise === promise) this.initializeOperation = null
    })
    this.initializeOperation = { generation, promise }
    return promise
  }

  login(): Promise<DesktopIdentityActionResult> {
    return this.beginInteractiveLogin(false)
  }

  reauthenticate(): Promise<DesktopIdentityActionResult> {
    return this.beginInteractiveLogin(true)
  }

  logout(): Promise<DesktopIdentityActionResult> {
    if (this.logoutOperation) return this.logoutOperation.promise
    const promise = this.performLogout().finally(() => {
      if (this.logoutOperation?.promise === promise) this.logoutOperation = null
    })
    this.logoutOperation = { generation: this.sessionGeneration, promise }
    return promise
  }

  private async performLogout(): Promise<DesktopIdentityActionResult> {
    const credentials = this.credentials
    const generation = this.invalidateSessionOperations()
    this.credentials = null
    this.setSession({ state: 'signed-out' }, null, true)

    let localFailure: DesktopIdentityError | null = null
    try {
      await this.enqueueSessionPersistence(() => this.options.sessionStore.clear())
    } catch (error) {
      localFailure = this.normalizeError(error)
    }
    if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()

    let remoteFailure: DesktopIdentityError | null = null
    if (credentials && this.issuer) {
      try {
        const discovery = await this.readDiscovery()
        if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
        if (discovery.revocationEndpoint) {
          const response = await this.fetchImpl(discovery.revocationEndpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: this.options.clientId,
              token: credentials.refreshToken,
              token_type_hint: 'refresh_token'
            })
          })
          if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
          if (!response.ok) {
            throw new DesktopIdentityError(
              'OIDC_LOGOUT_FAILED',
              `OIDC refresh-token revocation failed with HTTP ${response.status}.`
            )
          }
        }
        if (discovery.endSessionEndpoint) {
          if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
          const endSession = new URL(discovery.endSessionEndpoint)
          endSession.searchParams.set('client_id', this.options.clientId)
          if (credentials.idToken) endSession.searchParams.set('id_token_hint', credentials.idToken)
          await this.options.openExternal(endSession.toString())
          if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
        }
      } catch (error) {
        const normalized = this.normalizeError(error)
        remoteFailure = new DesktopIdentityError('OIDC_LOGOUT_FAILED', normalized.message)
      }
    }

    const failure = localFailure ?? remoteFailure
    return failure ? this.failure(failure) : { ok: true, status: this.status }
  }

  close(): void {
    this.invalidateSessionOperations()
    this.closed = true
    this.listeners.clear()
    this.accessToken = null
    this.credentials = null
    this.status = { state: 'signed-out' }
  }

  private beginInteractiveLogin(forceReauthentication: boolean): Promise<DesktopIdentityActionResult> {
    if (this.logoutOperation) {
      return this.logoutOperation.promise.then(() => this.beginInteractiveLogin(forceReauthentication))
    }
    const generation = this.sessionGeneration
    if (!this.isSessionOperationCurrent(generation)) {
      return Promise.resolve(this.currentSessionResult())
    }
    if (this.loginOperation?.generation === generation) return this.loginOperation.promise
    const promise = this.performLogin(forceReauthentication, generation).finally(() => {
      if (this.loginOperation?.promise === promise) this.loginOperation = null
    })
    this.loginOperation = { generation, promise }
    return promise
  }

  private async restoreSession(generation: number): Promise<DesktopIdentityActionResult> {
    try {
      this.assertConfigured()
      const stored = await this.options.sessionStore.load()
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      if (!stored) return { ok: true, status: this.status }
      if (stored.issuer !== this.issuer || stored.clientId !== this.options.clientId) {
        await this.enqueueSessionPersistence(() => this.options.sessionStore.clear())
        if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
        return { ok: true, status: this.status }
      }
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      this.credentials = {
        refreshToken: stored.refreshToken,
        ...(stored.idToken ? { idToken: stored.idToken } : {})
      }
      return await this.refreshSession(generation)
    } catch (error) {
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      return this.failure(this.normalizeError(error))
    }
  }

  private async performLogin(
    forceReauthentication: boolean,
    generation: number
  ): Promise<DesktopIdentityActionResult> {
    let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | null = null
    let activeCallback: ActiveLoginCallback | null = null
    const expectedUserId = forceReauthentication && this.status.state === 'signed-in'
      ? this.status.user.userId
      : null
    try {
      this.assertConfigured()
      if (!forceReauthentication && this.getStatus().state === 'signed-in') {
        return { ok: true, status: this.status }
      }
      const discovery = await this.readDiscovery()
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const codeVerifier = base64Url(randomBytes(32))
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      const state = base64Url(randomBytes(24))
      const nonce = base64Url(randomBytes(24))
      callbackServer = await startCallbackServer(this.redirectUri, state)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      activeCallback = { generation, close: callbackServer.close }
      this.activeLoginCallback = activeCallback

      const authorizationUrl = new URL(discovery.authorizationEndpoint)
      const authorizationParameters: Record<string, string> = {
        client_id: this.options.clientId,
        redirect_uri: this.redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce
      }
      if (forceReauthentication) {
        authorizationParameters.prompt = 'login'
        authorizationParameters.max_age = '0'
      }
      authorizationUrl.search = new URLSearchParams(authorizationParameters).toString()
      await this.options.openExternal(authorizationUrl.toString())
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()

      const code = await callbackServer.code
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const tokens = await this.exchangeCode(discovery, code, codeVerifier)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const verified = await this.verifyLoginTokens(discovery, tokens, nonce)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const currentUser = await this.readCurrentUser(tokens.accessToken)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      if (expectedUserId && currentUser.userId !== expectedUserId) {
        throw new DesktopIdentityError(
          'OIDC_REAUTH_USER_MISMATCH',
          'Reauthentication completed for a different SciForge user.'
        )
      }
      const activated = await this.activateSession(tokens, verified, currentUser, generation)
      if (!activated) return this.currentSessionResult()
      return { ok: true, status: this.status }
    } catch (error) {
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      return this.failure(this.normalizeError(error))
    } finally {
      callbackServer?.close()
      if (this.activeLoginCallback === activeCallback) this.activeLoginCallback = null
    }
  }

  private refreshSession(generation = this.sessionGeneration): Promise<DesktopIdentityActionResult> {
    if (!this.isSessionOperationCurrent(generation)) {
      return Promise.resolve(this.currentSessionResult())
    }
    if (this.refreshOperation?.generation === generation) return this.refreshOperation.promise
    const promise = this.performRefresh(generation).finally(() => {
      if (this.refreshOperation?.promise === promise) this.refreshOperation = null
    })
    this.refreshOperation = { generation, promise }
    return promise
  }

  private async performRefresh(generation: number): Promise<DesktopIdentityActionResult> {
    const credentials = this.credentials
    if (!credentials) {
      return this.failure(new DesktopIdentityError('OIDC_SESSION_EXPIRED', 'The saved login session has expired.'))
    }
    try {
      this.assertConfigured()
      const discovery = await this.readDiscovery()
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const tokens = await this.refreshTokens(discovery, credentials.refreshToken)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const verified = await this.verifyRefreshedTokens(discovery, tokens)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const currentUser = await this.readCurrentUser(tokens.accessToken)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const activated = await this.activateSession({
        ...tokens,
        refreshToken: tokens.refreshToken ?? credentials.refreshToken,
        idToken: tokens.idToken ?? credentials.idToken
      }, verified, currentUser, generation)
      if (!activated) return this.currentSessionResult()
      return { ok: true, status: this.status }
    } catch (error) {
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      const normalized = this.normalizeError(error)
      if (
        normalized.code === 'OIDC_PROVIDER_UNAVAILABLE' ||
        normalized.code === 'SCIFORGE_CLOUD_UNAVAILABLE'
      ) {
        this.scheduleRefreshRetry(generation)
        return this.failure(normalized)
      }
      this.credentials = null
      this.setSession({ state: 'signed-out' }, null)
      await this.enqueueSessionPersistence(() => this.options.sessionStore.clear()).catch(() => undefined)
      if (!this.isSessionOperationCurrent(generation)) return this.currentSessionResult()
      return this.failure(normalized)
    }
  }

  private async activateSession(
    tokens: TokenResponse,
    verified: VerifiedTokens,
    currentUser: MeResponse,
    generation: number
  ): Promise<boolean> {
    if (!this.isSessionOperationCurrent(generation)) return false
    if (!tokens.refreshToken) {
      throw new DesktopIdentityError(
        'OIDC_LOGIN_FAILED',
        'The identity provider did not issue a refresh token for the Desktop session.'
      )
    }
    const stored: StoredDesktopIdentitySession = {
      version: 1,
      issuer: this.requireIssuer(),
      clientId: this.options.clientId,
      refreshToken: tokens.refreshToken,
      ...(tokens.idToken ? { idToken: tokens.idToken } : {})
    }
    const status = statusFromClaims(verified.accessClaims, verified.idClaims, currentUser)
    if (status.state === 'signed-in') {
      if (!this.isSessionOperationCurrent(generation)) return false
      await this.options.linkAuthenticatedUser?.(status.user)
      if (!this.isSessionOperationCurrent(generation)) return false
    }
    if (!this.isSessionOperationCurrent(generation)) return false
    await this.enqueueSessionPersistence(() => this.options.sessionStore.save(stored))
    if (!this.isSessionOperationCurrent(generation)) return false
    this.credentials = {
      refreshToken: stored.refreshToken,
      ...(stored.idToken ? { idToken: stored.idToken } : {})
    }
    this.setSession(status, tokens.accessToken, true)
    return true
  }

  private async readCurrentUser(accessToken: string): Promise<MeResponse> {
    return this.options.identityClient.getCurrentUser({ accessToken })
  }

  private async readDiscovery(): Promise<OidcDiscovery> {
    const issuer = this.requireIssuer()
    let response: Response
    try {
      response = await this.fetchImpl(`${issuer}/.well-known/openid-configuration`)
    } catch {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'Cannot reach the SciForge login service.')
    }
    if (!response.ok) {
      throw new DesktopIdentityError(
        'OIDC_PROVIDER_UNAVAILABLE',
        `SciForge login discovery failed with HTTP ${response.status}.`
      )
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!payload || payload.issuer !== issuer) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC discovery returned a different issuer.')
    }
    const authorizationEndpoint = readString(payload.authorization_endpoint)
    const tokenEndpoint = readString(payload.token_endpoint)
    const jwksUri = readString(payload.jwks_uri)
    if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC discovery is missing required endpoints.')
    }
    const revocationEndpoint = readString(payload.revocation_endpoint)
    const endSessionEndpoint = readString(payload.end_session_endpoint)
    return {
      issuer,
      authorizationEndpoint: requireTrustedUrl(authorizationEndpoint, issuer, 'Authorization endpoint'),
      tokenEndpoint: requireTrustedUrl(tokenEndpoint, issuer, 'Token endpoint'),
      jwksUri: requireTrustedUrl(jwksUri, issuer, 'JWKS endpoint'),
      ...(revocationEndpoint
        ? { revocationEndpoint: requireTrustedUrl(revocationEndpoint, issuer, 'Revocation endpoint') }
        : {}),
      ...(endSessionEndpoint
        ? { endSessionEndpoint: requireTrustedUrl(endSessionEndpoint, issuer, 'End-session endpoint') }
        : {})
    }
  }

  private async exchangeCode(
    discovery: OidcDiscovery,
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    return this.requestTokens(discovery.tokenEndpoint, new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.options.clientId,
      redirect_uri: this.redirectUri,
      code,
      code_verifier: codeVerifier
    }), true)
  }

  private async refreshTokens(discovery: OidcDiscovery, refreshToken: string): Promise<TokenResponse> {
    return this.requestTokens(discovery.tokenEndpoint, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.options.clientId,
      refresh_token: refreshToken
    }), false)
  }

  private async requestTokens(
    tokenEndpoint: string,
    body: URLSearchParams,
    interactive: boolean
  ): Promise<TokenResponse> {
    let response: Response
    try {
      response = await this.fetchImpl(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
      })
    } catch {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'Cannot reach the SciForge login service.')
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null
    const accessToken = readString(payload?.access_token)
    const idToken = readString(payload?.id_token)
    const refreshToken = readString(payload?.refresh_token)
    if (!response.ok || !accessToken || (interactive && (!idToken || !refreshToken))) {
      if (!interactive && (response.status === 400 || response.status === 401)) {
        throw new DesktopIdentityError('OIDC_SESSION_EXPIRED', 'The saved login session has expired.')
      }
      if (response.status >= 500) {
        throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'The SciForge login service is unavailable.')
      }
      throw new DesktopIdentityError(
        'OIDC_LOGIN_FAILED',
        interactive
          ? 'SciForge could not exchange the login authorization code.'
          : 'SciForge could not refresh the Desktop login session.'
      )
    }
    return {
      accessToken,
      ...(idToken ? { idToken } : {}),
      ...(refreshToken ? { refreshToken } : {})
    }
  }

  private async verifyLoginTokens(
    discovery: OidcDiscovery,
    tokens: TokenResponse,
    nonce: string
  ): Promise<VerifiedTokens> {
    if (!tokens.idToken) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The login response is missing an ID token.')
    }
    const jwks = await this.readJwks(discovery)
    const accessParts = parseJwt(tokens.accessToken)
    const idParts = parseJwt(tokens.idToken)
    await verifyJwtSignature(accessParts, jwks)
    await verifyJwtSignature(idParts, jwks)
    assertAccessTokenClaims(
      accessParts.claims,
      this.requireIssuer(),
      this.options.audience,
      this.options.clientId,
      this.now()
    )
    assertCommonClaims(idParts.claims, this.requireIssuer(), this.options.clientId, this.now())
    if (idParts.claims.nonce !== nonce || idParts.claims.sub !== accessParts.claims.sub) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The OIDC login nonce or subject does not match.')
    }
    return { accessClaims: accessParts.claims, idClaims: idParts.claims }
  }

  private async verifyRefreshedTokens(
    discovery: OidcDiscovery,
    tokens: TokenResponse
  ): Promise<VerifiedTokens> {
    const jwks = await this.readJwks(discovery)
    const accessParts = parseJwt(tokens.accessToken)
    await verifyJwtSignature(accessParts, jwks)
    assertAccessTokenClaims(
      accessParts.claims,
      this.requireIssuer(),
      this.options.audience,
      this.options.clientId,
      this.now()
    )
    if (!tokens.idToken) return { accessClaims: accessParts.claims, idClaims: {} }

    const idParts = parseJwt(tokens.idToken)
    await verifyJwtSignature(idParts, jwks)
    assertCommonClaims(idParts.claims, this.requireIssuer(), this.options.clientId, this.now())
    if (idParts.claims.sub !== accessParts.claims.sub) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The refreshed token subjects do not match.')
    }
    return { accessClaims: accessParts.claims, idClaims: idParts.claims }
  }

  private async readJwks(discovery: OidcDiscovery): Promise<JsonWebKeySet> {
    let response: Response
    try {
      response = await this.fetchImpl(discovery.jwksUri)
    } catch {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'SciForge could not load OIDC signing keys.')
    }
    if (!response.ok) {
      throw new DesktopIdentityError('OIDC_PROVIDER_UNAVAILABLE', 'SciForge could not load OIDC signing keys.')
    }
    const jwks = await response.json().catch(() => null) as JsonWebKeySet | null
    if (!jwks || !Array.isArray(jwks.keys)) {
      throw new DesktopIdentityError('OIDC_TOKEN_INVALID', 'The OIDC signing key response is invalid.')
    }
    return jwks
  }

  private assertConfigured(): void {
    if (this.options.configurationError) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', this.options.configurationError)
    }
    this.requireIssuer()
  }

  private requireIssuer(): string {
    if (!this.issuer) {
      throw new DesktopIdentityError('OIDC_CONFIGURATION_ERROR', 'OIDC issuer is not configured.')
    }
    return this.issuer
  }

  private normalizeError(error: unknown): DesktopIdentityError {
    if (error instanceof DesktopIdentityError) return error
    if (error instanceof DesktopIdentitySessionStoreError) {
      return new DesktopIdentityError('OIDC_SESSION_STORAGE_UNAVAILABLE', error.message)
    }
    if (error instanceof CloudIdentityClientError) {
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

  private failure(error: DesktopIdentityError): DesktopIdentityActionResult {
    return {
      ok: false,
      error: { code: error.code, message: error.message },
      status: this.getStatus()
    }
  }

  private setSession(
    status: DesktopIdentityStatus,
    accessToken: string | null,
    forcePublish = false
  ): void {
    if (this.closed) return
    const changed = forcePublish || !sameIdentityStatus(this.status, status)
    this.clearRefreshTimer()
    this.status = status
    this.accessToken = accessToken
    if (status.state === 'signed-in') this.scheduleRefresh(status.accessTokenExpiresAt)
    if (!changed) return
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch {
        // Identity observers cannot interrupt a completed authentication transition.
      }
    }
  }

  private scheduleRefresh(expiresAt: string): void {
    if (this.closed) return
    const generation = this.sessionGeneration
    const remaining = Date.parse(expiresAt) - this.now()
    const delay = Math.max(0, remaining - REFRESH_LEEWAY_MS)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (this.isSessionOperationCurrent(generation)) void this.refreshSession(generation)
    }, Math.min(delay, MAX_TIMER_MS))
    this.refreshTimer.unref?.()
  }

  private scheduleRefreshRetry(generation: number): void {
    if (!this.credentials || !this.isSessionOperationCurrent(generation)) return
    this.clearRefreshTimer()
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (this.isSessionOperationCurrent(generation)) void this.refreshSession(generation)
    }, REFRESH_RETRY_MS)
    this.refreshTimer.unref?.()
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer === null) return
    clearTimeout(this.refreshTimer)
    this.refreshTimer = null
  }

  private isSessionOperationCurrent(generation: number): boolean {
    return !this.closed && generation === this.sessionGeneration
  }

  private currentSessionResult(): DesktopIdentityActionResult {
    return { ok: true, status: this.status }
  }

  private enqueueSessionPersistence(operation: () => Promise<void>): Promise<void> {
    const result = this.sessionPersistence.then(operation)
    this.sessionPersistence = result.catch(() => undefined)
    return result
  }

  private invalidateSessionOperations(): number {
    this.sessionGeneration += 1
    this.clearRefreshTimer()
    const activeCallback = this.activeLoginCallback
    this.activeLoginCallback = null
    activeCallback?.close()
    this.loginOperation = null
    this.initializeOperation = null
    this.refreshOperation = null
    return this.sessionGeneration
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
