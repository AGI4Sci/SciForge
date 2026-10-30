import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'

export async function findNearestGitRoot(workspaceRoot: string): Promise<string | null> {
  const start = workspaceRoot.trim()
  if (!start) return null

  let current = isAbsolute(start) ? start : resolve(start)
  const { root } = parse(current)

  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const info = await stat(join(current, '.git'))
      if (info.isDirectory() || info.isFile()) return current
    } catch {
      // Keep walking until an ancestor contains .git or the filesystem root is reached.
    }

    if (current === root) return null
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }

  return null
}
