type ProjectCoordinatorWorkspaceInvalidationListener = () => void

const listeners = new Set<ProjectCoordinatorWorkspaceInvalidationListener>()

export function publishProjectCoordinatorWorkspaceInvalidation(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeProjectCoordinatorWorkspaceInvalidation(
  listener: ProjectCoordinatorWorkspaceInvalidationListener
): () => void {
  listeners.add(listener)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    listeners.delete(listener)
  }
}
