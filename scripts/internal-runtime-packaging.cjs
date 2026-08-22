const {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const {
  verifyInstalledInternalOverlaySync,
  verifyStaticFileInventory
} = require('@sciforge/internal-runtime-integrity')

const PROJECT_ROOT = resolve(__dirname, '..')
const PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const OVERLAY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid internal runtime manifest ${path}: ${error.message}`)
  }
}

function requiredRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected or missing fields.`)
  }
}

function packageRelativePath(value, label) {
  const normalized = requiredString(value, label)
  const parts = normalized.split('/')
  if (
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a safe package-relative path.`)
  }
  return normalized
}

function assertNoSymlinkPath(root, candidate, label) {
  const candidateRelativePath = relative(root, candidate)
  if (candidateRelativePath.startsWith('..') || isAbsolute(candidateRelativePath)) {
    throw new Error(`${label} escapes its containing root.`)
  }
  let current = root
  const rootStats = lstatSync(current)
  if (rootStats.isSymbolicLink()) {
    throw new Error(`${label} contains symbolic link ${current}.`)
  }
  if (candidateRelativePath === '') return
  for (const segment of candidateRelativePath.split(sep)) {
    current = join(current, segment)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains symbolic link ${current}.`)
    }
  }
}

function projectRelativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

function assertRealpathContained(root, candidate, label) {
  const canonicalRoot = realpathSync(root)
  const canonicalCandidate = realpathSync(candidate)
  const candidateRelativePath = relative(canonicalRoot, canonicalCandidate)
  if (candidateRelativePath.startsWith('..') || isAbsolute(candidateRelativePath)) {
    throw new Error(`${label} escapes its asset root.`)
  }
}

function internalPackageManifestPaths(root) {
  const internalRoot = join(root, 'internal')
  if (!existsSync(internalRoot)) return []
  const manifests = []
  for (const overlay of readdirSync(internalRoot, { withFileTypes: true })) {
    if (!overlay.isDirectory()) continue
    const packagesRoot = join(internalRoot, overlay.name, 'packages')
    if (!existsSync(packagesRoot)) continue
    for (const packageEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) continue
      const manifestPath = join(packagesRoot, packageEntry.name, 'package.json')
      if (existsSync(manifestPath)) manifests.push(manifestPath)
    }
  }
  return manifests.sort()
}

function publicPackageManifestPaths(root) {
  const packagesRoot = join(root, 'packages')
  if (!existsSync(packagesRoot)) return []
  const manifests = []
  visit(packagesRoot, 0)
  return manifests.sort()

  function visit(directory, depth) {
    if (depth > 2) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const packageRoot = join(directory, entry.name)
      const manifestPath = join(packageRoot, 'package.json')
      if (existsSync(manifestPath)) {
        const stats = lstatSync(manifestPath)
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error(`Public package manifest must be a regular file: ${manifestPath}.`)
        }
        manifests.push(manifestPath)
      } else {
        visit(packageRoot, depth + 1)
      }
    }
  }
}

function readPackageOwnedOverlayTrust(root) {
  const installations = new Map()
  for (const manifestPath of publicPackageManifestPaths(root)) {
    const manifest = parseJson(manifestPath)
    if (manifest.sciforgeInternalRuntimeTrust === undefined) continue
    const packageName = requiredString(manifest.name, `${manifestPath} name`)
    const trust = requiredRecord(
      manifest.sciforgeInternalRuntimeTrust,
      `${packageName} sciforgeInternalRuntimeTrust`
    )
    assertExactKeys(
      trust,
      ['contractVersion', 'installations'],
      `${packageName} sciforgeInternalRuntimeTrust`
    )
    if (trust.contractVersion !== 1 || !Array.isArray(trust.installations) ||
      trust.installations.length === 0) {
      throw new Error(`${packageName} internal runtime trust contract is invalid.`)
    }
    for (const [index, value] of trust.installations.entries()) {
      const label = `${packageName} sciforgeInternalRuntimeTrust.installations[${index}]`
      const installation = requiredRecord(value, label)
      assertExactKeys(
        installation,
        ['archiveSha256', 'assets', 'overlayId', 'overlayRoot', 'version'],
        label
      )
      const overlayId = requiredString(installation.overlayId, `${label}.overlayId`)
      if (!OVERLAY_ID_PATTERN.test(overlayId) || installations.has(overlayId)) {
        throw new Error(`${label}.overlayId is invalid or duplicated.`)
      }
      const overlayRoot = packageRelativePath(installation.overlayRoot, `${label}.overlayRoot`)
      if (!overlayRoot.startsWith('internal/')) {
        throw new Error(`${label}.overlayRoot must remain beneath internal/.`)
      }
      const version = requiredString(installation.version, `${label}.version`)
      const archiveSha256 = requiredString(
        installation.archiveSha256,
        `${label}.archiveSha256`
      )
      if (!SHA256_PATTERN.test(archiveSha256) || !Array.isArray(installation.assets) ||
        installation.assets.length === 0) {
        throw new Error(`${label} archive or asset trust is invalid.`)
      }
      const assets = installation.assets.map((assetValue, assetIndex) => {
        const assetLabel = `${label}.assets[${assetIndex}]`
        const asset = requiredRecord(assetValue, assetLabel)
        assertExactKeys(asset, ['packagedResourcesPath', 'trustedRuntimeFiles'], assetLabel)
        const packagedResourcesPath = packageRelativePath(
          asset.packagedResourcesPath,
          `${assetLabel}.packagedResourcesPath`
        )
        if (!Array.isArray(asset.trustedRuntimeFiles) ||
          asset.trustedRuntimeFiles.length === 0) {
          throw new Error(`${assetLabel}.trustedRuntimeFiles must be non-empty.`)
        }
        const roles = new Set()
        const paths = new Set()
        const trustedRuntimeFiles = asset.trustedRuntimeFiles.map((fileValue, fileIndex) => {
          const fileLabel = `${assetLabel}.trustedRuntimeFiles[${fileIndex}]`
          const file = requiredRecord(fileValue, fileLabel)
          assertExactKeys(file, ['relativePath', 'role', 'sha256', 'size'], fileLabel)
          const role = requiredString(file.role, `${fileLabel}.role`)
          const relativePath = packageRelativePath(file.relativePath, `${fileLabel}.relativePath`)
          const sha256 = requiredString(file.sha256, `${fileLabel}.sha256`)
          if (roles.has(role) || paths.has(relativePath) || !SHA256_PATTERN.test(sha256) ||
            !Number.isSafeInteger(file.size) || file.size < 1) {
            throw new Error(`${fileLabel} is invalid or duplicated.`)
          }
          roles.add(role)
          paths.add(relativePath)
          return Object.freeze({ relativePath, role, sha256, size: file.size })
        })
        return Object.freeze({
          packagedResourcesPath,
          trustedRuntimeFiles: Object.freeze(trustedRuntimeFiles)
        })
      })
      const assetPaths = assets.map((asset) => asset.packagedResourcesPath)
      if (new Set(assetPaths).size !== assetPaths.length) {
        throw new Error(`${label} contains duplicate packaged asset trust.`)
      }
      installations.set(overlayId, Object.freeze({
        archiveSha256,
        assets: Object.freeze(assets),
        overlayId,
        overlayRoot,
        version
      }))
    }
  }
  return installations
}

function verifyInstalledOverlayReceipts(root) {
  const packageOwnedTrust = readPackageOwnedOverlayTrust(root)
  const installedTrust = new Map()
  const receiptsRoot = join(root, '.sciforge', 'internal-overlays')
  let receiptsRootStats
  try {
    receiptsRootStats = lstatSync(receiptsRoot)
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  assertNoSymlinkPath(root, receiptsRoot, 'Internal overlay receipt directory')
  if (!receiptsRootStats.isDirectory()) {
    throw new Error('Internal overlay receipt directory must be a real directory.')
  }
  for (const entry of readdirSync(receiptsRoot, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue
    const receiptPath = join(receiptsRoot, entry.name)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Internal overlay receipt must be a regular file: ${receiptPath}.`)
    }
    const parsedReceipt = requiredRecord(
      parseJson(receiptPath),
      `Internal overlay receipt ${receiptPath}`
    )
    const overlayId = requiredString(
      parsedReceipt.overlayId,
      `Internal overlay receipt ${receiptPath}.overlayId`
    )
    if (!OVERLAY_ID_PATTERN.test(overlayId) || entry.name !== `${overlayId}.json`) {
      throw new Error(`Internal overlay receipt identity is invalid: ${receiptPath}.`)
    }
    const overlayRoot = packageRelativePath(
      parsedReceipt.overlayRoot,
      `Internal overlay receipt ${receiptPath}.overlayRoot`
    )
    if (!overlayRoot.startsWith('internal/')) {
      throw new Error(`Internal overlay receipt root must remain beneath internal/: ${receiptPath}.`)
    }
    const receipt = verifyInstalledInternalOverlaySync({ overlayId, overlayRoot, targetRoot: root })
    const trust = packageOwnedTrust.get(overlayId)
    if (!trust || trust.overlayRoot !== receipt.overlayRoot ||
      trust.version !== receipt.version || trust.archiveSha256 !== receipt.archiveSha256) {
      throw new Error('Internal overlay receipt does not match package-owned provenance.')
    }
    installedTrust.set(overlayId, trust)
  }
  return installedTrust
}

function readInstallationEvidence(
  root,
  packageRoot,
  packageName,
  internal,
  installedTrust
) {
  const label = `${packageName} sciforgeInternal.installationEvidence`
  const value = requiredRecord(internal.installationEvidence, label)
  assertExactKeys(value, ['overlayId', 'overlayRoot'], label)
  const overlayId = requiredString(value.overlayId, `${label}.overlayId`)
  if (!OVERLAY_ID_PATTERN.test(overlayId)) {
    throw new Error(`${label}.overlayId must be a lowercase filesystem-safe identity.`)
  }
  const overlayRoot = packageRelativePath(value.overlayRoot, `${label}.overlayRoot`)
  if (!overlayRoot.startsWith('internal/')) {
    throw new Error(`${label}.overlayRoot must remain beneath internal/.`)
  }
  const absoluteOverlayRoot = resolve(root, ...overlayRoot.split('/'))
  if (!existsSync(absoluteOverlayRoot) || !statSync(absoluteOverlayRoot).isDirectory()) {
    throw new Error(`${label}.overlayRoot is not an installed directory.`)
  }
  assertRealpathContained(root, absoluteOverlayRoot, `${label}.overlayRoot`)
  assertRealpathContained(absoluteOverlayRoot, packageRoot, `${label} package`)
  const receipt = verifyInstalledInternalOverlaySync({
    overlayId,
    overlayRoot,
    targetRoot: root
  })
  const trust = installedTrust.get(overlayId)
  if (!trust) {
    throw new Error(`${label} does not match package-owned provenance.`)
  }
  return Object.freeze({
    overlayId,
    overlayRoot,
    receipt,
    trust
  })
}

function readAssets(root, packageRoot, packageName, packaging, installationEvidence) {
  const values = packaging.assets === undefined ? [] : packaging.assets
  if (!Array.isArray(values)) {
    throw new Error(`${packageName} sciforgeInternal.packaging.assets must be an array.`)
  }
  return Object.freeze(values.map((value, index) => {
    const label = `${packageName} sciforgeInternal.packaging.assets[${index}]`
    const asset = requiredRecord(value, label)
    const rootRelativePath = packageRelativePath(asset.root, `${label}.root`)
    const packagedResourcesPath = packageRelativePath(
      asset.packagedResourcesPath,
      `${label}.packagedResourcesPath`
    )
    const requiredPaths = asset.requiredPaths
    if (
      !Array.isArray(requiredPaths) ||
      requiredPaths.length === 0 ||
      requiredPaths.some((path) => typeof path !== 'string')
    ) {
      throw new Error(`${label}.requiredPaths must be a non-empty array of paths.`)
    }
    const normalizedRequiredPaths = requiredPaths.map((path, pathIndex) =>
      packageRelativePath(path, `${label}.requiredPaths[${pathIndex}]`)
    )
    if (new Set(normalizedRequiredPaths).size !== normalizedRequiredPaths.length) {
      throw new Error(`${label}.requiredPaths must not contain duplicates.`)
    }
    const sourceRoot = join(packageRoot, ...rootRelativePath.split('/'))
    if (!statSync(sourceRoot).isDirectory()) {
      throw new Error(`${label}.root is not a source directory.`)
    }
    assertRealpathContained(packageRoot, sourceRoot, `${label}.root`)
    const projectSourceRoot = projectRelativePath(root, sourceRoot)
    if (!projectSourceRoot.startsWith(`${installationEvidence.overlayRoot}/`)) {
      throw new Error(`${label}.root escapes its receipted overlay root.`)
    }
    const inventoryPrefix = `${projectSourceRoot}/`
    const inventory = installationEvidence.receipt.inventory
      .filter((file) => file.path.startsWith(inventoryPrefix))
      .map((file) => Object.freeze({
        path: file.path.slice(inventoryPrefix.length),
        sha256: file.sha256,
        size: file.size
      }))
    if (inventory.length === 0) {
      throw new Error(`${label}.root has no receipted files.`)
    }
    const inventoryPaths = new Set(inventory.map((file) => file.path))
    for (const requiredPath of normalizedRequiredPaths) {
      const requiredSourcePath = join(sourceRoot, ...requiredPath.split('/'))
      if (!statSync(requiredSourcePath).isFile()) {
        throw new Error(`${label} is missing required source path ${requiredPath}.`)
      }
      assertRealpathContained(sourceRoot, requiredSourcePath, `${label} required path ${requiredPath}`)
      if (!inventoryPaths.has(requiredPath)) {
        throw new Error(`${label} required path is absent from the trusted receipt: ${requiredPath}.`)
      }
    }
    const trustedAssets = installationEvidence.trust.assets.filter(
      (candidate) => candidate.packagedResourcesPath === packagedResourcesPath
    )
    if (trustedAssets.length !== 1) {
      throw new Error(`${label} does not match package-owned asset provenance.`)
    }
    const inventoryByPath = new Map(inventory.map((file) => [file.path, file]))
    for (const trustedFile of trustedAssets[0].trustedRuntimeFiles) {
      const received = inventoryByPath.get(trustedFile.relativePath)
      if (!received || received.size !== trustedFile.size ||
        received.sha256 !== trustedFile.sha256) {
        throw new Error(`${label} does not match package-owned runtime provenance.`)
      }
    }
    assertExactKeys(
      asset,
      ['packagedResourcesPath', 'requiredPaths', 'root'],
      label
    )
    return Object.freeze({
      sourceRoot: projectSourceRoot,
      packagedResourcesPath,
      requiredPaths: Object.freeze(normalizedRequiredPaths),
      inventory: Object.freeze(inventory)
    })
  }))
}

function createInternalRuntimeComposition(root = PROJECT_ROOT) {
  const installedTrust = verifyInstalledOverlayReceipts(root) ?? new Map()
  const runtimes = []
  const packageNames = new Set()
  const packagedResourcePaths = new Set()
  for (const manifestPath of internalPackageManifestPaths(root)) {
    const manifest = parseJson(manifestPath)
    if (manifest.sciforgeInternal === undefined) continue
    const internal = requiredRecord(
      manifest.sciforgeInternal,
      `${projectRelativePath(root, manifestPath)} sciforgeInternal`
    )
    if (internal.distribution !== 'internal-only') continue
    if (manifest.private !== true) {
      throw new Error(`${projectRelativePath(root, manifestPath)} must be private.`)
    }
    const packageName = requiredString(manifest.name, `${manifestPath} name`)
    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      throw new Error(`${manifestPath} has an invalid scoped package name.`)
    }
    if (packageNames.has(packageName)) {
      throw new Error(`Duplicate internal runtime package name: ${packageName}`)
    }
    packageNames.add(packageName)
    const packaging = internal.packaging === undefined
      ? null
      : requiredRecord(internal.packaging, `${packageName} sciforgeInternal.packaging`)
    if (packaging === null) continue
    const packageRoot = resolve(manifestPath, '..')
    assertExactKeys(packaging, ['assets'], `${packageName} sciforgeInternal.packaging`)
    const installationEvidence = readInstallationEvidence(
      root,
      packageRoot,
      packageName,
      internal,
      installedTrust
    )
    const assets = readAssets(
      root,
      packageRoot,
      packageName,
      packaging,
      installationEvidence
    )
    for (const asset of assets) {
      if (packagedResourcePaths.has(asset.packagedResourcesPath)) {
        throw new Error(
          `Duplicate internal runtime packaged resource path: ${asset.packagedResourcesPath}`
        )
      }
      packagedResourcePaths.add(asset.packagedResourcesPath)
    }
    runtimes.push(Object.freeze({
      packageName,
      packageDir: projectRelativePath(root, packageRoot),
      installationEvidence: Object.freeze({
        archiveSha256: installationEvidence.receipt.archiveSha256,
        overlayId: installationEvidence.overlayId,
        overlayRoot: installationEvidence.overlayRoot,
        version: installationEvidence.receipt.version
      }),
      assets
    }))
  }
  runtimes.sort((left, right) => left.packageName.localeCompare(right.packageName))
  return Object.freeze({
    extraResources: Object.freeze(runtimes.flatMap((runtime) => runtime.assets.map((asset) =>
      Object.freeze({ from: asset.sourceRoot, to: asset.packagedResourcesPath })
    ))),
    packagedRuntimes: Object.freeze(runtimes.map((runtime) => Object.freeze({
      packageName: runtime.packageName,
      packageDir: runtime.packageDir,
      installationEvidence: runtime.installationEvidence,
      assets: runtime.assets
    })))
  })
}

function verifyPackagedInternalRuntimes(
  resourcesPath,
  composition = internalRuntimeComposition
) {
  if (composition.packagedRuntimes.length === 0) return
  if (typeof resourcesPath !== 'string' || !isAbsolute(resourcesPath)) {
    throw new TypeError('Packaged resourcesPath must be absolute.')
  }
  if (!existsSync(resourcesPath) || !statSync(resourcesPath).isDirectory()) {
    throw new TypeError('Packaged resourcesPath must be an existing directory.')
  }
  for (const runtime of composition.packagedRuntimes) {
    for (const asset of runtime.assets) {
      const packagedRoot = join(
        resourcesPath,
        ...asset.packagedResourcesPath.split('/')
      )
      if (!existsSync(packagedRoot) || !statSync(packagedRoot).isDirectory()) {
        throw new Error(
          `[after-pack] Missing internal runtime ${runtime.packageName} resource root ` +
          `${asset.packagedResourcesPath}: ${packagedRoot}`
        )
      }
      assertRealpathContained(
        resourcesPath,
        packagedRoot,
        `${runtime.packageName} packaged resource root ${asset.packagedResourcesPath}`
      )
      assertNoSymlinkPath(
        resourcesPath,
        packagedRoot,
        `${runtime.packageName} packaged resource root ${asset.packagedResourcesPath}`
      )
      verifyStaticFileInventory({
        inventory: asset.inventory,
        label: `[after-pack] Internal runtime ${runtime.packageName} resource ` +
          asset.packagedResourcesPath,
        rootPath: packagedRoot,
        rootPrefix: ''
      })
    }
  }
}

const internalRuntimeComposition = createInternalRuntimeComposition()

module.exports = {
  createInternalRuntimeComposition,
  internalRuntimeComposition,
  verifyPackagedInternalRuntimes
}

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify') {
    throw new Error('Usage: node scripts/internal-runtime-packaging.cjs --verify')
  }
  process.stdout.write(
    `[internal-runtime] Statically verified ${internalRuntimeComposition.packagedRuntimes.length} runtime(s).\n`
  )
}
