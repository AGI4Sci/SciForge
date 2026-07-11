import { describe, expect, it, vi } from 'vitest'
import {
  handleProjectDagPreviewMessage,
  parseProjectDagPreviewRequest,
  PROJECT_DAG_PREVIEW_REQUEST,
  PROJECT_DAG_PREVIEW_RESULT,
  projectDagSelectorAnchor
} from './project-dag-preview-bridge'

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: PROJECT_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId: 'preview-1',
    artifactVersionId: 'artifact-version:paper-v1',
    sourceAnchorId: 'anchor:page-4',
    claim: { id: 'claim:target', snapshotDigest: 'project:current' },
    ...overrides
  }
}

function frame(): { window: WindowProxy; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  return { window: { postMessage } as unknown as WindowProxy, postMessage }
}

describe('Project DAG workspace preview bridge', () => {
  it('accepts only opaque provenance identifiers from the iframe', () => {
    expect(parseProjectDagPreviewRequest(request())).toEqual({
      type: PROJECT_DAG_PREVIEW_REQUEST,
      version: 1,
      requestId: 'preview-1',
      artifactVersionId: 'artifact-version:paper-v1',
      sourceAnchorId: 'anchor:page-4',
      claim: { id: 'claim:target', snapshotDigest: 'project:current' }
    })
    expect(parseProjectDagPreviewRequest(request({ locator: '../secret.txt' }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({ anchor: { kind: 'document', page: 1 } }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({ contentDigest: `sha256:${'a'.repeat(64)}` }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({ graphNodeId: 'evidence:source-1' })))
      .toMatchObject({ graphNodeId: 'evidence:source-1' })
    expect(parseProjectDagPreviewRequest(request({ graphNodeId: 'evidence source' }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({ graphNodeId: `evidence:${'a'.repeat(512)}` }))).toBeNull()
  })

  it('maps persisted SourceSelector ranges returned by trusted main', () => {
    expect(projectDagSelectorAnchor(
      { type: 'text', lineRange: '40:57', quote: 'bounded quote' },
      'anchor:text'
    )).toEqual({ kind: 'text', line: 40, endLine: 57 })
    expect(projectDagSelectorAnchor(
      { type: 'table', table: 'results', rowRange: '120:180', columnNames: ['sample_id', 'score'] },
      'anchor:table'
    )).toEqual({
      kind: 'tabular',
      sheet: 'results',
      rowStart: 120,
      rowEnd: 180,
      columnStart: 0,
      columnEnd: 0
    })
    expect(projectDagSelectorAnchor(
      { type: 'pdf', page: 4, quote: 'Supporting text' },
      'anchor:pdf'
    )).toEqual({ kind: 'document', id: 'anchor:pdf', page: 4, quote: 'Supporting text' })
  })

  it('ignores messages not sent by the current iframe at its exact origin', async () => {
    const current = frame()
    const resolver = vi.fn()
    const openPreview = vi.fn()
    await expect(handleProjectDagPreviewMessage({
      event: {
        data: request(),
        origin: 'http://127.0.0.1:3898',
        source: frame().window
      },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      expectedSnapshotDigest: 'project:current',
      resolveProjectDagEvidencePreview: resolver,
      openPreview
    })).resolves.toEqual({ status: 'ignored' })
    await expect(handleProjectDagPreviewMessage({
      event: { data: request(), origin: 'http://malicious.test', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      expectedSnapshotDigest: 'project:current',
      resolveProjectDagEvidencePreview: resolver,
      openPreview
    })).resolves.toEqual({ status: 'ignored' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('opens only the path, selector and digest returned by trusted main', async () => {
    const current = frame()
    const resolver = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/molclaw/papers/source.pdf',
      workspaceRoot: '/workspace/molclaw',
      snapshotDigest: 'project:current',
      claimId: 'claim:target',
      artifactId: 'artifact:paper',
      artifactVersionId: 'artifact-version:paper-v1',
      sourceAnchorId: 'anchor:page-4',
      selector: { type: 'pdf' as const, page: 4, quote: 'A bounded source quote.' },
      contentDigest: `sha256:${'a'.repeat(64)}`
    }))
    const openPreview = vi.fn()
    const result = await handleProjectDagPreviewMessage({
      event: {
        data: request({ graphNodeId: 'evidence:source-1' }),
        origin: 'http://127.0.0.1:3898',
        source: current.window
      },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:3898/?view=home#token=secret',
      workspaceRoot: '/workspace/molclaw',
      projectRoot: '/workspace/molclaw',
      expectedSnapshotDigest: 'project:current',
      resolveProjectDagEvidencePreview: resolver,
      openPreview
    })

    expect(resolver).toHaveBeenCalledWith({
      workspaceRoot: '/workspace/molclaw',
      projectRoot: '/workspace/molclaw',
      snapshotDigest: 'project:current',
      claimId: 'claim:target',
      artifactVersionId: 'artifact-version:paper-v1',
      sourceAnchorId: 'anchor:page-4'
    })
    expect(openPreview).toHaveBeenCalledWith({
      path: '/workspace/molclaw/papers/source.pdf',
      workspaceRoot: '/workspace/molclaw',
      anchor: {
        kind: 'document', id: 'anchor:page-4', page: 4, quote: 'A bounded source quote.'
      },
      integrity: { algorithm: 'sha256', expectedDigest: `sha256:${'a'.repeat(64)}` },
      returnTo: {
        kind: 'project-dag',
        label: 'Project DAG',
        claimId: 'claim:target',
        nodeId: 'evidence:source-1'
      }
    })
    expect(result).toMatchObject({ status: 'opened' })
    expect(current.postMessage).toHaveBeenCalledWith({
      type: PROJECT_DAG_PREVIEW_RESULT,
      version: 1,
      requestId: 'preview-1',
      ok: true
    }, 'http://127.0.0.1:3898')
  })

  it('rejects stale Snapshot messages before invoking trusted main', async () => {
    const current = frame()
    const resolver = vi.fn()
    const result = await handleProjectDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:3898', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      expectedSnapshotDigest: 'project:newer',
      resolveProjectDagEvidencePreview: resolver
    })
    expect(result).toMatchObject({ status: 'rejected' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('translates trusted resolver failures without exposing its technical message', async () => {
    const current = frame()
    const resolver = vi.fn(async () => ({
      ok: false as const,
      code: 'file_unavailable' as const,
      message: 'The evidence file does not exist.'
    }))
    const openPreview = vi.fn()
    const result = await handleProjectDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:3898', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      expectedSnapshotDigest: 'project:current',
      resolveProjectDagEvidencePreview: resolver,
      openPreview
    })
    expect(result).toEqual({
      status: 'rejected',
      message: '证据文件不存在或当前不可访问。'
    })
    expect(openPreview).not.toHaveBeenCalled()
  })
})
