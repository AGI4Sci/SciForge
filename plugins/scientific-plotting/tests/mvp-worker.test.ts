import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { dispatch } from '../src/figure-store/worker.js'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'
import type { FigureDocument, FigureOperationResult } from '../src/figure-store/index.js'

async function fixture(t: TestContext) {
  const tempRoot = await realpath(tmpdir())
  const root = await mkdtemp(join(tempRoot, 'scientific-figure-worker-test-'))
  const canonical = await realpath(root)
  t.after(async () => {
    // Verify the absolute cleanup target is exactly this test's generated directory.
    assert.equal(await realpath(root), canonical)
    assert.equal(resolve(root), canonical)
    assert.ok(root.startsWith(join(tempRoot, 'scientific-figure-worker-test-')))
    await rm(root, { recursive: true, force: true })
  })
  const png = (color: string) => {
    const canvas = createCanvas(3, 2)
    const context = canvas.getContext('2d')
    context.fillStyle = color
    context.fillRect(0, 0, 3, 2)
    return canvas.toBuffer('image/png')
  }
  const originalBytes = png('red')
  const candidateBytes = png('blue')
  await mkdir(join(root, 'inputs'))
  await writeFile(join(root, 'inputs', 'original.PNG'), originalBytes)
  await writeFile(join(root, 'inputs', 'candidate.png'), candidateBytes)
  const call = (action: string, input: Record<string, unknown> = {}, envelope: Partial<Parameters<typeof dispatch>[0]> = {}) => dispatch({ action, input, workspaceRoot: root, ...envelope })
  const read = async () => await call('read', { documentId: 'figure' }) as FigureDocument
  const importInput = { documentId: 'figure', operationId: 'import', expectedDocumentRevision: 0, path: 'inputs/original.PNG' }
  const imported = await call('importOriginal', importInput) as FigureOperationResult
  const add = async (operationId = 'generate', path = 'inputs/candidate.png') => {
    const doc = await read()
    const baseline = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!.metadata
    const input = { documentId: 'figure', operationId, expectedDocumentRevision: doc.documentRevision, path, baselineRevisionId: baseline.revisionId, baselineHash: baseline.image.sha256 }
    const result = await call('addCandidate', input) as FigureOperationResult
    return { input, result }
  }
  return { root, call, read, importInput, imported, add, originalBytes, candidateBytes }
}

test('actual dispatch imports exact snapshot, saves normalized annotations, and retains original receipts', async t => {
  const f = await fixture(t)
  const original = (await f.read()).revisions[0].metadata
  assert.equal(original.originalFilename, 'original.PNG')
  assert.equal(original.format, 'png')
  assert.equal(original.image.byteLength, f.originalBytes.length)
  assert.equal(original.image.sha256, createHash('sha256').update(f.originalBytes).digest('hex'))
  assert.deepEqual(await readFile(join(f.root, '.scientific-figures', original.image.path)), f.originalBytes)
  assert.equal(original.generation, undefined)
  const annotation = { id: 'a1', kind: 'box', geometry: { kind: 'box', bounds: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } }, instruction: 'Increase label contrast', targetNodeIds: [], status: 'open', createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' }
  const input = { documentId: 'figure', operationId: 'annotate', expectedDocumentRevision: 1, annotations: [annotation] }
  const saved = await f.call('saveAnnotations', input)
  assert.deepEqual((await f.read()).annotations, [annotation])
  assert.deepEqual(await f.call('saveAnnotations', input), saved)
  assert.deepEqual(await f.call('importOriginal', f.importInput), f.imported)
  await assert.rejects(f.call('saveAnnotations', { ...input, annotations: [{ ...annotation, instruction: 'Changed instruction' }] }), /different input/)
  await assert.rejects(f.call('saveAnnotations', { ...input, operationId: 'stale' }), /Stale document/)
  await assert.rejects(f.call('importOriginal', { ...f.importInput, path: join(f.root, 'inputs/original.PNG') }), /workspace-relative/)
  await writeFile(join(f.root, 'inputs/original.PNG'), f.candidateBytes)
  await assert.rejects(f.call('importOriginal', f.importInput), /different input/)
  assert.deepEqual(await f.call('list'), [{ documentId: 'figure', path: 'documents/figure/document.json' }])
})

test('actual dispatch cancellation and trusted acceptance preserve exact retry receipts', async t => {
  const f = await fixture(t)
  const added = await f.add()
  const input = { documentId: 'figure', operationId: 'cancel-confirmation', expectedDocumentRevision: 2, revisionId: added.result.revisionId }
  const preflight = await f.call('preflightAccept', input) as Record<string, unknown>
  const cancelled = await f.call('acceptCandidate', input, { preflight, approvalGranted: false }) as FigureOperationResult
  assert.equal(cancelled.status, 'cancelled')
  let doc = await f.read()
  assert.equal(doc.currentRevisionId, f.imported.revisionId)
  assert.equal(doc.revisions[1].status, 'candidate')
  assert.deepEqual(await f.call('preflightAccept', input), { alreadyCompleted: cancelled })
  const acceptInput = { ...input, operationId: 'native-accept', expectedDocumentRevision: 3 }
  const acceptPreflight = await f.call('preflightAccept', acceptInput) as Record<string, unknown>
  const accepted = await f.call('acceptCandidate', acceptInput, { preflight: acceptPreflight, approvalGranted: true, confirmationId: 'trusted-native-receipt' }) as FigureOperationResult
  assert.equal(accepted.status, 'accepted')
  doc = await f.read()
  assert.equal(doc.currentRevisionId, added.result.revisionId)
  assert.equal(doc.originalRevisionId, f.imported.revisionId)
  assert.equal(doc.acceptances[0].confirmationId, 'trusted-native-receipt')
  assert.deepEqual(await f.call('preflightAccept', acceptInput), { alreadyCompleted: accepted })
  assert.deepEqual(await f.call('addCandidate', added.input), added.result)
  await assert.rejects(f.call('preflightAccept', { ...acceptInput, revisionId: f.imported.revisionId }), /different input/)
  const displayed = await f.call('image', { documentId: 'figure', revisionId: added.result.revisionId }) as { src: string; width: number; height: number }
  assert.equal(displayed.src, `data:image/png;base64,${f.candidateBytes.toString('base64')}`)
  assert.equal(displayed.width, 3)
  assert.equal(displayed.height, 2)
})

test('actual dispatch stale confirmation and stale candidate fail without pointer changes', async t => {
  const f = await fixture(t)
  const added = await f.add()
  const input = { documentId: 'figure', operationId: 'accept', expectedDocumentRevision: 2, revisionId: added.result.revisionId }
  const preflight = await f.call('preflightAccept', input) as Record<string, unknown>
  const second = await f.add('second-candidate')
  await assert.rejects(f.call('acceptCandidate', input, { preflight, approvalGranted: true }), /changed during confirmation/)
  assert.equal((await f.read()).currentRevisionId, f.imported.revisionId)
  const refreshed = { ...input, expectedDocumentRevision: 3 }
  const updatedPreflight = await f.call('preflightAccept', refreshed) as Record<string, unknown>
  await f.call('acceptCandidate', refreshed, { preflight: updatedPreflight, approvalGranted: true })
  await assert.rejects(f.call('preflightAccept', { ...input, operationId: 'accept-second', expectedDocumentRevision: 4, revisionId: second.result.revisionId }), /Stale candidate baseline/)
  assert.equal((await f.read()).currentRevisionId, added.result.revisionId)
})

test('actual dispatch verifies rejected images and immutable metadata without fallback', async t => {
  const f = await fixture(t)
  const added = await f.add()
  await f.call('rejectCandidate', { documentId: 'figure', operationId: 'reject', expectedDocumentRevision: 2, revisionId: added.result.revisionId })
  const doc = await f.read()
  assert.equal(doc.currentRevisionId, f.imported.revisionId)
  const rejected = doc.revisions[1].metadata
  await writeFile(join(f.root, '.scientific-figures', rejected.image.path), Buffer.from('corrupt'))
  await assert.rejects(f.call('read', { documentId: 'figure' }), /corrupt/)
  await assert.rejects(f.call('image', { documentId: 'figure', revisionId: f.imported.revisionId }), /corrupt/)
  await writeFile(join(f.root, '.scientific-figures', rejected.image.path), f.candidateBytes)
  await writeFile(join(f.root, '.scientific-figures/documents/figure/revisions', `${rejected.revisionId}.json`), '{}')
  await assert.rejects(f.call('read', { documentId: 'figure' }))
})

test('confined file adapter refuses directory/file symlinks and preserves exclusive immutable bytes', async t => {
  const f = await fixture(t)
  const files = new ConfinedFigureFiles()
  await files.writeImmutable(f.root, 'snapshots/image.png', f.originalBytes)
  await assert.rejects(files.writeImmutable(f.root, 'snapshots/image.png', f.candidateBytes), /EEXIST/)
  assert.deepEqual(await files.read(f.root, 'snapshots/image.png'), f.originalBytes)
  await symlink(join(f.root, 'inputs'), join(f.root, 'input-link'), 'dir')
  await assert.rejects(files.read(f.root, 'input-link/original.PNG'), /Symlink/)
  await assert.rejects(files.writeAtomic(f.root, 'input-link/replaced.png', f.candidateBytes), /Symlink/)
  await symlink(join(f.root, 'inputs/original.PNG'), join(f.root, 'linked.PNG'))
  await assert.rejects(f.call('importOriginal', { ...f.importInput, documentId: 'another', operationId: 'symlink-import', path: 'linked.PNG' }), /Symlink/)
  await assert.rejects(files.read(f.root, '../outside.png'), /Unsafe relative/)
  await assert.rejects(files.read(f.root, join(f.root, 'inputs/original.PNG')), /Unsafe relative/)
  await assert.rejects(files.withLock(f.root, 'figure', async () => files.withLock(f.root, 'figure', async () => undefined)), /busy/)
  // Lock cleanup after callback failure permits a subsequent operation.
  await files.withLock(f.root, 'figure', async () => undefined)
})
