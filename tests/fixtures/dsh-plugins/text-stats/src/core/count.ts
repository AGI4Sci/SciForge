/**
 * Text statistics with one explicit, documented counting rule.
 *
 * The whole point of this plugin is that the numbers mean something specific, so
 * the rule is a first-class output (`describeRules`) rather than a footnote:
 *
 *  - `characters` counts Unicode code points, not UTF-16 units and not grapheme
 *    clusters. An emoji made of two code points therefore counts as 2.
 *  - `cjkCharacters` counts CJK ideographs, kana and hangul syllables. Each one
 *    counts as a word too, because Chinese/Japanese/Korean text is not
 *    whitespace-delimited.
 *  - `latinWords` counts whitespace- or punctuation-separated runs that contain at
 *    least one Latin letter; digits alone do not form a word.
 *  - `words` is `cjkCharacters + latinWords` — the mixed-script convention, stated
 *    in the output so nobody has to guess which one it is.
 *  - `lines` counts `\n`, `\r\n` and `\r` separated lines, and a single trailing
 *    newline does not create an extra empty line.
 *  - `paragraphs` counts blocks separated by a blank line.
 */

export const TEXT_STATS_RULES_VERSION = '1.0.0'
/** Guard rail: counting is O(n) and refuses to run away on a pasted corpus. */
export const MAX_CODE_POINTS = 1_000_000

export type TextStatsCounts = Readonly<{
  rulesVersion: string
  characters: number
  cjkCharacters: number
  latinWords: number
  words: number
  lines: number
  paragraphs: number
  whitespaceCharacters: number
  nonWhitespaceCharacters: number
  utf8Bytes: number
  estimatedReadingMinutes: number
}>

export type TextStatsRule = Readonly<{ field: string; rule: string }>

export const TEXT_STATS_RULES: readonly TextStatsRule[] = Object.freeze([
  { field: 'characters', rule: 'Unicode code points. A code point is not a grapheme cluster, so a composed emoji counts as more than one.' },
  { field: 'cjkCharacters', rule: 'CJK ideographs (U+3400–U+4DBF, U+4E00–U+9FFF, U+F900–U+FAFF), kana (U+3040–U+30FF) and hangul syllables (U+AC00–U+D7AF).' },
  { field: 'latinWords', rule: 'Runs of letters/digits separated by whitespace or punctuation that contain at least one Latin letter. Digits alone are not a word.' },
  { field: 'words', rule: 'cjkCharacters + latinWords (mixed-script convention).' },
  { field: 'lines', rule: 'Lines separated by LF, CRLF or CR; one trailing newline does not add an empty line.' },
  { field: 'paragraphs', rule: 'Blocks separated by a blank line (a line containing only whitespace counts as blank).' },
  { field: 'whitespaceCharacters', rule: 'Code points matching the Unicode whitespace class.' },
  { field: 'utf8Bytes', rule: 'UTF-8 byte length of the text, which is what a file on disk would occupy.' },
  { field: 'estimatedReadingMinutes', rule: 'Estimate: latinWords/200 + cjkCharacters/400, rounded to one decimal. An estimate, not a measurement.' }
])

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  )
}

const LATIN_WORD_PATTERN = /[A-Za-z0-9]+(?:['’\u2011-][A-Za-z0-9]+)*/g

export function countText(input: string): TextStatsCounts {
  if (typeof input !== 'string') {
    throw new TypeError('text_stats expects a string.')
  }
  const codePoints = [...input]
  if (codePoints.length > MAX_CODE_POINTS) {
    throw new RangeError(`text_stats accepts at most ${MAX_CODE_POINTS} code points; received ${codePoints.length}.`)
  }

  let cjkCharacters = 0
  let whitespaceCharacters = 0
  for (const character of codePoints) {
    const value = character.codePointAt(0) ?? 0
    if (isCjk(value)) cjkCharacters += 1
    if (/\s/u.test(character)) whitespaceCharacters += 1
  }

  const latinWords = (input.match(LATIN_WORD_PATTERN) ?? [])
    .filter((token) => /[A-Za-z]/.test(token)).length

  const withoutTrailingNewline = input.replace(/\r\n$|\n$|\r$/, '')
  const lines = input === '' ? 0 : withoutTrailingNewline.split(/\r\n|\r|\n/).length
  const paragraphs = input.trim() === ''
    ? 0
    : input.trim().split(/\r?\n\s*\r?\n/).filter((block) => block.trim() !== '').length

  const words = cjkCharacters + latinWords
  const estimatedReadingMinutes = Math.round((latinWords / 200 + cjkCharacters / 400) * 10) / 10

  return Object.freeze({
    rulesVersion: TEXT_STATS_RULES_VERSION,
    characters: codePoints.length,
    cjkCharacters,
    latinWords,
    words,
    lines,
    paragraphs,
    whitespaceCharacters,
    nonWhitespaceCharacters: codePoints.length - whitespaceCharacters,
    utf8Bytes: Buffer.byteLength(input, 'utf8'),
    estimatedReadingMinutes
  })
}

export function describeRules(): Readonly<{ rulesVersion: string; maxCodePoints: number; rules: readonly TextStatsRule[] }> {
  return Object.freeze({
    rulesVersion: TEXT_STATS_RULES_VERSION,
    maxCodePoints: MAX_CODE_POINTS,
    rules: TEXT_STATS_RULES
  })
}

/** Examples that ship with the plugin so the rule is checkable by eye. */
export const TEXT_STATS_EXAMPLES: readonly Readonly<{ text: string; characters: number; words: number }>[] = Object.freeze([
  { text: 'hello world', characters: 11, words: 2 },
  { text: '你好，世界', characters: 5, words: 4 },
  { text: 'Hi 你好', characters: 5, words: 3 }
])