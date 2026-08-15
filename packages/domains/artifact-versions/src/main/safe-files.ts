import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
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

export async function safeDataDirectoryPath(
  rootDir: string,
  segments: readonly string[],
  options: Readonly<{ create?: boolean }> = {}
): Promise<string> {
  const root = await canonicalDirectory(rootDir, 'Artifact Versions data root')
  let directory = root
  for (const raw of segments) {
    const next = join(directory, safeSegment(raw))
    let info = await existing(next)
    if (!info && options.create !== false) {
      await mkdir(next)
      info = await lstat(next)
    }
    if (!info) return next
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Artifact Versions data path cannot cross a symlink.')
    }
    directory = await realpath(next)
    if (!isInside(root, directory)) {
      throw new Error('Artifact Versions data path escaped its data root.')
    }
  }
  return directory
}

export async function listSafeDataRegularFiles(
  rootDir: string,
  segments: readonly string[]
): Promise<readonly Readonly<{ name: string; byteLength: number; modifiedAt: Date }>[]> {
  let directory: string
  try {
    directory = await safeDataDirectoryPath(rootDir, segments, { create: false })
    const info = await existing(directory)
    if (!info) return []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    safeSegment(entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Artifact Versions data directories may contain only regular files.')
    }
    const path = await safeDataPath(rootDir, [...segments, entry.name], { createParent: false })
    const info = await lstat(path)
    files.push({ name: entry.name, byteLength: info.size, modifiedAt: info.mtime })
  }
  return files
}

export async function measureSafeDataRegularFiles(
  rootDir: string,
  segments: readonly string[]
): Promise<Readonly<{ byteLength: number; fileCount: number }>> {
  let directory: string
  try {
    directory = await safeDataDirectoryPath(rootDir, segments, { create: false })
    const info = await existing(directory)
    if (!info) return { byteLength: 0, fileCount: 0 }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { byteLength: 0, fileCount: 0 }
    }
    throw error
  }
  let byteLength = 0
  let fileCount = 0
  const pending = [directory]
  const root = await canonicalDirectory(rootDir, 'Artifact Versions data root')
  while (pending.length > 0) {
    const current = pending.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      safeSegment(entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('Artifact Versions data directories cannot contain symlinks.')
      }
      const path = join(current, entry.name)
      const info = await lstat(path)
      if (info.isDirectory()) {
        const canonical = await realpath(path)
        if (!isInside(root, canonical)) {
          throw new Error('Artifact Versions data path escaped its data root.')
        }
        pending.push(canonical)
      } else if (info.isFile()) {
        byteLength += info.size
        fileCount += 1
        if (!Number.isSafeInteger(byteLength)) {
          throw new Error('Artifact Versions data usage exceeds safe integer accounting.')
        }
      } else {
        throw new Error('Artifact Versions data directories may contain only regular files.')
      }
    }
  }
  return { byteLength, fileCount }
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

export async function appendOrVerifySafeDataBytes(
  rootDir: string,
  segments: readonly string[],
  offset: number,
  bytes: Uint8Array
): Promise<Readonly<{ nextOffset: number; idempotentReplay: boolean }>> {
  const target = await safeDataPath(rootDir, segments)
  const handle = await open(
    target,
    constants.O_RDWR | constants.O_CREAT | NOFOLLOW,
    0o600
  )
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < offset) {
      throw Object.assign(new Error('Staged chunk offset is not contiguous.'), {
        code: 'ESTAGEOFFSET'
      })
    }
    if (info.size > offset) {
      if (info.size < offset + bytes.byteLength) {
        throw Object.assign(new Error('Staged chunk overlaps incomplete existing bytes.'), {
          code: 'ESTAGEOFFSET'
        })
      }
      const existingBytes = Buffer.alloc(bytes.byteLength)
      const read = await handle.read(existingBytes, 0, existingBytes.byteLength, offset)
      if (read.bytesRead !== bytes.byteLength || !existingBytes.equals(Buffer.from(bytes))) {
        throw Object.assign(new Error('Staged chunk does not match bytes already received.'), {
          code: 'ESTAGEMISMATCH'
        })
      }
      return { nextOffset: Math.max(info.size, offset + bytes.byteLength), idempotentReplay: true }
    }
    const written = await handle.write(bytes, 0, bytes.byteLength, offset)
    if (written.bytesWritten !== bytes.byteLength) {
      throw new Error('Failed to append the complete staged chunk.')
    }
    await handle.sync()
    return { nextOffset: offset + bytes.byteLength, idempotentReplay: false }
  } finally {
    await handle.close()
  }
}

export async function inspectRegularFile(
  path: string,
  options: Readonly<{ offset?: number; length?: number }> = {}
): Promise<Readonly<{
  contentDigest: string
  byteLength: number
  rangeBytes?: Uint8Array
}>> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
  const hash = createHash('sha256')
  const requestedOffset = options.offset ?? 0
  const requestedLength = options.length ?? 0
  const range = requestedLength > 0 ? Buffer.alloc(requestedLength) : undefined
  let rangeWritten = 0
  let position = 0
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Artifact Versions content must be a regular file.')
    const buffer = Buffer.alloc(4 * 1024 * 1024)
    while (true) {
      const result = await handle.read(buffer, 0, buffer.byteLength, position)
      if (result.bytesRead === 0) break
      const chunk = buffer.subarray(0, result.bytesRead)
      hash.update(chunk)
      if (range && rangeWritten < requestedLength) {
        const chunkStart = position
        const chunkEnd = position + result.bytesRead
        const wantedStart = Math.max(requestedOffset, chunkStart)
        const wantedEnd = Math.min(requestedOffset + requestedLength, chunkEnd)
        if (wantedEnd > wantedStart) {
          const sourceStart = wantedStart - chunkStart
          const count = wantedEnd - wantedStart
          chunk.copy(range, rangeWritten, sourceStart, sourceStart + count)
          rangeWritten += count
        }
      }
      position += result.bytesRead
    }
    return {
      contentDigest: hash.digest('hex'),
      byteLength: position,
      ...(range ? { rangeBytes: Uint8Array.from(range.subarray(0, rangeWritten)) } : {})
    }
  } finally {
    await handle.close()
  }
}

export async function readVerifiedRegularFileRange(
  path: string,
  options: Readonly<{
    expectedDigest: string
    expectedByteLength: number
    offset: number
    length: number
    verifiedIdentity?: string
  }>
): Promise<Readonly<{
  bytes: Uint8Array
  verifiedIdentity: string
  fullVerification: boolean
}>> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size !== BigInt(options.expectedByteLength)) {
      throw Object.assign(new Error('Artifact object length changed.'), { code: 'EINTEGRITY' })
    }
    const beforeIdentity = regularFileIdentity(before)
    const actualLength = Math.min(
      options.length,
      options.expectedByteLength - options.offset
    )
    if (actualLength < 0) {
      throw Object.assign(new Error('Artifact range starts beyond the object.'), {
        code: 'ERANGE'
      })
    }
    if (options.verifiedIdentity === beforeIdentity) {
      const bytes = Buffer.alloc(actualLength)
      let readOffset = 0
      while (readOffset < actualLength) {
        const read = await handle.read(
          bytes,
          readOffset,
          actualLength - readOffset,
          options.offset + readOffset
        )
        if (read.bytesRead === 0) {
          throw Object.assign(new Error('Artifact object ended during ranged read.'), {
            code: 'EINTEGRITY'
          })
        }
        readOffset += read.bytesRead
      }
      const afterIdentity = regularFileIdentity(await handle.stat({ bigint: true }))
      if (afterIdentity !== beforeIdentity) {
        throw Object.assign(new Error('Artifact object changed during ranged read.'), {
          code: 'ESTALE'
        })
      }
      return {
        bytes: Uint8Array.from(bytes),
        verifiedIdentity: beforeIdentity,
        fullVerification: false
      }
    }

    const hash = createHash('sha256')
    const range = Buffer.alloc(actualLength)
    const buffer = Buffer.alloc(4 * 1024 * 1024)
    let position = 0
    let rangeWritten = 0
    while (true) {
      const result = await handle.read(buffer, 0, buffer.byteLength, position)
      if (result.bytesRead === 0) break
      const chunk = buffer.subarray(0, result.bytesRead)
      hash.update(chunk)
      const wantedStart = Math.max(options.offset, position)
      const wantedEnd = Math.min(options.offset + actualLength, position + result.bytesRead)
      if (wantedEnd > wantedStart) {
        const sourceStart = wantedStart - position
        const count = wantedEnd - wantedStart
        chunk.copy(range, rangeWritten, sourceStart, sourceStart + count)
        rangeWritten += count
      }
      position += result.bytesRead
    }
    const afterIdentity = regularFileIdentity(await handle.stat({ bigint: true }))
    const actualDigest = hash.digest('hex')
    if (
      afterIdentity !== beforeIdentity ||
      position !== options.expectedByteLength ||
      actualDigest !== options.expectedDigest ||
      rangeWritten !== actualLength
    ) {
      throw Object.assign(new Error('Artifact object failed ranged-read verification.'), {
        code: afterIdentity !== beforeIdentity ? 'ESTALE' : 'EINTEGRITY'
      })
    }
    return {
      bytes: Uint8Array.from(range),
      verifiedIdentity: afterIdentity,
      fullVerification: true
    }
  } finally {
    await handle.close()
  }
}

function regularFileIdentity(
  info: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>
): string {
  const value = info as unknown as Readonly<{
    dev: bigint
    ino: bigint
    size: bigint
    mtimeNs: bigint
    ctimeNs: bigint
  }>
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
}

export async function removeSafeDataFile(
  rootDir: string,
  segments: readonly string[]
): Promise<boolean> {
  const target = await safeDataPath(rootDir, segments, { createParent: false })
  try {
    await rm(target, { force: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
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
  const resolved = await resolveWorkspaceEntry(workspaceRoot, requestedPath, 'file')
  const handle = await open(resolved.absolutePath, constants.O_RDONLY | NOFOLLOW)
  try {
    return {
      bytes: Uint8Array.from(await handle.readFile()),
      relativePath: resolved.relativePath
    }
  } finally {
    await handle.close()
  }
}

export async function resolveWorkspaceEntry(
  workspaceRoot: string,
  requestedPath: string,
  expectedKind?: 'file' | 'directory'
): Promise<Readonly<{
  absolutePath: string
  relativePath: string
  kind: 'file' | 'directory'
}>> {
  const root = await canonicalDirectory(workspaceRoot, 'Workspace root')
  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath)
  if (!isInside(root, candidate) || candidate === root && expectedKind === 'file') {
    throw new WorkspacePathError('The requested path is outside the caller workspace.')
  }
  let cursor = root
  const requestedSegments = relative(root, candidate).split(sep).filter(Boolean)
  for (const segment of requestedSegments) {
    cursor = join(cursor, segment)
    const requestedInfo = await lstat(cursor)
    if (requestedInfo.isSymbolicLink()) {
      throw new WorkspacePathError('The requested path cannot cross a symbolic link.')
    }
  }
  const canonical = await realpath(candidate)
  if (!isInside(root, canonical)) {
    throw new WorkspacePathError('The requested path is outside the caller workspace.')
  }
  const info = await lstat(canonical)
  const kind = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : null
  if (info.isSymbolicLink() || !kind || (expectedKind && kind !== expectedKind)) {
    throw new WorkspacePathError(
      expectedKind === 'file'
        ? 'The requested path must be a regular workspace file.'
        : expectedKind === 'directory'
          ? 'The requested path must be a regular workspace directory.'
          : 'The requested path must be a regular workspace file or directory.'
    )
  }
  return {
    absolutePath: canonical,
    relativePath: relative(root, canonical).split(sep).join('/'),
    kind
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

export async function atomicWriteWorkspaceDirectory(
  workspaceRoot: string,
  requestedPath: string,
  overwrite: boolean,
  populate: (temporaryDirectory: string) => Promise<void>
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
  if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) {
    throw new WorkspacePathError('The bundle destination must be a regular directory.')
  }
  if (targetInfo && !overwrite) throw new DestinationExistsError(target)

  const nonce = `${process.pid}.${randomUUID()}`
  const temporary = join(parent, `.${segments.at(-1)}.${nonce}.tmp`)
  const backup = join(parent, `.${segments.at(-1)}.${nonce}.backup`)
  let backedUp = false
  try {
    await mkdir(temporary, { mode: 0o700 })
    await populate(temporary)
    const directory = await open(temporary, constants.O_RDONLY)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
    if (targetInfo) {
      await rename(target, backup)
      backedUp = true
    }
    try {
      await rename(temporary, target)
    } catch (error) {
      if (backedUp) await rename(backup, target).catch(() => undefined)
      throw error
    }
    backedUp = false
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
    const parentHandle = await open(parent, constants.O_RDONLY)
    try {
      await parentHandle.sync()
    } finally {
      await parentHandle.close()
    }
    return child.split(sep).join('/')
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    if (backedUp) await rename(backup, target).catch(() => undefined)
    throw error
  }
}

export async function copyVerifiedRegularFile(
  sourcePath: string,
  destinationPath: string,
  expectedDigest: string,
  expectedByteLength: number
): Promise<void> {
  const source = await open(sourcePath, constants.O_RDONLY | NOFOLLOW)
  let destination: Awaited<ReturnType<typeof open>> | null = null
  try {
    const sourceInfo = await source.stat()
    if (!sourceInfo.isFile()) throw new Error('Artifact source must be a regular file.')
    destination = await open(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o600
    )
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(4 * 1024 * 1024)
    let position = 0
    while (true) {
      const read = await source.read(buffer, 0, buffer.byteLength, position)
      if (read.bytesRead === 0) break
      const chunk = buffer.subarray(0, read.bytesRead)
      hash.update(chunk)
      const written = await destination.write(chunk)
      if (written.bytesWritten !== chunk.byteLength) {
        throw new Error('Failed to copy the complete artifact object chunk.')
      }
      position += read.bytesRead
    }
    const actualDigest = hash.digest('hex')
    if (position !== expectedByteLength || actualDigest !== expectedDigest) {
      throw Object.assign(new Error('Artifact object failed digest or length verification.'), {
        code: 'EINTEGRITY',
        actualDigest,
        actualByteLength: position
      })
    }
    await destination.sync()
    await destination.close()
    destination = null
  } catch (error) {
    await destination?.close().catch(() => undefined)
    await rm(destinationPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await source.close()
  }
}

export class WorkspacePathError extends Error {}
export class DestinationExistsError extends Error {}
