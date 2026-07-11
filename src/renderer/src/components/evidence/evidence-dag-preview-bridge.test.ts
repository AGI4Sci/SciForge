import { describe, expect, it, vi } from 'vitest'
import {
  EVIDENCE_DAG_PREVIEW_REQUEST,
  EVIDENCE_DAG_PREVIEW_RESULT,
  handleEvidenceDagPreviewMessage,
  parseEvidenceDagPreviewRequest
} from './evidence-dag-preview-bridge'

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: EVIDENCE_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId: 'preview-1',
    threadId: 'codex:thread-1',
    snapshotDigest: 'sha256:snapshot',
    sourceAssertionId: 'source_assertion:1',
    artifactVersionId: 'artifact-version:1',
    sourceAnchorId: 'anchor:1',
    ...overrides
  }
}

function frame(): { window: WindowProxy; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  return { window: { postMessage } as unknown as WindowProxy, postMessage }
}

describe('Evidence DAG workspace preview bridge', () => {
  it('accepts only opaque Evidence provenance identifiers', () => {
    expect(parseEvidenceDagPreviewRequest(request())).toEqual(request())
    expect(parseEvidenceDagPreviewRequest(request({ locator: '../secret.txt' }))).toBeNull()
    expect(parseEvidenceDagPreviewRequest(request({ anchor: { kind: 'document', page: 1 } }))).toBeNull()
    expect(parseEvidenceDagPreviewRequest(request({ contentDigest: `sha256:${'a'.repeat(64)}` }))).toBeNull()
  })

  it('ignores a different source window or origin', async () => {
    const current = frame()
    const resolver = vi.fn()
    await expect(handleEvidenceDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:4897', source: frame().window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/?thread=thread-1',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: resolver
    })).resolves.toEqual({ status: 'ignored' })
    await expect(handleEvidenceDagPreviewMessage({
      event: { data: request(), origin: 'http://malicious.test', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/?thread=thread-1',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: resolver
    })).resolves.toEqual({ status: 'ignored' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('rejects stale thread and Snapshot requests before trusted resolution', async () => {
    const current = frame()
    const resolver = vi.fn()
    const staleThread = await handleEvidenceDagPreviewMessage({
      event: { data: request({ threadId: 'codex:thread-other' }), origin: 'http://127.0.0.1:4897', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: resolver
    })
    const staleSnapshot = await handleEvidenceDagPreviewMessage({
      event: { data: request({ snapshotDigest: 'sha256:old' }), origin: 'http://127.0.0.1:4897', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: resolver
    })
    expect(staleThread).toMatchObject({ status: 'rejected' })
    expect(staleSnapshot).toMatchObject({ status: 'rejected' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('opens only the trusted main result with Anchor, integrity and return context', async () => {
    const current = frame()
    const resolver = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/lab/papers/source.pdf',
      workspaceRoot: '/workspace/lab',
      runtimeId: 'codex' as const,
      threadId: 'thread-1',
      snapshotDigest: 'sha256:snapshot',
      sourceAssertionId: 'source_assertion:1',
      artifactVersionId: 'artifact-version:1',
      sourceAnchorId: 'anchor:1',
      selector: { type: 'pdf' as const, page: 4, quote: 'Supporting text' },
      contentDigest: `sha256:${'a'.repeat(64)}`
    }))
    const openPreview = vi.fn()
    const result = await handleEvidenceDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:4897', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/?thread=thread-1#token=secret',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: resolver,
      openPreview
    })

    expect(resolver).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest: 'sha256:snapshot',
      sourceAssertionId: 'source_assertion:1',
      artifactVersionId: 'artifact-version:1',
      sourceAnchorId: 'anchor:1'
    })
    expect(openPreview).toHaveBeenCalledWith({
      path: '/workspace/lab/papers/source.pdf',
      workspaceRoot: '/workspace/lab',
      anchor: { kind: 'document', id: 'anchor:1', page: 4, quote: 'Supporting text' },
      integrity: { algorithm: 'sha256', expectedDigest: `sha256:${'a'.repeat(64)}` },
      returnTo: {
        kind: 'evidence-dag',
        label: 'Evidence',
        nodeId: 'source_assertion:1',
        threadId: 'thread-1'
      }
    })
    expect(result).toMatchObject({ status: 'opened' })
    expect(current.postMessage).toHaveBeenCalledWith({
      type: EVIDENCE_DAG_PREVIEW_RESULT,
      version: 1,
      requestId: 'preview-1',
      ok: true
    }, 'http://127.0.0.1:4897')
  })

  it('does not open when trusted main rejects a runtime or remote locator', async () => {
    const current = frame()
    const openPreview = vi.fn()
    const result = await handleEvidenceDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:4897', source: current.window },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/',
      runtimeId: 'codex',
      currentThreadId: 'thread-1',
      expectedSnapshotDigest: 'sha256:snapshot',
      resolveEvidenceDagEvidencePreview: vi.fn(async () => ({
        ok: false as const,
        code: 'unsupported_locator' as const,
        message: 'Only local files are supported.'
      })),
      openPreview
    })
    expect(result).toEqual({
      status: 'rejected',
      message: '该来源是 runtime、citation 或远程引用，不能作为 workspace 文件打开。'
    })
    expect(openPreview).not.toHaveBeenCalled()
  })
})
