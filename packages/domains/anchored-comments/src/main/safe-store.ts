import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'

const NOFOLLOW = constants.O_NOFOLLOW ?? 0

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

async function safeRoot(rootDir: string): Promise<string> {
  const value = rootDir.trim()
  if (!value) throw new Error('Anchored Comments data root is required.')
  const root = resolve(value)
  await mkdir(root, { recursive: true })
  const canonical = await realpath(root)
  const info = await lstat(canonical)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Anchored Comments data root must be a regular directory.')
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
    throw new Error('Invalid Anchored Comments data path.')
  }
  return segment
}

async function safeParent(
  rootDir: string,
  segments: readonly string[],
  create: boolean
): Promise<{ root: string; parent: string; file: string }> {
  if (segments.length === 0) throw new Error('Anchored Comments data path is required.')
  const root = await safeRoot(rootDir)
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
      throw new Error('Anchored Comments data path cannot cross a symlink.')
    }
    parent = await realpath(next)
    if (!isInside(root, parent)) {
      throw new Error('Anchored Comments data path escaped its data root.')
    }
  }
  return { root, parent, file: safeSegment(segments.at(-1)!) }
}

export async function safeStorePath(
  rootDir: string,
  segments: readonly string[],
  options: { createParent?: boolean } = {}
): Promise<string> {
  const resolved = await safeParent(rootDir, segments, options.createParent !== false)
  const target = join(resolved.parent, resolved.file)
  if (!isInside(resolved.root, target)) {
    throw new Error('Anchored Comments data path escaped its data root.')
  }
  const info = await existing(target)
  if (info && (!info.isFile() || info.isSymbolicLink())) {
    throw new Error('Anchored Comments data files must be regular files.')
  }
  return target
}

export async function readSafeStoreBytes(
  rootDir: string,
  segments: readonly string[]
): Promise<Uint8Array> {
  const target = await safeStorePath(rootDir, segments, { createParent: false })
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW)
  try {
    return Uint8Array.from(await handle.readFile())
  } finally {
    await handle.close()
  }
}

export async function readSafeStoreText(
  rootDir: string,
  segments: readonly string[]
): Promise<string> {
  return Buffer.from(await readSafeStoreBytes(rootDir, segments)).toString('utf8')
}

export async function atomicWriteSafeStore(
  rootDir: string,
  segments: readonly string[],
  content: string | Uint8Array
): Promise<void> {
  const target = await safeStorePath(rootDir, segments)
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
    await handle.close()
    handle = null
    await safeStorePath(rootDir, segments)
    await rename(temp, target)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
