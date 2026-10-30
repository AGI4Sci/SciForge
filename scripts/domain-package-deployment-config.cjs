const { createHash } = require('node:crypto')
const {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} = require('node:fs')
const {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32
} = require('node:path')

const METADATA_KEY = 'sciforgeDeploymentConfiguration'
const METADATA_KEYS = Object.freeze([
  'contractVersion',
  'sourceRelativePath',
  'packagedResourcesRelativePath',
  'maxBytes',
  'publicRelease'
])

function createDomainPackageDeploymentConfigurationComposition(projectRoot) {
  const absoluteProjectRoot = requireAbsoluteDirectory(projectRoot, 'project root')
  const packagesRoot = join(absoluteProjectRoot, 'packages', 'domains')
  const declarations = []

  for (const directory of readDomainPackageDirectories(packagesRoot)) {
    const packageRoot = join(packagesRoot, directory)
    const packageJson = readJsonObject(join(packageRoot, 'package.json'), 'domain package metadata')
    const manifest = readJsonObject(join(packageRoot, 'sciforge.domain.json'), 'domain package manifest')
    if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
      throw new Error(`Domain package ${directory} has no package name`)
    }
    if (manifest.packageName !== packageJson.name) {
      throw new Error(`Domain package ${packageJson.name} manifest packageName does not match`)
    }
    if (!(METADATA_KEY in packageJson)) continue

    declarations.push({
      packageName: packageJson.name,
      ...parseDeploymentMetadata(packageJson[METADATA_KEY], packageJson.name)
    })
  }

  declarations.sort((left, right) => left.packageName.localeCompare(right.packageName))
  assertUniqueTargets(declarations)

  const deploymentConfigurationDeclarations = declarations.map((declaration) =>
    Object.freeze({ ...declaration }))
  const extraResources = []
  const activeDeploymentConfigurationReceipts = []
  for (const declaration of declarations) {
    const sourcePath = resolveContainedPath(
      absoluteProjectRoot,
      declaration.sourceRelativePath,
      'sourceRelativePath'
    )
    const sourceStat = lstatExistingPathWithoutSymlinks(
      absoluteProjectRoot,
      sourcePath,
      declaration.sourceRelativePath
    )
    if (sourceStat === undefined) continue
    if (!sourceStat.isFile()) {
      throw new Error(`Deployment configuration source is not a regular file: ${declaration.sourceRelativePath}`)
    }

    const canonicalRoot = realpathSync(absoluteProjectRoot)
    const canonicalSource = realpathSync(sourcePath)
    assertContained(canonicalRoot, canonicalSource, 'sourceRelativePath')

    const content = readFileSync(sourcePath)
    if (content.byteLength > declaration.maxBytes) {
      throw new Error(
        `Deployment configuration source exceeds maximum ${declaration.maxBytes} bytes: ${declaration.sourceRelativePath}`
      )
    }

    extraResources.push(Object.freeze({
      from: declaration.sourceRelativePath,
      to: declaration.packagedResourcesRelativePath
    }))
    activeDeploymentConfigurationReceipts.push(Object.freeze({
      packageName: declaration.packageName,
      sourceRelativePath: declaration.sourceRelativePath,
      packagedResourcesRelativePath: declaration.packagedResourcesRelativePath,
      maxBytes: declaration.maxBytes,
      publicRelease: declaration.publicRelease,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    }))
  }

  return Object.freeze({
    extraResources: Object.freeze(extraResources),
    deploymentConfigurationDeclarations: Object.freeze(
      deploymentConfigurationDeclarations
    ),
    activeDeploymentConfigurationReceipts: Object.freeze(
      activeDeploymentConfigurationReceipts
    )
  })
}

function verifyPackagedDomainDeploymentConfigurations(resourcesRoot, composition) {
  const absoluteResourcesRoot = requireAbsoluteDirectory(resourcesRoot, 'packaged resources root')
  const { declarations, receipts } = requireComposition(composition)
  const receiptByTarget = new Map(receipts.map((receipt) => [
    receipt.packagedResourcesRelativePath,
    receipt
  ]))

  for (const declaration of declarations) {
    const configuration = receiptByTarget.get(declaration.packagedResourcesRelativePath)
    const targetPath = resolveContainedPath(
      absoluteResourcesRoot,
      declaration.packagedResourcesRelativePath,
      'packagedResourcesRelativePath'
    )
    const targetStat = lstatExistingPathWithoutSymlinks(
      absoluteResourcesRoot,
      targetPath,
      declaration.packagedResourcesRelativePath
    )
    if (configuration === undefined) {
      if (targetStat !== undefined) {
        throw new Error(
          `Inactive packaged deployment configuration must be absent: ${declaration.packagedResourcesRelativePath}`
        )
      }
      continue
    }
    if (targetStat === undefined) {
      throw new Error(
        `Packaged deployment configuration is missing: ${configuration.packagedResourcesRelativePath}`
      )
    }
    if (!targetStat.isFile()) {
      throw new Error(
        `Packaged deployment configuration is not a regular file: ${configuration.packagedResourcesRelativePath}`
      )
    }
    if (targetStat.size > configuration.maxBytes) {
      throw new Error(
        `Packaged deployment configuration exceeds maximum ${configuration.maxBytes} bytes: ${configuration.packagedResourcesRelativePath}`
      )
    }

    const canonicalRoot = realpathSync(absoluteResourcesRoot)
    const canonicalTarget = realpathSync(targetPath)
    assertContained(canonicalRoot, canonicalTarget, 'packagedResourcesRelativePath')

    const content = readFileSync(targetPath)
    const digest = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== configuration.size || digest !== configuration.sha256) {
      throw new Error(
        `Packaged deployment configuration changed after composition: ${configuration.packagedResourcesRelativePath}`
      )
    }
  }
}

function readDomainPackageDirectories(packagesRoot) {
  const stat = lstatSync(packagesRoot)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Domain packages root must be a regular directory')
  }
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function parseDeploymentMetadata(value, packageName) {
  if (!isRecord(value)) {
    throw new Error(`${packageName} ${METADATA_KEY} must be an object`)
  }
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...METADATA_KEYS].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${packageName} ${METADATA_KEY} has invalid fields`)
  }
  if (value.contractVersion !== 1) {
    throw new Error(`${packageName} deployment contractVersion must be 1`)
  }
  const sourceRelativePath = requireSafeRelativePath(value.sourceRelativePath, 'sourceRelativePath')
  const packagedResourcesRelativePath = requireSafeRelativePath(
    value.packagedResourcesRelativePath,
    'packagedResourcesRelativePath'
  )
  if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes <= 0) {
    throw new Error(`${packageName} deployment maxBytes must be a positive safe integer`)
  }
  if (value.publicRelease !== 'allowed' && value.publicRelease !== 'forbidden') {
    throw new Error(`${packageName} deployment publicRelease must be allowed or forbidden`)
  }
  return {
    contractVersion: 1,
    sourceRelativePath,
    packagedResourcesRelativePath,
    maxBytes: value.maxBytes,
    publicRelease: value.publicRelease
  }
}

function requireComposition(composition) {
  if (!isRecord(composition)) throw new Error('Deployment configuration composition must be an object')
  const keys = Object.keys(composition).sort()
  const expectedCompositionKeys = [
    'activeDeploymentConfigurationReceipts',
    'deploymentConfigurationDeclarations',
    'extraResources'
  ]
  if (keys.length !== expectedCompositionKeys.length ||
    keys.some((key, index) => key !== expectedCompositionKeys[index])) {
    throw new Error('Deployment configuration composition has invalid fields')
  }
  if (!Array.isArray(composition.extraResources) ||
    !Array.isArray(composition.deploymentConfigurationDeclarations) ||
    !Array.isArray(composition.activeDeploymentConfigurationReceipts)) {
    throw new Error('Deployment configuration composition arrays are required')
  }

  const declarations = composition.deploymentConfigurationDeclarations.map((declaration) => {
    if (!isRecord(declaration)) {
      throw new Error('Deployment configuration declaration must be an object')
    }
    const expectedKeys = [
      'contractVersion',
      'maxBytes',
      'packageName',
      'packagedResourcesRelativePath',
      'publicRelease',
      'sourceRelativePath'
    ]
    const keys = Object.keys(declaration).sort()
    if (keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])) {
      throw new Error('Deployment configuration declaration has invalid fields')
    }
    if (declaration.contractVersion !== 1) {
      throw new Error('Deployment configuration declaration contractVersion is invalid')
    }
    validateCompositionMetadata(declaration, 'declaration')
    return declaration
  })
  assertUniqueTargets(declarations)
  const declarationByTarget = new Map(declarations.map((declaration) => [
    declaration.packagedResourcesRelativePath,
    declaration
  ]))

  const receipts = composition.activeDeploymentConfigurationReceipts.map((configuration) => {
    if (!isRecord(configuration)) throw new Error('Deployment configuration receipt must be an object')
    const expectedKeys = [
      'maxBytes',
      'packageName',
      'packagedResourcesRelativePath',
      'publicRelease',
      'sha256',
      'size',
      'sourceRelativePath'
    ]
    const keys = Object.keys(configuration).sort()
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      throw new Error('Deployment configuration receipt has invalid fields')
    }
    validateCompositionMetadata(configuration, 'receipt')
    if (!Number.isSafeInteger(configuration.size) || configuration.size < 0) {
      throw new Error('Deployment configuration receipt size is invalid')
    }
    if (typeof configuration.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(configuration.sha256)) {
      throw new Error('Deployment configuration receipt sha256 is invalid')
    }
    const declaration = declarationByTarget.get(configuration.packagedResourcesRelativePath)
    if (declaration === undefined ||
      declaration.packageName !== configuration.packageName ||
      declaration.sourceRelativePath !== configuration.sourceRelativePath ||
      declaration.maxBytes !== configuration.maxBytes ||
      declaration.publicRelease !== configuration.publicRelease) {
      throw new Error('Deployment configuration receipt does not match its declaration')
    }
    return configuration
  })
  assertUniqueTargets(receipts)

  if (composition.extraResources.length !== receipts.length) {
    throw new Error('Deployment configuration extraResources do not match active receipts')
  }
  for (const [index, resource] of composition.extraResources.entries()) {
    if (!isRecord(resource) || Object.keys(resource).sort().join(',') !== 'from,to' ||
      resource.from !== receipts[index].sourceRelativePath ||
      resource.to !== receipts[index].packagedResourcesRelativePath) {
      throw new Error(`Deployment configuration extraResources entry ${index} is invalid`)
    }
  }

  return { declarations, receipts }
}

function validateCompositionMetadata(configuration, kind) {
  if (typeof configuration.packageName !== 'string' || configuration.packageName.length === 0) {
    throw new Error(`Deployment configuration ${kind} packageName is invalid`)
  }
  requireSafeRelativePath(configuration.sourceRelativePath, 'sourceRelativePath')
  requireSafeRelativePath(
    configuration.packagedResourcesRelativePath,
    'packagedResourcesRelativePath'
  )
  if (!Number.isSafeInteger(configuration.maxBytes) || configuration.maxBytes <= 0) {
    throw new Error(`Deployment configuration ${kind} maxBytes is invalid`)
  }
  if (configuration.publicRelease !== 'allowed' &&
    configuration.publicRelease !== 'forbidden') {
    throw new Error(`Deployment configuration ${kind} publicRelease is invalid`)
  }
}

function assertUniqueTargets(declarations) {
  const targets = new Set()
  for (const declaration of declarations) {
    const target = declaration.packagedResourcesRelativePath
    if (targets.has(target)) {
      throw new Error(`Duplicate deployment configuration target: ${target}`)
    }
    targets.add(target)
  }
}

function requireSafeRelativePath(value, field) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error(`Deployment configuration ${field} must be a relative slash path`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Deployment configuration ${field} must be contained`)
  }
  return value
}

function resolveContainedPath(root, relativePath, field) {
  const target = resolve(root, ...relativePath.split('/'))
  assertContained(root, target, field)
  return target
}

function assertContained(root, target, field) {
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Deployment configuration ${field} escapes its root`)
  }
}

function lstatExistingPathWithoutSymlinks(root, target, relativePath) {
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink()) throw new Error(`Deployment configuration root is a symbolic link: ${root}`)
  let current = root
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, segment)
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (error && error.code === 'ENOENT') return undefined
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Deployment configuration path contains a symbolic link: ${relativePath}`)
    }
  }
  return lstatSync(target)
}

function requireAbsoluteDirectory(root, label) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error(`Deployment configuration ${label} must be absolute`)
  }
  const absoluteRoot = resolve(root)
  const stat = lstatSync(absoluteRoot)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Deployment configuration ${label} must be a regular directory`)
  }
  return absoluteRoot
}

function readJsonObject(path, label) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}`, { cause: error })
  }
  if (!isRecord(value)) throw new Error(`${label} at ${path} must be an object`)
  return value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

module.exports = {
  createDomainPackageDeploymentConfigurationComposition,
  verifyPackagedDomainDeploymentConfigurations
}
