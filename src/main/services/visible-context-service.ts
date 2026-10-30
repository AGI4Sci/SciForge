import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHmac, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  emptyVisibleContextSnapshot,
  sanitizeVisibleContextSnapshot,
  visibleContextSnapshotSchema,
  type VisibleContextBindingFailureReason,
  type VisibleContextBounds,
  type VisibleContextCapturePreviewResult,
  type VisibleContextCaptureResult,
  type VisibleContextSnapshot,
  type VisibleContextTargetRefRequest,
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
  code: 'capture_surface_unsupported' | 'capture_surface_unavailable'
  message: string
  failureClass: string
  retryable: boolean
  recovery: {
    action: string
    instruction: string
  }
  providerStage: string
}

export type SurfaceCaptureResult =
  | { ok: true; page: CapturedVisualPage }
  | { ok: false; reason: SurfaceCaptureUnavailableReason }

export type SurfaceCaptureProvider = {
  capture: (request: SurfaceCaptureRequest) => Promise<SurfaceCaptureResult>
}

export type VisibleContextServiceOptions = {
  surfaceCaptureProvider: SurfaceCaptureProvider
  retainResourceRefs?: (input: Readonly<{
    callerId: string
    workspaceId?: string
    resourceRefs: readonly string[]
  }>) => () => void | Promise<void>
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

type VisibleContextCaptureFailureMetadata = Extract<
  VisibleContextCaptureResult,
  { ok: false }
>['error']

export class VisibleContextCaptureError extends Error {
  readonly code: string
  readonly failureClass: string
  readonly retryable: boolean
  readonly recovery: VisibleContextCaptureFailureMetadata['recovery']
  readonly providerStage: string

  constructor(metadata: VisibleContextCaptureFailureMetadata) {
    super(metadata.message)
    this.name = 'VisibleContextCaptureError'
    this.code = metadata.code
    this.failureClass = metadata.failureClass
    this.retryable = metadata.retryable
    this.recovery = metadata.recovery
    this.providerStage = metadata.providerStage
  }
}

export type RegisteredVisibleContextTarget = Readonly<{
  surface: Readonly<{
    windowId: string
    revision: number
    activeThreadId: string | null
  }>
  bounds?: VisibleContextBounds
  sensitive: boolean
  redactionBounds: readonly VisibleContextBounds[]
}>

type BoundSurface = {
  callerId: string
  activeThreadId: string
  resourceId: string
  snapshot: VisibleContextSnapshot
  turnId?: string
  releaseResources?: () => void | Promise<void>
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
  private readonly preparedSurfaceBindings = new Map<string, BoundSurface>()
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
    // `get()` is a window-agnostic compatibility read used by the agent
    // surface API. Dev and utility renderers can publish an empty snapshot
    // while the main window is still showing a live browser page; allowing
    // that publication to replace `current` makes `surface.current` appear
    // resource-less even though the authoritative main-window snapshot is
    // available. Keep the richest current snapshot across windows, while
    // still accepting empty updates from the same window (for example when
    // the browser pane is closed).
    const hasCapabilityResource = (candidate: VisibleContextSnapshot): boolean =>
      candidate.components.some((component) =>
        component.resources?.some((resource) => Boolean(resource.capability?.resourceRef))
      )
    if (
      !this.current ||
      this.current.windowId === sanitized.windowId ||
      hasCapabilityResource(sanitized) ||
      !hasCapabilityResource(this.current)
    ) {
      this.current = sanitized
    }
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
    }
    this.current = this.withFreshness(this.current)
    return this.current
  }

  peek(): VisibleContextSnapshot {
    return this.withFreshness(this.current ?? emptyVisibleContextSnapshot())
  }

  async bindSurface(
    callerId: string,
    activeThreadId: string,
    windowId: string
  ): Promise<VisibleContextSnapshot | null> {
    const prepared = await this.prepareSurfaceBinding(callerId, activeThreadId, windowId)
    return prepared ? this.claimSurfaceBinding(callerId, prepared.bindingId) : null
  }

  /**
   * Captures and retains the initiating surface before a queued turn can observe
   * later UI state. Every `null` return reports exactly one classified reason
   * through `onFailure`, so a turn packet can explain why the canonical visible
   * state was unavailable instead of degrading silently.
   */
  async prepareSurfaceBinding(
    callerId: string,
    ownerThreadId: string | null | undefined,
    windowId: string,
    onFailure?: (reason: VisibleContextBindingFailureReason) => void
  ): Promise<Readonly<{ bindingId: string; snapshot: VisibleContextSnapshot }> | null> {
    const reportFailure = (reason: VisibleContextBindingFailureReason): void => {
      try {
        onFailure?.(reason)
      } catch {
        // Binding diagnostics are advisory and must never change the binding outcome.
      }
    }
    const normalizedCallerId = callerId.trim()
    const normalizedThreadId = ownerThreadId?.trim() ?? ''
    const normalizedWindowId = windowId.trim()
    // The host resolves the owner with
    // `resolveVisibleContextOwnerThreadId(ownerThreadId, turnThreadId)` before
    // asking for a binding, so a blank value here means neither the declared
    // owner nor the turn's own session could be resolved.
    if (!normalizedThreadId) {
      reportFailure('owner_thread_unavailable')
      return null
    }
    if (!normalizedCallerId || !normalizedWindowId) {
      // No publication can be located for an unidentified request.
      reportFailure('window_unpublished')
      return null
    }
    const currentSnapshot = this.snapshots.get(normalizedWindowId)
    // Always ask the initiating renderer for its newest publication at the
    // question-time boundary. Renderer components publish asynchronously, so
    // reusing an otherwise valid same-thread snapshot can omit a capability
    // resource that became ready just before the user submitted the turn.
    // The browser panel publishes its capability resource after its native
    // page becomes ready. A turn can be submitted in the small interval
    // between the panel becoming visible and that publication, so give the
    // renderer a bounded opportunity to publish the authoritative snapshot.
    let snapshot = await this.requestRendererSnapshotForWindow(
      normalizedWindowId,
      currentSnapshot?.revision ?? 0
    )
    // Bounded fallback for a window that has published NOTHING in this process
    // yet (renderer reload or startup). The refresh above already gave that
    // renderer one full bounded ask for a fresh publication, so a persisted
    // snapshot for this exact window AND session is strictly better than
    // spending the whole retry budget and then reporting "unavailable". A live
    // publication for another session keeps the full budget below, which is what
    // preserves the session-switch self-healing race.
    if (!this.snapshots.get(normalizedWindowId)) {
      const persisted = await this.persistedSnapshotWithinBoundedWindow()
      if (
        persisted &&
        persisted.windowId === normalizedWindowId &&
        (persisted.activeThreadId ?? null) === normalizedThreadId
      ) {
        return this.retainPreparedBinding(normalizedCallerId, normalizedThreadId, persisted)
      }
    }
    // Native browser pages can take longer than the renderer's first paint to
    // produce their capability handle. Keep the question-time binding alive
    // for a short bounded window so a turn submitted immediately after
    // opening the panel still receives the page resource.
    // Native browser resources are published only after Chromium has produced
    // its first observation. That can take a few polling intervals on a cold
    // page (especially immediately after a workspace session is promoted to a
    // real thread). Keep the question-time boundary bounded, but long enough
    // to cover that startup window instead of injecting an unavailable
    // snapshot into an otherwise valid edit request.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const live = snapshot.windowId === normalizedWindowId
        ? snapshot
        : this.snapshots.get(normalizedWindowId)
      // The full bounded budget is spent whenever the window still publishes
      // another session, its own publication is still starting, or it published
      // nothing at all and no persisted snapshot for this turn was usable above:
      // the renderer's shell can switch sessions a few tens of milliseconds AFTER
      // the turn was sent (React effect -> setVisibleContextShell -> publish, and
      // the queue drain runs before that), so a mismatch observed now is often
      // resolved by the very next refresh round-trip. Only this session's own
      // publication with its capability resources ready ends the wait early.
      const components = live?.components ?? []
      const hasThread = live !== undefined && (live.activeThreadId ?? null) === normalizedThreadId
      const hasCapabilityResource = components.some(component =>
        component.resources?.some(resource =>
          Boolean(resource.capability?.resourceRef)
        )
      )
      const hasBrowserComponent = components.some(component =>
        component.component === 'browser-preview' || component.resources?.some(resource =>
          resource.kind === 'browser-page'
        )
      )
      const hasBrowserResource = components.some(component =>
        component.resources?.some(resource => resource.kind === 'browser-page' &&
          Boolean(resource.capability?.resourceRef))
      )
      if (hasThread && hasCapabilityResource && (!hasBrowserComponent || hasBrowserResource)) break
      await new Promise(resolve => setTimeout(resolve, 100))
      snapshot = await this.requestRendererSnapshotForWindow(
        normalizedWindowId,
        live?.revision ?? currentSnapshot?.revision ?? 0
      )
    }
    const liveSnapshot = snapshot.windowId === normalizedWindowId
      ? snapshot
      : this.snapshots.get(normalizedWindowId)
    if (liveSnapshot) {
      // Never bind another session's visible state, even when it is newer.
      if ((liveSnapshot.activeThreadId ?? null) !== normalizedThreadId) {
        reportFailure('thread_mismatch')
        return null
      }
      return this.retainPreparedBinding(normalizedCallerId, normalizedThreadId, liveSnapshot)
    }
    // The renderer only rewrites the persisted snapshot with a strictly higher
    // revision, so it stays authoritative when this process holds no publication
    // for the window (renderer reload, or a turn that arrives before the first
    // publish). Bind it only when window and session both match.
    const persisted = await this.readPersisted()
    if (persisted.windowId !== normalizedWindowId) {
      reportFailure('window_unpublished')
      return null
    }
    if ((persisted.activeThreadId ?? null) !== normalizedThreadId) {
      reportFailure('thread_mismatch')
      return null
    }
    return this.retainPreparedBinding(normalizedCallerId, normalizedThreadId, persisted)
  }

  private retainPreparedBinding(
    callerId: string,
    activeThreadId: string,
    snapshot: VisibleContextSnapshot
  ): Readonly<{ bindingId: string; snapshot: VisibleContextSnapshot }> {
    const binding = this.createSurfaceBinding(callerId, activeThreadId, snapshot)
    this.preparedSurfaceBindings.set(binding.resourceId, binding)
    this.pruneSurfaceBindings()
    return { bindingId: binding.resourceId, snapshot: binding.snapshot }
  }

  private createSurfaceBinding(
    callerId: string,
    activeThreadId: string,
    snapshot: VisibleContextSnapshot
  ): BoundSurface {
    const resourceRefs = snapshotResourceRefs(snapshot)
    // Retention is best effort. The published catalog is the authority for what
    // is visible: a capability resourceRef that the broker has already retired,
    // renewed, or never issued must never invalidate the whole turn's visible
    // state. Retention only defers provider retirement, so a failed retention
    // grants nothing and must degrade to a per-resource error when that resource
    // is invoked (the broker still fails closed with its own typed error), never
    // to "the UI state is unavailable".
    let releaseResources: (() => void | Promise<void>) | undefined
    if (resourceRefs.length) {
      try {
        releaseResources = this.options.retainResourceRefs?.({
          callerId,
          ...(snapshot.workspaceRoot ? { workspaceId: snapshot.workspaceRoot } : {}),
          resourceRefs
        }) ?? undefined
      } catch {
        releaseResources = undefined
      }
    }
    const resourceId = `bound_surface_${createHmac('sha256', this.surfaceRefSecret)
      .update(`${callerId}\u0000${snapshot.windowId}\u0000${snapshot.revision}\u0000${randomBytes(16).toString('base64url')}`)
      .digest('base64url')}`
    const binding: BoundSurface = {
      callerId,
      activeThreadId,
      resourceId,
      snapshot,
      ...(releaseResources ? { releaseResources } : {})
    }
    return binding
  }

  /** Transfer a prepared question-time snapshot when a runtime allocates a new session id. */
  transferPreparedSurfaceBinding(sourceCallerId: string, bindingId: string, targetCallerId: string): string | null {
    const prepared = this.preparedSurfaceBindings.get(bindingId)
    if (!prepared || prepared.callerId !== sourceCallerId.trim() || !targetCallerId.trim()) return null
    const target = this.createSurfaceBinding(targetCallerId.trim(), prepared.activeThreadId, prepared.snapshot)
    this.preparedSurfaceBindings.set(target.resourceId, target)
    this.preparedSurfaceBindings.delete(bindingId)
    void Promise.resolve(prepared.releaseResources?.()).catch(() => undefined)
    return target.resourceId
  }

  claimSurfaceBinding(callerId: string, bindingId: string): VisibleContextSnapshot | null {
    const normalizedCallerId = callerId.trim()
    const normalizedBindingId = bindingId.trim()
    const prepared = this.preparedSurfaceBindings.get(normalizedBindingId)
    if (!prepared || prepared.callerId !== normalizedCallerId) return null
    this.preparedSurfaceBindings.delete(normalizedBindingId)
    const previous = this.boundSurfacesByCaller.get(normalizedCallerId)
    if (previous) this.releaseBinding(previous)
    this.boundSurfacesByCaller.set(normalizedCallerId, prepared)
    this.boundSurfacesByResource.set(prepared.resourceId, prepared)
    return prepared.snapshot
  }

  boundSurface(callerId: string, bindingId?: string): VisibleContextSnapshot | null {
    const binding = this.boundSurfacesByCaller.get(callerId.trim())
    if (!binding) return null
    return !bindingId || binding.resourceId === bindingId.trim() ? binding.snapshot : null
  }

  assignSurfaceTurn(callerId: string, turnId: string, bindingId?: string): boolean {
    const binding = this.boundSurfacesByCaller.get(callerId.trim())
    const normalizedTurnId = turnId.trim()
    if (!binding || !normalizedTurnId) return false
    if (bindingId && binding.resourceId !== bindingId.trim()) return false
    binding.turnId = normalizedTurnId
    return true
  }

  async discardSurfaceBinding(callerId: string, bindingId: string): Promise<void> {
    const binding = this.preparedSurfaceBindings.get(bindingId.trim())
    if (!binding || binding.callerId !== callerId.trim()) return
    this.preparedSurfaceBindings.delete(binding.resourceId)
    await binding.releaseResources?.()
  }

  async releaseSurface(callerId: string, bindingId?: string, turnId?: string): Promise<void> {
    const binding = this.boundSurfacesByCaller.get(callerId.trim())
    if (!binding || (bindingId && binding.resourceId !== bindingId.trim())) return
    if (turnId && binding.turnId !== turnId.trim()) return
    this.boundSurfacesByCaller.delete(binding.callerId)
    this.boundSurfacesByResource.delete(binding.resourceId)
    await binding.releaseResources?.()
  }

  async currentSurface(callerId?: string): Promise<{
    resourceId: string
    workspaceId?: string
    semanticRevision: string
    layoutRevision: string
    state: CapabilityJsonValue
  }> {
    const binding = callerId ? this.boundSurfacesByCaller.get(callerId) : undefined
    if (callerId && !binding) {
      throw new Error('No visible SciForge surface is bound to this runtime thread.')
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
      let snapshot = binding
        ? this.snapshots.get(binding.snapshot.windowId) ?? binding.snapshot
        : this.snapshots.get(resourceId)
      if (!snapshot) {
        throw new Error('The visible surface is no longer available.')
      }
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
        const match = this.findRegisteredTarget(snapshot, input.targetRef)
        if (!match) throw new Error('The selected surface target is no longer visible.')
        componentId = match.componentId
        target = match.target
      }
      return this.captureSurfaceSnapshot(snapshot, {
        requestId: `surface-${randomBytes(12).toString('hex')}`,
        ...(componentId && target ? { componentId, target } : {})
      })
    })
    if (!captured.ok) throw new VisibleContextCaptureError(captured.error)
    return {
      path: captured.resource.path,
      mimeType: 'image/png',
      capturedAt: captured.resource.capturedAt,
      width: captured.resource.width,
      height: captured.resource.height,
      ...(input.targetRef ? { targetRef: input.targetRef } : {})
    }
  }

  /**
   * Resolves an opaque targetRef exclusively against the current Host registry.
   * The returned geometry is for main-process visual-capture composition only;
   * it is never exposed through DomainMainHost.
   */
  async resolveRegisteredTarget(
    targetRef: string
  ): Promise<RegisteredVisibleContextTarget | null> {
    const normalizedTargetRef = targetRef.trim()
    if (!normalizedTargetRef) return null
    let snapshot: VisibleContextSnapshot | undefined
    for (const candidate of this.snapshots.values()) {
      if (this.findRegisteredTarget(candidate, normalizedTargetRef)) {
        snapshot = candidate
        break
      }
    }
    if (!snapshot) return null
    snapshot = await this.refreshLayoutOnDemand(snapshot)
    const match = this.findRegisteredTarget(snapshot, normalizedTargetRef)
    if (!match) return null
    return {
      surface: {
        windowId: snapshot.windowId,
        revision: snapshot.revision,
        activeThreadId: snapshot.activeThreadId ?? null
      },
      ...(match.target.bounds ? { bounds: match.target.bounds } : {}),
      sensitive: match.target.redact === true,
      redactionBounds: snapshot.components.flatMap((component) => (
        (component.visualTargets ?? []).flatMap((target) => (
          target.redact === true && target.bounds ? [target.bounds] : []
        ))
      ))
    }
  }

  async registeredTargetRef(
    windowId: string,
    input: VisibleContextTargetRefRequest
  ): Promise<string | null> {
    const snapshot = this.snapshots.get(windowId)
    if (!snapshot) return null
    const component = snapshot.components.find((candidate) => (
      candidate.id === input.componentId
    ))
    const target = component?.visualTargets?.find((candidate) => (
      candidate.id === input.targetId
    ))
    if (!component || !target || target.redact === true) return null
    return this.surfaceTargetRef(snapshot.windowId, component.id, target.id)
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
        {
          code: 'visual_target_bounds_unavailable',
          message: 'The current visual target has no CSS viewport bounds.',
          failureClass: 'layout_unavailable',
          retryable: true,
          recovery: {
            action: 'refresh_visual_layout',
            instruction: 'Refresh the current surface layout and retry this visual target once.'
          },
          providerStage: 'surface_capture'
        }
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
        return captureFailure(input.requestId, capture.reason)
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

  private findRegisteredTarget(
    snapshot: VisibleContextSnapshot,
    targetRef: string
  ): { componentId: string; target: VisualContextTarget } | null {
    for (const component of snapshot.components) {
      const target = component.visualTargets?.find((candidate) => (
        this.surfaceTargetRef(snapshot.windowId, component.id, candidate.id) === targetRef
      ))
      if (target) return { componentId: component.id, target }
    }
    return null
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
    return this.requestRendererSnapshotForWindow(snapshot.windowId, snapshot.revision)
  }

  private async requestRendererSnapshotForWindow(
    windowId: string,
    minimumRevision: number
  ): Promise<VisibleContextSnapshot> {
    if (!this.options.requestSurfaceRefresh) {
      return this.snapshots.get(windowId) ?? emptyVisibleContextSnapshot()
    }
    return new Promise<VisibleContextSnapshot>((resolve) => {
      const waiter: LayoutRefreshWaiter = {
        windowId,
        minimumRevision,
        resolve,
        timer: setTimeout(() => {
          this.layoutRefreshWaiters.delete(waiter)
          resolve(this.snapshots.get(windowId) ?? emptyVisibleContextSnapshot())
        }, LAYOUT_REFRESH_TIMEOUT_MS)
      }
      waiter.timer.unref?.()
      this.layoutRefreshWaiters.add(waiter)
      try {
        this.options.requestSurfaceRefresh?.(windowId)
      } catch {
        clearTimeout(waiter.timer)
        this.layoutRefreshWaiters.delete(waiter)
        resolve(this.snapshots.get(windowId) ?? emptyVisibleContextSnapshot())
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
    return (snapshot.activeThreadId ?? null) === binding.activeThreadId
  }

  private pruneSurfaceBindings(): void {
    while (this.boundSurfacesByCaller.size > MAX_SURFACE_BINDINGS) {
      const oldestCallerId = this.boundSurfacesByCaller.keys().next().value as string | undefined
      if (!oldestCallerId) return
      const binding = this.boundSurfacesByCaller.get(oldestCallerId)
      if (binding) this.releaseBinding(binding)
    }
    while (this.preparedSurfaceBindings.size > MAX_SURFACE_BINDINGS) {
      const oldestBindingId = this.preparedSurfaceBindings.keys().next().value as string | undefined
      if (!oldestBindingId) return
      const binding = this.preparedSurfaceBindings.get(oldestBindingId)
      this.preparedSurfaceBindings.delete(oldestBindingId)
      if (binding) void Promise.resolve(binding.releaseResources?.()).catch(() => undefined)
    }
  }

  private releaseBinding(binding: BoundSurface): void {
    this.boundSurfacesByCaller.delete(binding.callerId)
    this.boundSurfacesByResource.delete(binding.resourceId)
    void Promise.resolve(binding.releaseResources?.()).catch(() => undefined)
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

  /**
   * Reads the persisted snapshot without ever gating the bounded polling loop:
   * a disk read that does not answer within the same bounded interval the
   * renderer gets resolves to `null`, so the retry budget stays the upper bound
   * on how long a turn can spend resolving its visible state.
   */
  private async persistedSnapshotWithinBoundedWindow(): Promise<VisibleContextSnapshot | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.readPersisted(),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), LAYOUT_REFRESH_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

}

function captureFailure(
  requestId: string,
  error: VisibleContextCaptureFailureMetadata
): VisibleContextCaptureResult {
  return { ok: false, requestId, error }
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

function snapshotResourceRefs(snapshot: VisibleContextSnapshot): string[] {
  return [...new Set(snapshot.components.flatMap((component) => (
    component.resources?.flatMap((resource) => {
      const resourceRef = resource.capability?.resourceRef?.trim()
      return resourceRef ? [resourceRef] : []
    }) ?? []
  )))]
}
