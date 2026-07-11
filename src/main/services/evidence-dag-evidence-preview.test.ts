import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEvidenceDagEvidencePreview } from './evidence-dag-evidence-preview'
import { resolveWorkspaceFile } from './workspace-service'

const roots: string[] = []

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

const request = {
  runtimeId: 'codex' as const,
  threadId: 'thread-1',
  snapshotDigest: 'sha256:pinned',
  sourceAssertionId: 'source_assertion:one',
  artifactVersionId: 'artifact-version:one',
  sourceAnchorId: 'anchor:one'
}

function evidence(overrides: {
  evidence?: Record<string, unknown>
  assertion?: Record<string, unknown>
  artifact?: Record<string, unknown>
  version?: Record<string, unknown>
  anchor?: Record<string, unknown>
} = {}): unknown {
  return {
    resolved: true,
    threadId: 'codex:thread-1',
    snapshotDigest: 'sha256:pinned',
    workspaceRoot: '/workspace/molclaw',
    accessPolicy: {},
    sourceAssertion: {
      id: 'source_assertion:one',
      type: 'source_assertion',
      artifact_id: 'artifact:one',
      artifact_version_id: 'artifact-version:one',
      source_anchor_id: 'anchor:one',
      ...overrides.assertion
    },
    artifact: {
      artifactId: 'artifact:one',
      accessPolicy: {},
      ...overrides.artifact
    },
    artifactVersion: {
      versionId: 'artifact-version:one',
      artifactId: 'artifact:one',
      locator: 'evidence/source.txt',
      contentDigest: sha('original bytes'),
      mediaType: 'text/plain',
      availability: 'available',
      ...overrides.version
    },
    sourceAnchor: {
      anchorId: 'anchor:one',
      artifactId: 'artifact:one',
      artifactVersionId: 'artifact-version:one',
      selector: { type: 'text', lineRange: '2:4', quote: 'original bytes' },
      anchorDigest: sha('original bytes'),
      accessPolicy: {},
      ...overrides.anchor
    },
    ...overrides.evidence
  }
}

async function fixture(contents = 'original bytes'): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'evidence-dag-preview-'))
  roots.push(root)
  await mkdir(join(root, 'evidence'))
  const path = join(root, 'evidence', 'source.txt')
  await writeFile(path, contents)
  return { root, path }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('trusted Evidence DAG evidence preview resolution', () => {
  it('resolves only the committed tuple locator and returns its required digest', async () => {
    const { root, path } = await fixture()
    const resolveFile = vi.fn(async () => ({ ok: true as const, path, kind: 'file' as const }))

    await expect(resolveEvidenceDagEvidencePreview(request, {
      engineThreadId: 'codex:thread-1',
      workspaceRoot: root,
      snapshotEvidence: evidence({ evidence: { workspaceRoot: root } }),
      resolveWorkspaceFile: resolveFile
    })).resolves.toMatchObject({
      ok: true,
      path,
      workspaceRoot: root,
      sourceAssertionId: 'source_assertion:one',
      selector: { type: 'text', lineRange: '2:4' },
      contentDigest: sha('original bytes')
    })
    expect(resolveFile).toHaveBeenCalledWith({
      path: 'evidence/source.txt',
      workspaceRoot: root
    })
  })

  it('rejects stale snapshots and every stale tuple component before path resolution', async () => {
    const resolveFile = vi.fn()
    for (const snapshotEvidence of [
      { resolved: false, code: 'snapshot_mismatch', message: 'stale snapshot' },
      evidence({ evidence: { snapshotDigest: 'sha256:other' } }),
      evidence({ assertion: { id: 'source_assertion:other' } }),
      evidence({ assertion: { artifact_version_id: 'artifact-version:other' } }),
      evidence({ assertion: { source_anchor_id: 'anchor:other' } }),
      evidence({ version: { artifactId: 'artifact:other' } }),
      evidence({ anchor: { artifactVersionId: 'artifact-version:other' } })
    ]) {
      const result = await resolveEvidenceDagEvidencePreview(request, {
        engineThreadId: 'codex:thread-1',
        workspaceRoot: '/workspace/molclaw',
        snapshotEvidence: typeof snapshotEvidence === 'object' && snapshotEvidence !== null &&
          'resolved' in snapshotEvidence && snapshotEvidence.resolved === true
          ? { ...snapshotEvidence, workspaceRoot: '/workspace/molclaw' }
          : snapshotEvidence,
        resolveWorkspaceFile: resolveFile
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['snapshot_mismatch', 'provenance_mismatch']).toContain(result.code)
    }
    expect(resolveFile).not.toHaveBeenCalled()
  })

  it('rejects a snapshot committed for a different workspace', async () => {
    const resolveFile = vi.fn()
    await expect(resolveEvidenceDagEvidencePreview(request, {
      engineThreadId: 'codex:thread-1',
      workspaceRoot: '/workspace/molclaw',
      snapshotEvidence: evidence({ evidence: { workspaceRoot: '/workspace/other' } }),
      resolveWorkspaceFile: resolveFile
    })).resolves.toMatchObject({ ok: false, code: 'snapshot_mismatch' })
    expect(resolveFile).not.toHaveBeenCalled()
  })

  it('rejects redacted and restricted thread, Artifact and SourceAnchor policies', async () => {
    const resolveFile = vi.fn()
    for (const snapshotEvidence of [
      evidence({ evidence: { accessPolicy: { redacted: true, read: true } } }),
      evidence({ artifact: { accessPolicy: { visibility: 'private' } } }),
      evidence({ anchor: { accessPolicy: { read: false } } }),
      evidence({ version: { availability: 'restricted' } })
    ]) {
      await expect(resolveEvidenceDagEvidencePreview(request, {
        engineThreadId: 'codex:thread-1',
        workspaceRoot: '/workspace/molclaw',
        snapshotEvidence: { ...snapshotEvidence as Record<string, unknown>, workspaceRoot: '/workspace/molclaw' },
        resolveWorkspaceFile: resolveFile
      })).resolves.toMatchObject({ ok: false, code: 'access_restricted' })
    }
    expect(resolveFile).not.toHaveBeenCalled()
  })

  it('rejects remote, runtime, trace, citation, UNC and home-expanded locators', async () => {
    const resolveFile = vi.fn()
    for (const locator of [
      'https://example.test/paper.pdf',
      'doi:10.1000/paper',
      'runtime:codex/thread-1/item-1',
      'trace:codex/thread-1/item-1',
      'citation:paper-1',
      '\\\\server\\share\\paper.pdf',
      '~/paper.pdf'
    ]) {
      await expect(resolveEvidenceDagEvidencePreview(request, {
        engineThreadId: 'codex:thread-1',
        workspaceRoot: '/workspace/molclaw',
        snapshotEvidence: evidence({ version: { locator } }),
        resolveWorkspaceFile: resolveFile
      })).resolves.toMatchObject({ ok: false, code: 'unsupported_locator' })
    }
    expect(resolveFile).not.toHaveBeenCalled()
  })

  it('rejects missing digests, traversal and symlink escapes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'evidence-dag-preview-boundary-'))
    roots.push(base)
    const root = join(base, 'workspace')
    await mkdir(join(root, 'evidence'), { recursive: true })
    const outside = join(base, 'secret.txt')
    await writeFile(outside, 'secret')
    await symlink(outside, join(root, 'evidence', 'linked.txt'))
    await writeFile(join(root, 'evidence', 'inside.txt'), 'inside')
    await symlink('inside.txt', join(root, 'evidence', 'linked-inside.txt'))

    await expect(resolveEvidenceDagEvidencePreview(request, {
      engineThreadId: 'codex:thread-1',
      workspaceRoot: root,
      snapshotEvidence: evidence({ evidence: { workspaceRoot: root }, version: { contentDigest: undefined } }),
      resolveWorkspaceFile
    })).resolves.toMatchObject({ ok: false, code: 'provenance_mismatch' })
    for (const locator of [
      '../secret.txt',
      'evidence/linked.txt',
      'evidence/linked-inside.txt'
    ]) {
      await expect(resolveEvidenceDagEvidencePreview(request, {
        engineThreadId: 'codex:thread-1',
        workspaceRoot: root,
        snapshotEvidence: evidence({
          evidence: { workspaceRoot: root },
          version: { locator, contentDigest: sha('secret') }
        }),
        resolveWorkspaceFile
      })).resolves.toMatchObject({ ok: false, code: 'file_unavailable' })
    }
  })

  it('does not hash file bytes before the WorkspacePreviewHost integrity check', async () => {
    const { root, path } = await fixture('changed bytes')
    await expect(resolveEvidenceDagEvidencePreview(request, {
      engineThreadId: 'codex:thread-1',
      workspaceRoot: root,
      snapshotEvidence: evidence({ evidence: { workspaceRoot: root } }),
      resolveWorkspaceFile: async () => ({ ok: true, path, kind: 'file' })
    })).resolves.toMatchObject({
      ok: true,
      contentDigest: sha('original bytes')
    })
  })
})
