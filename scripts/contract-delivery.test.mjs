import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)
test('public contract entrypoint retains all client-owned groups and excludes private deployment payloads', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  for (const name of ['collaboration-ci', 'dev-bootstrap', 'identity-access-docs', 'source-delivery']) {
    assert.ok(pkg.scripts['contracts:test']?.includes(`${name}.test.mjs`), name)
  }
  assert.match(pkg.scripts.pretest, /npm run contracts:test/u)
  const workflow = await readFile(new URL('.github/workflows/collaboration-ci.yml', root), 'utf8')
  assert.match(workflow, /npm run contracts:test/u)
  assert.doesNotMatch(workflow, /collaboration-server|collaboration-provider-zulip|infra\/keycloak|openspec|docs\/operations/u)
  for (const path of ['infra/keycloak', 'deployments/development/sciforge.env', 'openspec', 'docs/identity-access-pr78-acceptance-receipt.md', 'scripts/keycloak-realm.test.mjs']) {
    await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' })
  }
})


test('public CI npm commands resolve to retained root scripts', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/collaboration-ci.yml', root), 'utf8')
  for (const [, command] of workflow.matchAll(/npm run ([\w:-]+)/gu)) {
    assert.equal(typeof pkg.scripts[command], 'string', command)
  }
})
