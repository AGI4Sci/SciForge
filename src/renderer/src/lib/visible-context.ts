import {
  VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS,
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextBounds,
  type VisibleContextComponentSnapshot,
  type VisibleContextPublishInput,
  type VisualContextTarget
} from '@shared/visible-context'
import type {
  DomainVisibleContextInspection,
  DomainVisibleContextPoint,
  DomainVisibleContextSelectionInspection
} from '@sciforge/domain-sdk/host'

type VisibleContextShell = {
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
}

const components = new Map<string, VisibleContextComponentSnapshot>()
type VisualTargetRegistration = {
  componentId: string
  target: Omit<VisualContextTarget, 'bounds'> & { bounds?: VisibleContextBounds }
  element?: () => Element | null
  relativeBounds?: VisibleContextBounds
}

const visualTargets = new Map<string, VisualTargetRegistration>()
const sensitiveTargetIds = new WeakMap<Element, string>()
let nextSensitiveTargetId = 0
let shell: VisibleContextShell = {}
let publishTimer: number | null = null
let revision = 0

export function setVisibleContextShell(next: VisibleContextShell): void {
  ensureVisibleContextRefreshListener()
  shell = {
    activeThreadId: next.activeThreadId ?? null,
    workspaceRoot: next.workspaceRoot || undefined,
    route: next.route || undefined
  }
  scheduleVisibleContextPublish()
}

export function registerVisibleContextComponent(
  component: VisibleContextComponentSnapshot
): () => void {
  ensureVisibleContextRefreshListener()
  const snapshot = {
    ...component,
    visible: component.visible !== false
  }
  components.set(snapshot.id, snapshot)
  scheduleVisibleContextPublish()
  return () => {
    if (components.get(snapshot.id) === snapshot) {
      components.delete(snapshot.id)
      scheduleVisibleContextPublish()
    }
  }
}

/**
 * Registers a visual target without exposing DOM selectors in the serialized context.
 * Bounds are measured in CSS viewport pixels when the context is published.
 */
export function registerVisibleContextVisualTarget(input: VisualTargetRegistration): () => void {
  ensureVisibleContextRefreshListener()
  const key = `${input.componentId}\u0000${input.target.id}`
  const registration = { ...input }
  visualTargets.set(key, registration)
  installVisualTargetListeners()
  scheduleVisibleContextPublish()
  return () => {
    if (visualTargets.get(key) !== registration) return
    visualTargets.delete(key)
    uninstallVisualTargetListenersWhenIdle()
    scheduleVisibleContextPublish()
  }
}

/**
 * Resolves a pointer only against targets explicitly registered with the Host.
 * Domain renderers receive a bounded semantic target; they never receive or
 * search the application's DOM.
 */
export function inspectRegisteredVisibleContextTargetAt(
  point: DomainVisibleContextPoint
): Promise<DomainVisibleContextInspection | null> {
  if (
    !Number.isFinite(point.clientX) ||
    !Number.isFinite(point.clientY)
  ) return Promise.resolve(null)
  const candidates = registeredTargetCandidates()
    .filter(({ bounds }) => pointInBounds(point, bounds))
    .sort((left, right) => (
      (left.bounds.width * left.bounds.height) -
      (right.bounds.width * right.bounds.height)
    ))
  const candidate = candidates[0]
  if (!candidate) return Promise.resolve(null)
  if (candidate.registration.target.redact) {
    return Promise.resolve(Object.freeze({ selectable: false, reason: 'redacted' }))
  }
  return window.sciforge.visibleContext.registeredTargetRef({
    componentId: candidate.registration.componentId,
    targetId: candidate.registration.target.id
  }).then((resolved) => resolved.ok
    ? Object.freeze({
        selectable: true as const,
        targetRef: resolved.targetRef,
        componentId: candidate.registration.componentId,
        target: Object.freeze({ ...candidate.registration.target }),
        bounds: Object.freeze({ ...candidate.bounds })
      })
    : null)
}

/**
 * Returns text only when the browser selection is wholly contained by one
 * registered, non-sensitive visual target.
 */
export function inspectRegisteredVisibleContextTextSelection():
Promise<DomainVisibleContextSelectionInspection | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return Promise.resolve(null)
  }
  const text = selection.toString().trim()
  if (!text) return Promise.resolve(null)
  const range = selection.getRangeAt(0)
  const start = nodeElement(range.startContainer)
  const end = nodeElement(range.endContainer)
  if (!start || !end) return Promise.resolve(null)
  const candidates = registeredTargetCandidates()
    .filter(({ element }) => element?.contains(start) && element.contains(end))
    .sort((left, right) => (
      (left.bounds.width * left.bounds.height) -
      (right.bounds.width * right.bounds.height)
    ))
  const candidate = candidates[0]
  if (!candidate || candidate.registration.target.redact) return Promise.resolve(null)
  const rangeRect = range.getBoundingClientRect()
  const bounds = Number.isFinite(rangeRect.left) &&
    Number.isFinite(rangeRect.top) &&
    rangeRect.width > 0 &&
    rangeRect.height > 0
    ? {
        x: rangeRect.left,
        y: rangeRect.top,
        width: rangeRect.width,
        height: rangeRect.height
      }
    : candidate.bounds
  return window.sciforge.visibleContext.registeredTargetRef({
    componentId: candidate.registration.componentId,
    targetId: candidate.registration.target.id
  }).then((resolved) => resolved.ok
    ? Object.freeze({
        targetRef: resolved.targetRef,
        componentId: candidate.registration.componentId,
        target: Object.freeze({ ...candidate.registration.target }),
        bounds: Object.freeze(bounds),
        text: text.slice(0, 20_000)
      })
    : null)
}

const SENSITIVE_VISUAL_CONTEXT_SELECTOR = [
  'input[type="password"]',
  '[data-visual-context-sensitive]'
].join(',')

export function registerVisibleContextSensitiveElements(input: {
  componentId: string
  root: ParentNode & Node
}): () => void {
  const registrations = new Map<Element, () => void>()
  const sync = (): void => {
    const current = new Set(input.root.querySelectorAll(SENSITIVE_VISUAL_CONTEXT_SELECTOR))
    for (const [element, unregister] of registrations) {
      if (current.has(element)) continue
      unregister()
      registrations.delete(element)
    }
    for (const element of current) {
      if (registrations.has(element)) continue
      let id = sensitiveTargetIds.get(element)
      if (!id) {
        nextSensitiveTargetId += 1
        id = `sensitive.${nextSensitiveTargetId}`
        sensitiveTargetIds.set(element, id)
      }
      registrations.set(element, registerVisibleContextVisualTarget({
        componentId: input.componentId,
        target: {
          id,
          kind: 'region',
          contentType: 'application/x-sensitive-ui',
          redact: true
        },
        element: () => element
      }))
    }
  }
  sync()
  const observer = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(sync)
  observer?.observe(input.root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['type', 'data-visual-context-sensitive']
  })
  return () => {
    observer?.disconnect()
    for (const unregister of registrations.values()) unregister()
    registrations.clear()
  }
}

export function measureVisibleContextBounds(
  element: Element,
  relativeBounds?: VisibleContextBounds
): VisibleContextBounds | null {
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  if (!relativeBounds) {
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    }
  }
  if (relativeBounds.width <= 0 || relativeBounds.height <= 0) return null
  return {
    x: rect.left + relativeBounds.x * rect.width,
    y: rect.top + relativeBounds.y * rect.height,
    width: relativeBounds.width * rect.width,
    height: relativeBounds.height * rect.height
  }
}

function scheduleVisibleContextPublish(): void {
  if (typeof window === 'undefined') return
  if (publishTimer !== null) window.clearTimeout(publishTimer)
  publishTimer = window.setTimeout(() => {
    publishTimer = null
    publishVisibleContext()
  }, 80)
}

export function publishVisibleContextNow(): void {
  if (publishTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(publishTimer)
    publishTimer = null
  }
  publishVisibleContext()
}

let refreshListenerInstalled = false

export function ensureVisibleContextRefreshListener(): void {
  if (refreshListenerInstalled || typeof window === 'undefined') return
  const subscribe = window.sciforge?.visibleContext?.onRefreshRequested
  if (typeof subscribe !== 'function') return
  subscribe(() => publishVisibleContextNow())
  refreshListenerInstalled = true
}

function publishVisibleContext(): void {
  if (typeof window === 'undefined') return
  const publish = window.sciforge?.visibleContext?.publish
  if (typeof publish !== 'function') return
  const publishedAt = new Date().toISOString()
  revision += 1
  const snapshot: VisibleContextPublishInput = {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    revision,
    publishedAt,
    freshness: {
      stale: false,
      ageMs: 0,
      staleAfterMs: VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS
    },
    ...(shell.activeThreadId !== undefined ? { activeThreadId: shell.activeThreadId } : {}),
    ...(shell.workspaceRoot ? { workspaceRoot: shell.workspaceRoot } : {}),
    ...(shell.route ? { route: shell.route } : {}),
    components: [...components.values()]
      .filter((component) => component.visible)
      .map(withRegisteredVisualTargets)
      .sort((a, b) => {
        const priority = (b.priority ?? 0) - (a.priority ?? 0)
        return priority || a.region.localeCompare(b.region) || a.id.localeCompare(b.id)
      })
  }
  void publish(snapshot).catch(() => undefined)
}

function withRegisteredVisualTargets(
  component: VisibleContextComponentSnapshot
): VisibleContextComponentSnapshot {
  const registered = [...visualTargets.values()]
    .filter((entry) => entry.componentId === component.id)
    .map(resolveVisualTarget)
    .filter((target): target is VisualContextTarget => Boolean(target))
  if (registered.length === 0) return component
  const merged = new Map((component.visualTargets ?? []).map((target) => [target.id, target]))
  for (const target of registered) merged.set(target.id, target)
  return { ...component, visualTargets: [...merged.values()] }
}

function resolveVisualTarget(registration: VisualTargetRegistration): VisualContextTarget | null {
  const bounds = registration.element
    ? (() => {
        const element = registration.element?.()
        return element ? measureVisibleContextBounds(element, registration.relativeBounds) : null
      })()
    : registration.target.bounds
  if (registration.target.kind !== 'window' && !bounds) return null
  return {
    ...registration.target,
    ...(bounds ? { bounds } : {})
  }
}

function registeredTargetCandidates(): Array<{
  registration: VisualTargetRegistration
  element: Element | null
  bounds: VisibleContextBounds
}> {
  const candidates: Array<{
    registration: VisualTargetRegistration
    element: Element | null
    bounds: VisibleContextBounds
  }> = []
  for (const registration of visualTargets.values()) {
    const element = registration.element?.() ?? null
    const bounds = element
      ? measureVisibleContextBounds(element, registration.relativeBounds)
      : registration.target.bounds ?? (
          registration.target.kind === 'window' && typeof window !== 'undefined'
            ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
            : null
        )
    if (!bounds) continue
    candidates.push({ registration, element, bounds })
  }
  return candidates
}

function pointInBounds(
  point: DomainVisibleContextPoint,
  bounds: VisibleContextBounds
): boolean {
  return point.clientX >= bounds.x &&
    point.clientY >= bounds.y &&
    point.clientX <= bounds.x + bounds.width &&
    point.clientY <= bounds.y + bounds.height
}

function nodeElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

let visualTargetListenersInstalled = false

function handleVisualTargetLayoutChange(): void {
  scheduleVisibleContextPublish()
}

function installVisualTargetListeners(): void {
  if (visualTargetListenersInstalled || typeof window === 'undefined') return
  visualTargetListenersInstalled = true
  window.addEventListener('resize', handleVisualTargetLayoutChange)
  window.addEventListener('scroll', handleVisualTargetLayoutChange, true)
}

function uninstallVisualTargetListenersWhenIdle(): void {
  if (!visualTargetListenersInstalled || visualTargets.size > 0 || typeof window === 'undefined') return
  visualTargetListenersInstalled = false
  window.removeEventListener('resize', handleVisualTargetLayoutChange)
  window.removeEventListener('scroll', handleVisualTargetLayoutChange, true)
}
