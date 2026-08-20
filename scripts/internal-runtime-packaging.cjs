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

function readInstallationEvidence(root, packageRoot, packageName, internal) {
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
  return Object.freeze({
    overlayId,
    overlayRoot,
    receipt
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
      internal
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
        overlayId: installationEvidence.overlayId,
        overlayRoot: installationEvidence.overlayRoot
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
