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

