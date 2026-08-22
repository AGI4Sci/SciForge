import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deploymentRoot = join(repositoryRoot, 'infra', 'keycloak', 'test')
const composePath = join(deploymentRoot, 'compose.yaml')
const containerfilePath = join(deploymentRoot, 'Containerfile')
const realmPath = join(deploymentRoot, 'realm-sciforge.json')
const releasePath = join(deploymentRoot, 'release.json')
const checksumsPath = join(deploymentRoot, 'SHA256SUMS')

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function interactiveClient(realm, clientId) {
  const client = realm.clients.find((candidate) => candidate.clientId === clientId)
  assert.ok(client, `Missing ${clientId}`)
  return client
}

function assertInteractiveClient(client) {
  assert.equal(client.publicClient, true)
  assert.equal(client.standardFlowEnabled, true)
  assert.equal(client.directAccessGrantsEnabled, false)
  assert.equal(client.serviceAccountsEnabled, false)
  assert.equal(client.attributes['pkce.code.challenge.method'], 'S256')

  const audienceMappers = client.protocolMappers.filter((mapper) => (
    mapper.protocolMapper === 'oidc-audience-mapper' &&
    mapper.config?.['included.client.audience'] === 'sciforge-cloud-api' &&
    mapper.config?.['access.token.claim'] === 'true'
  ))
  assert.equal(audienceMappers.length, 1)

  const nbfMappers = client.protocolMappers.filter((mapper) => (
    mapper.name === 'sciforge-access-token-not-before' ||
    mapper.config?.['claim.name'] === 'nbf'
  ))
  assert.equal(nbfMappers.length, 1)
  const mapper = nbfMappers[0]
  assert.equal(mapper.protocol, 'openid-connect')
  assert.equal(mapper.protocolMapper, 'oidc-usersessionmodel-note-mapper')
  assert.equal(mapper.config['user.session.note'], 'AUTH_TIME')
  assert.equal(mapper.config['claim.name'], 'nbf')
  assert.equal(mapper.config['jsonType.label'], 'long')
  assert.equal(mapper.config['access.token.claim'], 'true')
  assert.equal(mapper.config['id.token.claim'], 'false')
  assert.equal(mapper.config['userinfo.token.claim'], 'false')
  assert.equal(mapper.config['introspection.token.claim'], 'true')
  assert.doesNotMatch(mapper.protocolMapper, /(?:hardcoded|script)/iu)
}

test('shared test Compose pins runtime artifacts and production startup', async () => {
  const compose = await readFile(composePath, 'utf8')
  const containerfile = await readFile(containerfilePath, 'utf8')

  assert.match(
    containerfile,
    /quay\.io\/keycloak\/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13/u,
  )
  assert.match(containerfile, /kc\.sh build[\s\S]*--db=postgres/u)
  assert.match(containerfile, /^USER 1000$/mu)
  assert.match(
    compose,
    /postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94/u,
  )
  assert.match(compose, /image: sciforge-keycloak-optimized:26\.7\.0-f0f691e6f473/u)
  assert.match(compose, /pull_policy: never/u)
  assert.match(compose, /command: \["start", "--optimized"\]/u)
  assert.doesNotMatch(compose, /start-dev|--import-realm/u)
  assert.match(compose, /KC_HOSTNAME: https:\/\/login-test\.sciforge\.cn/u)
  assert.match(compose, /KC_PROXY_HEADERS: xforwarded/u)
  assert.match(compose, /KC_PROXY_TRUSTED_ADDRESSES: 172\.24\.0\.3/u)
  assert.match(compose, /KC_HTTP_ENABLED: "true"/u)
  assert.match(compose, /KC_HEALTH_ENABLED: "true"/u)
  assert.doesNotMatch(compose, /KC_HOSTNAME_STRICT/u)
})

test('shared test Compose isolates networks, ports, and container privileges', async () => {
  const compose = await readFile(composePath, 'utf8')
  const keycloakStart = compose.indexOf('\n  keycloak:\n')
  const volumesStart = compose.indexOf('\nvolumes:\n')
  assert.notEqual(keycloakStart, -1)
  assert.notEqual(volumesStart, -1)
  const databaseService = compose.slice(compose.indexOf('  keycloak-db:\n'), keycloakStart)
  const keycloakService = compose.slice(keycloakStart, volumesStart)

  assert.doesNotMatch(compose, /^\s+ports:/mu)
  assert.doesNotMatch(compose, /docker\.sock/u)
  assert.doesNotMatch(databaseService, /identity-edge/u)
  assert.match(databaseService, /identity-internal/u)
  assert.match(keycloakService, /identity-internal/u)
  assert.match(keycloakService, /identity-edge/u)
  assert.match(compose, /HEAD \/health\/ready[\s\S]*127\.0\.0\.1\/9000/u)
  assert.match(compose, /name: sciforge-keycloak_identity-internal[\s\S]*internal: true/u)
  assert.match(compose, /name: sciforge-keycloak_identity-edge[\s\S]*internal: false/u)
  assert.match(compose, /aliases:\s*\n\s*- keycloak/u)
  assert.match(compose, /no-new-privileges:true/u)
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/u)
  assert.match(compose, /mem_limit: 1536m/u)
  assert.match(compose, /cpus: 1\.5/u)
  assert.match(compose, /pids_limit: 512/u)
  assert.match(compose, /mem_limit: 1024m/u)
  assert.match(compose, /cpus: 1\.0/u)
  assert.match(compose, /pids_limit: 256/u)
  assert.equal(compose.match(/read_only: true/gu)?.length, 2)
  assert.equal(compose.match(/no-new-privileges:true/gu)?.length, 2)
  assert.equal(compose.match(/cap_drop:\s*\n\s*- ALL/gu)?.length, 2)
  assert.match(compose, /POSTGRES_PASSWORD: \$\{KEYCLOAK_DB_PASSWORD:\?KEYCLOAK_DB_PASSWORD is required\}/u)
})

test('shared test Realm preserves the frozen OIDC contract', async () => {
  const realm = await readJson(realmPath)
  assert.equal(realm.realm, 'SciForge')
  assert.equal(realm.enabled, true)
  assert.equal(realm.registrationAllowed, false)
  assert.equal(realm.accessTokenLifespan, 300)
  assert.equal(realm.defaultSignatureAlgorithm, 'RS256')
  assert.deepEqual(
    realm.clients.map((client) => client.clientId).sort(),
    ['sciforge-cloud-api', 'sciforge-desktop', 'sciforge-web-mobile'],
  )

  const desktop = interactiveClient(realm, 'sciforge-desktop')
  const webMobile = interactiveClient(realm, 'sciforge-web-mobile')
  assertInteractiveClient(desktop)
  assertInteractiveClient(webMobile)
  assert.deepEqual(desktop.redirectUris, ['http://127.0.0.1:43110/oidc/callback'])

  const cloudApi = interactiveClient(realm, 'sciforge-cloud-api')
  assert.equal(cloudApi.publicClient, false)
  assert.equal(cloudApi.bearerOnly, true)
  assert.equal(cloudApi.standardFlowEnabled, false)
  assert.equal(cloudApi.directAccessGrantsEnabled, false)
  assert.equal(Object.hasOwn(realm, 'users'), false)
})

test('release metadata records the accepted issuer, edge, images, and recovery evidence', async () => {
  const release = await readJson(releasePath)
  assert.equal(release.environment, 'a-https-oidc-test')
  assert.equal(release.testOnly, true)
  assert.equal(release.oidc.issuer, 'https://login-test.sciforge.cn/realms/SciForge')
  assert.equal(release.oidc.signatureAlgorithm, 'RS256')
  assert.deepEqual(release.oidc.authorizedParties, ['sciforge-desktop', 'sciforge-web-mobile'])
  assert.equal(release.edge.commit, '7ad6d48c3bd4c6eba23c90dda370c912e6950f49')
  assert.equal(release.edge.network, 'sciforge-keycloak_identity-edge')
  assert.equal(release.edge.serviceAlias, 'keycloak')
  assert.equal(release.edge.servicePort, 8080)
  assert.equal(release.backup.isolatedRestorePassed, true)
  assert.equal(release.recordedRuntimeEvidence.keycloakHealthy, true)
  assert.equal(release.recordedRuntimeEvidence.postgresHealthy, true)
})

test('delivery tree contains no committed credentials, Tokens, dumps, or private keys', async () => {
  const files = await listFiles(deploymentRoot)
  for (const path of files) {
    const relativePath = relative(deploymentRoot, path).replaceAll('\\', '/')
    assert.doesNotMatch(relativePath, /(?:^|\/)(?:\.env|.*\.(?:dump|pem|key|p12|pfx|jks))$/iu)
    const content = await readFile(path)
    const text = content.toString('utf8')
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u)
    assert.doesNotMatch(text, /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u)
    assert.doesNotMatch(text, /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/u)
    assert.doesNotMatch(text, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u)
  }
})

test('delivery checksums cover every file except the checksum manifest itself', async () => {
  const manifest = await readFile(checksumsPath, 'utf8')
  const entries = manifest.trim().split('\n').map((line) => {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line)
    assert.ok(match, `Invalid checksum line: ${line}`)
    return { hash: match[1], path: match[2] }
  })
  const expectedPaths = (await listFiles(deploymentRoot))
    .filter((path) => basename(path) !== 'SHA256SUMS')
    .map((path) => relative(deploymentRoot, path).replaceAll('\\', '/'))
    .sort()
  assert.deepEqual(entries.map((entry) => entry.path).sort(), expectedPaths)

  for (const entry of entries) {
    const content = await readFile(join(deploymentRoot, entry.path))
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.hash, entry.path)
  }
})
