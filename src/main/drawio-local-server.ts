import { createReadStream, existsSync, statSync, type Stats } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'

export type LocalDrawioServerResult =
  | {
      ok: true
      url: string
      assetRoot: string
      port: number
      source: 'env' | 'project' | 'resources'
    }
  | {
      ok: false
      message: string
      checkedPaths: string[]
    }

type LocalDrawioServer = Extract<LocalDrawioServerResult, { ok: true }> & {
  server: Server
}

type StartLocalDrawioServerOptions = {
  appPath: string
  resourcesPath: string
  env?: NodeJS.ProcessEnv
}

const DRAWIO_EMBED_QUERY = '?embed=1&proto=json&spin=1&ui=min&libraries=1&saveAndExit=0&noSaveBtn=1'

let activeServer: LocalDrawioServer | null = null
let lastFailure: Extract<LocalDrawioServerResult, { ok: false }> | null = null

function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    default:
      return 'application/octet-stream'
  }
}

function sendPlain(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(message)
}

function isWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep)
}

function resolveCandidatePath(assetRoot: string, pathname: string): { path: string; stat: Stats } | null {
  let decoded = '/'
  try {
    decoded = decodeURIComponent(pathname || '/')
  } catch {
    return null
  }
  const requested = decoded === '/' ? '/index.html' : decoded
  const target = resolve(assetRoot, `.${requested}`)
  if (!isWithinRoot(assetRoot, target) || !existsSync(target)) return null
  const stat = statSync(target)
  if (stat.isDirectory()) {
    const indexPath = join(target, 'index.html')
    if (!isWithinRoot(assetRoot, indexPath) || !existsSync(indexPath)) return null
    return { path: indexPath, stat: statSync(indexPath) }
  }
  return { path: target, stat }
}

function resolveAssetRoot(options: StartLocalDrawioServerOptions): {
  assetRoot: string
  source: 'env' | 'project' | 'resources'
  checkedPaths: string[]
} | null {
  const candidates: Array<{ source: 'env' | 'project' | 'resources'; path: string | undefined }> = [
    { source: 'env', path: options.env?.SCIFORGE_DRAWIO_WEBAPP_DIR },
    { source: 'project', path: join(options.appPath, '.sciforge', 'drawio-webapp') },
    { source: 'resources', path: join(options.resourcesPath, 'drawio-webapp') }
  ]
  const checkedPaths: string[] = []
  for (const candidate of candidates) {
    if (!candidate.path) continue
    const assetRoot = resolve(candidate.path)
    checkedPaths.push(assetRoot)
    if (existsSync(join(assetRoot, 'index.html'))) {
      return { assetRoot, source: candidate.source, checkedPaths }
    }
  }
  return null
}

export async function startLocalDrawioServer(
  options: StartLocalDrawioServerOptions
): Promise<LocalDrawioServerResult> {
  if (activeServer) return {
    ok: true,
    url: activeServer.url,
    assetRoot: activeServer.assetRoot,
    port: activeServer.port,
    source: activeServer.source
  }

  const resolved = resolveAssetRoot(options)
  if (!resolved) {
    const checkedPaths = [
      ...(options.env?.SCIFORGE_DRAWIO_WEBAPP_DIR ? [resolve(options.env.SCIFORGE_DRAWIO_WEBAPP_DIR)] : []),
      resolve(join(options.appPath, '.sciforge', 'drawio-webapp')),
      resolve(join(options.resourcesPath, 'drawio-webapp'))
    ]
    lastFailure = {
      ok: false,
      message: 'Local draw.io webapp assets are not installed.',
      checkedPaths
    }
    return lastFailure
  }

  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendPlain(response, 405, 'Method not allowed.')
      return
    }
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const candidate = resolveCandidatePath(resolved.assetRoot, requestUrl.pathname)
    if (!candidate || !candidate.stat.isFile()) {
      sendPlain(response, 404, 'Not found.')
      return
    }
    response.writeHead(200, {
      'Content-Type': mimeTypeFor(candidate.path),
      'Content-Length': String(candidate.stat.size),
      'Cache-Control': 'public, max-age=3600'
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(candidate.path).pipe(response)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address() as AddressInfo
  activeServer = {
    ok: true,
    server,
    assetRoot: resolved.assetRoot,
    source: resolved.source,
    port: address.port,
    url: `http://127.0.0.1:${address.port}/${DRAWIO_EMBED_QUERY}`
  }
  lastFailure = null
  return {
    ok: true,
    url: activeServer.url,
    assetRoot: activeServer.assetRoot,
    port: activeServer.port,
    source: activeServer.source
  }
}

export function getLocalDrawioServerStatus(): LocalDrawioServerResult {
  if (activeServer) return {
    ok: true,
    url: activeServer.url,
    assetRoot: activeServer.assetRoot,
    port: activeServer.port,
    source: activeServer.source
  }
  return lastFailure ?? {
    ok: false,
    message: 'Local draw.io server has not started.',
    checkedPaths: []
  }
}

export async function stopLocalDrawioServer(): Promise<void> {
  const server = activeServer?.server
  activeServer = null
  if (!server) return
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose())
  })
}
