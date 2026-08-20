import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const realmUrl = new URL('../infra/keycloak/realm-sciforge.json', import.meta.url)
const composeUrl = new URL('../infra/keycloak/compose.yaml', import.meta.url)
const envExampleUrl = new URL('../infra/keycloak/.env.example', import.meta.url)

async function realm() {
  return JSON.parse(await readFile(realmUrl, 'utf8'))
}

test('Keycloak realm defines the three frozen SciForge clients', async () => {
  const value = await realm()
  assert.equal(value.realm, 'SciForge')
  assert.equal(value.enabled, true)
  assert.equal(value.registrationAllowed, true)
  assert.equal(value.loginWithEmailAllowed, true)
  assert.equal(value.duplicateEmailsAllowed, false)
  assert.deepEqual(
    value.clients.map((client) => client.clientId).sort(),
    ['sciforge-cloud-api', 'sciforge-desktop', 'sciforge-web-mobile']
  )
})

test('Desktop and Web clients require authorization code with S256 PKCE', async () => {
  const value = await realm()
  for (const clientId of ['sciforge-desktop', 'sciforge-web-mobile']) {
    const client = value.clients.find((candidate) => candidate.clientId === clientId)
    assert.ok(client)
    assert.equal(client.publicClient, true)
    assert.equal(client.standardFlowEnabled, true)
    assert.equal(client.directAccessGrantsEnabled, false)
    assert.equal(client.attributes['pkce.code.challenge.method'], 'S256')
    assert.ok(client.protocolMappers.some((mapper) => (
      mapper.protocolMapper === 'oidc-audience-mapper' &&
      mapper.config['included.client.audience'] === 'sciforge-cloud-api' &&
      mapper.config['access.token.claim'] === 'true'
    )))
  }

  const desktop = value.clients.find((candidate) => candidate.clientId === 'sciforge-desktop')
  assert.deepEqual(desktop.redirectUris, ['http://127.0.0.1:43110/oidc/callback'])
})

test('Cloud API is bearer-only and realm export contains no users or secrets', async () => {
  const value = await realm()
  const cloudApi = value.clients.find((candidate) => candidate.clientId === 'sciforge-cloud-api')
  assert.ok(cloudApi)
  assert.equal(cloudApi.bearerOnly, true)
  assert.equal(cloudApi.standardFlowEnabled, false)
  assert.equal(Object.hasOwn(value, 'users'), false)
  assert.doesNotMatch(
    JSON.stringify(value),
    /"(?:clientSecret|secret|password|apiKey|privateKey)"\s*:/iu
  )
})

test('Compose pins official images, binds Keycloak to loopback, and requires injected passwords', async () => {
  const compose = await readFile(composeUrl, 'utf8')
  const envExample = await readFile(envExampleUrl, 'utf8')
  assert.match(compose, /quay\.io\/keycloak\/keycloak:26\.7\.0/u)
  assert.match(compose, /postgres:17\.6-alpine/u)
  assert.match(compose, /127\.0\.0\.1:8080:8080/u)
  assert.match(compose, /KEYCLOAK_DB_PASSWORD:\?Set KEYCLOAK_DB_PASSWORD/u)
  assert.match(compose, /KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:\?Set KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD/u)
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:\s*["']?(?:admin|password|keycloak)["']?\s*$/imu)
  assert.match(envExample, /^KEYCLOAK_DB_PASSWORD=\s*$/mu)
  assert.match(envExample, /^KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD=\s*$/mu)
})
