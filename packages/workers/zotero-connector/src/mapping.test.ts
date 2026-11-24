import { describe, expect, it } from 'vitest'
import { toLibraryEntry, toWritableItem } from './mapping.js'
import type { ZoteroItem } from './contract.js'

function item(overrides: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    key: 'AAAA1111',
    version: 1,
    itemType: 'journalArticle',
    title: 'Attention Is All You Need',
    creators: [],
    ...overrides
  }
}

describe('toLibraryEntry', () => {
  it('namespaces the paper id and keeps only bibliographic fields', () => {
    const entry = toLibraryEntry(item({
      creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
      doi: '10.1234/example',
      parsedDate: '2017-06-12'
    }))
    expect(entry).toEqual({
      paperId: 'zotero:AAAA1111',
      title: 'Attention Is All You Need',
      authors: ['Lovelace, Ada'],
      year: 2017,
      doi: '10.1234/example'
    })
  })

  it('falls back from parsedDate to date and drops out-of-range years', () => {
    expect(toLibraryEntry(item({ date: '2021' })).year).toBe(2021)
    expect(toLibraryEntry(item({ date: 'no year here' })).year).toBeUndefined()
    expect(toLibraryEntry(item({ date: '0999' })).year).toBeUndefined()
  })

  it('keeps only author creators and skips empty names', () => {
    const entry = toLibraryEntry(item({
      creators: [
        { creatorType: 'author', firstName: 'Grace', lastName: 'Hopper' },
        { creatorType: 'editor', firstName: 'Ed', lastName: 'Editor' },
        { creatorType: 'author', name: '' },
        { creatorType: 'author', firstName: '', lastName: '' }
      ]
    }))
    expect(entry.authors).toEqual(['Hopper, Grace'])
  })

  it('uses a single creator name field when present', () => {
    const entry = toLibraryEntry(item({ creators: [{ creatorType: 'author', name: 'Ada Lovelace' }] }))
    expect(entry.authors).toEqual(['Ada Lovelace'])
  })
})

describe('toWritableItem', () => {
  it('round-trips a library entry back to a writable Zotero item', () => {
    const writable = toWritableItem({
      paperId: 'zotero:AAAA1111',
      title: 'Alpha',
      authors: ['Lovelace, Ada', 'Turing, Alan'],
      year: 2021,
      doi: '10.1234/example'
    })
    expect(writable).toEqual({
      itemType: 'journalArticle',
      title: 'Alpha',
      creators: [
        { creatorType: 'author', lastName: 'Lovelace', firstName: 'Ada' },
        { creatorType: 'author', lastName: 'Turing', firstName: 'Alan' }
      ],
      date: '2021',
      DOI: '10.1234/example'
    })
  })

  it('falls back to a single name field without a comma', () => {
    const writable = toWritableItem({ paperId: 'p', title: 'Alpha', authors: ['Ada Lovelace'] })
    expect(writable.creators).toEqual([{ creatorType: 'author', name: 'Ada Lovelace' }])
  })
})
