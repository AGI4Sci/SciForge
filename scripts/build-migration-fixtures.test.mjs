import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const builder = fileURLToPath(new URL('./build-migration-fixtures.mjs', import.meta.url))

test('unknown migration sample fails instead of reporting a successful no-op', () => {
  const result = spawnSync(process.execPath, [builder, 'not-a-fixture'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unknown migration fixture sample/)
})

test('self-contained p5 builds to an isolated destination without changing tracked artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-output-'))
  const tracked = new URL('../test-fixtures/migration-plugins/p5-ws-scope/dist/main.js', import.meta.url)
  const before = await readFile(tracked)
  try {
    const result = spawnSync(process.execPath, [builder, 'p5'], {
      encoding: 'utf8', env: { ...process.env, MIGRATION_FIXTURE_ROOT: root }
    })
    assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(await readFile(join(root, 'p5-ws-scope', 'package.json'), 'utf8'))
    assert.equal(manifest.name, '@sciforge/migration-p5-ws-scope')
    assert.match(await readFile(join(root, 'p5-ws-scope', 'dist/main.js'), 'utf8'), /fixture\.ws\.echo/)
    assert.deepEqual(await readFile(tracked), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
