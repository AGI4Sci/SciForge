import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import { createServer } from 'node:http'

function jsonBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function createSigningKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  return {
    kid,
    privateKey,
    publicJwk: {
      ...publicJwk,
      alg: 'RS256',
      use: 'sig',
      kid
    }
  }
}
function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'public, max-age=60',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    ...headers
  })
  response.end(body)
}

export async function startOidcFixtureServer(options = {}) {
  const host = '127.0.0.1'
  const realmPath = options.realmPath ?? '/realms/SciForge'
  let keyCounter = 1
  let activeKey = createSigningKey(`test-rs256-${keyCounter}`)
  let previousKeys = []
  let issuer = ''

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && path === `${realmPath}/.well-known/openid-configuration`) {
      return sendJson(response, 200, {
        issuer,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        id_token_signing_alg_values_supported: ['RS256']
      })
    }
    if (request.method === 'GET' && path === `${realmPath}/protocol/openid-connect/certs`) {
      return sendJson(response, 200, {
        keys: [activeKey.publicJwk, ...previousKeys.map((key) => key.publicJwk)]
      })
    }
    return sendJson(response, 404, { error: 'not_found' }, { 'cache-control': 'no-store' })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('OIDC fixture did not bind a TCP address.')
  }
  issuer = `http://${host}:${address.port}${realmPath}`

  return {
    issuer,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    jwksUri: `${issuer}/protocol/openid-connect/certs`,
    currentKid() {
      return activeKey.kid
    },
    mintToken(input = {}) {
      const now = input.now ?? Math.floor(Date.now() / 1000)
      const header = {
        alg: 'RS256',
        typ: 'JWT',
        kid: activeKey.kid,
        ...(input.header ?? {})
      }
      const claims = {
        iss: issuer,
        sub: 'oidc-sub-test-owner',
        aud: ['sciforge-cloud-api'],
        azp: 'sciforge-desktop',
        iat: now,
        nbf: now - 1,
        exp: now + 300,
        auth_time: now,
        acr: 'urn:sciforge:loa:1',
        amr: ['pwd'],
        ...(input.claims ?? {})
      }
      const signingInput = `${jsonBase64Url(header)}.${jsonBase64Url(claims)}`
      const signature = signBytes('RSA-SHA256', Buffer.from(signingInput, 'ascii'), activeKey.privateKey)
        .toString('base64url')
      return `${signingInput}.${signature}`
    },
    rotateSigningKey({ keepPrevious = true } = {}) {
      previousKeys = keepPrevious ? [activeKey, ...previousKeys].slice(0, 2) : []
      keyCounter += 1
      activeKey = createSigningKey(`test-rs256-${keyCounter}`)
      return activeKey.kid
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  }
}
