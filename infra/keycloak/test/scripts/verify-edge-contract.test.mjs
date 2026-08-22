#!/usr/bin/env node

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const wrapperPath = join(scriptDirectory, 'verify-edge-contract.sh')
const tempRoot = mkdtempSync(join(tmpdir(), 'sciforge-edge-wrapper-'))
const resolvedTempBase = `${resolve(tmpdir())}${sep}`

if (!resolve(tempRoot).startsWith(resolvedTempBase)) {
  throw new Error('Refusing to use a temporary directory outside the system temp root')
}

const binDirectory = join(tempRoot, 'bin')
const discoveryPath = join(tempRoot, 'discovery.json')
const jwksPath = join(tempRoot, 'jwks.json')
const fakeCurlPath = join(binDirectory, 'curl')
const fakeCurlLogPath = join(tempRoot, 'curl-arguments.log')
const expectedIssuer = 'https://login-test.sciforge.cn/realms/SciForge'
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = publicKey.export({ format: 'jwk' })

mkdirSync(binDirectory)
writeFileSync(discoveryPath, JSON.stringify({
  issuer: expectedIssuer,
  authorization_endpoint: `${expectedIssuer}/protocol/openid-connect/auth`,
  token_endpoint: `${expectedIssuer}/protocol/openid-connect/token`,
  jwks_uri: `${expectedIssuer}/protocol/openid-connect/certs`,
}))
writeFileSync(jwksPath, JSON.stringify({
  keys: [{ ...publicJwk, alg: 'RS256', kid: 'wrapper-test-key', use: 'sig' }],
}))
writeFileSync(fakeCurlPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "$FAKE_CURL_LOG"
printf '%s\\n' '---' >> "$FAKE_CURL_LOG"
output=''
url=''
while (($#)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
case "$url" in
  */.well-known/openid-configuration)
    cp -- "$FAKE_DISCOVERY_FILE" "$output"
    ;;
  */protocol/openid-connect/certs)
    cp -- "$FAKE_JWKS_FILE" "$output"
    ;;
  *)
    exit 97
    ;;
esac
printf '%s' "\${FAKE_HTTP_STATUS:-200}"
`)
chmodSync(fakeCurlPath, 0o755)

function runWrapper(status = '200', mode = 'local-edge') {
  writeFileSync(fakeCurlLogPath, '')
  const result = spawnSync('bash', [wrapperPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      FAKE_DISCOVERY_FILE: discoveryPath,
      FAKE_JWKS_FILE: jwksPath,
      FAKE_HTTP_STATUS: status,
      FAKE_CURL_LOG: fakeCurlLogPath,
      SCIFORGE_VERIFY_MODE: mode,
    },
  })
  return { result, curlArguments: readFileSync(fakeCurlLogPath, 'utf8') }
}

test('local edge mode pins SNI and TLS to the existing host-published 443', () => {
  const { result, curlArguments } = runWrapper()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /VERIFY_ROUTE=LOCAL_EDGE_TLS/)
  assert.match(result.stdout, /DISCOVERY_ISSUER=https:\/\/login-test\.sciforge\.cn\/realms\/SciForge/)
  assert.match(result.stdout, /TOKEN_CLAIMS_CHECK=SKIPPED/)
  assert.doesNotMatch(result.stdout, /docker|172\.24\.0\.3/)
  assert.match(curlArguments, /--resolve/)
  assert.match(curlArguments, /login-test\.sciforge\.cn:443:127\.0\.0\.1/)
})

test('external public mode does not use the local edge resolve override', () => {
  const { result, curlArguments } = runWrapper('200', 'external-public')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /VERIFY_ROUTE=EXTERNAL_PUBLIC/)
  assert.doesNotMatch(curlArguments, /--resolve|127\.0\.0\.1/)
})

test('external public mode rejects a non-200 response instead of following it', () => {
  const { result } = runWrapper('302', 'external-public')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PUBLIC_HTTPS_HTTP_200=false/)
})

test.after(() => {
  if (resolve(tempRoot).startsWith(resolvedTempBase)) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
