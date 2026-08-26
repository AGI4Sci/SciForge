import { createHash } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  writeFile
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'
import { pathToFileURL } from 'node:url'

import { tsImport } from 'tsx/esm/api'

import {
  LOCAL_CONTENT_SPACE_AUTHORIZATION_PACKAGE_FILES,
  localContentSpaceAuthorizationRuntimeSources,
  renderLocalContentSpaceAuthorizationPackageFiles
} from './content-space-local-authorization-package.mjs'
import { generateDomainPackageFiles } from './domain-packages.mjs'

const AUTHORIZATION_RECEIPT = 'authorization-package-receipt.json'
const AUTHORIZATION_RECEIPT_KIND =
  'sciforge-local-content-space-authorization-package'
const PROFILE_LOCATION = 'main.content-space-verification-profile'
const PROFILE_VERSION = '2.0.0'
const MAX_PACKAGE_FILES = 32
const MAX_PACKAGE_FILE_BYTES = 2 * 1024 * 1024
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const repositoryModulePromises = new Map()

export async function composeStage4PrivateDomainPackages(options) {
  const repositoryRoot = await requireCanonicalDirectory(
    options?.repositoryRoot,
    'Stage 4 source repository'
  )
  const stagingProjectRoot = await requireCanonicalDirectory(
    options?.stagingProjectRoot,
    'Stage 4 composition workspace'
  )
  const packagePaths = options?.privateDomainPackagePaths
  const now = options?.now instanceof Date ? options.now : new Date()
  if (Array.isArray(packagePaths) && packagePaths.length === 0) {
    throw new Error(
      '[stage4-private-domain] Stage 4 acceptance requires a reviewed private ' +
      'Content Space verification-profile contribution.'
    )
  }
  if (!Array.isArray(packagePaths) || packagePaths.length > 16 ||
    !Number.isFinite(now.getTime())) {
    throw new Error('[stage4-private-domain] Private package composition input is invalid.')
  }

  const contracts = await loadCanonicalContracts(repositoryRoot)

  const inspected = []
  for (const packagePath of packagePaths) {
    inspected.push(await inspectPrivateDomainPackage({
      packagePath,
      repositoryRoot,
      now,
      definePolicy: contracts.definePolicy,
      parseDefinition: contracts.parseDefinition,
      profileSchema: contracts.profileSchema
    }))
  }
  assertUniquePackages(inspected)

  const domainsRoot = resolve(stagingProjectRoot, 'packages', 'domains')
  await requireCanonicalDirectory(domainsRoot, 'Stage 4 domains staging directory')
  for (const candidate of inspected) {
    const destination = resolve(domainsRoot, `private-${candidate.sha256.slice(0, 24)}`)
    await mkdir(destination, { mode: 0o700 })
    for (const file of candidate.files) {
      const target = resolveContained(destination, file.path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 })
    }
  }

  const domainPackages = await generateDomainPackageFiles(stagingProjectRoot, {
    parseDefinition: contracts.parseDefinition
  })
  const installedNames = new Set(domainPackages.map((candidate) => candidate.packageName))
  for (const candidate of inspected) {
    if (!installedNames.has(candidate.packageName)) {
      throw new Error(
        '[stage4-private-domain] Staged package is absent from generated composition.'
      )
    }
  }

  return Object.freeze({
    domainPackages: Object.freeze(domainPackages.map((candidate) => Object.freeze({
      packageName: candidate.packageName,
      moduleVersion: candidate.definition.module.version
    }))),
    privateDomainPackages: Object.freeze(inspected.map((candidate) => Object.freeze({
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      provenance: 'external-local-package',
      sha256: candidate.sha256,
      verificationStatus: 'verification-profile-verified'
    })))
  })
}

export async function verifyStage4PrivateDomainPackage(options) {
  const repositoryRoot = await requireCanonicalDirectory(
    options?.repositoryRoot,
    'Stage 4 source repository'
  )
  const now = options?.now instanceof Date ? options.now : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error('[stage4-private-domain] Private package verification time is invalid.')
  }
  const contracts = await loadCanonicalContracts(repositoryRoot)
  const inspected = await inspectPrivateDomainPackage({
    packagePath: options?.packagePath,
    repositoryRoot,
    now,
    definePolicy: contracts.definePolicy,
    parseDefinition: contracts.parseDefinition,
    profileSchema: contracts.profileSchema
  })
  return Object.freeze({
    privateContributions: inspected.privateContributions,
    privateDomainPackage: Object.freeze({
      packageName: inspected.packageName,
      packageVersion: inspected.packageVersion,
      provenance: 'external-local-package',
      sha256: inspected.sha256,
      verificationStatus: 'verification-profile-verified'
    })
  })
}

export async function verifyStage4PrivateDomainPackageInputs(options) {
  const packagePaths = options?.privateDomainPackagePaths
  if (!Array.isArray(packagePaths) || packagePaths.length < 1 || packagePaths.length > 16) {
    throw new Error(
      '[stage4-private-domain] Stage 4 acceptance requires one or more private packages.'
    )
  }
  const verified = []
  for (const packagePath of packagePaths) {
    verified.push(await verifyStage4PrivateDomainPackage({
      repositoryRoot: options?.repositoryRoot,
      packagePath,
      ...(options?.now instanceof Date ? { now: options.now } : {})
    }))
  }
  assertUniquePackages(verified.map((entry) => ({
    packageName: entry.privateDomainPackage.packageName,
    sha256: entry.privateDomainPackage.sha256
  })))
  const contributionKeys = new Set()
  const privateContributions = []
  for (const entry of verified) {
    for (const contribution of entry.privateContributions) {
      const key = `${contribution.process}:${contribution.kind}:${contribution.id}`
      if (contributionKeys.has(key)) {
        throw new Error('[stage4-private-domain] Private contribution identity is duplicated.')
      }
      contributionKeys.add(key)
      privateContributions.push(contribution)
    }
  }
  return Object.freeze({
    privateContributions: Object.freeze(privateContributions.sort((left, right) =>
      `${left.packageName}:${left.id}`.localeCompare(`${right.packageName}:${right.id}`)
    )),
    privateDomainPackages: Object.freeze(verified
      .map((entry) => entry.privateDomainPackage)
      .sort((left, right) => left.packageName.localeCompare(right.packageName)))
  })
}

async function loadCanonicalContracts(repositoryRoot) {
  const definitionModule = await importRepositoryModule(
    repositoryRoot,
    'packages/domain-sdk/src/contract.ts'
  )
  const verificationPolicyModule = await importRepositoryModule(
    repositoryRoot,
    'packages/domains/content-space/src/verification-policy.ts'
  )
  const parseDefinition = definitionModule.defineTrustedDomainPackage
  const definePolicy = verificationPolicyModule.defineContentSpaceVerificationPolicy
  const profileSchema =
    verificationPolicyModule.contentSpaceVerificationProfileContributionSchema
  if (typeof parseDefinition !== 'function' || typeof definePolicy !== 'function' ||
    typeof profileSchema?.safeParse !== 'function') {
    throw new Error('[stage4-private-domain] Canonical domain contracts are unavailable.')
  }
  return Object.freeze({ definePolicy, parseDefinition, profileSchema })
}

async function inspectPrivateDomainPackage({
  packagePath,
  repositoryRoot,
  now,
  definePolicy,
  parseDefinition,
  profileSchema
}) {
  if (typeof packagePath !== 'string' || !isAbsolute(packagePath)) {
    throw new Error('[stage4-private-domain] Private domain package path must be absolute.')
  }
  const packageRoot = await requireCanonicalDirectory(
    packagePath,
    'Private domain package'
  )
  await requirePrivatePackageRoot(packageRoot)
  let files
  try {
    files = await readPrivatePackageFiles(packageRoot)
  } catch (error) {
    if (isPrivateDomainError(error)) throw error
    throw new Error(
      '[stage4-private-domain] Private domain package could not be read safely.'
    )
  }
  const fileByPath = new Map(files.map((file) => [file.path, file]))
  const packageJson = parseJsonFile(fileByPath, 'package.json', 'package metadata')
  let manifest
  try {
    manifest = parseDefinition(
      parseJsonFile(fileByPath, 'sciforge.domain.json', 'domain manifest')
    )
  } catch {
    throw new Error('[stage4-private-domain] Private domain package manifest is invalid.')
  }
  const receipt = parseJsonFile(
    fileByPath,
    AUTHORIZATION_RECEIPT,
    'authorization package receipt'
  )
  validateCanonicalAuthorizationRuntime(fileByPath)

  if (packageJson.name !== manifest.packageName ||
    packageJson.version !== manifest.module.version ||
    packageJson.private !== true || manifest.composition !== 'production') {
    throw new Error('[stage4-private-domain] Private package identity is invalid.')
  }
  if (manifest.entrypoints.length !== 1 || manifest.entrypoints[0].process !== 'main') {
    throw new Error('[stage4-private-domain] Private package must be main-only.')
  }
  const declarations = manifest.entrypoints[0].contributions
  if (declarations.length < 1) {
    throw new Error('[stage4-private-domain] Private package has no contribution.')
  }
  const profiles = []
  for (const declaration of declarations) {
    const contract = manifest.contributionContracts[declaration.id]
    const parsed = profileSchema.safeParse(contract)
    if (declaration.kind !== 'main.extension' || declaration.version !== PROFILE_VERSION ||
      declaration.publicRelease !== 'forbidden' || !parsed.success ||
      parsed.data.location !== PROFILE_LOCATION) {
      throw new Error(
        '[stage4-private-domain] Private package contribution is not an allowed verification profile.'
      )
    }
    const validFrom = Date.parse(parsed.data.profile.validFrom)
    const expiresAt = Date.parse(parsed.data.profile.expiresAt)
    if (now.getTime() < validFrom || now.getTime() >= expiresAt) {
      throw new Error('[stage4-private-domain] Private verification profile is not currently valid.')
    }
    profiles.push(parsed.data.profile)
  }
  try {
    definePolicy({ contractVersion: PROFILE_VERSION, profiles })
  } catch {
    throw new Error('[stage4-private-domain] Private verification policy is invalid.')
  }
  validateAuthorizationReceipt({ fileByPath, manifest, packageJson, receipt })
  await validateCanonicalAuthorizationPackage({
    fileByPath,
    profiles,
    receipt,
    repositoryRoot
  })

  return Object.freeze({
    files,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    privateContributions: Object.freeze(declarations.map((declaration) => {
      const contract = manifest.contributionContracts[declaration.id]
      return Object.freeze({
        contractLocation: contract.location,
        contractSha256: sha256(Buffer.from(canonicalJson(contract))),
        id: declaration.id,
        kind: declaration.kind,
        packageName: packageJson.name,
        process: 'main',
        version: declaration.version ?? null
      })
    })),
    sha256: sha256(Buffer.from(canonicalJson(files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size: file.bytes.byteLength
    })))))
  })
}

async function validateCanonicalAuthorizationPackage({
  fileByPath,
  profiles,
  receipt,
  repositoryRoot
}) {
  const expectedFiles = await renderLocalContentSpaceAuthorizationPackageFiles({
    repositoryRoot,
    packageId: receipt.packageId,
    profiles: [...profiles].sort((left, right) =>
      left.profileId.localeCompare(right.profileId)
    ),
    sourceRequestSha256: receipt.sourceRequestSha256
  })
  for (const [path, source] of Object.entries(expectedFiles)) {
    const file = fileByPath.get(path)
    if (!file || !file.bytes.equals(Buffer.from(source))) {
      throw new Error(
        '[stage4-private-domain] Authorization package contents are not canonical.'
      )
    }
  }
}

function validateCanonicalAuthorizationRuntime(fileByPath) {
  for (const [path, source] of Object.entries(
    localContentSpaceAuthorizationRuntimeSources()
  )) {
    const file = fileByPath.get(path)
    if (!file || !file.bytes.equals(Buffer.from(source))) {
      const label = path === 'src/main.ts' ? 'main runtime' : 'definition'
      throw new Error(
        `[stage4-private-domain] Authorization package ${label} source is not canonical.`
      )
    }
  }
}

function validateAuthorizationReceipt({ fileByPath, manifest, packageJson, receipt }) {
  const allowedPaths = new Set([
    ...LOCAL_CONTENT_SPACE_AUTHORIZATION_PACKAGE_FILES,
    AUTHORIZATION_RECEIPT
  ])
  if (allowedPaths.size !== fileByPath.size ||
    [...fileByPath.keys()].some((path) => !allowedPaths.has(path))) {
    throw new Error('[stage4-private-domain] Private package structure is unexpected.')
  }
  requireExactKeys(receipt, [
    'contractVersion',
    'inventory',
    'kind',
    'moduleId',
    'packageId',
    'packageName',
    'profileCount',
    'profiles',
    'sourceRequestSha256'
  ], 'authorization package receipt')
  if (receipt.contractVersion !== 1 || receipt.kind !== AUTHORIZATION_RECEIPT_KIND ||
    receipt.packageName !== packageJson.name || receipt.moduleId !== manifest.module.id ||
    !SHA256_PATTERN.test(receipt.sourceRequestSha256) ||
    !Array.isArray(receipt.inventory) || !Array.isArray(receipt.profiles) ||
    receipt.profileCount !== receipt.profiles.length) {
    throw new Error('[stage4-private-domain] Authorization package receipt is invalid.')
  }

  const inventoryPaths = new Set()
  for (const entry of receipt.inventory) {
    requireExactKeys(entry, ['path', 'sha256', 'size'], 'authorization inventory entry')
    const file = fileByPath.get(entry.path)
    if (!file || inventoryPaths.has(entry.path) ||
      !SHA256_PATTERN.test(entry.sha256) || entry.sha256 !== file.sha256 ||
      entry.size !== file.bytes.byteLength || entry.path === AUTHORIZATION_RECEIPT) {
      throw new Error('[stage4-private-domain] Authorization package inventory is invalid.')
    }
    inventoryPaths.add(entry.path)
  }
  const expectedPaths = new Set([...inventoryPaths, AUTHORIZATION_RECEIPT])
  if (expectedPaths.size !== fileByPath.size ||
    [...fileByPath.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error('[stage4-private-domain] Private package structure is unexpected.')
  }

  const declarations = manifest.entrypoints.flatMap((entrypoint) => entrypoint.contributions)
  if (receipt.profileCount !== declarations.length) {
    throw new Error('[stage4-private-domain] Authorization profile count is invalid.')
  }
  const declarationById = new Map(declarations.map((entry) => [entry.id, entry]))
  const profileIds = new Set()
  for (const profile of receipt.profiles) {
    requireExactKeys(
      profile,
      ['contractSha256', 'contributionId', 'profileId'],
      'authorization profile receipt'
    )
    const declaration = declarationById.get(profile.contributionId)
    const contract = manifest.contributionContracts[profile.contributionId]
    if (!declaration || !contract || profileIds.has(profile.profileId) ||
      profile.profileId !== contract.profile?.profileId ||
      profile.contractSha256 !== sha256(Buffer.from(canonicalJson(contract)))) {
      throw new Error('[stage4-private-domain] Authorization profile receipt is invalid.')
    }
    profileIds.add(profile.profileId)
  }
}

async function readPrivatePackageFiles(root) {
  const files = []
  let totalBytes = 0
  await visit(root, '')
  files.sort((left, right) => left.path.localeCompare(right.path))
  if (files.length < 1 || files.length > MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error('[stage4-private-domain] Private package exceeds bounded structure limits.')
  }
  return Object.freeze(files)

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes(sep)) {
        throw new Error('[stage4-private-domain] Private package path is invalid.')
      }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = join(directory, entry.name)
      const stats = await lstat(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error('[stage4-private-domain] Private package contains a symbolic link.')
      }
      if (stats.isDirectory()) {
        if (!isOwnerOnly(stats)) {
          throw new Error('[stage4-private-domain] Private package directory is not owner-only.')
        }
        if (await realpath(absolutePath) !== absolutePath) {
          throw new Error('[stage4-private-domain] Private package contains a symbolic link.')
        }
        await visit(absolutePath, path)
        continue
      }
      if (stats.isFile() && stats.nlink !== 1) {
        throw new Error('[stage4-private-domain] Private package file is hard-linked.')
      }
      if (!stats.isFile() || stats.size < 1 || stats.size > MAX_PACKAGE_FILE_BYTES ||
        !isOwnerOnly(stats)) {
        throw new Error('[stage4-private-domain] Private package file is invalid.')
      }
      if (await realpath(absolutePath) !== absolutePath) {
        throw new Error('[stage4-private-domain] Private package contains a symbolic link.')
      }
      const bytes = await readNoFollowFile(absolutePath, stats)
      totalBytes += bytes.byteLength
      files.push(Object.freeze({
        bytes,
        path,
        sha256: sha256(bytes)
      }))
    }
  }
}

async function readNoFollowFile(path, expectedStats) {
  let handle
  try {
    handle = await open(path, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0))
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size !== expectedStats.size || stats.nlink !== 1 ||
      stats.dev !== expectedStats.dev || stats.ino !== expectedStats.ino ||
      !isOwnerOnly(stats)) {
      throw new Error('[stage4-private-domain] Private package file changed during validation.')
    }
    const bytes = await handle.readFile()
    const current = await lstat(path)
    if (!current.isFile() || current.isSymbolicLink() || current.size !== stats.size ||
      current.nlink !== 1 || current.dev !== stats.dev || current.ino !== stats.ino ||
      await realpath(path) !== path) {
      throw new Error('[stage4-private-domain] Private package file changed during validation.')
    }
    return bytes
  } finally {
    await handle?.close()
  }
}

async function requirePrivatePackageRoot(root) {
  let stats
  try {
    stats = await lstat(root)
  } catch {
    throw new Error(
      '[stage4-private-domain] Private domain package root is not owner-only.'
    )
  }
  if (!stats.isDirectory() || !isOwnerOnly(stats)) {
    throw new Error('[stage4-private-domain] Private domain package root is not owner-only.')
  }
}

function isOwnerOnly(stats) {
  if (process.platform === 'win32') return true
  const ownedByProcess = typeof process.getuid !== 'function' || stats.uid === process.getuid()
  return ownedByProcess && (stats.mode & 0o077) === 0
}

async function requireCanonicalDirectory(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`[stage4-private-domain] ${label} must be an absolute path.`)
  }
  const absolute = resolve(value)
  let stats
  let canonical
  try {
    stats = await lstat(absolute)
    canonical = await realpath(absolute)
  } catch {
    throw new Error(`[stage4-private-domain] ${label} must be a canonical real directory.`)
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || canonical !== absolute) {
    throw new Error(`[stage4-private-domain] ${label} must be a canonical real directory.`)
  }
  return absolute
}

function isPrivateDomainError(error) {
  return error instanceof Error && error.message.startsWith('[stage4-private-domain]')
}

function parseJsonFile(fileByPath, path, label) {
  const file = fileByPath.get(path)
  if (!file) throw new Error(`[stage4-private-domain] Missing ${label}.`)
  try {
    return JSON.parse(file.bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`[stage4-private-domain] Invalid ${label}.`, { cause: error })
  }
}

function requireExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[stage4-private-domain] ${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    throw new Error(`[stage4-private-domain] ${label} has invalid fields.`)
  }
}

function assertUniquePackages(packages) {
  const names = new Set()
  const digests = new Set()
  for (const candidate of packages) {
    if (names.has(candidate.packageName) || digests.has(candidate.sha256)) {
      throw new Error('[stage4-private-domain] Private domain package input is duplicated.')
    }
    names.add(candidate.packageName)
    digests.add(candidate.sha256)
  }
}

function resolveContained(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('[stage4-private-domain] Private package path is not safe.')
  }
  const target = resolve(root, ...path.split('/'))
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)) {
    throw new Error('[stage4-private-domain] Private package path escapes staging.')
  }
  return target
}

async function importRepositoryModule(repositoryRoot, relativePath) {
  const path = resolve(repositoryRoot, ...relativePath.split('/'))
  const url = pathToFileURL(path).href
  let pending = repositoryModulePromises.get(url)
  if (!pending) {
    pending = tsImport(url, { parentURL: import.meta.url })
    repositoryModulePromises.set(url, pending)
  }
  return pending
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!value || typeof value !== 'object') {
    throw new Error('[stage4-private-domain] Private package contains non-JSON data.')
  }
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
