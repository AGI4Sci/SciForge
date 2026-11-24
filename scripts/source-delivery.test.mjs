import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadMigrationFixtureLicenseSnapshot, verifyMigrationFixtureLicenseSnapshot } from './migration-fixture-licenses.mjs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const fixtures = [
  'failure-activation/dist/main.js',
  'failure-incompatible/dist/main.js',
  'p1-unitverse/dist/main.js',
  'p2-better-sidebar/dist/main.js',
  'p2-better-sidebar/dist/renderer.html',
  'p2-better-sidebar/dist/renderer.mjs',
  'p3-mcp-bridge/dist/main.js',
  'p4-agent-teams/dist/main.js',
  'p5-ws-scope/dist/main.js'
].map(path => `test-fixtures/migration-plugins/${path}`)

test('fresh Git delivery admits exactly the nine migration dist inputs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'source-delivery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', directory])
  await writeFile(join(directory, '.gitignore'), await readFile(new URL('.gitignore', root)))
  for (const path of fixtures) {
    await assert.doesNotReject(readFile(new URL(path, root)))
    const output = execFileSync('git', ['check-ignore', '--no-index', '--non-matching', '-v', '--stdin'], { cwd: directory, input: `${path}\n`, encoding: 'utf8' })
    assert.match(output, /:!/, `${path} must have an explicit exception`)
  }
  for (const path of ['dist/main.js', 'packages/example/dist/main.js', 'test-fixtures/migration-plugins/p1-unitverse/dist/extra.js', 'test-fixtures/migration-plugins/other/dist/main.js', 'test-fixtures/migration-plugins/p2-better-sidebar/dist/nested/main.js']) {
    const output = execFileSync('git', ['check-ignore', '--no-index', '-v', path], { cwd: directory, encoding: 'utf8' })
    assert.doesNotMatch(output, /:!/, `${path} must remain ignored`)
  }
})

test('retained DSH runtime keeps its original test and typecheck entrypoints', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(scripts['dsh-runtime:test'], 'npm --workspace @sciforge/dsh-runtime run test')
  assert.equal(scripts['dsh-runtime:typecheck'], 'npm --workspace @sciforge/dsh-runtime run typecheck')
  assert.match(scripts.pretest, /npm run domain-packages:test/)
})


let licensedFixtureSnapshot
async function retainedFixtureSnapshot() {
  licensedFixtureSnapshot ??= await loadMigrationFixtureLicenseSnapshot(fileURLToPath(root))
  return new Map(licensedFixtureSnapshot)
}
const fixtureScope = 'test-fixtures/migration-plugins/'
const provenance = fixtureScope + 'THIRD_PARTY.provenance.json'

test('retained nine immutable fixtures have a complete scoped offline third-party license closure', async () => {
  assert.deepEqual(verifyMigrationFixtureLicenseSnapshot(await retainedFixtureSnapshot()), {
    fixtures: 9, inlinePackages: 8, helperAttributions: 1, moduleOccurrences: 316
  })
})

test('Windows autocrlf checkout preserves authenticated fixture and license bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'source-delivery-autocrlf-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=true', ...args], { cwd: directory, stdio: 'pipe' })
  git('init', '-q')
  await writeFile(join(directory, '.gitattributes'), await readFile(new URL('.gitattributes', root)))
  for (const [path, bytes] of await retainedFixtureSnapshot()) {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), bytes)
  }
  git('add', '--all')
  git('checkout-index', '--all', '--prefix=checkout/')
  assert.deepEqual(verifyMigrationFixtureLicenseSnapshot(
    await loadMigrationFixtureLicenseSnapshot(join(directory, 'checkout'))
  ), { fixtures: 9, inlinePackages: 8, helperAttributions: 1, moduleOccurrences: 316 })
})

test('unreviewed inlined packages fail instead of inheriting the root project license', async () => {
  const snapshot = await retainedFixtureSnapshot()
  const path = fixtureScope + 'p3-mcp-bridge/dist/main.js'
  snapshot.set(path, Buffer.concat([snapshot.get(path), Buffer.from('\n// node_modules/unreviewed-package/index.js\nexport const unknown = true;\n')]))
  assert.throws(() => verifyMigrationFixtureLicenseSnapshot(snapshot), /Unreviewed inlined package/)
})

test('an extra dist input fails even if it is ignored by ordinary Git defaults', async () => {
  const snapshot = await retainedFixtureSnapshot()
  snapshot.set(fixtureScope + 'extra/dist/main.js', Buffer.from('export const unknown = true'))
  assert.throws(() => verifyMigrationFixtureLicenseSnapshot(snapshot), /Exactly nine reviewed dist inputs/)
})

for (const mutation of ['missing', 'changed']) test(`a ${mutation} full license text fails the delivery gate`, async () => {
  const snapshot = await retainedFixtureSnapshot()
  const metadata = JSON.parse(snapshot.get(provenance))
  const license = metadata.components[0].licensePath
  if (mutation === 'missing') snapshot.delete(license)
  else snapshot.set(license, Buffer.concat([snapshot.get(license), Buffer.from('modified')]))
  assert.throws(() => verifyMigrationFixtureLicenseSnapshot(snapshot), /license/i)
})

test('license paths cannot escape the reviewed sidecar scope', async () => {
  const snapshot = await retainedFixtureSnapshot()
  const metadata = JSON.parse(snapshot.get(provenance))
  metadata.components[0].licensePath = '../../LICENSE'
  snapshot.set(provenance, Buffer.from(JSON.stringify(metadata)))
  assert.throws(() => verifyMigrationFixtureLicenseSnapshot(snapshot), /License path must stay/)
})

test('recorded modules must match every emitted occurrence, not merely package dependency declarations', async () => {
  const snapshot = await retainedFixtureSnapshot()
  const metadata = JSON.parse(snapshot.get(provenance))
  metadata.components.find(component => component.role === 'inlined-third-party-code').embeddedModuleOccurrences.pop()
  snapshot.set(provenance, Buffer.from(JSON.stringify(metadata)))
  assert.throws(() => verifyMigrationFixtureLicenseSnapshot(snapshot), /Emitted module occurrence inventory differs/)
})

test('the actual license loader rejects symbolic links without following them', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fixture-license-links-'))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const licenses = join(directory, fixtureScope, 'licenses')
  await mkdir(licenses, {recursive: true})
  const original = join(directory, 'owned-synthetic-license.txt')
  await writeFile(original, 'Synthetic license text for a link refusal test')
  await symlink(original, join(licenses, 'linked.LICENSE.txt'))
  await assert.rejects(loadMigrationFixtureLicenseSnapshot(directory), /Symbolic links/)
})
