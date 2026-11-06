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
    let cursor: string | undefined
    let reconstructed = ''
    for (;;) {
      const result = await readWorkspacePreviewTextRange(path, 'session', { cursor, maxCharacters: 127 })
      assert.ok(result.text.length <= 127)
      assert.ok(!result.text.includes('�'))
      reconstructed += result.text
      if (!result.nextCursor) break
      assert.notDeepEqual(result.nextCursor, cursor)
      cursor = result.nextCursor
    }
    assert.equal(reconstructed, original)
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 2, column: 6002 }, maxCharacters: 100 }), /splits a Unicode/)
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 100, column: 1 }, maxCharacters: 100 }), /outside/)
    await writeFile(path, Buffer.from([0xff, 0x00, 0x80]))
    await assert.rejects(readWorkspacePreviewTextRange(path, 'session', { start: { line: 1, column: 1 }, maxCharacters: 100 }))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('cursors bind source and snapshot, reject tampering, and remain independent across sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-cursor-'))
  const path = join(root, 'source.md')
  const other = join(root, 'other.md')
  try {
    await writeFile(path, 'first paragraph\n\nsecond paragraph 😀\n')
    await writeFile(other, 'first paragraph\n\nsecond paragraph 😀\n')
    const first = await readWorkspacePreviewTextRange(path, 'one', { maxCharacters: 17 })
    assert.ok(first.nextCursor)
    const second = await readWorkspacePreviewTextRange(path, 'two', { cursor: first.nextCursor, maxCharacters: 100 })
    assert.equal(first.text + second.text, 'first paragraph\n\nsecond paragraph 😀\n')
    assert.equal(first.snapshotId, second.snapshotId)
    await assert.rejects(readWorkspacePreviewTextRange(other, 'one', { cursor: first.nextCursor, maxCharacters: 100 }), /source version/)
    await assert.rejects(readWorkspacePreviewTextRange(path, 'one', { cursor: first.nextCursor + 'x', maxCharacters: 100 }), /cursor/)
    await writeFile(path, 'changed content\n\nsecond paragraph 😀\n')
    await assert.rejects(readWorkspacePreviewTextRange(path, 'one', { cursor: first.nextCursor, maxCharacters: 100 }), /source version/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('serialized pages stay bounded even for heavily escaped text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-budget-'))
  const path = join(root, 'source.txt')
  try {
    const source = '\u0001\\"\n'.repeat(3000)
    await writeFile(path, source)
    let cursor: string | undefined
    let reconstructed = ''
    do {
      const result = await readWorkspacePreviewTextRange(path, 'session', { cursor, maxCharacters: 4000 })
      assert.ok(JSON.stringify([{ type: 'text', text: JSON.stringify(result) }]).length < 6000)
      assert.ok(result.text.length)
      reconstructed += result.text
      cursor = result.nextCursor
    } while (cursor)
    assert.equal(reconstructed, source)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('concurrent document readers share extraction but not page cursors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-extraction-'))
  const path = join(root, 'source.bin')
  let calls = 0
  const extractor = { version: 'test-v1', extract: async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 20))
    return { text: 'page one\n\npage two\n\n', anchors: [{ frameIndex: 1, start: 0, end: 10 }, { frameIndex: 2, start: 10, end: 20 }] }
  } }
  try {
    await writeFile(path, 'source')
    const [first, second] = await Promise.all([
      readWorkspacePreviewTextRange(path, 'one', { frameIndex: 1, maxCharacters: 4 }, extractor),
      readWorkspacePreviewTextRange(path, 'two', { frameIndex: 2, maxCharacters: 4 }, extractor)
    ])
    assert.equal(calls, 1)
    assert.equal(first.text, 'page')
    assert.equal(second.anchors?.[0].frameIndex, 2)
    const rest = await readWorkspacePreviewTextRange(path, 'two', { cursor: second.nextCursor, maxCharacters: 4000 }, extractor)
    assert.equal(second.text + rest.text, 'page two\n\n')
    assert.equal(rest.truncated, false)
    assert.equal(calls, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
