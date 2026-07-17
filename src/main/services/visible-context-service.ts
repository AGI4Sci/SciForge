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
import {
  surfaceInspectInputSchema,
  surfaceInspectOutputSchema,
  type SurfaceInspectInput,
  type SurfaceInspectOutput
} from '../../shared/surface-inspection'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import type {
  VisualInspectionRequest,
  VisualInspector
} from '../../../packages/workers/workspace-intel/src/visual-inspection'
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
  visualInspector?: () => VisualInspector | undefined | Promise<VisualInspector | undefined>
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

export class VisibleContextService {
  private current: VisibleContextSnapshot | null = null
  private readonly snapshots = new Map<string, VisibleContextSnapshot>()
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

  async currentSurface(): Promise<{
    resourceId: string
    workspaceId?: string
    semanticRevision: string
    layoutRevision: string
    state: CapabilityJsonValue
  }> {
    const snapshot = await this.get()
    if (snapshot.windowId === 'unavailable') {
      throw new Error('No visible SciForge surface is currently available.')
    }
    return {
      resourceId: snapshot.windowId,
      ...(snapshot.workspaceRoot ? { workspaceId: snapshot.workspaceRoot } : {}),
      semanticRevision: this.surfaceSemanticRevision(snapshot),
      layoutRevision: String(snapshot.revision),
      state: this.surfaceObservationState(snapshot)
    }
  }

  async inspectSurface(
    resourceId: string,
    rawInput: SurfaceInspectInput
  ): Promise<SurfaceInspectOutput> {
    const input = surfaceInspectInputSchema.parse(rawInput)
    const captured = await this.enqueueCapture(async () => {
      const snapshot = await this.get()
      if (snapshot.windowId !== resourceId) {
        throw new Error('The visible surface is no longer available.')
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
    const inspector = await this.options.visualInspector?.()
    if (!inspector) throw new Error('Visual understanding is unavailable.')
    const request: VisualInspectionRequest = {
      task: input.task,
      artifacts: [{ id: 'surface', imagePath: captured.resource.path, mimeType: 'image/png' }],
      ...(input.truthLocks ? { truthLocks: input.truthLocks } : {}),
      ...(input.outputIntent ? { outputIntent: input.outputIntent } : {})
    }
    const evidence = await inspector(request)
    if (evidence.status !== 'inspected') throw new Error(evidence.message)
    return surfaceInspectOutputSchema.parse({
      artifact: {
        artifactRef: `artifact_${createHmac('sha256', this.surfaceRefSecret)
          .update(captured.resource.path)
          .digest('base64url')}`,
        mimeType: 'image/png',
        capturedAt: captured.resource.capturedAt,
        width: captured.resource.width,
        height: captured.resource.height,
        ...(input.targetRef ? { targetRef: input.targetRef } : {})
      },
      evidence
    })
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
