import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { assertSqliteRuntimeVersion, DatabaseSync } from './sqlite-runtime.js'

test('SQLite runtime accepts the supported boundary and rejects older or invalid versions', () => {
  for (const version of ['22.13.0', '22.18.0', '24.18.0', '26.0.0']) {
    assert.doesNotThrow(() => assertSqliteRuntimeVersion(version))
  }
  for (const version of ['20.19.0', '22.12.0', '22.0.0', 'invalid']) {
    assert.throws(() => assertSqliteRuntimeVersion(version), /requires Node.js >=22\.13\.0/)
  }
  const database = new DatabaseSync(':memory:')
  try {
    assert.equal(database.prepare('SELECT 1 AS value').get()?.value, 1)
  } finally { database.close() }
})

test('unsupported runtime receives an actionable error before loading node:sqlite', () => {
  const moduleUrl = new URL('./sqlite-runtime.ts', import.meta.url).href
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `Object.defineProperty(process.versions, 'node', { value: '22.12.0' }); await import(${JSON.stringify(moduleUrl)});`
  ], { encoding: 'utf8' })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /requires Node.js >=22\.13\.0; current runtime is 22\.12\.0/)
  assert.doesNotMatch(child.stderr, /ERR_UNKNOWN_BUILTIN_MODULE/)
})

test('disabled SQLite receives a clear runtime instruction', () => {
  const moduleUrl = new URL('./sqlite-runtime.ts', import.meta.url).href
  const child = spawnSync(process.execPath, ['--no-experimental-sqlite', '--import', 'tsx', '--input-type=module', '-e',
    `await import(${JSON.stringify(moduleUrl)});`
  ], { encoding: 'utf8' })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /requires a Node.js runtime with node:sqlite enabled/)
  assert.match(child.stderr, /Remove --no-experimental-sqlite/)
})
