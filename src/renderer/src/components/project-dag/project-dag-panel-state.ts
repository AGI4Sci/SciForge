export const PROJECT_DAG_SETUP_EVENT = 'sciforge:project-dag-setup'

export type ProjectDagSavedGoal = {
  title: string
  description: string
}

export function projectDagGoalStorageKey(workspaceRoot: string): string {
  return `sciforge.projectDag.goal:${workspaceRoot || 'default'}`
}

export function projectDagWorkspaceName(workspaceRoot: string): string {
  const parts = (workspaceRoot || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export function loadProjectDagSavedGoal(workspaceRoot: string): ProjectDagSavedGoal | null {
  try {
    const raw = localStorage.getItem(projectDagGoalStorageKey(workspaceRoot))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectDagSavedGoal
    return typeof parsed.title === 'string' && typeof parsed.description === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

export function saveProjectDagGoal(workspaceRoot: string, goal: ProjectDagSavedGoal): void {
  localStorage.setItem(projectDagGoalStorageKey(workspaceRoot), JSON.stringify(goal))
}
