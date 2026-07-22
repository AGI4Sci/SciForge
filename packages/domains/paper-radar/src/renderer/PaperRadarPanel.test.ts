import assert from 'node:assert/strict'
import test from 'node:test'
import type { PaperRadarRecord } from '../contract'
import { filterPapersByQuery } from './PaperRadarPanel'

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

test('filters loaded papers locally across paper metadata', () => {
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

  assert.deepEqual(filterPapersByQuery(papers, 'protein'), [papers[0]])
  assert.deepEqual(filterPapersByQuery(papers, 'bioinformatics'), [papers[1]])
  assert.deepEqual(filterPapersByQuery(papers, 'protein, diffusion'), [papers[0]])
  assert.equal(filterPapersByQuery(papers, ''), papers)
})
