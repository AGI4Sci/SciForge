const { execFileSync } = require('node:child_process')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, posix } = require('node:path')

const CANVAS_PACKAGE = '@napi-rs/canvas'

const TARGET_CANVAS_PACKAGES = Object.freeze({
  darwin: Object.freeze({
    arm64: ['@napi-rs/canvas-darwin-arm64'],
    universal: ['@napi-rs/canvas-darwin-arm64', '@napi-rs/canvas-darwin-x64'],
    x64: ['@napi-rs/canvas-darwin-x64']
  }),
  linux: Object.freeze({
    arm64: ['@napi-rs/canvas-linux-arm64-gnu'],
    x64: ['@napi-rs/canvas-linux-x64-gnu']
  }),
  win32: Object.freeze({
    arm64: ['@napi-rs/canvas-win32-arm64-msvc'],
    x64: ['@napi-rs/canvas-win32-x64-msvc']
  })
})

const ARCH_NAMES = Object.freeze({
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
})

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function normalizeArch(arch) {
  if (typeof arch === 'number') return ARCH_NAMES[arch] || String(arch)
  return String(arch)
}

function canvasPackagesForTarget(platform, arch) {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const packages = TARGET_CANVAS_PACKAGES[normalizedPlatform]?.[normalizedArch]
  if (!packages) {
    throw new Error(
      `[native-runtime] Unsupported packaging target: ${normalizedPlatform}/${normalizedArch}`
    )
  }
  return packages
}

function packageDirectory(projectDir, packageName) {
  return join(projectDir, 'node_modules', ...packageName.split('/'))
}

function nativeBindingPath(projectDir, packageName) {
  const manifestPath = join(packageDirectory(projectDir, packageName), 'package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const nativeFile = manifest.main
  if (typeof nativeFile !== 'string' || !nativeFile.endsWith('.node')) return null
  const bindingPath = join(packageDirectory(projectDir, packageName), nativeFile)
  return existsSync(bindingPath) ? bindingPath : null
}

function canvasOptionalDependencies(projectDir) {
  const manifestPath = join(packageDirectory(projectDir, CANVAS_PACKAGE), 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`[native-runtime] Missing ${CANVAS_PACKAGE}: ${manifestPath}`)
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')).optionalDependencies || {}
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function installOptionalPackage(projectDir, packageName, version, options = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sciforge-native-runtime-'))
  try {
    const runner = options.execFileSync || execFileSync
    const output = runner(
      options.npmExecutable || npmExecutable(),
      ['pack', `${packageName}@${version}`, '--pack-destination', temporaryDirectory],
      { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    )
    const archiveName = String(output).trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!archiveName) throw new Error(`npm pack did not return an archive for ${packageName}`)
    const destination = packageDirectory(projectDir, packageName)
    rmSync(destination, { force: true, recursive: true })
    mkdirSync(destination, { recursive: true })
    runner(
      options.tarExecutable || 'tar',
      [
        '-xzf',
        join(temporaryDirectory, basename(archiveName)),
        '-C',
        destination,
        '--strip-components=1'
      ],
      { cwd: projectDir, stdio: 'inherit' }
    )
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

function ensureNativeRuntimeDependencies({ projectDir, platform, arch }, options = {}) {
  const dependencies = canvasOptionalDependencies(projectDir)
  const packages = canvasPackagesForTarget(platform, arch)
  for (const packageName of packages) {
    if (nativeBindingPath(projectDir, packageName)) continue
    const version = dependencies[packageName]
    if (!version) {
      throw new Error(`${CANVAS_PACKAGE} does not declare ${packageName} as an optional dependency`)
    }
    console.log(`[native-runtime] Fetching ${packageName}@${version} for ${normalizePlatform(platform)}/${normalizeArch(arch)}`)
    installOptionalPackage(projectDir, packageName, version, options)
    if (!nativeBindingPath(projectDir, packageName)) {
      throw new Error(`[native-runtime] Native binding was not installed for ${packageName}`)
    }
  }
  return packages
}

function packagedNativeBindingRelativePaths(platform, arch) {
  return canvasPackagesForTarget(platform, arch).map((packageName) => {
    const platformSuffix = packageName.slice('@napi-rs/canvas-'.length)
    return posix.join('node_modules', packageName, `skia.${platformSuffix}.node`)
  })
}

exports._internals = {
  ARCH_NAMES,
  TARGET_CANVAS_PACKAGES,
  canvasOptionalDependencies,
  installOptionalPackage,
  nativeBindingPath,
  normalizeArch,
  normalizePlatform,
  packageDirectory
}
exports.canvasPackagesForTarget = canvasPackagesForTarget
exports.ensureNativeRuntimeDependencies = ensureNativeRuntimeDependencies
exports.packagedNativeBindingRelativePaths = packagedNativeBindingRelativePaths
