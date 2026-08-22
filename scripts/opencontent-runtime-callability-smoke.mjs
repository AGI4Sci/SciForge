#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  OPENCONTENT_CLI_ADMITTED_COMMANDS,
  OPENCONTENT_CLI_COMMANDS
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR,
  assertOpenContentSkillBundledAssetsPresent
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'
import {
  materializeVerifiedOpenContentRuntimeSnapshot,
  readVerifiedOpenContentRuntimeSnapshot
} from '../packages/opencontent-skill-runtime/src/verified-runtime-snapshot.internal.ts'

import { locatePackagedExecutable } from './electron-domain-smoke-support.mjs'

const execFile = promisify(execFileCallback)
const MAX_HELP_BYTES = 4 * 1024 * 1024
const SMOKE_TIMEOUT_MS = 30_000
const OPENCONTENT_INTERNAL_RUNTIME_PACKAGE =
  '@sciforge-internal/opencontent-skill-assets'
const DEFAULT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function parseOpenContentPackagedSmokeCli(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--repository-root', '--dist-dir', '--executable'].includes(flag)) {
      throw new Error(`Unknown OpenContent packaged smoke option: ${flag}`)
    }
    const value = argv[index + 1]?.trim()
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    index += 1
    if (flag === '--repository-root') options.repositoryRoot = resolve(value)
    else if (flag === '--dist-dir') options.distDirectory = resolve(value)
    else options.executablePath = resolve(value)
  }
  return options
}

export function resolvePackagedResourcesPath(executablePath, platform = process.platform) {
  const executable = absolutePath(executablePath, 'executablePath')
  return platform === 'darwin'
    ? resolve(dirname(executable), '../Resources')
    : resolve(dirname(executable), 'resources')
}

export async function runOpenContentPackagedRuntimeCallabilityCli(
  argv
) {
  const options = parseOpenContentPackagedSmokeCli(argv)
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const executablePath = options.executablePath ?? await locatePackagedExecutable({
    distDirectory: options.distDirectory ?? join(repositoryRoot, 'dist'),
    productName: rootPackage.productName
  })
  return runOpenContentPackagedRuntimeCallabilitySmoke({
    repositoryRoot,
    resourcesPath: resolvePackagedResourcesPath(executablePath),
    executablePath
  })
}

export async function runOpenContentPackagedRuntimeCallabilitySmoke(options) {
  const repositoryRoot = absolutePath(options?.repositoryRoot, 'repositoryRoot')
  const resourcesPath = absolutePath(options?.resourcesPath, 'resourcesPath')
  const executablePath = absolutePath(options?.executablePath, 'executablePath')
  const packaging = createRequire(import.meta.url)('./internal-runtime-packaging.cjs')
  if (!packaging ||
      typeof packaging.createInternalRuntimeComposition !== 'function' ||
      typeof packaging.verifyPackagedInternalRuntimes !== 'function') {
    throw new TypeError('The canonical internal runtime packaging boundary is required.')
  }
  const composition = packaging.createInternalRuntimeComposition(repositoryRoot)
  if (!composition || !Array.isArray(composition.packagedRuntimes)) {
    throw new TypeError('The canonical internal runtime composition is invalid.')
  }
  const runtimes = composition.packagedRuntimes.filter(
    (runtime) => runtime?.packageName === OPENCONTENT_INTERNAL_RUNTIME_PACKAGE
  )
  if (runtimes.length !== 1) {
    throw new Error('The packaged OpenContent acceptance requires exactly one installed runtime.')
  }
  const installation = runtimes[0].installationEvidence
  const expectedInstallation = OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.installation
  if (!installation || installation.overlayId !== expectedInstallation.overlayId ||
    installation.overlayRoot !== expectedInstallation.overlayRoot ||
    installation.version !== expectedInstallation.version ||
    installation.archiveSha256 !== expectedInstallation.archiveSha256) {
    throw new Error('The packaged OpenContent installation provenance is invalid.')
  }
  const assets = Array.isArray(runtimes[0].assets)
    ? runtimes[0].assets.filter((asset) => (
        asset?.packagedResourcesPath ===
          OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath
      ))
    : []
  if (assets.length !== 1 || !Array.isArray(assets[0].inventory) ||
      assets[0].inventory.length === 0) {
    throw new Error('The packaged OpenContent acceptance runtime inventory is invalid.')
  }
  const inventoryByPath = new Map(assets[0].inventory.map((file) => [file?.path, file]))
  for (const expected of OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.trustedRuntimeFiles) {
    const received = inventoryByPath.get(expected.relativePath)
    if (!received || received.sha256 !== expected.sha256 || received.size !== expected.size) {
      throw new Error('The packaged OpenContent trusted runtime inventory is invalid.')
    }
  }

  packaging.verifyPackagedInternalRuntimes(resourcesPath, composition)
  const paths = assertOpenContentSkillBundledAssetsPresent({
    mode: 'packaged',
    resourcesPath
  })
  const verifiedSnapshot = await readVerifiedOpenContentRuntimeSnapshot({
    root: paths.root,
    trustedRuntimeFiles: OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.trustedRuntimeFiles
  })
  const privateRoot = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-callability-'))
  let inventory
  try {
    await chmod(privateRoot, 0o700)
    const privateRuntime = await materializeVerifiedOpenContentRuntimeSnapshot({
      destinationRoot: join(privateRoot, 'runtime'),
      snapshot: verifiedSnapshot
    })
    inventory = await runOpenContentCliInventorySmoke({
      executablePath,
      entrypoint: privateRuntime.entrypoint,
      electronRunAsNode: true,
      expectedVersion: OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliVersion,
      expectedCommands: OPENCONTENT_CLI_COMMANDS,
      admittedCommands: OPENCONTENT_CLI_ADMITTED_COMMANDS
    })
  } finally {
    await rm(privateRoot, { recursive: true, force: true })
  }
  return Object.freeze({
    runtimePackage: OPENCONTENT_INTERNAL_RUNTIME_PACKAGE,
    packagedInventoryFileCount: assets[0].inventory.length,
    ...inventory
  })
}

export async function runOpenContentCliInventorySmoke(options) {
  const executablePath = absolutePath(options?.executablePath, 'executablePath')
  const entrypoint = absolutePath(options?.entrypoint, 'entrypoint')
  const expectedVersion = requiredString(options?.expectedVersion, 'expectedVersion')
  const expectedCommands = uniqueStrings(options?.expectedCommands, 'expectedCommands')
  const admittedCommands = uniqueStrings(options?.admittedCommands, 'admittedCommands')
  const expectedCommandSet = new Set(expectedCommands)
  if (admittedCommands.some((command) => !expectedCommandSet.has(command))) {
    throw new Error('OpenContent admitted commands must belong to the pinned snapshot inventory.')
  }

  const environment = options?.electronRunAsNode === true
    ? { ELECTRON_RUN_AS_NODE: '1' }
    : {}
  const version = (await execute(executablePath, entrypoint, '--version', environment)).trim()
  if (version !== expectedVersion) {
    throw new Error('The packaged OpenContent CLI version does not match the pinned snapshot.')
  }
  const help = await execute(executablePath, entrypoint, '--help', environment)
  const actualCommands = parseOpenContentCliHelp(help)
  if (!sameStringSet(expectedCommands, actualCommands)) {
    throw new Error('The packaged OpenContent CLI command inventory does not match the pinned snapshot.')
  }

  return Object.freeze({
    cliVersion: version,
    snapshotCommandCount: actualCommands.length,
    admittedCommandCount: admittedCommands.length
  })
}

export function parseOpenContentCliHelp(help) {
  if (typeof help !== 'string' || help.length === 0 || help.length > MAX_HELP_BYTES) {
    throw new Error('The packaged OpenContent CLI help output is invalid.')
  }
  const lines = help.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() === '可用命令:')
  const end = lines.findIndex((line, index) => (
    index > start && line.trim() === '原生 API 透传:'
  ))
  if (start < 0 || end <= start) {
    throw new Error('The packaged OpenContent CLI help inventory is unavailable.')
  }
  const commands = lines.slice(start + 1, end).flatMap((line) => {
    const match = /^\s{2}([a-z][a-z0-9-]*)\s{2,}\S/u.exec(line)
    return match ? [match[1]] : []
  })
  if (commands.length === 0 || new Set(commands).size !== commands.length) {
    throw new Error('The packaged OpenContent CLI help inventory is invalid.')
  }
  return Object.freeze(commands)
}

async function execute(executablePath, entrypoint, flag, environment) {
  const cwd = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-callability-'))
  let output
  try {
    await chmod(cwd, 0o700)
    try {
      output = await execFile(executablePath, [entrypoint, flag], {
        cwd,
        encoding: 'utf8',
        env: environment,
        maxBuffer: MAX_HELP_BYTES,
        timeout: SMOKE_TIMEOUT_MS,
        windowsHide: true
      })
    } catch {
      throw new Error(`The packaged OpenContent CLI ${flag} check failed.`)
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
  const { stdout, stderr } = output
  if (stderr.trim() !== '') {
    throw new Error('The packaged OpenContent CLI smoke wrote unexpected diagnostic output.')
  }
  return stdout
}

function absolutePath(value, label) {
  const path = requiredString(value, label)
  if (!isAbsolute(path)) throw new TypeError(`${label} must be absolute.`)
  return path
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new TypeError(`${label} must be a non-empty string array.`)
  }
  const strings = value.map((item) => item.trim())
  if (new Set(strings).size !== strings.length) {
    throw new TypeError(`${label} must not contain duplicates.`)
  }
  return Object.freeze(strings)
}

function sameStringSet(expected, actual) {
  if (expected.length !== actual.length) return false
  const actualSet = new Set(actual)
  return expected.every((value) => actualSet.has(value))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runOpenContentPackagedRuntimeCallabilityCli(process.argv.slice(2))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `[opencontent-runtime-callability-smoke] ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}
