import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHmac, randomBytes } from 'node:crypto'
import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
  emptyVisibleContextSnapshot,
  visibleContextCaptureBrokerRequestSchema,
  visibleContextCaptureRequestSchema,
  visibleContextSnapshotSchema,
  type VisibleContextBounds,
  type VisibleContextCaptureBrokerRequest,
  type VisibleContextCaptureBrokerResponse,
  type VisibleContextCaptureRequest,
  type VisibleContextCapturePreviewResult,
  type VisibleContextCaptureResult,
  type VisibleContextComponentSnapshot,
  type VisibleContextResource,
  type VisibleContextSnapshot,
  type VisibleContextVisualSnapshotResource,
  type VisualContextTarget
} from '../../shared/visible-context'
import {
  atomicWriteAppDataJson,
  atomicWriteAppDataText,
  readAppDataStoreText
} from './app-data-store'

export const VISIBLE_CONTEXT_STORE_SEGMENTS = ['visible-context', 'snapshot.json'] as const
export const VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS = ['visible-context', 'captures'] as const
export const VISIBLE_CONTEXT_CAPTURE_REQUESTS_SEGMENTS = ['visible-context', 'capture-requests'] as const

const MAX_OBJECT_KEYS = 64
const MAX_ARRAY_ITEMS = 64
const MAX_STRING_CHARS = 4096
const MAX_JSON_DEPTH = 6
const DEFAULT_CAPTURE_RETENTION_LIMIT = 64
const DEFAULT_CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CAPTURE_PREVIEW_BYTES = 32 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type CapturedVisualPage = {
  png: Uint8Array
  width: number
  height: number
  scaleFactor: number
  bounds?: VisibleContextBounds
}

export type SurfaceCaptureRequest = {
  windowId: string
  revision: number
  snapshotToken: string
  activeThreadId: string | null
  bounds?: VisibleContextBounds
}

export type SurfaceCaptureUnavailableReason = {
  code: 'surface_capture_unsupported' | 'capture_surface_unavailable'
  message: string
  retryable: boolean
}

export type SurfaceCaptureResult =
  | { ok: true; page: CapturedVisualPage }
  | { ok: false; reason: SurfaceCaptureUnavailableReason }

export type SurfaceCaptureProvider = {
  capture: (request: SurfaceCaptureRequest) => Promise<SurfaceCaptureResult>
}

export type VisibleContextServiceOptions = {
  surfaceCaptureProvider: SurfaceCaptureProvider
  requestContextRefresh?: (windowId: string) => void
  onCaptureState?: (windowId: string, active: boolean) => void
  now?: () => Date
  captureRetentionLimit?: number
  captureMaxAgeMs?: number
}

export function visibleContextSnapshotPath(userDataDir: string): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_STORE_SEGMENTS)
}

export function visibleContextCapturePath(userDataDir: string, requestId = 'latest'): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS, `${requestId}.png`)
}

export function visibleContextCaptureRequestsPath(userDataDir: string): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_CAPTURE_REQUESTS_SEGMENTS)
}

export class VisibleContextService {
  private current: VisibleContextSnapshot | null = null
  private readonly snapshots = new Map<string, VisibleContextSnapshot>()
  private readonly snapshotSecret = randomBytes(32)
  private captureQueue: Promise<void> = Promise.resolve()
  private brokerWatcher: FSWatcher | null = null
  private readonly brokerRequests = new Set<string>()
  private readonly now: () => Date

  constructor(
    private readonly userDataDir: string,
    private readonly options: VisibleContextServiceOptions
  ) {
    this.now = options.now ?? (() => new Date())
  }

  snapshotPath(): string {
    return visibleContextSnapshotPath(this.userDataDir)
  }

  capturePath(requestId = 'latest'): string {
    return visibleContextCapturePath(this.userDataDir, requestId)
  }

  async readCapturePreview(path: string): Promise<VisibleContextCapturePreviewResult> {
    try {
      const captureDirectory = join(this.userDataDir, ...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS)
      const resolvedPath = resolve(path)
      if (dirname(resolvedPath) !== resolve(captureDirectory) || !/^[A-Za-z0-9._-]+\.png$/.test(basename(resolvedPath))) {
        return { ok: false, message: 'Capture preview path is outside the managed capture directory.' }
      }
      const entry = await lstat(resolvedPath)
      if (!entry.isFile() || entry.isSymbolicLink()) {
        return { ok: false, message: 'Capture preview is not a managed file.' }
      }
      const handle = await open(resolvedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const info = await handle.stat()
        if (info.size <= 0 || info.size > MAX_CAPTURE_PREVIEW_BYTES) {
          return { ok: false, message: 'Capture preview size is invalid.' }
        }
        const bytes = await handle.readFile()
        if (bytes.byteLength < PNG_SIGNATURE.byteLength || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
          return { ok: false, message: 'Capture preview is not a PNG image.' }
        }
        return {
          ok: true,
          path: resolvedPath,
          dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
          mimeType: 'image/png',
          size: bytes.byteLength
        }
      } finally {
        await handle.close()
      }
    } catch {
      return { ok: false, message: 'Capture preview is unavailable.' }
    }
  }

  async publish(snapshot: VisibleContextSnapshot): Promise<VisibleContextSnapshot> {
    const parsed = visibleContextSnapshotSchema.parse(snapshot)
    const currentForWindow = this.snapshots.get(parsed.windowId)
    if (
      currentForWindow &&
      parsed.revision <= currentForWindow.revision
    ) {
      return this.withFreshness(currentForWindow)
    }
    const normalized = sanitizeVisibleContextSnapshot({ ...parsed, snapshotToken: undefined })
    const sanitized = this.withFreshness({
      ...normalized,
      snapshotToken: this.createSnapshotToken(normalized)
    })
    this.snapshots.set(sanitized.windowId, sanitized)
    this.current = sanitized
    await atomicWriteAppDataJson(
      this.userDataDir,
      VISIBLE_CONTEXT_STORE_SEGMENTS,
      sanitized,
      { trailingNewline: true }
    )
    return sanitized
  }

  async get(): Promise<VisibleContextSnapshot> {
    if (!this.current) {
      this.current = await this.readPersisted()
      this.snapshots.set(this.current.windowId, this.current)
      if (this.current.snapshotToken) {
        await atomicWriteAppDataJson(
          this.userDataDir,
          VISIBLE_CONTEXT_STORE_SEGMENTS,
          this.current,
          { trailingNewline: true }
        )
      }
    }
    this.current = this.withFreshness(this.current)
    return this.current
  }

  peek(): VisibleContextSnapshot {
    return this.withFreshness(this.current ?? emptyVisibleContextSnapshot())
  }

  async capture(input: unknown): Promise<VisibleContextCaptureResult> {
    const parsed = visibleContextCaptureRequestSchema.safeParse(input)
    if (!parsed.success) {
      const requestId = readRequestId(input)
      return captureFailure(requestId, 'invalid_visual_capture_request', parsed.error.message, false)
    }
    return this.enqueueCapture(() => this.captureValidated(parsed.data))
  }

  async startCaptureRequestBroker(): Promise<() => void> {
    if (this.brokerWatcher) return () => this.stopCaptureRequestBroker()
    const directory = visibleContextCaptureRequestsPath(this.userDataDir)
    await mkdir(directory, { recursive: true })
    this.brokerWatcher = watch(directory, (_, filename) => {
      if (filename) this.scheduleBrokerRequest(filename.toString())
    })
    const initial = await readdir(directory)
    for (const name of initial) this.scheduleBrokerRequest(name)
    return () => this.stopCaptureRequestBroker()
  }

  stopCaptureRequestBroker(): void {
    this.brokerWatcher?.close()
    this.brokerWatcher = null
  }

  private async captureValidated(request: VisibleContextCaptureRequest): Promise<VisibleContextCaptureResult> {
    const snapshot = await this.snapshotForCapture(request)
    if (!snapshot) {
      return captureFailure(
        request.requestId,
        'stale_snapshot_token',
        'The visible-context snapshot token no longer identifies the requested window revision. Call gui_visible_context again before capturing.',
        true
      )
    }
    let target: VisualContextTarget | undefined
    let bounds: VisibleContextBounds | undefined

    if (snapshot.freshness.stale) {
      this.requestSnapshotRefresh(snapshot.windowId)
      return captureFailure(
        request.requestId,
        'stale_visible_context',
        'The visible context is stale; publish a fresh snapshot before capturing the window.',
        true
      )
    }

    if (request.scope === 'target') {
      const component = snapshot.components.find((candidate) => candidate.id === request.componentId)
      target = component?.visualTargets?.find((candidate) => candidate.id === request.targetId)
      if (!component || !target) {
        const available = snapshot.components.flatMap((entry) => (
          entry.visualTargets?.map((candidate) => `${entry.id}/${candidate.id}`) ?? []
        ))
        const availableSummary = available.length > 12
          ? `${available.slice(0, 12).join(', ')} (+${available.length - 12} more)`
          : available.join(', ')
        return captureFailure(
          request.requestId,
          'visual_target_not_found',
          `Visual target ${request.componentId}/${request.targetId} is not present in snapshot ${snapshot.revision}. Available targets: ${availableSummary || 'none'}.`,
          true
        )
      }
      bounds = target.bounds
      if (target.kind !== 'window' && !bounds) {
        return captureFailure(
          request.requestId,
          'visual_target_bounds_unavailable',
          `Visual target ${request.componentId}/${request.targetId} has no CSS viewport bounds.`,
          true
        )
      }
    }

    this.setCaptureState(snapshot.windowId, true)
    try {
      const capture = await this.options.surfaceCaptureProvider.capture({
        windowId: snapshot.windowId,
        revision: snapshot.revision,
        snapshotToken: request.snapshotToken,
        activeThreadId: snapshot.activeThreadId ?? null,
        ...(bounds ? { bounds } : {})
      })
      if (!capture.ok) {
        return captureFailure(
          request.requestId,
          capture.reason.code,
          capture.reason.message,
          capture.reason.retryable
        )
      }
      const captured = capture.page
      assertCapturedPage(captured)
      const png = await redactCapturedVisualPage(captured, snapshot)
      const captureName = `${request.requestId}.png`
      await atomicWriteAppDataText(
        this.userDataDir,
        [...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS, captureName],
        png
      )
      const path = this.capturePath(request.requestId)
      if (!isAbsolute(path)) throw new Error('Visual snapshot path is not absolute.')
      await this.pruneCaptureAssets(path)
      const capturedAt = this.now().toISOString()
      const resource: VisibleContextVisualSnapshotResource = {
        kind: 'visualSnapshot',
        role: request.scope,
        path,
        name: captureName,
        mimeType: 'image/png',
        size: png.byteLength,
        capturedAt,
        updatedAt: capturedAt,
        width: captured.width,
        height: captured.height,
        scaleFactor: captured.scaleFactor,
        windowId: snapshot.windowId,
        revision: snapshot.revision,
        metadata: {
          activeThreadId: snapshot.activeThreadId ?? null,
          route: snapshot.route ?? null
        },
        ...(request.scope === 'target'
          ? {
              componentId: request.componentId,
              targetId: request.targetId,
              target: target ? { ...target, bounds: captured.bounds ?? target.bounds } : undefined
            }
          : {})
      }
      return { ok: true, requestId: request.requestId, resource }
    } catch (error) {
      return captureFailure(
        request.requestId,
        'visual_capture_failed',
        error instanceof Error ? error.message : 'Failed to capture the SciForge window.',
        true
      )
    } finally {
      this.setCaptureState(snapshot.windowId, false)
    }
  }

  private async snapshotForCapture(
    request: VisibleContextCaptureRequest
  ): Promise<VisibleContextSnapshot | null> {
    if (!this.current) await this.get()
    const snapshot = this.snapshots.get(request.windowId)
    if (!snapshot) return null
    if (snapshot.revision !== request.revision || snapshot.snapshotToken !== request.snapshotToken) return null
    if ((snapshot.activeThreadId ?? null) !== (request.activeThreadId ?? null)) return null
    return this.withFreshness(snapshot)
  }

  private createSnapshotToken(snapshot: VisibleContextSnapshot): string {
    const identity = JSON.stringify({
      windowId: snapshot.windowId,
      revision: snapshot.revision,
      activeThreadId: snapshot.activeThreadId ?? null,
      workspaceRoot: snapshot.workspaceRoot ?? null,
      route: snapshot.route ?? null,
      publishedAt: snapshot.publishedAt
    })
    return `vc_${createHmac('sha256', this.snapshotSecret).update(identity).digest('hex')}`
  }

  private enqueueCapture(
    operation: () => Promise<VisibleContextCaptureResult>
  ): Promise<VisibleContextCaptureResult> {
    const run = this.captureQueue.then(operation, operation)
    this.captureQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private withFreshness(snapshot: VisibleContextSnapshot): VisibleContextSnapshot {
    const ageMs = Math.max(0, this.now().getTime() - Date.parse(snapshot.publishedAt))
    const staleAfterMs = snapshot.freshness.staleAfterMs
    return {
      ...snapshot,
      freshness: {
        stale: ageMs > staleAfterMs,
        ageMs,
        staleAfterMs
      }
    }
  }

  private requestSnapshotRefresh(windowId: string): void {
    try {
      this.options.requestContextRefresh?.(windowId)
    } catch {
      // A failed refresh request never authorizes capture from a different surface.
    }
  }

  private setCaptureState(windowId: string, active: boolean): void {
    try {
      this.options.onCaptureState?.(windowId, active)
    } catch {
      // Capture-state UI is advisory and must never break visual capture.
    }
  }

  private async pruneCaptureAssets(currentPath: string): Promise<void> {
    const directory = join(this.userDataDir, ...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS)
    const retentionLimit = Math.max(1, Math.floor(this.options.captureRetentionLimit ?? DEFAULT_CAPTURE_RETENTION_LIMIT))
    const maxAgeMs = Math.max(1_000, Math.floor(this.options.captureMaxAgeMs ?? DEFAULT_CAPTURE_MAX_AGE_MS))
    try {
      const names = (await readdir(directory)).filter((name) => /^[A-Za-z0-9._-]+\.png$/.test(name))
      const entries = await Promise.all(names.map(async (name) => {
        const path = join(directory, name)
        const info = await stat(path).catch(() => null)
        return info?.isFile() ? { path, mtimeMs: info.mtimeMs } : null
      }))
      const nowMs = this.now().getTime()
      const sorted = entries
        .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
      const ordered = [
        ...sorted.filter((entry) => entry.path === currentPath),
        ...sorted.filter((entry) => entry.path !== currentPath)
      ]
      await Promise.all(ordered.map(async (entry, index) => {
        if (index === 0 && entry.path === currentPath) return
        if (index < retentionLimit && nowMs - entry.mtimeMs <= maxAgeMs) return
        await rm(entry.path, { force: true })
      }))
    } catch {
      // Retention is best-effort and must not turn a successful capture into a failure.
    }
  }

  private async readPersisted(): Promise<VisibleContextSnapshot> {
    try {
      const raw = await readAppDataStoreText(this.userDataDir, VISIBLE_CONTEXT_STORE_SEGMENTS)
      const parsed = visibleContextSnapshotSchema.safeParse(JSON.parse(raw) as unknown)
      if (parsed.success) {
        const normalized = sanitizeVisibleContextSnapshot({ ...parsed.data, snapshotToken: undefined })
        return this.withFreshness({
          ...normalized,
          snapshotToken: this.createSnapshotToken(normalized)
        })
      }
    } catch {
      return emptyVisibleContextSnapshot()
    }
    return emptyVisibleContextSnapshot()
  }

  private scheduleBrokerRequest(name: string): void {
    if (!name.endsWith('.request.json') || this.brokerRequests.has(name)) return
    this.brokerRequests.add(name)
    void this.processBrokerRequest(name).finally(() => this.brokerRequests.delete(name))
  }

  private async processBrokerRequest(name: string): Promise<void> {
    const directory = visibleContextCaptureRequestsPath(this.userDataDir)
    const requestPath = join(directory, name)
    const requestId = readRequestId({ requestId: name.slice(0, -'.request.json'.length) })
    let response: VisibleContextCaptureBrokerResponse
    try {
      const raw = await readFile(requestPath, 'utf8')
      const parsed = visibleContextCaptureBrokerRequestSchema.safeParse(JSON.parse(raw) as unknown)
      if (!parsed.success) {
        response = brokerFailure(requestId, this.now(), 'invalid_visual_capture_request', parsed.error.message, false)
      } else {
        const request: VisibleContextCaptureBrokerRequest = parsed.data
        if (request.requestId !== requestId) {
          response = brokerFailure(
            requestId,
            this.now(),
            'visual_capture_request_id_mismatch',
            'Visual capture requestId must match its request filename.',
            false
          )
        } else if (this.now().getTime() > Date.parse(request.expiresAt)) {
          response = brokerFailure(requestId, this.now(), 'visual_capture_request_expired', 'Visual capture request expired before it could be processed.', true)
        } else {
          const result = await this.capture({
            requestId,
            scope: request.scope,
            snapshotToken: request.snapshotToken,
            windowId: request.windowId,
            revision: request.revision,
            ...(request.activeThreadId !== undefined ? { activeThreadId: request.activeThreadId } : {}),
            ...(request.scope === 'target'
              ? { componentId: request.componentId!, targetId: request.targetId! }
              : {})
          })
          response = result.ok
            ? {
                schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
                requestId,
                completedAt: this.now().toISOString(),
                ok: true,
                capture: result.resource
              }
            : {
                schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
                requestId,
                completedAt: this.now().toISOString(),
                ok: false,
                error: result.error
              }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      response = brokerFailure(
        requestId,
        this.now(),
        'visual_capture_broker_failed',
        error instanceof Error ? error.message : 'Failed to process visual capture request.',
        true
      )
    }

    const responseName = `${requestId}.response.json`
    await atomicWriteAppDataJson(
      this.userDataDir,
      [...VISIBLE_CONTEXT_CAPTURE_REQUESTS_SEGMENTS, responseName],
      response,
      { trailingNewline: true }
    )
  }
}

function captureFailure(
  requestId: string,
  code: string,
  message: string,
  retryable: boolean
): VisibleContextCaptureResult {
  return { ok: false, requestId, error: { code, message, retryable } }
}

function brokerFailure(
  requestId: string,
  now: Date,
  code: string,
  message: string,
  retryable: boolean
): VisibleContextCaptureBrokerResponse {
  return {
    schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
    requestId,
    completedAt: now.toISOString(),
    ok: false,
    error: { code, message, retryable }
  }
}

function readRequestId(input: unknown): string {
  if (input && typeof input === 'object' && 'requestId' in input && typeof input.requestId === 'string') {
    const value = input.requestId.slice(0, 256)
    return /^[A-Za-z0-9._-]+$/.test(value) ? value : 'invalid'
  }
  return 'invalid'
}

function assertCapturedPage(captured: CapturedVisualPage): void {
  if (captured.png.byteLength === 0) throw new Error('Captured window image is empty.')
  if (!Number.isInteger(captured.width) || captured.width < 1) throw new Error('Captured image width is invalid.')
  if (!Number.isInteger(captured.height) || captured.height < 1) throw new Error('Captured image height is invalid.')
  if (!Number.isFinite(captured.scaleFactor) || captured.scaleFactor <= 0) throw new Error('Captured image scale factor is invalid.')
}

export async function redactCapturedVisualPage(
  captured: CapturedVisualPage,
  snapshot: VisibleContextSnapshot
): Promise<Uint8Array> {
  const redactions = snapshot.components
    .flatMap((component) => component.visualTargets ?? [])
    .filter((target): target is VisualContextTarget & { bounds: VisibleContextBounds } => (
      target.redact === true && Boolean(target.bounds)
    ))
  if (redactions.length === 0) return captured.png

  const captureBounds = captured.bounds ?? {
    x: 0,
    y: 0,
    width: captured.width / captured.scaleFactor,
    height: captured.height / captured.scaleFactor
  }
  const intersections = redactions
    .map((target) => intersectBounds(captureBounds, target.bounds))
    .filter((bounds): bounds is VisibleContextBounds => Boolean(bounds))
  if (intersections.length === 0) return captured.png

  const image = await loadImage(Buffer.from(captured.png))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  context.fillStyle = '#000000'
  const scaleX = image.width / captureBounds.width
  const scaleY = image.height / captureBounds.height
  for (const bounds of intersections) {
    const x = Math.floor((bounds.x - captureBounds.x) * scaleX)
    const y = Math.floor((bounds.y - captureBounds.y) * scaleY)
    const right = Math.ceil((bounds.x + bounds.width - captureBounds.x) * scaleX)
    const bottom = Math.ceil((bounds.y + bounds.height - captureBounds.y) * scaleY)
    context.fillRect(x, y, Math.max(1, right - x), Math.max(1, bottom - y))
  }
  return canvas.encodeSync('png')
}

function intersectBounds(
  container: VisibleContextBounds,
  candidate: VisibleContextBounds
): VisibleContextBounds | null {
  const x = Math.max(container.x, candidate.x)
  const y = Math.max(container.y, candidate.y)
  const right = Math.min(container.x + container.width, candidate.x + candidate.width)
  const bottom = Math.min(container.y + container.height, candidate.y + candidate.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

function sanitizeVisibleContextSnapshot(snapshot: VisibleContextSnapshot): VisibleContextSnapshot {
  return {
    ...snapshot,
    activeThreadId: snapshot.activeThreadId ?? null,
    components: snapshot.components
      .filter((component) => component.visible)
      .map(sanitizeVisibleContextComponent)
  }
}

function sanitizeVisibleContextComponent(
  component: VisibleContextComponentSnapshot
): VisibleContextComponentSnapshot {
  return {
    ...component,
    resources: component.resources?.map(sanitizeVisibleContextResource),
    visualTargets: component.visualTargets?.map((target) => ({
      ...target,
      metadata: sanitizeJsonObject(target.metadata)
    })),
    state: sanitizeJsonObject(component.state)
  }
}

function sanitizeVisibleContextResource(resource: VisibleContextResource): VisibleContextResource {
  return {
    ...resource,
    metadata: sanitizeJsonObject(resource.metadata)
  }
}

function sanitizeJsonObject(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const sanitized = sanitizeJsonValue(value, 0)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : undefined
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING_CHARS)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (depth >= MAX_JSON_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeJsonValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key.slice(0, 256)] = sanitizeJsonValue(entry, depth + 1)
    }
    return output
  }
  return undefined
}
