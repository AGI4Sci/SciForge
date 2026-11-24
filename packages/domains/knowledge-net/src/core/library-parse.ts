/**
 * Pure parsers that turn a bibliography file into library entries. No file or
 * network access: the caller reads the bytes. Supports BibTeX and CSL-JSON, the
 * two formats Zotero (and most reference managers) export.
 */

export type LibraryEntry = Readonly<{
  /** Citation key (BibTeX) or item id (CSL-JSON). Unique within one import. */
  paperId: string
  title: string
  authors: readonly string[]
  year?: number
  doi?: string
}>

export type LibraryFormat = 'bibtex' | 'csl-json'

export type LibraryParseResult = Readonly<{
  format: LibraryFormat
  entries: readonly LibraryEntry[]
  /** Entries that could not be used, with a reason. Never silently dropped. */
  skipped: readonly { id: string; reason: string }[]
}>

export const MAX_LIBRARY_ENTRIES = 5000

export function detectLibraryFormat(text: string): LibraryFormat {
  const head = text.trimStart()
  return head.startsWith('[') || head.startsWith('{') ? 'csl-json' : 'bibtex'
}

export function parseLibrary(text: string, format?: LibraryFormat): LibraryParseResult {
  const chosen = format ?? detectLibraryFormat(text)
  const parsed = chosen === 'bibtex' ? parseBibtex(text) : parseCslJson(text)
  return { format: chosen, ...dedupe(parsed.entries, parsed.skipped) }
}

function dedupe(
  entries: readonly LibraryEntry[],
  skipped: readonly { id: string; reason: string }[]
): Pick<LibraryParseResult, 'entries' | 'skipped'> {
  const seen = new Set<string>()
  const kept: LibraryEntry[] = []
  const dropped = [...skipped]
  for (const entry of entries) {
    if (seen.has(entry.paperId)) {
      dropped.push({ id: entry.paperId, reason: 'duplicate id in this file' })
      continue
    }
    if (kept.length >= MAX_LIBRARY_ENTRIES) {
      dropped.push({ id: entry.paperId, reason: `over the ${MAX_LIBRARY_ENTRIES}-entry limit` })
      continue
    }
    seen.add(entry.paperId)
    kept.push(entry)
  }
  return { entries: kept, skipped: dropped }
}

// ---------------------------------------------------------------- BibTeX

const IGNORED_ENTRY_TYPES = new Set(['comment', 'string', 'preamble'])

function parseBibtex(text: string): Pick<LibraryParseResult, 'entries' | 'skipped'> {
  const entries: LibraryEntry[] = []
  const skipped: { id: string; reason: string }[] = []
  let cursor = 0
  while (cursor < text.length) {
    const at = text.indexOf('@', cursor)
    if (at === -1) break
    const open = /^@\s*([A-Za-z]+)\s*([{(])/u.exec(text.slice(at, at + 64))
    if (!open) { cursor = at + 1; continue }
    const type = open[1]!.toLowerCase()
    const bodyStart = at + open[0].length
    const bodyEnd = findClosing(text, bodyStart, open[2] === '{' ? '}' : ')')
    cursor = bodyEnd === -1 ? text.length : bodyEnd + 1
    if (IGNORED_ENTRY_TYPES.has(type)) continue
    if (bodyEnd === -1) { skipped.push({ id: `@${type}`, reason: 'unterminated entry' }); continue }
    const body = text.slice(bodyStart, bodyEnd)
    const comma = body.indexOf(',')
    const key = (comma === -1 ? body : body.slice(0, comma)).trim()
    if (!key) { skipped.push({ id: `@${type}`, reason: 'entry has no citation key' }); continue }
    const fields = parseBibtexFields(comma === -1 ? '' : body.slice(comma + 1))
    const title = clean(fields.get('title') ?? '')
    if (!title) { skipped.push({ id: key, reason: 'entry has no title' }); continue }
    entries.push(makeEntry({
      paperId: key,
      title,
      authors: splitAuthors(fields.get('author') ?? fields.get('editor') ?? ''),
      year: parseYear(fields.get('year') ?? fields.get('date') ?? ''),
      doi: normalizeDoi(fields.get('doi') ?? '')
    }))
  }
  return { entries, skipped }
}

function findClosing(text: string, from: number, close: '}' | ')'): number {
  const open = close === '}' ? '{' : '('
  let depth = 1
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') { i += 1; continue }
    if (ch === open) depth += 1
    else if (ch === close) { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

function parseBibtexFields(source: string): Map<string, string> {
  const fields = new Map<string, string>()
  let i = 0
  while (i < source.length) {
    const eq = source.indexOf('=', i)
    if (eq === -1) break
    const name = source.slice(i, eq).replace(/[\s,]+/gu, ' ').trim().split(' ').pop()!.toLowerCase()
    let j = eq + 1
    while (j < source.length && /\s/u.test(source[j]!)) j += 1
    let value = ''
    if (source[j] === '{') {
      const end = findClosing(source, j + 1, '}')
      if (end === -1) break
      value = source.slice(j + 1, end)
      j = end + 1
    } else if (source[j] === '"') {
      let k = j + 1
      while (k < source.length && !(source[k] === '"' && source[k - 1] !== '\\')) k += 1
      value = source.slice(j + 1, k)
      j = k + 1
    } else {
      let k = j
      while (k < source.length && source[k] !== ',') k += 1
      value = source.slice(j, k).trim()
      j = k
    }
    if (name && !fields.has(name)) fields.set(name, value)
    i = j
  }
  return fields
}

// -------------------------------------------------------------- CSL-JSON

function parseCslJson(text: string): Pick<LibraryParseResult, 'entries' | 'skipped'> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const items = Array.isArray(data) ? data : [data]
  const entries: LibraryEntry[] = []
  const skipped: { id: string; reason: string }[] = []
  items.forEach((item, index) => {
    const record = item as Record<string, unknown> | null
    const id = typeof record?.id === 'string' || typeof record?.id === 'number' ? String(record.id) : ''
    if (!record || typeof record !== 'object' || !id) {
      skipped.push({ id: `#${index + 1}`, reason: 'item has no id' })
      return
    }
    const title = clean(typeof record.title === 'string' ? record.title : '')
    if (!title) { skipped.push({ id, reason: 'item has no title' }); return }
    const authors = Array.isArray(record.author)
      ? (record.author as Array<Record<string, unknown>>).map(cslName).filter(Boolean)
      : []
    const dateParts = (record.issued as { 'date-parts'?: unknown } | undefined)?.['date-parts']
    const firstPart = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined
    entries.push(makeEntry({
      paperId: id,
      title,
      authors,
      year: typeof firstPart === 'number' ? validYear(firstPart) : undefined,
      doi: normalizeDoi(typeof record.DOI === 'string' ? record.DOI : '')
    }))
  })
  return { entries, skipped }
}

function cslName(author: Record<string, unknown>): string {
  const family = typeof author.family === 'string' ? author.family.trim() : ''
  const given = typeof author.given === 'string' ? author.given.trim() : ''
  const literal = typeof author.literal === 'string' ? author.literal.trim() : ''
  return family ? (given ? `${family}, ${given}` : family) : literal
}

// --------------------------------------------------------------- helpers

function makeEntry(input: {
  paperId: string; title: string; authors: readonly string[]; year: number | undefined; doi: string | undefined
}): LibraryEntry {
  return {
    paperId: input.paperId,
    title: input.title,
    authors: input.authors,
    ...(input.year !== undefined ? { year: input.year } : {}),
    ...(input.doi ? { doi: input.doi } : {})
  }
}

/** Removes BibTeX grouping braces and collapses whitespace. */
function clean(value: string): string {
  return value.replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim()
}

function splitAuthors(value: string): string[] {
  return clean(value).split(/\s+and\s+/iu).map((name) => name.trim()).filter(Boolean)
}

function validYear(year: number): number | undefined {
  return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : undefined
}

function parseYear(value: string): number | undefined {
  const match = /\b(1\d{3}|2\d{3})\b/u.exec(value)
  return match ? validYear(Number(match[1])) : undefined
}

function normalizeDoi(value: string): string | undefined {
  const doi = clean(value).replace(/^https?:\/\/(dx\.)?doi\.org\//iu, '').toLowerCase()
  return /^10\.\d{4,9}\/\S+$/u.test(doi) ? doi : undefined
}
