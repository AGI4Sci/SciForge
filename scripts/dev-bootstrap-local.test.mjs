import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import * as bootstrap from './dev-bootstrap.mjs'
test('missing optional development deployment keeps explicit environment without inventing cloud endpoints', async t => {
  assert.equal(typeof bootstrap.loadDevelopmentEnvironment, 'function')
  const root = await mkdtemp(join(tmpdir(), 'dev-local-'))
  t.after(() => rm(root, {recursive:true,force:true}))
  const env = {PRESERVED_VALUE: 'yes'}
  assert.deepEqual(await bootstrap.loadDevelopmentEnvironment(join(root, 'missing.env'), env), env)
  const file = join(root, 'development.env')
  await writeFile(file, 'SCIFORGE_CLOUD_BASE_URL=https://cloud.example.test\n')
  assert.deepEqual(await bootstrap.loadDevelopmentEnvironment(file, {SCIFORGE_CLOUD_BASE_URL:'https://explicit.example.test'}), {SCIFORGE_CLOUD_BASE_URL:'https://explicit.example.test'})
  await assert.rejects(bootstrap.loadDevelopmentEnvironment(root, {}), {code:'EISDIR'})
})
