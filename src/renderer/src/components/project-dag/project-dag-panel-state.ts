export type ProjectDagRequestContext = {
  workspaceRoot?: string
  projectRoot?: string
}

export function projectDagWorkspaceName(workspaceRoot: string): string {
  const parts = (workspaceRoot || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export function projectDagRequestContext(workspaceRoot: string): ProjectDagRequestContext {
  const root = workspaceRoot.trim()
  return root ? { workspaceRoot: root, projectRoot: root } : {}
}
