#!/usr/bin/env node

const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  loadTrackedPrivatePayloadPaths
} = require('./private-payload-boundary.cjs')

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

function assertPublicReleaseDeploymentConfigurationsSafe(composition) {
  if (!composition || !Array.isArray(composition.extraResources) ||
    !Array.isArray(composition.deploymentConfigurationDeclarations) ||
    !Array.isArray(composition.activeDeploymentConfigurationReceipts)) {
    throw new TypeError(
      'Public release guard requires canonical deployment configuration composition.'
    )
  }
  if (composition.extraResources.length !==
    composition.activeDeploymentConfigurationReceipts.length) {
    throw new TypeError(
      'Public release deployment configuration composition is inconsistent.'
    )
  }

  const declarationsByTarget = new Map()
  for (const [index, declaration] of
    composition.deploymentConfigurationDeclarations.entries()) {
    if (!isDeploymentConfigurationDeclaration(declaration)) {
      throw new TypeError(`Public release deployment configuration declaration ${index} is invalid.`)
    }
    if (declarationsByTarget.has(declaration.packagedResourcesRelativePath)) {
      throw new TypeError('Public release deployment configuration targets are duplicated.')
    }
    declarationsByTarget.set(declaration.packagedResourcesRelativePath, declaration)
  }

  const forbidden = []
  const activeTargets = new Set()
  for (const [index, configuration] of
    composition.activeDeploymentConfigurationReceipts.entries()) {
    if (!isDeploymentConfigurationMetadata(configuration) ||
      !Number.isSafeInteger(configuration.size) || configuration.size < 0 ||
      typeof configuration.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(configuration.sha256)) {
      throw new TypeError(`Public release deployment configuration entry ${index} is invalid.`)
    }
    const declaration = declarationsByTarget.get(
      configuration.packagedResourcesRelativePath
    )
    if (!declaration || activeTargets.has(configuration.packagedResourcesRelativePath) ||
      declaration.packageName !== configuration.packageName ||
      declaration.sourceRelativePath !== configuration.sourceRelativePath ||
      declaration.maxBytes !== configuration.maxBytes ||
      declaration.publicRelease !== configuration.publicRelease) {
      throw new TypeError(`Public release deployment configuration entry ${index} is invalid.`)
    }
    activeTargets.add(configuration.packagedResourcesRelativePath)
    const resource = composition.extraResources[index]
    if (!resource || typeof resource !== 'object' || Array.isArray(resource) ||
      resource.from !== configuration.sourceRelativePath ||
      resource.to !== configuration.packagedResourcesRelativePath) {
      throw new TypeError(`Public release deployment configuration resource ${index} is invalid.`)
    }
    if (configuration.publicRelease === 'forbidden') {
      forbidden.push(configuration.packageName.trim())
    }
  }
  if (forbidden.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while package-owned ' +
      `deployment configurations forbid public release: ${forbidden.sort().join(', ')}.`
    )
  }
  return Object.freeze({ publicReleaseForbiddenDeploymentConfigurationCount: 0 })
}

function isDeploymentConfigurationDeclaration(value) {
  return isDeploymentConfigurationMetadata(value) && value.contractVersion === 1
}

function isDeploymentConfigurationMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.packageName === 'string' && Boolean(value.packageName.trim()) &&
    typeof value.sourceRelativePath === 'string' && Boolean(value.sourceRelativePath) &&
    typeof value.packagedResourcesRelativePath === 'string' &&
    Boolean(value.packagedResourcesRelativePath) &&
    Number.isSafeInteger(value.maxBytes) && value.maxBytes > 0 &&
    (value.publicRelease === 'allowed' || value.publicRelease === 'forbidden')
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
  const createDeploymentConfigurationComposition =
    options.createDeploymentConfigurationComposition ||
    defaultCreateDeploymentConfigurationComposition
  const discoverPackages = options.discoverDomainPackages || defaultDiscoverDomainPackages
  const loadPrivatePayloadPaths = options.loadTrackedPrivatePayloadPaths ||
    loadTrackedPrivatePayloadPaths
  const trackedPrivatePayload = assertNoTrackedPrivatePayloadPaths(
    loadPrivatePayloadPaths(projectRoot)
  )
  const internalRuntime = assertPublicReleaseCompositionSafe(createComposition(projectRoot))
  const deploymentConfigurations = assertPublicReleaseDeploymentConfigurationsSafe(
    createDeploymentConfigurationComposition(projectRoot)
  )
  const domainContributions = assertPublicReleaseDomainContributionsSafe(
    await discoverPackages(projectRoot)
  )
  return Object.freeze({
    ...trackedPrivatePayload,
    ...internalRuntime,
    ...deploymentConfigurations,
    ...domainContributions
  })
}

function assertNoTrackedPrivatePayloadPaths(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.trim())) {
    throw new TypeError('Public release guard requires canonical tracked private payload paths.')
  }
  if (paths.length > 0) {
    throw new Error(
      '[public-release] Refusing to build or publish an official release while private ' +
      `payloads are Git-tracked: ${[...paths].sort().join(', ')}.`
    )
  }
  return Object.freeze({ trackedPrivatePayloadCount: 0 })
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

function defaultCreateDeploymentConfigurationComposition(projectRoot) {
  const {
    createDomainPackageDeploymentConfigurationComposition
  } = require('./domain-package-deployment-config.cjs')
  return createDomainPackageDeploymentConfigurationComposition(projectRoot)
}

async function defaultDiscoverDomainPackages(projectRoot) {
  const domainPackagesUrl = pathToFileURL(join(__dirname, 'domain-packages.mjs')).href
  const { discoverDomainPackages } = await import(domainPackagesUrl)
  return discoverDomainPackages(projectRoot)
}

module.exports = {
  assertPublicReleaseDeploymentConfigurationsSafe,
  assertPublicReleaseDomainContributionsSafe,
  assertPublicReleaseCompositionSafe,
  assertNoTrackedPrivatePayloadPaths,
  runConfiguredPublicReleaseGuard,
  runPublicReleaseGuard
}

if (require.main === module) {
  runPublicReleaseGuard(process.argv.slice(2)).then((result) => {
    process.stdout.write(
      '[public-release] Internal runtime composition is empty and active domain contributions ' +
      `permit public release (${result.trackedPrivatePayloadCount}/` +
      `${result.internalRuntimeCount}/` +
      `${result.publicReleaseForbiddenDeploymentConfigurationCount}/` +
      `${result.publicReleaseForbiddenContributionCount}).\n`
    )
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
