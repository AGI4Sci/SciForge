const { spawnSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

const PROJECT_ROOT = resolve(__dirname, '..')

const LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS = [
  'kun/package-lock.json',
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
  'extensions/research-memory/extension.json',
  'extensions/research-memory/dist/index.js',
  'extensions/research-memory/skill/SKILL.md',
  'packages/workers/multi-agent/dist/index.js',
  'kun/node_modules/@sciforge/multi-agent/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]

const LOCAL_RUNTIME_SQLITE_MODULE_PATH = 'kun/node_modules/better-sqlite3'

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
  runNpm(['--prefix', 'extensions/research-memory', 'run', 'build'], {
    cwd: projectRoot,
    label: 'npm --prefix extensions/research-memory run build'
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
}

function printUsage() {
  console.error([
    'Usage: node ./scripts/local-runtime-package.cjs <command>',
    '',
    'Commands:',
    '  ensure                       install local runtime dependencies when required',
    '  build                        ensure dependencies and build local runtime dist',
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
exports.ensureProjectLocalRuntimeInstall = ensureProjectLocalRuntimeInstall
exports.buildProjectLocalRuntime = buildProjectLocalRuntime
exports.prunePackedLocalRuntimeDependencies = prunePackedLocalRuntimeDependencies
exports.validateBundledLocalRuntime = validateBundledLocalRuntime
exports.runCli = runCli
