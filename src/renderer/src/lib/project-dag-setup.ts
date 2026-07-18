export const PROJECT_DAG_SETUP_EVENT = 'sciforge:project-dag-setup'

export type ProjectDagSetupDetail = {
  sessionId: string
  workspaceRoot: string
}

export function requestProjectDagSetup(detail: ProjectDagSetupDetail): void {
  const sessionId = detail.sessionId.trim()
  const workspaceRoot = detail.workspaceRoot.trim()
  if (!sessionId || !workspaceRoot) return
  window.dispatchEvent(new CustomEvent<ProjectDagSetupDetail>(PROJECT_DAG_SETUP_EVENT, {
    detail: { sessionId, workspaceRoot }
  }))
}
