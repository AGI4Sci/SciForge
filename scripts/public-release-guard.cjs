#!/usr/bin/env node

const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const PROJECT_ROOT = resolve(__dirname, '..')
const CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION =
  'main.content-space-verification-profile'

function assertNoInternalRuntimeComposition(composition) {
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

function assertPublicReleaseCompositionSafe(composition) {
  const internal = assertNoInternalRuntimeComposition(composition)
  const activeProfiles = findContentSpaceVerificationProfileContributions(
    composition.domainPackages
  )
  if (activeProfiles.length > 0) {
    const owners = activeProfiles
      .map(({ packageName, contributionId }) => `${packageName}:${contributionId}`)
      .sort()
    throw new Error(
      '[public-release] Refusing to build or publish an official release while active ' +
      `Content Space verification profiles are installed: ${owners.join(', ')}. ` +
      'Remove the local verification package and regenerate composition before releasing.'
    )
  }
  return Object.freeze({
    ...internal,
    verificationProfileCount: 0
  })
}

function findContentSpaceVerificationProfileContributions(definitions, options = {}) {
  if (!Array.isArray(definitions)) {
    throw new TypeError('Public release guard requires canonical trusted domain composition.')
  }
  const includeDevelopmentOnly = options.includeDevelopmentOnly === true
  return Object.freeze(definitions.flatMap((definition, packageIndex) => {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) ||
      definition.kind !== 'trusted-compile-time' || typeof definition.packageName !== 'string') {
      throw new TypeError(`Trusted domain composition entry ${packageIndex} is invalid.`)
    }
    if (!includeDevelopmentOnly && definition.composition === 'development-only') return []
    const contracts = definition.contributionContracts ?? {}
    const entrypoints = definition.entrypoints
    if (typeof contracts !== 'object' || Array.isArray(contracts) ||
      !Array.isArray(entrypoints)) {
      throw new TypeError(`Trusted domain package ${definition.packageName} composition is invalid.`)
    }
    // Domain discovery schema-checks these manifest declarations, and the Domain SDK
    // rejects runtime declarations that drift from them. Do not execute domain main
    // factories during a release boundary check: the canonical static projection is
    // both sufficient and side-effect free.
    return entrypoints
      .filter((entrypoint) => entrypoint?.process === 'main' &&
        Array.isArray(entrypoint.contributions))
      .flatMap((entrypoint) => entrypoint.contributions
        .filter((declaration) => declaration?.kind === 'main.extension')
        .filter((declaration) => hasLocation(
          contracts[declaration.id],
          CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION
        ))
        .map((declaration) => ({
          packageName: definition.packageName,
          contributionId: declaration.id
        })))
  }))
}

function hasLocation(value, location) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    value.location === location
}

async function runPublicReleaseGuard(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error('Public release guard does not accept arguments or override flags.')
  }
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT)
  const createComposition = options.createComposition || defaultCreateComposition
  const loadDomainPackages = options.loadDomainPackages || defaultLoadDomainPackages
  const internalComposition = createComposition(projectRoot)
  const domainPackages = await loadDomainPackages(projectRoot)
  return assertPublicReleaseCompositionSafe({
    ...internalComposition,
    domainPackages
  })
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

async function defaultLoadDomainPackages(projectRoot) {
  const generatorUrl = pathToFileURL(join(__dirname, 'domain-packages.mjs')).href
  const { generateDomainPackageFiles } = await import(generatorUrl)
  const packages = await generateDomainPackageFiles(projectRoot, { check: true })
  return packages
    .filter(({ definition }) => definition.composition !== 'development-only')
    .map(({ definition }) => definition)
}

module.exports = {
  assertPublicReleaseCompositionSafe,
  findContentSpaceVerificationProfileContributions,
  runConfiguredPublicReleaseGuard,
  runPublicReleaseGuard
}

if (require.main === module) {
  runPublicReleaseGuard(process.argv.slice(2)).then((result) => {
    process.stdout.write(
      '[public-release] Internal runtime and Content Space verification profile ' +
      `composition is empty (${result.internalRuntimeCount}/${result.verificationProfileCount}).\n`
    )
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
