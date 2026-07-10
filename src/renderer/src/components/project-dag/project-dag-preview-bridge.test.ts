import { describe, expect, it, vi } from 'vitest'
import {
  handleProjectDagPreviewMessage,
  parseProjectDagPreviewRequest,
  PROJECT_DAG_PREVIEW_REQUEST,
  PROJECT_DAG_PREVIEW_RESULT,
  resolveProjectDagWorkspaceLocator
} from './project-dag-preview-bridge'

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: PROJECT_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId: 'preview-1',
    locator: 'papers/source.pdf',
    artifactId: 'artifact:paper',
    artifactVersionId: 'artifact-version:paper-v1',
    sourceAnchorId: 'anchor:page-4',
    anchor: {
      kind: 'document',
      id: 'anchor:page-4',
      page: 4,
      quote: 'A bounded source quote.'
    },
    claim: {
      id: 'claim:target',
      statement: 'Target is active.',
      snapshotDigest: 'project:current'
    },
    ...overrides
  }
}

describe('Project DAG workspace preview bridge', () => {
  it('parses only the versioned strict request schema and bounded anchors', () => {
    expect(parseProjectDagPreviewRequest(request())).toMatchObject({
      requestId: 'preview-1',
      locator: 'papers/source.pdf',
      anchor: { kind: 'document', page: 4 },
      claim: { id: 'claim:target' }
    })
    expect(parseProjectDagPreviewRequest(request({ unexpected: true }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({
      anchor: { kind: 'document', page: 4, html: '<script>' }
    }))).toBeNull()
    expect(parseProjectDagPreviewRequest(request({ locator: 'x'.repeat(4_097) }))).toBeNull()
  })

  it('accepts only normalized local files below the active workspace', () => {
    expect(resolveProjectDagWorkspaceLocator(
      'papers/../outputs/result.pdf',
      '/workspace/molclaw'
    )).toBe('/workspace/molclaw/outputs/result.pdf')
    expect(resolveProjectDagWorkspaceLocator(
      '/workspace/molclaw/papers/source.pdf',
      '/workspace/molclaw'
    )).toBe('/workspace/molclaw/papers/source.pdf')
    expect(resolveProjectDagWorkspaceLocator('../secret.txt', '/workspace/molclaw')).toBeNull()
    expect(resolveProjectDagWorkspaceLocator('/workspace/molclaw-old/secret.txt', '/workspace/molclaw')).toBeNull()
    expect(resolveProjectDagWorkspaceLocator('https://example.test/paper.pdf', '/workspace/molclaw')).toBeNull()
    expect(resolveProjectDagWorkspaceLocator('runtime:thread:item', '/workspace/molclaw')).toBeNull()
    expect(resolveProjectDagWorkspaceLocator('file:///etc/passwd', '/workspace/molclaw')).toBeNull()
  })

  it('ignores messages not sent by the current iframe at its exact origin', async () => {
    const frameWindow = { postMessage: vi.fn() } as unknown as WindowProxy
    const resolveWorkspaceFile = vi.fn()
    const openPreview = vi.fn()

    await expect(handleProjectDagPreviewMessage({
      event: {
        data: request(),
        origin: 'http://127.0.0.1:3898',
        source: { postMessage: vi.fn() } as unknown as MessageEventSource
      },
      frameWindow,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      resolveWorkspaceFile,
      openPreview
    })).resolves.toEqual({ status: 'ignored' })

    await expect(handleProjectDagPreviewMessage({
      event: { data: request(), origin: 'http://malicious.test', source: frameWindow },
      frameWindow,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      resolveWorkspaceFile,
      openPreview
    })).resolves.toEqual({ status: 'ignored' })
    expect(resolveWorkspaceFile).not.toHaveBeenCalled()
    expect(openPreview).not.toHaveBeenCalled()
  })

  it('resolves the local file before opening it with its Anchor and return context', async () => {
    const postMessage = vi.fn()
    const frameWindow = { postMessage } as unknown as WindowProxy
    const resolveWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/molclaw/papers/source.pdf',
      kind: 'file' as const
    }))
    const openPreview = vi.fn()

    const result = await handleProjectDagPreviewMessage({
      event: { data: request(), origin: 'http://127.0.0.1:3898', source: frameWindow },
      frameWindow,
      frameUrl: 'http://127.0.0.1:3898/?view=home#token=secret',
      workspaceRoot: '/workspace/molclaw',
      resolveWorkspaceFile,
      openPreview
    })

    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: '/workspace/molclaw/papers/source.pdf',
      workspaceRoot: '/workspace/molclaw'
    })
    expect(openPreview).toHaveBeenCalledWith({
      path: '/workspace/molclaw/papers/source.pdf',
      workspaceRoot: '/workspace/molclaw',
      anchor: {
        kind: 'document',
        id: 'anchor:page-4',
        page: 4,
        quote: 'A bounded source quote.'
      },
      returnTo: {
        kind: 'project-dag',
        label: '返回 Claim',
        claimId: 'claim:target'
      }
    })
    expect(result).toMatchObject({ status: 'opened' })
    expect(postMessage).toHaveBeenCalledWith({
      type: PROJECT_DAG_PREVIEW_RESULT,
      version: 1,
      requestId: 'preview-1',
      ok: true
    }, 'http://127.0.0.1:3898')
  })

  it('rejects traversal before resolution and reports the failure to the iframe', async () => {
    const postMessage = vi.fn()
    const frameWindow = { postMessage } as unknown as WindowProxy
    const resolveWorkspaceFile = vi.fn()
    const openPreview = vi.fn()

    const result = await handleProjectDagPreviewMessage({
      event: {
        data: request({ locator: '../outside/secret.txt' }),
        origin: 'http://127.0.0.1:3898',
        source: frameWindow
      },
      frameWindow,
      frameUrl: 'http://127.0.0.1:3898/?view=home',
      workspaceRoot: '/workspace/molclaw',
      resolveWorkspaceFile,
      openPreview
    })

    expect(result).toMatchObject({ status: 'rejected' })
    expect(resolveWorkspaceFile).not.toHaveBeenCalled()
    expect(openPreview).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: PROJECT_DAG_PREVIEW_RESULT,
      requestId: 'preview-1',
      ok: false
    }), 'http://127.0.0.1:3898')
  })
})
