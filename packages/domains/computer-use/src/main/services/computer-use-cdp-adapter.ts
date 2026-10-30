import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { Browser, CDPSession, Page } from 'playwright-core'
import {
  CDP_RENDERER_SETTLE_EXPRESSION,
  CDP_SEMANTIC_TREE_EXPRESSION,
  cdpClickReadbackExpression,
  normalizeCdpClickReadback,
  normalizeCdpSemanticTree,
  verifyCdpClick
} from './computer-use-cdp-semantics'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core') as typeof import('playwright-core')
const MAX_BODY_BYTES = 1_000_000
const ACTION_TIMEOUT_MS = 10_000
const OBSERVATION_TIMEOUT_MS = 3_000
const NAVIGATION_READ_RETRY_ATTEMPTS = 3
const NAVIGATION_SETTLE_TIMEOUT_MS = 1_500

export type BrowserPageCdpAdapterTarget = Readonly<{
  targetId: string
  kind: 'browser-page'
  ownership: 'attached'
  generation: string
  locator: { cdpEndpoint: string; cdpTargetId: string }
  metadata: { title: string; url: string; publicLabel?: string }
}>

export type ElectronWebContentsCdpAdapterTarget = Readonly<{
  targetId: string
  kind: 'electron-webcontents'
  ownership: 'attached'
  generation: string
  locator: { webContentsId: number }
  metadata: { title: string; url: string }
}>

export type CdpAdapterTarget = BrowserPageCdpAdapterTarget | ElectronWebContentsCdpAdapterTarget

export type CdpAdapterDriver = Readonly<{
  available(): Promise<{ available: boolean; reason?: string; adapterInstanceId: string; generation: string; activeHandleCount: number; supportedTargetKinds?: Array<CdpAdapterTarget['kind']> }>
  targets(): Promise<CdpAdapterTarget[]>
  open(target: CdpAdapterTarget, requestId: string): Promise<{ handleId: string; targetId: string; generation: string }>
  observe(handleId: string): Promise<Record<string, unknown>>
  action(handleId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>
  cancel(handleId: string, reason: string): Promise<void>
  close(handleId: string, reason: string): Promise<void>
  shutdown(): Promise<void>
}>

export type ComputerUseCdpAdapter = Readonly<{
  url: string
  token: string
  close(): Promise<void>
}>

export class CdpAdapterDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly safeToRetry: boolean = false
  ) {
    super(`${code}: ${message}`)
  }
}
type PlaywrightHandle = {
  id: string
  targetId: string
  generation: string
  requestId: string
  page: Page
  revision: number
  cancelled: boolean
}

export function createPlaywrightCdpDriver(endpoints: readonly string[]): CdpAdapterDriver {
  const adapterInstanceId = `cdp-adapter-${randomUUID()}`
  const generation = `cdp-generation-${randomUUID()}`
  const allowedEndpoints = [...new Set(endpoints.map(normalizeLoopbackEndpoint))]
  const browsers = new Map<string, Promise<Browser>>()
  const handles = new Map<string, PlaywrightHandle>()
  const handlesByRequest = new Map<string, string>()
  let observationTail: Promise<void> = Promise.resolve()
  const serializeObservation = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = observationTail.then(operation, operation)
    observationTail = queued.then(() => undefined, () => undefined)
    return queued
  }

  const browserFor = (endpoint: string): Promise<Browser> => {
    const normalized = normalizeLoopbackEndpoint(endpoint)
    if (!allowedEndpoints.includes(normalized)) throw new Error('CDP endpoint is not allowlisted.')
    let browser = browsers.get(normalized)
    if (!browser) {
      browser = chromium.connectOverCDP(normalized, { timeout: ACTION_TIMEOUT_MS }).catch((error) => {
        browsers.delete(normalized)
        throw error
      })
      browsers.set(normalized, browser)
      void browser.then((connected) => connected.once('disconnected', () => browsers.delete(normalized)))
    }
    return browser
  }

  const enumerate = async (): Promise<Array<{ target: BrowserPageCdpAdapterTarget; page: Page }>> => {
    const output: Array<{ target: BrowserPageCdpAdapterTarget; page: Page }> = []
    for (const endpoint of allowedEndpoints) {
      const browser = await browserFor(endpoint)
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          if (page.isClosed()) continue
          const cdp = await context.newCDPSession(page)
          try {
            const result = await cdp.send('Target.getTargetInfo') as {
              targetInfo?: { targetId?: string }
            }
            const cdpTargetId = result.targetInfo?.targetId
            if (!cdpTargetId) continue
            const publicLabel = (await page.evaluate(() => (
              document.querySelector('meta[name="sciforge-target-label"]')?.getAttribute('content') ?? ''
            )).catch(() => '')).trim().slice(0, 256)
            output.push({
              page,
              target: {
                targetId: stableTargetId(endpoint, cdpTargetId),
                kind: 'browser-page',
                ownership: 'attached',
                generation,
                locator: { cdpEndpoint: endpoint, cdpTargetId },
                metadata: {
                  title: (await page.title().catch(() => '')).slice(0, 2048),
                  url: page.url().slice(0, 2048),
                  ...(publicLabel ? { publicLabel } : {})
                }
              }
            })
          } finally {
            await cdp.detach().catch(() => undefined)
          }
        }
      }
    }
    return output
  }

  const handle = (handleId: string): PlaywrightHandle => {
    const value = handles.get(handleId)
    if (!value || value.page.isClosed()) throw new Error('CDP handle is unavailable.')
    return value
  }

  return Object.freeze({
    async available() {
      if (allowedEndpoints.length === 0) {
        return { available: false, reason: 'No allowlisted loopback CDP endpoint is configured.', adapterInstanceId, generation, activeHandleCount: handles.size, supportedTargetKinds: ['browser-page'] }
      }
      try {
        await Promise.all(allowedEndpoints.map(browserFor))
        return { available: true, adapterInstanceId, generation, activeHandleCount: handles.size, supportedTargetKinds: ['browser-page'] }
      } catch (error) {
        return { available: false, reason: safeError(error), adapterInstanceId, generation, activeHandleCount: handles.size, supportedTargetKinds: ['browser-page'] }
      }
    },
    async targets() {
      return (await enumerate()).map(({ target }) => target)
    },
    async open(target, requestId) {
      if (target.kind !== 'browser-page') {
        throw new CdpAdapterDriverError(
          'ACTION_UNSUPPORTED', 'Playwright driver accepts browser-page targets only.', true
        )
      }
      const existingId = handlesByRequest.get(requestId)
      if (existingId) {
        const existing = handles.get(existingId)
        if (!existing || existing.targetId !== target.targetId || existing.generation !== target.generation) {
          throw new Error('REQUEST_ID_CONFLICT: CDP open request identity changed.')
        }
        return { handleId: existing.id, targetId: existing.targetId, generation: existing.generation }
      }
      if (target.ownership !== 'attached') {
        throw new CdpAdapterDriverError(
          'ACTION_UNSUPPORTED', 'This adapter instance does not own managed browser targets.', true
        )
      }
      if (target.generation !== generation) {
        throw new CdpAdapterDriverError('TARGET_LOST', 'CDP adapter generation changed.', true)
      }
      let found: Awaited<ReturnType<typeof enumerate>>[number] | undefined
      try {
        found = (await enumerate()).find(({ target: candidate }) => (
          candidate.targetId === target.targetId
          && candidate.generation === target.generation
          && candidate.locator.cdpEndpoint === normalizeLoopbackEndpoint(target.locator.cdpEndpoint)
          && candidate.locator.cdpTargetId === target.locator.cdpTargetId
        ))
      } catch (error) {
        throw new CdpAdapterDriverError(
          'BACKEND_UNAVAILABLE', `CDP target discovery failed: ${safeError(error)}`, true
        )
      }
      if (!found) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'The requested CDP target is unavailable or changed identity.', true
        )
      }
      const id = `cdp-handle-${randomUUID()}`
      found.page.setDefaultTimeout(ACTION_TIMEOUT_MS)
      handles.set(id, { id, targetId: target.targetId, generation, requestId, page: found.page, revision: 0, cancelled: false })
      handlesByRequest.set(requestId, id)
      return { handleId: id, targetId: target.targetId, generation }
    },
    async observe(handleId) {
      const value = handle(handleId)
      if (value.cancelled) throw new Error('CDP handle was cancelled.')
      // Page.screenshot() can contend on Playwright's browser-level capture
      // path when several attached pages are observed at once. A fresh CDP
      // session binds capture to this exact target and can run independently.
      const [imageBase64, semanticTree] = await Promise.all([
        serializeObservation(() => captureTargetScreenshot(value.page)),
        pageSemanticTree(value.page)
      ])
      value.revision += 1
      return {
        targetId: value.targetId,
        generation: value.generation,
        revision: `cdp:${value.revision}`,
        imageBase64,
        metadata: {
          url: value.page.url().slice(0, 2048),
          title: (await value.page.title().catch(() => '')).slice(0, 2048),
          viewport: value.page.viewportSize(),
          semanticTree
        }
      }
    },
    async action(handleId, input) {
      const value = handle(handleId)
      if (value.cancelled) throw new Error('CDP handle was cancelled.')
      if (input.expectedRevision !== `cdp:${value.revision}`) {
        throw new Error('STALE_OBSERVATION: CDP action revision does not match.')
      }
      const action = asRecord(input.action)
      const name = String(action.action ?? '').toLowerCase()
      let verification: Record<string, unknown> = {
        status: 'unverified',
        details: { reason: 'action-has-no-semantic-readback' }
      }
      if (name === 'click' || name === 'left_click' || name === 'right_click' || name === 'double_click') {
        const [x, y] = coordinate(action.coordinate)
        const beforeReadback = await pageClickReadback(value.page, x, y)
        const beforeSemanticTree = await pageSemanticTree(value.page)
        const beforeUrl = value.page.url()
        await value.page.mouse.click(x, y, {
          button: name === 'right_click' ? 'right' : 'left',
          clickCount: name === 'double_click' ? 2 : 1
        })
        await settleAfterPotentialNavigation(value.page, beforeUrl)
        const afterReadback = await pageClickReadback(value.page, x, y)
        const afterSemanticTree = await pageSemanticTree(value.page)
        verification = verifyCdpClick(
          beforeReadback,
          afterReadback,
          beforeSemanticTree,
          afterSemanticTree
        )
      } else if (name === 'type') {
        const text = String(action.text ?? '')
        const beforeReadback = await activeElementReadback(value.page)
        await value.page.keyboard.insertText(text)
        const afterReadback = await activeElementReadback(value.page)
        verification = insertedTextVerification(beforeReadback, afterReadback, text)
      } else if (name === 'key' || name === 'hotkey') {
        const keys = Array.isArray(action.keys) ? action.keys.map(String) : [String(action.keys ?? '')]
        const chord = keys.filter(Boolean).map(playwrightKey).join('+')
        if (!chord) throw new Error('CDP key action requires keys.')
        const beforeUrl = value.page.url()
        const beforeSemanticTree = await pageSemanticTree(value.page)
        await value.page.keyboard.press(chord)
        await settleAfterPotentialNavigation(value.page, beforeUrl)
        const afterUrl = value.page.url()
        const afterSemanticTree = await pageSemanticTree(value.page)
        verification = keyActionVerification(
          chord,
          beforeUrl !== afterUrl,
          beforeSemanticTree,
          afterSemanticTree
        )
      } else if (name === 'scroll') {
        const deltaX = finiteNumber(action.deltaX ?? 0, 1)
        const deltaY = finiteNumber(action.deltaY ?? action.pixels, 1)
        const before = await scrollPosition(value.page)
        await value.page.mouse.wheel(deltaX, deltaY)
        const after = await scrollPosition(value.page)
        verification = {
          status: before.x !== after.x || before.y !== after.y ? 'verified' : 'unverified',
          details: { before, after }
        }
      } else if (name === 'wait') {
        await value.page.waitForTimeout(Math.min(30_000, Math.max(0, finiteNumber(action.time, 1) * 1000)))
        verification = { status: 'not-applicable', details: {} }
      } else {
        throw new Error(`ACTION_UNSUPPORTED: ${name}`)
      }
      value.revision += 1
      return {
        targetId: value.targetId,
        generation: value.generation,
        committed: name !== 'wait',
        mayHaveTakenEffect: name !== 'wait',
        verification: { ...verification, revisionAfter: `cdp:${value.revision}` }
      }
    },
    async cancel(handleId) {
      const value = handles.get(handleId)
      if (value) value.cancelled = true
    },
    async close(handleId) {
      // Handles are attached views. Releasing one must not close the user's
      // page, context, or browser. Process exit disconnects adapter transports.
      const value = handles.get(handleId)
      handles.delete(handleId)
      if (value && handlesByRequest.get(value.requestId) === handleId) handlesByRequest.delete(value.requestId)
    },
    async shutdown() {
      handles.clear()
      handlesByRequest.clear()
      const connected = await Promise.allSettled(browsers.values())
      browsers.clear()
      await Promise.all(connected.flatMap((result) => (
        result.status === 'fulfilled' ? [result.value.close().catch(() => undefined)] : []
      )))
    }
  })
}

export async function captureTargetScreenshot(page: Page): Promise<string> {
  let rejectClosed: ((reason: Error) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cdp: CDPSession | undefined
  const closed = new Promise<never>((_resolve, reject) => { rejectClosed = reject })
  const onClosed = (): void => rejectClosed?.(new Error('TARGET_LOST: CDP target closed during observe.'))
  page.once('close', onClosed)
  // Close can race between the driver's initial handle check and listener setup.
  if (page.isClosed()) onClosed()
  const capture = (async () => {
    // Chromium may not render a background target reliably. This activates the
    // tab inside the explicitly allowlisted debugging browser; capability docs
    // must expose that visible-browser side effect.
    await page.bringToFront()
    cdp = await page.context().newCDPSession(page)
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false
    }) as { data: string }
    return result.data
  })()
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(
      page.isClosed()
        ? 'TARGET_LOST: CDP target closed while capture was pending.'
        : 'BACKEND_UNAVAILABLE: CDP target capture timed out.'
    )), OBSERVATION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([capture, closed, timedOut])
  } finally {
    if (timeout) clearTimeout(timeout)
    page.off('close', onClosed)
    if (cdp) {
      await Promise.race([
        cdp.detach().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 250))
      ])
    }
  }
}

async function pageSemanticTree(page: Page) {
  return normalizeCdpSemanticTree(await evaluateCdpReadback(page, CDP_SEMANTIC_TREE_EXPRESSION))
}

async function pageClickReadback(page: Page, x: number, y: number) {
  return normalizeCdpClickReadback(await evaluateCdpReadback(page, cdpClickReadbackExpression(x, y)))
}

export async function evaluateCdpReadback(page: Page, expression: string): Promise<unknown> {
  for (let attempt = 1; attempt <= NAVIGATION_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await page.evaluate(expression)
    } catch (error) {
      if (!isNavigationContextError(error) || page.isClosed() || attempt === NAVIGATION_READ_RETRY_ATTEMPTS) {
        throw error
      }
      await page.waitForLoadState('domcontentloaded', {
        timeout: NAVIGATION_SETTLE_TIMEOUT_MS
      }).catch(() => undefined)
      await page.waitForTimeout(50)
    }
  }
  throw new Error('CDP readback retry exhausted.')
}

async function settleAfterPotentialNavigation(page: Page, beforeUrl: string): Promise<void> {
  await page.waitForTimeout(50)
  if (page.url() !== beforeUrl) {
    await page.waitForLoadState('domcontentloaded', {
      timeout: NAVIGATION_SETTLE_TIMEOUT_MS
    }).catch(() => undefined)
  }
  await evaluateCdpReadback(page, CDP_RENDERER_SETTLE_EXPRESSION)
}

function isNavigationContextError(error: unknown): boolean {
  const message = safeError(error).toLowerCase()
  return message.includes('execution context was destroyed')
    || message.includes('cannot find context with specified id')
}

export async function startComputerUseCdpAdapter(options: Readonly<{
  driver: CdpAdapterDriver
  token?: string
  port?: number
}>): Promise<ComputerUseCdpAdapter> {
  const token = options.token?.trim() || randomBytes(32).toString('hex')
  const server = createServer((request, response) => {
    void serveRequest(options.driver, token, request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return Object.freeze({
    url: `http://127.0.0.1:${address.port}`,
    token,
    async close() {
      await options.driver.shutdown()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
}

async function serveRequest(
  driver: CdpAdapterDriver,
  token: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.headers.authorization !== `Bearer ${token}`) {
    send(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid adapter token' } })
    return
  }
  try {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && path === '/v1/capabilities') {
      send(response, 200, { ok: true, data: await driver.available() })
      return
    }
    if (request.method === 'GET' && path === '/v1/targets') {
      send(response, 200, { ok: true, data: { targets: await driver.targets() } })
      return
    }
    if (request.method !== 'POST') throw new AdapterHttpError(404, 'NOT_FOUND', 'adapter route not found')
    const body = await readJsonBody(request)
    if (path === '/v1/handles/open') {
      const target = parseTarget(body.target)
      send(response, 200, { ok: true, data: await driver.open(target, requiredString(body.requestId, 'requestId')) })
    } else if (path === '/v1/observe') {
      send(response, 200, { ok: true, data: await driver.observe(requiredString(body.handleId, 'handleId')) })
    } else if (path === '/v1/action') {
      send(response, 200, { ok: true, data: await driver.action(requiredString(body.handleId, 'handleId'), body) })
    } else if (path === '/v1/handles/cancel') {
      await driver.cancel(requiredString(body.handleId, 'handleId'), String(body.reason ?? 'cancelled'))
      send(response, 200, { ok: true, data: { cancelled: true } })
    } else if (path === '/v1/handles/close') {
      await driver.close(requiredString(body.handleId, 'handleId'), String(body.reason ?? 'closed'))
      send(response, 200, { ok: true, data: { closed: true } })
    } else {
      throw new AdapterHttpError(404, 'NOT_FOUND', 'adapter route not found')
    }
  } catch (error) {
    const httpError = error instanceof AdapterHttpError
    const driverError = error instanceof CdpAdapterDriverError
    send(response, httpError ? error.status : driverError ? 409 : 400, {
      ok: false,
      error: {
        code: httpError || driverError ? error.code : classifyError(error),
        message: safeError(error),
        ...(driverError ? { safeToRetry: error.safeToRetry } : {})
      }
    })
  }
}

class AdapterHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function parseTarget(value: unknown): CdpAdapterTarget {
  const record = asRecord(value)
  const locator = asRecord(record.locator)
  if (record.ownership !== 'attached') {
    throw new Error('Only attached CDP targets are supported.')
  }
  if (record.kind === 'browser-page') {
    const endpoint = normalizeLoopbackEndpoint(requiredString(locator.cdpEndpoint, 'cdpEndpoint'))
    return {
      targetId: requiredString(record.targetId, 'targetId'),
      kind: 'browser-page',
      ownership: 'attached',
      generation: requiredString(record.generation, 'generation'),
      locator: { cdpEndpoint: endpoint, cdpTargetId: requiredString(locator.cdpTargetId, 'cdpTargetId') },
      metadata: { title: '', url: '' }
    }
  }
  if (record.kind === 'electron-webcontents') {
    const webContentsId = Number(locator.webContentsId)
    if (!Number.isSafeInteger(webContentsId) || webContentsId < 1) {
      throw new Error('webContentsId must be a positive safe integer.')
    }
    return {
      targetId: requiredString(record.targetId, 'targetId'),
      kind: 'electron-webcontents',
      ownership: 'attached',
      generation: requiredString(record.generation, 'generation'),
      locator: { webContentsId },
      metadata: { title: '', url: '' }
    }
  }
  throw new Error('Unsupported CDP target kind.')
}

function normalizeLoopbackEndpoint(raw: string): string {
  const url = new URL(raw)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('Unsupported CDP endpoint protocol.')
  if (url.username || url.password) throw new Error('CDP endpoint credentials are forbidden.')
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('CDP endpoint must be loopback-only.')
  }
  return url.href.replace(/\/$/u, '')
}

export function stableTargetId(endpoint: string, cdpTargetId: string): string {
  const endpointHash = createHash('sha256').update(endpoint).digest('hex').slice(0, 24)
  return `cdp:${endpointHash}:${cdpTargetId}`.slice(0, 128)
}

async function activeElementReadback(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
    if (!element) return ''
    if ('value' in element && typeof element.value === 'string') return element.value
    return element.textContent ?? ''
  })
}

export function insertedTextVerification(
  beforeReadback: string,
  afterReadback: string,
  text: string
): Record<string, unknown> {
  return text.length > 0 && afterReadback !== beforeReadback && afterReadback.includes(text)
    ? { status: 'verified', details: { beforeReadback, afterReadback } }
    : {
        status: 'failed',
        details: {
          reason: 'typed-text-change-not-confirmed-in-active-element',
          beforeReadback,
          afterReadback
        }
      }
}

export function keyActionVerification(
  chord: string,
  urlChanged: boolean,
  beforeSemanticTree: readonly unknown[],
  afterSemanticTree: readonly unknown[]
): Record<string, unknown> {
  if (urlChanged) {
    return { status: 'verified', details: { chord, reason: 'url-changed' } }
  }
  if (JSON.stringify(beforeSemanticTree) !== JSON.stringify(afterSemanticTree)) {
    return { status: 'verified', details: { chord, reason: 'semantic-tree-changed' } }
  }
  return { status: 'unverified', details: { chord, reason: 'key-has-no-semantic-readback' } }
}

async function scrollPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
}

function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('CDP click requires a coordinate.')
  return [finiteNumber(value[0], Number.NaN), finiteNumber(value[1], Number.NaN)]
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    if (Number.isNaN(fallback)) throw new Error('Expected a finite number.')
    return fallback
  }
  return parsed
}

function playwrightKey(key: string): string {
  const normalized = key.toLowerCase()
  const aliases: Record<string, string> = {
    ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta',
    command: 'Meta', cmd: 'Meta', enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape'
  }
  return aliases[normalized] ?? (key.length === 1 ? key : key[0]!.toUpperCase() + key.slice(1))
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new AdapterHttpError(413, 'PAYLOAD_TOO_LARGE', 'adapter request is too large')
    chunks.push(buffer)
  }
  try {
    return asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
  } catch {
    throw new AdapterHttpError(400, 'INVALID_ARGUMENT', 'adapter request must be JSON')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`)
  return value
}

function classifyError(error: unknown): string {
  const message = safeError(error)
  if (message.startsWith('STALE_OBSERVATION')) return 'STALE_OBSERVATION'
  if (message.startsWith('ACTION_UNSUPPORTED')) return 'ACTION_UNSUPPORTED'
  if (message.startsWith('REQUEST_ID_CONFLICT')) return 'REQUEST_ID_CONFLICT'
  if (
    message.startsWith('TARGET_LOST')
    || /target page, context or browser has been closed/iu.test(message)
    || /cdp handle is unavailable/iu.test(message)
    || /target closed/iu.test(message)
  ) return 'TARGET_LOST'
  if (message.startsWith('BACKEND_UNAVAILABLE')) return 'BACKEND_UNAVAILABLE'
  return 'ADAPTER_ERROR'
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/\b(?:https?|wss?):\/\/[^\s)'"<>]+/giu, '<redacted-url>')
    .replaceAll(/\bBearer\s+\S+/giu, 'Bearer <redacted>')
    .replaceAll(/\s+/gu, ' ')
    .slice(0, 2000)
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}
