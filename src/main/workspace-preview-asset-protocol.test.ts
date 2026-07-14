import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_ASSET_SCHEME,
  workspacePreviewAssetSourceUrl,
  workspacePreviewSessionIdFromAssetUrl
} from '../shared/workspace-preview-asset-url'
import {
  installWorkspacePreviewAssetProtocol,
  registerWorkspacePreviewAssetScheme,
  type WorkspacePreviewAssetBackend,
  type WorkspacePreviewAssetProtocolApi
} from './workspace-preview-asset-protocol'

const bytes = Buffer.from('0123456789')

function backend(authorized = true): WorkspacePreviewAssetBackend {
  return {
    isSessionAuthorized: vi.fn(() => authorized),
    describeAsset: vi.fn(async () => ({
      ok: true as const,
      descriptor: {
        schemaVersion: 1 as const,
        sessionId: 'preview-session-1',
        assetId: 'asset:preview-session-1',
        pluginId: 'sequence-genomics',
        modality: 'sequence' as const,
        file: {
          name: 'genome.fa',
          relativePath: 'genome.fa',
          mimeType: 'text/x-fasta',
          size: bytes.length
        },
        primary: 'byte-range' as const,
        eagerRead: { allowed: false, reason: 'bounded transport' },
        range: {
          available: true,
          size: bytes.length,
          maxChunkBytes: 4,
          recommendedChunkBytes: 4
        },
        strategies: [{
          kind: 'byte-range' as const,
          status: 'available' as const,
          reason: 'bounded transport',
          maxChunkBytes: 4
        }]
      }
    })),
    readRange: vi.fn(async (_sessionId, range) => {
      const chunk = bytes.subarray(range.offset, range.offset + range.length)
      return {
        ok: true as const,
        sessionId: 'preview-session-1',
        assetId: 'asset:preview-session-1',
        offset: range.offset,
        length: chunk.length,
        size: bytes.length,
        dataBase64: chunk.toString('base64'),
        mimeType: 'text/x-fasta'
      }
    })
  }
}

function protocolHarness(): {
  api: WorkspacePreviewAssetProtocolApi
  handlers: Map<string, (request: Request) => Response | Promise<Response>>
} {
  const handlers = new Map<string, (request: Request) => Response | Promise<Response>>()
  return {
    handlers,
    api: {
      isProtocolHandled: (scheme) => handlers.has(scheme),
      handle: (scheme, handler) => {
        handlers.set(scheme, handler)
      }
    }
  }
}

describe('workspace preview asset protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers a secure, fetchable streaming scheme before app ready', () => {
    const registerSchemesAsPrivileged = vi.fn()

    registerWorkspacePreviewAssetScheme({ registerSchemesAsPrivileged })

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([{
      scheme: WORKSPACE_PREVIEW_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }])
  })

  it('builds session-scoped URLs and rejects malformed asset URLs', () => {
    expect(workspacePreviewAssetSourceUrl(' preview/a ')).toBe(
      'sciforge-preview://asset/preview%2Fa'
    )
    expect(workspacePreviewSessionIdFromAssetUrl(
      'sciforge-preview://asset/preview%2Fa'
    )).toBe('preview/a')
    expect(workspacePreviewSessionIdFromAssetUrl(
      'sciforge-preview://other/preview-1'
    )).toBeNull()
    expect(workspacePreviewSessionIdFromAssetUrl(
      'sciforge-preview://asset/preview-1/extra'
    )).toBeNull()
  })

  it('streams a single HTTP range in bounded host reads', async () => {
    const harness = protocolHarness()
    const previewBackend = backend()
    installWorkspacePreviewAssetProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(WORKSPACE_PREVIEW_ASSET_SCHEME)

    const response = await handler?.(new Request(
      'sciforge-preview://asset/preview-session-1',
      { headers: { Range: 'bytes=2-6' } }
    ))

    expect(response?.status).toBe(206)
    expect(response?.headers.get('content-range')).toBe('bytes 2-6/10')
    expect(response?.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await response!.arrayBuffer()).toString()).toBe('23456')
    expect(previewBackend.readRange).toHaveBeenNthCalledWith(
      1,
      'preview-session-1',
      { offset: 2, length: 4 }
    )
    expect(previewBackend.readRange).toHaveBeenNthCalledWith(
      2,
      'preview-session-1',
      { offset: 6, length: 1 }
    )
  })

  it('supports HEAD and CORS preflight without reading file bytes', async () => {
    const harness = protocolHarness()
    const previewBackend = backend()
    installWorkspacePreviewAssetProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(WORKSPACE_PREVIEW_ASSET_SCHEME)!

    const head = await handler(new Request(
      'sciforge-preview://asset/preview-session-1',
      { method: 'HEAD' }
    ))
    const options = await handler(new Request(
      'sciforge-preview://asset/preview-session-1',
      { method: 'OPTIONS', headers: { Origin: 'null' } }
    ))

    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-origin')).toBe('null')
    expect(options.headers.get('access-control-allow-headers')).toContain('Range')
    expect(previewBackend.readRange).not.toHaveBeenCalled()
  })

  it('rejects non-renderer origins instead of exposing wildcard CORS', async () => {
    const harness = protocolHarness()
    const previewBackend = backend()
    installWorkspacePreviewAssetProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(WORKSPACE_PREVIEW_ASSET_SCHEME)!

    const denied = await handler(new Request(
      'sciforge-preview://asset/preview-session-1',
      { headers: { Origin: 'https://untrusted.example' } }
    ))
    const localDev = await handler(new Request(
      'sciforge-preview://asset/preview-session-1',
      { method: 'HEAD', headers: { Origin: 'http://127.0.0.1:5173' } }
    ))

    expect(denied.status).toBe(403)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    expect(localDev.status).toBe(200)
    expect(localDev.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
  })

  it('does not reveal released sessions and rejects multi-range requests', async () => {
    const unauthorizedHarness = protocolHarness()
    installWorkspacePreviewAssetProtocol(unauthorizedHarness.api, backend(false))
    const unauthorized = await unauthorizedHarness.handlers.get(WORKSPACE_PREVIEW_ASSET_SCHEME)!(
      new Request('sciforge-preview://asset/preview-session-1')
    )
    expect(unauthorized.status).toBe(404)

    const rangeHarness = protocolHarness()
    installWorkspacePreviewAssetProtocol(rangeHarness.api, backend())
    const invalidRange = await rangeHarness.handlers.get(WORKSPACE_PREVIEW_ASSET_SCHEME)!(
      new Request('sciforge-preview://asset/preview-session-1', {
        headers: { Range: 'bytes=0-1,4-5' }
      })
    )
    expect(invalidRange.status).toBe(416)
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10')
  })
})
