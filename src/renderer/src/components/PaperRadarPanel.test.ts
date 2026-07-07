import { describe, expect, it } from 'vitest'
import type { PaperRadarRecord } from '@shared/paper-radar'
import { filterPapersByQuery } from './paper/PaperRadarPanel'

const basePaper: PaperRadarRecord = {
  id: 'arxiv:2607.00001',
  source: 'arxiv',
  externalId: '2607.00001',
  title: 'Protein design with diffusion',
  authors: ['Ada Lovelace'],
  abstract: 'A method for controllable binder design.',
  categories: ['q-bio.BM'],
  subjects: [],
  publishedAt: '2026-07-07',
  absUrl: 'https://arxiv.org/abs/2607.00001'
}

describe('PaperRadarPanel helpers', () => {
  it('filters loaded papers locally across paper metadata', () => {
    const papers: PaperRadarRecord[] = [
      basePaper,
      {
        ...basePaper,
        id: 'biorxiv:2026.07.07.000002',
        source: 'biorxiv',
        externalId: '2026.07.07.000002',
        title: 'Single-cell atlas',
        authors: ['Grace Hopper'],
        abstract: 'A cell state atlas for organoid screens.',
        categories: [],
        subjects: ['bioinformatics'],
        absUrl: 'https://www.biorxiv.org/content/10.1101/2026.07.07.000002'
      }
    ]

    expect(filterPapersByQuery(papers, 'protein')).toEqual([papers[0]])
    expect(filterPapersByQuery(papers, 'bioinformatics')).toEqual([papers[1]])
    expect(filterPapersByQuery(papers, 'protein, diffusion')).toEqual([papers[0]])
    expect(filterPapersByQuery(papers, '')).toBe(papers)
  })
})
