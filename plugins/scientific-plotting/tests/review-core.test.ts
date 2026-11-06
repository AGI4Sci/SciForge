import assert from 'node:assert/strict'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { ARTIFACT_VERSION_COMMIT_CONTRACT, ARTIFACT_VERSION_READ_CONTRACT } from '@sciforge/domain-artifact-versions/contract'
import type { ScientificPlottingCapabilitiesPort } from '../src/ports/capabilities.js'
import { createReviewOperations } from '../src/review-adapter/index.js'
import { visualReviewTools } from '../src/review-adapter/tools.js'
import { createFakeArtifactPort, renderPng, reviewEvidence, sha256, tempRoot } from './review-fixtures.js'

async function seeded(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await tempRoot('scientific-review-core-')
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  const source = await renderPng(96, 64)
  const candidate = await renderPng(128, 80)
  await writeFile(join(workspaceRoot, 'source.png'), source)
  await writeFile(join(workspaceRoot, 'candidate.png'), candidate)
  return { workspaceRoot, source, candidate }
}

test('unified review tools run annotations, packet export, QA candidate and versioned acceptance through canonical core', async (t) => {
  const { workspaceRoot, source, candidate } = await seeded(t)
  const port = createFakeArtifactPort()
  const calls: Array<{ actionId: string; workspaceId?: string }> = []
  const capabilities = {
    invoke: async (contract: { actionId: string }, input: unknown, options?: { workspaceId?: string }) => {
      calls.push({ actionId: contract.actionId, workspaceId: options?.workspaceId })
      return contract.actionId === ARTIFACT_VERSION_COMMIT_CONTRACT.actionId
        ? port.commit(input as never, options?.workspaceId ?? '')
        : port.read(input as never, options?.workspaceId ?? '')
    },
    createApprovedBatch: () => { throw new Error('No approved batch minted by plugin.') }
  } as ScientificPlottingCapabilitiesPort
  const tools = new Map(visualReviewTools(createReviewOperations(capabilities)).map((tool) => [tool.name, tool]))
  const call = async (name: string, input: Record<string, unknown>) =>
    await tools.get(name)!.execute({ workspaceRoot, documentId: 'figure', ...input }) as any

  const opened = await call('visual_review_open', {
    artifact: { kind: 'scientific_plot', sourcePath: 'source.png', mimeType: 'image/png' }
  })
  assert.equal(opened.document.artifact.sourceHash, sha256(source))
  const updated = await call('visual_review_update_context', {
    truthLocks: [{ id: 'preserve-values', description: 'Preserve all data values', nodeIds: [] }],
    styleProfileRef: null
  })
  assert.equal(updated.document.truthLocks.length, 1)
  const styled = await call('visual_review_apply_style_reference', { sourcePath: 'source.png' })
  assert.equal(styled.status, 'style_applied')
  assert.ok(styled.profile.palette.colors.length > 0)
  const annotated = await call('visual_review_save_annotations', {
    annotations: [{ geometry: { kind: 'box', bounds: { x: 0, y: 0, width: 0.5, height: 0.5 } }, instruction: 'Improve labels' }]
  })
  assert.equal(annotated.annotations.length, 1)
  const exported = await call('visual_review_export_review_packet', {})
  assert.equal(exported.packet.annotations[0].instruction, 'Improve labels')
  assert.equal(exported.packet.truthLocks[0].description, 'Preserve all data values')
  const created = await call('visual_review_create_candidate', {
    candidatePath: 'candidate.png', summary: 'Improve labels while preserving values',
    expectedBaseHash: sha256(source), reviewEvidence: reviewEvidence('candidate.png', sha256(candidate))
  })
  assert.equal(created.revision.width, 128)
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), source)
  const accepted = await call('visual_review_accept_candidate', { revisionId: created.revision.id })
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.document.activeCandidateRevisionId, null)
  assert.equal(accepted.revision.versionRef.contentDigest, sha256(candidate))
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), candidate)
  assert.deepEqual(await readFile(accepted.revision.backupPath), source)
  assert.equal(port.commits.length, 1)
  assert.deepEqual(calls, [
    { actionId: ARTIFACT_VERSION_COMMIT_CONTRACT.actionId, workspaceId: workspaceRoot },
    { actionId: ARTIFACT_VERSION_READ_CONTRACT.actionId, workspaceId: workspaceRoot },
    { actionId: ARTIFACT_VERSION_READ_CONTRACT.actionId, workspaceId: workspaceRoot }
  ])
  await call('visual_review_accept_candidate', { revisionId: created.revision.id })
  assert.equal(port.commits.length, 1, 'accepted retries must not mint another immutable version')
  const ref = accepted.revision.versionRef
  const readsBeforeOpen = port.reads.length
  const bound = await tools.get('visual_review_open')!.execute({
    workspaceRoot, documentId: 'bound',
    artifact: { kind: 'scientific_plot', sourcePath: 'source.png', mimeType: 'image/png', versionRef: ref }
  }) as any
  assert.deepEqual(bound.document.artifact.versionRef, ref)
  assert.equal(port.reads.length - readsBeforeOpen, 2, 'a version-bound review must verify through the shared artifact port')
  const read = await call('visual_review_read_document', {})
  assert.equal(read.document.acceptedRevisionId, created.revision.id)
  const image = await tools.get('visual_review_read_image')!.execute({ workspaceRoot, path: 'source.png' }) as any
  assert.match(image.dataUrl, /^data:image\/png;base64,/)
})

test('artifact-unavailable acceptance fails closed without source replacement; rejection remains non-destructive', async (t) => {
  const { workspaceRoot, source, candidate } = await seeded(t)
  const tools = new Map(visualReviewTools(createReviewOperations()).map((tool) => [tool.name, tool]))
  const call = async (name: string, input: Record<string, unknown>) =>
    await tools.get(name)!.execute({ workspaceRoot, documentId: 'figure', ...input }) as any
  await call('visual_review_open', { artifact: { kind: 'scientific_plot', sourcePath: 'source.png' } })
  const created = await call('visual_review_create_candidate', {
    candidatePath: 'candidate.png', summary: 'Candidate', reviewEvidence: reviewEvidence('candidate.png', sha256(candidate))
  })
  await assert.rejects(call('visual_review_accept_candidate', { revisionId: created.revision.id }), /unavailable/)
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), source)
  assert.equal((await call('visual_review_reject_candidate', { revisionId: created.revision.id })).status, 'rejected')
  assert.deepEqual(await readFile(join(workspaceRoot, 'source.png')), source)
})

test('review reads reject missing documents and cross-workspace images instead of creating or escaping', async (t) => {
  const { workspaceRoot } = await seeded(t)
  const tools = new Map(visualReviewTools(createReviewOperations()).map((tool) => [tool.name, tool]))
  await assert.rejects(tools.get('visual_review_read_document')!.execute({ workspaceRoot, documentId: 'missing' }), /does not exist/)
  await assert.rejects(tools.get('visual_review_read_image')!.execute({ workspaceRoot, path: '../outside.png' }))
})

test('review creation rejects symlinked storage outside its caller workspace', async (t) => {
  const { workspaceRoot } = await seeded(t)
  const outside = join(workspaceRoot, '..', 'outside')
  await mkdir(outside)
  await symlink(outside, join(workspaceRoot, '.sciforge'), process.platform === 'win32' ? 'junction' : 'dir')
  const tool = visualReviewTools(createReviewOperations()).find(({ name }) => name === 'visual_review_open')!
  await assert.rejects(tool.execute({ workspaceRoot, documentId: 'escape' }), /within the selected workspace/)
})
