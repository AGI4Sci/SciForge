/**
 * The Host decision for "may this caller use this workspace?".
 *
 * `caller.workspaceId` reaches the Host from the renderer, so it is a
 * declaration, not a fact. A directory becomes authorized only when it is one
 * the Host itself knows about: the configured workspace, one of the configured
 * write workspaces, or the root of a live workspace-host Session (a remote
 * workspace the user attached). Nothing else — in particular not "the string is
 * non-empty" — turns a declared path into an authorized one.
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

export type WorkspaceAuthorityRequest = Readonly<{
  caller: Record<string, unknown>
  workspaceId: string
}>

export type WorkspaceAuthority = (request: WorkspaceAuthorityRequest) => Promise<boolean>

const CASE_INSENSITIVE = process.platform === 'win32'

/**
 * Absolute, symlink-resolved form of a path. A path that does not exist yet is
 * resolved through its deepest existing ancestor, so a symlinked parent cannot
 * smuggle a different directory past the comparison. Preserve native spelling
 * on macOS: a volume can be case-sensitive. realpath resolves existing aliases;
 * missing suffixes must remain distinct rather than guessing volume behavior.
 */
export function canonicalWorkspacePath(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || !isAbsolute(trimmed)) return undefined
  const canonical = realpathOrResolvedAncestor(resolve(trimmed))
  return CASE_INSENSITIVE ? canonical.toLowerCase() : canonical
}

function realpathOrResolvedAncestor(path: string): string {
  const missing: string[] = []
  let current = path
  for (;;) {
    try {
      const real = realpathSync.native(current)
      return missing.length === 0 ? real : resolve(real, ...missing.slice().reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return path
      missing.push(basename(current))
      current = parent
    }
  }
}

/** `true` when `candidate` is `root` or lives inside it. */
export function isWithinWorkspaceRoot(candidate: string, root: string): boolean {
  const inside = relative(root, candidate)
  return inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))
}

export function createWorkspaceAuthority(
  input: Readonly<{ readTrustedRoots: () => Promise<readonly string[]> | readonly string[] }>
): WorkspaceAuthority {
  return async (request) => {
    const candidate = canonicalWorkspacePath(request.workspaceId)
    if (candidate === undefined) return false
    const roots = await input.readTrustedRoots()
    return roots.some((root) => {
      const canonicalRoot = canonicalWorkspacePath(root)
      return canonicalRoot !== undefined && isWithinWorkspaceRoot(candidate, canonicalRoot)
    })
  }
}