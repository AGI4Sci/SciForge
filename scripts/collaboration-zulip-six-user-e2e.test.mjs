import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createZulipAcceptanceDriver } from './collaboration-zulip-acceptance-driver.mjs'

// The former six-user write runner is retired. Real acceptance consists of
// packaged desktop actions, followed only by these authenticated Cloud reads.
// The input file contains public IDs, never credentials or fabricated facts.
const enabled = process.env.SCIFORGE_COLLAB_ZULIP_E2E === '1'
test('packaged desktop run: read-only Cloud verification reports unresolved evidence', {
  skip: enabled ? false : 'Set SCIFORGE_COLLAB_ZULIP_E2E=1 with a desktop run record to read Cloud facts.'
}, async () => {
  const path = process.env.SCIFORGE_COLLAB_DESKTOP_RUN_RECORD
  assert.ok(path, 'SCIFORGE_COLLAB_DESKTOP_RUN_RECORD must name the packaged desktop run identifiers.')
  let record
  try { record = JSON.parse(await readFile(path, 'utf8')) }
  catch { assert.fail('Desktop run record is unavailable or invalid JSON.') }
  let result
  try { result = await createZulipAcceptanceDriver().verifyDesktopRun(record) }
  catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : 'READBACK_FAILED'
    assert.fail(`Read-only Cloud verification failed (${code}).`)
  }
  assert.equal(result.environment, 'real_cloud_readback')
  assert.equal(result.accepted, false)
  // A passing test means only that the observed facts agree. Missing UI,
  // deployment and ledger evidence remains visible and cannot close R6.
  process.stdout.write(`${JSON.stringify(result)}\n`)
})
