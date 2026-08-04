import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import { useChatStore } from '../store/chat-store'

/**
 * Returns the active remote placement only when it owns the workspace root
 * being operated on. A stale selection must never redirect another workspace.
 */
export function activeWorkspaceLocator(
  workspaceRoot?: string
): WorkspaceLocator | undefined {
  const locator = useChatStore.getState().workspaceLocator
  if (!locator) return undefined
  return !workspaceRoot || locator.path === workspaceRoot ? locator : undefined
}

export function withActiveWorkspaceLocator<T extends { workspaceRoot: string }>(
  input: T
): T & { workspaceLocator?: WorkspaceLocator } {
  return withActiveWorkspaceLocatorForRoot(input.workspaceRoot, input)
}

export function withActiveWorkspaceLocatorForRoot<T>(
  workspaceRoot: string,
  input: T
): T & { workspaceLocator?: WorkspaceLocator } {
  const workspaceLocator = activeWorkspaceLocator(workspaceRoot)
  return {
    ...input,
    ...(workspaceLocator ? { workspaceLocator } : {})
  }
}

export function workspaceLocatorsEqual(
  left: WorkspaceLocator | null | undefined,
  right: WorkspaceLocator | null | undefined
): boolean {
  if (!left || !right) return !left && !right
  return left.hostSessionId === right.hostSessionId && left.path === right.path
}

/** Capture the remote owner of a workspace before starting a stateful renderer workflow. */
export function pinWorkspaceLocator(workspaceRoot: string): WorkspaceLocator | null {
  return activeWorkspaceLocator(workspaceRoot) ?? null
}

export function assertPinnedWorkspaceLocator(
  workspaceRoot: string,
  pinnedWorkspaceLocator: WorkspaceLocator | null
): void {
  const activeLocator = activeWorkspaceLocator(workspaceRoot) ?? null
  if (workspaceLocatorsEqual(activeLocator, pinnedWorkspaceLocator)) return
  throw new Error(
    'The workspace session changed after this editor was opened. Reopen the workspace before continuing.'
  )
}

/**
 * Route a stateful workspace operation through the session captured when the
 * workflow opened. Never re-resolve the owner immediately before an external
 * write: the same remote path may exist in more than one host session.
 */
export function withPinnedWorkspaceLocator<T extends { workspaceRoot: string }>(
  input: T,
  pinnedWorkspaceLocator: WorkspaceLocator | null
): T & { workspaceLocator?: WorkspaceLocator } {
  assertPinnedWorkspaceLocator(input.workspaceRoot, pinnedWorkspaceLocator)
  return {
    ...input,
    ...(pinnedWorkspaceLocator ? { workspaceLocator: pinnedWorkspaceLocator } : {})
  }
}
