import assert from 'node:assert/strict'
import { createHash, randomBytes, subtle } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const issuer = process.env.SCIFORGE_OIDC_ISSUER ?? 'http://127.0.0.1:8080/realms/SciForge'
const clientId = 'sciforge-desktop'
const audience = 'sciforge-cloud-api'
const redirectUri = 'http://127.0.0.1:43110/oidc/callback'

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function openBrowser(url) {
  const options = { detached: true, stdio: 'ignore' }
  let child

  if (process.platform === 'win32') {
    child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], options)
  } else if (process.env.WSL_DISTRO_NAME) {
    child = spawn(
      '/mnt/c/Windows/System32/rundll32.exe',
      ['url.dll,FileProtocolHandler', url],
      options
    )
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], options)
  } else {
    child = spawn('xdg-open', [url], options)
  }

  child.on('error', () => {
    console.log(`Open this URL in a browser:\n${url}`)
  })
  child.unref()
}

async function receiveAuthorizationCode(expectedState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('OIDC login timed out after 5 minutes.'))
    }, 5 * 60 * 1000)

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', redirectUri)
      if (requestUrl.pathname !== '/oidc/callback') {
        response.writeHead(404).end('Not found')
        return
      }

      const error = requestUrl.searchParams.get('error')
      const code = requestUrl.searchParams.get('code')
      const state = requestUrl.searchParams.get('state')

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (error) {
        response.end('<h1>SciForge login failed</h1><p>You can close this tab.</p>')
      } else {
        response.end('<h1>SciForge login completed</h1><p>You can close this tab.</p>')
      }

      clearTimeout(timeout)
      server.close()

      if (error) {
        reject(new Error(`OIDC authorization failed: ${error}`))
      } else if (!code || state !== expectedState) {
        reject(new Error('OIDC callback is missing a code or has an invalid state.'))
      } else {
        resolve(code)
      }
    })

    server.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    server.listen(43110, '127.0.0.1')
  })
}

async function verifyAccessToken(accessToken, jwksUri) {
  const parts = accessToken.split('.')
  assert.equal(parts.length, 3, 'Access Token must be a JWT.')

  const header = decodeJwtPart(parts[0])
  const claims = decodeJwtPart(parts[1])
  assert.equal(header.alg, 'RS256', 'Access Token must use RS256.')

  const jwksResponse = await fetch(jwksUri)
  assert.equal(jwksResponse.ok, true, `JWKS request failed with ${jwksResponse.status}.`)
  const jwks = await jwksResponse.json()
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.use === 'sig')
  assert.ok(jwk, `No signing key found for kid ${header.kid}.`)

  const publicKey = await subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const signatureValid = await subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    Buffer.from(parts[2], 'base64url'),
    Buffer.from(`${parts[0]}.${parts[1]}`)
  )
  assert.equal(signatureValid, true, 'Access Token signature is invalid.')
  assert.equal(claims.iss, issuer, 'Access Token issuer does not match the configured issuer.')
  assert.equal(typeof claims.sub, 'string', 'Access Token is missing sub.')
  assert.ok(claims.sub.length > 0, 'Access Token sub must not be empty.')
  assert.ok(
    Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience,
    `Access Token aud must include ${audience}.`
  )
  assert.equal(claims.azp, clientId, `Access Token azp must be ${clientId}.`)
  assert.ok(claims.exp * 1000 > Date.now(), 'Access Token is expired.')

  return claims
}

async function main() {
  const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`)
  assert.equal(discoveryResponse.ok, true, `OIDC discovery failed with ${discoveryResponse.status}.`)
  const discovery = await discoveryResponse.json()
  assert.equal(discovery.issuer, issuer, 'Discovery issuer does not match the configured issuer.')

  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const state = base64Url(randomBytes(24))
  const authorizationUrl = new URL(discovery.authorization_endpoint)
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  }).toString()

  const authorizationCode = receiveAuthorizationCode(state)
  console.log('Opening the SciForge Keycloak login page...')
  console.log('New users can choose Register on that page.')
  console.log(`If the browser does not open, use this URL:\n${authorizationUrl}`)
  openBrowser(authorizationUrl.toString())

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code: await authorizationCode,
      code_verifier: codeVerifier
    })
  })
  const tokenPayload = await tokenResponse.json()
  assert.equal(tokenResponse.ok, true, `Token exchange failed: ${JSON.stringify(tokenPayload)}`)

  const claims = await verifyAccessToken(tokenPayload.access_token, discovery.jwks_uri)
  console.log('SciForge OIDC login verified:')
  console.table({
    issuer: claims.iss,
    subject: claims.sub,
    audience: Array.isArray(claims.aud) ? claims.aud.join(', ') : claims.aud,
    authorizedParty: claims.azp,
    username: claims.preferred_username,
    email: claims.email
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
