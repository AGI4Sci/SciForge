import { describe, expect, it } from 'vitest'
import { projectDagEvidencePreviewResolvePayloadSchema } from './app-ipc-schemas'

describe('Project DAG evidence preview IPC schema', () => {
  it('accepts only opaque committed-provenance identifiers and project context', () => {
    expect(projectDagEvidencePreviewResolvePayloadSchema.parse({
      workspaceRoot: '/workspace/molclaw',
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'artifact-version:v1',
      sourceAnchorId: 'anchor:page-2'
    })).toMatchObject({ claimId: 'claim:target' })
    expect(() => projectDagEvidencePreviewResolvePayloadSchema.parse({
      workspaceRoot: '/workspace/molclaw',
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'artifact-version:v1',
      sourceAnchorId: 'anchor:page-2',
      locator: '../untrusted.txt'
    })).toThrow()
  })
})
