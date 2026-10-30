#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes
} from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import JSZip from 'jszip'
import { tsImport } from 'tsx/esm/api'

export const EXTENSION_PACKAGE_SUFFIX = '.sciforge-plugin'
export const INTEGRITY_PATH = 'META-INF/sciforge-integrity.json'
export const SIGNATURE_PATH = 'META-INF/sciforge-signature.json'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXED_ARCHIVE_DATE = new Date('1980-01-01T00:00:00.000Z')
const REQUIRED_PAYLOAD_PATHS = Object.freeze([
  'package.json',
  'sciforge.domain.json'
])
const RESERVED_PAYLOAD_PREFIX = 'META-INF/'
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  '.yarn',
  'coverage',
  'node_modules'
])
const IGNORED_FILES = new Set([
  '.DS_Store',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log'
])
const PRIVATE_KEY_FILE_NAMES = new Set([
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa'
])
const PRIVATE_KEY_FILE_EXTENSIONS = new Set([
  '.jks',
  '.key',
  '.keystore',
  '.p12',
  '.pfx'
])
const PRIVATE_KEY_MARKERS = Object.freeze([
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----'
])
const FORBIDDEN_INSTALL_SCRIPTS = new Set([
  'install',
  'postinstall',
  'postpublish',
  'preinstall',
  'prepare',
  'prepublish',
  'prepublishOnly'
])

/**
 * Return the canonical UTF-8 JSON representation used for signed metadata.
 * Object keys are recursively ordered by Unicode code point; arrays retain order.
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

/**
 * Build a deterministic, detached-Ed25519-signed SciForge plugin archive.
 */
export async function packExtensionPackage(options) {
  const sourceDir = path.resolve(requireNonEmptyString(options?.sourceDir, 'sourceDir'))
  const outputFile = path.resolve(requireNonEmptyString(options?.outputFile, 'outputFile'))
  if (!outputFile.endsWith(EXTENSION_PACKAGE_SUFFIX)) {
    throw new Error(`Plugin output must end in ${EXTENSION_PACKAGE_SUFFIX}.`)
  }
  const publisherId = validateIdentity(options?.publisherId, 'publisherId')
  const keyId = validateIdentity(options?.keyId, 'keyId')
  const privateKey = parseEd25519PrivateKey(options?.privateKey)

  const files = await collectPackagePayload(sourceDir)
  const packageJson = parseJsonBuffer(files.get('package.json'), 'package.json')
  const domainManifest = parseJsonBuffer(
    files.get('sciforge.domain.json'),
    'sciforge.domain.json'
  )
  const definition = await validatePackageMetadata({
    packageJson,
    domainManifest,
    expectedPublisherId: publisherId
  })
  validateRuntimeEntrypoints(definition, files)

  const integrityFiles = {}
  for (const [relativePath, content] of files) {
    integrityFiles[relativePath] = sha256(content)
  }
  const integrity = {
    schemaVersion: 1,
    packageName: packageJson.name,
    version: packageJson.version,
    publisherId,
    files: integrityFiles
  }
  const integrityBytes = Buffer.from(canonicalJson(integrity))
  const signature = signBytes(null, integrityBytes, privateKey)
  const signatureMetadata = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId,
    signature: signature.toString('base64')
  }

  const archive = new JSZip()
  for (const [relativePath, content] of files) {
    addDeterministicArchiveFile(archive, relativePath, content)
  }
  addDeterministicArchiveFile(archive, INTEGRITY_PATH, integrityBytes)
  addDeterministicArchiveFile(
    archive,
    SIGNATURE_PATH,
    Buffer.from(canonicalJson(signatureMetadata))
  )
  const archiveBytes = await archive.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })

  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, archiveBytes, { mode: 0o644 })
  return Object.freeze({
    outputFile,
    packageName: packageJson.name,
    version: packageJson.version,
    publisherId,
    keyId,
    fileCount: files.size,
    sha256: sha256(archiveBytes)
  })
}

/**
 * Verify archive structure, complete payload integrity, identity binding, and signature.
 */
export async function verifyExtensionPackage(options) {
  const archiveBytes = await readArchiveBytes(options)
  const archive = await JSZip.loadAsync(archiveBytes, {
    checkCRC32: true,
    createFolders: false
  })
  const entries = validateArchiveEntries(archive)
  const integrityEntry = requireArchiveEntry(entries, INTEGRITY_PATH)
  const signatureEntry = requireArchiveEntry(entries, SIGNATURE_PATH)
  const integrityBytes = await integrityEntry.async('nodebuffer')
  const signatureBytes = await signatureEntry.async('nodebuffer')
  const integrity = parseJsonBuffer(integrityBytes, INTEGRITY_PATH)
  const signatureMetadata = parseJsonBuffer(signatureBytes, SIGNATURE_PATH)

  validateCanonicalMetadata(integrity, integrityBytes, INTEGRITY_PATH)
  validateCanonicalMetadata(signatureMetadata, signatureBytes, SIGNATURE_PATH)
  validateIntegrityMetadata(integrity)
  validateSignatureMetadata(signatureMetadata)
  if (options?.expectedKeyId !== undefined &&
      signatureMetadata.keyId !== options.expectedKeyId) {
    throw new Error(
      `Plugin signature keyId ${signatureMetadata.keyId} does not match expected keyId ${options.expectedKeyId}.`
    )
  }
  if (options?.expectedPublisherId !== undefined &&
      integrity.publisherId !== options.expectedPublisherId) {
    throw new Error(
      `Plugin publisher ${integrity.publisherId} does not match expected publisher ${options.expectedPublisherId}.`
    )
  }

  const publicKey = parseEd25519PublicKey(options?.publicKey)
  const signature = decodeBase64(signatureMetadata.signature, 'Plugin signature')
  if (!verifyBytes(null, integrityBytes, publicKey, signature)) {
    throw new Error('Plugin Ed25519 signature verification failed.')
  }

  const payloadEntries = [...entries.entries()]
    .filter(([relativePath]) =>
      relativePath !== INTEGRITY_PATH && relativePath !== SIGNATURE_PATH
    )
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
  const declaredPaths = Object.keys(integrity.files)
  const payloadPaths = payloadEntries.map(([relativePath]) => relativePath)
  if (!sameStringArray(declaredPaths, payloadPaths)) {
    throw new Error(
      'Plugin integrity manifest must list every payload file exactly once and no metadata files.'
    )
  }

  const payload = new Map()
  for (const [relativePath, entry] of payloadEntries) {
    rejectForbiddenPayloadPath(relativePath)
    const content = await entry.async('nodebuffer')
    rejectPrivateKeyMaterial(relativePath, content)
    const actualHash = sha256(content)
    if (actualHash !== integrity.files[relativePath]) {
      throw new Error(`Plugin payload integrity mismatch for ${relativePath}.`)
    }
    payload.set(relativePath, content)
  }

  for (const requiredPath of REQUIRED_PAYLOAD_PATHS) {
    if (!payload.has(requiredPath)) {
      throw new Error(`Plugin archive is missing required payload ${requiredPath}.`)
    }
  }
  validatePayloadPackageManifests(payload)
  const packageJson = parseJsonBuffer(payload.get('package.json'), 'package.json')
  const domainManifest = parseJsonBuffer(
    payload.get('sciforge.domain.json'),
    'sciforge.domain.json'
  )
  const definition = await validatePackageMetadata({
    packageJson,
    domainManifest,
    expectedPublisherId: integrity.publisherId
  })
  validateRuntimeEntrypoints(definition, payload)
  if (packageJson.name !== integrity.packageName ||
      packageJson.version !== integrity.version) {
    throw new Error('Plugin integrity identity does not match package.json.')
  }

  return Object.freeze({
    packageName: integrity.packageName,
    version: integrity.version,
    publisherId: integrity.publisherId,
    keyId: signatureMetadata.keyId,
    files: Object.freeze([...payloadPaths]),
    integrity: Object.freeze(integrity),
    packageJson: Object.freeze(packageJson),
    domainManifest: Object.freeze(domainManifest),
    sha256: sha256(archiveBytes)
  })
}

async function collectPackagePayload(sourceDir) {
  const sourceStats = await lstat(sourceDir).catch(() => null)
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Plugin source is not a directory: ${sourceDir}`)
  }

  const packageJsonPath = path.join(sourceDir, 'package.json')
  const packageJsonBytes = await readFile(packageJsonPath).catch(() => null)
  if (!packageJsonBytes) {
    throw new Error('Plugin source is missing package.json.')
  }
  const packageJson = parseJsonBuffer(packageJsonBytes, packageJsonPath)
  validateNoInstallHooks(packageJson)
  const patterns = validatePackageFilePatterns(packageJson.files)

  const selected = new Map()
  await visitSourceDirectory(sourceDir, sourceDir, patterns, selected)
  for (const requiredPath of REQUIRED_PAYLOAD_PATHS) {
    if (!selected.has(requiredPath)) {
      const absolutePath = path.join(sourceDir, requiredPath)
      const content = await readRequiredRegularFile(absolutePath, requiredPath)
      rejectPrivateKeyMaterial(requiredPath, content)
      selected.set(requiredPath, content)
    }
  }
  const sorted = new Map([...selected.entries()].sort(([left], [right]) =>
    compareCanonicalStrings(left, right)
  ))
  validatePortablePayloadPaths([...sorted.keys()])
  validatePayloadPackageManifests(sorted)
  return sorted
}

async function visitSourceDirectory(sourceDir, currentDir, patterns, selected) {
  const entries = await readdir(currentDir, { withFileTypes: true })
  entries.sort((left, right) => compareCanonicalStrings(left.name, right.name))
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    const relativePath = toArchivePath(path.relative(sourceDir, absolutePath))
    if (entry.isSymbolicLink()) {
      if (shouldIncludePath(relativePath, patterns, true)) {
        throw new Error(`Plugin payload must not contain symlink ${relativePath}.`)
      }
      continue
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) ||
          relativePath === 'META-INF' ||
          relativePath.startsWith(RESERVED_PAYLOAD_PREFIX)) {
        continue
      }
      if (shouldTraverseDirectory(relativePath, patterns)) {
        await visitSourceDirectory(sourceDir, absolutePath, patterns, selected)
      }
      continue
    }
    if (!entry.isFile()) {
      if (shouldIncludePath(relativePath, patterns, false)) {
        throw new Error(`Plugin payload path is not a regular file: ${relativePath}.`)
      }
      continue
    }
    if (!shouldIncludePath(relativePath, patterns, false)) continue
    rejectForbiddenPayloadPath(relativePath)
    const content = await readFile(absolutePath)
    rejectPrivateKeyMaterial(relativePath, content)
    selected.set(relativePath, content)
  }
}

function validatePackageFilePatterns(value) {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error(
      'Plugin package.json must provide a non-empty files array as its runtime payload allowlist.'
    )
  }
  return value.map((entry) => {
    const pattern = toArchivePath(entry.trim().replace(/\/+$/, ''))
    if (pattern.startsWith('!')) {
      throw new Error('Plugin package.json files does not support negated patterns.')
    }
    validateSafeArchivePath(pattern, 'package.json files entry')
    if (pattern === 'META-INF' || pattern.startsWith(RESERVED_PAYLOAD_PREFIX)) {
      throw new Error('Plugin package.json files must not select reserved META-INF metadata.')
    }
    if (pattern === 'node_modules' || pattern.startsWith('node_modules/')) {
      throw new Error('Plugin package.json files must not select node_modules.')
    }
    return pattern
  })
}

function shouldIncludePath(relativePath, patterns, isDirectory) {
  if (REQUIRED_PAYLOAD_PATHS.includes(relativePath)) return true
  if (IGNORED_FILES.has(path.posix.basename(relativePath))) return false
  if (isJunkPath(relativePath)) return false
  return patterns.some((pattern) => matchesPayloadPattern(relativePath, pattern, isDirectory))
}

function shouldTraverseDirectory(relativePath, patterns) {
  return patterns.some((pattern) =>
    pattern === relativePath ||
    pattern.startsWith(`${relativePath}/`) ||
    relativePath.startsWith(`${literalPatternPrefix(pattern)}/`) ||
    path.matchesGlob(relativePath, pattern) ||
    path.matchesGlob(`${relativePath}/placeholder`, pattern)
  )
}

function matchesPayloadPattern(relativePath, pattern, isDirectory) {
  if (relativePath === pattern || relativePath.startsWith(`${pattern}/`)) return true
  if (isDirectory) return false
  return path.matchesGlob(relativePath, pattern)
}

function literalPatternPrefix(pattern) {
  const wildcardIndex = pattern.search(/[*?[\]{}()!]/)
  const prefix = wildcardIndex < 0 ? pattern : pattern.slice(0, wildcardIndex)
  return prefix.replace(/\/+$/, '')
}

function isJunkPath(relativePath) {
  const segments = relativePath.split('/')
  return segments.some((segment) => IGNORED_DIRECTORIES.has(segment)) ||
    segments.some((segment) => IGNORED_FILES.has(segment)) ||
    relativePath.endsWith('.log') ||
    relativePath.endsWith('.tmp')
}

function rejectForbiddenPayloadPath(relativePath) {
  validateSafeArchivePath(relativePath, 'plugin payload path')
  if (relativePath === 'META-INF' || relativePath.startsWith(RESERVED_PAYLOAD_PREFIX)) {
    throw new Error(`Plugin payload must not use reserved path ${relativePath}.`)
  }
  if (isJunkPath(relativePath)) {
    throw new Error(`Plugin payload must not contain generated or dependency junk ${relativePath}.`)
  }
}

function rejectPrivateKeyMaterial(relativePath, content) {
  const baseName = path.posix.basename(relativePath).toLowerCase()
  const extension = path.posix.extname(baseName)
  if (PRIVATE_KEY_FILE_NAMES.has(baseName) ||
      PRIVATE_KEY_FILE_EXTENSIONS.has(extension) ||
      /(?:^|[._-])private[._-]?key(?:[._-]|$)/i.test(baseName)) {
    throw new Error(`Plugin payload must not contain private key file ${relativePath}.`)
  }
  const prefix = content.subarray(0, 64 * 1024).toString('utf8')
  if (PRIVATE_KEY_MARKERS.some((marker) => prefix.includes(marker))) {
    throw new Error(`Plugin payload must not contain private key material in ${relativePath}.`)
  }
}

async function validatePackageMetadata({
  packageJson,
  domainManifest,
  expectedPublisherId
}) {
  if (!isRecord(packageJson)) throw new Error('package.json must contain an object.')
  const packageName = validateIdentity(packageJson.name, 'package.json name', {
    allowScope: true
  })
  validateVersion(packageJson.version, 'package.json version')
  validateNoInstallHooks(packageJson)
  if (!isRecord(domainManifest)) {
    throw new Error('sciforge.domain.json must contain an object.')
  }
  if (domainManifest.packageName !== packageName) {
    throw new Error('sciforge.domain.json packageName must match package.json name.')
  }
  const definition = await parseDomainPackageDefinition(domainManifest)
  if (definition.kind !== 'sandboxed-runtime') {
    throw new Error(
      'Installable plugin sciforge.domain.json kind must be sandboxed-runtime.'
    )
  }
  if (definition.publisher.id !== expectedPublisherId) {
    throw new Error(
      'Plugin manifest publisher.id must match the signed integrity publisherId.'
    )
  }
  if (definition.module.version !== packageJson.version) {
    throw new Error(
      'Plugin manifest module.version must match package.json version.'
    )
  }
  return definition
}

let definitionParserPromise

async function parseDomainPackageDefinition(value) {
  try {
    definitionParserPromise ??= loadDomainDefinitionParser()
    const parseDefinition = await definitionParserPromise
    return parseDefinition(value)
  } catch (error) {
    throw new Error(`Invalid sandboxed plugin manifest: ${error.message}`)
  }
}

async function loadDomainDefinitionParser() {
  const contractPath = path.join(ROOT, 'packages/domain-sdk/src/contract.ts')
  const contract = await tsImport(pathToFileURL(contractPath).href, {
    parentURL: import.meta.url
  })
  if (typeof contract.defineDomainPackage !== 'function') {
    throw new Error('Domain SDK does not export defineDomainPackage.')
  }
  return contract.defineDomainPackage
}

function validateRuntimeEntrypoints(definition, payload) {
  for (const entrypoint of definition.entrypoints) {
    if (!payload.has(entrypoint.entry)) {
      throw new Error(
        `Plugin runtime entrypoint ${entrypoint.entry} is not selected by package.json files.`
      )
    }
  }
}

function validateNoInstallHooks(packageJson) {
  if (!isRecord(packageJson.scripts)) return
  const forbidden = Object.keys(packageJson.scripts)
    .filter((hook) => FORBIDDEN_INSTALL_SCRIPTS.has(hook))
    .sort(compareCanonicalStrings)
  if (forbidden.length > 0) {
    throw new Error(
      `Plugin package.json must not declare install lifecycle scripts: ${forbidden.join(', ')}.`
    )
  }
}

function validatePayloadPackageManifests(payload) {
  for (const [relativePath, content] of payload) {
    if (path.posix.basename(relativePath) !== 'package.json') continue
    const packageJson = parseJsonBuffer(content, relativePath)
    if (!isRecord(packageJson)) {
      throw new Error(`${relativePath} must contain an object.`)
    }
    validateNoInstallHooks(packageJson)
  }
}

function validateIntegrityMetadata(value) {
  assertExactKeys(
    value,
    ['files', 'packageName', 'publisherId', 'schemaVersion', 'version'],
    'Plugin integrity metadata'
  )
  if (value.schemaVersion !== 1) {
    throw new Error('Unsupported plugin integrity schemaVersion.')
  }
  validateIdentity(value.packageName, 'integrity packageName', { allowScope: true })
  validateVersion(value.version, 'integrity version')
  validateIdentity(value.publisherId, 'integrity publisherId')
  if (!isRecord(value.files)) {
    throw new Error('Plugin integrity files must be an object.')
  }
  const filePaths = Object.keys(value.files)
  const sortedPaths = [...filePaths].sort(compareCanonicalStrings)
  if (!sameStringArray(filePaths, sortedPaths)) {
    throw new Error('Plugin integrity file paths must be sorted.')
  }
  for (const relativePath of filePaths) {
    rejectForbiddenPayloadPath(relativePath)
    if (!/^[a-f0-9]{64}$/.test(value.files[relativePath])) {
      throw new Error(`Plugin integrity hash for ${relativePath} must be lowercase SHA-256 hex.`)
    }
  }
  validatePortablePayloadPaths(filePaths)
}

function validatePortablePayloadPaths(relativePaths) {
  const portablePaths = new Map()
  for (const relativePath of relativePaths) {
    const portablePath = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
    const previous = portablePaths.get(portablePath)
    if (previous !== undefined) {
      throw new Error(
        `Plugin payload paths conflict on case-insensitive filesystems: ${previous} and ${relativePath}.`
      )
    }
    portablePaths.set(portablePath, relativePath)
  }
}

function validateSignatureMetadata(value) {
  assertExactKeys(
    value,
    ['algorithm', 'keyId', 'schemaVersion', 'signature'],
    'Plugin signature metadata'
  )
  if (value.schemaVersion !== 1) {
    throw new Error('Unsupported plugin signature schemaVersion.')
  }
  if (value.algorithm !== 'ed25519') {
    throw new Error('Plugin signature algorithm must be ed25519.')
  }
  validateIdentity(value.keyId, 'signature keyId')
  if (decodeBase64(value.signature, 'Plugin signature').byteLength !== 64) {
    throw new Error('Plugin Ed25519 signature must contain exactly 64 bytes.')
  }
}

function validateCanonicalMetadata(value, bytes, label) {
  if (!Buffer.from(canonicalJson(value)).equals(bytes)) {
    throw new Error(`${label} must use canonical JSON encoding.`)
  }
}

function validateArchiveEntries(archive) {
  const entries = new Map()
  for (const [reportedPath, entry] of Object.entries(archive.files)) {
    const originalPath = entry.unsafeOriginalName ?? reportedPath
    if (originalPath !== reportedPath) {
      throw new Error(`Plugin archive contains unsafe path ${originalPath}.`)
    }
    validateSafeArchivePath(reportedPath, 'plugin archive path')
    if (entry.dir) {
      throw new Error(`Plugin archive must not contain directory entry ${reportedPath}.`)
    }
    if (isSymlinkArchiveEntry(entry)) {
      throw new Error(`Plugin archive must not contain symlink ${reportedPath}.`)
    }
    if (entries.has(reportedPath)) {
      throw new Error(`Plugin archive contains duplicate path ${reportedPath}.`)
    }
    if (reportedPath.startsWith(RESERVED_PAYLOAD_PREFIX) &&
        reportedPath !== INTEGRITY_PATH && reportedPath !== SIGNATURE_PATH) {
      throw new Error(`Plugin archive contains unexpected metadata ${reportedPath}.`)
    }
    entries.set(reportedPath, entry)
  }
  return entries
}

function isSymlinkArchiveEntry(entry) {
  if (typeof entry.unixPermissions !== 'number') return false
  return (entry.unixPermissions & 0o170000) === 0o120000
}

function requireArchiveEntry(entries, relativePath) {
  const entry = entries.get(relativePath)
  if (!entry) throw new Error(`Plugin archive is missing ${relativePath}.`)
  return entry
}

function addDeterministicArchiveFile(archive, relativePath, content) {
  archive.file(relativePath, content, {
    binary: true,
    createFolders: false,
    date: FIXED_ARCHIVE_DATE,
    unixPermissions: 0o100644
  })
}

function validateSafeArchivePath(value, label) {
  if (typeof value !== 'string' || value === '' ||
      value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Unsafe ${label}: ${String(value)}`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }
  if (path.posix.normalize(value) !== value) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }
}

function toArchivePath(value) {
  return value.split(path.sep).join('/')
}

async function readRequiredRegularFile(absolutePath, relativePath) {
  const stats = await lstat(absolutePath).catch(() => null)
  if (!stats) throw new Error(`Plugin source is missing ${relativePath}.`)
  if (stats.isSymbolicLink()) {
    throw new Error(`Plugin payload must not contain symlink ${relativePath}.`)
  }
  if (!stats.isFile()) {
    throw new Error(`Plugin payload path is not a regular file: ${relativePath}.`)
  }
  return readFile(absolutePath)
}

function parseJsonBuffer(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function parseEd25519PrivateKey(value) {
  if (value === undefined || value === null || value === '') {
    throw new Error('An Ed25519 private key is required.')
  }
  let key
  try {
    key = value?.type === 'private' ? value : createPrivateKey(value)
  } catch (error) {
    throw new Error(`Unable to parse plugin private key: ${error.message}`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Plugin private key must use Ed25519.')
  }
  return key
}

function parseEd25519PublicKey(value) {
  if (value === undefined || value === null || value === '') {
    throw new Error('An Ed25519 public key is required.')
  }
  let key
  try {
    key = value?.type === 'public' ? value : createPublicKey(value)
  } catch (error) {
    throw new Error(`Unable to parse plugin public key: ${error.message}`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Plugin public key must use Ed25519.')
  }
  return key
}

function validateIdentity(value, label, { allowScope = false } = {}) {
  const pattern = allowScope
    ? /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
    : /^[a-z0-9][a-z0-9._-]*$/
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} must be a canonical lowercase identifier.`)
  }
  return value
}

function validateVersion(value, label) {
  if (typeof value !== 'string' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} must be a semantic version.`)
  }
  return value
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required.`)
  }
  return value
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || value === '' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} must be canonical base64.`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new Error(`${label} must be canonical base64.`)
  }
  return decoded
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  if (!sameStringArray(actual, expected)) {
    throw new Error(`${label} has unsupported or missing properties.`)
  }
}

function sameStringArray(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

function compareCanonicalStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' ||
      typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Canonical JSON does not support non-finite numbers.')
    }
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) throw new Error('Canonical JSON only supports JSON values.')
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  )
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readArchiveBytes(options) {
  if (Buffer.isBuffer(options?.archiveBytes)) return options.archiveBytes
  if (options?.archiveBytes instanceof Uint8Array) {
    return Buffer.from(options.archiveBytes)
  }
  if (typeof options?.archivePath === 'string' && options.archivePath.trim() !== '') {
    return readFile(path.resolve(options.archivePath))
  }
  throw new Error('archivePath or archiveBytes is required.')
}

async function loadCliKey({ inlineValue, filePath, label }) {
  if (inlineValue && filePath) {
    throw new Error(`${label} must come from either an environment value or a key file, not both.`)
  }
  if (inlineValue) return inlineValue
  if (filePath) return readFile(path.resolve(filePath), 'utf8')
  throw new Error(`${label} is required.`)
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { command: 'help', options: {} }
  }
  const options = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}.`)
    const name = token.slice(2)
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate argument --${name}.`)
    options[name] = value
    index += 1
  }
  return { command, options }
}

async function runCli(argv) {
  const { command, options } = parseCliArguments(argv)
  if (command === 'help') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (command === 'pack') {
    assertCliOptions(options, [
      'key-id',
      'output',
      'private-key-file',
      'publisher-id',
      'source'
    ])
    const privateKey = await loadCliKey({
      inlineValue: process.env.SCIFORGE_PLUGIN_PRIVATE_KEY,
      filePath: options['private-key-file'] ??
        process.env.SCIFORGE_PLUGIN_PRIVATE_KEY_FILE,
      label: 'Plugin private key'
    })
    const result = await packExtensionPackage({
      sourceDir: options.source,
      outputFile: options.output,
      publisherId: options['publisher-id'] ??
        process.env.SCIFORGE_PLUGIN_PUBLISHER_ID,
      keyId: options['key-id'] ?? process.env.SCIFORGE_PLUGIN_KEY_ID,
      privateKey
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'verify') {
    assertCliOptions(options, [
      'archive',
      'key-id',
      'public-key-file',
      'publisher-id'
    ])
    const publicKey = await loadCliKey({
      inlineValue: process.env.SCIFORGE_PLUGIN_PUBLIC_KEY,
      filePath: options['public-key-file'] ??
        process.env.SCIFORGE_PLUGIN_PUBLIC_KEY_FILE,
      label: 'Plugin public key'
    })
    const result = await verifyExtensionPackage({
      archivePath: options.archive,
      publicKey,
      expectedKeyId: options['key-id'],
      expectedPublisherId: options['publisher-id']
    })
    process.stdout.write(`${JSON.stringify({
      packageName: result.packageName,
      version: result.version,
      publisherId: result.publisherId,
      keyId: result.keyId,
      files: result.files,
      sha256: result.sha256
    }, null, 2)}\n`)
    return
  }
  throw new Error(`Unknown command ${command}.\n${usage()}`)
}

function assertCliOptions(options, allowed) {
  const allowedOptions = new Set(allowed)
  const unsupported = Object.keys(options)
    .filter((name) => !allowedOptions.has(name))
    .sort(compareCanonicalStrings)
  if (unsupported.length > 0) {
    throw new Error(`Unsupported option(s): ${unsupported.map((name) => `--${name}`).join(', ')}.`)
  }
}

function usage() {
  return [
    'SciForge official plugin package tool',
    '',
    'Pack:',
    '  node scripts/extension-package.mjs pack --source <dir> --output <file.sciforge-plugin>',
    '    --publisher-id <id> --key-id <id> --private-key-file <ed25519-private.pem>',
    '',
    'Verify:',
    '  node scripts/extension-package.mjs verify --archive <file.sciforge-plugin>',
    '    --public-key-file <ed25519-public.pem> [--publisher-id <id>] [--key-id <id>]',
    '',
    'Key material may instead come from SCIFORGE_PLUGIN_PRIVATE_KEY /',
    'SCIFORGE_PLUGIN_PRIVATE_KEY_FILE and SCIFORGE_PLUGIN_PUBLIC_KEY /',
    'SCIFORGE_PLUGIN_PUBLIC_KEY_FILE. IDs may come from',
    'SCIFORGE_PLUGIN_PUBLISHER_ID and SCIFORGE_PLUGIN_KEY_ID.'
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`extension-package: ${error.message}\n`)
    process.exitCode = 1
  })
}
