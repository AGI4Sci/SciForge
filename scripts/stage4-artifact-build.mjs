#!/usr/bin/env node

import { spawn } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  realpath,
  rm
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  composeStage4PrivateDomainPackages,
  resealStage4PrivateDomainPackageStaging
} from './stage4-private-domain-package.mjs'

const require = createRequire(import.meta.url)
const {
  assertAcceptanceComposition,
  discoverPrivateComposition,
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

async function main(argv) {
  try {
    const {
      architecture,
      platform,
      privateDomainPackagePaths
    } = parseStage4ArtifactBuildOptions(argv)
    if (process.platform !== 'darwin' || platform !== 'mac' || architecture !== process.arch) {
      throw new Error(
        `Stage 4 must be built and exercised on its native target; host is ` +
        `${process.platform}/${process.arch}, requested ${platform}/${architecture}.`
      )
    }

    const source = readExactSourceState(REPOSITORY_ROOT, true)
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

    const temporaryParent = await realpath(tmpdir())
    const stagingProjectRoot = await mkdtemp(
      join(temporaryParent, 'sciforge-stage4-build-')
    )
    await chmod(stagingProjectRoot, 0o700)
    let buildError
    let receiptPath
    try {
      await extractTrackedSource({
        commit: source.commit,
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot
      })
      await copyPrivateBuildState(REPOSITORY_ROOT, stagingProjectRoot)
      const privatePackageComposition = await composeStage4PrivateDomainPackages({
        repositoryRoot: REPOSITORY_ROOT,
        stagingProjectRoot,
        privateDomainPackagePaths,
        now: new Date()
      })
      process.stdout.write(
        '[stage4-artifact] Verified external private domain composition: ' +
        `${privatePackageComposition.privateDomainPackages.length} package(s).\n`
      )

      const installEnvironment = {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false'
      }
      await run('npm', [
        'install',
        '--ignore-scripts',
        '--package-lock=false',
        '--audit=false',
        '--fund=false'
      ], installEnvironment, stagingProjectRoot)
      await resealStage4PrivateDomainPackageStaging({
        stagingProjectRoot,
        privateDomainPackages: privatePackageComposition.privateDomainPackages
      })
      await run(
        'npm',
        ['run', 'domain-packages:check'],
        installEnvironment,
        stagingProjectRoot
      )
      await run(
        'npm',
        ['run', 'build:agent-support'],
        installEnvironment,
        stagingProjectRoot
      )

      const internalRuntimeComposition =
        createInternalRuntimeComposition(stagingProjectRoot)
      const deploymentConfigurationComposition =
        createDomainPackageDeploymentConfigurationComposition(stagingProjectRoot)
      const privateComposition = await discoverPrivateComposition(stagingProjectRoot)
      assertAcceptanceComposition(summarizePrivateComposition({
        deploymentConfigurationComposition,
        internalRuntimeComposition,
        privateComposition
      }))

      const environment = {
        ...process.env,
        SCIFORGE_DIST_DIR: distDirectory,
        SCIFORGE_STAGE4_ACCEPTANCE: '1',
        SCIFORGE_STAGE4_BUILD_STARTED_AT: new Date().toISOString(),
        SCIFORGE_STAGE4_SOURCE_COMMIT: source.commit,
        SCIFORGE_STAGE4_SOURCE_ROOT: REPOSITORY_ROOT
      }
      delete environment.SCIFORGE_PUBLIC_RELEASE

      await run('npm', ['run', 'build'], environment, stagingProjectRoot)
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
      ], environment, stagingProjectRoot)

      receiptPath = stage4ArtifactReceiptPath(
        distDirectory,
        platform,
        architecture
      )
      await access(receiptPath)
    } catch (error) {
      buildError = error
    }

    const finalizationErrors = []
    try {
      await removeBuildWorkspace(stagingProjectRoot, temporaryParent)
    } catch (error) {
      finalizationErrors.push(error)
    }
    try {
      assertSourceUnchanged(source)
    } catch (error) {
      finalizationErrors.push(error)
    }
    if (buildError && finalizationErrors.length === 0) throw buildError
    if (!buildError && finalizationErrors.length === 1) throw finalizationErrors[0]
    if (buildError || finalizationErrors.length > 0) {
      throw new AggregateError(
        [buildError, ...finalizationErrors].filter(Boolean),
        '[stage4-artifact] Build, cleanup, or source-state verification failed.'
      )
    }
    process.stdout.write(`[stage4-artifact] Final receipt: ${receiptPath}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `${message.startsWith('[stage4-artifact]') ? message : `[stage4-artifact] ${message}`}\n`
    )
    process.exitCode = 1
  }
}

export function parseStage4ArtifactBuildOptions(argv) {
  const values = new Map()
  const privateDomainPackagePaths = []
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'Stage 4 option'} requires a value.`)
    }
    if (flag === '--private-domain-package') {
      if (!isAbsolute(value)) {
        throw new Error('Stage 4 private domain package path must be absolute.')
      }
      privateDomainPackagePaths.push(value)
      continue
    }
    if (!['--platform', '--architecture'].includes(flag) || values.has(flag)) {
      throw new Error(`Unknown or duplicate Stage 4 option: ${flag}`)
    }
    values.set(flag, value)
  }
  if (!values.has('--platform') || !values.has('--architecture')) {
    throw new Error(
      'Usage: node scripts/stage4-artifact-build.mjs ' +
      '--platform mac --architecture arm64|x64 ' +
      '[--private-domain-package /absolute/package]...'
    )
  }
  const platform = values.get('--platform')
  const architecture = values.get('--architecture')
  if (platform !== 'mac' || !['arm64', 'x64'].includes(architecture)) {
    throw new Error('Only the reviewed macOS arm64/x64 Stage 4 targets are supported.')
  }
  if (privateDomainPackagePaths.length === 0) {
    throw new Error(
      '[stage4-artifact] Stage 4 acceptance requires a reviewed private ' +
      'Content Space verification-profile contribution.'
    )
  }
  return Object.freeze({
    architecture,
    platform,
    privateDomainPackagePaths: Object.freeze(privateDomainPackagePaths)
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function run(command, args, environment, cwd = REPOSITORY_ROOT) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
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

async function extractTrackedSource({ commit, repositoryRoot, stagingProjectRoot }) {
  const archive = spawn('git', ['archive', '--format=tar', commit], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const extractor = spawn('tar', ['-xf', '-', '-C', stagingProjectRoot], {
    cwd: stagingProjectRoot,
    stdio: ['pipe', 'inherit', 'inherit']
  })
  archive.stdout.pipe(extractor.stdin)
  await Promise.all([
    requireSuccessfulExit(archive, 'git archive'),
    requireSuccessfulExit(extractor, 'tar extraction')
  ])
}

async function copyPrivateBuildState(sourceRoot, stagingRoot) {
  await cloneDirectory(
    resolve(sourceRoot, 'node_modules'),
    resolve(stagingRoot, 'node_modules'),
    true
  )
  for (const name of ['internal', '.sciforge']) {
    await cloneDirectory(
      resolve(sourceRoot, name),
      resolve(stagingRoot, name),
      false
    )
  }
}

async function cloneDirectory(source, destination, required) {
  let stats
  try {
    stats = await lstat(source)
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return
    throw error
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`[stage4-artifact] Build input directory is invalid: ${basename(source)}`)
  }
  await run('cp', ['-cR', source, destination], process.env, dirname(destination))
}

function requireSuccessfulExit(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolvePromise()
      else reject(new Error(
        `[stage4-artifact] ${label} exited with code ${code ?? 'null'} ` +
        `and signal ${signal ?? 'none'}.`
      ))
    })
  })
}

async function removeBuildWorkspace(stagingProjectRoot, temporaryParent) {
  if (dirname(stagingProjectRoot) !== temporaryParent ||
    !basename(stagingProjectRoot).startsWith('sciforge-stage4-build-')) {
    throw new Error('[stage4-artifact] Refusing to remove an unrecognized build workspace.')
  }
  await rm(stagingProjectRoot, { recursive: true, force: true })
}

function assertSourceUnchanged(expected) {
  const actual = readExactSourceState(REPOSITORY_ROOT, true)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('[stage4-artifact] Source state changed during isolated packaging.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
