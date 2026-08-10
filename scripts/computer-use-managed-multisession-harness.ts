import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext } from 'playwright-core'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core') as typeof import('playwright-core')

export const MANAGED_SURFACES = Object.freeze([
  { id: 'alpha', label: 'Alpha', color: '#e8f2ff' },
  { id: 'beta', label: 'Beta', color: '#ecf8ee' },
  { id: 'gamma', label: 'Gamma', color: '#fff4df' },
  { id: 'delta', label: 'Delta', color: '#f5eaff' }
] as const)

type SurfaceId = typeof MANAGED_SURFACES[number]['id']
type SurfaceState = {
  commits: number
  state: string
  cookie: string
  storage: string
  updatedAt: string | null
}

type HarnessOptions = Readonly<{
  readyFile: string
  runtimeDir: string
  browserExecutable?: string
}>

export function managedSurfaceHtml(surface: typeof MANAGED_SURFACES[number]): string {
  const marker = `${surface.id.toUpperCase()}_CONTEXT`
  const committed = `${surface.id.toUpperCase()}_COMMITTED`
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="sciforge-target-label" content="Managed CUA ${surface.label}"><title>Managed CUA ${surface.label}</title>
<style>
  body { margin: 0; background: ${surface.color}; color: #18202a; font: 24px system-ui, sans-serif; }
  main { box-sizing: border-box; width: 760px; min-height: 520px; margin: 32px; padding: 32px; background: white; border-radius: 16px; }
  h1 { margin: 0 0 24px; }
  button { width: 520px; height: 72px; margin: 24px 0; font: inherit; }
  output, p { display: block; margin: 18px 0; }
</style></head><body><main>
  <h1>Managed Session ${surface.label}</h1>
  <p>Storage marker ${surface.label}: ${marker}</p>
  <button id="commit" aria-label="Commit ${surface.label}">Commit ${surface.label}</button>
  <output id="state">State ${surface.label}: READY</output>
</main><script>
  const surface = ${JSON.stringify(surface.id)}
  const marker = ${JSON.stringify(marker)}
  const committed = ${JSON.stringify(committed)}
  const state = { commits: 0, state: 'READY', cookie: '', storage: '', updatedAt: null }
  document.cookie = 'sciforge_cua_context=' + marker + '; SameSite=Strict'
  localStorage.setItem('sciforge_cua_context', marker)
  const publish = async () => {
    state.cookie = document.cookie
    state.storage = localStorage.getItem('sciforge_cua_context') || ''
    state.updatedAt = new Date().toISOString()
    await fetch('/state/' + surface, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state)
    })
  }
  document.querySelector('#commit').addEventListener('click', async () => {
    state.commits += 1
    state.state = committed
    document.querySelector('#state').textContent = 'State ${surface.label}: ' + committed
    await publish()
  })
  publish()
</script></body></html>`
}

export function emptyHarnessState(): Record<SurfaceId, SurfaceState> {
  return Object.fromEntries(MANAGED_SURFACES.map((surface) => [surface.id, {
    commits: 0,
    state: 'READY',
    cookie: '',
    storage: '',
    updatedAt: null
  }])) as Record<SurfaceId, SurfaceState>
}

export function browserExecutableCandidates(explicit?: string): string[] {
  return [
    explicit?.trim(),
    process.env.SCIFORGE_CUA_DEMO_BROWSER?.trim(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter((value): value is string => Boolean(value))
}

export async function startManagedMultisessionHarness(options: HarnessOptions): Promise<{
  cdpEndpoint: string
  stateEndpoint: string
  close(): Promise<void>
}> {
  const readyFile = resolve(options.readyFile)
  const runtimeDir = resolve(options.runtimeDir)
  await mkdir(runtimeDir, { recursive: true })
  await mkdir(dirname(readyFile), { recursive: true })
  const executablePath = browserExecutableCandidates(options.browserExecutable).find(existsSync)
  if (!executablePath) throw new Error('No supported Chromium executable was found for the managed harness.')

  const state = emptyHarnessState()
  const stateServer = createServer((request, response) => handleStateRequest(state, request, response))
  const statePort = await listenLoopback(stateServer)
  const cdpPort = await reserveLoopbackPort()
  const stateEndpoint = `http://127.0.0.1:${statePort}`
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`
  let browser: Browser | null = null
  const contexts: BrowserContext[] = []
  let closed = false
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${cdpPort}`,
        '--no-first-run',
        '--no-default-browser-check'
      ]
    })
    await waitForCdp(cdpEndpoint)
    for (const surface of MANAGED_SURFACES) {
      const context = await browser.newContext({ viewport: { width: 900, height: 640 } })
      contexts.push(context)
      const page = await context.newPage()
      await page.goto(`${stateEndpoint}/surface/${surface.id}`, { waitUntil: 'networkidle' })
    }
    await waitForSurfaceRegistration(state)
    await writeFile(readyFile, JSON.stringify({
      version: 1,
      runId: randomUUID(),
      cdpEndpoint,
      stateEndpoint,
      contextCount: contexts.length,
      surfaces: MANAGED_SURFACES.map(({ id, label }) => ({ id, label }))
    }, null, 2), 'utf8')
  } catch (error) {
    await Promise.allSettled(contexts.map((context) => context.close()))
    await browser?.close().catch(() => undefined)
    stateServer.close()
    throw error
  }

  return {
    cdpEndpoint,
    stateEndpoint,
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled(contexts.map((context) => context.close()))
      await browser?.close().catch(() => undefined)
      await new Promise<void>((resolveClose) => stateServer.close(() => resolveClose()))
      await rm(readyFile, { force: true })
    }
  }
}

function handleStateRequest(
  state: Record<SurfaceId, SurfaceState>,
  request: IncomingMessage,
  response: ServerResponse
): void {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const surface = MANAGED_SURFACES.find((candidate) => url.pathname === `/surface/${candidate.id}`)
  if (request.method === 'GET' && surface) {
    send(response, 200, managedSurfaceHtml(surface), 'text/html; charset=utf-8')
    return
  }
  if (request.method === 'GET' && url.pathname === '/state') {
    send(response, 200, JSON.stringify(state), 'application/json; charset=utf-8')
    return
  }
  const stateMatch = /^\/state\/(alpha|beta|gamma|delta)$/u.exec(url.pathname)
  if (request.method === 'POST' && stateMatch) {
    const id = stateMatch[1] as SurfaceId
    readJson(request).then((payload) => {
      state[id] = {
        commits: finiteNonnegativeInteger(payload.commits),
        state: boundedText(payload.state),
        cookie: boundedText(payload.cookie),
        storage: boundedText(payload.storage),
        updatedAt: boundedText(payload.updatedAt) || null
      }
      send(response, 204, '')
    }).catch((error) => send(response, 400, String(error)))
    return
  }
  send(response, 404, 'not found')
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 64_000) throw new Error('request body is too large')
    chunks.push(value)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed as Record<string, unknown>
}

function send(response: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

async function listenLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('state server has no TCP address'))
      resolveListen(address.port)
    })
  })
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createNetServer()
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('port reservation failed'))
      resolvePort(address.port)
    })
  })
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return port
}

async function waitForCdp(endpoint: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Chromium CDP endpoint did not become ready: ${String(lastError)}`)
}

async function waitForSurfaceRegistration(state: Record<SurfaceId, SurfaceState>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (MANAGED_SURFACES.every((surface) => {
      const marker = `${surface.id.toUpperCase()}_CONTEXT`
      return state[surface.id].cookie.includes(marker) && state[surface.id].storage === marker
    })) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('Managed surfaces did not establish isolated cookie/storage markers.')
}

function finiteNonnegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : 0
}

function boundedText(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 512)
}

function parseOptions(argv: readonly string[]): HarnessOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('Expected --ready-file and --runtime-dir arguments.')
    values.set(key, value)
  }
  const readyFile = values.get('--ready-file')
  const runtimeDir = values.get('--runtime-dir')
  if (!readyFile || !runtimeDir) throw new Error('--ready-file and --runtime-dir are required.')
  return { readyFile, runtimeDir, ...(values.get('--browser') ? { browserExecutable: values.get('--browser') } : {}) }
}

async function main(): Promise<void> {
  const harness = await startManagedMultisessionHarness(parseOptions(process.argv.slice(2)))
  const stop = async () => {
    await harness.close()
    process.exitCode = 0
  }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  await new Promise<void>(() => undefined)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
