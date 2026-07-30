import { posix } from 'node:path'
import {
  workspaceLocatorSchema,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'

export function requireWorkspaceLocatorRoot(
  locator: WorkspaceLocator,
  claimedWorkspaceRoot?: string
): WorkspaceLocator {
  const parsed = workspaceLocatorSchema.parse(locator)
  const root = parsed.path.trim()
  if (!root || !posix.isAbsolute(root) || root.includes('\0') || root.includes('\\')) {
    throw new Error('Workspace Host locator path must be an absolute POSIX path.')
  }
  if (
    claimedWorkspaceRoot !== undefined &&
    claimedWorkspaceRoot.trim() !== parsed.path
  ) {
    throw new Error('Workspace root does not match the selected Workspace Host locator.')
  }
  return parsed
}

/**
 * Converts a renderer-facing path to the relative POSIX path accepted by the
 * Workspace Host wire contract. Absolute paths are accepted only when they are
 * contained by the locator root.
 */
export function workspaceHostWirePath(
  locator: WorkspaceLocator,
  inputPath?: string
): string {
  const parsed = requireWorkspaceLocatorRoot(locator)
  const root = posix.normalize(parsed.path)
  const candidate = inputPath?.trim()
  if (!candidate || candidate === '.') return '.'
  if (candidate.includes('\0') || candidate.includes('\\')) {
    throw new Error('Workspace Host paths must use POSIX separators.')
  }

  const relativePath = posix.isAbsolute(candidate)
    ? posix.relative(root, posix.normalize(candidate))
    : posix.normalize(candidate)
  if (!relativePath || relativePath === '.') return '.'
  if (
    posix.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    throw new Error('Workspace path is outside the selected Workspace Host root.')
  }
  return relativePath.replace(/^\.\/+/u, '') || '.'
}

export function workspaceHostDisplayPath(
  locator: WorkspaceLocator,
  wirePath: string
): string {
  const parsed = requireWorkspaceLocatorRoot(locator)
  const normalizedWirePath = workspaceHostWirePath(parsed, wirePath)
  return normalizedWirePath === '.'
    ? posix.normalize(parsed.path)
    : posix.join(posix.normalize(parsed.path), normalizedWirePath)
}
