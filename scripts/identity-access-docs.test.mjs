import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const documents = {
  context: new URL('../docs/contexts/identity-access/CONTEXT.md', import.meta.url),
  adrIndex: new URL('../docs/adr/README.md', import.meta.url),
  adr0023: new URL(
    '../docs/adr/0023-use-system-browser-oidc-with-pkce-for-desktop-login.md',
    import.meta.url
  ),
  changeIndex: new URL('../openspec/changes/README.md', import.meta.url),
  identitySpec: new URL(
    '../openspec/changes/unify-user-device-collaboration/specs/user-device-identity/spec.md',
    import.meta.url
  ),
  receipt: new URL('../docs/identity-access-pr78-acceptance-receipt.md', import.meta.url)
}

async function readDocument(name) {
  return readFile(documents[name], 'utf8')
}

test('identity architecture describes the current OIDC and Device-backed Principal path', async () => {
  const [context, changeIndex, identitySpec] = await Promise.all([
    readDocument('context'),
    readDocument('changeIndex'),
    readDocument('identitySpec')
  ])

  for (const text of [context, changeIndex, identitySpec]) {
    assert.match(text, /Authorization Code with PKCE/u)
  }
  assert.match(context, /\/v1\/me/u)
  assert.match(context, /`cloud-authenticated`/u)
  assert.match(context, /`ACTIVE`/u)
  assert.match(identitySpec, /fail closed/u)
  assert.match(identitySpec, /Device.*`ACTIVE`/u)
})

test('accepted ADR 0023 amends the historical local-only identity decisions', async () => {
  const [adrIndex, adr0023] = await Promise.all([
    readDocument('adrIndex'),
    readDocument('adr0023')
  ])

  assert.match(adr0023, /^status: accepted$/mu)
  assert.match(adr0023, /^amends: ADR-0014, ADR-0015$/mu)
  assert.match(adr0023, /Cloud configuration is explicit/u)
  assert.match(adrIndex, /\| 0023 \| accepted \|/u)
})

test('identity architecture does not regress to deferred OIDC or deployment-specific hosts', async () => {
  const architecture = (
    await Promise.all([
      readDocument('context'),
      readDocument('adrIndex'),
      readDocument('adr0023'),
      readDocument('changeIndex'),
      readDocument('identitySpec')
    ])
  ).join('\n')

  for (const staleSentence of [
    'Canonical cloud identity, Keycloak/OIDC, Connected Mode, and identity migration remain deferred.',
    'system-browser OIDC+PKCE is deferred pending a new identity change.',
    'System-browser OIDC+PKCE requires a future identity change and is not current behavior.',
    'V1 can assert only locally selected identity;'
  ]) {
    assert.equal(architecture.includes(staleSentence), false)
  }

  assert.doesNotMatch(architecture, /(?:login-test|cloud-test)\.sciforge\.cn/u)
})

test('PR receipt separates final packaged, historical PKCE, and external Cloud evidence', async () => {
  const receipt = await readDocument('receipt')

  for (const revision of [
    '2d47fd25745e595f3d0886afa9fc880d499b967c',
    '983b6afd9f26a8eb24b6bee0c9fcc2e65b6af44c',
    '2c3b55b3d3d127a1b0b77a6fd550570cd8e5f32a',
    '7ad6d48c3bd4c6eba23c90dda370c912e6950f49'
  ]) {
    assert.match(receipt, new RegExp(revision, 'u'))
  }

  assert.match(receipt, /canonical source under review is the current head/iu)
  assert.match(receipt, /^## Final Frozen Windows Packaged Artifact$/mu)
  assert.match(receipt, /53e6372a487cbbfc9de348f87d6ddce208ea9fd2663591e328d310443e363c9e/u)
  assert.match(receipt, /01171b2a435eca9f099c80c4605588fc64906c299d2ff3e8829023c93786d709/u)
  assert.match(receipt, /identity-access` `1\.1\.0` occurred exactly once in both main and renderer/iu)
  assert.match(receipt, /human-driven\s+PKCE login was deliberately not repeated/iu)
  assert.match(receipt, /PKCE observations.*belong exclusively to the older historical artifact/isu)
  assert.match(receipt, /Production\/runtime source, package manifests,\s+`package-lock\.json`.*did not change/isu)
  assert.match(receipt, /not independently prove every Cloud Device/iu)
  assert.match(receipt, /macOS `\/bin\/bash` 3\.2 Keycloak verifier gate remains pending in CI/iu)
  assert.doesNotMatch(receipt, /fresh\s+Windows packaged build and smoke are required/iu)
})
