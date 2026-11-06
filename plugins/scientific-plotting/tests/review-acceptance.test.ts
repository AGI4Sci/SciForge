import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ArtifactVersionCommitInputV1, ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import { ArtifactVersionService } from '../../../packages/domains/artifact-versions/src/main/service.js'
import { VISUAL_REVIEW_CAPABILITY_IDS } from '../src/review/contract.js'
import { createVisualReviewOperations, type VisualReviewArtifactPort } from '../src/review/operations.js'
import { createVisualReviewCapabilityFactory, createVisualReviewService } from '../src/review/main.js'
import { renderPng, reviewEvidence, sha256, tempRoot } from './review-fixtures.js'

const ACCESS = { audience: 'ui' as const, callerId: 'review-acceptance-test' }

async function setup(t: { after: (callback: () => Promise<void>) => void }, kind: 'scientific_plot' | 'image' = 'scientific_plot', accessPolicy?: ArtifactVersionRefV1['accessPolicy']) {
  const root = await tempRoot('review-immutable-acceptance-')
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  const source = await renderPng(96, 64)
  const candidate = await renderPng(128, 80)
  // These are real immutable plot-version bytes, not a writable export copy.
  const sourcePath = join(workspaceRoot, 'plot', 'versions', 'original', 'figure.png')
  const manifestPath = join(workspaceRoot, 'plot', 'versions', 'original', 'manifest.json')
  await mkdir(join(workspaceRoot, 'plot', 'versions', 'original'), { recursive: true })
  await writeFile(sourcePath, source)
  const manifestBytes = Buffer.from(JSON.stringify({ sourceHash: sha256(source), recipe: { data: [1, 2, 3], renderer: 'original' } }))
  await writeFile(manifestPath, manifestBytes)
  await writeFile(join(workspaceRoot, 'candidate.png'), candidate)
  const versions = new ArtifactVersionService({ userDataDir: join(root, 'user-data') })
  const commits: ArtifactVersionCommitInputV1[] = []
  const port: VisualReviewArtifactPort = {
    commit: async (input, workspace) => {
      commits.push(input)
      return versions.commit(workspace, input, ACCESS)
    },
    read: (input, workspace) => versions.read(workspace, input, ACCESS)
  }
  const initial = await versions.commit(workspaceRoot, {
    idempotencyKey: 'original-source', candidates: [{
      candidateId: 'original', expectedCurrentVersionId: null,
      kind: kind === 'scientific_plot' ? 'scientific-plot' : 'figure', intent: 'save',
      content: { mode: 'snapshot', dataBase64: source.toString('base64'), mediaType: 'image/png' },
      ...(accessPolicy ? { accessPolicy } : {})
    }]
  }, ACCESS)
  assert.ok(initial.ok)
  const originalRef = initial.value.versions[0]!.ref
  const operations = createVisualReviewOperations({ artifacts: port })
  const invoke = (id: string, input: object) => operations.invoke(id, { documentId: 'figure', ...input }, workspaceRoot) as Promise<any>
  const opened = await invoke(VISUAL_REVIEW_CAPABILITY_IDS.open, {
    artifact: { kind, sourcePath, manifestPath, mimeType: 'image/png', versionRef: originalRef }
  })
  const created = await invoke(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate, {
    candidatePath: 'candidate.png', summary: 'Reviewed revised image',
    reviewEvidence: reviewEvidence('candidate.png', sha256(candidate))
  })
  const decision = { workspaceRoot, documentId: 'figure', revisionId: created.revision.id }
  return { workspaceRoot, source, candidate, sourcePath, manifestPath, manifestBytes, versions,
    originalRef, port, commits, invoke, opened, created, decision }
}

test('immutable source acceptance preserves original PNG and manifest, binds a new version and truthful local snapshot', async (t) => {
  const f = await setup(t)
  const accepted = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id })
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  assert.deepEqual(await readFile(f.manifestPath), f.manifestBytes)
  assert.equal(JSON.parse((await readFile(f.manifestPath)).toString()).sourceHash, sha256(await readFile(f.sourcePath)))
  assert.deepEqual(await readFile(accepted.document.artifact.workingCopyPath), f.candidate)
  assert.equal(accepted.document.artifact.sourcePath, f.created.revision.artifactPath)
  assert.equal(accepted.document.artifact.sourceHash, sha256(await readFile(accepted.document.artifact.sourcePath)))
  assert.equal(accepted.document.artifact.manifestPath, undefined, 'old recipe manifest is not provenance for new image')
  assert.equal(accepted.revision.versionRef.artifactId, f.originalRef.artifactId)
  assert.notEqual(accepted.revision.versionRef.versionId, f.originalRef.versionId)
  assert.deepEqual(accepted.document.artifact.versionRef, accepted.revision.versionRef)
  assert.deepEqual(await readFile(accepted.revision.backupPath), f.source)
  const oldVersion = await f.versions.read(f.workspaceRoot, { versionId: f.originalRef.versionId }, ACCESS)
  const newVersion = await f.versions.read(f.workspaceRoot, { versionId: accepted.revision.versionRef.versionId }, ACCESS)
  assert.ok(oldVersion.ok)
  assert.ok(newVersion.ok)
  assert.equal(oldVersion.value.dataBase64, f.source.toString('base64'))
  assert.equal(newVersion.value.dataBase64, f.candidate.toString('base64'))
  assert.equal(newVersion.value.artifact.currentVersionId, accepted.revision.versionRef.versionId)
  assert.equal(f.commits[0]!.candidates[0]!.expectedCurrentVersionId, f.originalRef.versionId)
  assert.deepEqual(f.commits[0]!.candidates[0]!.dependencies, [{ role: 'reviewed-from', required: true, target: { kind: 'version', ref: f.originalRef } }])
  assert.equal('recipe' in newVersion.value.version.metadata, false)
  await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id })
  assert.equal(f.commits.length, 1, 'completed replay must not commit twice')
  const receiptPath = join(f.opened.paths.documentDir, 'acceptance-outbox', `${f.created.revision.id}.json`)
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert.equal(receipt.sourcePath, f.opened.document.artifact.sourcePath)
  assert.deepEqual(receipt.sourceVersionRef, f.originalRef)
  assert.equal(receipt.state, 'completed')
  await writeFile(f.sourcePath, f.candidate)
  await assert.rejects(f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id }), /missing or corrupt/)
})

test('acceptance inherits visibility, principals and export policy from the bound version', async (t) => {
  for (const accessPolicy of [
    { visibility: 'restricted' as const, principals: [ACCESS.callerId, 'collaborator'], allowExport: false },
    { visibility: 'public' as const, principals: ['attributed-owner'], allowExport: false },
    { visibility: 'workspace' as const, principals: ['review-team'], allowExport: true }
  ]) {
    const f = await setup(t, 'scientific_plot', accessPolicy)
    const accepted = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id })
    assert.deepEqual(f.commits[0]!.candidates[0]!.accessPolicy, accessPolicy)
    assert.deepEqual(accepted.revision.versionRef.accessPolicy, accessPolicy)
    const stored = await f.versions.read(f.workspaceRoot, { versionId: accepted.revision.versionRef.versionId }, ACCESS)
    assert.ok(stored.ok)
    assert.deepEqual(stored.value.version.accessPolicy, accessPolicy)
    if (accessPolicy.visibility === 'restricted') {
      const denied = await f.versions.read(f.workspaceRoot, { versionId: accepted.revision.versionRef.versionId },
        { audience: 'ui', callerId: 'unrelated-reader' })
      assert.equal(denied.ok, false, 'accepting a revision must not expose restricted bytes to another principal')
    }
  }
})

test('prepared retry after a successful commit with a lost reply preserves the exact inherited policy', async (t) => {
  const policy = { visibility: 'restricted' as const, principals: [ACCESS.callerId], allowExport: false }
  const f = await setup(t, 'scientific_plot', policy)
  let interrupt = true
  const operations = createVisualReviewOperations({ artifacts: { ...f.port, commit: async (input, workspace) => {
    const result = await f.port.commit(input, workspace)
    if (interrupt) { interrupt = false; throw new Error('Interrupted after durable version commit') }
    return result
  } } })
  const accept = () => operations.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
    { documentId: 'figure', revisionId: f.created.revision.id }, f.workspaceRoot) as Promise<any>
  await assert.rejects(accept(), /Interrupted after durable/)
  const accepted = await accept()
  assert.equal(accepted.status, 'accepted')
  assert.equal(f.commits.length, 2)
  assert.deepEqual(f.commits[1], f.commits[0], 'idempotent replay must use the same complete commit input')
  assert.deepEqual(accepted.revision.versionRef.accessPolicy, policy)
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  await accept()
  assert.equal(f.commits.length, 2)
})

test('versionRef, not source location or visual kind, selects immutable acceptance', async (t) => {
  const f = await setup(t, 'image')
  const accepted = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id })
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  assert.deepEqual(await readFile(accepted.document.artifact.workingCopyPath), f.candidate)
  assert.notEqual(accepted.document.artifact.sourcePath, f.sourcePath)
})

test('a plain writable image keeps user-approved source replacement and removes stale manifest association', async (t) => {
  const f = await setup(t)
  const plain = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.open, {
    documentId: 'plain', artifact: { kind: 'image', sourcePath: f.sourcePath, manifestPath: f.manifestPath }
  })
  const candidate = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate, {
    documentId: 'plain', candidatePath: 'candidate.png', summary: 'Writable image revision',
    reviewEvidence: reviewEvidence('candidate.png', sha256(f.candidate))
  })
  const accepted = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { documentId: 'plain', revisionId: candidate.revision.id })
  assert.equal(accepted.document.artifact.sourcePath, plain.document.artifact.sourcePath)
  assert.deepEqual(await readFile(f.sourcePath), f.candidate)
  assert.deepEqual(await readFile(accepted.revision.backupPath), f.source)
  assert.deepEqual(await readFile(f.manifestPath), f.manifestBytes)
  assert.equal(accepted.document.artifact.manifestPath, undefined)
  assert.deepEqual(accepted.revision.versionRef.accessPolicy, { visibility: 'workspace', principals: [], allowExport: true })
})

test('committed receipt recovers workcopy replacement without a second commit or immutable-source write', async (t) => {
  const policy = { visibility: 'restricted' as const, principals: [ACCESS.callerId], allowExport: false }
  const f = await setup(t, 'scientific_plot', policy)
  const service = createVisualReviewService()
  const definitions = createVisualReviewCapabilityFactory({
    defineCapability: (definition) => definition,
    commitArtifactVersion: f.port.commit, readArtifactVersion: f.port.read,
    getService: () => service
  }).createDefinitions()
  // Prepare a committed receipt and partial workcopy replacement, the durable
  // state left by interruption between cross-service commit and document write.
  const preflight = await service.preflightAcceptCandidate(f.decision)
  const committed = await f.port.commit({
    idempotencyKey: `visual-review:figure:${f.created.revision.id}:accept`, candidates: [{
      candidateId: `visual-review:${f.created.revision.id}`, artifactId: f.originalRef.artifactId,
      expectedCurrentVersionId: f.originalRef.versionId, kind: 'scientific-plot', intent: 'save',
      content: { mode: 'snapshot', dataBase64: f.candidate.toString('base64'), mediaType: 'image/png' },
      accessPolicy: policy
    }]
  }, f.workspaceRoot)
  assert.ok(committed.ok)
  const receiptPath = join(preflight.paths.documentDir, 'acceptance-outbox', `${f.created.revision.id}.json`)
  const prepared = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(receiptPath, JSON.stringify({ ...prepared, state: 'version-committed', artifactVersionRef: committed.value.versions[0]!.ref }))
  await writeFile(f.opened.document.artifact.workingCopyPath, f.candidate)
  const accept = definitions.find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)!
  const accepted = (await accept.handler({ documentId: 'figure', revisionId: f.created.revision.id }, { caller: { workspaceId: f.workspaceRoot } })).output as any
  assert.equal(accepted.status, 'accepted')
  assert.equal(f.commits.length, 1)
  assert.deepEqual(accepted.revision.versionRef.accessPolicy, policy)
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  assert.deepEqual(await readFile(f.manifestPath), f.manifestBytes)
  assert.deepEqual(await readFile(accepted.document.artifact.workingCopyPath), f.candidate)
})

test('preflight rejects source mutation and foreign exact paths before version commit', async (t) => {
  const f = await setup(t)
  await writeFile(f.sourcePath, f.candidate)
  await assert.rejects(f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id }), /bound immutable|changed outside/)
  assert.equal(f.commits.length, 0)
  await writeFile(f.sourcePath, f.source)
  const document = JSON.parse(await readFile(f.opened.paths.documentPath, 'utf8'))
  document.artifact.sourcePath = join(f.workspaceRoot, '..', 'outside.png')
  await writeFile(document.artifact.sourcePath, f.source)
  await writeFile(f.opened.paths.documentPath, JSON.stringify(document))
  await assert.rejects(f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id }), /outside|workspace/)
  assert.equal(f.commits.length, 0)
})

test('prepared immutable acceptance rejects corrupted backups and source/workcopy aliasing', async (t) => {
  const f = await setup(t)
  const service = createVisualReviewService()
  const preflight = await service.preflightAcceptCandidate(f.decision)
  const receiptPath = join(preflight.paths.documentDir, 'acceptance-outbox', `${f.created.revision.id}.json`)
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(receipt.backupPath, f.candidate)
  await assert.rejects(f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id }), /backup is missing or corrupt/)
  assert.equal(f.commits.length, 0)
  await writeFile(receipt.backupPath, f.source)
  const document = JSON.parse(await readFile(f.opened.paths.documentPath, 'utf8'))
  document.artifact.workingCopyPath = document.artifact.sourcePath
  await writeFile(f.opened.paths.documentPath, JSON.stringify(document))
  await assert.rejects(f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate, { revisionId: f.created.revision.id }), /distinct files/)
  assert.equal(f.commits.length, 0)
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  assert.deepEqual(await readFile(f.manifestPath), f.manifestBytes)
})

test('CAS races leave immutable bytes, manifests and workcopy unchanged and permit rejection', async (t) => {
  const f = await setup(t)
  const raced: VisualReviewArtifactPort = { ...f.port, commit: async (input, workspaceRoot) => {
    const concurrent = await f.versions.commit(workspaceRoot, {
      idempotencyKey: 'concurrent-writer', candidates: [{
        candidateId: 'concurrent', artifactId: f.originalRef.artifactId,
        expectedCurrentVersionId: f.originalRef.versionId, kind: 'scientific-plot', intent: 'save',
        content: { mode: 'snapshot', dataBase64: f.source.toString('base64'), mediaType: 'image/png' }
      }]
    }, ACCESS)
    assert.ok(concurrent.ok)
    return f.port.commit(input, workspaceRoot)
  } }
  const operations = createVisualReviewOperations({ artifacts: raced })
  await assert.rejects(operations.invoke(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
    { documentId: 'figure', revisionId: f.created.revision.id }, f.workspaceRoot), /commit failed/)
  assert.deepEqual(await readFile(f.sourcePath), f.source)
  assert.deepEqual(await readFile(f.manifestPath), f.manifestBytes)
  assert.deepEqual(await readFile(f.opened.document.artifact.workingCopyPath), f.source)
  const rejected = await f.invoke(VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate, { revisionId: f.created.revision.id })
  assert.equal(rejected.status, 'rejected')
})
