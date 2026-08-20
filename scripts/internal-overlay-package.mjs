#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'

const FIXED_ARCHIVE_DATE = new Date('1980-01-01T00:00:00.000Z')
const MANIFEST_NAME = 'MANIFEST.json'

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export async function packInternalOverlay(options) {
  const sourceDir = path.resolve(requireString(options?.sourceDir, 'sourceDir'))
  const outputFile = path.resolve(requireString(options?.outputFile, 'outputFile'))
  const overlayId = validateIdentity(options?.overlayId, 'overlayId')
  const version = validateVersion(options?.version)
  const payloadPrefix = normalizePayloadPrefix(options?.payloadPrefix)
  if (path.extname(outputFile).toLowerCase() !== '.zip') {
    throw new Error('Internal overlay outputFile must end in .zip.')
  }

  const sourceFiles = await collectSourceFiles(sourceDir)
  const files = new Map([...sourceFiles].map(([relativePath, content]) => [
    payloadPrefix === '' ? relativePath : `${payloadPrefix}/${relativePath}`,
    content
  ]))
  if (files.size === 0) {
    throw new Error('Internal overlay source must contain at least one file.')
  }
  const archiveRoot = `sciforge-internal-overlay-${overlayId}-${version}`
  const manifest = {
    files: [...files].map(([relativePath, content]) => ({
      path: relativePath,
      sha256: sha256(content),
      size: content.length
    })),
    overlayId,
    schemaVersion: 1,
    version
  }

  const archive = new JSZip()
  addArchiveFile(
    archive,
    `${archiveRoot}/${MANIFEST_NAME}`,
    Buffer.from(canonicalJson(manifest))
  )
  for (const [relativePath, content] of files) {
    addArchiveFile(archive, `${archiveRoot}/payload/${relativePath}`, content)
  }
  const archiveBytes = await archive.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
  const archiveSha256 = sha256(archiveBytes)

  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, archiveBytes, { mode: 0o644 })
  await writeFile(
    `${outputFile}.sha256`,
    `${archiveSha256}  ${path.basename(outputFile)}\n`,
    { mode: 0o644 }
  )
  return Object.freeze({
    archiveRoot,
    fileCount: files.size,
    outputFile,
    overlayId,
    sha256: archiveSha256,
    sidecarFile: `${outputFile}.sha256`,
    version
  })
}

export async function verifyInternalOverlay(options) {
  const { archiveBytes, archivePath } = await readArchive(options)
  const archiveSha256 = sha256(archiveBytes)
  await verifyArchiveSidecar({
    archivePath,
    archiveSha256,
    expectedSha256: options?.expectedSha256,
    sidecarPath: options?.sidecarPath
  })

  const archive = await JSZip.loadAsync(archiveBytes, {
    checkCRC32: true,
    createFolders: false
  })
  const entries = validateArchiveEntries(archive)
  const manifestEntries = [...entries].filter(([entryPath]) =>
    entryPath.endsWith(`/${MANIFEST_NAME}`)
  )
  if (manifestEntries.length !== 1) {
    throw new Error('Internal overlay archive must contain exactly one MANIFEST.json.')
  }
  const [manifestPath, manifestEntry] = manifestEntries[0]
  const archiveRoot = manifestPath.slice(0, -(`/${MANIFEST_NAME}`.length))
  validateArchiveRoot(archiveRoot)
  const manifestBytes = await manifestEntry.async('nodebuffer')
  const manifest = parseJson(manifestBytes, manifestPath)
  if (manifestBytes.toString('utf8') !== canonicalJson(manifest)) {
    throw new Error('Internal overlay MANIFEST.json must use canonical JSON.')
  }
  validateManifest(manifest)
  const expectedRoot = `sciforge-internal-overlay-${manifest.overlayId}-${manifest.version}`
  if (archiveRoot !== expectedRoot) {
    throw new Error('Internal overlay archive root does not match manifest identity.')
  }

  const payloadPrefix = `${archiveRoot}/payload/`
  const payloadEntries = [...entries]
    .filter(([entryPath]) => entryPath !== manifestPath)
    .map(([entryPath, entry]) => {
      if (!entryPath.startsWith(payloadPrefix)) {
        throw new Error(`Unexpected internal overlay archive entry: ${entryPath}`)
      }
      return [entryPath.slice(payloadPrefix.length), entry]
    })
    .sort(([left], [right]) => compareStrings(left, right))
  const declaredPaths = manifest.files.map((file) => file.path)
  const actualPaths = payloadEntries.map(([relativePath]) => relativePath)
  if (!sameStrings(declaredPaths, actualPaths)) {
    throw new Error(
      'Internal overlay manifest must declare every payload file exactly once.'
    )
  }

  const payload = new Map()
  for (let index = 0; index < payloadEntries.length; index += 1) {
    const [relativePath, entry] = payloadEntries[index]
    validatePayloadPath(relativePath)
    const content = await entry.async('nodebuffer')
    rejectSecretContent(relativePath, content)
    const declared = manifest.files[index]
    if (content.length !== declared.size || sha256(content) !== declared.sha256) {
      throw new Error(`Internal overlay payload integrity mismatch for ${relativePath}.`)
    }
    payload.set(relativePath, content)
  }

  return Object.freeze({
    archiveRoot,
    files: Object.freeze([...payload.keys()]),
    manifest: Object.freeze(manifest),
    overlayId: manifest.overlayId,
    sha256: archiveSha256,
    version: manifest.version
  })
}

export async function installInternalOverlay(options) {
  const targetRoot = path.resolve(requireString(options?.targetRoot, 'targetRoot'))
  await requireDirectory(targetRoot, 'Internal overlay install targetRoot')
  const verified = await verifyInternalOverlay(options)
  const receiptPath = getReceiptPath(targetRoot, verified.overlayId)
  const existingReceipt = await readOptionalFile(receiptPath)

  if (existingReceipt !== null) {
    const receipt = parseAndValidateReceipt(existingReceipt, receiptPath)
    if (receipt.archiveSha256 !== verified.sha256 ||
        receipt.overlayId !== verified.overlayId ||
        receipt.version !== verified.version) {
      throw new Error(
        `Internal overlay install conflict: receipt already exists at ${receiptPath}.`
      )
    }
    const state = await inspectInstalledFiles(targetRoot, receipt.files)
    if (state.modified.length > 0 || state.missing.length > 0) {
      throw new Error(
        `Internal overlay receipt exists but installed files do not match: ${[
          ...state.modified,
          ...state.missing
        ].join(', ')}.`
      )
    }
    return Object.freeze({
      changed: false,
      files: Object.freeze(verified.files),
      overlayId: verified.overlayId,
      receiptPath,
      sha256: verified.sha256,
      status: 'already-installed',
      version: verified.version
    })
  }

  const payload = await readVerifiedPayload(options, verified)
  await preflightInstall(targetRoot, verified.manifest.files, receiptPath)
  const receipt = {
    archiveSha256: verified.sha256,
    files: verified.manifest.files,
    overlayId: verified.overlayId,
    schemaVersion: 1,
    version: verified.version
  }
  const createdFiles = []
  try {
    for (const file of verified.manifest.files) {
      const destination = resolveContainedPath(targetRoot, file.path)
      const existing = await readOptionalRegularFile(destination, file.path)
      if (existing !== null) continue
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, payload.get(file.path), {
        flag: 'wx',
        mode: 0o644
      })
      createdFiles.push(destination)
    }
    await mkdir(path.dirname(receiptPath), { recursive: true })
    await writeFile(receiptPath, canonicalJson(receipt), {
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    await Promise.all(createdFiles.map((file) => unlink(file).catch(() => undefined)))
    throw error
  }

  return Object.freeze({
    changed: true,
    files: Object.freeze(verified.files),
    overlayId: verified.overlayId,
    receiptPath,
    sha256: verified.sha256,
    status: 'installed',
    version: verified.version
  })
}

export async function runInternalOverlayCli(argv) {
  if (!Array.isArray(argv)) {
    throw new Error('Internal overlay CLI argv must be an array.')
  }
  const [command, ...rawOptions] = argv
  const options = parseCliOptions(rawOptions)
  if (command === 'pack') {
    assertAllowedCliOptions(options, [
      '--id',
      '--output',
      '--prefix',
      '--source',
      '--version'
    ])
    return packInternalOverlay({
      sourceDir: requireCliOption(options, '--source'),
      payloadPrefix: options.get('--prefix'),
      outputFile: requireCliOption(options, '--output'),
      overlayId: requireCliOption(options, '--id'),
      version: requireCliOption(options, '--version')
    })
  }
  if (command === 'verify') {
    assertAllowedCliOptions(options, ['--archive', '--sha256', '--sidecar'])
    return verifyInternalOverlay({
      archivePath: requireCliOption(options, '--archive'),
      expectedSha256: options.get('--sha256'),
      sidecarPath: options.get('--sidecar')
    })
  }
  if (command === 'install') {
    assertAllowedCliOptions(options, [
      '--archive',
      '--sha256',
      '--sidecar',
      '--target'
    ])
    return installInternalOverlay({
      archivePath: requireCliOption(options, '--archive'),
      expectedSha256: options.get('--sha256'),
      sidecarPath: options.get('--sidecar'),
      targetRoot: requireCliOption(options, '--target')
    })
  }
  throw new Error(
    'Usage: internal-overlay-package.mjs <pack|verify|install> [options]'
  )
}

async function readVerifiedPayload(options, verified) {
  const { archiveBytes } = await readArchive(options)
  const archive = await JSZip.loadAsync(archiveBytes, {
    checkCRC32: true,
    createFolders: false
  })
  const payload = new Map()
  for (const relativePath of verified.files) {
    const entryPath = `${verified.archiveRoot}/payload/${relativePath}`
    const entry = archive.file(entryPath)
    if (!entry) {
      throw new Error(`Internal overlay archive lost verified entry ${entryPath}.`)
    }
    payload.set(relativePath, await entry.async('nodebuffer'))
  }
  return payload
}

async function preflightInstall(targetRoot, files, receiptPath) {
  await assertSafeDestinationParents(targetRoot, receiptPath)
  for (const file of files) {
    const destination = resolveContainedPath(targetRoot, file.path)
    await assertSafeDestinationParents(targetRoot, destination)
    const existing = await readOptionalRegularFile(destination, file.path)
    if (existing !== null && sha256(existing) !== file.sha256) {
      throw new Error(`Internal overlay install conflict at ${file.path}.`)
    }
  }
}

async function inspectInstalledFiles(targetRoot, files) {
  const missing = []
  const modified = []
  const matching = []
  for (const file of files) {
    const destination = resolveContainedPath(targetRoot, file.path)
    const content = await readOptionalRegularFile(destination, file.path)
    if (content === null) missing.push(file.path)
    else if (sha256(content) !== file.sha256) modified.push(file.path)
    else matching.push(file.path)
  }
  return { matching, missing, modified }
}

async function assertSafeDestinationParents(targetRoot, destination) {
  const relative = path.relative(targetRoot, path.dirname(destination))
  if (relative === '') return
  let current = targetRoot
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = await lstat(current).catch(() => null)
    if (stats?.isSymbolicLink()) {
      throw new Error(`Internal overlay install path contains symlink ${current}.`)
    }
    if (stats && !stats.isDirectory()) {
      throw new Error(`Internal overlay install path parent is not a directory: ${current}.`)
    }
  }
}

async function readOptionalRegularFile(absolutePath, label) {
  const stats = await lstat(absolutePath).catch(() => null)
  if (stats === null) return null
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Internal overlay install conflict at ${label}.`)
  }
  return readFile(absolutePath)
}

async function readOptionalFile(absolutePath) {
  const stats = await lstat(absolutePath).catch(() => null)
  if (stats === null) return null
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Internal overlay receipt must be a regular file: ${absolutePath}.`)
  }
  return readFile(absolutePath)
}

function parseAndValidateReceipt(bytes, receiptPath) {
  const receipt = parseJson(bytes, receiptPath)
  if (bytes.toString('utf8') !== canonicalJson(receipt)) {
    throw new Error(`Internal overlay receipt is not canonical: ${receiptPath}.`)
  }
  if (!isPlainObject(receipt) || receipt.schemaVersion !== 1) {
    throw new Error(`Internal overlay receipt schema is invalid: ${receiptPath}.`)
  }
  validateIdentity(receipt.overlayId, 'receipt overlayId')
  validateVersion(receipt.version)
  validateSha256(receipt.archiveSha256, 'receipt archiveSha256')
  validateManifest({
    files: receipt.files,
    overlayId: receipt.overlayId,
    schemaVersion: 1,
    version: receipt.version
  })
  return receipt
}

function getReceiptPath(targetRoot, overlayId) {
  return resolveContainedPath(
    targetRoot,
    `.sciforge/internal-overlays/${overlayId}.json`
  )
}

function resolveContainedPath(root, relativePath) {
  validateRelativePosixPath(relativePath, 'install path')
  const resolved = path.resolve(root, ...relativePath.split('/'))
  const prefix = `${root}${path.sep}`
  if (!resolved.startsWith(prefix)) {
    throw new Error(`Unsafe internal overlay install path: ${relativePath}`)
  }
  return resolved
}

async function requireDirectory(absolutePath, label) {
  const stats = await lstat(absolutePath).catch(() => null)
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory: ${absolutePath}.`)
  }
}

async function collectSourceFiles(sourceDir) {
  const rootStats = await lstat(sourceDir).catch(() => null)
  if (!rootStats?.isDirectory()) {
    throw new Error(`Internal overlay source is not a directory: ${sourceDir}`)
  }
  const files = new Map()
  const caseFoldedPaths = new Map()
  await visit(sourceDir, [])
  return new Map([...files].sort(([left], [right]) => compareStrings(left, right)))

  async function visit(absoluteDir, segments) {
    const entries = await readdir(absoluteDir, { withFileTypes: true })
    entries.sort((left, right) => compareStrings(left.name, right.name))
    for (const entry of entries) {
      const relativeSegments = [...segments, entry.name]
      const relativePath = relativeSegments.join('/')
      const absolutePath = path.join(absoluteDir, entry.name)
      const stats = await lstat(absolutePath)
      if (stats.isSymbolicLink()) {
        continue
      }
      if (stats.isDirectory() && isDisposableDirectory(entry.name)) {
        continue
      }
      if (stats.isFile() && isDisposableFile(entry.name)) {
        continue
      }
      validatePayloadPath(relativePath, { directory: stats.isDirectory() })
      assertNoCaseCollision(relativePath, caseFoldedPaths)
      if (stats.isDirectory()) {
        await visit(absolutePath, relativeSegments)
      } else if (stats.isFile()) {
        const content = await readFile(absolutePath)
        rejectSecretContent(relativePath, content)
        files.set(relativePath, content)
      } else {
        throw new Error(
          `Internal overlay source must contain only regular files and directories: ${relativePath}.`
        )
      }
    }
  }
}

function normalizePayloadPrefix(value) {
  if (value === undefined || value === '') return ''
  const prefix = requireString(value, 'payloadPrefix')
  validatePayloadPath(prefix, { directory: true })
  return prefix
}

async function readArchive(options) {
  if (options?.archiveBytes !== undefined) {
    if (options?.archivePath !== undefined) {
      throw new Error('Provide archiveBytes or archivePath, not both.')
    }
    return {
      archiveBytes: Buffer.from(options.archiveBytes),
      archivePath: null
    }
  }
  const archivePath = path.resolve(requireString(options?.archivePath, 'archivePath'))
  return { archiveBytes: await readFile(archivePath), archivePath }
}

async function verifyArchiveSidecar({
  archivePath,
  archiveSha256,
  expectedSha256,
  sidecarPath
}) {
  if (expectedSha256 !== undefined) {
    validateSha256(expectedSha256, 'expectedSha256')
    if (expectedSha256 !== archiveSha256) {
      throw new Error('Internal overlay archive SHA-256 does not match expectedSha256.')
    }
  }
  if (!archivePath && !sidecarPath) {
    if (expectedSha256 === undefined) {
      throw new Error('archiveBytes verification requires expectedSha256 or sidecarPath.')
    }
    return
  }
  const resolvedSidecar = path.resolve(sidecarPath ?? `${archivePath}.sha256`)
  const value = await readFile(resolvedSidecar, 'utf8').catch(() => null)
  if (value === null) {
    throw new Error(`Internal overlay SHA-256 sidecar is missing: ${resolvedSidecar}`)
  }
  const match = value.match(/^([a-f0-9]{64}) {2}([^\r\n]+)\n$/)
  if (!match) {
    throw new Error('Internal overlay SHA-256 sidecar has invalid format.')
  }
  if (match[1] !== archiveSha256) {
    throw new Error('Internal overlay archive SHA-256 does not match sidecar.')
  }
  if (archivePath && match[2] !== path.basename(archivePath)) {
    throw new Error('Internal overlay SHA-256 sidecar names a different archive.')
  }
}

function validateArchiveEntries(archive) {
  const entries = new Map()
  const caseFoldedPaths = new Map()
  for (const entry of Object.values(archive.files)) {
    const originalPath = entry.unsafeOriginalName ?? entry.name
    validateArchivePath(originalPath)
    if (entry.dir || entry.name.endsWith('/')) {
      throw new Error(`Internal overlay archive must not contain directory entry ${originalPath}.`)
    }
    const mode = normalizeUnixMode(entry.unixPermissions)
    if ((mode & 0o170000) === 0o120000) {
      throw new Error(`Internal overlay archive must not contain symlink ${originalPath}.`)
    }
    assertNoCaseCollision(originalPath, caseFoldedPaths)
    entries.set(originalPath, entry)
  }
  return entries
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1) {
    throw new Error('Internal overlay manifest schemaVersion must be 1.')
  }
  validateIdentity(manifest.overlayId, 'manifest overlayId')
  validateVersion(manifest.version)
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Internal overlay manifest files must be a non-empty array.')
  }
  const paths = []
  const caseFoldedPaths = new Map()
  for (const file of manifest.files) {
    if (!isPlainObject(file)) {
      throw new Error('Internal overlay manifest contains an invalid file record.')
    }
    validatePayloadPath(file.path)
    assertNoCaseCollision(file.path, caseFoldedPaths)
    validateSha256(file.sha256, `manifest hash for ${file.path}`)
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Internal overlay manifest size is invalid for ${file.path}.`)
    }
    paths.push(file.path)
  }
  const sorted = [...paths].sort(compareStrings)
  if (!sameStrings(paths, sorted)) {
    throw new Error('Internal overlay manifest files must be canonically sorted.')
  }
}

function validatePayloadPath(relativePath, options = {}) {
  validateRelativePosixPath(relativePath, 'payload path')
  const segments = relativePath.split('/')
  const lowerSegments = segments.map((segment) => segment.toLocaleLowerCase('en-US'))
  const forbiddenDirectory = lowerSegments.find((segment) =>
    FORBIDDEN_DIRECTORIES.has(segment)
  )
  if (forbiddenDirectory) {
    throw new Error(
      `Internal overlay must not contain forbidden directory ${forbiddenDirectory}: ${relativePath}.`
    )
  }
  if (!options.directory) {
    rejectForbiddenFileName(relativePath)
  }
}

function validateArchivePath(entryPath) {
  validateRelativePosixPath(entryPath, 'archive entry')
}

function validateRelativePosixPath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`Internal overlay ${label} must be a non-empty string.`)
  }
  if (relativePath.includes('\\') || relativePath.includes('\0') ||
      relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`Unsafe internal overlay ${label}: ${relativePath}`)
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe internal overlay ${label}: ${relativePath}`)
  }
}

function rejectForbiddenFileName(relativePath) {
  const basename = relativePath.split('/').at(-1)
  const lower = basename.toLocaleLowerCase('en-US')
  if ((lower === '.env' || lower.startsWith('.env.')) &&
      !ENV_TEMPLATE_NAMES.has(lower)) {
    throw new Error(`Internal overlay must not contain real environment file ${relativePath}.`)
  }
  if (FORBIDDEN_FILE_NAMES.has(lower) || FORBIDDEN_SECRET_EXTENSIONS.has(path.extname(lower))) {
    throw new Error(`Internal overlay must not contain secret-bearing file ${relativePath}.`)
  }
  if (FORBIDDEN_CACHE_FILE_PATTERNS.some((pattern) => pattern.test(lower))) {
    throw new Error(`Internal overlay must not contain cache or log file ${relativePath}.`)
  }
}

function rejectSecretContent(relativePath, content) {
  if (content.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')) ||
      content.includes(Buffer.from('-----BEGIN ENCRYPTED PRIVATE KEY-----')) ||
      content.includes(Buffer.from('-----BEGIN RSA PRIVATE KEY-----')) ||
      content.includes(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'))) {
    throw new Error(`Internal overlay must not contain private key material in ${relativePath}.`)
  }
  const text = content.length <= 2_000_000 ? content.toString('utf8') : ''
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) {
    throw new Error(`Internal overlay must not contain an AWS access key in ${relativePath}.`)
  }
}

function isDisposableDirectory(name) {
  return FORBIDDEN_DIRECTORIES.has(name.toLocaleLowerCase('en-US'))
}

function isDisposableFile(name) {
  const lower = name.toLocaleLowerCase('en-US')
  return FORBIDDEN_CACHE_FILE_PATTERNS.some((pattern) => pattern.test(lower))
}

function assertNoCaseCollision(relativePath, seen) {
  const folded = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
  const prior = seen.get(folded)
  if (prior !== undefined && prior !== relativePath) {
    throw new Error(
      `Internal overlay contains case-colliding paths ${prior} and ${relativePath}.`
    )
  }
  seen.set(folded, relativePath)
}

function addArchiveFile(archive, entryPath, content) {
  archive.file(entryPath, content, {
    binary: true,
    createFolders: false,
    date: FIXED_ARCHIVE_DATE,
    unixPermissions: 0o100644
  })
}

function validateArchiveRoot(archiveRoot) {
  validateRelativePosixPath(archiveRoot, 'archive root')
  if (archiveRoot.includes('/')) {
    throw new Error('Internal overlay archive root must be one directory.')
  }
}

function validateIdentity(value, label) {
  const identity = requireString(value, label)
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(identity)) {
    throw new Error(`${label} must be a lowercase filesystem-safe identity.`)
  }
  return identity
}

function validateVersion(value) {
  const version = requireString(value, 'version')
  if (!/^[0-9A-Za-z](?:[0-9A-Za-z.+_-]{0,126}[0-9A-Za-z])?$/.test(version)) {
    throw new Error('version must be a filesystem-safe version.')
  }
  return version
}

function validateSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`)
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`Internal overlay ${label} is not valid JSON: ${error.message}`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isPlainObject(value)) {
    const result = {}
    for (const key of Object.keys(value).sort(compareStrings)) {
      result[key] = canonicalize(value[key])
    }
    return result
  }
  return value
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeUnixMode(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^[0-7]+$/.test(value)) return Number.parseInt(value, 8)
  return 0o100644
}

function parseCliOptions(args) {
  if (args.length % 2 !== 0) {
    throw new Error(`Internal overlay CLI option has no value: ${args.at(-1)}`)
  }
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (typeof name !== 'string' || !/^--[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid internal overlay CLI option: ${name}`)
    }
    if (options.has(name)) {
      throw new Error(`Duplicate internal overlay CLI option: ${name}`)
    }
    options.set(name, requireString(value, `CLI option ${name}`))
  }
  return options
}

function assertAllowedCliOptions(options, allowed) {
  const allowedNames = new Set(allowed)
  for (const name of options.keys()) {
    if (!allowedNames.has(name)) {
      throw new Error(`Unknown internal overlay CLI option: ${name}`)
    }
  }
}

function requireCliOption(options, name) {
  if (!options.has(name)) {
    throw new Error(`Missing required internal overlay CLI option: ${name}`)
  }
  return options.get(name)
}

const FORBIDDEN_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  '.vite',
  'cache',
  'coverage',
  'dist',
  'logs',
  'node_modules'
])
const ENV_TEMPLATE_NAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template'
])
const FORBIDDEN_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'secrets.json',
  'token.json',
  'tokens.json'
])
const FORBIDDEN_SECRET_EXTENSIONS = new Set([
  '.jks',
  '.key',
  '.keystore',
  '.p12',
  '.pem',
  '.pfx'
])
const FORBIDDEN_CACHE_FILE_PATTERNS = [
  /^\.DS_Store$/i,
  /(?:^|[.-])debug\.log$/i,
  /\.log$/i,
  /\.pyc$/i,
  /~$/
]

if (process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runInternalOverlayCli(process.argv.slice(2))
    process.stdout.write(`${canonicalJson(result)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
