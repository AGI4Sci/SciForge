import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

export type AppDataStorePath = {
  rootPath: string
  parentPath: string
  path: string
}

export type AppDataStorePathOptions = {
  createParentDirectories?: boolean
}

export type AppDataWriteOptions = {
  encoding?: BufferEncoding
  trailingNewline?: boolean
}

export type AppDataJsonlStoreOptions = {
  rootDir: string
  segments: readonly string[]
}

export type AppDataJsonlReverseReadOptions = {
  /** Exclusive byte offset to start reading backwards from. Defaults to the file size. */
  endOffset?: number
  chunkSize?: number
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const WINDOWS_ATOMIC_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100] as const

type AtomicRenameOptions = {
  platform?: NodeJS.Platform
  renameFile?: (source: string, target: string) => Promise<void>
  wait?: (delayMs: number) => Promise<void>
}

export async function renameAppDataFileAtomically(
  source: string,
  target: string,
  options: AtomicRenameOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  const renameFile = options.renameFile ?? rename
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  }))

  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryDelay = WINDOWS_ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]
      const retryable = platform === 'win32' && (
        code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      )
      if (!retryable || retryDelay === undefined) throw error
      await wait(retryDelay)
    }
  }
}

export class AppDataJsonlStore {
  private readonly rootDir: string
  private readonly segments: readonly string[]
  private queue: Promise<void> = Promise.resolve()

  constructor(options: AppDataJsonlStoreOptions) {
    this.rootDir = options.rootDir
    this.segments = [...options.segments]
  }

  async appendJson(values: readonly unknown[]): Promise<void> {
    await this.appendLines(values.map((value) => JSON.stringify(value)))
  }

  async appendLines(lines: readonly string[]): Promise<void> {
    if (lines.length === 0) return
    for (const line of lines) {
      if (line.includes('\n') || line.includes('\r')) {
        throw Object.assign(new Error('App data JSONL lines must not contain raw newlines.'), {
          code: 'invalid_app_data_jsonl'
        })
      }
    }
    const content = `${lines.join('\n')}\n`
    await this.enqueue(async () => appendAppDataStoreText(this.rootDir, this.segments, content))
  }

  async readText(): Promise<string> {
    return this.enqueue(async () => readAppDataStoreText(this.rootDir, this.segments))
  }

  async readLines(visitor: (line: string) => void | Promise<void>): Promise<void> {
    await this.enqueue(async () => {
      const target = await appDataStorePath(this.rootDir, this.segments, {
        createParentDirectories: false
      })
      const handle = await open(target.path, constants.O_RDONLY | NOFOLLOW)
      try {
        const stream = handle.createReadStream({ encoding: 'utf8', autoClose: false })
        const lines = createInterface({ input: stream, crlfDelay: Infinity })
        for await (const line of lines) await visitor(line)
      } finally {
        await handle.close()
      }
    })
  }

  async readLinesReverse(
    visitor: (line: string, startOffset: number) => boolean | void | Promise<boolean | void>,
    options: AppDataJsonlReverseReadOptions = {}
  ): Promise<void> {
    await this.enqueue(async () => {
      const target = await appDataStorePath(this.rootDir, this.segments, {
        createParentDirectories: false
      })
      const handle = await open(target.path, constants.O_RDONLY | NOFOLLOW)
      try {
        const fileSize = (await handle.stat()).size
        const requestedEnd = options.endOffset ?? fileSize
        if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0 || requestedEnd > fileSize) {
          throw Object.assign(new Error('Invalid JSONL reverse-read offset.'), {
            code: 'invalid_app_data_jsonl_offset'
          })
        }
        const chunkSize = Math.min(
          1024 * 1024,
          Math.max(1024, Math.floor(options.chunkSize ?? 64 * 1024))
        )
        let position = requestedEnd
        let carry = Buffer.alloc(0)

        while (position > 0) {
          const start = Math.max(0, position - chunkSize)
          const chunk = Buffer.allocUnsafe(position - start)
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, start)
          if (bytesRead !== chunk.length) {
            throw Object.assign(new Error('Could not read the requested JSONL range.'), {
              code: 'app_data_jsonl_short_read'
            })
          }
          const data = carry.length > 0
            ? Buffer.concat([chunk, carry], chunk.length + carry.length)
            : chunk
          let lineEnd = data.length

          for (let index = data.length - 1; index >= 0; index -= 1) {
            if (data[index] !== 0x0a) continue
            const lineStart = index + 1
            const rawLine = data.subarray(
              lineStart,
              lineEnd > lineStart && data[lineEnd - 1] === 0x0d ? lineEnd - 1 : lineEnd
            )
            lineEnd = index
            if (rawLine.length === 0) continue
            const keepReading = await visitor(rawLine.toString('utf8'), start + lineStart)
            if (keepReading === false) return
          }

          carry = Buffer.from(data.subarray(0, lineEnd))
          position = start
        }

        if (carry.length > 0) {
          const rawLine = carry[carry.length - 1] === 0x0d
            ? carry.subarray(0, carry.length - 1)
            : carry
          if (rawLine.length > 0) await visitor(rawLine.toString('utf8'), 0)
        }
      } finally {
        await handle.close()
      }
    })
  }

  async path(): Promise<string> {
    const target = await appDataStorePath(this.rootDir, this.segments, { createParentDirectories: false })
    return target.path
  }

  async delete(): Promise<void> {
    await this.enqueue(async () => {
      try {
        const target = await appDataStorePath(this.rootDir, this.segments, {
          createParentDirectories: false
        })
        await rm(target.path, { force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
}

export async function appDataStorePath(
  rootDir: string,
  segments: readonly string[],
  options: AppDataStorePathOptions = {}
): Promise<AppDataStorePath> {
  const safeSegments = segments.map(safeAppDataSegment)
  if (safeSegments.length === 0) {
    throw Object.assign(new Error('App data store path requires at least one segment.'), {
      code: 'invalid_app_data_path'
    })
  }
  const rootPath = await appDataRoot(rootDir)
  const parentSegments = safeSegments.slice(0, -1)
  const fileName = safeSegments[safeSegments.length - 1]!
  const parentPath = options.createParentDirectories === false
    ? await resolveAppDataParent(rootPath, parentSegments)
    : await ensureAppDataDirectory(rootPath, parentSegments)
  const targetPath = safeJoin(rootPath, parentPath, fileName)
  await assertSafeExistingFile(rootPath, targetPath)
  return {
    rootPath,
    parentPath,
    path: targetPath
  }
}

export async function readAppDataStoreText(
  rootDir: string,
  segments: readonly string[]
): Promise<string> {
  const target = await appDataStorePath(rootDir, segments, { createParentDirectories: false })
  return readFileNoFollow(target.path, 'utf8')
}

export async function readAppDataStoreTextAtPath(path: string): Promise<string> {
  const target = await appDataStorePathForAbsoluteFile(path, { createParentDirectories: false })
  return readFileNoFollow(target.path, 'utf8')
}

export async function atomicWriteAppDataText(
  rootDir: string,
  segments: readonly string[],
  content: string | Uint8Array,
  options: AppDataWriteOptions = {}
): Promise<void> {
  const target = await appDataStorePath(rootDir, segments, { createParentDirectories: true })
  await atomicWriteResolvedAppDataText(target, content, options)
}

export async function atomicWriteAppDataTextAtPath(
  path: string,
  content: string | Uint8Array,
  options: AppDataWriteOptions = {}
): Promise<void> {
  const target = await appDataStorePathForAbsoluteFile(path, { createParentDirectories: true })
  await atomicWriteResolvedAppDataText(target, content, options)
}

export async function atomicWriteAppDataJson(
  rootDir: string,
  segments: readonly string[],
  value: unknown,
  options: AppDataWriteOptions = {}
): Promise<void> {
  await atomicWriteAppDataText(rootDir, segments, formatJson(value, options.trailingNewline), options)
}

export async function atomicWriteAppDataJsonAtPath(
  path: string,
  value: unknown,
  options: AppDataWriteOptions = {}
): Promise<void> {
  await atomicWriteAppDataTextAtPath(path, formatJson(value, options.trailingNewline), options)
}

export async function appendAppDataStoreText(
  rootDir: string,
  segments: readonly string[],
  content: string | Uint8Array,
  options: Pick<AppDataWriteOptions, 'encoding'> = {}
): Promise<void> {
  const target = await appDataStorePath(rootDir, segments, { createParentDirectories: true })
  await appendResolvedAppDataText(target, content, options)
}

async function appDataStorePathForAbsoluteFile(
  path: string,
  options: AppDataStorePathOptions
): Promise<AppDataStorePath> {
  const resolved = resolve(path)
  const parent = dirname(resolved)
  const fileName = safeAppDataSegment(basename(resolved))
  return appDataStorePath(parent, [fileName], options)
}

async function atomicWriteResolvedAppDataText(
  target: AppDataStorePath,
  content: string | Uint8Array,
  options: AppDataWriteOptions
): Promise<void> {
  await assertSafeExistingDirectory(target.rootPath, target.parentPath)
  await assertSafeExistingFile(target.rootPath, target.path)
  const tmpPath = safeJoin(
    target.rootPath,
    target.parentPath,
    `.${safeAppDataSegment(target.path.split(/[\\/]/).pop() ?? 'store')}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  )
  try {
    await writeFileNoFollow(tmpPath, content, {
      encoding: options.encoding ?? 'utf8',
      exclusive: true
    })
    await assertSafeExistingDirectory(target.rootPath, target.parentPath)
    await assertSafeExistingFile(target.rootPath, target.path)
    await renameAppDataFileAtomically(tmpPath, target.path)
    await assertSafeExistingFile(target.rootPath, target.path)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function appendResolvedAppDataText(
  target: AppDataStorePath,
  content: string | Uint8Array,
  options: Pick<AppDataWriteOptions, 'encoding'>
): Promise<void> {
  await assertSafeExistingDirectory(target.rootPath, target.parentPath)
  await assertSafeExistingFile(target.rootPath, target.path)
  await appendFileNoFollow(target.path, content, options.encoding ?? 'utf8')
  await assertSafeExistingDirectory(target.rootPath, target.parentPath)
  await assertSafeExistingFile(target.rootPath, target.path)
}

async function appDataRoot(rootDir: string): Promise<string> {
  const root = resolve(rootDir.trim())
  if (!rootDir.trim()) {
    throw Object.assign(new Error('App data root is required.'), { code: 'invalid_app_data_path' })
  }
  await mkdir(root, { recursive: true })
  const rootPath = await realpath(root)
  const info = await lstat(rootPath)
  if (!info.isDirectory()) {
    throw Object.assign(new Error('App data root must resolve to a directory.'), { code: 'invalid_app_data_path' })
  }
  return rootPath
}

async function resolveAppDataParent(rootPath: string, segments: readonly string[]): Promise<string> {
  let current = rootPath
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = safeJoin(rootPath, current, segments[index]!)
    const info = await lstatIfExists(candidate)
    if (!info) {
      return safeJoin(rootPath, candidate, ...segments.slice(index + 1))
    }
    await assertDirectoryInfo(rootPath, candidate, info)
    current = await realpath(candidate)
  }
  return current
}

async function ensureAppDataDirectory(rootPath: string, segments: readonly string[]): Promise<string> {
  let current = rootPath
  for (const segment of segments) {
    const candidate = safeJoin(rootPath, current, segment)
    let info = await lstatIfExists(candidate)
    if (!info) {
      try {
        await mkdir(candidate)
      } catch (error) {
        if (!isErrno(error) || error.code !== 'EEXIST') throw error
      }
      info = await lstatIfExists(candidate)
    }
    if (!info) {
      throw Object.assign(new Error('App data directory could not be created.'), {
        code: 'invalid_app_data_path'
      })
    }
    await assertDirectoryInfo(rootPath, candidate, info)
    current = await realpath(candidate)
  }
  return current
}

async function assertSafeExistingDirectory(rootPath: string, path: string): Promise<void> {
  const info = await lstat(path)
  await assertDirectoryInfo(rootPath, path, info)
}

async function assertDirectoryInfo(rootPath: string, path: string, info: Stats): Promise<void> {
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw Object.assign(new Error('App data store directory must not cross a symlink.'), {
      code: 'invalid_app_data_path'
    })
  }
  const canonical = await realpath(path)
  if (!isPathInside(rootPath, canonical)) {
    throw Object.assign(new Error('App data store path must stay inside app data.'), {
      code: 'invalid_app_data_path'
    })
  }
}

async function assertSafeExistingFile(rootPath: string, path: string): Promise<void> {
  const info = await lstatIfExists(path)
  if (!info) return
  if (info.isSymbolicLink() || !info.isFile()) {
    throw Object.assign(new Error('App data store file must be a regular file and not a symlink.'), {
      code: 'invalid_app_data_path'
    })
  }
  const canonical = await realpath(path)
  if (!isPathInside(rootPath, canonical)) {
    throw Object.assign(new Error('App data store path must stay inside app data.'), {
      code: 'invalid_app_data_path'
    })
  }
}

async function readFileNoFollow(path: string, encoding: BufferEncoding): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW)
  try {
    return await handle.readFile({ encoding })
  } finally {
    await handle.close()
  }
}

async function writeFileNoFollow(
  path: string,
  content: string | Uint8Array,
  options: { encoding: BufferEncoding; exclusive?: boolean }
): Promise<void> {
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    (options.exclusive ? constants.O_EXCL : constants.O_TRUNC) |
    NOFOLLOW
  const handle = await open(path, flags, 0o600)
  try {
    if (typeof content === 'string') {
      await handle.writeFile(content, options.encoding)
    } else {
      await handle.writeFile(content)
    }
  } finally {
    await handle.close()
  }
}

async function appendFileNoFollow(
  path: string,
  content: string | Uint8Array,
  encoding: BufferEncoding
): Promise<void> {
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_APPEND |
    NOFOLLOW
  const handle = await open(path, flags, 0o600)
  try {
    if (typeof content === 'string') {
      await handle.writeFile(content, encoding)
    } else {
      await handle.writeFile(content)
    }
  } finally {
    await handle.close()
  }
}

async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isErrno(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

function formatJson(value: unknown, trailingNewline = false): string {
  return `${JSON.stringify(value, null, 2)}${trailingNewline ? '\n' : ''}`
}

function safeAppDataSegment(raw: string): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.includes('\0') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    raw === '.' ||
    raw === '..'
  ) {
    throw Object.assign(new Error('App data store path segment is invalid.'), {
      code: 'invalid_app_data_path'
    })
  }
  return raw
}

function safeJoin(rootPath: string, basePath: string, ...segments: string[]): string {
  const target = resolve(basePath, ...segments)
  if (!isPathInside(rootPath, target)) {
    throw Object.assign(new Error('App data store path must stay inside app data.'), {
      code: 'invalid_app_data_path'
    })
  }
  return target
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
