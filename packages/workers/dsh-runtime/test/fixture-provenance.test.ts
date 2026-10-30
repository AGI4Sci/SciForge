import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const root = new URL('./fixtures/official-acp/', import.meta.url)
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'))
test('official safety inputs have audited hashes and contain no private local configuration', () => {
  assert.equal(provenance.sourceCommit, '87a0014a73be16197b40b4b3d072b3abd2cb82f1')
  assert.equal(provenance.upstreamCommit, '639ed015397290b3745d163aafe02ffee4aa3f84')
  assert.deepEqual(provenance.files.map((file: { file: string }) => file.file), ['default-acp.yml', 'safe-acp.yml'])
  for (const file of provenance.files) {
    const bytes = readFileSync(new URL(file.file, root))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    assert.doesNotMatch(bytes.toString(), /\/Users\/|\/home\/|\/root\/|sciforge\.cn/)
    assert.doesNotMatch(bytes.toString(), /^\s*(?:apiKey|password|token|secret):\s*\S/m)
  }
  assert.equal(createHash('sha256').update(readFileSync(new URL('LICENSE.deepseek', root))).digest('hex'), provenance.licenseSha256)
})
