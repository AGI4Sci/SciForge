import { mkdir } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, relative, sep } from 'node:path'

export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  const root = resolve(workspaceRoot)
  const target = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  assertInside(root, target)
  return target
}

export function relativeToWorkspace(workspaceRoot: string, targetPath: string): string {
  return normalize(relative(resolve(workspaceRoot), resolve(targetPath))).replace(/\\/g, '/')
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && rel !== sep)) return
  throw new Error(`Path must stay inside workspace root: ${target}`)
}
