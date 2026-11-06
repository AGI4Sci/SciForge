import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const NOFOLLOW = constants.O_NOFOLLOW ?? 0
export const MAX_SAFE_STORE_READ_BYTES = 32 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

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

async function safeRoot(rootDir: string, create: boolean): Promise<string> {
  const value = rootDir.trim()
  if (!value || !isAbsolute(value) || value.includes('\0')) {
    throw new Error('Anchored Comments data root must be an absolute path.')
  }
  const root = resolve(value)
  // Inspect the declared path before resolving or creating anything. Resolving
  // first would silently authorize the destination of a symlink.
  const ancestors: string[] = []
  for (let path = root; ; path = dirname(path)) {
    ancestors.push(path)
    if (dirname(path) === path) break
  }
  for (const path of ancestors.reverse()) {
    let info = await existing(path)
    if (!info && create) {
      await mkdir(path)
      info = await lstat(path)
    }
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error('Anchored Comments data root cannot cross a symlink or non-directory.')
    }
    if (info && await realpath(path) !== path) {
      throw new Error('Anchored Comments data root escaped its declared ancestors.')
    }
  }
  return root
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
  const root = await safeRoot(rootDir, create)
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
  segments: readonly string[],
  maxBytes = MAX_SAFE_STORE_READ_BYTES
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_SAFE_STORE_READ_BYTES) {
    throw new Error('Invalid Anchored Comments read byte limit.')
  }
  const target = await safeStorePath(rootDir, segments, { createParent: false })
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Anchored Comments data files must be regular files.')
    const tooLarge = (): never => { throw new Error(`Anchored Comments data exceeds ${maxBytes} bytes.`) }
    if (info.size > maxBytes) tooLarge()
    // The file can grow after stat. Every read is bounded, including a one-byte
    // EOF probe at the limit; never use readFile() after a size-only check.
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes - total + 1))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) tooLarge()
      chunks.push(chunk.subarray(0, bytesRead))
    }
    const bytes = Buffer.concat(chunks, total)
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } finally {
    await handle.close()
  }
}

export async function readSafeStoreText(
  rootDir: string,
  segments: readonly string[],
  maxBytes = MAX_SAFE_STORE_READ_BYTES
): Promise<string> {
  return Buffer.from(await readSafeStoreBytes(rootDir, segments, maxBytes)).toString('utf8')
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
