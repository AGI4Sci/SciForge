import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ArtifactVersionCommitPortV1,
  ArtifactVersionEventListPortV1,
  ArtifactVersionLifecycleEventV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  createEvidenceArtifactVersionClient,
  pullArtifactVersionLifecyclePage
} from './artifact-version-client.js'

const workspaceRoot = '/workspace/alpha'
const occurredAt = '2026-08-06T08:00:00.000Z'
const accessPolicy = {
  visibility: 'workspace' as const,
  principals: [],
  allowExport: true
}
const ref: ArtifactVersionRefV1 = {
  artifactId: 'artifact:alpha',
  versionId: 'artifact-version:alpha-1',
  contentDigest: 'a'.repeat(64),
  byteLength: 42,
  mediaType: 'text/csv',
  availability: 'available',
  retention: 'reference',
  accessPolicy
}
const context = {
  runtimeId: 'codex',
  threadId: 'thread-1',
  operationId: 'turn-1',
  workspaceRoot,
  occurredAt
}

test('pins an explicit ref without committing or implicitly pulling lifecycle state', async () => {
  let commits = 0
  const client = createEvidenceArtifactVersionClient(
    () => ({ commit: async () => { commits += 1; throw new Error('must not commit') } })
  )

  const [item] = await client.pinTrace([{
    id: 'trace-1',
    artifactVersionRef: ref,
    locator: 'workspace:data/input.csv',
    kind: 'dataset'
  }], context)

  assert.equal(commits, 0)
  const projection = item?.evidenceArtifactVersions as Record<string, unknown>
  assert.equal(projection.status, 'ready')
  assert.deepEqual((projection.versions as Array<{ ref: ArtifactVersionRefV1 }>)[0]?.ref, ref)
})

test('pins explicit lineage refs nested in the generic capability invocation envelope', async () => {
  let commits = 0
  const client = createEvidenceArtifactVersionClient(
    () => ({ commit: async () => { commits += 1; throw new Error('must not commit') } })
  )

  const [item] = await client.pinTrace([{
    id: 'trace-broker-output',
    output: {
      operationRef: 'op_scientific_plotting_render',
      output: {
        ok: true,
        evidenceLineage: {
          activity: { id: 'plot-run-1', type: 'analysis_run', parameters: {} },
          inputs: [{
            id: 'dataset-1',
            type: 'dataset_version',
            artifact: {
              kind: 'dataset',
              locator: 'snapshot:artifact-version:alpha-1',
              contentDigest: ref.contentDigest,
              size: ref.byteLength,
              mediaType: ref.mediaType,
              retention: ref.retention,
              accessPolicy: ref.accessPolicy,
              artifactVersionRef: ref
            }
          }]
        }
      }
    }
  }], context)

  assert.equal(commits, 0)
  const projection = item?.evidenceArtifactVersions as {
    status: string
    versions: Array<{ ref: ArtifactVersionRefV1 }>
  }
  assert.equal(projection.status, 'ready')
  assert.deepEqual(projection.versions.map((value) => value.ref), [ref])
})

test('keeps mixed complete and incomplete lineage pending without a partial commit', async () => {
  let commits = 0
  const client = createEvidenceArtifactVersionClient(
    () => ({ commit: async () => { commits += 1; throw new Error('must fail closed') } })
  )

  const [item] = await client.pinTrace([{
    id: 'trace-mixed-lineage',
    output: {
      evidenceLineage: {
        inputs: [{
          id: 'complete-input',
          artifact: {
            kind: 'dataset',
            locator: 'snapshot:artifact-version:alpha-1',
            artifactVersionRef: ref
          }
        }],
        outputs: [{
          id: 'incomplete-output',
          artifact: {
            kind: 'figure',
            locator: 'workspace:figures/incomplete.png'
          }
        }]
      }
    }
  }], context)

  assert.equal(commits, 0)
  const projection = item?.evidenceArtifactVersions as {
    status: string
    reason?: string
    versions?: unknown[]
  }
  assert.equal(projection.status, 'pending')
  assert.match(projection.reason ?? '', /locator, contentDigest, and byteLength/u)
  assert.equal(projection.versions, undefined)
})

test('commits only an explicit canonical reference through the real workspace scope', async () => {
  const commitScopes: string[] = []
  const commitFactory = (scope: string): ArtifactVersionCommitPortV1 => ({
    commit: async (input) => {
      commitScopes.push(scope)
      assert.equal(input.candidates[0]?.content.mode, 'reference')
      assert.equal(input.candidates[0]?.content.contentDigest, 'b'.repeat(64))
      assert.deepEqual(input.candidates[0]?.accessPolicy, accessPolicy)
      return {
        ok: true,
        value: {
          transactionId: 'artifact-commit:alpha',
          committedAt: occurredAt,
          idempotentReplay: false,
          versions: [{
            candidateId: input.candidates[0]!.candidateId,
            artifact: {
              artifactId: ref.artifactId,
              kind: 'dataset',
              createdAt: occurredAt,
              updatedAt: occurredAt,
              currentVersionId: ref.versionId,
              versionCount: 1
            },
            version: {
              schemaVersion: 1,
              versionId: ref.versionId,
              artifactId: ref.artifactId,
              sequence: 1,
              transactionId: 'artifact-commit:alpha',
              createdAt: occurredAt,
              intent: 'observe',
              storage: {
                mode: 'reference',
                locator: 'workspace:data/output.csv',
                contentDigest: 'b'.repeat(64),
                byteLength: 7,
                mediaType: 'text/csv',
                availability: 'available'
              },
              dependencies: [],
              accessPolicy,
              metadata: {}
            },
            ref: {
              ...ref,
              contentDigest: 'b'.repeat(64),
              byteLength: 7
            }
          }],
          events: []
        }
      }
    }
  })
  const client = createEvidenceArtifactVersionClient(commitFactory)

  const [item] = await client.pinTrace([{
    id: 'trace-2',
    artifact: {
      kind: 'dataset',
      locator: 'workspace:data/output.csv',
      contentDigest: `sha256:${'b'.repeat(64)}`,
      byteLength: 7,
      mediaType: 'text/csv',
      accessPolicy
    }
  }], context)

  assert.deepEqual(commitScopes, [workspaceRoot])
  assert.equal((item?.evidenceArtifactVersions as { status: string }).status, 'ready')
})

test('pulls lifecycle pages from an explicit caller-owned watermark and merges them', async () => {
  const afterSequences: number[] = []
  const moved: ArtifactVersionLifecycleEventV1 = {
    schemaVersion: 1,
    eventId: 'artifact-event:moved',
    sequence: 1,
    type: 'artifact-moved',
    artifactId: ref.artifactId,
    versionId: ref.versionId,
    createdAt: occurredAt,
    detail: { previousLocator: 'workspace:old.csv', locator: 'workspace:new.csv' }
  }
  const changed: ArtifactVersionLifecycleEventV1 = {
    ...moved,
    eventId: 'artifact-event:changed',
    sequence: 2,
    type: 'artifact-content-changed',
    detail: { previousContentDigest: 'a'.repeat(64), contentDigest: 'c'.repeat(64) }
  }
  const client = createEvidenceArtifactVersionClient(
    () => ({ commit: async () => { throw new Error('must not commit incomplete provenance') } })
  )
  const port: (workspaceRoot: string) => ArtifactVersionEventListPortV1 = () => ({
      listEvents: async (input) => {
        const after = input.afterSequence ?? 0
        afterSequences.push(after)
        return after === 0
          ? { ok: true, value: { events: [moved], lastSequence: 1 } }
          : { ok: true, value: { events: [changed], lastSequence: 2 } }
      }
    })

  const [first] = await client.pinTrace([{
    id: 'trace-3', artifact: { locator: 'workspace:unknown.csv' }
  }], context)
  const firstPage = await pullArtifactVersionLifecyclePage(workspaceRoot, 0, port, 1)
  assert.equal(firstPage.ok, true)
  const secondPage = await pullArtifactVersionLifecyclePage(workspaceRoot, 1, port, 1)
  assert.equal(secondPage.ok, true)
  assert.equal(firstPage.ok && firstPage.lifecyclePending, true)
  assert.equal(secondPage.ok && secondPage.lastSequence, 2)
  const [second] = client.withLifecycle(
    client.withLifecycle([{ id: 'trace-4', content: 'no artifact' }], {
      events: firstPage.ok ? firstPage.events : [],
      lastSequence: firstPage.ok ? firstPage.lastSequence : 0,
      lifecyclePending: firstPage.ok && firstPage.lifecyclePending
    }),
    {
      events: secondPage.ok ? secondPage.events : [],
      lastSequence: secondPage.ok ? secondPage.lastSequence : 1,
      lifecyclePending: secondPage.ok && secondPage.lifecyclePending
    }
  )

  assert.equal((first?.evidenceArtifactVersions as { status: string }).status, 'pending')
  assert.deepEqual(afterSequences, [0, 1])
  const lifecycle = (second?.evidenceArtifactVersions as {
    lifecycleEvents: ArtifactVersionLifecycleEventV1[]
    lastSequence: number
  })
  assert.equal(lifecycle.lastSequence, 2)
  assert.deepEqual(lifecycle.lifecycleEvents.map((event) => event.eventId), [
    'artifact-event:moved', 'artifact-event:changed'
  ])
})

test('marks a full lifecycle page as pending so the next update drains the backlog', async () => {
  const events = Array.from({ length: 512 }, (_, index): ArtifactVersionLifecycleEventV1 => ({
    schemaVersion: 1,
    eventId: `artifact-event:page-${index + 1}`,
    sequence: index + 1,
    type: 'artifact-moved',
    artifactId: ref.artifactId,
    versionId: ref.versionId,
    createdAt: occurredAt,
    detail: { locator: `workspace:data-${index + 1}.csv` }
  }))
  const client = createEvidenceArtifactVersionClient(
    () => ({ commit: async () => { throw new Error('not used') } })
  )
  const pulled = await pullArtifactVersionLifecyclePage(
    workspaceRoot,
    0,
    (): ArtifactVersionEventListPortV1 => ({ listEvents: async () => ({
      ok: true, value: { events, lastSequence: 512 }
    }) }),
    512
  )
  assert.equal(pulled.ok, true)
  const [item] = client.withLifecycle([{ id: 'trace:backlog', content: 'result' }], {
    events: pulled.ok ? pulled.events : [],
    lastSequence: pulled.ok ? pulled.lastSequence : 0,
    lifecyclePending: pulled.ok && pulled.lifecyclePending
  })
  const projection = item?.evidenceArtifactVersions as {
    lifecyclePending: boolean
    lastSequence: number
  }
  assert.equal(projection.lifecyclePending, true)
  assert.equal(projection.lastSequence, 512)
})
