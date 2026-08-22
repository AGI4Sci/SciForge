#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto'
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const verifierPath = join(dirname(fileURLToPath(import.meta.url)), 'verify-oidc-artifacts.mjs')
const expectedIssuer = 'https://login-test.sciforge.cn/realms/SciForge'
const tempRoot = mkdtempSync(join(tmpdir(), 'sciforge-oidc-verifier-'))
const resolvedTempBase = `${resolve(tmpdir())}${sep}`

if (!resolve(tempRoot).startsWith(resolvedTempBase)) {
  throw new Error('Refusing to use a temporary directory outside the system temp root')
}

const discoveryPath = join(tempRoot, 'discovery.json')
const jwksPath = join(tempRoot, 'jwks.json')
const tokenPath = join(tempRoot, 'token.jwt')
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = publicKey.export({ format: 'jwk' })
const kid = 'temporary-test-key'
const header = { alg: 'RS256', kid, typ: 'JWT' }
const now = Math.floor(Date.now() / 1000)
const validClaims = {
  iss: expectedIssuer,
  sub: 'temporary-test-subject',
  aud: ['sciforge-cloud-api'],
  azp: 'sciforge-desktop',
  nbf: now - 30,
  auth_time: now - 30,
  iat: now,
  exp: now + 300,
}

writeFileSync(discoveryPath, JSON.stringify({
  issuer: expectedIssuer,
  authorization_endpoint: `${expectedIssuer}/protocol/openid-connect/auth`,
  token_endpoint: `${expectedIssuer}/protocol/openid-connect/token`,
  jwks_uri: `${expectedIssuer}/protocol/openid-connect/certs`,
}))
writeFileSync(jwksPath, JSON.stringify({
  keys: [{ ...publicJwk, alg: 'RS256', kid, use: 'sig' }],
}))

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function createToken(claims = validClaims, tokenHeader = header) {
  const encodedHeader = encodeJson(tokenHeader)
  const encodedPayload = encodeJson(claims)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = signPayload('RSA-SHA256', Buffer.from(signingInput, 'ascii'), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

function writeToken(path, token, mode = 0o600) {
  writeFileSync(path, `${token}\n`, { mode })
  chmodSync(path, mode)
}

function runVerifier(path, keySetPath = jwksPath) {
  return spawnSync(
    process.execPath,
    [verifierPath, discoveryPath, keySetPath, path],
    { encoding: 'utf8' },
  )
}

function expectFailure(result, code) {
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, new RegExp(`VERIFY_FAILED=${code}`))
  assert.doesNotMatch(result.stdout, /temporary-test-subject|eyJ/)
  assert.doesNotMatch(result.stderr, /temporary-test-subject|eyJ/)
}

test('accepts a securely stored, valid RS256 token', () => {
  writeToken(tokenPath, createToken())
  const result = runVerifier(tokenPath)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /SIGNATURE_VALID=true/)
  assert.match(result.stdout, /TOKEN_CLAIMS_CHECK=PASS/)
  assert.doesNotMatch(result.stdout, /temporary-test-subject|eyJ/)
})

test('rejects a tampered payload', () => {
  const token = createToken()
  const [encodedHeader, , encodedSignature] = token.split('.')
  const tamperedToken = `${encodedHeader}.${encodeJson({ ...validClaims, sub: 'tampered' })}.${encodedSignature}`
  writeToken(tokenPath, tamperedToken)
  expectFailure(runVerifier(tokenPath), 'token_signature_invalid')
})

test('rejects a tampered signature', () => {
  const token = createToken()
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  const signature = Buffer.from(encodedSignature, 'base64url')
  signature[0] ^= 0x01
  writeToken(tokenPath, `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`)
  expectFailure(runVerifier(tokenPath), 'token_signature_invalid')
})

test('rejects duplicate signing key IDs in JWKS', () => {
  const duplicateJwksPath = join(tempRoot, 'duplicate-jwks.json')
  const signingJwk = { ...publicJwk, alg: 'RS256', kid, use: 'sig' }
  writeFileSync(duplicateJwksPath, JSON.stringify({ keys: [signingJwk, signingJwk] }))
  writeToken(tokenPath, createToken())
  expectFailure(runVerifier(tokenPath, duplicateJwksPath), 'jwks_duplicate_kid')
})

test('rejects a symbolic link', () => {
  const realTokenPath = join(tempRoot, 'real-token.jwt')
  const linkPath = join(tempRoot, 'linked-token.jwt')
  writeToken(realTokenPath, createToken())
  symlinkSync(realTokenPath, linkPath)
  expectFailure(runVerifier(linkPath), 'token_file_open')
})

test('rejects a multiply linked token file', () => {
  const realTokenPath = join(tempRoot, 'hardlink-source.jwt')
  const linkedTokenPath = join(tempRoot, 'hardlink-target.jwt')
  writeToken(realTokenPath, createToken())
  linkSync(realTokenPath, linkedTokenPath)
  expectFailure(runVerifier(linkedTokenPath), 'token_file_link_count')
})

test('rejects mode 0644', () => {
  writeToken(tokenPath, createToken(), 0o644)
  expectFailure(runVerifier(tokenPath), 'token_file_mode')
})

test('rejects special permission bits', () => {
  writeToken(tokenPath, createToken(), 0o1600)
  expectFailure(runVerifier(tokenPath), 'token_file_mode')
})

test('rejects a signed token without nbf', () => {
  const { nbf: _nbf, ...claimsWithoutNbf } = validClaims
  writeToken(tokenPath, createToken(claimsWithoutNbf))
  expectFailure(runVerifier(tokenPath), 'token_nbf_not_integer')
})

test('rejects a negative NumericDate', () => {
  writeToken(tokenPath, createToken({ ...validClaims, nbf: -1 }))
  expectFailure(runVerifier(tokenPath), 'token_nbf_negative')
})

test('rejects an expired token', () => {
  const expiredClaims = {
    ...validClaims,
    nbf: now - 300,
    auth_time: now - 300,
    iat: now - 200,
    exp: now - 100,
  }
  writeToken(tokenPath, createToken(expiredClaims))
  expectFailure(runVerifier(tokenPath), 'token_expired')
})

test('rejects future NumericDates outside clock tolerance', () => {
  const futureClaims = {
    ...validClaims,
    nbf: now + 120,
    auth_time: now + 120,
    iat: now + 120,
    exp: now + 600,
  }
  writeToken(tokenPath, createToken(futureClaims))
  expectFailure(runVerifier(tokenPath), 'token_nbf_in_future')
})

test('rejects unknown JWT header members', () => {
  writeToken(tokenPath, createToken(validClaims, { ...header, unknown: true }))
  expectFailure(runVerifier(tokenPath), 'token_header_keys')
})

test('rejects a crit JWT header', () => {
  writeToken(tokenPath, createToken(validClaims, { ...header, crit: ['unknown'] }))
  expectFailure(runVerifier(tokenPath), 'token_header_crit')
})

test.after(() => {
  if (resolve(tempRoot).startsWith(resolvedTempBase)) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
