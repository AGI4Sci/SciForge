import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadExactResearchDossier,
  loadResearchDossierBrowse
} from './research-dossier-loader.js'

const digest = 'a'.repeat(64)
const ref = {
  artifactId: 'artifact:figure',
  versionId: 'artifact-version:figure:2',
  contentDigest: digest,
  byteLength: 4,
  mediaType: 'image/png',
  availability: 'available',
  retention: 'snapshot',
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
}
const descriptor = {
  artifact: {
    artifactId: 'artifact:figure',
    kind: 'figure',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    currentVersionId: 'artifact-version:figure:2',
    versionCount: 2
  },
  version: {
    schemaVersion: 1,
    versionId: 'artifact-version:figure:2',
    artifactId: 'artifact:figure',
    sequence: 12,
    transactionId: 'artifact-commit:2',
    createdAt: '2026-08-02T00:00:00.000Z',
    intent: 'save',
    storage: { mode: 'snapshot', contentDigest: digest, byteLength: 4, mediaType: 'image/png' },
    dependencies: [],
    accessPolicy: ref.accessPolicy,
    metadata: {}
  },
  ref,
  artifactOrdinal: 2,
  isCurrent: true
}

function checkpointFixture() {
  const checkpointDigest = 'd'.repeat(64)
  const checkpointRef = {
    ...ref,
    artifactId: 'artifact:research-checkpoint',
    versionId: 'artifact-version:research-checkpoint:2',
    contentDigest: checkpointDigest,
    byteLength: 512,
    mediaType: 'application/vnd.sciforge.research-checkpoint+json'
  }
  const checkpointDescriptor = {
    artifact: {
      ...descriptor.artifact,
      artifactId: checkpointRef.artifactId,
      kind: 'research-checkpoint',
      label: 'Recorded study',
      currentVersionId: checkpointRef.versionId
    },
    version: {
      ...descriptor.version,
      versionId: checkpointRef.versionId,
      artifactId: checkpointRef.artifactId,
      storage: {
        mode: 'snapshot', contentDigest: checkpointDigest, byteLength: checkpointRef.byteLength,
        mediaType: checkpointRef.mediaType
      },
      metadata: {
        researchCheckpointContractVersion: 1,
        researchRecordingId: 'research-recording:study-1',
        runtimeId: 'codex', threadId: 'thread-study', turnId: 'turn-2',
        manifestDigest: checkpointDigest
      }
    },
    ref: checkpointRef,
    artifactOrdinal: 2,
    isCurrent: true
  }
  const checkpoint = {
    manifest: {
      contractVersion: 1,
      kind: 'sciforge.research-checkpoint-manifest.v1',
      recording: {
        recordingId: 'research-recording:study-1', origin: 'live', runtimeId: 'codex',
        threadId: 'thread-study', workspaceBindingDigest: 'e'.repeat(64)
      },
      turn: {
        turnId: 'turn-2', targetWatermark: '2:event', sequence: 2,
        occurredAt: '2026-08-11T02:00:00.000Z'
      },
      title: 'Recorded study', changeReason: 'Added exact result table.',
      narrative: { canonicalText: 'The treatment increased the response.', contentDigest: 'f'.repeat(64) },
      sources: [{ sourceId: 'source:web', uri: 'https://example.org/paper' }],
      declaredFiles: [], artifactDependencies: [], computeRuns: [],
      gitCheckpoints: [], untrackedOperations: [],
      breakpoints: [{ code: 'source-unpinned', blocking: true, message: 'Source is not pinned.' }],
      status: {
        execution: 'not-applicable', provenance: 'incomplete', control: 'untracked',
        reproduction: 'not-run', evidence: 'pending'
      }
    },
    status: {
      state: 'committed', runtimeId: 'codex', threadId: 'thread-study', turnId: 'turn-2',
      recordingId: 'research-recording:study-1',
      operationId: `research-checkpoint-operation:${'1'.repeat(64)}`,
      changeReason: 'Added exact result table.', attempts: 1,
      createdAt: '2026-08-11T02:00:00.000Z', updatedAt: '2026-08-11T02:00:01.000Z',
      changeKind: 'updated', title: 'Recorded study', artifactRef: checkpointRef, ordinal: 2,
      inputs: [], outputs: [], reproduction: { status: 'not-run' },
      provenance: { status: 'incomplete' }, control: { status: 'untracked' },
      untrackedOperationCount: 0, evidence: { status: 'pending' }
    }
  }
  return { checkpoint, checkpointDescriptor, checkpointRef }
}

const exactRef = (name: string) => ({
  artifactId: `artifact:${name}`,
  versionId: `artifact-version:${name}`,
  contentDigest: digest,
  byteLength: 10,
  mediaType: 'application/octet-stream',
  availability: 'available',
  retention: 'snapshot',
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
})

function runSpec(runId: string) {
  return {
    schemaVersion: 1,
    runId,
    code: exactRef('code'),
    inputs: [{ name: 'data', version: exactRef('data'), mountPath: '/inputs/data.csv' }],
    environmentVersion: exactRef('environment'),
    parameters: { alpha: 0.05 },
    outputs: [{
      outputId: 'result', relativePath: 'result.json', kind: 'compute-output',
      expectedCurrentVersionId: null, comparator: { kind: 'canonical-json' }
    }],
    resources: {
      wallClockMs: 1_000, maxMemoryMiB: 256, cpuSeconds: 10,
      maxOutputBytes: 1_000_000, maxLogBytes: 1_000_000, maxProcesses: 1
    },
    requestedControl: 'isolated-attested',
    producerPlan: {
      producer: { moduleId: 'sciforge.test', moduleVersion: '1.0.0' },
      adapterId: 'generic-python-v1'
    },
    eventScope: { runtimeId: 'codex', threadId: 'thread-evidence' },
    specDigest: digest
  }
}

test('keeps a primary exact record when an optional owner section is unavailable', async () => {
  const client = {
    describeArtifactVersion: async () => ({ ok: true, value: descriptor }),
    listArtifactVersions: async () => { throw new Error('history owner disabled') }
  }
  const result = await loadExactResearchDossier(client as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: ref.versionId },
    page: 'overview',
    expectedDigest: `sha256:${digest}`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.record.kind, 'artifact-version')
  assert.equal(result.value.issues.versions, 'history owner disabled')
})

test('propagates access denial and never substitutes another artifact version', async () => {
  const calls: string[] = []
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async (_workspace: string, versionId: string) => {
      calls.push(versionId)
      return { ok: false, issue: { code: 'access-restricted', message: 'denied' } }
    }
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: 'artifact-version:restricted:7' },
    page: 'overview'
  })
  assert.deepEqual(calls, ['artifact-version:restricted:7'])
  assert.deepEqual(result, {
    ok: false,
    issue: { code: 'access-restricted', message: 'denied' }
  })
})

test('loads the first owner pages without requiring an activation', async () => {
  const calls: unknown[] = []
  const result = await loadResearchDossierBrowse({
    listArtifactVersions: async (_workspace: string, input: { kind?: string }) => {
      calls.push(input)
      return {
        ok: true,
        value: {
          items: [{
            ...descriptor,
            artifact: { ...descriptor.artifact, kind: input.kind },
            version: {
              ...descriptor.version,
              versionId: `${descriptor.version.versionId}:${input.kind}`,
              sequence: input.kind === 'research-output' ? 13 : 12,
              metadata: input.kind === 'research-output'
                ? { causality: 'host-authenticated-executor-write' }
                : {}
            }
          }]
        }
      }
    }
  } as never, '/workspace/lab')
  assert.deepEqual(calls, [
    { kind: 'research-checkpoint', currentOnly: false, metadataQuery: '', limit: 25 },
    { kind: 'research-output', currentOnly: false, metadataQuery: '', limit: 25 }
  ])
  assert.deepEqual(result.artifacts.items.map((item) => item.artifact.kind), [
    'research-output',
    'research-checkpoint'
  ])
})

test('continues both kind cursors beyond 25 records, deduplicates ties and exhausts every accessible page', async () => {
  const calls: Array<{ kind: string; beforeSequence?: number }> = []
  const rows = (kind: string) => Array.from({ length: 62 }, (_, index) => ({
    ...descriptor,
    artifact: { ...descriptor.artifact, kind },
    version: { ...descriptor.version, versionId: `artifact-version:${kind}:${index}`, sequence: 200 - index,
      metadata: { causality: 'host-authenticated-executor-write' } }
  }))
  const checkpointRows = rows('research-checkpoint')
  const outputRows = rows('research-output')
  // Duplicate identities across queries and equal timestamps/sequences remain deterministic.
  outputRows[0] = checkpointRows[0]!
  const client = { listArtifactVersions: async (_workspace: string, input: { kind: string; beforeSequence?: number }) => {
    calls.push(input)
    const candidates = (input.kind === 'research-checkpoint' ? checkpointRows : outputRows)
      .filter(item => !input.beforeSequence || item.version.sequence < input.beforeSequence)
    const items = candidates.slice(0, 25)
    return { ok: true, value: { items, ...(candidates.length > 25 ? { nextBeforeSequence: items.at(-1)!.version.sequence } : {}) } }
  } } as never
  const first = await loadResearchDossierBrowse(client, '/workspace/lab')
  assert.equal(first.artifacts.items.length, 49)
  const second = await loadResearchDossierBrowse(client, '/workspace/lab', first)
  assert.equal(second.artifacts.items.length, 99)
  const last = await loadResearchDossierBrowse(client, '/workspace/lab', second)
  assert.equal(last.artifacts.items.length, 123)
  assert.equal(new Set(last.artifacts.items.map(item => item.version.versionId)).size, 123)
  assert.ok(last.streams.every(stream => stream.complete && stream.pagesRead === 3 && stream.scanned === 62))
  assert.deepEqual(calls.map(call => call.beforeSequence), [undefined, undefined, 176, 176, 151, 151])
  assert.ok(last.artifacts.items.find(item => item.version.versionId === 'artifact-version:research-output:61'))
  for (let index = 1; index < last.artifacts.items.length; index++) {
    const left = last.artifacts.items[index - 1]!.version
    const right = last.artifacts.items[index]!.version
    assert.ok(left.sequence > right.sequence || (left.sequence === right.sequence && left.versionId.localeCompare(right.versionId) <= 0))
  }
  await loadResearchDossierBrowse(client, '/workspace/lab', last)
  assert.equal(calls.length, 6, 'exhausted streams do not restart at latest')
  await assert.rejects(() => loadResearchDossierBrowse(client, '/workspace/other', last), /another workspace/u)
})

test('a refused continuation keeps the failed cursor and does not restart exhausted kinds or erase prior records', async () => {
  let denied = true
  const calls: unknown[] = []
  const client = { listArtifactVersions: async (_workspace: string, input: { kind: string; beforeSequence?: number }) => {
    calls.push(input)
    if (input.kind === 'research-output') return { ok: true, value: { items: [] } }
    if (input.beforeSequence && denied) return { ok: false, issue: { code: 'access-restricted', message: 'denied history' } }
    return { ok: true, value: { items: [{ ...descriptor, artifact: { ...descriptor.artifact, kind: 'research-checkpoint' } }],
      ...(!input.beforeSequence ? { nextBeforeSequence: 12 } : {}) } }
  } } as never
  const first = await loadResearchDossierBrowse(client, '/workspace/lab')
  const failed = await loadResearchDossierBrowse(client, '/workspace/lab', first)
  assert.equal(failed.artifacts.items.length, 1)
  assert.equal(failed.streams[0]!.nextBeforeSequence, 12)
  assert.match(failed.issues.artifacts!, /access-restricted.*denied history/u)
  assert.equal(calls.length, 3)
  denied = false
  const recovered = await loadResearchDossierBrowse(client, '/workspace/lab', failed)
  assert.equal(recovered.issues.artifacts, undefined)
  assert.ok(recovered.streams.every(stream => stream.complete))
  assert.equal(calls.length, 4)
})

test('does not accept a nonadvancing history cursor', async () => {
  const client = { listArtifactVersions: async () => ({ ok: true, value: { items: [], nextBeforeSequence: 12 } }) } as never
  const first = await loadResearchDossierBrowse(client, '/workspace/lab')
  const repeated = await loadResearchDossierBrowse(client, '/workspace/lab', first)
  assert.match(repeated.issues.artifacts!, /invalid-cursor/u)
  assert.ok(repeated.streams.every(stream => !stream.complete && stream.pagesRead === 1))
})

test('rejects another exact version even when its bytes have the same digest', async () => {
  const result = await loadExactResearchDossier({ describeArtifactVersion: async () => ({ ok: true, value: descriptor }) } as never,
    '/workspace/lab', { contractVersion: 1, target: { kind: 'artifact-version', versionId: 'artifact-version:older:1' }, page: 'versions', expectedDigest: `sha256:${digest}` })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.issue.code, 'content-mismatch')
})

test('keeps one research artifact kind when the other browse owner query fails', async () => {
  const result = await loadResearchDossierBrowse({
    listArtifactVersions: async (_workspace: string, input: { kind?: string }) => {
      if (input.kind === 'research-checkpoint') throw new Error('checkpoint index unavailable')
      return {
        ok: true,
        value: {
          items: [
            {
              ...descriptor,
              artifact: { ...descriptor.artifact, kind: 'research-output' },
              version: {
                ...descriptor.version,
                metadata: { causality: 'host-authenticated-executor-write' }
              }
            },
            {
              ...descriptor,
              artifact: { ...descriptor.artifact, kind: 'research-output' },
              version: {
                ...descriptor.version,
                metadata: { causality: 'host-authenticated-executor-write' }
              }
            }
          ]
        }
      }
    }
  } as never, '/workspace/lab')

  assert.equal(result.artifacts.items.length, 1)
  assert.equal(result.artifacts.items[0]?.artifact.kind, 'research-output')
  assert.equal(result.issues.artifacts, 'checkpoint index unavailable')
})

test('hides immutable legacy ambient outputs from the researcher browse list', async () => {
  const result = await loadResearchDossierBrowse({
    listArtifactVersions: async (_workspace: string, input: { kind?: string }) => ({
      ok: true,
      value: {
        items: input.kind === 'research-output' ? [{
          ...descriptor,
          artifact: {
            ...descriptor.artifact,
            kind: 'research-output',
            label: '.codex-runtime/session.jsonl'
          },
          version: {
            ...descriptor.version,
            metadata: { causality: 'unverified' }
          }
        }] : []
      }
    })
  } as never, '/workspace/lab')

  assert.deepEqual(result.artifacts.items, [])
})

test('fails closed for a legacy formal Compute target when its owner is unavailable', async () => {
  const result = await loadExactResearchDossier({} as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'compute-run', runId: 'compute-run:exact' },
    page: 'reproduction'
  })
  assert.deepEqual(result, {
    ok: false,
    issue: {
      code: 'compute-owner-unavailable',
      message: 'The formal Compute owner is unavailable; this legacy run target cannot be verified.'
    }
  })
})

test('loads an exact Research Checkpoint owner projection without scanning or latest fallback', async () => {
  const { checkpoint, checkpointDescriptor, checkpointRef } = checkpointFixture()
  const calls: unknown[] = []
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async (_workspace: string, versionId: string) => {
      calls.push(['describe', versionId])
      return { ok: true, value: checkpointDescriptor }
    },
    listArtifactVersions: async (_workspace: string, input: unknown) => {
      calls.push(['history', input])
      return { ok: true, value: { items: [checkpointDescriptor] } }
    },
    readResearchCheckpoint: async (_workspace: string, input: unknown) => {
      calls.push(['checkpoint', input])
      return { ok: true, value: checkpoint }
    }
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${checkpointRef.contentDigest}`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.record.kind, 'artifact-version')
  if (result.value.record.kind !== 'artifact-version') return
  assert.equal(result.value.record.checkpoint?.manifest.narrative.canonicalText, 'The treatment increased the response.')
  assert.deepEqual(calls, [
    ['describe', checkpointRef.versionId],
    ['history', { artifactId: checkpointRef.artifactId, limit: 25 }],
    ['checkpoint', {
      recordingId: 'research-recording:study-1',
      versionId: checkpointRef.versionId
    }]
  ])
})

test('fails closed when the Research Checkpoint owner returns another exact version', async () => {
  const { checkpoint, checkpointDescriptor, checkpointRef } = checkpointFixture()
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: checkpointDescriptor }),
    listArtifactVersions: async () => ({ ok: true, value: { items: [checkpointDescriptor] } }),
    readResearchCheckpoint: async () => ({
      ok: true,
      value: {
        ...checkpoint,
        status: {
          ...checkpoint.status,
          artifactRef: { ...checkpointRef, contentDigest: '9'.repeat(64) }
        }
      }
    })
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${checkpointRef.contentDigest}`
  })
  assert.deepEqual(result, {
    ok: false,
    issue: {
      code: 'content-mismatch',
      message: 'The Research Checkpoint owner returned a record for another exact Artifact Version.'
    }
  })
})

test('keeps exact Artifact data visible when the Research Checkpoint owner is unavailable', async () => {
  const { checkpointDescriptor, checkpointRef } = checkpointFixture()
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: checkpointDescriptor }),
    listArtifactVersions: async () => ({ ok: true, value: { items: [checkpointDescriptor] } }),
    readResearchCheckpoint: async () => { throw new Error('Research Checkpoint owner disabled') }
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${checkpointRef.contentDigest}`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.record.kind, 'artifact-version')
  assert.equal(result.value.issues.checkpoint, 'Research Checkpoint owner disabled')
})

test('returns exact Artifact history promptly when the Research Checkpoint owner never resolves', async () => {
  const { checkpointDescriptor, checkpointRef } = checkpointFixture()
  const calls: unknown[] = []
  const startedAt = Date.now()
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async (_workspace: string, versionId: string) => {
      calls.push(['describe', versionId])
      return { ok: true, value: checkpointDescriptor }
    },
    listArtifactVersions: async (_workspace: string, input: unknown) => {
      calls.push(['history', input])
      return { ok: true, value: { items: [checkpointDescriptor] } }
    },
    readResearchCheckpoint: async (_workspace: string, input: unknown) => {
      calls.push(['checkpoint', input])
      return await new Promise<never>(() => undefined)
    }
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${checkpointRef.contentDigest}`
  }, { secondaryOwnerTimeoutMs: 15 })
  const elapsedMs = Date.now() - startedAt

  assert.ok(elapsedMs < 500, `Research Checkpoint owner held the exact Artifact page for ${elapsedMs} ms`)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.record.kind, 'artifact-version')
  if (result.value.record.kind !== 'artifact-version') return
  assert.equal(result.value.record.descriptor.version.versionId, checkpointRef.versionId)
  assert.deepEqual(
    result.value.record.history.items.map((item) => item.version.versionId),
    [checkpointRef.versionId]
  )
  assert.equal(result.value.record.checkpoint, undefined)
  assert.match(result.value.issues.checkpoint ?? '', /did not respond within 15 ms/u)
  assert.match(result.value.issues.checkpoint ?? '', /exact primary record remains available/u)
  assert.deepEqual(calls, [
    ['describe', checkpointRef.versionId],
    ['history', { artifactId: checkpointRef.artifactId, limit: 25 }],
    ['checkpoint', {
      recordingId: 'research-recording:study-1',
      versionId: checkpointRef.versionId
    }]
  ])
})

test('keeps a restored exact checkpoint visible until its owner projection catches up', async () => {
  const { checkpointDescriptor, checkpointRef } = checkpointFixture()
  const restored = {
    ...checkpointDescriptor,
    version: {
      ...checkpointDescriptor.version,
      metadata: {
        restoredFromVersionId: 'artifact-version:research-checkpoint:1',
        restoredBy: 'research-checkpoints'
      }
    },
    artifactOrdinal: 3
  }
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: restored }),
    listArtifactVersions: async () => ({ ok: true, value: { items: [restored] } }),
    readResearchCheckpoint: async () => ({
      ok: false,
      issue: { code: 'not-found', message: 'Restored checkpoint projection is pending.', retryable: false }
    })
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${checkpointRef.contentDigest}`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.issues.checkpoint, 'Restored checkpoint projection is pending.')
})

test('loads a caught-up restored checkpoint whose Artifact metadata preserves exact source scope', async () => {
  const { checkpoint, checkpointDescriptor, checkpointRef } = checkpointFixture()
  const restoredRef = {
    ...checkpointRef,
    versionId: 'artifact-version:research-checkpoint:3'
  }
  const restored = {
    ...checkpointDescriptor,
    artifact: {
      ...checkpointDescriptor.artifact,
      currentVersionId: restoredRef.versionId,
      versionCount: 3
    },
    version: {
      ...checkpointDescriptor.version,
      versionId: restoredRef.versionId,
      metadata: {
        ...checkpointDescriptor.version.metadata,
        restoredFromVersionId: checkpointRef.versionId,
        restoredBy: 'research-checkpoints',
        restoreOperationId: `research-checkpoint-restore:${'3'.repeat(64)}`
      }
    },
    ref: restoredRef,
    artifactOrdinal: 3
  }
  const restoredCheckpoint = {
    ...checkpoint,
    status: {
      ...checkpoint.status,
      artifactRef: restoredRef,
      ordinal: 3
    },
    projection: {
      kind: 'restore',
      restoreOperationId: `research-checkpoint-restore:${'3'.repeat(64)}`,
      sourceVersionId: checkpointRef.versionId,
      sourceRecordId: checkpoint.status.operationId
    }
  }
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: restored }),
    listArtifactVersions: async () => ({ ok: true, value: { items: [restored, checkpointDescriptor] } }),
    readResearchCheckpoint: async () => ({ ok: true, value: restoredCheckpoint }),
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: restoredRef.versionId },
    page: 'overview', expectedDigest: `sha256:${restoredRef.contentDigest}`
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.record.kind, 'artifact-version')
  if (result.value.record.kind !== 'artifact-version') return
  assert.equal(result.value.record.checkpoint?.status.artifactRef.versionId, restoredRef.versionId)
  assert.equal(result.value.record.checkpoint?.projection?.sourceVersionId, checkpointRef.versionId)
})

test('fails closed when restored Artifact metadata does not preserve exact source scope', async () => {
  const { checkpoint, checkpointDescriptor, checkpointRef } = checkpointFixture()
  const restoredRef = { ...checkpointRef, versionId: 'artifact-version:research-checkpoint:3' }
  const restored = {
    ...checkpointDescriptor,
    artifact: { ...checkpointDescriptor.artifact, currentVersionId: restoredRef.versionId, versionCount: 3 },
    version: {
      ...checkpointDescriptor.version,
      versionId: restoredRef.versionId,
      metadata: {
        ...checkpointDescriptor.version.metadata,
        threadId: 'thread-other',
        restoredFromVersionId: checkpointRef.versionId,
        restoredBy: 'research-checkpoints'
      }
    },
    ref: restoredRef,
    artifactOrdinal: 3
  }
  const restoredCheckpoint = {
    ...checkpoint,
    status: {
      ...checkpoint.status,
      artifactRef: restoredRef,
      ordinal: 3
    }
  }
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: restored }),
    listArtifactVersions: async () => ({ ok: true, value: { items: [restored] } }),
    readResearchCheckpoint: async () => ({ ok: true, value: restoredCheckpoint })
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: restoredRef.versionId },
    page: 'overview', expectedDigest: `sha256:${restoredRef.contentDigest}`
  })
  assert.deepEqual(result, {
    ok: false,
    issue: {
      code: 'content-mismatch',
      message: 'The Research Checkpoint owner projection does not match the Artifact owner metadata scope.'
    }
  })
})

test('stops before owner reads when the expected checkpoint digest is wrong', async () => {
  const { checkpointDescriptor, checkpointRef } = checkpointFixture()
  let checkpointReads = 0
  const result = await loadExactResearchDossier({
    describeArtifactVersion: async () => ({ ok: true, value: checkpointDescriptor }),
    readResearchCheckpoint: async () => {
      checkpointReads += 1
      throw new Error('must not run')
    }
  } as never, '/workspace/lab', {
    contractVersion: 1,
    target: { kind: 'artifact-version', versionId: checkpointRef.versionId },
    page: 'overview', expectedDigest: `sha256:${'0'.repeat(64)}`
  })
  assert.equal(result.ok, false)
  assert.equal(checkpointReads, 0)
})


test('browse follows a cursor-only owner page and refuses a repeated opaque cursor', async () => {
  const calls: Array<{ kind: string; cursor?: string; beforeSequence?: number }> = []
  const client = { listArtifactVersions: async (_workspace: string, input: { kind: string; cursor?: string; beforeSequence?: number }) => {
    calls.push(input)
    return { ok: true, value: input.kind === 'research-checkpoint' ? { items: [] } : { items: [], nextCursor: 'owner-opaque-cursor' } }
  } } as never
  const first = await loadResearchDossierBrowse(client, '/workspace/lab', undefined, 'older')
  assert.equal(first.streams.find(stream => stream.kind === 'research-output')!.complete, false)
  const second = await loadResearchDossierBrowse(client, '/workspace/lab', first, 'older')
  assert.equal(calls.at(-1)!.cursor, 'owner-opaque-cursor')
  assert.equal(calls.at(-1)!.beforeSequence, undefined)
  assert.match(second.issues.artifacts!, /invalid-cursor/)
  await assert.rejects(loadResearchDossierBrowse(client, '/workspace/lab', first, 'other'), /cursor/)
})
