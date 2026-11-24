import { describe, expect, it } from 'vitest'
import { detectLibraryFormat, MAX_LIBRARY_ENTRIES, parseLibrary } from './library-parse.js'

const BIB = `
@comment{ignored}
@string{x = "y"}
@article{hasson2002,
  title = {A {Neuron} paper on eccentricity   bias},
  author = {Hasson, Uri and Levy, Ifat and Behrmann, Marlene},
  year = {2002},
  doi = {https://doi.org/10.1016/S0896-6273(02)00662-1}
}
@inproceedings{cichy2014,
  title = "Resolving human object recognition in space and time",
  author = "Cichy, Radoslaw M. and Pantazis, Dimitrios",
  date = 2014-01-26
}
@book{notitle, author = {Nobody}}
@article{, title = {No key}}
`

describe('parseLibrary: BibTeX', () => {
  const result = parseLibrary(BIB)

  it('reads entries, authors, year and a normalized DOI', () => {
    expect(result.format).toBe('bibtex')
    expect(result.entries[0]).toEqual({
      paperId: 'hasson2002',
      title: 'A Neuron paper on eccentricity bias',
      authors: ['Hasson, Uri', 'Levy, Ifat', 'Behrmann, Marlene'],
      year: 2002,
      doi: '10.1016/s0896-6273(02)00662-1'
    })
    expect(result.entries[1]).toMatchObject({ paperId: 'cichy2014', year: 2014 })
    expect(result.entries[1]).not.toHaveProperty('doi')
  })

  it('ignores @comment and @string, and reports unusable entries', () => {
    expect(result.entries.map((e) => e.paperId)).toEqual(['hasson2002', 'cichy2014'])
    expect(result.skipped).toEqual([
      { id: 'notitle', reason: 'entry has no title' },
      { id: '@article', reason: 'entry has no citation key' }
    ])
  })

  it('reports an unterminated entry instead of swallowing the rest', () => {
    const cut = parseLibrary('@article{a, title = {A}}\n@article{b, title = {B')
    expect(cut.entries.map((e) => e.paperId)).toEqual(['a'])
    expect(cut.skipped).toEqual([{ id: '@article', reason: 'unterminated entry' }])
  })

  it('keeps the first of two entries with the same key and reports the second', () => {
    const dup = parseLibrary('@article{k, title={One}}\n@article{k, title={Two}}')
    expect(dup.entries.map((e) => e.title)).toEqual(['One'])
    expect(dup.skipped).toEqual([{ id: 'k', reason: 'duplicate id in this file' }])
  })
})

describe('parseLibrary: CSL-JSON', () => {
  const csl = JSON.stringify([
    { id: 'kanwisher2017', title: 'The quest for the FFA', DOI: '10.1098/rstb.2016.0108',
      author: [{ family: 'Kanwisher', given: 'Nancy' }, { literal: 'The Consortium' }],
      issued: { 'date-parts': [[2017, 3]] } },
    { id: 7, title: 'Numeric id' },
    { title: 'No id' },
    { id: 'empty', title: '  ' }
  ])

  it('reads entries and reports unusable items', () => {
    const result = parseLibrary(csl)
    expect(result.format).toBe('csl-json')
    expect(result.entries[0]).toEqual({
      paperId: 'kanwisher2017', title: 'The quest for the FFA',
      authors: ['Kanwisher, Nancy', 'The Consortium'], year: 2017, doi: '10.1098/rstb.2016.0108'
    })
    expect(result.entries[1]).toMatchObject({ paperId: '7', title: 'Numeric id' })
    expect(result.skipped).toEqual([
      { id: '#3', reason: 'item has no id' },
      { id: 'empty', reason: 'item has no title' }
    ])
  })

  it('throws a clear error on malformed JSON', () => {
    expect(() => parseLibrary('[{"id": ', 'csl-json')).toThrow('The file is not valid JSON.')
  })
})

describe('format detection and limits', () => {
  it('detects JSON by its first character and defaults to BibTeX', () => {
    expect(detectLibraryFormat('  [ {} ]')).toBe('csl-json')
    expect(detectLibraryFormat('@article{a}')).toBe('bibtex')
  })

  it('stops at the entry limit and reports the overflow', () => {
    const many = Array.from({ length: MAX_LIBRARY_ENTRIES + 2 }, (_, i) => `@a{k${i}, title={T${i}}}`).join('\n')
    const result = parseLibrary(many)
    expect(result.entries).toHaveLength(MAX_LIBRARY_ENTRIES)
    expect(result.skipped).toHaveLength(2)
  })
})
