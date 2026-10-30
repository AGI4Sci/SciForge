import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitPortV1,
  ArtifactVersionReadPortV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type { EvidenceDagExportSnapshotProductsInput } from '../contract.js'
import type { EvidenceDagSnapshotProductsProjection } from './client.js'
import { commitEvidenceSnapshotProducts } from './snapshot-products.js'

const now = '2026-08-06T08:00:00.000Z'
const sourceBytes = Buffer.from('exact source bytes', 'utf8')
const sourceRef: ArtifactVersionRefV1 = {
  artifactId: 'artifact:source',
  versionId: 'artifact-version:source-1',
  contentDigest: createHash('sha256').update(sourceBytes).digest('hex'),
  byteLength: sourceBytes.byteLength,
  mediaType: 'text/plain',
  availability: 'available',
  retention: 'snapshot',
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
}
const snapshotDigest = `sha256:${'a'.repeat(64)}`
const request: EvidenceDagExportSnapshotProductsInput = {
  runtimeId: 'codex',
  threadId: 'thread-products',
  workspaceRoot: '/workspace',
  snapshotDigest,
  idempotencyKey: 'export-request-1',
  datacite: {
    doi: '10.12345/sciforge.snapshot',
    title: 'Pinned SciForge Evidence Snapshot',
    creators: [{ name: 'Researcher, Ada', nameType: 'Personal' }],
    publisher: 'SciForge Test Laboratory',
    publicationYear: 2026,
    projectId: 'project:snapshot-products'
  }
}

function projection(
  override: Partial<EvidenceDagSnapshotProductsProjection> = {}
): EvidenceDagSnapshotProductsProjection {
  const kinds = [
    'prov-json', 'ro-crate', 'datacite', 'audit-report', 'reproduction-report'
  ] as const
  return {
    schemaVersion: 'sciforge-evidence-products.v1',
    threadId: 'codex:thread-products',
    snapshotDigest,
    sourceArtifactVersionRefs: [sourceRef],
    products: kinds.map((product) => {
      const content = `${JSON.stringify({ product, snapshotDigest })}\n`
      return {
        product,
        fileName: `${product}.json`,
        mediaType: 'application/json',
        content,
        contentDigest: createHash('sha256').update(content).digest('hex'),
        byteLength: Buffer.byteLength(content, 'utf8')
      }
    }),
    ...override
  }
}

const readPort: ArtifactVersionReadPortV1 = {
  read: async ({ versionId }) => {
    assert.equal(versionId, sourceRef.versionId)
    return {
      ok: true,
      value: {
        artifact: {
          artifactId: sourceRef.artifactId,
          kind: 'paper',
          createdAt: now,
          updatedAt: now,
          currentVersionId: sourceRef.versionId,
          versionCount: 1
        },
        version: {
          schemaVersion: 1,
          versionId: sourceRef.versionId,
          artifactId: sourceRef.artifactId,
          sequence: 1,
          transactionId: 'artifact-commit:source',
          createdAt: now,
          intent: 'save',
          storage: {
            mode: 'snapshot',
            contentDigest: sourceRef.contentDigest,
            byteLength: sourceRef.byteLength,
            mediaType: sourceRef.mediaType
          },
          dependencies: [],
          accessPolicy: sourceRef.accessPolicy,
          metadata: {}
        },
        ref: sourceRef,
        dataBase64: sourceBytes.toString('base64')
      }
    }
  }
}

function successfulCommit(inputs: ArtifactVersionCommitInputV1[]): ArtifactVersionCommitPortV1 {
  return {
    commit: async (input) => {
      inputs.push(input)
      return {
        ok: true,
        value: {
          transactionId: 'artifact-commit:evidence-products',
          committedAt: now,
          idempotentReplay: inputs.length > 1,
          versions: input.candidates.map((candidate, index) => {
            assert.equal(candidate.content.mode, 'snapshot')
            const bytes = Buffer.from(candidate.content.dataBase64, 'base64')
            const digest = createHash('sha256').update(bytes).digest('hex')
            const artifactId = candidate.artifactId ?? `artifact:evidence-product-${index + 1}`
            const versionId = `artifact-version:evidence-product-${index + 1}`
            const ref: ArtifactVersionRefV1 = {
              artifactId,
              versionId,
              contentDigest: digest,
              byteLength: bytes.byteLength,
              ...(candidate.content.mediaType
                ? { mediaType: candidate.content.mediaType }
                : {}),
              availability: 'available',
              retention: 'snapshot',
              accessPolicy: candidate.accessPolicy!
            }
            return {
              candidateId: candidate.candidateId,
              artifact: {
                artifactId,
                kind: candidate.kind,
                label: candidate.label,
                createdAt: now,
                updatedAt: now,
                currentVersionId: versionId,
                versionCount: 1
              },
              version: {
                schemaVersion: 1 as const,
                versionId,
                artifactId,
                sequence: 1,
                transactionId: 'artifact-commit:evidence-products' as const,
                createdAt: now,
                intent: candidate.intent,
                storage: {
                  mode: 'snapshot' as const,
                  contentDigest: digest,
                  byteLength: bytes.byteLength,
                  ...(candidate.content.mediaType
                    ? { mediaType: candidate.content.mediaType }
                    : {})
                },
                dependencies: candidate.dependencies!.map((dependency) => ({
                  role: dependency.role,
                  required: dependency.required ?? true,
                  target: dependency.target.kind === 'version'
                    ? dependency.target.ref
                    : sourceRef
                })),
                accessPolicy: candidate.accessPolicy!,
                metadata: candidate.metadata!
              },
              ref
            }
          }),
          events: []
        }
      }
    }
  }
}

test('atomically commits all products with every exact source dependency and stable idempotency', async () => {
  const commits: ArtifactVersionCommitInputV1[] = []
  const commitPort = successfulCommit(commits)
  const first = await commitEvidenceSnapshotProducts({
    request,
    engineThreadId: 'codex:thread-products',
    projection: projection(),
    readPort,
    commitPort
  })
  const second = await commitEvidenceSnapshotProducts({
    request: { ...request, idempotencyKey: 'a-different-retry-key' },
    engineThreadId: 'codex:thread-products',
    projection: projection(),
    readPort,
    commitPort
  })

  assert.equal(first.products.length, 5)
  assert.equal(second.idempotentReplay, true)
  assert.equal(commits.length, 2)
  assert.equal(commits[0]?.idempotencyKey, commits[1]?.idempotencyKey)
  assert.equal(commits[0]?.candidates.length, 5)
  for (const candidate of commits[0]!.candidates) {
    assert.equal(candidate.dependencies?.length, 1)
    assert.deepEqual(candidate.dependencies?.[0], {
      role: 'source-artifact',
      required: true,
      target: { kind: 'version', ref: sourceRef }
    })
    assert.equal(candidate.metadata?.evidenceSnapshotDigest, snapshotDigest)
    assert.equal(candidate.metadata?.evidenceThreadId, request.threadId)
  }
})

test('fails closed on a snapshot projection mismatch before committing', async () => {
  let commits = 0
  await assert.rejects(
    () => commitEvidenceSnapshotProducts({
      request,
      engineThreadId: 'codex:thread-products',
      projection: projection({ snapshotDigest: `sha256:${'b'.repeat(64)}` }),
      readPort,
      commitPort: { commit: async () => { commits += 1; throw new Error('must not commit') } }
    }),
    /does not match the pinned snapshot digest/u
  )
  assert.equal(commits, 0)
})

test('does not return false success when the atomic Artifact Version commit fails', async () => {
  await assert.rejects(
    () => commitEvidenceSnapshotProducts({
      request,
      engineThreadId: 'codex:thread-products',
      projection: projection(),
      readPort,
      commitPort: {
        commit: async () => ({
          ok: false,
          issue: { code: 'stale-base', message: 'Concurrent export advanced current.' }
        })
      }
    }),
    /Evidence products were not committed: stale-base/u
  )
})

test('maps explicit existing product targets to optimistic CAS candidates', async () => {
  const commits: ArtifactVersionCommitInputV1[] = []
  await commitEvidenceSnapshotProducts({
    request: {
      ...request,
      targets: {
        provJson: {
          artifactId: 'artifact:existing-prov',
          expectedCurrentVersionId: 'artifact-version:existing-prov-3'
        }
      }
    },
    engineThreadId: 'codex:thread-products',
    projection: projection(),
    readPort,
    commitPort: successfulCommit(commits)
  })
  const candidate = commits[0]?.candidates.find(
    (item) => item.candidateId === 'evidence-product:prov-json'
  )
  assert.equal(candidate?.artifactId, 'artifact:existing-prov')
  assert.equal(candidate?.expectedCurrentVersionId, 'artifact-version:existing-prov-3')
})

test('fails explicitly before commit when the dependency contract limit is exceeded', async () => {
  let reads = 0
  let commits = 0
  const refs = Array.from({ length: 1_025 }, (_, index): ArtifactVersionRefV1 => ({
    ...sourceRef,
    artifactId: `artifact:source-${index}`,
    versionId: `artifact-version:source-${index}`
  }))
  await assert.rejects(
    () => commitEvidenceSnapshotProducts({
      request,
      engineThreadId: 'codex:thread-products',
      projection: projection({ sourceArtifactVersionRefs: refs }),
      readPort: { read: async () => { reads += 1; throw new Error('must not read') } },
      commitPort: { commit: async () => { commits += 1; throw new Error('must not commit') } }
    }),
    /1024 exact source dependency limit/u
  )
  assert.equal(reads, 0)
  assert.equal(commits, 0)
})
