const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  closeSync,
  createReadStream,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync
} = require('node:fs')
const { release } = require('node:os')
const { basename, dirname, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const CONTRACT_VERSION = 1
const RECEIPT_KIND = 'sciforge-stage4-artifact-receipt'
const BUILD_IDENTITY_KIND = 'sciforge-stage4-acceptance'
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const MAX_RECEIPT_BYTES = 1024 * 1024
const EXPECTED_ORIGIN = 'https://github.com/SCU-areszhang/SciForge_Loop.git'
const EXPECTED_BRANCH = 'codex/full-collaboration-loop-recovery'
const ELECTRON_BUILDER_VERSION = '26.8.1'

const RECEIPT_KEYS = Object.freeze([
  'artifacts',
  'build',
  'composition',
  'contractVersion',
  'kind',
  'source'
])

function readConfiguredStage4BuildIdentity(projectRoot, environment = process.env) {
  const mode = environment.SCIFORGE_STAGE4_ACCEPTANCE
  if (mode === undefined) return undefined
  if (mode !== '1') {
    throw new Error(
      '[stage4-artifact] SCIFORGE_STAGE4_ACCEPTANCE must be exactly 1 when configured.'
    )
  }
  if (environment.SCIFORGE_PUBLIC_RELEASE !== undefined) {
    throw new Error('[stage4-artifact] Stage 4 acceptance and public release modes are exclusive.')
  }
  const sourceCommit = requireSourceCommit(
    environment.SCIFORGE_STAGE4_SOURCE_COMMIT,
    'SCIFORGE_STAGE4_SOURCE_COMMIT'
  )
  const checkoutCommit = gitText(projectRoot, ['rev-parse', 'HEAD'])
  if (sourceCommit !== checkoutCommit) {
    throw new Error('[stage4-artifact] Configured source commit does not match the checkout.')
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    kind: BUILD_IDENTITY_KIND,
    sourceCommit
  })
}

function createStage4ArtifactHooks({
  afterPack,
  projectRoot,
  internalRuntimeComposition,
  deploymentConfigurationComposition
}) {
  if (typeof afterPack !== 'function') {
    throw new TypeError('[stage4-artifact] Canonical afterPack hook is required.')
  }
  const absoluteProjectRoot = resolve(projectRoot)
  const capturedInternalComposition = canonicalJson(internalRuntimeComposition)
  const capturedDeploymentComposition = canonicalJson(deploymentConfigurationComposition)
  let verifiedAfterPackCount = 0

  const wrappedAfterPack = async (context) => {
    await afterPack(context)
    if (process.env.SCIFORGE_STAGE4_ACCEPTANCE === '1') verifiedAfterPackCount += 1
  }

  const afterAllArtifactBuild = async (buildResult) => {
    const identity = readConfiguredStage4BuildIdentity(absoluteProjectRoot)
    if (identity === undefined) return []
    if (verifiedAfterPackCount === 0) {
      throw new Error(
        '[stage4-artifact] Cannot issue a receipt without a successful canonical afterPack.'
      )
    }
    if (!buildResult || !Array.isArray(buildResult.artifactPaths)) {
      throw new TypeError('[stage4-artifact] Electron Builder artifact result is invalid.')
    }

    const source = readExactSourceState(absoluteProjectRoot, true)
    if (source.commit !== identity.sourceCommit) {
      throw new Error('[stage4-artifact] Source state changed before receipt issuance.')
    }
    const startedAt = requireIsoTimestamp(
      process.env.SCIFORGE_STAGE4_BUILD_STARTED_AT,
      'SCIFORGE_STAGE4_BUILD_STARTED_AT'
    )
    const completedAt = new Date().toISOString()
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      throw new Error('[stage4-artifact] Build timestamps are not monotonic.')
    }

    const {
      createInternalRuntimeComposition
    } = require('./internal-runtime-packaging.cjs')
    const {
      createDomainPackageDeploymentConfigurationComposition
    } = require('./domain-package-deployment-config.cjs')
    const freshInternalComposition = createInternalRuntimeComposition(absoluteProjectRoot)
    const freshDeploymentComposition =
      createDomainPackageDeploymentConfigurationComposition(absoluteProjectRoot)
    if (canonicalJson(freshInternalComposition) !== capturedInternalComposition ||
      canonicalJson(freshDeploymentComposition) !== capturedDeploymentComposition) {
      throw new Error('[stage4-artifact] Private composition drifted during packaging.')
    }
    const privateContributions = await discoverPrivateContributions(absoluteProjectRoot)
    const composition = summarizePrivateComposition({
      deploymentConfigurationComposition: freshDeploymentComposition,
      internalRuntimeComposition: freshInternalComposition,
      privateContributions
    })
    assertAcceptanceComposition(composition)

    const outDir = resolve(buildResult.outDir)
    const artifacts = collectArtifacts(buildResult.artifactPaths, outDir)
    const identities = new Map()
    for (const artifact of artifacts) {
      const key = `${artifact.platform}:${artifact.architecture}`
      const values = identities.get(key) || []
      values.push(artifact)
      identities.set(key, values)
    }
    if (identities.size === 0) {
      throw new Error('[stage4-artifact] No supported Stage 4 artifact was produced.')
    }

    const toolchain = Object.freeze({
      electron: readPackageVersion(absoluteProjectRoot, 'electron'),
      electronBuilder: ELECTRON_BUILDER_VERSION,
      node: process.version,
      npm: execFileSync('npm', ['--version'], {
        cwd: absoluteProjectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    })
    for (const [key, identityArtifacts] of identities) {
      const [platform, architecture] = key.split(':')
      const canonicalCommand = canonicalBuildCommand(platform, architecture)
      const receipt = Object.freeze({
        contractVersion: CONTRACT_VERSION,
        kind: RECEIPT_KIND,
        source,
        build: Object.freeze({
          startedAt,
          completedAt,
          command: canonicalCommand,
          host: Object.freeze({
            architecture: process.arch,
            platform: process.platform,
            release: release()
          }),
          target: Object.freeze({ architecture, platform }),
          toolchain
        }),
        composition,
        artifacts: Object.freeze(
          [...identityArtifacts].sort((left, right) => left.fileName.localeCompare(right.fileName))
        )
      })
      validateReceipt(receipt)
      const path = stage4ArtifactReceiptPath(outDir, platform, architecture)
      writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o644
      })
      process.stdout.write(`[stage4-artifact] Sealed ${path}\n`)
    }
    return []
  }

  return Object.freeze({ afterPack: wrappedAfterPack, afterAllArtifactBuild })
}

function stage4ArtifactReceiptPath(distDir, platform, architecture) {
  requireTarget(platform, architecture)
  return resolve(distDir, `stage4-artifact-${platform}-${architecture}.json`)
}

function readStage4ArtifactReceipt(receiptPath) {
  const absolutePath = resolve(receiptPath)
  const stat = lstatSync(absolutePath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > MAX_RECEIPT_BYTES) {
    throw new Error('[stage4-artifact] Receipt must be a bounded regular file.')
  }
  let receipt
  try {
    receipt = JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (error) {
    throw new Error('[stage4-artifact] Receipt is not valid JSON.', { cause: error })
  }
  validateReceipt(receipt)
  const expectedPath = stage4ArtifactReceiptPath(
    dirname(absolutePath),
    receipt.build.target.platform,
    receipt.build.target.architecture
  )
  if (absolutePath !== expectedPath) {
    throw new Error('[stage4-artifact] Receipt path is not canonical for its target.')
  }
  if (readFileSync(absolutePath, 'utf8') !== `${JSON.stringify(receipt, null, 2)}\n`) {
    throw new Error('[stage4-artifact] Receipt is not canonically serialized.')
  }
  return Object.freeze({ path: absolutePath, receipt: deepFreeze(receipt) })
}

function verifyStage4ArtifactReceipt({ artifactPath, receiptPath, source }) {
  const absoluteArtifactPath = resolve(artifactPath)
  const loaded = readStage4ArtifactReceipt(receiptPath)
  if (dirname(absoluteArtifactPath) !== dirname(loaded.path)) {
    throw new Error('[stage4-artifact] Artifact and receipt must share one directory.')
  }
  if (!sameSource(loaded.receipt.source, source)) {
    throw new Error('[stage4-artifact] Receipt source identity does not match the gate checkout.')
  }
  assertAcceptanceComposition(loaded.receipt.composition)
  const fileName = basename(absoluteArtifactPath)
  const artifact = loaded.receipt.artifacts.find((candidate) => candidate.fileName === fileName)
  if (!artifact || artifact.role !== 'archive') {
    throw new Error('[stage4-artifact] Selected artifact is not a receipted Stage 4 archive.')
  }
  const descriptor = openSync(absoluteArtifactPath, 'r')
  let closed = false
  try {
    assertDescriptorMatches(descriptor, artifact)
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
  return Object.freeze({
    artifact,
    receipt: loaded.receipt,
    openReadStream() {
      if (closed) throw new Error('[stage4-artifact] Artifact receipt handle is closed.')
      return createReadStream(absoluteArtifactPath, {
        autoClose: false,
        fd: descriptor,
        start: 0
      })
    },
    assertUnchanged() {
      if (closed) throw new Error('[stage4-artifact] Artifact receipt handle is closed.')
      assertDescriptorMatches(descriptor, artifact)
      const current = lstatSync(absoluteArtifactPath)
      const held = fstatSync(descriptor)
      if (!current.isFile() || current.isSymbolicLink() ||
        current.dev !== held.dev || current.ino !== held.ino) {
        throw new Error('[stage4-artifact] Artifact path changed after receipt verification.')
      }
    },
    close() {
      if (closed) return
      closed = true
      closeSync(descriptor)
    }
  })
}

function summarizePrivateComposition({
  deploymentConfigurationComposition,
  internalRuntimeComposition,
  privateContributions
}) {
  const internalRuntimes = internalRuntimeComposition.packagedRuntimes.map((runtime) => ({
    packageName: runtime.packageName,
    installationEvidence: runtime.installationEvidence,
    assets: runtime.assets.map((asset) => ({
      packagedResourcesPath: asset.packagedResourcesPath,
      inventorySha256: sha256(canonicalJson(asset.inventory))
    }))
  })).sort(comparePackageName)
  const deploymentConfigurations =
    deploymentConfigurationComposition.activeDeploymentConfigurationReceipts.map((entry) => ({
      packageName: entry.packageName,
      packagedResourcesRelativePath: entry.packagedResourcesRelativePath,
      publicRelease: entry.publicRelease,
      sha256: entry.sha256,
      size: entry.size
    })).sort(comparePackageName)
  return deepFreeze({
    deploymentConfigurations,
    internalRuntimes,
    privateContributions: [...privateContributions].sort((left, right) =>
      `${left.packageName}:${left.id}`.localeCompare(`${right.packageName}:${right.id}`)
    )
  })
}

async function discoverPrivateContributions(projectRoot) {
  const moduleUrl = pathToFileURL(resolve(__dirname, 'domain-packages.mjs')).href
  const { discoverDomainPackages } = await import(moduleUrl)
  const packages = await discoverDomainPackages(projectRoot)
  const contributions = []
  for (const candidate of packages) {
    if (candidate.definition?.composition !== 'production') continue
    for (const entrypoint of candidate.definition.entrypoints || []) {
      for (const contribution of entrypoint.contributions || []) {
        if (contribution.publicRelease !== 'forbidden') continue
        const contract = candidate.definition.contributionContracts?.[contribution.id]
        const contractLocation = isRecord(contract) && typeof contract.location === 'string'
          ? contract.location
          : null
        contributions.push(Object.freeze({
          contractLocation,
          contractSha256: sha256(canonicalJson(contract)),
          id: contribution.id,
          kind: contribution.kind,
          packageName: candidate.definition.packageName,
          process: entrypoint.process,
          version: contribution.version ?? null
        }))
      }
    }
  }
  return Object.freeze(contributions)
}

function assertAcceptanceComposition(composition) {
  requireRecord(composition, 'composition')
  if (!Array.isArray(composition.internalRuntimes) ||
    !Array.isArray(composition.deploymentConfigurations) ||
    !Array.isArray(composition.privateContributions)) {
    throw new Error('[stage4-artifact] Private composition inventories are required.')
  }
  if (!composition.deploymentConfigurations.some((entry) =>
    entry?.publicRelease === 'forbidden')) {
    throw new Error(
      '[stage4-artifact] Stage 4 acceptance requires an active private deployment configuration.'
    )
  }
}

function collectArtifacts(paths, outDir) {
  const artifacts = []
  for (const path of paths) {
    const absolutePath = resolve(path)
    if (dirname(absolutePath) !== outDir) continue
    const fileName = basename(absolutePath)
    const match = fileName.match(/-mac-(arm64|x64)\.(dmg|zip)$/u)
    if (!match) continue
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) {
      throw new Error(`[stage4-artifact] Artifact is not a regular file: ${fileName}`)
    }
    artifacts.push(Object.freeze({
      architecture: match[1],
      fileName,
      platform: 'mac',
      role: match[2] === 'zip' ? 'archive' : 'installer',
      sha256: hashFile(absolutePath),
      size: stat.size
    }))
  }
  return artifacts
}

function validateReceipt(value) {
  requireRecord(value, 'receipt')
  assertExactKeys(value, RECEIPT_KEYS, 'receipt')
  if (value.contractVersion !== CONTRACT_VERSION || value.kind !== RECEIPT_KIND) {
    throw new Error('[stage4-artifact] Receipt identity is invalid.')
  }
  validateSource(value.source)
  validateBuild(value.build)
  validateComposition(value.composition)
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1) {
    throw new Error('[stage4-artifact] Receipt artifact inventory is empty.')
  }
  const names = new Set()
  let archiveCount = 0
  for (const artifact of value.artifacts) {
    requireRecord(artifact, 'artifact')
    assertExactKeys(
      artifact,
      ['architecture', 'fileName', 'platform', 'role', 'sha256', 'size'],
      'artifact'
    )
    requireTarget(artifact.platform, artifact.architecture)
    if (artifact.platform !== value.build.target.platform ||
      artifact.architecture !== value.build.target.architecture ||
      typeof artifact.fileName !== 'string' || !artifact.fileName ||
      artifact.fileName.includes('/') || artifact.fileName.includes('\\') ||
      !Number.isSafeInteger(artifact.size) || artifact.size < 1 ||
      !SHA256_PATTERN.test(artifact.sha256) ||
      !['archive', 'installer'].includes(artifact.role) || names.has(artifact.fileName)) {
      throw new Error('[stage4-artifact] Receipt artifact entry is invalid.')
    }
    if (artifact.role === 'archive') archiveCount += 1
    names.add(artifact.fileName)
  }
  if (archiveCount !== 1) {
    throw new Error('[stage4-artifact] Receipt requires exactly one executable archive.')
  }
  assertAcceptanceComposition(value.composition)
}

function validateSource(source, requireClean = true) {
  requireRecord(source, 'source')
  assertExactKeys(
    source,
    ['branch', 'clean', 'commit', 'origin', 'remoteCommit', 'remoteRef'],
    'source'
  )
  if (source.branch !== EXPECTED_BRANCH || source.origin !== EXPECTED_ORIGIN ||
    source.remoteRef !== `origin/${EXPECTED_BRANCH}` ||
    typeof source.clean !== 'boolean' || (requireClean && source.clean !== true) ||
    !SOURCE_COMMIT_PATTERN.test(source.commit) || source.remoteCommit !== source.commit) {
    throw new Error('[stage4-artifact] Receipt source state is invalid.')
  }
}

function validateBuild(build) {
  requireRecord(build, 'build')
  assertExactKeys(
    build,
    ['command', 'completedAt', 'host', 'startedAt', 'target', 'toolchain'],
    'build'
  )
  requireIsoTimestamp(build.startedAt, 'build.startedAt')
  requireIsoTimestamp(build.completedAt, 'build.completedAt')
  requireRecord(build.host, 'build.host')
  assertExactKeys(build.host, ['architecture', 'platform', 'release'], 'build.host')
  requireRecord(build.target, 'build.target')
  assertExactKeys(build.target, ['architecture', 'platform'], 'build.target')
  requireTarget(build.target.platform, build.target.architecture)
  if (build.command !== canonicalBuildCommand(
    build.target.platform,
    build.target.architecture
  )) {
    throw new Error('[stage4-artifact] Receipt build command is invalid.')
  }
  requireRecord(build.toolchain, 'build.toolchain')
  assertExactKeys(
    build.toolchain,
    ['electron', 'electronBuilder', 'node', 'npm'],
    'build.toolchain'
  )
  for (const [key, version] of Object.entries(build.toolchain)) {
    if (typeof version !== 'string' || !version.trim()) {
      throw new Error(`[stage4-artifact] Receipt ${key} tool version is invalid.`)
    }
  }
}

function validateComposition(composition) {
  requireRecord(composition, 'composition')
  assertExactKeys(
    composition,
    ['deploymentConfigurations', 'internalRuntimes', 'privateContributions'],
    'composition'
  )
  if (!Array.isArray(composition.internalRuntimes) ||
    !Array.isArray(composition.deploymentConfigurations) ||
    !Array.isArray(composition.privateContributions)) {
    throw new Error('[stage4-artifact] Receipt composition inventories are invalid.')
  }
  for (const runtime of composition.internalRuntimes) {
    requireRecord(runtime, 'internal runtime')
    assertExactKeys(runtime, ['assets', 'installationEvidence', 'packageName'], 'internal runtime')
    if (typeof runtime.packageName !== 'string' || !runtime.packageName ||
      !Array.isArray(runtime.assets) || runtime.assets.length === 0) {
      throw new Error('[stage4-artifact] Receipt internal runtime is invalid.')
    }
    requireRecord(runtime.installationEvidence, 'internal runtime installation evidence')
    assertExactKeys(
      runtime.installationEvidence,
      ['archiveSha256', 'overlayId', 'overlayRoot', 'version'],
      'internal runtime installation evidence'
    )
    if (!SHA256_PATTERN.test(runtime.installationEvidence.archiveSha256) ||
      ![runtime.installationEvidence.overlayId, runtime.installationEvidence.overlayRoot,
        runtime.installationEvidence.version]
        .every((entry) => typeof entry === 'string' && Boolean(entry))) {
      throw new Error('[stage4-artifact] Receipt internal runtime evidence is invalid.')
    }
    for (const asset of runtime.assets) {
      requireRecord(asset, 'internal runtime asset')
      assertExactKeys(
        asset,
        ['inventorySha256', 'packagedResourcesPath'],
        'internal runtime asset'
      )
      if (!SHA256_PATTERN.test(asset.inventorySha256) ||
        typeof asset.packagedResourcesPath !== 'string' || !asset.packagedResourcesPath) {
        throw new Error('[stage4-artifact] Receipt internal runtime asset is invalid.')
      }
    }
  }
  for (const configuration of composition.deploymentConfigurations) {
    requireRecord(configuration, 'deployment configuration')
    assertExactKeys(
      configuration,
      ['packageName', 'packagedResourcesRelativePath', 'publicRelease', 'sha256', 'size'],
      'deployment configuration'
    )
    if (typeof configuration.packageName !== 'string' || !configuration.packageName ||
      typeof configuration.packagedResourcesRelativePath !== 'string' ||
      !configuration.packagedResourcesRelativePath ||
      !['allowed', 'forbidden'].includes(configuration.publicRelease) ||
      !SHA256_PATTERN.test(configuration.sha256) ||
      !Number.isSafeInteger(configuration.size) || configuration.size < 0) {
      throw new Error('[stage4-artifact] Receipt deployment configuration is invalid.')
    }
  }
  for (const contribution of composition.privateContributions) {
    requireRecord(contribution, 'private contribution')
    assertExactKeys(
      contribution,
      [
        'contractLocation',
        'contractSha256',
        'id',
        'kind',
        'packageName',
        'process',
        'version'
      ],
      'private contribution'
    )
    if (![contribution.id, contribution.kind, contribution.packageName, contribution.process]
      .every((entry) => typeof entry === 'string' && Boolean(entry)) ||
      !(contribution.contractLocation === null ||
        (typeof contribution.contractLocation === 'string' && contribution.contractLocation)) ||
      !(contribution.version === null ||
        (typeof contribution.version === 'string' && contribution.version)) ||
      !SHA256_PATTERN.test(contribution.contractSha256)) {
      throw new Error('[stage4-artifact] Receipt private contribution is invalid.')
    }
  }
}

function readExactSourceState(projectRoot, requireClean) {
  const branch = gitText(projectRoot, ['branch', '--show-current'])
  const commit = gitText(projectRoot, ['rev-parse', 'HEAD'])
  const origin = gitText(projectRoot, ['remote', 'get-url', 'origin'])
  const remoteRef = `origin/${branch}`
  const remoteCommit = gitText(projectRoot, ['rev-parse', remoteRef])
  const status = gitText(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  const source = Object.freeze({
    branch,
    clean: status.length === 0,
    commit,
    origin,
    remoteCommit,
    remoteRef
  })
  validateSource(source, requireClean)
  if (requireClean && status) {
    throw new Error(`[stage4-artifact] Acceptance build requires a clean worktree:\n${status}`)
  }
  return source
}

function sameSource(left, right) {
  return left.branch === right.branch && left.clean === right.clean &&
    left.commit === right.commit && left.origin === right.origin &&
    left.remoteCommit === right.remoteCommit && left.remoteRef === right.remoteRef
}

function canonicalBuildCommand(platform, architecture) {
  requireTarget(platform, architecture)
  if (platform !== 'mac') {
    throw new Error('[stage4-artifact] Only the reviewed macOS acceptance target is supported.')
  }
  return 'npm run build && npx --yes electron-builder@26.8.1 --config ' +
    `electron-builder.config.cjs --publish never --mac dmg zip --${architecture}`
}

function requireTarget(platform, architecture) {
  if (platform !== 'mac' || !['arm64', 'x64'].includes(architecture)) {
    throw new Error('[stage4-artifact] Receipt target is unsupported.')
  }
}

function readPackageVersion(projectRoot, packageName) {
  const path = resolve(projectRoot, 'node_modules', packageName, 'package.json')
  const value = JSON.parse(readFileSync(path, 'utf8')).version
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[stage4-artifact] ${packageName} version is unavailable.`)
  }
  return value.trim()
}

function assertDescriptorMatches(descriptor, artifact) {
  const stat = fstatSync(descriptor)
  if (!stat.isFile() || stat.size !== artifact.size || hashDescriptor(descriptor) !== artifact.sha256) {
    throw new Error('[stage4-artifact] Artifact bytes do not match the sealed receipt.')
  }
}

function hashFile(path) {
  const descriptor = openSync(path, 'r')
  try {
    return hashDescriptor(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function hashDescriptor(descriptor) {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let position = 0
  while (true) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position)
    if (bytesRead === 0) break
    hash.update(buffer.subarray(0, bytesRead))
    position += bytesRead
  }
  return hash.digest('hex')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function gitText(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: resolve(projectRoot),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function requireSourceCommit(value, label) {
  if (typeof value !== 'string' || !SOURCE_COMMIT_PATTERN.test(value)) {
    throw new Error(`[stage4-artifact] ${label} must be an exact 40-character commit.`)
  }
  return value
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))) {
    throw new Error(`[stage4-artifact] ${label} must be an ISO-8601 UTC timestamp.`)
  }
  return value
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[stage4-artifact] ${label} must be an object.`)
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    throw new Error(`[stage4-artifact] ${label} has invalid fields.`)
  }
}

function canonicalJson(value) {
  return JSON.stringify(value === undefined ? null : value)
}

function comparePackageName(left, right) {
  return left.packageName.localeCompare(right.packageName)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

module.exports = {
  BUILD_IDENTITY_KIND,
  EXPECTED_BRANCH,
  EXPECTED_ORIGIN,
  assertAcceptanceComposition,
  canonicalBuildCommand,
  createStage4ArtifactHooks,
  discoverPrivateContributions,
  readConfiguredStage4BuildIdentity,
  readExactSourceState,
  readStage4ArtifactReceipt,
  stage4ArtifactReceiptPath,
  summarizePrivateComposition,
  verifyStage4ArtifactReceipt
}
