import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'
import {
  VISUAL_REVIEW_CAPABILITY_IDS,
  visualReviewCreateCandidateInputSchema,
  visualReviewCreateCandidateOutputSchema
} from '../src/review/contract.js'
import { createVisualReviewService } from '../src/review/main.js'
import type { VisualCandidateReviewEvidence } from '../src/review/types.js'
import { createVisualReviewOperations } from '../src/review/operations.js'
import { reviewEvidence, renderPng, sha256, tempRoot } from './review-fixtures.js'

const valid = reviewEvidence('candidate.png', 'a'.repeat(64))
const without = (value: object, key: string): Record<string, unknown> => {
  const copy = { ...value } as Record<string, unknown>
  delete copy[key]
  return copy
}
const invalidEvidence = [
  ['missing status', without(valid, 'status')],
  ['needs_context even with pass', { ...valid, status: 'needs_context' }],
  ['repair_required even with pass', { ...valid, status: 'repair_required' }],
  ['unknown status', { ...valid, status: 'ready' }],
  ['missing needsContext', { ...valid, semantic: without(valid.semantic, 'needsContext') }],
  ['needsContext even with ready status', { ...valid, semantic: { ...valid.semantic, needsContext: true } }],
  ['failed semantic review', { ...valid, semantic: { ...valid.semantic, pass: false } }],
  ['repairable', { ...valid, repairable: true }],
  ['violations even with pass', { ...valid, semantic: { ...valid.semantic, violations: ['Wrong relation'] } }],
  ['repair instructions even with pass', { ...valid, semantic: { ...valid.semantic, repairInstructions: ['Fix label'] } }],
  ['failed QA', { ...valid, ok: false }],
  ['unknown top-level alias', { ...valid, releaseStatus: 'publication_ready' }],
  ['unknown semantic alias', { ...valid, semantic: { ...valid.semantic, needs_context: false } }],
  ['pending repair action', { ...valid, nextAction: { kind: 'same_route_repair', route: 'model', maxAttempts: 2, instructions: ['Fix'] } }]
] as const

const input = (evidence: unknown) => ({
  documentId: 'figure', candidatePath: 'candidate.png', summary: 'Improve labels', reviewEvidence: evidence
})

test('candidate contract accepts complete real publication/draft QA and rejects missing or ineligible evidence strictly', () => {
  for (const status of ['publication_ready', 'draft_ready'] as const) {
    const evidence = {
      ...valid, status,
      score: { ...valid.score, reference: 0.8, warnings: ['Reference ratio differs'] },
      warnings: ['Within draft release ceiling']
    }
    assert.deepEqual(visualReviewCreateCandidateInputSchema.parse(input(evidence)).reviewEvidence, evidence)
  }
  for (const [name, evidence] of invalidEvidence) {
    assert.equal(visualReviewCreateCandidateInputSchema.safeParse(input(evidence)).success, false, name)
  }
  const schema = z.toJSONSchema(visualReviewCreateCandidateInputSchema, { target: 'draft-7' })
  const evidence = schema.properties!.reviewEvidence as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> }
  assert.ok(evidence.required.includes('status'))
  assert.equal(evidence.additionalProperties, false)
  const semantic = evidence.properties.semantic as { required: string[]; additionalProperties: boolean }
  assert.ok(semantic.required.includes('needsContext'))
  assert.equal(semantic.additionalProperties, false)
})

test('main service and canonical operations fail closed without staging invalid QA; preserve full valid QA for audit', async (t) => {
  const root = await tempRoot('review-qa-contract-')
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  const source = await renderPng()
  const candidate = await renderPng(128, 80)
  await writeFile(join(workspaceRoot, 'source.png'), source)
  await writeFile(join(workspaceRoot, 'candidate.png'), candidate)
  const service = createVisualReviewService()
  const opened = await service.open({ workspaceRoot, documentId: 'figure', artifact: { kind: 'image', sourcePath: 'source.png' } })
  const operations = createVisualReviewOperations()
  const before = await readFile(opened.paths.documentPath, 'utf8')
  for (const [name, evidence] of invalidEvidence) {
    await assert.rejects(service.createCandidate({
      workspaceRoot, ...input(evidence), reviewEvidence: evidence as VisualCandidateReviewEvidence
    }), z.ZodError, `direct main service: ${name}`)
    await assert.rejects(operations.invoke(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate, input(evidence), workspaceRoot),
      z.ZodError, `canonical operations: ${name}`)
    assert.equal(await readFile(opened.paths.documentPath, 'utf8'), before, name)
    assert.deepEqual(await readdir(opened.paths.revisionsDir), [], name)
  }
  const evidence: VisualCandidateReviewEvidence = {
    ...reviewEvidence('candidate.png', sha256(candidate)), status: 'draft_ready',
    score: { ...valid.score, reference: 0.8, warnings: ['Audit score detail'] },
    semantic: { ...valid.semantic, summary: 'Labels are readable; facts preserved' },
    warnings: ['Draft release ceiling applies']
  }
  const created = await service.createCandidate({ workspaceRoot, ...input(evidence), reviewEvidence: evidence })
  assert.deepEqual(created.revision.reviewEvidence, evidence)
  assert.deepEqual(visualReviewCreateCandidateOutputSchema.parse(created).revision.reviewEvidence, evidence)
  const persisted = JSON.parse(await readFile(opened.paths.documentPath, 'utf8'))
  assert.deepEqual(persisted.revisions[0].reviewEvidence, evidence)
  assert.deepEqual((await service.open({ workspaceRoot, documentId: 'figure' })).document.revisions[0]!.reviewEvidence, evidence)
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), source)

  persisted.revisions[0].reviewEvidence.status = 'needs_context'
  await writeFile(opened.paths.documentPath, JSON.stringify(persisted))
  await assert.rejects(service.preflightAcceptCandidate({ workspaceRoot, documentId: 'figure', revisionId: created.revision.id }), z.ZodError)
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), source)
})

test('review UI prompt requires full eligible QA without claiming authenticated host evidence', async () => {
  const source = await readFile(new URL('../src/review-ui/VisualReviewPanel.tsx', import.meta.url), 'utf8')
  for (const text of ['publication_ready', 'draft_ready', 'semantic.needsContext=false', 'needs_context', 'repair_required',
    'semantic.violations', 'semantic.repairInstructions', '...review结果', '密码学证明', 'Host 签发的 receipt']) {
    assert.ok(source.includes(text), text)
  }
  assert.ok(source.includes('保留完整 status、semantic、score、warnings、路径、哈希和时间供审计'))
})
