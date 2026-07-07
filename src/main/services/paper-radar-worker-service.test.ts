import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaperRadarWorkerService } from './paper-radar-worker-service'

afterEach(() => {
  vi.useRealTimers()
})

describe('paper-radar worker service adapter', () => {
  it('maps GUI Paper Radar payloads onto the shared worker service contract', async () => {
    const worker = {
      diagnostics: vi.fn(() => ({
        stats: { papers: 2, arxiv: 1, biorxiv: 1 },
        checkedAt: '2026-06-23T00:00:00.000Z'
      })),
      syncArxiv: vi.fn(async () => ({ source: 'arxiv', fetched: 1, upserted: 1, skipped: 0 })),
      syncBiorxiv: vi.fn(async () => ({ source: 'biorxiv', fetched: 1, upserted: 1, skipped: 0 })),
      syncProfile: vi.fn(async () => ({
        dryRun: false,
        preview: false,
        profile: 'lab_default',
        results: [],
        fetched: 0,
        upserted: 0,
        skipped: 0,
        auditId: 'pr_audit_000001'
      })),
      listProfiles: vi.fn(() => ({ profiles: [], count: 0 })),
      saveProfile: vi.fn(() => ({
        dryRun: false,
        preview: false,
        saved: true,
        profile: {
          name: 'lab_default',
          keywords: [],
          excludeKeywords: [],
          arxivCategories: [],
          biorxivSubjects: []
        },
        auditId: 'pr_audit_000002'
      })),
      search: vi.fn(() => ({ papers: [], count: 0 })),
      rank: vi.fn(() => ({ profile: 'lab_default', papers: [], count: 0 })),
      digest: vi.fn(() => ({ profile: 'lab_default', generatedAt: '2026-06-23T00:00:00.000Z', papers: [], count: 0 })),
      close: vi.fn()
    }
    const service = createPaperRadarWorkerService({ service: worker as never })

    await expect(service.status()).resolves.toMatchObject({
      ok: true,
      service: 'sciforge.paper-radar',
      stats: { papers: 2, arxiv: 1, biorxiv: 1 }
    })
    await expect(service.search({ query: 'protein', topK: 5 })).resolves.toEqual({
      ok: true,
      data: { papers: [], count: 0 }
    })
    expect(worker.search).toHaveBeenCalledWith({
      query: 'protein',
      sources: undefined,
      categories: undefined,
      from: undefined,
      to: undefined,
      top_k: 5
    })

    await service.saveProfile({
      name: 'lab default',
      keywords: ['protein'],
      excludeKeywords: ['review'],
      arxivCategories: ['q-bio'],
      biorxivSubjects: ['bioinformatics']
    })
    expect(worker.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'lab default',
      keywords: ['protein'],
      exclude_keywords: ['review'],
      arxiv_categories: ['q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      confirmed: true,
      confirmation_id: 'gui-paper-radar-profile-save'
    }))

    await service.syncProfile({ profile: 'lab_default', maxRecords: 20 })
    expect(worker.syncProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'lab_default',
      max_records: 20,
      confirmed: true,
      confirmation_id: 'gui-paper-radar-profile-sync'
    }))
  })

  it('collapses GUI review into one worker command facade', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'))
    const worker = {
      diagnostics: vi.fn(),
      syncArxiv: vi.fn(),
      syncBiorxiv: vi.fn(),
      syncProfile: vi.fn(async () => ({
        dryRun: false,
        preview: false,
        profile: 'protein_focus',
        results: [{ source: 'arxiv', fetched: 3, upserted: 2, skipped: 1 }],
        fetched: 3,
        upserted: 2,
        skipped: 1,
        auditId: 'pr_audit_000003'
      })),
      listProfiles: vi.fn(),
      saveProfile: vi.fn(() => ({
        dryRun: false,
        preview: false,
        saved: true,
        profile: {
          name: 'protein_focus',
          keywords: ['protein design'],
          excludeKeywords: ['review'],
          arxivCategories: ['q-bio'],
          biorxivSubjects: ['bioinformatics']
        },
        auditId: 'pr_audit_000004'
      })),
      search: vi.fn(),
      rank: vi.fn(),
      digest: vi.fn(() => ({
        profile: 'protein_focus',
        generatedAt: '2026-07-07T12:00:00.000Z',
        papers: [],
        count: 0
      })),
      close: vi.fn()
    }
    const service = createPaperRadarWorkerService({ service: worker as never })

    await expect(service.review({
      profile: {
        name: 'protein_focus',
        keywords: ['protein design'],
        excludeKeywords: ['review'],
        arxivCategories: ['q-bio'],
        biorxivSubjects: ['bioinformatics']
      },
      days: 7,
      topK: 12,
      maxRecords: 200
    })).resolves.toEqual({
      ok: true,
      data: {
        profile: 'protein_focus',
        generatedAt: '2026-07-07T12:00:00.000Z',
        papers: [],
        count: 0,
        syncResults: [{ source: 'arxiv', fetched: 3, upserted: 2, skipped: 1 }]
      }
    })
    expect(worker.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'protein_focus',
      keywords: ['protein design'],
      exclude_keywords: ['review'],
      arxiv_categories: ['q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      confirmed: true,
      confirmation_id: 'gui-paper-radar-review-profile-save'
    }))
    expect(worker.syncProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'protein_focus',
      from: '2026-06-30',
      to: '2026-07-07',
      max_records: 200,
      confirmed: true,
      confirmation_id: 'gui-paper-radar-review-sync'
    }))
    expect(worker.digest).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'protein_focus',
      keywords: ['protein design'],
      exclude_keywords: ['review'],
      days: 7,
      top_k: 12
    }))
    expect(worker.search).not.toHaveBeenCalled()
  })
})
