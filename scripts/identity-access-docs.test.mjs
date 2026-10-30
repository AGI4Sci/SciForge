import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const documents = {
  context: new URL('../docs/contexts/identity-access/CONTEXT.md', import.meta.url),
  adrIndex: new URL('../docs/adr/README.md', import.meta.url),
  adr0023: new URL(
    '../docs/adr/0023-use-system-browser-oidc-with-pkce-for-desktop-login.md',
    import.meta.url
  )
}

async function readDocument(name) {
  return readFile(documents[name], 'utf8')
}

test('identity architecture describes the current OIDC and Device-backed Principal path', async () => {
  const context = await readDocument('context')

  for (const text of [context]) {
    assert.match(text, /Authorization Code with PKCE/u)
  }
  assert.match(context, /\/v1\/me/u)
  assert.match(context, /`cloud-authenticated`/u)
  assert.match(context, /`ACTIVE`/u)
})

test('accepted ADR 0023 amends the historical local-only identity decisions', async () => {
  const [adrIndex, adr0023] = await Promise.all([
    readDocument('adrIndex'),
    readDocument('adr0023')
  ])

  assert.match(adr0023, /^status: accepted$/mu)
  assert.match(adr0023, /^amends: ADR-0014, ADR-0015$/mu)
  assert.match(adr0023, /Cloud configuration is explicit/u)
  assert.match(adr0023, /fails closed/u)
  assert.match(adr0023, /Device.*`ACTIVE`/u)
  assert.match(adrIndex, /\| 0023 \| accepted \|/u)
})

test('identity architecture does not regress to deferred OIDC or deployment-specific hosts', async () => {
  const architecture = (
    await Promise.all([
      readDocument('context'),
      readDocument('adrIndex'),
      readDocument('adr0023')
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
