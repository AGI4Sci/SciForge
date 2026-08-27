import {
  constants as cryptoConstants,
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject
} from 'node:crypto'

const DEFAULT_AUDIENCE = 'sciforge-cloud-api'
const DEFAULT_ALLOWED_AUTHORIZED_PARTIES = ['sciforge-desktop', 'sciforge-web-mobile'] as const
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024
const DEFAULT_CACHE_TTL_MS = 60_000
const DEFAULT_MAX_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_UNKNOWN_KID_REFRESH_COOLDOWN_MS = 5_000
const MAX_URL_LENGTH = 2_048
const MAX_TOKEN_LENGTH = 16 * 1024
const MAX_HEADER_SEGMENT_LENGTH = 2 * 1024
const MAX_PAYLOAD_SEGMENT_LENGTH = 12 * 1024
const MAX_SIGNATURE_SEGMENT_LENGTH = 2 * 1024
const MAX_JWKS_KEYS = 32

export type OidcVerificationErrorCode =
  | 'oidc_configuration_invalid'
  | 'oidc_token_malformed'
  | 'oidc_algorithm_rejected'
  | 'oidc_discovery_unavailable'
  | 'oidc_discovery_invalid'
  | 'oidc_jwks_unavailable'
  | 'oidc_jwks_invalid'
  | 'oidc_key_not_found'
  | 'oidc_signature_invalid'
  | 'oidc_claim_invalid'
  | 'oidc_token_expired'
  | 'oidc_token_not_active'

export class OidcVerificationError extends Error {
  readonly retryable: boolean

  constructor(readonly code: OidcVerificationErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'OidcVerificationError'
    this.retryable = options.retryable ?? false
  }
}

export type VerifiedOidcIdentity = Readonly<{
  issuer: string
  subject: string
  audience: readonly string[]
  authorizedParty: string
  issuedAt: number
  notBefore: number
  expiresAt: number
  authTime: number
  email?: string
  emailVerified?: boolean
  preferredUsername?: string
  displayName?: string
}>

export type VerifiedOidcIdToken = Readonly<{
  issuer: string
  subject: string
  audience: readonly string[]
  issuedAt: number
  notBefore: number
  expiresAt: number
  authTime: number
  nonce: string
}>

export type OidcAccessTokenVerifierOptions = Readonly<{
  issuer: string
  audience?: string
  allowedAuthorizedParties?: readonly string[]
  allowInsecureLoopback?: boolean
  fetch?: typeof globalThis.fetch
  now?: () => Date
  requestTimeoutMs?: number
  maxResponseBytes?: number
  defaultCacheTtlMs?: number
  maxCacheTtlMs?: number
  unknownKidRefreshCooldownMs?: number
  clockToleranceSeconds?: number
}>

type JsonRecord = Record<string, unknown>

type DiscoveryDocument = Readonly<{
  jwksUri: string
}>

type CacheEntry<T> = Readonly<{
  value: T
  expiresAt: number
}>

type JwksSnapshot = Readonly<{
  keys: ReadonlyMap<string, KeyObject>
  generation: number
}>

type FetchStage = 'discovery' | 'jwks'

type ParsedJwt = Readonly<{
  signingInput: Buffer
  signature: Buffer
  kid: string
  typ?: string
  claims: JsonRecord
}>

export class OidcAccessTokenVerifier {
  readonly issuer: string
  readonly audience: string
  readonly allowedAuthorizedParties: readonly string[]

  private readonly issuerUrl: URL
  private readonly discoveryUrl: URL
  private readonly allowInsecureLoopback: boolean
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly now: () => Date
  private readonly requestTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly defaultCacheTtlMs: number
  private readonly maxCacheTtlMs: number
  private readonly unknownKidRefreshCooldownMs: number
  private readonly clockToleranceSeconds: number
  private discoveryCache?: CacheEntry<DiscoveryDocument>
  private discoveryInFlight?: Promise<CacheEntry<DiscoveryDocument>>
  private jwksCache?: CacheEntry<JwksSnapshot>
  private jwksInFlight?: Promise<CacheEntry<JwksSnapshot>>
  private jwksGeneration = 0
  private unknownKidRefreshAllowedAt = 0

  constructor(options: OidcAccessTokenVerifierOptions) {
    this.allowInsecureLoopback = options.allowInsecureLoopback === true
    this.issuerUrl = validateIssuerUrl(options.issuer, this.allowInsecureLoopback)
    this.issuer = options.issuer
    this.discoveryUrl = discoveryUrlFor(this.issuer)
    this.audience = boundedIdentifier(options.audience ?? DEFAULT_AUDIENCE, 'OIDC audience')
    this.allowedAuthorizedParties = Object.freeze(validateAuthorizedParties(
      options.allowedAuthorizedParties ?? DEFAULT_ALLOWED_AUTHORIZED_PARTIES
    ))
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    if (typeof this.fetchImplementation !== 'function') {
      throw configurationError()
    }
    this.now = options.now ?? (() => new Date())
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      10,
      10_000
    )
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      1024 * 1024
    )
    this.maxCacheTtlMs = boundedInteger(
      options.maxCacheTtlMs,
      DEFAULT_MAX_CACHE_TTL_MS,
      1_000,
      60 * 60_000
    )
    this.defaultCacheTtlMs = boundedInteger(
      options.defaultCacheTtlMs,
      Math.min(DEFAULT_CACHE_TTL_MS, this.maxCacheTtlMs),
      0,
      this.maxCacheTtlMs
    )
    this.unknownKidRefreshCooldownMs = boundedInteger(
      options.unknownKidRefreshCooldownMs,
      DEFAULT_UNKNOWN_KID_REFRESH_COOLDOWN_MS,
      100,
      60_000
    )
    this.clockToleranceSeconds = boundedInteger(options.clockToleranceSeconds, 0, 0, 60)
  }

  async verify(token: string): Promise<VerifiedOidcIdentity> {
    return this.verifyAccessToken(token)
  }

  async verifyAccessToken(token: string): Promise<VerifiedOidcIdentity> {
    const parsed = await this.verifySignature(token)
    return validateClaims(parsed.claims, {
      issuer: this.issuer,
      audience: this.audience,
      allowedAuthorizedParties: this.allowedAuthorizedParties,
      nowSeconds: Math.floor(this.nowMilliseconds() / 1_000),
      clockToleranceSeconds: this.clockToleranceSeconds
    })
  }

  async verifyIdToken(
    token: string,
    options: Readonly<{ clientId: string; nonce: string }>
  ): Promise<VerifiedOidcIdToken> {
    const clientId = boundedIdentifier(options.clientId, 'OIDC client ID')
    const expectedNonce = boundedNonce(options.nonce)
    const parsed = await this.verifySignature(token)
    if (parsed.typ === 'at+jwt') throw claimError()
    return validateIdTokenClaims(parsed.claims, {
      issuer: this.issuer,
      clientId,
      expectedNonce,
      nowSeconds: Math.floor(this.nowMilliseconds() / 1_000),
      clockToleranceSeconds: this.clockToleranceSeconds
    })
  }

  private async verifySignature(token: string): Promise<ParsedJwt> {
    const parsed = parseJwt(token)
    const key = await this.verificationKey(parsed.kid)
    let signatureValid = false
    try {
      signatureValid = verifySignature('RSA-SHA256', parsed.signingInput, {
        key,
        padding: cryptoConstants.RSA_PKCS1_PADDING
      }, parsed.signature)
    } catch {
      throw new OidcVerificationError('oidc_signature_invalid', 'The OIDC access token signature is invalid.')
    }
    if (!signatureValid) {
      throw new OidcVerificationError('oidc_signature_invalid', 'The OIDC access token signature is invalid.')
    }
    return parsed
  }

  private async verificationKey(kid: string): Promise<KeyObject> {
    const now = this.nowMilliseconds()
    const hadFreshCache = Boolean(this.jwksCache && this.jwksCache.expiresAt > now)
    const initial = await this.getJwks()
    const initialKey = initial.value.keys.get(kid)
    if (initialKey) return initialKey

    if (!hadFreshCache) {
      throw new OidcVerificationError('oidc_key_not_found', 'The OIDC signing key is not available.')
    }
    const refreshed = await this.getJwks({ forceAfterGeneration: initial.value.generation })
    const refreshedKey = refreshed.value.keys.get(kid)
    if (!refreshedKey) {
      throw new OidcVerificationError('oidc_key_not_found', 'The OIDC signing key is not available.')
    }
    return refreshedKey
  }

  private async getDiscovery(): Promise<CacheEntry<DiscoveryDocument>> {
    const now = this.nowMilliseconds()
    if (this.discoveryCache && this.discoveryCache.expiresAt > now) return this.discoveryCache
    if (this.discoveryInFlight) return this.discoveryInFlight

    const loading = (async () => {
      const fetched = await this.fetchJson(this.discoveryUrl, 'discovery')
      const value = this.validateDiscovery(fetched.value)
      const entry = Object.freeze({ value, expiresAt: this.nowMilliseconds() + fetched.cacheTtlMs })
      this.discoveryCache = entry
      return entry
    })()
    this.discoveryInFlight = loading
    try {
      return await loading
    } finally {
      if (this.discoveryInFlight === loading) this.discoveryInFlight = undefined
    }
  }

  private async getJwks(options: { forceAfterGeneration?: number } = {}): Promise<CacheEntry<JwksSnapshot>> {
    const now = this.nowMilliseconds()
    if (options.forceAfterGeneration !== undefined && this.jwksCache &&
        this.jwksCache.value.generation !== options.forceAfterGeneration) {
      return this.jwksCache
    }
    if (options.forceAfterGeneration === undefined && this.jwksCache && this.jwksCache.expiresAt > now) {
      return this.jwksCache
    }
    // A real rotation refresh already in progress remains shareable. Only a
    // new forced refresh is delayed, so random sequential kids cannot turn
    // signature verification into an unbounded JWKS request stream.
    if (this.jwksInFlight) return this.jwksInFlight
    if (options.forceAfterGeneration !== undefined && this.jwksCache && now < this.unknownKidRefreshAllowedAt) {
      return this.jwksCache
    }
    if (options.forceAfterGeneration !== undefined) {
      this.unknownKidRefreshAllowedAt = now + this.unknownKidRefreshCooldownMs
    }

    const loading = (async () => {
      const discovery = await this.getDiscovery()
      const fetched = await this.fetchJson(new URL(discovery.value.jwksUri), 'jwks')
      this.jwksGeneration += 1
      const value = Object.freeze({
        keys: parseJwks(fetched.value),
        generation: this.jwksGeneration
      })
      const entry = Object.freeze({ value, expiresAt: this.nowMilliseconds() + fetched.cacheTtlMs })
      this.jwksCache = entry
      return entry
    })()
    this.jwksInFlight = loading
    try {
      return await loading
    } finally {
      if (this.jwksInFlight === loading) this.jwksInFlight = undefined
    }
  }

  private validateDiscovery(value: unknown): DiscoveryDocument {
    if (!isJsonRecord(value) || value.issuer !== this.issuer || typeof value.jwks_uri !== 'string') {
      throw new OidcVerificationError('oidc_discovery_invalid', 'The OIDC discovery document is invalid.')
    }
    const algorithms = value.id_token_signing_alg_values_supported
    if (!Array.isArray(algorithms) || algorithms.length === 0 || algorithms.length > 16 ||
        !algorithms.every((algorithm) => typeof algorithm === 'string') || !algorithms.includes('RS256')) {
      throw new OidcVerificationError('oidc_discovery_invalid', 'The OIDC discovery document is invalid.')
    }
    const jwksUrl = validateProviderUrl(value.jwks_uri, this.issuerUrl, this.allowInsecureLoopback)
    return Object.freeze({ jwksUri: jwksUrl.toString() })
  }

  private async fetchJson(url: URL, stage: FetchStage): Promise<{ value: unknown; cacheTtlMs: number }> {
    const unavailable = () => new OidcVerificationError(
      stage === 'discovery' ? 'oidc_discovery_unavailable' : 'oidc_jwks_unavailable',
      stage === 'discovery'
        ? 'The OIDC discovery service is unavailable.'
        : 'The OIDC signing-key service is unavailable.',
      { retryable: true }
    )
    const invalid = () => new OidcVerificationError(
      stage === 'discovery' ? 'oidc_discovery_invalid' : 'oidc_jwks_invalid',
      stage === 'discovery'
        ? 'The OIDC discovery document is invalid.'
        : 'The OIDC signing-key document is invalid.'
    )
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(unavailable())
      }, this.requestTimeoutMs)
    })

    let response: Response
    try {
      response = await Promise.race([
        Promise.resolve(this.fetchImplementation(url.toString(), {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal
        })),
        timeout
      ])
    } catch (error) {
      if (timer) clearTimeout(timer)
      if (error instanceof OidcVerificationError) throw error
      throw unavailable()
    }
    try {
      if (response.status !== 200) throw unavailable()

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.startsWith('application/json') &&
          !contentType.startsWith('application/jwk-set+json') &&
          !contentType.startsWith('application/openid-configuration+json')) {
        throw invalid()
      }
      const contentLength = response.headers.get('content-length')
      if (contentLength !== null && (!/^\d{1,10}$/u.test(contentLength) || Number(contentLength) > this.maxResponseBytes)) {
        throw invalid()
      }

      let text: string
      try {
        text = await Promise.race([readBoundedUtf8(response, this.maxResponseBytes), timeout])
      } catch (error) {
        if (error instanceof OidcVerificationError) throw error
        throw invalid()
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw invalid()
      }
      return {
        value,
        cacheTtlMs: cacheTtl(response.headers.get('cache-control'), this.defaultCacheTtlMs, this.maxCacheTtlMs)
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private nowMilliseconds(): number {
    const value = this.now().getTime()
    if (!Number.isFinite(value)) throw configurationError()
    return value
  }
}

export function createOidcAccessTokenVerifier(options: OidcAccessTokenVerifierOptions): OidcAccessTokenVerifier {
  return new OidcAccessTokenVerifier(options)
}

function parseJwt(token: string): ParsedJwt {
  if (typeof token !== 'string' || token.length < 16 || token.length > MAX_TOKEN_LENGTH || /\s/u.test(token)) {
    throw malformedTokenError()
  }
  const segments = token.split('.')
  if (segments.length !== 3) throw malformedTokenError()
  const [encodedHeader, encodedPayload, encodedSignature] = segments
  if (!encodedHeader || !encodedPayload || !encodedSignature ||
      encodedHeader.length > MAX_HEADER_SEGMENT_LENGTH ||
      encodedPayload.length > MAX_PAYLOAD_SEGMENT_LENGTH ||
      encodedSignature.length > MAX_SIGNATURE_SEGMENT_LENGTH) {
    throw malformedTokenError()
  }
  const header = decodeJsonSegment(encodedHeader, MAX_HEADER_SEGMENT_LENGTH)
  const claims = decodeJsonSegment(encodedPayload, MAX_PAYLOAD_SEGMENT_LENGTH)
  const allowedHeaderFields = new Set(['alg', 'kid', 'typ'])
  if (Object.keys(header).some((field) => !allowedHeaderFields.has(field))) throw malformedTokenError()
  if (header.alg !== 'RS256') {
    throw new OidcVerificationError('oidc_algorithm_rejected', 'The OIDC access token algorithm is not allowed.')
  }
  if (header.typ !== undefined && header.typ !== 'JWT' && header.typ !== 'at+jwt') throw malformedTokenError()
  if (typeof header.kid !== 'string' || !/^[A-Za-z0-9._~-]{1,128}$/u.test(header.kid)) throw malformedTokenError()

  const signature = decodeBase64Url(encodedSignature)
  if (signature.length < 128 || signature.length > 1024) throw malformedTokenError()
  return Object.freeze({
    signingInput: Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
    signature,
    kid: header.kid,
    ...(typeof header.typ === 'string' ? { typ: header.typ } : {}),
    claims
  })
}

function decodeJsonSegment(value: string, maximumLength: number): JsonRecord {
  if (value.length > maximumLength) throw malformedTokenError()
  const decoded = decodeBase64Url(value)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  } catch {
    throw malformedTokenError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw malformedTokenError()
  }
  if (!isJsonRecord(parsed)) throw malformedTokenError()
  return parsed
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw malformedTokenError()
  let decoded: Buffer
  try {
    decoded = Buffer.from(value, 'base64url')
  } catch {
    throw malformedTokenError()
  }
  if (decoded.length === 0 || decoded.toString('base64url') !== value) throw malformedTokenError()
  return decoded
}

function validateClaims(
  claims: JsonRecord,
  options: {
    issuer: string
    audience: string
    allowedAuthorizedParties: readonly string[]
    nowSeconds: number
    clockToleranceSeconds: number
  }
): VerifiedOidcIdentity {
  if (claims.iss !== options.issuer) throw claimError()
  const subject = boundedClaimString(claims.sub, 512)
  const audience = validateAudience(claims.aud)
  if (!audience.includes(options.audience)) throw claimError()
  const authorizedParty = boundedClaimString(claims.azp, 128)
  if (!options.allowedAuthorizedParties.includes(authorizedParty)) throw claimError()

  const expiresAt = numericDate(claims.exp)
  const issuedAt = numericDate(claims.iat)
  const notBefore = claims.nbf === undefined ? issuedAt : numericDate(claims.nbf)
  const authTime = numericDate(claims.auth_time)
  const latestAllowed = options.nowSeconds + options.clockToleranceSeconds
  if (expiresAt <= options.nowSeconds - options.clockToleranceSeconds) {
    throw new OidcVerificationError('oidc_token_expired', 'The OIDC access token has expired.')
  }
  if (notBefore > latestAllowed) {
    throw new OidcVerificationError('oidc_token_not_active', 'The OIDC access token is not active.')
  }
  if (issuedAt > latestAllowed || authTime > latestAllowed || expiresAt <= notBefore ||
      expiresAt <= issuedAt || authTime > issuedAt) {
    throw claimError()
  }

  const optional = selectedProfileClaims(claims)
  return Object.freeze({
    issuer: options.issuer,
    subject,
    audience: Object.freeze(audience),
    authorizedParty,
    issuedAt,
    notBefore,
    expiresAt,
    authTime,
    ...optional
  })
}

function validateIdTokenClaims(
  claims: JsonRecord,
  options: {
    issuer: string
    clientId: string
    expectedNonce: string
    nowSeconds: number
    clockToleranceSeconds: number
  }
): VerifiedOidcIdToken {
  if (claims.iss !== options.issuer) throw claimError()
  const subject = boundedClaimString(claims.sub, 512)
  const audience = validateAudience(claims.aud)
  if (!audience.includes(options.clientId)) throw claimError()
  if (claims.azp !== undefined && boundedClaimString(claims.azp, 128) !== options.clientId) throw claimError()
  if (audience.length > 1 && claims.azp === undefined) throw claimError()
  const nonce = boundedNonce(claims.nonce)
  if (nonce !== options.expectedNonce) throw claimError()

  const expiresAt = numericDate(claims.exp)
  const issuedAt = numericDate(claims.iat)
  const notBefore = claims.nbf === undefined ? issuedAt : numericDate(claims.nbf)
  const authTime = numericDate(claims.auth_time)
  const latestAllowed = options.nowSeconds + options.clockToleranceSeconds
  if (expiresAt <= options.nowSeconds - options.clockToleranceSeconds) {
    throw new OidcVerificationError('oidc_token_expired', 'The OIDC token has expired.')
  }
  if (notBefore > latestAllowed) {
    throw new OidcVerificationError('oidc_token_not_active', 'The OIDC token is not active.')
  }
  if (issuedAt > latestAllowed || authTime > latestAllowed || expiresAt <= notBefore ||
      expiresAt <= issuedAt || authTime > issuedAt) {
    throw claimError()
  }
  return Object.freeze({
    issuer: options.issuer,
    subject,
    audience: Object.freeze(audience),
    issuedAt,
    notBefore,
    expiresAt,
    authTime,
    nonce
  })
}

function validateAudience(value: unknown): string[] {
  if (typeof value === 'string') return [boundedClaimString(value, 256)]
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw claimError()
  const audiences = value.map((audience) => boundedClaimString(audience, 256))
  if (new Set(audiences).size !== audiences.length) throw claimError()
  return audiences
}

function selectedProfileClaims(claims: JsonRecord): Partial<VerifiedOidcIdentity> {
  const result: {
    email?: string
    emailVerified?: boolean
    preferredUsername?: string
    displayName?: string
  } = {}
  if (claims.email !== undefined) result.email = boundedClaimString(claims.email, 320)
  if (claims.email_verified !== undefined) {
    if (typeof claims.email_verified !== 'boolean') throw claimError()
    result.emailVerified = claims.email_verified
  }
  if (claims.preferred_username !== undefined) {
    result.preferredUsername = boundedClaimString(claims.preferred_username, 200)
  }
  if (claims.name !== undefined) result.displayName = boundedClaimString(claims.name, 200)
  return result
}

function numericDate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw claimError()
  return value
}

function boundedClaimString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) throw claimError()
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) throw claimError()
  }
  return value
}

function boundedNonce(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/u.test(value)) throw claimError()
  return value
}

function parseJwks(value: unknown): ReadonlyMap<string, KeyObject> {
  if (!isJsonRecord(value) || !Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
    throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
  }
  const keys = new Map<string, KeyObject>()
  const seenKids = new Set<string>()
  for (const candidate of value.keys) {
    if (!isJsonRecord(candidate) || typeof candidate.kid !== 'string' ||
        !/^[A-Za-z0-9._~-]{1,128}$/u.test(candidate.kid) || seenKids.has(candidate.kid)) {
      throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
    }
    seenKids.add(candidate.kid)
    if (candidate.kty !== 'RSA' || candidate.alg !== 'RS256' || candidate.use !== 'sig') continue
    if (hasPrivateRsaMaterial(candidate) || typeof candidate.n !== 'string' || typeof candidate.e !== 'string') {
      throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
    }
    const modulus = decodeJwkValue(candidate.n)
    const exponent = decodeJwkValue(candidate.e)
    if (modulus.length < 256 || modulus.length > 1024 || exponent.length < 1 || exponent.length > 8) {
      throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
    }
    let key: KeyObject
    try {
      const publicJwk: JsonWebKey = { kty: 'RSA', n: candidate.n, e: candidate.e }
      key = createPublicKey({ key: publicJwk, format: 'jwk' })
    } catch {
      throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
    }
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048) {
      throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
    }
    keys.set(candidate.kid, key)
  }
  if (keys.size === 0) {
    throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
  }
  return keys
}

function hasPrivateRsaMaterial(value: JsonRecord): boolean {
  return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => Object.hasOwn(value, field))
}

function decodeJwkValue(value: string): Buffer {
  if (value.length === 0 || value.length > 2_048 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
  }
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    throw new OidcVerificationError('oidc_jwks_invalid', 'The OIDC signing-key document is invalid.')
  }
  return decoded
}

async function readBoundedUtf8(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) throw new Error('missing body')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      length += chunk.byteLength
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('body too large')
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length))
}

function cacheTtl(header: string | null, fallback: number, maximum: number): number {
  if (!header) return fallback
  if (/(?:^|,)\s*(?:no-store|no-cache)(?:\s*(?:,|$))/iu.test(header)) return 0
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d{1,10})"?(?:\s*(?:,|$))/iu.exec(header)
  if (!match) return fallback
  const seconds = Number(match[1])
  if (!Number.isSafeInteger(seconds)) return fallback
  return Math.min(seconds * 1_000, maximum)
}

function validateIssuerUrl(value: string, allowInsecureLoopback: boolean): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH || value !== value.trim()) {
    throw configurationError()
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configurationError()
  }
  if (url.toString() !== value || url.username || url.password || url.search || url.hash ||
      !isAllowedProviderProtocol(url, allowInsecureLoopback)) {
    throw configurationError()
  }
  return url
}

function validateProviderUrl(value: string, issuerUrl: URL, allowInsecureLoopback: boolean): URL {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || value !== value.trim()) {
    throw new OidcVerificationError('oidc_discovery_invalid', 'The OIDC discovery document is invalid.')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OidcVerificationError('oidc_discovery_invalid', 'The OIDC discovery document is invalid.')
  }
  if (url.toString() !== value || url.origin !== issuerUrl.origin || url.username || url.password || url.hash ||
      !isAllowedProviderProtocol(url, allowInsecureLoopback)) {
    throw new OidcVerificationError('oidc_discovery_invalid', 'The OIDC discovery document is invalid.')
  }
  return url
}

function isAllowedProviderProtocol(url: URL, allowInsecureLoopback: boolean): boolean {
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && allowInsecureLoopback && isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function discoveryUrlFor(issuer: string): URL {
  return new URL(`${issuer}${issuer.endsWith('/') ? '' : '/'}.well-known/openid-configuration`)
}

function validateAuthorizedParties(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 16) throw configurationError()
  const result = values.map((value) => boundedIdentifier(value, 'OIDC authorized party'))
  if (new Set(result).size !== result.length) throw configurationError()
  return result
}

function boundedIdentifier(value: string, _label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)) {
    throw configurationError()
  }
  return value
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw configurationError()
  return result
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configurationError(): OidcVerificationError {
  return new OidcVerificationError('oidc_configuration_invalid', 'The OIDC verifier configuration is invalid.')
}

function malformedTokenError(): OidcVerificationError {
  return new OidcVerificationError('oidc_token_malformed', 'The OIDC access token is malformed.')
}

function claimError(): OidcVerificationError {
  return new OidcVerificationError('oidc_claim_invalid', 'The OIDC access token claims are invalid.')
}
