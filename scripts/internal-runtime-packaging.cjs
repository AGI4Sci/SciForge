const { spawnSync } = require('node:child_process')
const {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')

const PROJECT_ROOT = resolve(__dirname, '..')
const PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/

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

function packageRelativePath(value, label) {
  const normalized = requiredString(value, label)
  const parts = normalized.split('/')
  if (
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a safe package-relative path.`)
  }
  return normalized
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

function readSmoke(value, assetRoot, label) {
  if (value === undefined) return undefined
  const smoke = requiredRecord(value, label)
  const entrypoint = packageRelativePath(smoke.entrypoint, `${label}.entrypoint`)
  const args = smoke.args === undefined ? [] : smoke.args
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error(`${label}.args must be an array of strings.`)
  }
  const stdoutEquals = requiredString(smoke.stdoutEquals, `${label}.stdoutEquals`)
  const timeoutMs = smoke.timeoutMs === undefined ? 10_000 : smoke.timeoutMs
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error(`${label}.timeoutMs must be an integer from 100 through 60000.`)
  }
  if (!statSync(join(assetRoot, ...entrypoint.split('/'))).isFile()) {
    throw new Error(`${label}.entrypoint is not a regular source file.`)
  }
  return Object.freeze({
    entrypoint,
    args: Object.freeze([...args]),
    stdoutEquals,
    timeoutMs
  })
}

function readAssets(root, packageRoot, packageName, packaging) {
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
    for (const requiredPath of normalizedRequiredPaths) {
      const requiredSourcePath = join(sourceRoot, ...requiredPath.split('/'))
      if (!statSync(requiredSourcePath).isFile()) {
        throw new Error(`${label} is missing required source path ${requiredPath}.`)
      }
      assertRealpathContained(sourceRoot, requiredSourcePath, `${label} required path ${requiredPath}`)
    }
    const smoke = asset.smoke === undefined
      ? undefined
      : readSmoke(asset.smoke, sourceRoot, `${label}.smoke`)
    if (smoke && !normalizedRequiredPaths.includes(smoke.entrypoint)) {
      throw new Error(`${label}.smoke.entrypoint must also be a required path.`)
    }
    return Object.freeze({
      sourceRoot: projectRelativePath(root, sourceRoot),
      packagedResourcesPath,
      requiredPaths: Object.freeze(normalizedRequiredPaths),
      ...(smoke ? { smoke } : {})
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
    if (packaging.bundleMain !== true && packaging.bundleMain !== false) {
      throw new Error(`${packageName} sciforgeInternal.packaging.bundleMain must be a boolean.`)
    }
    const packageRoot = resolve(manifestPath, '..')
    const assets = readAssets(root, packageRoot, packageName, packaging)
    for (const asset of assets) {
      if (packagedResourcePaths.has(asset.packagedResourcesPath)) {
        throw new Error(
          `Duplicate internal runtime packaged resource path: ${asset.packagedResourcesPath}`
        )
      }
      packagedResourcePaths.add(asset.packagedResourcesPath)
    }
    const activation = requiredRecord(internal.activation, `${packageName} sciforgeInternal.activation`)
    const bundleMain = packaging.bundleMain && activation.process === 'main'
    const build = manifest.scripts?.build
    if (typeof build !== 'string' || !build.trim()) {
      throw new Error(`${packageName} must declare a build script.`)
    }
    runtimes.push(Object.freeze({
      packageName,
      packageDir: projectRelativePath(root, packageRoot),
      bundleMain,
      assets
    }))
  }
  runtimes.sort((left, right) => left.packageName.localeCompare(right.packageName))
  return Object.freeze({
    mainBundlePackageNames: Object.freeze(
      runtimes.filter((runtime) => runtime.bundleMain).map((runtime) => runtime.packageName)
    ),
    buildPackageNames: Object.freeze(runtimes.map((runtime) => runtime.packageName)),
    extraResources: Object.freeze(runtimes.flatMap((runtime) => runtime.assets.map((asset) =>
      Object.freeze({ from: asset.sourceRoot, to: asset.packagedResourcesPath })
    ))),
    packagedRuntimes: Object.freeze(runtimes.map((runtime) => Object.freeze({
      packageName: runtime.packageName,
      assets: runtime.assets
    })))
  })
}

function validatePackagedInternalRuntimes(
  resourcesPath,
  composition = internalRuntimeComposition,
  options = {}
) {
  if (composition.packagedRuntimes.length === 0) return
  if (typeof resourcesPath !== 'string' || !isAbsolute(resourcesPath)) {
    throw new TypeError('Packaged resourcesPath must be absolute.')
  }
  if (!existsSync(resourcesPath) || !statSync(resourcesPath).isDirectory()) {
    throw new TypeError('Packaged resourcesPath must be an existing directory.')
  }
  const runner = options.spawnSync || spawnSync
  const nodeExecutable = options.nodeExecutable || process.execPath
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
      for (const requiredPath of asset.requiredPaths) {
        const candidate = join(packagedRoot, ...requiredPath.split('/'))
        if (!existsSync(candidate) || !statSync(candidate).isFile()) {
          throw new Error(
            `[after-pack] Missing internal runtime ${runtime.packageName} resource ` +
            `${asset.packagedResourcesPath}/${requiredPath}: ${candidate}`
          )
        }
        assertRealpathContained(
          packagedRoot,
          candidate,
          `${runtime.packageName} packaged resource ${requiredPath}`
        )
      }
      if (!asset.smoke) continue
      const entrypoint = join(packagedRoot, ...asset.smoke.entrypoint.split('/'))
      const result = runner(nodeExecutable, [entrypoint, ...asset.smoke.args], {
        cwd: packagedRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: asset.smoke.timeoutMs
      })
      const stdout = String(result.stdout || '').trim()
      const stderr = String(result.stderr || '').trim()
      if (result.error || result.status !== 0 || stdout !== asset.smoke.stdoutEquals) {
        const detail = stderr || stdout || result.error?.message || `exit status ${result.status}`
        throw new Error(
          `[after-pack] Internal runtime ${runtime.packageName} smoke failed: ${detail}`
        )
      }
    }
  }
}

function buildInternalRuntimes(
  composition = internalRuntimeComposition,
  options = {}
) {
  const runner = options.spawnSync || spawnSync
  const projectRoot = options.projectRoot || PROJECT_ROOT
  const npmExecutable = options.npmExecutable || (
    process.platform === 'win32' ? 'npm.cmd' : 'npm'
  )
  for (const packageName of composition.buildPackageNames) {
    const result = runner(
      npmExecutable,
      ['--workspace', packageName, 'run', 'build'],
      { cwd: projectRoot, stdio: 'inherit' }
    )
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || `exit status ${result.status}`
      throw new Error(`Internal runtime ${packageName} build failed: ${detail}`)
    }
  }
}

const internalRuntimeComposition = createInternalRuntimeComposition()

module.exports = {
  buildInternalRuntimes,
  createInternalRuntimeComposition,
  internalRuntimeComposition,
  validatePackagedInternalRuntimes
}

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--build') {
    throw new Error('Usage: node scripts/internal-runtime-packaging.cjs --build')
  }
  buildInternalRuntimes()
}
