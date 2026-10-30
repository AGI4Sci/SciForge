export type WorkspaceReferenceGroupKind = 'project' | 'worktree'

export type WorkspaceReferenceGroup = {
  id: string
  label: string
  workspaceRoot: string
  kind: WorkspaceReferenceGroupKind
}

export type BuildWorkspaceReferenceGroupsInput = {
  activeThreadWorkspace?: string | null
  workspaceRoot?: string | null
  codeWorkspaceRoots?: readonly string[]
}

export function buildWorkspaceReferenceGroups(input: BuildWorkspaceReferenceGroupsInput): WorkspaceReferenceGroup[] {
  const groups: WorkspaceReferenceGroup[] = []
  const seen = new Set<string>()
  const add = (workspaceRoot: string | null | undefined, kind: WorkspaceReferenceGroupKind): void => {
    const root = normalizeWorkspaceRootLike(workspaceRoot)
    if (!root) return
    const key = root.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    groups.push({
      id: `${kind}:${root}`,
      label: workspaceName(root),
      workspaceRoot: root,
      kind
    })
  }

  add(input.activeThreadWorkspace, 'project')
  add(input.workspaceRoot, 'project')
  for (const root of input.codeWorkspaceRoots ?? []) {
    add(root, normalizeWorkspaceRootLike(root) === normalizeWorkspaceRootLike(input.workspaceRoot) ? 'project' : 'worktree')
  }

  return groups
}

function normalizeWorkspaceRootLike(value: string | null | undefined): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function workspaceName(workspaceRoot: string): string {
  return workspaceRoot.split('/').filter(Boolean).at(-1) ?? workspaceRoot
}
