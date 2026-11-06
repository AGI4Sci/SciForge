import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { actor, commitPlot, fixture } from './figure-binding-fixture.js'
import { loadScientificPlotProvenance } from '../src/renderer/scientific-plot-provenance.js'
import type { ScientificPlottingCapabilityClient } from '../src/renderer/scientific-plotting-capability-client.js'

test('exact old figure reads fixed code/data outside the history window, even with equal image bytes', async () => {
  const context = await fixture()
  const old = await commitPlot(context, 1)
  const latest = await commitPlot(context, 2, old.figure)
  assert.equal(old.figure.contentDigest, latest.figure.contentDigest)
  assert.notEqual(old.figure.versionId, latest.figure.versionId)
  await mkdir(join(context.workspace, '图表'), { recursive: true })
  await writeFile(join(context.workspace, '图表', '同名 figure.png'), 'overwritten working copy')
  await writeFile(join(context.workspace, '图表', 'renderer.py'), latest.rawCode)
  for (let batch = 0; batch < 5; batch += 1) {
  const filler = await context.service.commit(context.workspace, { idempotencyKey: 'older-than-window-' + batch, candidates: Array.from({ length: 102 }, (_, index) => ({ candidateId: 'noise-' + index, expectedCurrentVersionId: null, kind: 'test-data', intent: 'save' as const, content: { mode: 'snapshot' as const, dataBase64: 'eA==', mediaType: 'text/plain' } })) }, actor)
  assert.equal(filler.ok, true)
  }
  const client: ScientificPlottingCapabilityClient = {
    describeArtifactVersion: (root, input) => context.service.describe(root, input, actor),
    listArtifactVersions: (root, input) => context.service.listV1(root, input ?? {}, actor),
    readArtifactVersion: (root, input) => context.service.read(root, input, actor),
    materializeArtifactVersion: (root, input) => context.service.materialize(root, input, actor),
    rerun: async () => { throw new Error('No execution in read regression') },
    compare: async () => { throw new Error('No comparison in read regression') }
  }
  const records = await loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: old.figure.versionId, preferredResourceDigest: 'sha256:' + old.figure.contentDigest })
  assert.deepEqual(records.issues, [])
  assert.equal(records.records.length, 1)
  assert.deepEqual(records.records[0].codeRef, old.code)
  assert.deepEqual(records.records[0].derivedDataRef, old.data)
  assert.equal(records.records[0].currentFigureVersionId, latest.figure.versionId)
  const code = await context.service.read(context.workspace, { versionId: old.code.versionId, expectedRef: old.code }, actor)
  assert.ok(code.ok)
  assert.equal(Buffer.from(code.value.dataBase64, 'base64').toString(), old.rawCode)
  const data = await context.service.read(context.workspace, { versionId: old.data.versionId, expectedRef: old.data }, actor)
  assert.ok(data.ok)
  assert.equal(Buffer.from(data.value.dataBase64, 'base64').toString(), old.rawData)
  const directManifest = await loadScientificPlotProvenance(client, context.workspace, { preferredManifestVersionId: old.manifest.versionId, preferredResourceDigest: 'sha256:' + old.manifest.contentDigest })
  assert.equal(directManifest.records[0].figureRef?.versionId, old.figure.versionId)
  await assert.rejects(loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: old.figure.versionId, preferredResourceDigest: 'sha256:' + '0'.repeat(64) }), /digest does not match/)
  await assert.rejects(loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: 'artifact-version:absent' }), /not found/i)
  const mismatch = await context.service.read(context.workspace, { versionId: latest.figure.versionId, expectedRef: old.figure }, actor)
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) assert.equal(mismatch.issue.code, 'content-mismatch')
  const badReverse = await context.service.listV1(context.workspace, { dependencyTarget: { ...old.figure, byteLength: 0 } }, actor)
  assert.equal(badReverse.ok, false)
  const reverse = await context.service.listV1(context.workspace, { dependencyTarget: old.figure, limit: 1 }, actor)
  assert.ok(reverse.ok)
  assert.equal(reverse.value.items.length, 1)
  assert.ok(reverse.value.nextBeforeSequence)
  const next = await context.service.listV1(context.workspace, { dependencyTarget: old.figure, limit: 1, beforeSequence: reverse.value.nextBeforeSequence }, actor)
  assert.ok(next.ok)
  assert.equal(next.value.items[0].ref.versionId, old.manifest.versionId)
  const incomplete = await loadScientificPlotProvenance({ ...client, listArtifactVersions: async () => ({ ok: true, value: { items: [] } }) }, context.workspace, { preferredManifestVersionId: old.manifest.versionId })
  assert.equal(incomplete.records[0].codeRef?.versionId, old.code.versionId)
  assert.match(incomplete.issues.join(' '), /render log/)
  await assert.rejects(loadScientificPlotProvenance({ ...client, listArtifactVersions: async () => ({ ok: true, value: { items: [] } }) }, context.workspace, { preferredFigureVersionId: old.figure.versionId }), /no accessible render manifest/)
  const manifestBytes = await context.service.read(context.workspace, { versionId: old.manifest.versionId, expectedRef: old.manifest }, actor)
  assert.ok(manifestBytes.ok)
  const duplicate = await context.service.commit(context.workspace, { idempotencyKey: 'ambiguous-manifest', candidates: [{ candidateId: 'duplicate', expectedCurrentVersionId: null, kind: 'scientific-plot-render-manifest', intent: 'save', content: { mode: 'snapshot', dataBase64: manifestBytes.value.dataBase64, mediaType: 'application/json' }, dependencies: manifestBytes.value.version.dependencies.map(dependency => ({ role: dependency.role, target: { kind: 'version' as const, ref: dependency.target } })) }] }, actor)
  assert.ok(duplicate.ok)
  await assert.rejects(loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: old.figure.versionId }), /Multiple exact manifests/)
  const imported = await context.service.commit(context.workspace, { idempotencyKey: 'untracked-image', candidates: [{ candidateId: 'image', expectedCurrentVersionId: null, kind: 'imported-image', intent: 'save', content: { mode: 'snapshot', dataBase64: 'eA==', mediaType: 'image/png' } }] }, actor)
  assert.ok(imported.ok)
  await assert.rejects(loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: imported.value.versions[0].ref.versionId }), /no registered Scientific Plot source binding/)
  await context.dispose()

})

test('authorization is checked before exact-ref comparisons and reverse dependency lookup', async () => {
  const context = await fixture()
  const committed = await context.service.commit(context.workspace, { idempotencyKey: 'restricted-figure', candidates: [{ candidateId: 'private', kind: 'scientific-plot', expectedCurrentVersionId: null, intent: 'save', content: { mode: 'snapshot', dataBase64: 'eA==', mediaType: 'image/png' }, accessPolicy: { visibility: 'restricted', principals: [actor.callerId], allowExport: false } }] }, actor)
  assert.ok(committed.ok)
  const ref = committed.value.versions[0].ref
  const denied = { audience: 'ui' as const, callerId: 'someone-else' }
  for (const result of [await context.service.describe(context.workspace, { versionId: ref.versionId }, denied), await context.service.read(context.workspace, { versionId: ref.versionId, expectedRef: ref }, denied), await context.service.listV1(context.workspace, { dependencyTarget: ref }, denied)]) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.issue.code, 'access-restricted')
  }
  await context.dispose()
})


test('large dependencies use metadata until explicit content reads; mismatches and denial remain closed', async () => {
  const context = await fixture()
  try {
    const plot = await commitPlot(context, 9, undefined, 8 * 1024 * 1024)
    const reads: string[] = []
    const client: ScientificPlottingCapabilityClient = {
      describeArtifactVersion: (root, input) => context.service.describe(root, input),
      listArtifactVersions: (root, input) => context.service.listV1(root, input ?? {}),
      readArtifactVersion: (root, input) => { reads.push(input.versionId); return context.service.read(root, input) },
      materializeArtifactVersion: (root, input) => context.service.materialize(root, input),
      rerun: async () => { throw new Error('No execution') },
      compare: async () => { throw new Error('No comparison') }
    }
    const result = await loadScientificPlotProvenance(client, context.workspace, { preferredFigureVersionId: plot.figure.versionId })
    assert.deepEqual(result.issues, [])
    assert.deepEqual(reads, [plot.manifest.versionId])
    assert.equal(result.records[0].derivedDataRef?.byteLength, plot.data.byteLength)
    assert.equal(JSON.stringify(result.records).includes('dataBase64'), false)
    const code = await client.readArtifactVersion(context.workspace, { versionId: plot.code.versionId, expectedRef: plot.code })
    assert.ok(code.ok)
    assert.equal(Buffer.from(code.value.dataBase64, 'base64').toString(), plot.rawCode)
    const data = await client.readArtifactVersion(context.workspace, { versionId: plot.data.versionId, expectedRef: plot.data, maxBytes: 4 * 1024 * 1024 })
    assert.equal(data.ok, false, 'Explicit inspection preserves the content size limit')
    if (!data.ok) assert.match(data.issue.message, /limit|large|bytes/i)
    const mismatch = await loadScientificPlotProvenance({ ...client, describeArtifactVersion: async (root, input) => {
      const described = await client.describeArtifactVersion(root, input)
      return described.ok && input.versionId === plot.code.versionId
        ? { ok: true, value: { ...described.value, ref: { ...described.value.ref, byteLength: 0 } } } : described
    } }, context.workspace, { preferredFigureVersionId: plot.figure.versionId })
    assert.match(mismatch.issues.join(' '), /reference does not match/)
    assert.equal(mismatch.records[0].supportingVersions.find(item => item.ref.versionId === plot.code.versionId)?.status, 'unavailable')
    const denied = await loadScientificPlotProvenance({ ...client, describeArtifactVersion: async (root, input) => input.versionId === plot.data.versionId
      ? { ok: false, issue: { code: 'access-restricted', message: 'Data metadata access denied' } }
      : client.describeArtifactVersion(root, input)
    }, context.workspace, { preferredFigureVersionId: plot.figure.versionId })
    assert.match(denied.issues.join(' '), /Data metadata access denied/)
    assert.deepEqual(reads.slice(3), [plot.manifest.versionId, plot.manifest.versionId])
  } finally { await context.dispose() }
})
