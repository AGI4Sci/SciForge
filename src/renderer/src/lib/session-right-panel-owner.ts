const DRAFT_SESSION_PREFIX = 'right-panel-draft:'

export function draftSessionRightPanelId(
  workspaceRoot: string | null | undefined
): string | null {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return normalizedWorkspaceRoot
    ? `${DRAFT_SESSION_PREFIX}${encodeURIComponent(normalizedWorkspaceRoot)}`
    : null
}
