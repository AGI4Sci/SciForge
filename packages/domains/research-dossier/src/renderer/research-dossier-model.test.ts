import assert from 'node:assert/strict'
import test from 'node:test'

import {
  artifactHistoryInput,
  comparisonTargetVersionId,
  type ResearchDossierExactRecord,
  decodeComputeRunSpec,
  exactRecordDigest,
  fiveAxisStatus,
  mergeArtifactHistory,
  previewDestination,
  researchDossierPreviewTarget
} from './research-dossier-model.js'

test('uses bounded artifact-scoped pagination instead of a broad history scan', () => {
  assert.deepEqual(artifactHistoryInput('artifact:figure'), {
    artifactId: 'artifact:figure',
    limit: 25
  })
  assert.deepEqual(artifactHistoryInput('artifact:figure', 101), {
    artifactId: 'artifact:figure',
    limit: 25,
    beforeSequence: 101
  })
  const item = (versionId: string) => ({ version: { versionId } }) as never
  assert.deepEqual(mergeArtifactHistory({
    items: [item('artifact-version:1')],
    nextBeforeSequence: 1
  }, {
    items: [item('artifact-version:1'), item('artifact-version:0')]
  }).items.map((entry) => entry.version.versionId), [
    'artifact-version:1',
    'artifact-version:0'
  ])
})

test('keeps execution, provenance, control, replication, and evidence orthogonal', () => {
  assert.deepEqual(fiveAxisStatus({
    kind: 'compute-run',
    run: {
      outcome: 'succeeded',
      provenance: 'incomplete',
      control: 'isolated-attested',
      replication: 'fails-to-replicate',
      evidence: 'pending'
    }
  } as never), {
    execution: 'succeeded',
    provenance: 'incomplete',
    control: 'isolated-attested',
    replication: 'fails-to-replicate',
    evidence: 'pending'
  })
})

test('builds an integrity-bound preview with an exact dossier return target', () => {
  const previewRef = {
    versionId: 'artifact-version:figure:2',
    contentDigest: 'b'.repeat(64),
    mediaType: 'image/svg+xml'
  } as never
  assert.deepEqual(researchDossierPreviewTarget({
    destinationPath: '.sciforge/research-dossier/previews/figure.png',
    previewRef,
    recordDigest: `sha256:${'c'.repeat(64)}`,
    sessionId: 'session-1',
    surfaceId: 'surface-dossier-a',
    workspaceRoot: '/workspace/lab',
    target: { kind: 'compute-run', runId: 'compute-run:plot-2' },
    page: 'reproduction',
    revision: 8,
    label: 'Research dossier'
  }), {
    path: '.sciforge/research-dossier/previews/figure.png',
    sessionId: 'session-1',
    surfaceId: 'surface-dossier-a',
    workspaceRoot: '/workspace/lab',
    mimeType: 'image/svg+xml',
    kind: 'file',
    integrity: { algorithm: 'sha256', expectedDigest: `sha256:${'b'.repeat(64)}` },
    returnTo: {
      contributionId: 'research-dossier.workbench-right-panel',
      label: 'Research dossier',
      activation: {
        contributionId: 'research-dossier.workbench-right-panel',
        revision: 8,
        payload: {
          contractVersion: 1,
          target: { kind: 'compute-run', runId: 'compute-run:plot-2' },
          page: 'reproduction',
          expectedDigest: `sha256:${'c'.repeat(64)}`
        }
      }
    }
  })
})

test('fails closed when exact RunSpec bytes are not valid contract JSON', () => {
  const invalid = decodeComputeRunSpec({
    dataBase64: btoa(JSON.stringify({ runId: 'compute-run:post-hoc' }))
  } as never)
  assert.equal(invalid.ok, false)
})

test('binds exact digest and safe preview path to the selected version', () => {
  const descriptor = {
    ref: {
      versionId: 'artifact-version:Figure A/2',
      contentDigest: 'a'.repeat(64),
      mediaType: 'image/png'
    }
  }
  assert.equal(exactRecordDigest({
    kind: 'artifact-version',
    descriptor,
    history: { items: [] }
  } as never), `sha256:${'a'.repeat(64)}`)
  assert.equal(previewDestination(descriptor.ref as never),
    `.sciforge/research-dossier/previews/artifact-version-figure-a-2-${'a'.repeat(12)}.png`)
})


test('exact artifact history forwards the owner cursor without combining numeric paging and retains continuation', () => {
  assert.deepEqual(artifactHistoryInput('artifact:one', 200, 'owner-cursor'), { artifactId: 'artifact:one', limit: 25, cursor: 'owner-cursor' })
  assert.equal(mergeArtifactHistory({ items: [] }, { items: [], nextBeforeSequence: 100, nextCursor: 'next-owner-cursor' }).nextCursor, 'next-owner-cursor')
})


test('comparison uses explicit same-artifact current identity or parent, never an arbitrary latest row', () => {
  type Record = Extract<ResearchDossierExactRecord, { kind: 'artifact-version' }>
  const item = (id: string, current = false, artifactId = 'artifact:a') => ({ artifact: { artifactId }, version: { artifactId, versionId: id }, ref: { artifactId, versionId: id }, isCurrent: current })
  const record = { kind: 'artifact-version', descriptor: item('old'), history: { items: [item('newest'), item('foreign', true, 'artifact:b')] } } as unknown as Record
  assert.equal(comparisonTargetVersionId(record), undefined)
  record.history.items.push(item('current', true) as never)
  assert.equal(comparisonTargetVersionId(record), 'current')
  record.history.items.push(item('conflicting', true) as never)
  assert.equal(comparisonTargetVersionId(record), undefined)
  record.descriptor.artifact.currentVersionId = 'explicit-current'
  assert.equal(comparisonTargetVersionId(record), 'explicit-current')
  record.descriptor.isCurrent = true
  assert.equal(comparisonTargetVersionId(record), undefined)
  record.descriptor.version.parentVersionId = 'parent'
  assert.equal(comparisonTargetVersionId(record), 'parent')
  record.descriptor.ref.artifactId = 'artifact:other'
  assert.equal(comparisonTargetVersionId(record), undefined)
})

test('registered source suffix selects the installed file viewer without using a mutable source path for bytes', () => {
  const reference = { versionId: 'artifact-version:observed:1', contentDigest: 'a'.repeat(64) } as never
  assert.match(previewDestination(reference, 'data/results.CSV'), /-aaaaaaaaaaaa\.csv$/u)
  assert.match(previewDestination(reference, 'models/molecule.sdf'), /\.sdf$/u)
  assert.match(previewDestination(reference, '../../outside/results.csv'), /^\.sciforge\/research-dossier\/previews\/artifact-version-observed-1-aaaaaaaaaaaa\.csv$/u)
  assert.match(previewDestination(reference, 'file.bad?query'), /\.bin$/u)
})
