/**
 * The Project Coordinator right panel is a Project workbench, not a Session
 * binding.  Keep the currently visible panel target in a small renderer-only
 * registry so composer context can name the Project selected by the user even
 * when the owning conversation has no durable Project binding (or is bound to
 * a different Project).
 *
 * This registry carries selection only.  It is never an authority grant and
 * every capability call still supplies the explicit Project ID to the
 * canonical backend handler.
 */

export type ProjectCoordinatorPanelContext = Readonly<{
  surfaceId: string
  projectId: string
  active: boolean
  focused: boolean
  updatedAt: number
}>

const contexts = new Map<string, ProjectCoordinatorPanelContext>()

/**
 * The workbench keeps the Project picker mounted separately from the
 * navigation tree.  Remember the last explicit choice per Session so closing
 * the right panel does not discard it, and so a navigation click can update an
 * already-open panel without relying on display names or a stale activation
 * payload.
 */
export type ProjectCoordinatorSessionSelection = Readonly<{
  sessionId: string
  projectId: string | null
  source: 'cloud' | 'local' | 'none'
  updatedAt: number
}>

const sessionSelections = new Map<string, ProjectCoordinatorSessionSelection>()
const sessionSelectionListeners = new Set<
  (selection: ProjectCoordinatorSessionSelection) => void
>()

export function setProjectCoordinatorSessionSelection(input: Readonly<{
  sessionId: string
  projectId?: string | null
  source: 'cloud' | 'local' | 'none'
  updatedAt?: number
}>): void {
  const sessionId = input.sessionId.trim()
  const projectId = input.projectId?.trim() ?? ''
  if (!sessionId) return
  const source = projectId && input.source === 'cloud'
    ? 'cloud'
    : input.source === 'local'
      ? 'local'
      : 'none'
  const selection = Object.freeze({
    sessionId,
    projectId: source === 'cloud' ? projectId : null,
    source,
    updatedAt: input.updatedAt ?? Date.now()
  })
  sessionSelections.set(sessionId, selection)
  for (const listener of sessionSelectionListeners) listener(selection)
}

export function currentProjectCoordinatorSessionSelection(
  sessionId: string
): ProjectCoordinatorSessionSelection | null {
  const normalized = sessionId.trim()
  return normalized ? sessionSelections.get(normalized) ?? null : null
}

export function subscribeProjectCoordinatorSessionSelection(
  listener: (selection: ProjectCoordinatorSessionSelection) => void
): () => void {
  sessionSelectionListeners.add(listener)
  return () => sessionSelectionListeners.delete(listener)
}

export function setProjectCoordinatorPanelContext(
  input: Omit<ProjectCoordinatorPanelContext, 'updatedAt'> &
    Partial<Pick<ProjectCoordinatorPanelContext, 'updatedAt'>>
): void {
  const surfaceId = input.surfaceId.trim()
  const projectId = input.projectId.trim()
  if (!surfaceId || !projectId) return
  contexts.set(surfaceId, Object.freeze({
    ...input,
    surfaceId,
    projectId,
    updatedAt: input.updatedAt ?? Date.now()
  }))
}

export function clearProjectCoordinatorPanelContext(surfaceId: string): void {
  const normalized = surfaceId.trim()
  if (normalized) contexts.delete(normalized)
}

/**
 * Returns the active target with focused panes preferred.  If more than one
 * pane is visible, the most recently updated target wins deterministically.
 */
export function currentProjectCoordinatorPanelContext(): ProjectCoordinatorPanelContext | null {
  let selected: ProjectCoordinatorPanelContext | null = null
  for (const context of contexts.values()) {
    if (!context.active) continue
    if (
      selected === null ||
      Number(context.focused) > Number(selected.focused) ||
      (context.focused === selected.focused && context.updatedAt > selected.updatedAt)
    ) {
      selected = context
    }
  }
  return selected
}

export function clearProjectCoordinatorPanelContexts(): void {
  contexts.clear()
}

export function clearProjectCoordinatorSessionSelections(): void {
  sessionSelections.clear()
}
