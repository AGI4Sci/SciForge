import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PDFDocument, StandardFonts } from 'pdf-lib'

import { PaperRadarWorkerError } from './contract.js'
import { requiredChecklistKeys, type DeepReadAnalysis } from './core/deepread-schema.js'
import { buildPlanResult } from './core/deepread-service.js'
import { createPaperRadarFixtureFetch, createPaperRadarService, type PaperRadarService } from './service.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function buildPaperPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = [
    ['A Study of Adaptive Sampling', 'Abstract', 'We describe an adaptive sampling scheme for heart rate.', '1 Introduction', 'Fixed trial tasks are slow and noisy in daily life.'],
    ['2 Methods', 'Participants wore a wrist sensor for four days.', '3 Results', 'Accuracy was higher in the low anxiety group, t(118) = 2.31', 'The correlation with trait anxiety was r = -0.27.'],
    ['4 Discussion', 'Causality cannot be inferred from the present design.', 'References', '[1] A. Author. A paper.']
  ]
  for (const lines of pages) {
    const page = pdf.addPage([595, 842])
    let y = 780
    for (const text of lines) {
      page.drawText(text, { x: 60, y, size: 11, font })
      y -= 18
    }
  }
  return pdf.save()
}

interface Harness {
  service: PaperRadarService
  pdfRequests: string[]
  setPdfStatus(status: number): void
}

async function withService(t: test.TestContext): Promise<Harness> {
  const tempDir = await mkdtemp(join(tmpdir(), 'paper-radar-deepread-'))
  const pdf = await buildPaperPdf()
  const fixtureFetch = createPaperRadarFixtureFetch(fixturesDir)
  const pdfRequests: string[] = []
  let pdfStatus = 200
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('arxiv.org/pdf/') || url.endsWith('.full.pdf')) {
      pdfRequests.push(url)
      return pdfStatus === 200 ? new Response(pdf as BodyInit, { status: 200 }) : new Response('unavailable', { status: pdfStatus })
    }
    return fixtureFetch(input, init)
  }) as typeof fetch

  const service = createPaperRadarService({
    dbPath: join(tempDir, 'paper-radar.sqlite'),
    profilesPath: join(tempDir, 'profiles.json'),
    fetchImpl,
    now: () => new Date('2026-06-17T00:00:00.000Z')
  })
  t.after(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
  })
  service.saveProfile({
    name: 'protein focus',
    keywords: ['protein design', 'diffusion', 'single-cell'],
    exclude_keywords: [],
    arxiv_categories: ['cs.LG', 'q-bio'],
    biorxiv_subjects: ['bioinformatics']
  })
  await service.syncProfile({ profile: 'protein_focus', from: '2026-06-16', to: '2026-06-17', max_records: 10 })
  return { service, pdfRequests, setPdfStatus: (status) => { pdfStatus = status } }
}

function analysisFor(paperId: string, quote: string): DeepReadAnalysis {
  return {
    paperId,
    paperType: 'empirical',
    domain: 'psych',
    dimension1: { known: ['Fixed trial tasks are slow', 'Anxiety relates to awareness', 'Wearables are common'], gaps: [], aim: 'Measure accuracy in daily life.' },
    dimension2: {
      kind: 'methodology',
      operations: 'Participants wore a wrist sensor for four days.',
      designLogic: [
        { choice: 'Adaptive sampling', why: 'Fixed trials are slow.' },
        { choice: 'Four days', why: 'Covers weekday variation.' },
        { choice: 'Wrist sensor', why: 'Unobtrusive.' }
      ],
      checklist: Object.fromEntries(requiredChecklistKeys('psych').map((key) => [key, { status: 'absent' as const }])),
      limits: [{ change: 'Halve the sample', verdict: 'unknown' }]
    },
    dimension3: {
      findings: [
        { finding: 'Accuracy is higher with low anxiety', credibility: 'Moderate.', strength: 'direct', source: 'empirical', evidence: [{ quote }] },
        { finding: 'Anxiety disrupts accuracy', credibility: 'Weak: correlational.', strength: 'indirect', source: 'empirical', evidence: [] }
      ]
    },
    dimension4: { grafts: [{ type: 'method', plan: 'Adopt the sampler.', target: 'Phase 2 study' }] },
    dimension5: { category: 'signpost', rationale: 'Shows how to sample in the field.' },
    conceptTargets: [],
    scqa: {
      situation: 'Interoceptive accuracy is usually measured with fixed-trial lab tasks.',
      complication: 'Fixed-trial tasks are slow, noisy and far from daily life.',
      question: 'Can accuracy be measured continuously in everyday settings?',
      answer: 'Yes, with an adaptive wrist-sensor design that tracks heartbeat detection in the field.'
    },
    reviewerAudit: {
      attacks: [{ dimension: 'validity_threats', attack: 'May measure attention.', severity: 'medium', anchor: 'Methods, section 2', status: 'to_verify' }],
      noAttackFound: false,
      mostFragileConclusion: { conclusion: 'Anxiety disrupts accuracy', because: 'Correlational design.' }
    }
  }
}

test('deep-read plan ranks the index and marks which papers have a PDF', async (t) => {
  const { service } = await withService(t)
  const plan = service.deepReadPlan({ profile: 'protein_focus', from: '2026-06-16', tier1_count: 1, tier2_count: 1 })
  assert.equal(plan.count, 2)
  assert.deepEqual(plan.plan.map((item) => [item.rank, item.tier, item.strategy]), [[1, 1, 'deep'], [2, 2, 'standard']])
  assert.equal(plan.plan.every((item) => item.hasPdf), true)
})

test('buildPlanResult flags a paper without a PDF address', () => {
  const paper = (id: string, pdfUrl?: string) => ({
    id, source: 'arxiv' as const, externalId: id, title: id, authors: [], abstract: '', categories: [], subjects: [],
    publishedAt: '2026-01-01', absUrl: 'https://example.org', score: 1, reason: '', ...(pdfUrl ? { pdfUrl } : {})
  })
  const result = buildPlanResult({ profile: 'p', count: 2, papers: [paper('a', 'https://example.org/a.pdf'), paper('b')] }, {})
  assert.deepEqual(result.plan.map((item) => item.hasPdf), [true, false])
})

test('deep-read packet fetches and extracts one paper, and ships the protocol with it', async (t) => {
  const { service, pdfRequests } = await withService(t)
  const { plan } = service.deepReadPlan({ profile: 'protein_focus', from: '2026-06-16', tier1_count: 1, tier2_count: 0 })
  const result = await service.deepReadPacket({ paper_id: plan[0].id, strategy: 'deep' })

  assert.equal(pdfRequests.length, 1)
  assert.equal(result.packet.paperId, plan[0].id)
  assert.equal(result.packet.strategy, 'deep')
  assert.deepEqual(result.packet.sections.map((s) => s.kind), ['front_matter', 'abstract', 'introduction', 'methods', 'results', 'discussion'])
  assert.equal(result.packet.sections.some((s) => s.kind === 'references'), false)
  assert.equal(result.packet.reliability.status, 'ok')
  assert.deepEqual(Object.keys(result.protocol.checklists).sort(), ['hybrid', 'neuroscience', 'nlp', 'psych'])
  assert.match(result.protocol.instructions, /Reviewer self-audit \(required/)

  const standard = await service.deepReadPacket({ paper_id: plan[0].id, strategy: 'standard' })
  assert.deepEqual(standard.packet.sections.map((s) => s.kind), ['abstract', 'methods', 'results'])
  assert.equal(pdfRequests.length, 1, 'the second packet reuses the extracted text')
})

test('deep-read verify checks the analysis against the same text without fetching again', async (t) => {
  const { service, pdfRequests } = await withService(t)
  const { plan } = service.deepReadPlan({ profile: 'protein_focus', from: '2026-06-16', tier1_count: 1, tier2_count: 0 })
  const id = plan[0].id
  await service.deepReadPacket({ paper_id: id, strategy: 'deep' })

  const good = await service.deepReadVerify({
    paper_id: id,
    strategy: 'deep',
    analysis: analysisFor(id, 'Accuracy was higher in the low anxiety group, t(118) = 2.31')
  })
  assert.equal(good.passed, true, JSON.stringify(good.issues))
  assert.deepEqual(good.quotes, { total: 1, verified: 1 })

  const invented = await service.deepReadVerify({
    paper_id: id,
    strategy: 'deep',
    analysis: analysisFor(id, 'Accuracy was dramatically higher in every single group that was tested')
  })
  assert.equal(invented.passed, false)
  assert.ok(invented.issues.some((issue) => issue.code === 'quote_not_found'))

  const mislabelled = await service.deepReadVerify({
    paper_id: id,
    strategy: 'deep',
    analysis: analysisFor('some-other-paper', 'Accuracy was higher in the low anxiety group, t(118) = 2.31')
  })
  assert.equal(mislabelled.passed, false)
  assert.equal(mislabelled.issues[0].code, 'paper_id_mismatch')
  assert.equal(pdfRequests.length, 1)
})

test('deep-read reports an unknown paper, an unavailable PDF and a cancelled call distinctly', async (t) => {
  const { service, setPdfStatus } = await withService(t)
  const { plan } = service.deepReadPlan({ profile: 'protein_focus', from: '2026-06-16', tier1_count: 1, tier2_count: 0 })

  await assert.rejects(
    () => service.deepReadPacket({ paper_id: 'does-not-exist', strategy: 'deep' }),
    (error: unknown) => error instanceof PaperRadarWorkerError && error.code === 'not_found',
  )

  setPdfStatus(503)
  await assert.rejects(
    () => service.deepReadPacket({ paper_id: plan[0].id, strategy: 'deep' }),
    (error: unknown) => error instanceof PaperRadarWorkerError && error.code === 'upstream_error' && error.retryable === true,
  )

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => service.deepReadPacket({ paper_id: plan[0].id, strategy: 'deep' }, { signal: controller.signal }),
    (error: unknown) => error instanceof PaperRadarWorkerError && error.code === 'aborted',
  )
})
