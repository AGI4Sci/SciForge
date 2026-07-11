import { describe, expect, it } from 'vitest'
import { evidenceDagEvidencePreviewResolvePayloadSchema } from './app-ipc-schemas'

describe('Evidence DAG evidence preview IPC schema', () => {
  it('accepts only runtime and committed-provenance identities', () => {
    const snapshotDigest = `sha256:${'a'.repeat(64)}`
    expect(evidenceDagEvidencePreviewResolvePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      snapshotDigest: ` ${snapshotDigest} `,
      sourceAssertionId: ' source_assertion:one ',
      artifactVersionId: ' artifact-version:v1 ',
      sourceAnchorId: ' anchor:line-2 '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest,
      sourceAssertionId: 'source_assertion:one',
      artifactVersionId: 'artifact-version:v1',
      sourceAnchorId: 'anchor:line-2'
    })
  })

  it('rejects renderer-supplied workspace paths, locators, selectors and digests', () => {
    const base = {
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest: `sha256:${'a'.repeat(64)}`,
      sourceAssertionId: 'source_assertion:one',
      artifactVersionId: 'artifact-version:v1',
      sourceAnchorId: 'anchor:line-2'
    }
    for (const untrusted of [
      { workspaceRoot: '/tmp/other' },
      { locator: '../secret.txt' },
      { selector: { type: 'text', lineRange: '1:2' } },
      { contentDigest: `sha256:${'a'.repeat(64)}` }
    ]) {
      expect(() => evidenceDagEvidencePreviewResolvePayloadSchema.parse({
        ...base,
        ...untrusted
      })).toThrow()
    }
    expect(() => evidenceDagEvidencePreviewResolvePayloadSchema.parse({
      ...base,
      snapshotDigest: 'sha256:not-a-digest'
    })).toThrow()
  })
})
