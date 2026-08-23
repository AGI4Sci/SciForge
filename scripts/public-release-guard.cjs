#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const PROJECT_ROOT = resolve(__dirname, '..')
function assertPublicReleaseCompositionSafe(composition) {
  if (!composition || !Array.isArray(composition.extraResources) ||
    !Array.isArray(composition.packagedRuntimes)) {
    throw new TypeError(
      'Public release guard requires canonical extraResources and packagedRuntimes composition.'
    )
  }
  if (composition.extraResources.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while internal ' +
      `extra resource composition is non-empty (${composition.extraResources.length} entries). ` +
      'Remove the internal overlay and regenerate composition before releasing.'
    )
  }
  const packageNames = composition.packagedRuntimes.map((runtime, index) => {
    if (!runtime || typeof runtime.packageName !== 'string' || !runtime.packageName.trim()) {
      throw new TypeError(`Internal runtime composition entry ${index} has no packageName.`)
    }
    return runtime.packageName.trim()
  }).sort()
  if (packageNames.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while internal ' +
      `runtime composition is non-empty: ${packageNames.join(', ')}. ` +
      'Remove the internal overlay and regenerate composition before releasing.'
    )
  }
  return Object.freeze({ internalRuntimeCount: 0 })
}

function assertPublicReleaseDomainContributionsSafe(packages) {
  if (!Array.isArray(packages)) {
    throw new TypeError('Public release guard requires canonical discovered domain packages.')
  }
  const forbidden = []
  for (const [packageIndex, candidate] of packages.entries()) {
    const definition = candidate?.definition
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) ||
      definition.kind !== 'trusted-compile-time' ||
      typeof definition.packageName !== 'string' || !definition.packageName.trim() ||
      !Array.isArray(definition.entrypoints)) {
      throw new TypeError(`Discovered domain package ${packageIndex} is invalid.`)
    }
    if (definition.composition === 'development-only') continue
    if (definition.composition !== 'production') {
      throw new TypeError(
        `Discovered domain package ${definition.packageName} has invalid composition metadata.`
      )
    }
    for (const [entrypointIndex, entrypoint] of definition.entrypoints.entries()) {
      if (!entrypoint || typeof entrypoint !== 'object' || Array.isArray(entrypoint) ||
        typeof entrypoint.process !== 'string' || !Array.isArray(entrypoint.contributions)) {
        throw new TypeError(
          `Discovered domain package ${definition.packageName} entrypoint ${entrypointIndex} is invalid.`
        )
      }
      for (const [contributionIndex, contribution] of entrypoint.contributions.entries()) {
        if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution) ||
          typeof contribution.id !== 'string' || !contribution.id.trim() ||
          typeof contribution.kind !== 'string' || !contribution.kind.trim() ||
          (contribution.publicRelease !== undefined &&
            contribution.publicRelease !== 'allowed' &&
            contribution.publicRelease !== 'forbidden')) {
          throw new TypeError(
            `Discovered domain package ${definition.packageName} contribution ${contributionIndex} is invalid.`
          )
        }
        if (contribution.publicRelease === 'forbidden') {
          forbidden.push(`${definition.packageName}:${contribution.id}`)
        }
      }
    }
  }
  if (forbidden.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while active domain ' +
      `contributions forbid public release: ${forbidden.sort().join(', ')}.`
    )
  }
  return Object.freeze({ publicReleaseForbiddenContributionCount: 0 })
}

async function runPublicReleaseGuard(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error('Public release guard does not accept arguments or override flags.')
  }
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT)
  const createComposition = options.createComposition || defaultCreateComposition
  const discoverPackages = options.discoverDomainPackages || defaultDiscoverDomainPackages
  const loadTrackedInternalPayloadPaths = options.loadTrackedInternalPayloadPaths ||
    defaultLoadTrackedInternalPayloadPaths
  assertNoTrackedInternalPayloadPaths(loadTrackedInternalPayloadPaths(projectRoot))
  const internalRuntime = assertPublicReleaseCompositionSafe(createComposition(projectRoot))
  const domainContributions = assertPublicReleaseDomainContributionsSafe(
    await discoverPackages(projectRoot)
  )
  return Object.freeze({ ...internalRuntime, ...domainContributions })
}

function assertNoTrackedInternalPayloadPaths(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.trim())) {
    throw new TypeError('Public release guard requires canonical tracked internal payload paths.')
  }
  if (paths.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while internal ' +
      `payloads are Git-tracked: ${[...paths].sort().join(', ')}.`
    )
  }
  return Object.freeze({ trackedInternalPayloadCount: 0 })
}

async function runConfiguredPublicReleaseGuard(options = {}) {
  const { environment = process.env, ...guardOptions } = options
  const mode = environment.SCIFORGE_PUBLIC_RELEASE
  if (mode === undefined) return undefined
  if (mode !== '1') {
    throw new Error(
      '[public-release] SCIFORGE_PUBLIC_RELEASE must be exactly 1 when configured.'
    )
  }
  return runPublicReleaseGuard([], guardOptions)
}

function defaultCreateComposition(projectRoot) {
  const { createInternalRuntimeComposition } = require('./internal-runtime-packaging.cjs')
  return createInternalRuntimeComposition(projectRoot)
}

async function defaultDiscoverDomainPackages(projectRoot) {
  const domainPackagesUrl = pathToFileURL(join(__dirname, 'domain-packages.mjs')).href
  const { discoverDomainPackages } = await import(domainPackagesUrl)
  return discoverDomainPackages(projectRoot)
}

function defaultLoadTrackedInternalPayloadPaths(projectRoot) {
  return execFileSync(
    'git',
    [
      'ls-files', '-z', '--',
      'internal/**',
      '.sciforge/internal-overlays/**',
      '.sciforge/private/**'
    ],
    { cwd: projectRoot, encoding: 'utf8' }
  ).split('\0').filter(Boolean).sort()
}

module.exports = {
  assertPublicReleaseDomainContributionsSafe,
  assertPublicReleaseCompositionSafe,
  assertNoTrackedInternalPayloadPaths,
  runConfiguredPublicReleaseGuard,
  runPublicReleaseGuard
}

if (require.main === module) {
  runPublicReleaseGuard(process.argv.slice(2)).then((result) => {
    process.stdout.write(
      '[public-release] Internal runtime composition is empty and active domain contributions ' +
      `permit public release (${result.internalRuntimeCount}/` +
      `${result.publicReleaseForbiddenContributionCount}).\n`
    )
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
