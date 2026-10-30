const { createHash } = require('node:crypto')
const {
  lstatSync,
  readFileSync,
  readdirSync
} = require('node:fs')
const path = require('node:path')

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function digestInventory(manifest) {
  return sha256(Buffer.from(canonicalJson({
    files: manifest.files,
    overlayId: manifest.overlayId,
    overlayRoot: manifest.overlayRoot,
    version: manifest.version
  })))
}

function verifyInstalledInternalOverlaySync(options) {
  const targetRoot = path.resolve(requireString(options?.targetRoot, 'targetRoot'))
  const overlayId = validateIdentity(options?.overlayId, 'overlayId')
  const expectedOverlayRoot = validateOverlayRoot(options?.overlayRoot, 'overlayRoot')
  requireDirectory(targetRoot, 'Internal overlay verification targetRoot')
  const receiptPath = resolveContainedPath(
    targetRoot,
    `.sciforge/internal-overlays/${overlayId}.json`
  )
  assertSafeParents(targetRoot, receiptPath)
  const receiptStats = safeLstat(receiptPath)
  if (receiptStats === null) {
    throw new Error(`Internal overlay installation receipt is missing: ${receiptPath}.`)
  }
  if (receiptStats.isSymbolicLink() || !receiptStats.isFile()) {
    throw new Error(`Internal overlay receipt must be a regular file: ${receiptPath}.`)
  }
  const receipt = parseReceipt(readFileSync(receiptPath), receiptPath)
  if (receipt.overlayId !== overlayId) {
    throw new Error('Internal overlay receipt identity does not match the expected overlay.')
  }
  if (receipt.overlayRoot !== expectedOverlayRoot) {
    throw new Error('Internal overlay receipt overlay root does not match the expected root.')
  }

  const overlayRootPath = resolveContainedPath(targetRoot, receipt.overlayRoot)
  assertSafeParents(targetRoot, path.join(overlayRootPath, '.inventory'))
  verifyStaticFileInventory({
    inventory: receipt.files,
    label: 'Internal overlay installation',
    rootPath: overlayRootPath,
    rootPrefix: receipt.overlayRoot
  })

  return Object.freeze({
    archiveRoot: receipt.archiveRoot,
    archiveSha256: receipt.archiveSha256,
    fileCount: receipt.files.length,
    files: Object.freeze(receipt.files.map((file) => file.path)),
    inventory: freezeInventory(receipt.files),
    inventorySha256: receipt.inventorySha256,
    overlayId: receipt.overlayId,
    overlayRoot: receipt.overlayRoot,
    receiptPath,
    version: receipt.version
  })
}

function verifyStaticFileInventory(options) {
  const rootPath = path.resolve(requireString(options?.rootPath, 'rootPath'))
  const rootPrefix = options?.rootPrefix === undefined || options.rootPrefix === ''
    ? ''
    : validateRelativePath(options.rootPrefix, 'rootPrefix')
  const label = requireString(options?.label, 'label')
  const inventory = validateInventory(options?.inventory, rootPrefix, label)
  const actualInventory = createStaticFileInventory({ label, rootPath, rootPrefix })
  const expectedByPath = new Map(inventory.map((file) => [file.path, file]))
  const actualByPath = new Map(actualInventory.map((file) => [file.path, file]))
  const missing = [...expectedByPath.keys()].find((file) => !actualByPath.has(file))
  if (missing !== undefined) {
    throw new Error(`${label} has missing file ${missing}.`)
  }
  const extra = [...actualByPath.keys()].find((file) => !expectedByPath.has(file))
  if (extra !== undefined) {
    throw new Error(`${label} has unreceipted file ${extra}.`)
  }
  for (const [filePath, expected] of expectedByPath) {
    const actual = actualByPath.get(filePath)
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`${label} has changed file ${filePath}.`)
    }
  }
  return Object.freeze({ fileCount: inventory.length })
}

function createStaticFileInventory(options) {
  const rootPath = path.resolve(requireString(options?.rootPath, 'rootPath'))
  const rootPrefix = options?.rootPrefix === undefined || options.rootPrefix === ''
    ? ''
    : validateRelativePath(options.rootPrefix, 'rootPrefix')
  const label = requireString(options?.label, 'label')
  const rootStats = safeLstat(rootPath)
  if (rootStats === null) return Object.freeze([])
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`${label} root must be a real directory: ${rootPath}.`)
  }
  const inventory = []
  visit(rootPath, [])
  inventory.sort((left, right) => compareStrings(left.path, right.path))
  return freezeInventory(inventory)

  function visit(absoluteDir, segments) {
    const entries = readdirSync(absoluteDir, { withFileTypes: true })
      .sort((left, right) => compareStrings(left.name, right.name))
    for (const entry of entries) {
      const relativeSegments = [...segments, entry.name]
      const relativeFromRoot = relativeSegments.join('/')
      const relativePath = rootPrefix === ''
        ? relativeFromRoot
        : `${rootPrefix}/${relativeFromRoot}`
      const absolutePath = path.join(absoluteDir, entry.name)
      const stats = lstatSync(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`${label} contains symbolic link ${relativePath}.`)
      }
      if (stats.isDirectory()) {
        visit(absolutePath, relativeSegments)
      } else if (stats.isFile()) {
        const content = readFileSync(absolutePath)
        inventory.push({
          path: relativePath,
          sha256: sha256(content),
          size: content.length
        })
      } else {
        throw new Error(`${label} contains non-file ${relativePath}.`)
      }
    }
  }
}

function parseReceipt(bytes, receiptPath) {
  let receipt
  try {
    receipt = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`Internal overlay ${receiptPath} is not valid JSON: ${error.message}`)
  }
  if (bytes.toString('utf8') !== canonicalJson(receipt)) {
    throw new Error(`Internal overlay receipt is not canonical: ${receiptPath}.`)
  }
  if (!isPlainObject(receipt) || receipt.schemaVersion !== 2) {
    throw new Error(`Internal overlay receipt schema is invalid: ${receiptPath}.`)
  }
  assertExactKeys(receipt, [
    'archiveRoot',
    'archiveSha256',
    'files',
    'inventorySha256',
    'overlayId',
    'overlayRoot',
    'schemaVersion',
    'version'
  ], `Internal overlay receipt ${receiptPath}`)
  const overlayId = validateIdentity(receipt.overlayId, 'receipt overlayId')
  const version = validateVersion(receipt.version)
  const overlayRoot = validateOverlayRoot(receipt.overlayRoot, 'receipt overlayRoot')
  validateSha256(receipt.archiveSha256, 'receipt archiveSha256')
  validateSha256(receipt.inventorySha256, 'receipt inventorySha256')
  const expectedArchiveRoot = `sciforge-internal-overlay-${overlayId}-${version}`
  if (receipt.archiveRoot !== expectedArchiveRoot) {
    throw new Error(`Internal overlay receipt archive root is invalid: ${receiptPath}.`)
  }
  const files = validateInventory(receipt.files, overlayRoot, 'Internal overlay receipt')
  const manifest = { files, overlayId, overlayRoot, version }
  if (receipt.inventorySha256 !== digestInventory(manifest)) {
    throw new Error(`Internal overlay receipt inventory digest is invalid: ${receiptPath}.`)
  }
  return { ...receipt, files }
}

function validateInventory(value, rootPrefix, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} inventory must be a non-empty array.`)
  }
  const paths = []
  const seen = new Set()
  const inventory = value.map((file) => {
    if (!isPlainObject(file)) {
      throw new Error(`${label} inventory contains an invalid file record.`)
    }
    assertExactKeys(file, ['path', 'sha256', 'size'], `${label} inventory file`)
    const filePath = validateRelativePath(file.path, `${label} inventory path`)
    if (rootPrefix !== '' && !filePath.startsWith(`${rootPrefix}/`)) {
      throw new Error(`${label} inventory file escapes root prefix: ${filePath}.`)
    }
    if (seen.has(filePath)) {
      throw new Error(`${label} inventory contains duplicate path ${filePath}.`)
    }
    seen.add(filePath)
    paths.push(filePath)
    validateSha256(file.sha256, `${label} inventory hash for ${filePath}`)
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`${label} inventory size is invalid for ${filePath}.`)
    }
    return { path: filePath, sha256: file.sha256, size: file.size }
  })
  if (paths.some((file, index) => file !== [...paths].sort(compareStrings)[index])) {
    throw new Error(`${label} inventory paths must be canonically sorted.`)
  }
  return inventory
}

function assertSafeParents(root, destination) {
  const relative = path.relative(root, path.dirname(destination))
  if (relative === '') return
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = safeLstat(current)
    if (stats?.isSymbolicLink()) {
      throw new Error(`Internal overlay install path contains symbolic link ${current}.`)
    }
    if (stats && !stats.isDirectory()) {
      throw new Error(`Internal overlay install path parent is not a directory: ${current}.`)
    }
  }
}

function resolveContainedPath(root, relativePath) {
  const normalized = validateRelativePath(relativePath, 'install path')
  const resolved = path.resolve(root, ...normalized.split('/'))
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe internal overlay install path: ${relativePath}`)
  }
  return resolved
}

function requireDirectory(absolutePath, label) {
  const stats = safeLstat(absolutePath)
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory: ${absolutePath}.`)
  }
}

function safeLstat(absolutePath) {
  try {
    return lstatSync(absolutePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function validateRelativePath(value, label) {
  const relativePath = requireString(value, label)
  if (relativePath.includes('\\') || relativePath.includes('\0') ||
      relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`Unsafe internal overlay ${label}: ${relativePath}`)
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe internal overlay ${label}: ${relativePath}`)
  }
  return relativePath
}

function validateOverlayRoot(value, label) {
  const overlayRoot = validateRelativePath(value, label)
  if (!overlayRoot.startsWith('internal/')) {
    throw new Error(`Internal overlay ${label} must remain beneath internal/.`)
  }
  return overlayRoot
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

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort(compareStrings)
  const expected = [...expectedKeys].sort(compareStrings)
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected or missing fields.`)
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
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

function freezeInventory(inventory) {
  return Object.freeze(inventory.map((file) => Object.freeze({ ...file })))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

module.exports = {
  canonicalJson,
  createStaticFileInventory,
  digestInventory,
  verifyInstalledInternalOverlaySync,
  verifyStaticFileInventory
}
