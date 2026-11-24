import { describe, expect, it } from 'vitest'
import { matchPdfStem, normalizeForMatch, type LibraryEntryForMatch } from './pdf-match.js'

const entries: LibraryEntryForMatch[] = [
  {
    paperId: 'zotero:AAAA1111',
    title: 'A generative model of the somatic sensory cortex',
    year: 2026,
    doi: '10.1038/s41586-025-09796-0'
  },
  {
    paperId: 'zotero:BBBB2222',
    title: 'Attention is all you need',
    year: 2017
  }
]

describe('normalizeForMatch', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeForMatch('Café — Neuronal  Activity.pdf')).toBe('cafe neuronal activity pdf')
  })
})

describe('matchPdfStem', () => {
  it('matches on the DOI suffix inside the file name', () => {
    const result = matchPdfStem(entries, 's41586-025-09796-0')
    expect(result.matched).toMatchObject({ paperId: 'zotero:AAAA1111', matchedBy: ['doi'] })
    expect(result.matched!.score).toBe(1)
    expect(result.candidates).toEqual([])
  })

  it('matches on title words plus the year', () => {
    const result = matchPdfStem(entries, 'Attention Is All You Need (2017)')
    expect(result.matched).toMatchObject({ paperId: 'zotero:BBBB2222', matchedBy: ['title', 'year'] })
    expect(result.matched!.score).toBeCloseTo(1, 5)
  })

  it('reports the score without a year bonus when the year is absent', () => {
    const result = matchPdfStem(entries, 'attention is all you need')
    expect(result.matched).toMatchObject({ paperId: 'zotero:BBBB2222', matchedBy: ['title'] })
    expect(result.matched!.score).toBeCloseTo(0.85, 5)
  })

  it('returns no match when the title is only partly covered', () => {
    expect(matchPdfStem(entries, 'a generative model')).toEqual({ matched: null, candidates: [] })
  })

  it('returns no match for an unrelated file name', () => {
    expect(matchPdfStem(entries, 'lecture-notes-week-3')).toEqual({ matched: null, candidates: [] })
  })

  it('refuses to pick a winner when two entries fit equally well', () => {
    const twins: LibraryEntryForMatch[] = [
      { paperId: 'a', title: 'Neural population dynamics', year: 2020 },
      { paperId: 'b', title: 'Neural population dynamics', year: 2021 },
      { paperId: 'c', title: 'Unrelated work', year: 2019 }
    ]
    const result = matchPdfStem(twins, 'neural population dynamics')
    expect(result.matched).toBeNull()
    expect(result.candidates.map((c) => c.paperId)).toEqual(['a', 'b'])
    expect(result.candidates.every((c) => c.matchedBy.includes('title'))).toBe(true)
  })

  it('lists the runner-up as a candidate when one match is clearly better', () => {
    const near: LibraryEntryForMatch[] = [
      { paperId: 'long', title: 'Neural population dynamics during reaching', year: 2020 },
      { paperId: 'short', title: 'Neural population dynamics', year: 2019 }
    ]
    const result = matchPdfStem(near, 'neural population dynamics during reaching 2020')
    expect(result.matched).toMatchObject({ paperId: 'long', matchedBy: ['title', 'year'] })
    expect(result.candidates.map((c) => c.paperId)).toEqual(['short'])
  })

  it('never awards a year-only match', () => {
    expect(matchPdfStem(entries, '2026')).toEqual({ matched: null, candidates: [] })
  })
})
