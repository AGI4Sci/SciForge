import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_RESOURCE_CONTENT_SCHEME,
  capabilityResourceContentAccessFromUrl,
  capabilityResourceContentSourceUrl
} from '../shared/workspace-preview-asset-url'
import {
  installCapabilityResourceContentProtocol,
  registerCapabilityResourceContentScheme,
  type CapabilityResourceContentBackend,
  type WorkspacePreviewAssetProtocolApi
} from './workspace-preview-asset-protocol'

const bytes = Buffer.from('0123456789')
const access = {
  workspaceId: '/workspace',
  resource: {
    token: `cap_${'a'.repeat(32)}`,
    semanticRevision: '1',
    expiresAt: '2026-07-16T14:00:00.000Z'
  }
}
const sourceUrl = capabilityResourceContentSourceUrl(access)

function backend(): CapabilityResourceContentBackend {
  return {
    describe: vi.fn(async () => ({
      size: bytes.length,
      mimeType: 'text/x-fasta',
      fileName: 'genome.fa',
      maxChunkBytes: 4,
      recommendedChunkBytes: 4
    })),
    readRange: vi.fn(async (_access, range) => {
      const chunk = bytes.subarray(range.offset, range.offset + range.length)
      return {
        offset: range.offset,
        length: chunk.length,
        size: bytes.length,
        dataBase64: chunk.toString('base64')
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

    registerCapabilityResourceContentScheme({ registerSchemesAsPrivileged })

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([{
      scheme: CAPABILITY_RESOURCE_CONTENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }])
  })

  it('builds opaque capability resource URLs and rejects malformed access', () => {
    expect(capabilityResourceContentAccessFromUrl(sourceUrl)).toEqual(access)
    expect(capabilityResourceContentAccessFromUrl(
      'sciforge-resource://other?access=%7B%7D'
    )).toBeNull()
    expect(capabilityResourceContentAccessFromUrl(
      'sciforge-resource://content?access=%7B%7D'
    )).toBeNull()
  })

  it('streams a single HTTP range in bounded host reads', async () => {
    const harness = protocolHarness()
    const previewBackend = backend()
    installCapabilityResourceContentProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(CAPABILITY_RESOURCE_CONTENT_SCHEME)

    const response = await handler?.(new Request(
      sourceUrl,
      { headers: { Range: 'bytes=2-6' } }
    ))

    expect(response?.status).toBe(206)
    expect(response?.headers.get('content-range')).toBe('bytes 2-6/10')
    expect(response?.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await response!.arrayBuffer()).toString()).toBe('23456')
    expect(previewBackend.readRange).toHaveBeenNthCalledWith(
      1,
      access,
      { offset: 2, length: 4 }
    )
    expect(previewBackend.readRange).toHaveBeenNthCalledWith(
      2,
      access,
      { offset: 6, length: 1 }
    )
  })

  it('supports HEAD and CORS preflight without reading file bytes', async () => {
    const harness = protocolHarness()
    const previewBackend = backend()
    installCapabilityResourceContentProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(CAPABILITY_RESOURCE_CONTENT_SCHEME)!

    const head = await handler(new Request(
      sourceUrl,
      { method: 'HEAD' }
    ))
    const options = await handler(new Request(
      sourceUrl,
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
    installCapabilityResourceContentProtocol(harness.api, previewBackend)
    const handler = harness.handlers.get(CAPABILITY_RESOURCE_CONTENT_SCHEME)!

    const denied = await handler(new Request(
      sourceUrl,
      { headers: { Origin: 'https://untrusted.example' } }
    ))
    const localDev = await handler(new Request(
      sourceUrl,
      { method: 'HEAD', headers: { Origin: 'http://127.0.0.1:5173' } }
    ))

    expect(denied.status).toBe(403)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    expect(localDev.status).toBe(200)
    expect(localDev.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
  })

  it('rejects malformed resource access and multi-range requests', async () => {
    const malformedHarness = protocolHarness()
    installCapabilityResourceContentProtocol(malformedHarness.api, backend())
    const malformed = await malformedHarness.handlers.get(CAPABILITY_RESOURCE_CONTENT_SCHEME)!(
      new Request('sciforge-resource://content?access=%7B%7D')
    )
    expect(malformed.status).toBe(404)

    const rangeHarness = protocolHarness()
    installCapabilityResourceContentProtocol(rangeHarness.api, backend())
    const invalidRange = await rangeHarness.handlers.get(CAPABILITY_RESOURCE_CONTENT_SCHEME)!(
      new Request(sourceUrl, {
        headers: { Range: 'bytes=0-1,4-5' }
      })
    )
    expect(invalidRange.status).toBe(416)
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10')
  })
})
