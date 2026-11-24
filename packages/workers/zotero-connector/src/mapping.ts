import type { ZoteroItem, ZoteroWritableItem } from './contract.js'

/**
 * Maps a normalized Zotero item to a knowledge-net library entry: only the
 * bibliographic fields the knowledge net seals (id, title, authors, year, DOI).
 * Everything else — notes, tags, collections, attachments — is dropped.
 */

export type ZoteroLibraryEntry = Readonly<{
  paperId: string
  title: string
  authors: readonly string[]
  year?: number
  doi?: string
}>

const ZOTERO_PAPER_ID_PREFIX = 'zotero:'

export function toLibraryEntry(item: ZoteroItem): ZoteroLibraryEntry {
  const year = parseYear(item)
  return {
    paperId: `${ZOTERO_PAPER_ID_PREFIX}${item.key}`,
    title: item.title,
    authors: item.creators
      .filter((creator) => creator.creatorType === 'author')
      .map(formatCreator)
      .filter((name) => name.length > 0),
    ...(year !== undefined ? { year } : {}),
    ...(item.doi ? { doi: item.doi } : {})
  }
}

function formatCreator(creator: ZoteroItem['creators'][number]): string {
  if (creator.name) return creator.name.trim()
  const first = creator.firstName?.trim() ?? ''
  const last = creator.lastName?.trim() ?? ''
  if (first && last) return `${last}, ${first}`
  return last || first
}

function parseYear(item: ZoteroItem): number | undefined {
  const source = item.parsedDate ?? item.date
  const match = source && /(\d{4})/u.exec(source)
  if (!match) return undefined
  const year = Number.parseInt(match[1]!, 10)
  return year >= 1000 && year <= 2999 ? year : undefined
}

/**
 * Prepares one library entry for a Zotero write. The item type defaults to
 * journalArticle; the caller may override it before applying. Authors are
 * split back into structured creators on the "Last, First" comma boundary,
 * falling back to a single name field.
 */
export function toWritableItem(entry: ZoteroLibraryEntry): ZoteroWritableItem {
  return {
    itemType: 'journalArticle',
    title: entry.title,
    creators: entry.authors.map(parseCreator),
    ...(entry.year !== undefined ? { date: String(entry.year) } : {}),
    ...(entry.doi ? { DOI: entry.doi } : {})
  }
}

function parseCreator(author: string): ZoteroWritableItem['creators'][number] {
  const comma = author.indexOf(',')
  if (comma > 0) {
    return {
      creatorType: 'author',
      lastName: author.slice(0, comma).trim(),
      firstName: author.slice(comma + 1).trim()
    }
  }
  return { creatorType: 'author', name: author.trim() }
}
