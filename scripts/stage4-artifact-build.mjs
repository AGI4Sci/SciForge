#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  assertAcceptanceComposition,
  discoverPrivateContributions,
  readExactSourceState,
  stage4ArtifactReceiptPath,
  summarizePrivateComposition
} = require('./stage4-artifact-receipt.cjs')
const {
  createInternalRuntimeComposition
} = require('./internal-runtime-packaging.cjs')
const {
  createDomainPackageDeploymentConfigurationComposition
} = require('./domain-package-deployment-config.cjs')

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const { architecture, platform } = parseStage4ArtifactBuildOptions(
    process.argv.slice(2)
  )
  if (process.platform !== 'darwin' || platform !== 'mac' || architecture !== process.arch) {
    throw new Error(
      `Stage 4 must be built and exercised on its native target; host is ` +
      `${process.platform}/${process.arch}, requested ${platform}/${architecture}.`
    )
  }

  const source = readExactSourceState(REPOSITORY_ROOT, true)
  const internalRuntimeComposition = createInternalRuntimeComposition(REPOSITORY_ROOT)
  const deploymentConfigurationComposition =
    createDomainPackageDeploymentConfigurationComposition(REPOSITORY_ROOT)
  const privateContributions = await discoverPrivateContributions(REPOSITORY_ROOT)
  assertAcceptanceComposition(summarizePrivateComposition({
    deploymentConfigurationComposition,
    internalRuntimeComposition,
    privateContributions
  }))

  const distDirectory = resolve(
    REPOSITORY_ROOT,
    'dist',
    `stage4-${source.commit.slice(0, 12)}-${platform}-${architecture}`
  )
  if (await exists(distDirectory)) {
    throw new Error(
      `Stage 4 output already exists; preserve or relocate it before a new build: ${distDirectory}`
    )
  }

  const environment = {
    ...process.env,
    SCIFORGE_DIST_DIR: distDirectory,
    SCIFORGE_STAGE4_ACCEPTANCE: '1',
    SCIFORGE_STAGE4_BUILD_STARTED_AT: new Date().toISOString(),
    SCIFORGE_STAGE4_SOURCE_COMMIT: source.commit
  }
  delete environment.SCIFORGE_PUBLIC_RELEASE

  await run('npm', ['run', 'build'], environment)
  await run('npx', [
    '--yes',
    'electron-builder@26.8.1',
    '--config',
    'electron-builder.config.cjs',
    '--publish',
    'never',
    '--mac',
    'dmg',
    'zip',
    `--${architecture}`
  ], environment)

  const receiptPath = stage4ArtifactReceiptPath(distDirectory, platform, architecture)
  await access(receiptPath)
  process.stdout.write(`[stage4-artifact] Final receipt: ${receiptPath}\n`)
} catch (error) {
  process.stderr.write(
    `[stage4-artifact] ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
}

function parseStage4ArtifactBuildOptions(argv) {
  if (argv.length !== 4 || argv[0] !== '--platform' || argv[2] !== '--architecture') {
    throw new Error(
      'Usage: node scripts/stage4-artifact-build.mjs ' +
      '--platform mac --architecture arm64|x64'
    )
  }
  const platform = argv[1]
  const architecture = argv[3]
  if (platform !== 'mac' || !['arm64', 'x64'].includes(architecture)) {
    throw new Error('Only the reviewed macOS arm64/x64 Stage 4 targets are supported.')
  }
  return Object.freeze({ architecture, platform })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function run(command, args, environment) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolvePromise()
      else reject(new Error(
        `${command} ${args.join(' ')} exited with code ${code ?? 'null'} ` +
        `and signal ${signal ?? 'none'}.`
      ))
    })
  })
}
