import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { resolveProjectDagEvidencePreview } from './project-dag-evidence-preview'
import { resolveWorkspaceFile } from './workspace-service'

const roots: string[] = []

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function detail(contentDigest: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'claim:target',
    provenance: {
      projectSnapshotDigest: 'project:pinned',
      access: { level: 'public', redacted: false, authorized: false },
      paths: [{
        sourceAssertions: [{
          sourceAssertionId: 'source:one',
          artifactId: 'artifact:one',
          artifactVersionId: 'version:one',
          sourceAnchorId: 'anchor:one',
          artifact: { artifactId: 'artifact:one', availability: 'available', accessPolicy: {} },
          artifactVersion: {
            versionId: 'version:one',
            locator: 'evidence/source.txt',
            contentDigest,
            mediaType: 'text/plain'
          },
          sourceAnchor: {
            anchorId: 'anchor:one',
            selector: { type: 'text', lineRange: '2:4', quote: 'measured effect' },
            anchorDigest: sha('measured effect'),
            accessPolicy: {}
          },
          ...overrides
        }]
      }]
    }
  }
}

async function fixture(contents = 'measured effect'): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'project-dag-preview-'))
  roots.push(root)
  await mkdir(join(root, 'evidence'))
  const path = join(root, 'evidence', 'source.txt')
  await writeFile(path, contents)
  return { root, path }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('trusted Project DAG evidence preview resolution', () => {
  it('resolves a tuple from pinned provenance and returns the expected content digest', async () => {
    const { root, path } = await fixture()
    const resolveWorkspaceFile = vi.fn(async () => ({ ok: true as const, path, kind: 'file' as const }))

    await expect(resolveProjectDagEvidencePreview({
      workspaceRoot: root,
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'version:one',
      sourceAnchorId: 'anchor:one'
    }, {
      claimDetail: detail(sha('measured effect')),
      resolveWorkspaceFile
    })).resolves.toMatchObject({
      ok: true,
      path,
      selector: { type: 'text', lineRange: '2:4' },
      contentDigest: sha('measured effect')
    })
    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: 'evidence/source.txt',
      workspaceRoot: root
    })
  })

  it('rejects stale snapshots and tuples before resolving a workspace path', async () => {
    const resolveWorkspaceFile = vi.fn()
    const input = {
      workspaceRoot: '/workspace/molclaw',
      snapshotDigest: 'project:stale',
      claimId: 'claim:target',
      artifactVersionId: 'version:one',
      sourceAnchorId: 'anchor:one'
    }
    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: detail(sha('measured effect')),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'snapshot_mismatch' })
    await expect(resolveProjectDagEvidencePreview({
      ...input,
      snapshotDigest: 'project:pinned',
      sourceAnchorId: 'anchor:other'
    }, {
      claimDetail: detail(sha('measured effect')),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'provenance_mismatch' })
    await expect(resolveProjectDagEvidencePreview({
      ...input,
      snapshotDigest: 'project:pinned',
      claimId: 'claim:other'
    }, {
      claimDetail: detail(sha('measured effect')),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'claim_mismatch' })
    await expect(resolveProjectDagEvidencePreview({
      ...input,
      snapshotDigest: 'project:pinned',
      artifactVersionId: 'version:other'
    }, {
      claimDetail: detail(sha('measured effect')),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'provenance_mismatch' })
    expect(resolveWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects restricted provenance and remote locators', async () => {
    const resolveWorkspaceFile = vi.fn()
    const input = {
      workspaceRoot: '/workspace/molclaw',
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'version:one',
      sourceAnchorId: 'anchor:one'
    }
    const restricted = detail(sha('measured effect'), {
      artifact: { artifactId: 'artifact:one', availability: 'restricted', accessPolicy: { read: false } }
    })
    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: restricted,
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'access_restricted' })
    const redacted = detail(sha('measured effect')) as {
      provenance: { access: { level: string; redacted: boolean } }
    }
    redacted.provenance.access = { level: 'restricted', redacted: true }
    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: redacted,
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'access_restricted' })
    const remote = detail(sha('measured effect'), {
      artifactVersion: {
        versionId: 'version:one', locator: 'https://example.test/paper.pdf',
        contentDigest: sha('measured effect')
      }
    })
    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: remote,
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'unsupported_locator' })
    expect(resolveWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the expected digest for the preview host to verify exactly once', async () => {
    const { root, path } = await fixture('changed bytes')
    await expect(resolveProjectDagEvidencePreview({
      workspaceRoot: root,
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'version:one',
      sourceAnchorId: 'anchor:one'
    }, {
      claimDetail: detail(sha('original bytes')),
      resolveWorkspaceFile: async () => ({ ok: true, path, kind: 'file' })
    })).resolves.toMatchObject({
      ok: true,
      path,
      contentDigest: sha('original bytes')
    })
  })

  it('rejects traversal and symlink escape through the canonical workspace resolver', async () => {
    const base = await mkdtemp(join(tmpdir(), 'project-dag-preview-boundary-'))
    roots.push(base)
    const root = join(base, 'workspace')
    await mkdir(join(root, 'evidence'), { recursive: true })
    const outside = join(base, 'secret.txt')
    await writeFile(outside, 'secret')
    await symlink(outside, join(root, 'evidence', 'linked.txt'))
    const input = {
      workspaceRoot: root,
      snapshotDigest: 'project:pinned',
      claimId: 'claim:target',
      artifactVersionId: 'version:one',
      sourceAnchorId: 'anchor:one'
    }

    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: detail(sha('secret'), {
        artifactVersion: {
          versionId: 'version:one', locator: '../secret.txt', contentDigest: sha('secret')
        }
      }),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'file_unavailable' })
    await expect(resolveProjectDagEvidencePreview(input, {
      claimDetail: detail(sha('secret'), {
        artifactVersion: {
          versionId: 'version:one', locator: 'evidence/linked.txt', contentDigest: sha('secret')
        }
      }),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'file_unavailable' })
  })
})
