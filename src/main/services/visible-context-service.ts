import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHmac, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  emptyVisibleContextSnapshot,
  visibleContextSnapshotSchema,
  type VisibleContextBounds,
  type VisibleContextCapturePreviewResult,
  type VisibleContextCaptureResult,
  type VisibleContextComponentSnapshot,
  type VisibleContextResource,
  type VisibleContextSnapshot,
  type VisibleContextVisualSnapshotResource,
  type VisualContextTarget
} from '../../shared/visible-context'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import {
  atomicWriteAppDataJson,
  atomicWriteAppDataText,
  readAppDataStoreText
} from './app-data-store'

export const VISIBLE_CONTEXT_STORE_SEGMENTS = ['visible-context', 'snapshot.json'] as const
export const VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS = ['visible-context', 'captures'] as const

const MAX_OBJECT_KEYS = 64
const MAX_ARRAY_ITEMS = 64
const MAX_STRING_CHARS = 4096
const MAX_JSON_DEPTH = 6
const DEFAULT_CAPTURE_RETENTION_LIMIT = 64
const DEFAULT_CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CAPTURE_PREVIEW_BYTES = 32 * 1024 * 1024
const MAX_SURFACE_BINDINGS = 512
const LAYOUT_REFRESH_TIMEOUT_MS = 1_000
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
  onCaptureState?: (windowId: string, active: boolean) => void
  requestSurfaceRefresh?: (windowId: string) => void
  now?: () => Date
  captureRetentionLimit?: number
  captureMaxAgeMs?: number
}

export type VisibleContextCapturedFrame = Readonly<{
  path: string
  mimeType: 'image/png'
  capturedAt: string
  width: number
  height: number
  targetRef?: string
}>

type BoundSurface = {
  callerId: string
  activeThreadId: string
  resourceId: string
  snapshot: VisibleContextSnapshot
}

type LayoutRefreshWaiter = {
  windowId: string
  minimumRevision: number
  resolve: (snapshot: VisibleContextSnapshot) => void
  timer: ReturnType<typeof setTimeout>
}

export function visibleContextSnapshotPath(userDataDir: string): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_STORE_SEGMENTS)
}

export function visibleContextCapturePath(userDataDir: string, requestId = 'latest'): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS, `${requestId}.png`)
}

export class VisibleContextService {
  private current: VisibleContextSnapshot | null = null
  private readonly snapshots = new Map<string, VisibleContextSnapshot>()
  private readonly boundSurfacesByCaller = new Map<string, BoundSurface>()
  private readonly boundSurfacesByResource = new Map<string, BoundSurface>()
  private readonly layoutRefreshWaiters = new Set<LayoutRefreshWaiter>()
  private readonly surfaceRefSecret = randomBytes(32)
  private captureQueue: Promise<void> = Promise.resolve()
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
    const sanitized = this.withFreshness(sanitizeVisibleContextSnapshot(parsed))
    this.snapshots.set(sanitized.windowId, sanitized)
    this.current = sanitized
    this.resolveLayoutRefreshWaiters(sanitized)
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
    }
    this.current = this.withFreshness(this.current)
    return this.current
  }

  peek(): VisibleContextSnapshot {
    return this.withFreshness(this.current ?? emptyVisibleContextSnapshot())
  }

  async bindCurrentSurface(callerId: string, activeThreadId: string): Promise<VisibleContextSnapshot | null> {
    const normalizedCallerId = callerId.trim()
    const normalizedThreadId = activeThreadId.trim()
    if (!normalizedCallerId || !normalizedThreadId) return null
    let snapshot = await this.get()
    if (snapshot.windowId === 'unavailable') return null
    if ((snapshot.activeThreadId ?? null) !== normalizedThreadId) {
      snapshot = await this.requestRendererSnapshot(snapshot)
      if ((snapshot.activeThreadId ?? null) !== normalizedThreadId) return null
    }
    const previous = this.boundSurfacesByCaller.get(normalizedCallerId)
    if (previous) this.boundSurfacesByResource.delete(previous.resourceId)
    const resourceId = `bound_surface_${createHmac('sha256', this.surfaceRefSecret)
      .update(`${normalizedCallerId}\u0000${snapshot.windowId}\u0000${snapshot.revision}`)
      .digest('base64url')}`
    const binding: BoundSurface = {
      callerId: normalizedCallerId,
      activeThreadId: normalizedThreadId,
      resourceId,
      snapshot
    }
    this.boundSurfacesByCaller.set(normalizedCallerId, binding)
    this.boundSurfacesByResource.set(resourceId, binding)
    this.pruneSurfaceBindings()
    return snapshot
  }

  async currentSurface(callerId?: string): Promise<{
    resourceId: string
    workspaceId?: string
    semanticRevision: string
    layoutRevision: string
    state: CapabilityJsonValue
  }> {
    let binding = callerId ? this.boundSurfacesByCaller.get(callerId) : undefined
    if (callerId && !binding) {
      const visible = await this.get()
      const activeThreadId = visible.activeThreadId?.trim()
      if (activeThreadId) {
        await this.bindCurrentSurface(callerId, activeThreadId)
        binding = this.boundSurfacesByCaller.get(callerId)
      }
    }
    const snapshot = binding?.snapshot ?? await this.get()
    if (snapshot.windowId === 'unavailable') {
      throw new Error('No visible SciForge surface is currently available.')
    }
    return {
      resourceId: binding?.resourceId ?? snapshot.windowId,
      ...(snapshot.workspaceRoot ? { workspaceId: snapshot.workspaceRoot } : {}),
      semanticRevision: this.surfaceSemanticRevision(snapshot),
      layoutRevision: String(snapshot.revision),
      state: this.surfaceObservationState(snapshot)
    }
  }

  /**
   * Captures one trusted, redacted visual frame without interpreting it.
   * Callers receive only the managed frame path and pixel metadata; semantic
   * inspection and workspace persistence remain owned by AgentVisualRuntime.
   */
  async captureFrame(
    resourceId: string,
    input: Readonly<{ targetRef?: string }> = {}
  ): Promise<VisibleContextCapturedFrame> {
    const captured = await this.enqueueCapture(async () => {
      const binding = this.boundSurfacesByResource.get(resourceId)
      let snapshot = await this.get()
      if (binding && !this.boundSurfaceIsVisible(binding, snapshot)) {
        throw new Error('The bound surface layout is unavailable while another session or resource is visible.')
      }
      if (!binding && snapshot.windowId !== resourceId) {
        throw new Error('The visible surface is no longer available.')
      }
      snapshot = await this.refreshLayoutOnDemand(snapshot)
      if (binding && !this.boundSurfaceIsVisible(binding, snapshot)) {
        throw new Error('The bound surface layout became unavailable before visual inspection.')
      }
      let componentId: string | undefined
      let target: VisualContextTarget | undefined
      if (input.targetRef) {
        for (const component of snapshot.components) {
          const match = component.visualTargets?.find((candidate) => (
            this.surfaceTargetRef(snapshot.windowId, component.id, candidate.id) === input.targetRef
          ))
          if (!match) continue
          componentId = component.id
          target = match
          break
        }
        if (!target || !componentId) throw new Error('The selected surface target is no longer visible.')
      }
      return this.captureSurfaceSnapshot(snapshot, {
        requestId: `surface-${randomBytes(12).toString('hex')}`,
        ...(componentId && target ? { componentId, target } : {})
      })
    })
    if (!captured.ok) throw new Error(captured.error.message)
    return {
      path: captured.resource.path,
      mimeType: 'image/png',
      capturedAt: captured.resource.capturedAt,
      width: captured.resource.width,
      height: captured.resource.height,
      ...(input.targetRef ? { targetRef: input.targetRef } : {})
    }
  }

  private async captureSurfaceSnapshot(
    snapshot: VisibleContextSnapshot,
    input: { requestId: string; componentId?: string; target?: VisualContextTarget }
  ): Promise<VisibleContextCaptureResult> {
    const target = input.target
    const bounds = target?.bounds
    if (target && target.kind !== 'window' && !bounds) {
      return captureFailure(
        input.requestId,
        'visual_target_bounds_unavailable',
        'The current visual target has no CSS viewport bounds.',
        true
      )
    }
    this.setCaptureState(snapshot.windowId, true)
    try {
      const capture = await this.options.surfaceCaptureProvider.capture({
        windowId: snapshot.windowId,
        revision: snapshot.revision,
        activeThreadId: snapshot.activeThreadId ?? null,
        ...(bounds ? { bounds } : {})
      })
      if (!capture.ok) {
        return captureFailure(input.requestId, capture.reason.code, capture.reason.message, capture.reason.retryable)
      }
      const captured = capture.page
      assertCapturedPage(captured)
      const png = await redactCapturedVisualPage(captured, snapshot)
      const captureName = `${input.requestId}.png`
      await atomicWriteAppDataText(
        this.userDataDir,
        [...VISIBLE_CONTEXT_CAPTURE_DIRECTORY_SEGMENTS, captureName],
        png
      )
      const path = this.capturePath(input.requestId)
      await this.pruneCaptureAssets(path)
      const capturedAt = this.now().toISOString()
      return {
        ok: true,
        requestId: input.requestId,
        resource: {
          kind: 'visualSnapshot',
          role: target ? 'target' : 'window',
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
          ...(target && input.componentId
            ? {
                componentId: input.componentId,
                targetId: target.id,
                target: { ...target, bounds: captured.bounds ?? target.bounds }
              }
            : {})
        }
      }
    } catch (error) {
      return captureFailure(
        input.requestId,
        'visual_capture_failed',
        error instanceof Error ? error.message : 'Failed to capture the SciForge surface.',
        true
      )
    } finally {
      this.setCaptureState(snapshot.windowId, false)
    }
  }

  private surfaceSemanticRevision(snapshot: VisibleContextSnapshot): string {
    const semantic = {
      windowId: snapshot.windowId,
      activeThreadId: snapshot.activeThreadId ?? null,
      workspaceRoot: snapshot.workspaceRoot ?? null,
      route: snapshot.route ?? null,
      components: snapshot.components.map((component) => ({
        id: component.id,
        region: component.region,
        component: component.component,
        title: component.title ?? null,
        summary: component.summary,
        state: component.state ?? null,
        targets: (component.visualTargets ?? []).map((target) => ({
          id: target.id,
          kind: target.kind,
          contentType: target.contentType ?? null,
          page: target.page ?? null,
          active: target.active ?? null
        })),
        resources: (component.resources ?? []).map((resource) => ({
          kind: resource.kind,
          role: resource.role ?? null,
          title: resource.title ?? resource.name ?? null,
          resourceRef: resource.capability?.resourceRef ?? null,
          semanticRevision: resource.capability && 'resource' in resource.capability
            ? resource.capability.resource.semanticRevision
            : null,
          annotationCount: resource.annotationCount ?? null,
          threadCount: resource.threadCount ?? null,
          openThreadCount: resource.openThreadCount ?? null,
          selectedThreadId: resource.selectedThreadId ?? null,
          metadata: resource.metadata ?? null
        }))
      }))
    }
    return `surface_${createHmac('sha256', this.surfaceRefSecret)
      .update(JSON.stringify(semantic))
      .digest('base64url')}`
  }

  private surfaceTargetRef(windowId: string, componentId: string, targetId: string): string {
    return `target_${createHmac('sha256', this.surfaceRefSecret)
      .update(`${windowId}\u0000${componentId}\u0000${targetId}`)
      .digest('base64url')}`
  }

  private surfaceObservationState(snapshot: VisibleContextSnapshot): CapabilityJsonValue {
    return {
      ...(snapshot.route ? { route: snapshot.route } : {}),
      layoutFreshness: snapshot.freshness,
      targets: snapshot.components.flatMap((component) => (
        (component.visualTargets ?? []).map((target) => ({
          targetRef: this.surfaceTargetRef(snapshot.windowId, component.id, target.id),
          kind: target.kind,
          ...(target.contentType ? { contentType: target.contentType } : {}),
          ...(component.title ? { title: component.title } : {}),
          ...(target.page ? { page: target.page } : {}),
          ...(target.active !== undefined ? { active: target.active } : {})
        }))
      )),
      resources: snapshot.components.flatMap((component) => (
        (component.resources ?? []).flatMap((resource) => resource.capability
          ? [{
              kind: resource.kind,
              ...(resource.role ? { role: resource.role } : {}),
              ...(resource.title || resource.name
                ? { title: resource.title ?? resource.name }
                : {}),
              component: component.component,
              priority: component.priority ?? 0,
              active: true,
              updatedAt: resource.updatedAt ?? component.updatedAt,
              ...(('resourceRef' in resource.capability && resource.capability.resourceRef)
                ? { resourceRef: resource.capability.resourceRef }
                : 'resource' in resource.capability
                  ? { resource: resource.capability.resource }
                  : {})
            }]
          : [])
      ))
    }
  }

  private enqueueCapture(
    operation: () => Promise<VisibleContextCaptureResult>
  ): Promise<VisibleContextCaptureResult> {
    const run = this.captureQueue.then(operation, operation)
    this.captureQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async refreshLayoutOnDemand(snapshot: VisibleContextSnapshot): Promise<VisibleContextSnapshot> {
    if (!snapshot.freshness.stale) return snapshot
    const refreshed = await this.requestRendererSnapshot(snapshot)
    if (refreshed.windowId !== snapshot.windowId || refreshed.freshness.stale) {
      throw new Error('The surface layout did not refresh before visual inspection.')
    }
    return refreshed
  }

  private async requestRendererSnapshot(snapshot: VisibleContextSnapshot): Promise<VisibleContextSnapshot> {
    if (!this.options.requestSurfaceRefresh) return snapshot
    return new Promise<VisibleContextSnapshot>((resolve) => {
      const waiter: LayoutRefreshWaiter = {
        windowId: snapshot.windowId,
        minimumRevision: snapshot.revision,
        resolve,
        timer: setTimeout(() => {
          this.layoutRefreshWaiters.delete(waiter)
          resolve(this.peek())
        }, LAYOUT_REFRESH_TIMEOUT_MS)
      }
      waiter.timer.unref?.()
      this.layoutRefreshWaiters.add(waiter)
      try {
        this.options.requestSurfaceRefresh?.(snapshot.windowId)
      } catch {
        clearTimeout(waiter.timer)
        this.layoutRefreshWaiters.delete(waiter)
        resolve(this.peek())
      }
    })
  }

  private resolveLayoutRefreshWaiters(snapshot: VisibleContextSnapshot): void {
    for (const waiter of this.layoutRefreshWaiters) {
      if (waiter.windowId !== snapshot.windowId || snapshot.revision <= waiter.minimumRevision) continue
      clearTimeout(waiter.timer)
      this.layoutRefreshWaiters.delete(waiter)
      waiter.resolve(snapshot)
    }
  }

  private boundSurfaceIsVisible(binding: BoundSurface, snapshot: VisibleContextSnapshot): boolean {
    if (snapshot.windowId !== binding.snapshot.windowId) return false
    if ((snapshot.activeThreadId ?? null) !== binding.activeThreadId) return false
    const boundRefs = this.surfaceResourceRefs(binding.snapshot)
    if (boundRefs.size > 0) {
      const currentRefs = this.surfaceResourceRefs(snapshot)
      return [...boundRefs].some((resourceRef) => currentRefs.has(resourceRef))
    }
    return this.surfaceSemanticRevision(snapshot) === this.surfaceSemanticRevision(binding.snapshot)
  }

  private surfaceResourceRefs(snapshot: VisibleContextSnapshot): Set<string> {
    return new Set(snapshot.components.flatMap((component) => (
      (component.resources ?? []).flatMap((resource) => resource.capability?.resourceRef ?? [])
    )))
  }

  private pruneSurfaceBindings(): void {
    while (this.boundSurfacesByCaller.size > MAX_SURFACE_BINDINGS) {
      const oldestCallerId = this.boundSurfacesByCaller.keys().next().value as string | undefined
      if (!oldestCallerId) return
      const binding = this.boundSurfacesByCaller.get(oldestCallerId)
      this.boundSurfacesByCaller.delete(oldestCallerId)
      if (binding) this.boundSurfacesByResource.delete(binding.resourceId)
    }
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
        return this.withFreshness(sanitizeVisibleContextSnapshot(parsed.data))
      }
    } catch {
      return emptyVisibleContextSnapshot()
    }
    return emptyVisibleContextSnapshot()
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
