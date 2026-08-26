#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'

import {
  installInternalOverlay,
  verifyInternalOverlay,
  verifyInstalledInternalOverlaySync
} from './internal-overlay-package.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_DELIVERY_BYTES = 64 * 1024 * 1024
const MAX_OVERLAY_BYTES = 48 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const DELIVERY_DOCUMENTS = Object.freeze([
  'README-install.zh-CN.md',
  'opencontent-attachment-distribution.md',
  'opencontent-private-attachment-runbook.zh-CN.md',
  'opencontent-skill-capability-matrix.md'
])

export async function verifyOpenContentTeamDelivery(options) {
  const verified = await loadVerifiedDelivery(options)
  return verified.summary
}

export async function installOpenContentTeamDelivery(options) {
  const targetRoot = resolve(requireString(options?.targetRoot, 'targetRoot'))
  await requireRealDirectory(targetRoot, 'OpenContent delivery target')
  const verified = await loadVerifiedDelivery({
    deliveryPath: options?.deliveryPath,
    targetRoot
  })
  const deploymentTarget = resolveContainedPath(
    targetRoot,
    verified.deploymentDescriptor.sourceRelativePath
  )
  const existingConfiguration = await readOptionalRegularFile(
    targetRoot,
    deploymentTarget,
    verified.deploymentDescriptor.maxBytes
  )
  if (existingConfiguration !== null &&
    !existingConfiguration.equals(verified.deploymentConfigurationBytes)) {
    throw new Error(
      `OpenContent deployment configuration conflicts with ${deploymentTarget}; ` +
      'the team delivery installer never overwrites a different deployment.'
    )
  }

  const overlay = await installInternalOverlay({
    archiveBytes: verified.overlayArchiveBytes,
    expectedSha256: verified.trust.overlayArchiveSha256,
    targetRoot
  })
  let deploymentStatus = 'already-installed'
  if (existingConfiguration === null) {
    await ensureContainedDirectory(targetRoot, dirname(deploymentTarget))
    await writeFile(deploymentTarget, verified.deploymentConfigurationBytes, {
      flag: 'wx',
      mode: 0o600
    })
    deploymentStatus = 'installed'
  } else if (await secureDeploymentPermissions(targetRoot, deploymentTarget)) {
    deploymentStatus = 'permissions-repaired'
  }

  const installed = verifyInstalledInternalOverlaySync({
    overlayId: verified.trust.overlayId,
    overlayRoot: verified.overlayRoot,
    targetRoot
  })
  if (installed.archiveSha256 !== verified.trust.overlayArchiveSha256 ||
    installed.version !== verified.trust.overlayVersion) {
    throw new Error('Installed OpenContent overlay does not match the trusted team delivery.')
  }
  const installedConfiguration = await readOptionalRegularFile(
    targetRoot,
    deploymentTarget,
    verified.deploymentDescriptor.maxBytes
  )
  if (installedConfiguration === null ||
    sha256(installedConfiguration) !== verified.trust.deploymentConfigurationSha256) {
    throw new Error('Installed OpenContent deployment configuration failed verification.')
  }

  return Object.freeze({
    ...verified.summary,
    deploymentStatus,
    overlayStatus: overlay.status,
    receiptPath: overlay.receiptPath
  })
}

async function loadVerifiedDelivery(options) {
  const targetRoot = resolve(options?.targetRoot || REPOSITORY_ROOT)
  await requireRealDirectory(targetRoot, 'OpenContent delivery target')
  const deliveryPath = resolve(requireString(options?.deliveryPath, 'deliveryPath'))
  const deliveryEntry = await lstat(deliveryPath)
  if (deliveryEntry.isSymbolicLink() || !deliveryEntry.isFile() ||
    deliveryEntry.size < 1 || deliveryEntry.size > MAX_DELIVERY_BYTES) {
    throw new Error('OpenContent team delivery must be a bounded regular ZIP file.')
  }
  const deliveryBytes = await readFile(deliveryPath)
  const deliverySha256 = sha256(deliveryBytes)
  const packageContract = await readPackageContract(targetRoot)
  const trust = packageContract.deliveries.find((entry) =>
    entry.deliverySha256 === deliverySha256
  )
  if (!trust) {
    throw new Error(
      'OpenContent team delivery is not present in this checkout\'s package-owned trust set.'
    )
  }
  if (basename(deliveryPath) !== trust.deliveryFileName) {
    throw new Error(
      `OpenContent team delivery must retain its trusted file name: ${trust.deliveryFileName}`
    )
  }

  const archive = await JSZip.loadAsync(deliveryBytes, {
    checkCRC32: true,
    createFolders: false
  })
  const entries = validateDeliveryEntries(archive, trust)
  const overlayArchiveName =
    `sciforge-${trust.overlayId}-${trust.overlayVersion}.zip`
  const overlaySidecarName = `${overlayArchiveName}.sha256`
  const overlayArchiveBytes = await readEntry(
    entries.get(overlayArchiveName),
    overlayArchiveName,
    MAX_OVERLAY_BYTES
  )
  if (sha256(overlayArchiveBytes) !== trust.overlayArchiveSha256) {
    throw new Error('OpenContent delivery overlay digest does not match package-owned trust.')
  }
  const overlaySidecar = await readEntry(
    entries.get(overlaySidecarName),
    overlaySidecarName,
    1024
  )
  const expectedSidecar =
    `${trust.overlayArchiveSha256}  ${overlayArchiveName}\n`
  if (overlaySidecar.toString('utf8') !== expectedSidecar) {
    throw new Error('OpenContent delivery overlay sidecar is not canonical.')
  }
  const overlay = await verifyInternalOverlay({
    archiveBytes: overlayArchiveBytes,
    expectedSha256: trust.overlayArchiveSha256
  })
  if (overlay.overlayId !== trust.overlayId ||
    overlay.version !== trust.overlayVersion ||
    overlay.overlayRoot !== trust.overlayRoot) {
    throw new Error('OpenContent delivery overlay identity does not match package-owned trust.')
  }

  const deploymentConfigurationBytes = await readEntry(
    entries.get(trust.deploymentConfigurationFileName),
    trust.deploymentConfigurationFileName,
    packageContract.deploymentDescriptor.maxBytes
  )
  if (sha256(deploymentConfigurationBytes) !==
    trust.deploymentConfigurationSha256) {
    throw new Error(
      'OpenContent delivery deployment configuration digest does not match package-owned trust.'
    )
  }
  const deploymentConfiguration = parseDeploymentConfiguration(
    deploymentConfigurationBytes,
    packageContract.providerInstanceRef
  )

  for (const document of DELIVERY_DOCUMENTS) {
    await readEntry(entries.get(document), document, MAX_DOCUMENT_BYTES)
  }
  return Object.freeze({
    deploymentConfigurationBytes,
    deploymentDescriptor: packageContract.deploymentDescriptor,
    overlayArchiveBytes,
    overlayRoot: overlay.overlayRoot,
    trust,
    summary: Object.freeze({
      contractVersion: 1,
      deliveryFileName: trust.deliveryFileName,
      deliveryId: trust.deliveryId,
      deliverySha256,
      deployment: Object.freeze({
        providerInstanceRef: deploymentConfiguration.providerInstanceRef,
        sha256: trust.deploymentConfigurationSha256
      }),
      overlay: Object.freeze({
        archiveSha256: trust.overlayArchiveSha256,
        fileCount: overlay.files.length,
        overlayId: overlay.overlayId,
        version: overlay.version
      }),
      status: 'verified'
    })
  })
}

function validateDeliveryEntries(archive, trust) {
  const entries = new Map()
  for (const entry of Object.values(archive.files)) {
    const entryName = entry.name
    const originalName = entry.unsafeOriginalName ?? entryName
    if (entry.dir || entryName !== originalName ||
      !isSafeFlatFileName(entryName) || isSymlink(entry) || entries.has(entryName)) {
      throw new Error(`Unsafe OpenContent team delivery entry: ${entryName}`)
    }
    entries.set(entryName, entry)
  }
  const overlayArchiveName = `sciforge-${trust.overlayId}-${trust.overlayVersion}.zip`
  const expected = [
    ...DELIVERY_DOCUMENTS,
    trust.deploymentConfigurationFileName,
    overlayArchiveName,
    `${overlayArchiveName}.sha256`
  ].sort()
  const actual = [...entries.keys()].sort()
  if (actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])) {
    throw new Error('OpenContent team delivery inventory does not match its fixed contract.')
  }
  return entries
}

async function readPackageContract(targetRoot) {
  const packageRoot = resolve(targetRoot, 'packages/domains/opencontent-connector')
  const packageJson = JSON.parse(await readFile(
    resolve(packageRoot, 'package.json'),
    'utf8'
  ))
  const manifest = JSON.parse(await readFile(
    resolve(packageRoot, 'sciforge.domain.json'),
    'utf8'
  ))
  if (packageJson.name !== manifest.packageName) {
    throw new Error('OpenContent package and domain manifest identities differ.')
  }
  const deploymentDescriptor = parseDeploymentDescriptor(
    packageJson.sciforgeDeploymentConfiguration
  )
  const deploymentFileName = basename(deploymentDescriptor.sourceRelativePath)
  if (deploymentFileName !== basename(
    deploymentDescriptor.packagedResourcesRelativePath
  )) {
    throw new Error('OpenContent source and packaged deployment file names differ.')
  }
  const providerInstances = Object.values(manifest.contributionContracts || {})
    .filter((contract) =>
      isRecord(contract) && contract.location === 'main.provider-instance-directory-entry'
    )
  if (providerInstances.length !== 1 ||
    typeof providerInstances[0].providerInstanceRef !== 'string' ||
    !providerInstances[0].providerInstanceRef) {
    throw new Error('OpenContent package has no unique manifest-owned Provider Instance.')
  }
  const trustContract = packageJson.sciforgeTeamDeliveryTrust
  requireExactRecord(
    trustContract,
    ['contractVersion', 'deliveries'],
    'OpenContent team delivery trust'
  )
  if (trustContract.contractVersion !== 1 ||
    !Array.isArray(trustContract.deliveries) || trustContract.deliveries.length === 0) {
    throw new Error('OpenContent team delivery trust contract is invalid.')
  }
  const runtimeInstallations = parseInternalRuntimeInstallations(
    packageJson.sciforgeInternalRuntimeTrust
  )
  const deliveryIds = new Set()
  const deliveryDigests = new Set()
  const deliveries = trustContract.deliveries.map((entry) => {
    requireExactRecord(entry, [
      'deliveryFileName',
      'deliveryId',
      'deliverySha256',
      'deploymentConfigurationFileName',
      'deploymentConfigurationSha256',
      'overlayArchiveSha256',
      'overlayId',
      'overlayVersion'
    ], 'OpenContent trusted team delivery')
    const values = [
      entry.deliveryFileName,
      entry.deliveryId,
      entry.deploymentConfigurationFileName,
      entry.overlayId,
      entry.overlayVersion
    ]
    if (!values
      .every((value) => typeof value === 'string' && Boolean(value)) ||
      !isSafeFlatFileName(entry.deliveryFileName) ||
      !isSafeFlatFileName(entry.deploymentConfigurationFileName) ||
      entry.deploymentConfigurationFileName !== deploymentFileName ||
      !SHA256_PATTERN.test(entry.deliverySha256) ||
      !SHA256_PATTERN.test(entry.deploymentConfigurationSha256) ||
      !SHA256_PATTERN.test(entry.overlayArchiveSha256) ||
      deliveryIds.has(entry.deliveryId) || deliveryDigests.has(entry.deliverySha256)) {
      throw new Error('OpenContent trusted team delivery entry is invalid or duplicated.')
    }
    const runtimeMatches = runtimeInstallations.filter((installation) =>
      installation.overlayId === entry.overlayId
    )
    if (runtimeMatches.length !== 1 ||
      runtimeMatches[0].version !== entry.overlayVersion ||
      runtimeMatches[0].archiveSha256 !== entry.overlayArchiveSha256) {
      throw new Error(
        'OpenContent team delivery does not match package-owned internal runtime trust.'
      )
    }
    deliveryIds.add(entry.deliveryId)
    deliveryDigests.add(entry.deliverySha256)
    return Object.freeze({
      ...entry,
      overlayRoot: runtimeMatches[0].overlayRoot
    })
  })
  return Object.freeze({
    deliveries: Object.freeze(deliveries),
    deploymentDescriptor,
    providerInstanceRef: providerInstances[0].providerInstanceRef
  })
}

function parseInternalRuntimeInstallations(value) {
  if (!isRecord(value) || value.contractVersion !== 1 ||
    !Array.isArray(value.installations) || value.installations.length === 0) {
    throw new Error('OpenContent internal runtime trust contract is invalid.')
  }
  return value.installations.map((entry) => {
    if (!isRecord(entry) || typeof entry.overlayId !== 'string' ||
      typeof entry.version !== 'string' ||
      !SHA256_PATTERN.test(entry.archiveSha256) ||
      typeof entry.overlayRoot !== 'string') {
      throw new Error('OpenContent internal runtime trust installation is invalid.')
    }
    const overlayRoot = safeRelativePath(entry.overlayRoot)
    if (!overlayRoot.startsWith('internal/')) {
      throw new Error('OpenContent internal runtime overlay root escapes internal/.')
    }
    return Object.freeze({
      archiveSha256: entry.archiveSha256,
      overlayId: entry.overlayId,
      overlayRoot,
      version: entry.version
    })
  })
}

function parseDeploymentDescriptor(value) {
  requireExactRecord(value, [
    'contractVersion',
    'maxBytes',
    'packagedResourcesRelativePath',
    'publicRelease',
    'sourceRelativePath'
  ], 'OpenContent deployment descriptor')
  if (value.contractVersion !== 1 || !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 || value.publicRelease !== 'allowed') {
    throw new Error('OpenContent deployment descriptor is invalid.')
  }
  return Object.freeze({
    ...value,
    sourceRelativePath: safeRelativePath(value.sourceRelativePath),
    packagedResourcesRelativePath: safeRelativePath(
      value.packagedResourcesRelativePath
    )
  })
}

function parseDeploymentConfiguration(bytes, providerInstanceRef) {
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error('OpenContent delivery deployment configuration is not valid JSON.', {
      cause: error
    })
  }
  requireExactRecord(
    value,
    ['contractVersion', 'origin', 'providerInstanceRef'],
    'OpenContent delivery deployment configuration'
  )
  if (value.contractVersion !== 1 || value.providerInstanceRef !== providerInstanceRef ||
    !isAbsoluteHttpsOrigin(value.origin)) {
    throw new Error('OpenContent delivery deployment configuration is invalid.')
  }
  return Object.freeze(value)
}

async function readEntry(entry, name, maxBytes) {
  if (!entry) throw new Error(`OpenContent team delivery is missing ${name}.`)
  const bytes = await entry.async('nodebuffer')
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw new Error(`OpenContent team delivery entry ${name} exceeds its size contract.`)
  }
  return bytes
}

async function readOptionalRegularFile(root, path, maxBytes) {
  try {
    await assertPathWithoutSymlinks(root, path)
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maxBytes) {
      throw new Error(`OpenContent deployment target is not a bounded regular file: ${path}`)
    }
    return readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function ensureContainedDirectory(root, directory) {
  const target = resolveContainedPath(root, relative(root, directory))
  const relation = relative(root, target)
  let current = root
  for (const segment of relation.split(sep)) {
    current = join(current, segment)
    try {
      const entry = await lstat(current)
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`OpenContent deployment parent is unsafe: ${current}`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
}

async function secureDeploymentPermissions(root, target) {
  if (process.platform === 'win32') return false
  await assertPathWithoutSymlinks(root, target)
  const handle = await open(
    target,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW
  )
  try {
    const entry = await handle.stat()
    if (!entry.isFile()) {
      throw new Error(`OpenContent deployment target is not a regular file: ${target}`)
    }
    if ((entry.mode & 0o777) === 0o600) return false
    await handle.chmod(0o600)
    return true
  } finally {
    await handle.close()
  }
}

async function assertPathWithoutSymlinks(root, target) {
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)) {
    throw new Error('OpenContent deployment target escapes its checkout.')
  }
  let current = root
  for (const segment of relation.split(sep)) {
    current = join(current, segment)
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) {
      throw new Error(`OpenContent deployment path contains a symbolic link: ${current}`)
    }
  }
}

async function requireRealDirectory(path, label) {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error(`${label} must be a canonical real directory.`)
  }
}

function resolveContainedPath(root, relativePath) {
  const normalized = safeRelativePath(relativePath)
  const target = resolve(root, ...normalized.split('/'))
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)) {
    throw new Error('OpenContent delivery path escapes its checkout.')
  }
  return target
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
    isAbsolute(value) || value.split('/').some((part) =>
      !part || part === '.' || part === '..'
    )) {
    throw new Error('OpenContent delivery path must be a safe relative slash path.')
  }
  return value
}

function isSafeFlatFileName(value) {
  return typeof value === 'string' && Boolean(value) &&
    value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

function isSymlink(entry) {
  return typeof entry.unixPermissions === 'number' &&
    (entry.unixPermissions & 0o170000) === 0o120000
}

function isAbsoluteHttpsOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash && url.origin === value
  } catch {
    return false
  }
}

function requireExactRecord(value, expectedKeys, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has invalid fields.`)
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OpenContent team delivery ${label} is required.`)
  }
  return value.trim()
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseCli(argv) {
  const [command, ...remaining] = argv
  if (!['verify', 'install'].includes(command)) {
    throw new Error(
      'Usage: node scripts/opencontent-team-delivery.mjs verify|install ' +
      '--delivery /absolute/path/to/delivery.zip [--target /checkout]'
    )
  }
  const flags = new Map()
  for (let index = 0; index < remaining.length; index += 1) {
    const flag = remaining[index]
    if (!['--delivery', '--target'].includes(flag) || flags.has(flag)) {
      throw new Error(`Unknown or duplicate OpenContent delivery option: ${flag}`)
    }
    const value = remaining[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    flags.set(flag, value)
    index += 1
  }
  if (!flags.has('--delivery')) throw new Error('--delivery is required.')
  return Object.freeze({
    command,
    deliveryPath: resolve(flags.get('--delivery')),
    targetRoot: resolve(flags.get('--target') || REPOSITORY_ROOT)
  })
}

async function main(argv) {
  const options = parseCli(argv)
  const result = options.command === 'verify'
    ? await verifyOpenContentTeamDelivery(options)
    : await installOpenContentTeamDelivery(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[opencontent-team-delivery] ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
