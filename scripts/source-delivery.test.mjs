import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
