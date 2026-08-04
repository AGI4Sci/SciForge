import { lstat, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { ExtensionStoreError, extensionErrorMessage } from './errors'
import {
  DEFAULT_EXTENSION_ARTIFACT_LIMITS,
  type ExtensionArtifactLimits,
  type ExtensionArtifactSource
} from './types'

type ZipEntryMetadata = Readonly<{
  path: string
  isDirectory: boolean
  compressedSize: number
  uncompressedSize: number
}>

type MutableBudget = {
  fileCount: number
  unpackedBytes: number
}

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50
const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff
const MAX_ZIP_COMMENT_BYTES = 0xffff

export async function readExtensionArtifact(
  source: ExtensionArtifactSource,
  limitsInput: Partial<ExtensionArtifactLimits> = {}
): Promise<Map<string, Buffer>> {
  const limits = normalizeLimits(limitsInput)
  const normalizedSource = await normalizeSource(source)
  if (normalizedSource.kind === 'directory') {
    return readDirectoryArtifact(normalizedSource.path, limits)
  }
  const bytes = normalizedSource.kind === 'zip-bytes'
    ? Buffer.from(normalizedSource.bytes)
    : await readZipFile(normalizedSource.path, limits)
  return readZipArtifact(bytes, limits)
}

function normalizeLimits(input: Partial<ExtensionArtifactLimits>): ExtensionArtifactLimits {
  const limits = {
    ...DEFAULT_EXTENSION_ARTIFACT_LIMITS,
    ...input
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ExtensionStoreError(
        'invalid_source',
        `Extension artifact limit ${name} must be a positive safe integer.`
      )
    }
  }
  return Object.freeze(limits)
}

async function normalizeSource(
  source: ExtensionArtifactSource
): Promise<Exclude<ExtensionArtifactSource, string>> {
  if (typeof source !== 'string') {
    if (source.kind === 'zip-bytes') {
      if (!(source.bytes instanceof Uint8Array)) {
        throw new ExtensionStoreError('invalid_source', 'ZIP artifact bytes must be a Uint8Array.')
      }
      return source
    }
    return { kind: source.kind, path: resolve(source.path) }
  }

  const path = resolve(source)
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    throw new ExtensionStoreError(
      'invalid_source',
      `Extension artifact does not exist: ${path}`,
      { cause: error }
    )
  }
  if (stats.isSymbolicLink()) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension artifact root cannot be a symlink.')
  }
  if (stats.isDirectory()) return { kind: 'directory', path }
  if (stats.isFile()) return { kind: 'zip', path }
  throw new ExtensionStoreError(
    'invalid_source',
    'Extension artifact must be a directory or ZIP file.'
  )
}

async function readZipFile(path: string, limits: ExtensionArtifactLimits): Promise<Buffer> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    throw new ExtensionStoreError(
      'invalid_source',
      `Extension ZIP does not exist: ${path}`,
      { cause: error }
    )
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP must be a regular file.')
  }
  if (stats.size > limits.maxArchiveBytes) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension ZIP exceeds the ${limits.maxArchiveBytes} byte compressed-size limit.`
    )
  }
  return readFile(path)
}

async function readDirectoryArtifact(
  rootPath: string,
  limits: ExtensionArtifactLimits
): Promise<Map<string, Buffer>> {
  const rootStats = await lstat(rootPath)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      'Extension artifact directory must be a real directory, not a symlink.'
    )
  }

  const files = new Map<string, Buffer>()
  const budget: MutableBudget = { fileCount: 0, unpackedBytes: 0 }

  async function visit(directoryPath: string, segments: readonly string[]): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name)
      const entryStats = await lstat(entryPath)
      if (entryStats.isSymbolicLink()) {
        throw new ExtensionStoreError(
          'unsafe_artifact',
          `Extension artifact contains a symlink: ${[...segments, entry.name].join('/')}`
        )
      }
      if (entryStats.isDirectory()) {
        await visit(entryPath, [...segments, entry.name])
        continue
      }
      if (!entryStats.isFile()) {
        throw new ExtensionStoreError(
          'unsafe_artifact',
          `Extension artifact contains a non-regular file: ${[...segments, entry.name].join('/')}`
        )
      }
      const artifactPath = validateArtifactPath([...segments, entry.name].join('/'))
      consumeBudget(budget, entryStats.size, limits, artifactPath)
      const bytes = await readFile(entryPath)
      if (bytes.byteLength !== entryStats.size) {
        throw new ExtensionStoreError(
          'unsafe_artifact',
          `Extension artifact file changed while it was being read: ${artifactPath}`
        )
      }
      addUniqueFile(files, artifactPath, bytes)
    }
  }

  await visit(rootPath, [])
  return files
}

async function readZipArtifact(
  bytes: Buffer,
  limits: ExtensionArtifactLimits
): Promise<Map<string, Buffer>> {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension ZIP exceeds the ${limits.maxArchiveBytes} byte compressed-size limit.`
    )
  }

  const metadata = inspectZipCentralDirectory(bytes, limits)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: true,
      createFolders: false
    })
  } catch (error) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension ZIP is invalid: ${extensionErrorMessage(error)}`,
      { cause: error }
    )
  }

  const files = new Map<string, Buffer>()
  for (const entry of metadata) {
    if (entry.isDirectory) continue
    const zipEntry = zip.file(entry.path)
    if (!zipEntry || zipEntry.dir) {
      throw new ExtensionStoreError(
        'unsafe_artifact',
        `Extension ZIP entry is missing or has conflicting type: ${entry.path}`
      )
    }
    let contents: Buffer
    try {
      contents = await zipEntry.async('nodebuffer')
    } catch (error) {
      throw new ExtensionStoreError(
        'unsafe_artifact',
        `Could not decompress extension ZIP entry ${entry.path}: ${extensionErrorMessage(error)}`,
        { cause: error }
      )
    }
    if (contents.byteLength !== entry.uncompressedSize) {
      throw new ExtensionStoreError(
        'unsafe_artifact',
        `Extension ZIP entry size changed while decompressing: ${entry.path}`
      )
    }
    addUniqueFile(files, entry.path, contents)
  }
  return files
}

function inspectZipCentralDirectory(
  bytes: Buffer,
  limits: ExtensionArtifactLimits
): readonly ZipEntryMetadata[] {
  const eocdOffset = findEndOfCentralDirectory(bytes)
  if (eocdOffset < 0) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP has no valid central directory.')
  }

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = bytes.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8)
  const entryCount = bytes.readUInt16LE(eocdOffset + 10)
  const centralSize = bytes.readUInt32LE(eocdOffset + 12)
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16)
  const commentLength = bytes.readUInt16LE(eocdOffset + 20)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ExtensionStoreError('unsafe_artifact', 'Multi-disk extension ZIPs are not supported.')
  }
  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralSize === ZIP64_SENTINEL_32 ||
    centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new ExtensionStoreError('unsafe_artifact', 'ZIP64 extension artifacts are not supported.')
  }
  if (entryCount > limits.maxFiles + 256) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension ZIP has too many entries (${entryCount}).`
    )
  }
  if (eocdOffset + 22 + commentLength !== bytes.byteLength) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP has trailing or malformed data.')
  }
  if (centralOffset + centralSize !== eocdOffset || centralOffset > bytes.byteLength) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP central directory is malformed.')
  }

  const entries: ZipEntryMetadata[] = []
  const pathKinds = new Map<string, 'file' | 'directory'>()
  const portablePaths = new Map<string, string>()
  const budget: MutableBudget = { fileCount: 0, unpackedBytes: 0 }
  let offset = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > eocdOffset ||
      bytes.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    ) {
      throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP central directory is truncated.')
    }
    const versionMadeBy = bytes.readUInt16LE(offset + 4)
    const flags = bytes.readUInt16LE(offset + 8)
    const compression = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const fileNameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const entryCommentLength = bytes.readUInt16LE(offset + 32)
    const diskStart = bytes.readUInt16LE(offset + 34)
    const externalAttributes = bytes.readUInt32LE(offset + 38)
    const entryEnd = offset + 46 + fileNameLength + extraLength + entryCommentLength
    if (entryEnd > eocdOffset) {
      throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP entry metadata is truncated.')
    }
    if (flags & 0x1) {
      throw new ExtensionStoreError('unsafe_artifact', 'Encrypted extension ZIP entries are forbidden.')
    }
    if (compression !== 0 && compression !== 8) {
      throw new ExtensionStoreError(
        'unsafe_artifact',
        `Extension ZIP uses unsupported compression method ${compression}.`
      )
    }
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      diskStart === ZIP64_SENTINEL_16
    ) {
      throw new ExtensionStoreError('unsafe_artifact', 'ZIP64 extension entries are not supported.')
    }

    const rawName = bytes.subarray(offset + 46, offset + 46 + fileNameLength)
    const decodedName = decodeZipPath(rawName)
    const isDirectory = decodedName.endsWith('/') || (externalAttributes & 0x10) !== 0
    const path = validateArtifactPath(isDirectory ? decodedName.slice(0, -1) : decodedName)
    validateZipEntryType(versionMadeBy, externalAttributes, isDirectory, path)
    addUniquePath(pathKinds, portablePaths, path, isDirectory ? 'directory' : 'file')

    if (!isDirectory) consumeBudget(budget, uncompressedSize, limits, path)
    entries.push({ path, isDirectory, compressedSize, uncompressedSize })
    offset = entryEnd
  }

  if (offset !== eocdOffset) {
    throw new ExtensionStoreError('unsafe_artifact', 'Extension ZIP central directory size is inconsistent.')
  }
  validatePathHierarchy(pathKinds)
  return entries
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  if (bytes.byteLength < 22) return -1
  const minimumOffset = Math.max(0, bytes.byteLength - 22 - MAX_ZIP_COMMENT_BYTES)
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  return -1
}

function decodeZipPath(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      'Extension ZIP paths must be valid UTF-8.',
      { cause: error }
    )
  }
}

function validateZipEntryType(
  versionMadeBy: number,
  externalAttributes: number,
  isDirectory: boolean,
  path: string
): void {
  const originatingSystem = versionMadeBy >>> 8
  if (originatingSystem !== 3) return
  const unixMode = externalAttributes >>> 16
  const fileType = unixMode & 0o170000
  if (fileType === 0o120000) {
    throw new ExtensionStoreError('unsafe_artifact', `Extension ZIP contains a symlink: ${path}`)
  }
  const expectedType = isDirectory ? 0o040000 : 0o100000
  if (fileType !== 0 && fileType !== expectedType) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension ZIP contains a non-regular entry: ${path}`
    )
  }
}

export function validateArtifactPath(input: string): string {
  if (
    !input ||
    input.length > 1_024 ||
    input.includes('\0') ||
    input.includes('\\') ||
    input.startsWith('/') ||
    /^[A-Za-z]:/.test(input) ||
    isAbsolute(input)
  ) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Unsafe extension artifact path: ${JSON.stringify(input)}`
    )
  }
  const segments = input.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Unsafe extension artifact path: ${JSON.stringify(input)}`
    )
  }
  const normalized = segments.join('/')
  const resolved = resolve('/extension-artifact', ...segments)
  const confined = relative('/extension-artifact', resolved)
  if (
    confined.startsWith(`..${sep}`) ||
    confined === '..' ||
    isAbsolute(confined)
  ) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension artifact path escapes its root: ${JSON.stringify(input)}`
    )
  }
  return normalized
}

function portablePathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function addUniquePath(
  pathKinds: Map<string, 'file' | 'directory'>,
  portablePaths: Map<string, string>,
  path: string,
  kind: 'file' | 'directory'
): void {
  if (pathKinds.has(path)) {
    throw new ExtensionStoreError('unsafe_artifact', `Duplicate extension ZIP path: ${path}`)
  }
  const portableKey = portablePathKey(path)
  const existingPortablePath = portablePaths.get(portableKey)
  if (existingPortablePath) {
    throw new ExtensionStoreError(
      'unsafe_artifact',
      `Extension ZIP paths conflict on case-insensitive filesystems: ${existingPortablePath} and ${path}`
    )
  }
  pathKinds.set(path, kind)
  portablePaths.set(portableKey, path)
}

function validatePathHierarchy(pathKinds: ReadonlyMap<string, 'file' | 'directory'>): void {
  for (const path of pathKinds.keys()) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('/')
      if (pathKinds.get(parent) === 'file') {
        throw new ExtensionStoreError(
          'unsafe_artifact',
          `Extension ZIP path ${path} is nested beneath file ${parent}.`
        )
      }
    }
  }
}

function consumeBudget(
  budget: MutableBudget,
  byteLength: number,
  limits: ExtensionArtifactLimits,
  path: string
): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new ExtensionStoreError('unsafe_artifact', `Invalid extension artifact size for ${path}.`)
  }
  if (byteLength > limits.maxFileBytes) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension artifact file ${path} exceeds the ${limits.maxFileBytes} byte limit.`
    )
  }
  budget.fileCount += 1
  budget.unpackedBytes += byteLength
  if (budget.fileCount > limits.maxFiles) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension artifact exceeds the ${limits.maxFiles} file limit.`
    )
  }
  if (budget.unpackedBytes > limits.maxUnpackedBytes) {
    throw new ExtensionStoreError(
      'artifact_too_large',
      `Extension artifact exceeds the ${limits.maxUnpackedBytes} byte unpacked-size limit.`
    )
  }
}

function addUniqueFile(files: Map<string, Buffer>, path: string, contents: Buffer): void {
  const portableKey = portablePathKey(path)
  for (const existingPath of files.keys()) {
    if (portablePathKey(existingPath) === portableKey) {
      throw new ExtensionStoreError(
        'unsafe_artifact',
        `Extension artifact contains duplicate or portability-conflicting path ${path}.`
      )
    }
  }
  files.set(path, contents)
}
