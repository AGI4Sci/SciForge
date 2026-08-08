import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm
} from 'node:fs/promises'
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'

const NOFOLLOW = constants.O_NOFOLLOW ?? 0

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    )
  }
  return value
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

async function existing(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function canonicalDirectory(path: string, label: string): Promise<string> {
  const value = path.trim()
  if (!value) throw new Error(`${label} is required.`)
  const resolved = resolve(value)
  await mkdir(resolved, { recursive: true })
  const canonical = await realpath(resolved)
  const info = await lstat(canonical)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory.`)
  }
  return canonical
}

function safeSegment(segment: string): string {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new Error('Invalid Artifact Versions data path.')
  }
  return segment
}

async function safeDataParent(
  rootDir: string,
  segments: readonly string[],
  create: boolean
): Promise<{ root: string; parent: string; file: string }> {
  if (segments.length === 0) throw new Error('Artifact Versions data path is required.')
  const root = await canonicalDirectory(rootDir, 'Artifact Versions data root')
  let parent = root
  for (const raw of segments.slice(0, -1)) {
    const next = join(parent, safeSegment(raw))
    let info = await existing(next)
    if (!info && create) {
      await mkdir(next)
      info = await lstat(next)
    }
    if (!info) {
      parent = next
      continue
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Artifact Versions data path cannot cross a symlink.')
    }
    parent = await realpath(next)
    if (!isInside(root, parent)) {
      throw new Error('Artifact Versions data path escaped its data root.')
    }
  }
  return { root, parent, file: safeSegment(segments.at(-1)!) }
}

export async function safeDataPath(
  rootDir: string,
  segments: readonly string[],
  options: Readonly<{ createParent?: boolean }> = {}
): Promise<string> {
  const resolved = await safeDataParent(
    rootDir,
    segments,
    options.createParent !== false
  )
  const target = join(resolved.parent, resolved.file)
  if (!isInside(resolved.root, target)) {
    throw new Error('Artifact Versions data path escaped its data root.')
  }
  const info = await existing(target)
  if (info && (!info.isFile() || info.isSymbolicLink())) {
    throw new Error('Artifact Versions data files must be regular files.')
  }
  return target
}

export async function readSafeDataBytes(
  rootDir: string,
  segments: readonly string[]
): Promise<Uint8Array> {
  const target = await safeDataPath(rootDir, segments, { createParent: false })
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW)
  try {
    return Uint8Array.from(await handle.readFile())
  } finally {
    await handle.close()
  }
}

export async function readSafeDataText(
  rootDir: string,
  segments: readonly string[]
): Promise<string> {
  return Buffer.from(await readSafeDataBytes(rootDir, segments)).toString('utf8')
}

export async function atomicWriteSafeData(
  rootDir: string,
  segments: readonly string[],
  content: string | Uint8Array,
  options: Readonly<{ replace?: boolean }> = {}
): Promise<void> {
  const target = await safeDataPath(rootDir, segments)
  const targetInfo = await existing(target)
  if (targetInfo && options.replace === false) {
    throw Object.assign(new Error('Destination already exists.'), { code: 'EEXIST' })
  }
  const temp = join(
    resolve(target, '..'),
    `.${segments.at(-1)}.${process.pid}.${randomUUID()}.tmp`
  )
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o600
    )
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = null
    await safeDataPath(rootDir, segments)
    await rename(temp, target)
    const parent = await open(resolve(target, '..'), constants.O_RDONLY)
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readWorkspaceBytes(
  workspaceRoot: string,
  requestedPath: string
): Promise<Readonly<{ bytes: Uint8Array; relativePath: string }>> {
  const root = await canonicalDirectory(workspaceRoot, 'Workspace root')
  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath)
  const canonical = await realpath(candidate)
  if (!isInside(root, canonical)) {
    throw new WorkspacePathError('The requested path is outside the caller workspace.')
  }
  const info = await lstat(canonical)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkspacePathError('The requested path must be a regular workspace file.')
  }
  const handle = await open(canonical, constants.O_RDONLY | NOFOLLOW)
  try {
    return {
      bytes: Uint8Array.from(await handle.readFile()),
      relativePath: relative(root, canonical).split(sep).join('/')
    }
  } finally {
    await handle.close()
  }
}

export async function atomicWriteWorkspaceBytes(
  workspaceRoot: string,
  requestedPath: string,
  bytes: Uint8Array,
  overwrite: boolean
): Promise<string> {
  const root = await canonicalDirectory(workspaceRoot, 'Workspace root')
  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath)
  if (!isInside(root, candidate) || candidate === root) {
    throw new WorkspacePathError('The destination path is outside the caller workspace.')
  }
  const child = relative(root, candidate)
  const segments = child.split(sep).filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new WorkspacePathError('The destination path is outside the caller workspace.')
  }
  let parent = root
  for (const segment of segments.slice(0, -1)) {
    const next = join(parent, segment)
    let info = await existing(next)
    if (!info) {
      await mkdir(next)
      info = await lstat(next)
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WorkspacePathError('The destination path cannot cross a symlink.')
    }
    parent = await realpath(next)
    if (!isInside(root, parent)) {
      throw new WorkspacePathError('The destination path escaped the caller workspace.')
    }
  }
  const target = join(parent, segments.at(-1)!)
  const targetInfo = await existing(target)
  if (targetInfo) {
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
      throw new WorkspacePathError('The destination must be a regular file.')
    }
    if (!overwrite) throw new DestinationExistsError(target)
  }
  const temp = join(parent, `.${segments.at(-1)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o600
    )
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temp, target)
    const directory = await open(parent, constants.O_RDONLY)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
    return child.split(sep).join('/')
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export class WorkspacePathError extends Error {}
export class DestinationExistsError extends Error {}
