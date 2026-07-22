import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import type {
  WorkspaceFileTarget,
  WorkspaceHtmlPreviewResult
} from '../../shared/workspace-file'
import {
  canonicalPath,
  expandHomePath,
  resolveOpenTargetPath
} from '@sciforge/domain-sdk/node/workspace-paths'

type PreviewServerRecord = {
  root: string
  token: string
  server: Server
  port: number
}

const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
  ['.wasm', 'application/wasm'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.pdf', 'application/pdf']
])

export class WorkspaceHtmlPreviewService {
  private readonly servers = new Map<string, PreviewServerRecord>()

  async preview(input: WorkspaceFileTarget): Promise<WorkspaceHtmlPreviewResult> {
    try {
      const targetPath = await resolveOpenTargetPath(input.path, input.workspaceRoot)
      const fileInfo = await stat(targetPath)
      if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot preview a directory as HTML.' }
      if (!HTML_EXTENSIONS.has(extname(targetPath).toLowerCase())) {
        return { ok: false, message: 'Only .html and .htm files can be served as HTML previews.' }
      }

      const workspaceRoot = await this.resolveWorkspaceRoot(input, targetPath)
      const previewRoot = await this.resolvePreviewRoot(workspaceRoot, targetPath)
      const server = await this.serverForRoot(previewRoot)
      const relativePath = relative(previewRoot, targetPath).split('\\').join('/')
      const url = new URL(
        `http://127.0.0.1:${server.port}/${server.token}/${encodePathSegments(relativePath)}`
      )
      url.searchParams.set('sciforge_preview', String(Math.floor(fileInfo.mtimeMs)))

      return {
        ok: true,
        path: targetPath,
        workspaceRoot,
        url: url.toString(),
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async close(): Promise<void> {
    const records = [...this.servers.values()]
    this.servers.clear()
    await Promise.all(records.map((record) => closeServer(record.server)))
  }

  private async resolveWorkspaceRoot(input: WorkspaceFileTarget, targetPath: string): Promise<string> {
    const rawRoot = input.workspaceRoot?.trim()
    if (!rawRoot) throw new Error('Workspace root is required.')
    const root = await canonicalPath(resolve(expandHomePath(rawRoot)))
    const canonicalTarget = await canonicalPath(targetPath)
    if (!isWithin(root, canonicalTarget)) {
      throw new Error('Path must stay within the selected workspace.')
    }
    return root
  }

  private async resolvePreviewRoot(workspaceRoot: string, targetPath: string): Promise<string> {
    const root = await canonicalPath(dirname(targetPath))
    if (!isWithin(workspaceRoot, root)) {
      throw new Error('Path must stay within the selected workspace.')
    }
    return root
  }

  private async serverForRoot(root: string): Promise<PreviewServerRecord> {
    const existing = this.servers.get(root)
    if (existing) return existing

    const token = createPreviewToken()
    const server = createServer((request, response) => {
      void this.handleRequest(root, token, request, response)
    })
    const record = await listen(server, root, token)
    this.servers.set(root, record)
    return record
  }

  private async handleRequest(
    root: string,
    token: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendText(response, 405, 'Method not allowed')
        return
      }
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const tokenizedPath = parseTokenizedPath(requestUrl.pathname)
      if (!tokenizedPath || tokenizedPath.token !== token) {
        sendText(response, 403, 'Invalid HTML preview token')
        return
      }
      const requestedPath = tokenizedPath.path
      const targetPath = await resolveServedPath(root, requestedPath)
      const fileInfo = await stat(targetPath)
      if (fileInfo.isDirectory()) {
        const indexPath = resolve(targetPath, 'index.html')
        await access(indexPath)
        return this.streamFile(indexPath, request, response)
      }
      await this.streamFile(targetPath, request, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendText(response, message.includes('workspace') || message.includes('preview') ? 403 : 404, message)
    }
  }

  private async streamFile(
    targetPath: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const fileInfo = await stat(targetPath)
    if (!fileInfo.isFile()) {
      sendText(response, 404, 'Not found')
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', contentType(targetPath))
    response.setHeader('Content-Length', String(fileInfo.size))
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(targetPath)
      .on('error', () => {
        if (!response.headersSent) sendText(response, 500, 'Failed to read file')
        else response.destroy()
      })
      .pipe(response)
  }
}

export const workspaceHtmlPreviewService = new WorkspaceHtmlPreviewService()

function listen(server: Server, root: string, token: string): Promise<PreviewServerRecord> {
  return new Promise((resolveRecord, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        reject(new Error('HTML preview server did not report a port.'))
        return
      }
      resolveRecord({ root, token, server, port })
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

function createPreviewToken(): string {
  return randomBytes(24).toString('base64url')
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()))
}

async function resolveServedPath(root: string, requestPath: string): Promise<string> {
  const normalized = requestPath.replace(/^\/+/u, '')
  const targetPath = resolve(root, normalized || 'index.html')
  if (!isWithin(root, targetPath)) {
    throw new Error('Path must stay within the selected preview directory.')
  }
  const canonicalTarget = await canonicalPath(targetPath)
  if (!isWithin(root, canonicalTarget)) {
    throw new Error('Path must stay within the selected preview directory.')
  }
  return canonicalTarget
}

function parseTokenizedPath(pathname: string): { token: string; path: string } | null {
  const decoded = decodePathname(pathname).replace(/^\/+/u, '')
  const [token, ...pathParts] = decoded.split('/')
  if (!token) return null
  return { token, path: pathParts.join('/') }
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function encodePathSegments(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function isWithin(root: string, targetPath: string): boolean {
  const rel = relative(root, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function contentType(targetPath: string): string {
  return MIME_TYPES.get(extname(targetPath).toLowerCase()) ?? 'application/octet-stream'
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
  const body = `${message}\n`
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(body)
}
