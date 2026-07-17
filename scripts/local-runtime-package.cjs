const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const PROJECT_ROOT = resolve(__dirname, '..')

const LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS = [
  'kun/package-lock.json',
  'kun/node_modules/@sciforge/execution-governance/package.json',
  'kun/node_modules/@sciforge/execution-governance/dist/index.js',
  'packages/workers/multi-agent/dist/index.js',
  'kun/node_modules/@sciforge/multi-agent/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]

const LOCAL_RUNTIME_REQUIRED_PATHS = [
  'kun/dist/cli/serve-entry.js',
  'kun/package.json',
  'kun/package-lock.json',
  'kun/node_modules/@sciforge/execution-governance/package.json',
  'kun/node_modules/@sciforge/execution-governance/dist/index.js',
  'packages/workers/multi-agent/dist/index.js',
  'kun/node_modules/@sciforge/multi-agent/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]

const LOCAL_RUNTIME_SQLITE_MODULE_PATH = 'kun/node_modules/better-sqlite3'
const ROOT_SQLITE_MODULE_PATH = 'node_modules/better-sqlite3'
const ROOT_SQLITE_ADDON_PATH = `${ROOT_SQLITE_MODULE_PATH}/build/Release/better_sqlite3.node`
const ELECTRON_NATIVE_STAMP_PATH = `${ROOT_SQLITE_MODULE_PATH}/.sciforge-electron-abi.json`

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function npmEnv(env = process.env) {
  return {
    ...env,
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  }
}

function runNpm(args, options = {}) {
  const command = npmCommand(args, options.platform || process.platform)
  const result = spawnSync(command.command, command.args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: npmEnv(options.env),
    stdio: options.stdio || 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${options.label || `npm ${args.join(' ')}`} failed`)
    error.status = result.status || 1
    throw error
  }
}

function electronNativeTarget(projectRoot = PROJECT_ROOT) {
  const electronPackage = JSON.parse(readFileSync(
    join(projectRoot, 'node_modules', 'electron', 'package.json'),
    'utf8'
  ))
  const sqlitePackage = JSON.parse(readFileSync(
    join(projectRoot, ROOT_SQLITE_MODULE_PATH, 'package.json'),
    'utf8'
  ))
  return {
    electronVersion: String(electronPackage.version || '').trim(),
    betterSqliteVersion: String(sqlitePackage.version || '').trim(),
    platform: process.platform,
    arch: process.arch
  }
}

function sqliteAddonFingerprint(projectRoot = PROJECT_ROOT) {
  const addonPath = join(projectRoot, ROOT_SQLITE_ADDON_PATH)
  if (!existsSync(addonPath)) return null
  const stats = statSync(addonPath)
  return { size: stats.size, mtimeMs: stats.mtimeMs }
}

function electronNativeStampMatches(stamp, target, fingerprint) {
  return Boolean(
    stamp &&
    fingerprint &&
    stamp.electronVersion === target.electronVersion &&
    stamp.betterSqliteVersion === target.betterSqliteVersion &&
    stamp.platform === target.platform &&
    stamp.arch === target.arch &&
    stamp.addon?.size === fingerprint.size &&
    stamp.addon?.mtimeMs === fingerprint.mtimeMs
  )
}

function readElectronNativeStamp(projectRoot = PROJECT_ROOT) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, ELECTRON_NATIVE_STAMP_PATH), 'utf8'))
  } catch {
    return null
  }
}

function resolveElectronExecutable(projectRoot = PROJECT_ROOT) {
  const electronEntry = require.resolve('electron', { paths: [projectRoot] })
  return require(electronEntry)
}

function verifyElectronNativeSqlite(projectRoot = PROJECT_ROOT, options = {}) {
  const target = electronNativeTarget(projectRoot)
  const sqliteModulePath = join(projectRoot, ROOT_SQLITE_MODULE_PATH)
  assertExists(join(sqliteModulePath, 'package.json'), 'root better-sqlite3 dependency')
  assertExists(join(projectRoot, ROOT_SQLITE_ADDON_PATH), 'better-sqlite3 native addon')
  const electronExecutable = options.electronExecutable || resolveElectronExecutable(projectRoot)
  const runner = options.spawnSync || spawnSync
  const verificationProgram = [
    "const Database = require(process.argv[1])",
    "const db = new Database(':memory:')",
    "db.prepare('SELECT 1 AS ok').get()",
    'db.close()',
    "process.stdout.write(JSON.stringify({ modules: process.versions.modules }))"
  ].join(';')
  const result = runner(electronExecutable, ['-e', verificationProgram, sqliteModulePath], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const stderr = String(result.stderr || '').trim()
  const stdout = String(result.stdout || '').trim()
  if (result.error || result.status !== 0) {
    const detail = stderr || stdout || result.error?.message || `exit status ${result.status}`
    throw new Error(
      `better-sqlite3 is not loadable by Electron ${target.electronVersion} ` +
      `(${target.platform}-${target.arch}). ${detail}`
    )
  }
  let runtimeModules = ''
  try {
    runtimeModules = String(JSON.parse(stdout).modules || '')
  } catch {
    throw new Error(`Electron native verification returned invalid output: ${stdout || '(empty)'}`)
  }
  return { ...target, runtimeModules }
}

function writeElectronNativeStamp(projectRoot, verification) {
  const addon = sqliteAddonFingerprint(projectRoot)
  if (!addon) throw new Error('better-sqlite3 native addon disappeared after verification')
  writeFileSync(join(projectRoot, ELECTRON_NATIVE_STAMP_PATH), `${JSON.stringify({
    ...verification,
    addon,
    verifiedAt: new Date().toISOString()
  }, null, 2)}\n`, 'utf8')
}

function ensureElectronNativeSqlite(projectRoot = PROJECT_ROOT, options = {}) {
  const target = electronNativeTarget(projectRoot)
  const fingerprint = sqliteAddonFingerprint(projectRoot)
  if (
    !options.forceRebuild &&
    electronNativeStampMatches(readElectronNativeStamp(projectRoot), target, fingerprint)
  ) {
    return { ...target, skipped: true }
  }

  if (!options.forceRebuild) {
    try {
      const verification = verifyElectronNativeSqlite(projectRoot, options)
      writeElectronNativeStamp(projectRoot, verification)
      return { ...verification, skipped: false, rebuilt: false }
    } catch {
      // A Node-ABI install is expected after npm ci. Rebuild below for Electron.
    }
  }

  runNpm(['rebuild', 'better-sqlite3'], {
    cwd: projectRoot,
    label: `npm rebuild better-sqlite3 for Electron ${target.electronVersion}`,
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: target.electronVersion,
      npm_config_arch: target.arch,
      npm_config_disturl: 'https://electronjs.org/headers'
    }
  })
  const verification = verifyElectronNativeSqlite(projectRoot, options)
  writeElectronNativeStamp(projectRoot, verification)
  return { ...verification, skipped: false, rebuilt: true }
}

function prepareElectronNativeSqlite(projectRoot = PROJECT_ROOT) {
  try {
    const result = ensureElectronNativeSqlite(projectRoot)
    if (result.rebuilt) {
      console.log(
        `[local-runtime-package] rebuilt better-sqlite3 for Electron ${result.electronVersion} ` +
        `(ABI ${result.runtimeModules}, ${result.platform}-${result.arch})`
      )
    }
    return true
  } catch (error) {
    console.warn(
      '[local-runtime-package] better-sqlite3 Electron ABI preparation failed; ' +
      'SciForge Runtime will keep using the JSONL fallback. ' +
      `Run \`npm run rebuild:electron-native\` for a strict retry. ` +
      `${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}

function hasProjectLocalRuntimeInstall(projectRoot = PROJECT_ROOT) {
  return LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS.every((path) => existsSync(join(projectRoot, path)))
}

function removeProjectLocalRuntimeSqlite(projectRoot = PROJECT_ROOT) {
  const sqlitePath = join(projectRoot, LOCAL_RUNTIME_SQLITE_MODULE_PATH)
  if (existsSync(sqlitePath)) {
    rmSync(sqlitePath, { recursive: true, force: true })
  }
}

function ensureProjectLocalRuntimeInstall(projectRoot = PROJECT_ROOT) {
  runNpm(['--workspace', '@sciforge/execution-governance', 'run', 'build'], {
    cwd: projectRoot,
    label: 'npm --workspace @sciforge/execution-governance run build'
  })

  runNpm(['--workspace', '@sciforge/multi-agent', 'run', 'build'], {
    cwd: projectRoot,
    label: 'npm --workspace @sciforge/multi-agent run build'
  })

  if (!hasProjectLocalRuntimeInstall(projectRoot)) {
    runNpm(['--prefix', 'kun', 'ci'], {
      cwd: projectRoot,
      label: 'npm --prefix kun ci'
    })
  }

  // Keep native SQLite on the app root dependency so Electron's native-module
  // rebuild owns the target arch and Electron ABI.
  removeProjectLocalRuntimeSqlite(projectRoot)
}

function buildProjectLocalRuntime(projectRoot = PROJECT_ROOT) {
  ensureProjectLocalRuntimeInstall(projectRoot)
  prepareElectronNativeSqlite(projectRoot)
  runNpm(['--prefix', 'kun', 'run', 'build'], {
    cwd: projectRoot,
    label: 'npm --prefix kun run build'
  })
}

function prunePackedLocalRuntimeDependencies(appRoot, platform = process.platform) {
  const kunDir = join(appRoot, 'kun')
  if (!existsSync(kunDir)) return

  assertExists(join(kunDir, 'package.json'), 'local runtime package manifest')
  assertExists(join(kunDir, 'node_modules'), 'local runtime node_modules')

  runNpm(['prune', '--omit=dev', '--ignore-scripts'], {
    cwd: kunDir,
    platform,
    label: 'npm prune --omit=dev --ignore-scripts'
  })

  assertExists(
    join(appRoot, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  rmSync(join(kunDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true })
}

function validateBundledLocalRuntime(appRoot) {
  for (const relativePath of LOCAL_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(appRoot, relativePath), relativePath)
  }
  assertExists(
    join(appRoot, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  assertExists(
    join(appRoot, ROOT_SQLITE_ADDON_PATH),
    'root better-sqlite3 native addon'
  )
}

function printUsage() {
  console.error([
    'Usage: node ./scripts/local-runtime-package.cjs <command>',
    '',
    'Commands:',
    '  ensure                       install local runtime dependencies when required',
    '  build                        ensure dependencies and build local runtime dist',
    '  rebuild-electron-native      rebuild and verify better-sqlite3 for Electron',
    '  verify-electron-native       verify better-sqlite3 under Electron-as-Node',
    '  prune-packed <appRoot>       prune bundled local runtime dependencies under app.asar.unpacked',
    '  validate-packed <appRoot>    validate bundled local runtime files'
  ].join('\n'))
}

function runCli(argv = process.argv.slice(2)) {
  const [command, appRoot] = argv
  if (command === 'ensure') {
    ensureProjectLocalRuntimeInstall()
    return
  }
  if (command === 'build') {
    buildProjectLocalRuntime()
    return
  }
  if (command === 'rebuild-electron-native') {
    const result = ensureElectronNativeSqlite(PROJECT_ROOT, { forceRebuild: true })
    console.log(
      `[local-runtime-package] better-sqlite3 verified for Electron ${result.electronVersion} ` +
      `(ABI ${result.runtimeModules}, ${result.platform}-${result.arch})`
    )
    return
  }
  if (command === 'verify-electron-native') {
    const result = verifyElectronNativeSqlite(PROJECT_ROOT)
    writeElectronNativeStamp(PROJECT_ROOT, result)
    console.log(
      `[local-runtime-package] better-sqlite3 verified for Electron ${result.electronVersion} ` +
      `(ABI ${result.runtimeModules}, ${result.platform}-${result.arch})`
    )
    return
  }
  if (command === 'prune-packed') {
    if (!appRoot) throw new Error('prune-packed requires an app root path')
    prunePackedLocalRuntimeDependencies(resolve(appRoot))
    return
  }
  if (command === 'validate-packed') {
    if (!appRoot) throw new Error('validate-packed requires an app root path')
    validateBundledLocalRuntime(resolve(appRoot))
    return
  }

  printUsage()
  const error = new Error(`unknown local-runtime-package command: ${command || '(missing)'}`)
  error.status = 2
  throw error
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    console.error(`[local-runtime-package] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(error.status || 1)
  }
}

exports.LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS = LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS
exports.LOCAL_RUNTIME_REQUIRED_PATHS = LOCAL_RUNTIME_REQUIRED_PATHS
exports.PROJECT_ROOT = PROJECT_ROOT
exports.assertExists = assertExists
exports.npmCommand = npmCommand
exports.runNpm = runNpm
exports.hasProjectLocalRuntimeInstall = hasProjectLocalRuntimeInstall
exports.removeProjectLocalRuntimeSqlite = removeProjectLocalRuntimeSqlite
exports.electronNativeTarget = electronNativeTarget
exports.sqliteAddonFingerprint = sqliteAddonFingerprint
exports.electronNativeStampMatches = electronNativeStampMatches
exports.verifyElectronNativeSqlite = verifyElectronNativeSqlite
exports.ensureElectronNativeSqlite = ensureElectronNativeSqlite
exports.prepareElectronNativeSqlite = prepareElectronNativeSqlite
exports.ensureProjectLocalRuntimeInstall = ensureProjectLocalRuntimeInstall
exports.buildProjectLocalRuntime = buildProjectLocalRuntime
exports.prunePackedLocalRuntimeDependencies = prunePackedLocalRuntimeDependencies
exports.validateBundledLocalRuntime = validateBundledLocalRuntime
exports.runCli = runCli
