#!/usr/bin/env node

import { createPublicKey, verify as verifySignature } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs'
import { isAbsolute } from 'node:path'

const EXPECTED_ISSUER = 'https://login-test.sciforge.cn/realms/SciForge'
const EXPECTED_ORIGIN = 'https://login-test.sciforge.cn/'
const EXPECTED_AUDIENCE = 'sciforge-cloud-api'
const ALLOWED_AUTHORIZED_PARTIES = new Set([
  'sciforge-desktop',
  'sciforge-web-mobile',
])
const ENDPOINT_NAMES = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
]
const TOKEN_MIN_BYTES = 16
const TOKEN_MAX_BYTES = 16_384
const CLOCK_TOLERANCE_SECONDS = 60
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function fail(code) {
  console.error(`VERIFY_FAILED=${code}`)
  process.exit(1)
}

function requireCondition(condition, code) {
  if (!condition) {
    fail(code)
  }
}

function parseJsonBuffer(buffer, code) {
  try {
    requireCondition(
      !(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf),
      code,
    )
    const value = JSON.parse(utf8Decoder.decode(buffer))
    requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code)
    return value
  } catch {
    fail(code)
  }
}

function readJsonFile(path, code) {
  try {
    return parseJsonBuffer(readFileSync(path), code)
  } catch {
    fail(code)
  }
}

function decodeBase64Url(segment, code) {
  requireCondition(
    typeof segment === 'string' && /^[A-Za-z0-9_-]+$/.test(segment),
    code,
  )

  let decoded
  try {
    decoded = Buffer.from(segment, 'base64url')
  } catch {
    fail(code)
  }

  requireCondition(decoded.length > 0 && decoded.toString('base64url') === segment, code)
  return decoded
}

function decodeJsonSegment(segment, code) {
  return parseJsonBuffer(decodeBase64Url(segment, code), code)
}

function rsaModulusBits(jwk) {
  const modulus = decodeBase64Url(jwk.n, 'invalid_jwks_modulus')
  const modulusHex = modulus.toString('hex')
  requireCondition(modulusHex.length > 0, 'invalid_jwks_modulus')
  return BigInt(`0x${modulusHex}`).toString(2).length
}

function sameFileState(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs &&
    before.mode === after.mode &&
    before.uid === after.uid &&
    before.nlink === after.nlink
  )
}

function validateTokenFileState(stats, expectedUid) {
  requireCondition(stats.isFile(), 'token_file_not_regular')
  requireCondition(stats.nlink === 1n, 'token_file_link_count')
  requireCondition((stats.mode & 0o7777n) === 0o600n, 'token_file_mode')
  requireCondition(stats.uid === expectedUid, 'token_file_owner')
  requireCondition(
    stats.size >= BigInt(TOKEN_MIN_BYTES) && stats.size <= BigInt(TOKEN_MAX_BYTES),
    'token_file_size',
  )
}

function readTokenFileSecurely(path) {
  requireCondition(typeof path === 'string' && isAbsolute(path), 'token_file_path_not_absolute')
  requireCondition(typeof process.getuid === 'function', 'token_file_owner_check_unavailable')
  requireCondition(Number.isInteger(constants.O_NOFOLLOW), 'token_file_nofollow_unavailable')

  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    fail('token_file_open')
  }

  try {
    const expectedUid = BigInt(process.getuid())
    const before = fstatSync(fd, { bigint: true })
    validateTokenFileState(before, expectedUid)

    const fileBytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < fileBytes.length) {
      const readCount = readSync(fd, fileBytes, offset, fileBytes.length - offset, offset)
      requireCondition(readCount > 0, 'token_file_short_read')
      offset += readCount
    }

    const after = fstatSync(fd, { bigint: true })
    validateTokenFileState(after, expectedUid)
    requireCondition(sameFileState(before, after), 'token_file_changed_during_read')

    const tokenBytes = fileBytes.at(-1) === 0x0a
      ? fileBytes.subarray(0, fileBytes.length - 1)
      : fileBytes
    requireCondition(tokenBytes.length >= TOKEN_MIN_BYTES, 'token_file_size')

    const token = tokenBytes.toString('latin1')
    requireCondition(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
      'token_file_format',
    )
    return token
  } finally {
    closeSync(fd)
  }
}

function hasAsciiControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function validateDiscovery(discovery) {
  requireCondition(discovery.issuer === EXPECTED_ISSUER, 'discovery_issuer')

  for (const name of ENDPOINT_NAMES) {
    const value = discovery[name]
    let endpoint
    try {
      endpoint = new URL(value)
    } catch {
      fail(`discovery_${name}`)
    }
    requireCondition(
      typeof value === 'string' &&
      !hasAsciiControlCharacters(value) &&
      endpoint.protocol === 'https:' &&
      endpoint.hostname === 'login-test.sciforge.cn' &&
      endpoint.port === '' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.href.startsWith(EXPECTED_ORIGIN),
      `discovery_${name}`,
    )
  }
}

function validateSigningKeys(jwks) {
  requireCondition(Array.isArray(jwks.keys), 'jwks_keys')

  const signingKeys = jwks.keys.filter((key) => (
    key !== null &&
    typeof key === 'object' &&
    key.use === 'sig' &&
    key.kty === 'RSA' &&
    key.alg === 'RS256' &&
    typeof key.kid === 'string' &&
    key.kid.length > 0 &&
    typeof key.n === 'string' &&
    typeof key.e === 'string'
  ))
  requireCondition(signingKeys.length > 0, 'jwks_signing_keys')
  requireCondition(
    new Set(signingKeys.map((key) => key.kid)).size === signingKeys.length,
    'jwks_duplicate_kid',
  )

  const bitLengths = signingKeys.map((key) => {
    decodeBase64Url(key.e, 'invalid_jwks_exponent')
    try {
      const publicKey = createPublicKey({ key, format: 'jwk' })
      requireCondition(publicKey.asymmetricKeyType === 'rsa', 'invalid_jwks_key')
    } catch {
      fail('invalid_jwks_key')
    }
    return rsaModulusBits(key)
  })
  requireCondition(Math.min(...bitLengths) >= 2048, 'jwks_rsa_key_too_small')
  return { signingKeys, minimumBits: Math.min(...bitLengths) }
}

function validateToken(token, signingKeys) {
  const parts = token.split('.')
  requireCondition(parts.length === 3, 'token_compact_format')

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJsonSegment(encodedHeader, 'token_header')
  const claims = decodeJsonSegment(encodedPayload, 'token_payload')
  const signature = decodeBase64Url(encodedSignature, 'token_signature')

  requireCondition(header.alg === 'RS256', 'token_alg')
  requireCondition(typeof header.kid === 'string' && header.kid.length > 0, 'token_kid')
  requireCondition(!Object.hasOwn(header, 'crit'), 'token_header_crit')
  requireCondition(
    Object.keys(header).length === 3 &&
    Object.keys(header).every((name) => ['alg', 'kid', 'typ'].includes(name)),
    'token_header_keys',
  )
  requireCondition(header.typ === 'JWT' || header.typ === 'at+jwt', 'token_header_type')

  const matchingKeys = signingKeys.filter((key) => key.kid === header.kid)
  requireCondition(matchingKeys.length === 1, 'token_signing_key_match')

  let publicKey
  try {
    publicKey = createPublicKey({ key: matchingKeys[0], format: 'jwk' })
  } catch {
    fail('token_signing_key_import')
  }

  let signatureValid = false
  try {
    signatureValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
      publicKey,
      signature,
    )
  } catch {
    fail('token_signature_verification')
  }
  requireCondition(signatureValid, 'token_signature_invalid')

  requireCondition(claims.iss === EXPECTED_ISSUER, 'token_issuer')
  requireCondition(typeof claims.sub === 'string' && claims.sub.length > 0, 'token_subject')

  const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
  requireCondition(
    Array.isArray(audience) &&
    audience.every((value) => typeof value === 'string' && value.length > 0) &&
    audience.includes(EXPECTED_AUDIENCE),
    'token_audience',
  )
  requireCondition(ALLOWED_AUTHORIZED_PARTIES.has(claims.azp), 'token_authorized_party')

  for (const name of ['exp', 'nbf', 'iat', 'auth_time']) {
    requireCondition(Number.isSafeInteger(claims[name]), `token_${name}_not_integer`)
    requireCondition(claims[name] >= 0, `token_${name}_negative`)
  }
  requireCondition(claims.nbf <= claims.auth_time, 'token_nbf_after_auth_time')
  requireCondition(claims.auth_time <= claims.iat, 'token_auth_time_after_iat')
  requireCondition(claims.iat < claims.exp, 'token_iat_not_before_exp')

  const now = Math.floor(Date.now() / 1000)
  const latestAllowed = now + CLOCK_TOLERANCE_SECONDS
  requireCondition(claims.nbf <= latestAllowed, 'token_nbf_in_future')
  requireCondition(claims.auth_time <= latestAllowed, 'token_auth_time_in_future')
  requireCondition(claims.iat <= latestAllowed, 'token_iat_in_future')
  requireCondition(claims.exp > now, 'token_expired')

  return true
}

const [discoveryPath, jwksPath, tokenPath = ''] = process.argv.slice(2)
requireCondition(Boolean(discoveryPath && jwksPath), 'arguments')

const discovery = readJsonFile(discoveryPath, 'discovery_json')
const jwks = readJsonFile(jwksPath, 'jwks_json')
validateDiscovery(discovery)
const { signingKeys, minimumBits } = validateSigningKeys(jwks)

console.log(`DISCOVERY_ISSUER=${EXPECTED_ISSUER}`)
for (const name of ENDPOINT_NAMES) {
  console.log(`${name.toUpperCase()}=${discovery[name]}`)
}
console.log(`JWKS_SIGNING_KEY_COUNT=${signingKeys.length}`)
console.log(`JWKS_RSA_MIN_BITS=${minimumBits}`)
console.log('JWKS_ALG=RS256')
console.log('JWKS_KID_PRESENT=true')

if (!tokenPath) {
  console.log('TOKEN_CLAIMS_CHECK=SKIPPED')
  process.exit(0)
}

const token = readTokenFileSecurely(tokenPath)
validateToken(token, signingKeys)

console.log('SIGNATURE_VALID=true')
console.log('TOKEN_CLAIMS_CHECK=PASS')
console.log('TOKEN_ALG=RS256')
console.log('TOKEN_KID_PRESENT=true')
console.log('TOKEN_ISSUER_MATCH=true')
console.log('TOKEN_SUB_PRESENT=true')
console.log('TOKEN_AUDIENCE_PRESENT=true')
console.log('TOKEN_AZP_ALLOWED=true')
for (const name of ['exp', 'nbf', 'iat', 'auth_time']) {
  console.log(`TOKEN_${name.toUpperCase()}_INTEGER=true`)
}
console.log('TOKEN_TIME_ORDER_VALID=true')
