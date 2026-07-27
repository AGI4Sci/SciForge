import { constants, type Dirent } from 'node:fs'
import { access, lstat, mkdir, open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
export type WorkspaceDirectoryTarget = Readonly<{
  workspaceRoot: string
  path?: string
}>

export type ResolveTargetOptions = {
  allowBasenameFallback?: boolean
}

export type ResolveWorkspaceWriteTargetOptions = {
  createParentDirectories?: boolean
  targetKind?: 'file' | 'directory'
}

export type ResolvedWorkspaceWriteTarget = {
  path: string
  parentPath: string
  workspaceRoot: string
}

export type SafeWorkspaceWriteOptions = {
  encoding?: BufferEncoding
  exclusive?: boolean
}

const SKIP_SEARCH_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage'
])

export function expandHomePath(raw: string): string {
  const value = raw.trim()
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

export function normalizeSkillFolderName(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw new Error('Skill name is required.')
  }
  if (value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error('Skill name cannot contain path separators.')
  }
  return value
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function lstatIfExists(targetPath: string) {
  try {
    return await lstat(targetPath)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

function sanitizeUserPath(raw: string): string {
  const value = raw.trim().replace(/\0/g, '')
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1).trim()
  }
  return value
}

export function normalizeUserPath(raw: string): string {
  const sanitized = sanitizeUserPath(raw)
  return process.platform === 'win32' ? sanitized : sanitized.replace(/\\/g, '/')
}

function hasPathSeparator(value: string): boolean {
  return /[\\/]/.test(value)
}

export function normalizePathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

export function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function validateEntryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error('Name is required.')
  }
  if (hasPathSeparator(trimmed) || basename(trimmed) !== trimmed) {
    throw new Error('Name must not contain path separators.')
  }
  return trimmed
}

function namesEqual(a: string, b: string): boolean {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

async function findUniqueFileByBasename(root: string, fileName: string): Promise<string | null> {
  const matches: string[] = []
  const stack = [root]
  let scanned = 0

  while (stack.length > 0 && scanned < 12_000) {
    const current = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      scanned += 1
      if (entry.isDirectory()) {
        if (!SKIP_SEARCH_DIRS.has(entry.name)) {
          stack.push(join(current, entry.name))
        }
        continue
      }
      if (entry.isFile() && namesEqual(entry.name, fileName)) {
        matches.push(join(current, entry.name))
        if (matches.length > 1) return null
      }
    }
  }

  return matches[0] ?? null
}

export async function canonicalPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath)
  } catch {
    return resolve(targetPath)
  }
}

function isWithinWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function requireWorkspaceRoot(workspaceRoot?: string): string {
  const rawWorkspace = workspaceRoot?.trim()
  if (!rawWorkspace) throw new Error('Workspace root is required.')
  return rawWorkspace
}

async function enforceWorkspaceBoundary(targetPath: string, workspaceRoot: string): Promise<string> {
  const rawWorkspace = requireWorkspaceRoot(workspaceRoot)

  const workspacePath = await canonicalPath(resolve(expandHomePath(rawWorkspace)))
  const canonicalTarget = await canonicalPath(targetPath)
  if (!isWithinWorkspace(workspacePath, canonicalTarget)) {
    throw new Error('Path must stay within the selected workspace.')
  }
  return canonicalTarget
}

export async function resolveTargetPathWithinWorkspace(rawPath: string, workspaceRoot?: string): Promise<string> {
  const value = normalizeUserPath(rawPath)
  if (!value) throw new Error('File path is required.')

  const expanded = expandHomePath(value)
  const rawWorkspace = requireWorkspaceRoot(workspaceRoot)

  const workspacePath = await canonicalPath(resolve(expandHomePath(rawWorkspace)))
  if (!isAbsolute(expanded)) {
    const direct = resolve(workspacePath, expanded)
    if (!isWithinWorkspace(workspacePath, direct)) {
      throw new Error('Path must stay within the selected workspace.')
    }
    return direct
  }

  const direct = resolve(expanded)
  if (isWithinWorkspace(workspacePath, direct)) {
    return direct
  }
  if (await pathExists(direct)) {
    const canonicalTarget = await canonicalPath(direct)
    if (isWithinWorkspace(workspacePath, canonicalTarget)) {
      return canonicalTarget
    }
  }
  throw new Error('Path must stay within the selected workspace.')
}

async function resolveLexicalWorkspaceTarget(
  rawPath: string,
  workspaceRoot?: string
): Promise<{ workspacePath: string; targetPath: string }> {
  const value = normalizeUserPath(rawPath)
  if (!value) throw new Error('File path is required.')

  const expanded = expandHomePath(value)
  const rawWorkspace = requireWorkspaceRoot(workspaceRoot)
  const workspaceInputPath = resolve(expandHomePath(rawWorkspace))
  const workspacePath = await canonicalPath(workspaceInputPath)
  const directPath = isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(workspacePath, expanded)
  const targetPath = isAbsolute(expanded) && !isWithinWorkspace(workspacePath, directPath) &&
    isWithinWorkspace(workspaceInputPath, directPath)
    ? resolve(workspacePath, relative(workspaceInputPath, directPath))
    : directPath

  if (!isWithinWorkspace(workspacePath, targetPath)) {
    throw new Error('Path must stay within the selected workspace.')
  }

  return { workspacePath, targetPath }
}

function relativeWorkspaceSegments(workspacePath: string, targetPath: string): string[] {
  const rel = relative(workspacePath, targetPath)
  return rel ? rel.split(/[\\/]+/).filter(Boolean) : []
}

async function canonicalDirectoryInsideWorkspace(
  targetPath: string,
  workspacePath: string
): Promise<string> {
  const canonical = await realpath(targetPath)
  if (!isWithinWorkspace(workspacePath, canonical)) {
    throw new Error('Path must stay within the selected workspace.')
  }
  const info = await stat(canonical)
  if (!info.isDirectory()) {
    throw new Error('Target parent is not a directory.')
  }
  return canonical
}

async function resolveWriteParentSegment(
  currentPath: string,
  segment: string,
  workspacePath: string,
  createDirectory: boolean
): Promise<{ path: string; missing: boolean }> {
  const candidate = join(currentPath, segment)
  let info = await lstatIfExists(candidate)

  if (!info) {
    if (!createDirectory) {
      return { path: candidate, missing: true }
    }
    await mkdir(candidate)
    info = await lstatIfExists(candidate)
  }

  if (!info) {
    throw new Error('Target parent directory could not be created.')
  }

  if (info.isSymbolicLink()) {
    return { path: await canonicalDirectoryInsideWorkspace(candidate, workspacePath), missing: false }
  }
  if (!info.isDirectory()) {
    throw new Error('Target parent is not a directory.')
  }
  return { path: await canonicalDirectoryInsideWorkspace(candidate, workspacePath), missing: false }
}

async function verifyExistingWriteTarget(
  targetPath: string,
  workspacePath: string,
  targetKind: 'file' | 'directory'
): Promise<void> {
  const info = await lstatIfExists(targetPath)
  if (!info) return

  if (info.isSymbolicLink()) {
    let canonical = ''
    try {
      canonical = await realpath(targetPath)
    } catch {
      throw new Error('Workspace write target must not be a symlink.')
    }
    if (!isWithinWorkspace(workspacePath, canonical)) {
      throw new Error('Path must stay within the selected workspace.')
    }
    throw new Error('Workspace write target must not be a symlink.')
  }

  if (targetKind === 'directory' && !info.isDirectory()) {
    throw new Error('Target path is not a directory.')
  }

  const canonical = await realpath(targetPath)
  if (!isWithinWorkspace(workspacePath, canonical)) {
    throw new Error('Path must stay within the selected workspace.')
  }
}

export async function resolveSafeWorkspaceWriteTarget(
  rawPath: string,
  workspaceRoot?: string,
  options?: ResolveWorkspaceWriteTargetOptions
): Promise<ResolvedWorkspaceWriteTarget> {
  const targetKind = options?.targetKind ?? 'file'
  const createParentDirectories = options?.createParentDirectories ?? true
  const { workspacePath, targetPath } = await resolveLexicalWorkspaceTarget(rawPath, workspaceRoot)
  const segments = relativeWorkspaceSegments(workspacePath, targetPath)
  if (!segments.length && targetKind === 'file') {
    throw new Error('File path must point inside the selected workspace.')
  }

  const targetName = segments.at(-1)
  let parentPath = workspacePath
  const parentSegments = segments.slice(0, -1)
  for (let index = 0; index < parentSegments.length; index += 1) {
    const segment = parentSegments[index]
    const nextParent = await resolveWriteParentSegment(parentPath, segment, workspacePath, createParentDirectories)
    parentPath = nextParent.path
    if (nextParent.missing) {
      for (const missingSegment of parentSegments.slice(index + 1)) {
        parentPath = join(parentPath, missingSegment)
      }
      break
    }
  }

  const resolvedTarget = targetName ? join(parentPath, targetName) : workspacePath
  await verifyExistingWriteTarget(resolvedTarget, workspacePath, targetKind)
  return {
    path: resolvedTarget,
    parentPath,
    workspaceRoot: workspacePath
  }
}

export async function ensureSafeWorkspaceDirectory(rawPath: string, workspaceRoot?: string): Promise<string> {
  const target = await resolveSafeWorkspaceWriteTarget(rawPath, workspaceRoot, {
    createParentDirectories: true,
    targetKind: 'directory'
  })
  const info = await lstatIfExists(target.path)
  if (!info) {
    await mkdir(target.path)
  }
  await verifyExistingWriteTarget(target.path, target.workspaceRoot, 'directory')
  return realpath(target.path)
}

export async function writeSafeWorkspaceFile(
  target: ResolvedWorkspaceWriteTarget,
  content: string | Uint8Array,
  options?: SafeWorkspaceWriteOptions
): Promise<void> {
  await verifyExistingWriteTarget(target.parentPath, target.workspaceRoot, 'directory')
  await verifyExistingWriteTarget(target.path, target.workspaceRoot, 'file')

  const noFollow = constants.O_NOFOLLOW ?? 0
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    (options?.exclusive ? constants.O_EXCL : constants.O_TRUNC) |
    noFollow
  const handle = await open(target.path, flags, 0o666)
  try {
    if (typeof content === 'string') {
      await handle.writeFile(content, options?.encoding ?? 'utf8')
    } else {
      await handle.writeFile(content)
    }
  } finally {
    await handle.close()
  }
  await verifyExistingWriteTarget(target.path, target.workspaceRoot, 'file')
}

export async function resolveOpenTargetPath(
  rawPath: string,
  workspaceRoot?: string,
  options?: ResolveTargetOptions
): Promise<string> {
  const value = normalizeUserPath(rawPath)
  if (!value) throw new Error('File path is required.')

  const expanded = expandHomePath(value)
  const rawWorkspace = requireWorkspaceRoot(workspaceRoot)
  const workspace = expandHomePath(rawWorkspace)
  const allowBasenameFallback = options?.allowBasenameFallback ?? true
  const direct = isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(workspace, expanded)

  if (await pathExists(direct)) {
    return enforceWorkspaceBoundary(direct, rawWorkspace)
  }

  if (allowBasenameFallback && workspace && !hasPathSeparator(expanded)) {
    const match = await findUniqueFileByBasename(resolve(workspace), expanded)
    if (match) {
      return enforceWorkspaceBoundary(match, rawWorkspace)
    }
  }

  throw new Error(`File not found: ${rawPath}`)
}

export async function resolveWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<string> {
  const workspaceRoot = requireWorkspaceRoot(payload.workspaceRoot)

  const targetPath = payload.path?.trim()
    ? await resolveOpenTargetPath(payload.path, workspaceRoot, { allowBasenameFallback: false })
    : await canonicalPath(resolve(expandHomePath(workspaceRoot)))
  const info = await stat(targetPath)
  if (!info.isDirectory()) {
    throw new Error('Target path is not a directory.')
  }
  return targetPath
}

export function compareWorkspaceEntries(a: { type: 'file' | 'directory'; name: string }, b: { type: 'file' | 'directory'; name: string }): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}
