import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
  type WorkspacePreviewByteRange
} from '../shared/workspace-preview'
import type {
  CapabilityResourceContentAccess,
  CapabilityResourceContentDescriptor,
  CapabilityResourceContentRange
} from '../shared/capability-broker'
import {
  CAPABILITY_RESOURCE_CONTENT_SCHEME,
  capabilityResourceContentAccessFromUrl
} from '../shared/workspace-preview-asset-url'

type ProtocolHandler = (request: Request) => Response | Promise<Response>

export type WorkspacePreviewAssetProtocolApi = {
  handle: (scheme: string, handler: ProtocolHandler) => void
  isProtocolHandled: (scheme: string) => boolean
}

export type WorkspacePreviewAssetSchemeRegistrar = {
  registerSchemesAsPrivileged: (schemes: Electron.CustomScheme[]) => void
}

export type CapabilityResourceContentBackend = {
  describe: (
    access: CapabilityResourceContentAccess
  ) => CapabilityResourceContentDescriptor | Promise<CapabilityResourceContentDescriptor>
  readRange: (
    access: CapabilityResourceContentAccess,
    range: WorkspacePreviewByteRange
  ) => CapabilityResourceContentRange | Promise<CapabilityResourceContentRange>
}

type ParsedByteRange =
  | { ok: true; start: number; end: number }
  | { ok: false; message: string }

let activeBackend: CapabilityResourceContentBackend | null = null

export function registerCapabilityResourceContentScheme(
  registrar: WorkspacePreviewAssetSchemeRegistrar
): void {
  registrar.registerSchemesAsPrivileged([{
    scheme: CAPABILITY_RESOURCE_CONTENT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }])
}

export function installCapabilityResourceContentProtocol(
  protocolApi: WorkspacePreviewAssetProtocolApi,
  backend: CapabilityResourceContentBackend
): void {
  activeBackend = backend
  if (protocolApi.isProtocolHandled(CAPABILITY_RESOURCE_CONTENT_SCHEME)) return
  protocolApi.handle(CAPABILITY_RESOURCE_CONTENT_SCHEME, handleCapabilityResourceContentRequest)
}

export async function handleCapabilityResourceContentRequest(request: Request): Promise<Response> {
  const cors = corsHeaders(request)
  if (!cors) {
    return Response.json({ ok: false, message: 'Workspace preview origin is not allowed.' }, {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, 'Only GET and HEAD are supported.', cors, { Allow: 'GET, HEAD, OPTIONS' })
  }

  const access = capabilityResourceContentAccessFromUrl(request.url)
  const backend = activeBackend
  if (!access || !backend) {
    return errorResponse(404, 'Capability resource content was not found.', cors)
  }

  const descriptor = await backend.describe(access)

  const parsedRange = parseHttpByteRange(request.headers.get('range'), descriptor.size)
  if (parsedRange && !parsedRange.ok) {
    return errorResponse(416, parsedRange.message, cors, {
      'Content-Range': `bytes */${descriptor.size}`
    })
  }

  const start = parsedRange?.start ?? 0
  const end = parsedRange?.end ?? descriptor.size - 1
  const contentLength = descriptor.size === 0 ? 0 : Math.max(0, end - start + 1)
  const headers = new Headers(cors)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', descriptor.mimeType)
  headers.set('Content-Length', String(contentLength))
  if (parsedRange) headers.set('Content-Range', `bytes ${start}-${end}/${descriptor.size}`)

  const status = parsedRange ? 206 : 200
  if (request.method === 'HEAD' || contentLength === 0) {
    return new Response(null, { status, headers })
  }

  const chunkBytes = Math.max(1, Math.min(
    descriptor.recommendedChunkBytes || WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
    descriptor.maxChunkBytes || WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
    WORKSPACE_PREVIEW_MAX_RANGE_BYTES
  ))
  let offset = start
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > end) {
        controller.close()
        return
      }
      const length = Math.min(chunkBytes, end - offset + 1)
      const result = await backend.readRange(access, { offset, length })
      const chunk = Buffer.from(result.dataBase64, 'base64')
      if (chunk.length === 0) {
        controller.error(new Error('Workspace preview asset ended before the requested byte range.'))
        return
      }
      const boundedChunk = chunk.length > length ? chunk.subarray(0, length) : chunk
      offset += boundedChunk.length
      controller.enqueue(boundedChunk)
      if (offset > end) controller.close()
    }
  })
  return new Response(stream, { status, headers })
}

function parseHttpByteRange(value: string | null, size: number): ParsedByteRange | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match) return { ok: false, message: 'Only a single bytes range is supported.' }
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { ok: false, message: 'Byte range is empty.' }
  if (size <= 0) return { ok: false, message: 'Byte range is not satisfiable.' }

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false, message: 'Byte range suffix is invalid.' }
    }
    return { ok: true, start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { ok: false, message: 'Byte range is not satisfiable.' }
  }
  return { ok: true, start, end: Math.min(end, size - 1) }
}

function corsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin')?.trim() ?? ''
  if (origin && !isAllowedRendererOrigin(origin)) return null
  return {
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {})
  }
}

function isAllowedRendererOrigin(origin: string): boolean {
  if (origin === 'null' || origin === 'file://' || origin === 'sciforge://app') return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1' ||
        parsed.hostname === '[::1]')
  } catch {
    return false
  }
}

function errorResponse(
  status: number,
  message: string,
  cors: Record<string, string>,
  additionalHeaders: Record<string, string> = {}
): Response {
  return Response.json({ ok: false, message }, {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      ...additionalHeaders
    }
  })
}
