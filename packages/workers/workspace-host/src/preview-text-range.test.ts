import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readWorkspacePreviewTextRange } from './preview-text-range.js'

test('text ranges preserve Unicode, CRLF and edit coordinates across bounded continuations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-text-range-'))
  const path = join(root, 'source.txt')
  const original = `标题\r\n${'中'.repeat(6000)}😀结尾\n最后`
  try {
    await writeFile(path, original)
    let start = { line: 1, column: 1 }
    let reconstructed = ''
    for (;;) {
      const result = await readWorkspacePreviewTextRange(path, 'session', { start, maxCharacters: 127 })
      assert.ok(result.text.length <= 127)
      assert.ok(!result.text.includes('�'))
      reconstructed += result.text
      if (!result.nextStart) break
      assert.notDeepEqual(result.nextStart, start)
      start = result.nextStart
    }
    assert.equal(reconstructed, original)
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 2, column: 6002 }, maxCharacters: 100 }), /splits a Unicode/)
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 100, column: 1 }, maxCharacters: 100 }), /outside/)
    await writeFile(path, Buffer.from([0xff, 0x00, 0x80]))
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 1, column: 1 }, maxCharacters: 100 }))
  } finally { await rm(root, { recursive: true, force: true }) }
})
