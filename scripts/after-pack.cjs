const { execFileSync, spawnSync } = require('node:child_process')
const { chmodSync, existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const releaseWorkerManifest = require('./release-worker-manifest.cjs')
const nativeRuntimeDependencies = require('./native-runtime-dependencies.cjs')

const PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS =
  releaseWorkerManifest.packagedExecutableNodeEntryRequiredPaths

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function validateBundledReleaseRuntime(context, runtimeEntry) {
  const root = unpackedAppRoot(context)
  for (const relativePath of runtimeEntry.requiredPaths) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledReleaseRuntimes(context) {
  for (const runtimeEntry of releaseWorkerManifest.runtimeEntries) {
    validateBundledReleaseRuntime(context, runtimeEntry)
  }
}

function validateNativeRuntimeDependencies(context) {
  const root = unpackedAppRoot(context)
  const requiredPaths = nativeRuntimeDependencies.packagedNativeBindingRelativePaths(
    context.electronPlatformName,
    context.arch
  )
  for (const relativePath of requiredPaths) {
    assertExists(join(root, relativePath), `native runtime dependency ${relativePath}`)
  }
}

function pruneUnrelatedNativeRuntimeDependencies(context) {
  const nativeModulesRoot = join(unpackedAppRoot(context), 'node_modules', '@napi-rs')
  if (!existsSync(nativeModulesRoot)) return
  const retainedPackages = new Set(nativeRuntimeDependencies.canvasPackagesForTarget(
    context.electronPlatformName,
    context.arch
  ).map((packageName) => packageName.slice('@napi-rs/'.length)))
  for (const entry of readdirSync(nativeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('canvas-')) continue
    if (retainedPackages.has(entry.name)) continue
    rmSync(join(nativeModulesRoot, entry.name), { force: true, recursive: true })
  }
}

function verifyBundledMultiAgentContract(context, options = {}) {
  const root = unpackedAppRoot(context)
  const contractPath = join(root, 'packages', 'workers', 'multi-agent', 'dist', 'contract.js')
  const zodManifestPath = join(root, 'node_modules', 'zod', 'package.json')
  assertExists(contractPath, 'multi-agent contract')
  assertExists(zodManifestPath, 'root zod dependency')

  const runner = options.spawnSync || spawnSync
  const nodeExecutable = options.nodeExecutable || process.execPath
  const verificationProgram = `await import(${JSON.stringify(pathToFileURL(contractPath).href)})`
  const result = runner(nodeExecutable, ['--input-type=module', '--eval', verificationProgram], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const stderr = String(result.stderr || '').trim()
  const stdout = String(result.stdout || '').trim()
  if (result.error || result.status !== 0) {
    const detail = stderr || stdout || result.error?.message || `exit status ${result.status}`
    throw new Error(`[after-pack] Packaged multi-agent contract is not loadable: ${detail}`)
  }
}

function validatePackagedExecutableNodeEntries(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

function ensureNodePtyHelpersExecutable(context) {
  const root = unpackedAppRoot(context)
  const prebuildsDir = join(root, 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuildsDir)) return
  for (const folder of readdirSync(prebuildsDir)) {
    const helper = join(prebuildsDir, folder, 'spawn-helper')
    if (!existsSync(helper)) continue
    try {
      chmodSync(helper, 0o755)
    } catch (error) {
      console.warn(`[after-pack] could not chmod node-pty spawn-helper (${folder}):`, error.message)
    }
  }
}

async function afterPack(context) {
  validateBundledReleaseRuntimes(context)
  pruneUnrelatedNativeRuntimeDependencies(context)
  validateNativeRuntimeDependencies(context)
  verifyBundledMultiAgentContract(context)
  validatePackagedExecutableNodeEntries(context)
  ensureNodePtyHelpersExecutable(context)
  maybeAdhocSignMacApp(context)
}

for (const [exportName, requiredPaths] of Object.entries(
  releaseWorkerManifest.runtimeRequiredPathExports
)) {
  exports[exportName] = requiredPaths
}
exports.PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS =
  PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  validateBundledReleaseRuntime,
  validateBundledReleaseRuntimes,
  pruneUnrelatedNativeRuntimeDependencies,
  validateNativeRuntimeDependencies,
  verifyBundledMultiAgentContract,
  validatePackagedExecutableNodeEntries,
  ensureNodePtyHelpersExecutable
}
exports.default = afterPack
