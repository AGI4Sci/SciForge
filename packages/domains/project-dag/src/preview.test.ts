import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  ProjectDagPreviewError,
  resolveProjectDagEvidencePreview
} from './preview.js'

const snapshotDigest = `project:${'d'.repeat(64)}`
const contentDigest = `sha256:${'e'.repeat(64)}`

test('preview resolves only the committed provenance tuple inside its workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'project-dag-preview-'))
  const path = join(workspace, 'paper.md')
  await writeFile(path, '# evidence')
  try {
    const result = await resolveProjectDagEvidencePreview(
      {
        workspaceRoot: workspace,
        snapshotDigest,
        claimId: 'claim-1',
        artifactVersionId: 'version-1',
        sourceAnchorId: 'anchor-1'
      },
      claim({ locator: 'paper.md' })
    )
    assert.equal(result.path, await realpath(path))
    assert.equal(result.contentDigest, contentDigest)
    assert.equal(result.selector.type, 'text')
  } finally {
    await rm(workspace, { recursive: true })
  }
})

test('preview rejects remote and mismatched provenance locators', async () => {
  await assert.rejects(
    resolveProjectDagEvidencePreview(
      {
        workspaceRoot: '/workspace',
        snapshotDigest,
        claimId: 'claim-1',
        artifactVersionId: 'version-1',
        sourceAnchorId: 'anchor-1'
      },
      claim({ locator: 'https://example.com/paper.pdf', availability: 'remote' })
    ),
    (error: unknown) =>
      error instanceof ProjectDagPreviewError &&
      error.code === 'unsupported_locator'
  )
  await assert.rejects(
    resolveProjectDagEvidencePreview(
      {
        workspaceRoot: '/workspace',
        snapshotDigest,
        claimId: 'different-claim',
        artifactVersionId: 'version-1',
        sourceAnchorId: 'anchor-1'
      },
      claim({ locator: 'paper.md' })
    ),
    (error: unknown) =>
      error instanceof ProjectDagPreviewError &&
      error.code === 'claim_mismatch'
  )
})

function claim(version: {
  locator: string
  availability?: string
}) {
  return {
    id: 'claim-1',
    provenance: {
      projectSnapshotDigest: snapshotDigest,
      access: { public: true },
      paths: [
        {
          sourceAssertions: [
            {
              artifactId: 'artifact-1',
              artifactVersionId: 'version-1',
              sourceAnchorId: 'anchor-1',
              artifact: {
                accessPolicy: { public: true }
              },
              artifactVersion: {
                versionId: 'version-1',
                locator: version.locator,
                availability: version.availability ?? 'available',
                contentDigest,
                mediaType: 'text/markdown'
              },
              sourceAnchor: {
                anchorId: 'anchor-1',
                accessPolicy: { public: true },
                selector: {
                  type: 'text',
                  section: 'Introduction'
                }
              }
            }
          ]
        }
      ]
    }
  }
}
