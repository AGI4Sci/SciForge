import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { countText, describeRules, MAX_CODE_POINTS, TEXT_STATS_RULES } from '../src/core/count.js'
import { __internals, apply } from '../src/dsh-adapter/index.js'

const declaration = JSON.parse(
  await readFile(new URL('../sciforge.dsh.json', import.meta.url), 'utf8')
) as { tools: Record<string, { id: string; effect: string }> }

test('counts Latin text', () => {
  const counts = countText('Hello brave new world')
  assert.equal(counts.characters, 21)
  assert.equal(counts.latinWords, 4)
  assert.equal(counts.cjkCharacters, 0)
  assert.equal(counts.words, 4)
  assert.equal(counts.lines, 1)
  assert.equal(counts.paragraphs, 1)
  assert.equal(counts.utf8Bytes, 21)
})

test('counts CJK characters individually as words', () => {
  const counts = countText('你好世界')
  assert.equal(counts.characters, 4)
  assert.equal(counts.cjkCharacters, 4)
  assert.equal(counts.latinWords, 0)
  assert.equal(counts.words, 4)
  assert.equal(counts.utf8Bytes, 12)
})

test('counts mixed script with the documented convention', () => {
  const counts = countText('SciForge 你好 world')
  assert.equal(counts.cjkCharacters, 2)
  assert.equal(counts.latinWords, 2)
  assert.equal(counts.words, 4)
})

test('digits alone are not a word, but alphanumeric runs are', () => {
  assert.equal(countText('2026 10 23').latinWords, 0)
  // `10-23` has no Latin letter, so it is not a word; `and` and `v2` are.
  assert.equal(countText('10-23 and v2').latinWords, 2)
})

test('empty and whitespace-only text', () => {
  const empty = countText('')
  assert.equal(empty.characters, 0)
  assert.equal(empty.words, 0)
  assert.equal(empty.lines, 0)
  assert.equal(empty.paragraphs, 0)
  assert.equal(empty.estimatedReadingMinutes, 0)

  const spaces = countText('   \n  ')
  assert.equal(spaces.whitespaceCharacters, 6)
  assert.equal(spaces.nonWhitespaceCharacters, 0)
  assert.equal(spaces.paragraphs, 0)
})

test('one trailing newline does not create an extra line', () => {
  assert.equal(countText('a\nb').lines, 2)
  assert.equal(countText('a\nb\n').lines, 2)
  assert.equal(countText('a\nb\n\n').lines, 3)
  assert.equal(countText('a\r\nb\rc').lines, 3)
})

test('paragraphs are blocks separated by a blank line', () => {
  const counts = countText('first paragraph\n\nsecond paragraph\n\n\nthird')
  assert.equal(counts.paragraphs, 3)
})

test('a code point is not a grapheme cluster', () => {
  // U+1F44D alone: one code point, four UTF-8 bytes.
  const thumb = countText('👍')
  assert.equal(thumb.characters, 1)
  assert.equal(thumb.utf8Bytes, 4)
  // With a skin-tone modifier it is two code points, eight bytes.
  const toned = countText('👍🏽')
  assert.equal(toned.characters, 2)
  assert.equal(toned.utf8Bytes, 8)
})

test('refuses a non-string and an oversized text', () => {
  assert.throws(() => countText(42 as never), /expects a string/)
  assert.throws(() => countText('a'.repeat(MAX_CODE_POINTS + 1)), /at most/)
})

test('the tool layer reports invalid input instead of throwing', () => {
  assert.deepEqual(__internals.countResult({}), {
    ok: false,
    error: { code: 'invalid_request', message: 'Provide `text` as a string.' }
  })
  const tooLong = __internals.countResult({ text: 'a'.repeat(MAX_CODE_POINTS + 1) })
  assert.equal(tooLong.ok, false)
  assert.equal((tooLong as { error: { code: string } }).error.code, 'text_too_long')

  const ok = __internals.countResult({ text: '你好' })
  assert.equal(ok.ok, true)
  assert.equal((ok as { result: { words: number } }).result.words, 2)
})

test('registered tool names match the market declaration exactly', () => {
  const registered: { name: string }[] = []
  apply({ tools: { register: (tool: unknown) => registered.push(tool as { name: string }) } } as never)

  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    Object.keys(declaration.tools).sort()
  )
  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    ['text_stats_count', 'text_stats_explain']
  )
})

test('unexpected configuration fails closed', () => {
  assert.throws(
    () => apply({ tools: { register: () => undefined } } as never, { surprise: true }),
    /takes no configuration/
  )
  apply({ tools: { register: () => undefined } } as never, {})
})

test('the rules and examples are part of the output', () => {
  const rules = describeRules()
  assert.equal(rules.rulesVersion, '1.0.0')
  assert.equal(rules.rules.length, TEXT_STATS_RULES.length)
  assert.match(rules.rules.find((rule) => rule.field === 'words')?.rule ?? '', /cjkCharacters \+ latinWords/)
})