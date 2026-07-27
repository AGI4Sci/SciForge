import assert from 'node:assert/strict'
import test from 'node:test'
import type { PaperRadarProfile, PaperRadarRecord } from '../contract'
import type { PaperRadarMutationConfirmation } from './paper-radar-capability-client'
import {
  filterPapersByQuery,
  reviewPaperRadarWithFallback,
  withPaperRadarTimeout
} from './PaperRadarPanel'

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

test('releases a stalled review request after the configured timeout', async () => {
  await assert.rejects(
    withPaperRadarTimeout(new Promise<never>(() => undefined), 5),
    /timed out after 5 ms/i
  )
})

test('builds recommendations from local papers when the latest sync stalls', async () => {
  const profile: PaperRadarProfile = {
    name: 'default',
    keywords: ['foundation model'],
    excludeKeywords: [],
    arxivCategories: ['q-bio'],
    biorxivSubjects: []
  }
  const confirmation: PaperRadarMutationConfirmation = {
    approval: { mode: 'confirmation' }
  }
  let localResultCount = 0
  const outcome = await reviewPaperRadarWithFallback({
    review: async () => new Promise<never>(() => undefined),
    saveProfile: async () => ({ ok: true, data: { profile } }),
    digest: async () => ({
      ok: true,
      data: {
        profile: profile.name,
        count: 1,
        papers: [basePaper],
        generatedAt: '2026-07-23T00:00:00.000Z'
      }
    })
  }, {
    profile,
    days: 7,
    topK: 12,
    maxRecords: 200
  }, confirmation, 5, (data) => {
    localResultCount = data.count
  })

  assert.equal(localResultCount, 1)
  assert.equal(outcome.usedLocalFallback, true)
  assert.deepEqual(outcome.data.papers, [basePaper])
  assert.deepEqual(outcome.data.syncResults, [])
})
