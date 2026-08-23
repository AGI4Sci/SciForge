const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { basename, dirname, join, resolve } = require('node:path')

const RECEIPT_KIND = 'sciforge-public-release-artifact-receipt'
const RECEIPT_SCHEMA_VERSION = 1
const BUILD_EVIDENCE_DIRECTORY = '.public-release-artifact-evidence'
const BUILD_EVIDENCE_KIND = 'sciforge-public-release-artifact-build-evidence'
const MAX_RECEIPT_BYTES = 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SHA512_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/u
const SOURCE_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const PUBLIC_RELEASE_GUARD_KEYS = [
  'internalRuntimeCount',
  'publicReleaseForbiddenContributionCount',
  'publicReleaseForbiddenDeploymentConfigurationCount',
  'trackedPrivatePayloadCount'
]
const RECEIPT_KEYS = [
  'channel',
  'composition',
  'files',
  'inventorySha256',
  'kind',
  'platform',
  'productName',
  'publicReleaseGuard',
  'releaseDate',
  'schemaVersion',
  'sourceCommit',
  'tag',
  'updateMetadataFileName',
  'version'
]
const FILE_KEYS = [
  'buildEvidenceSha256',
  'fileName',
  'role',
  'sha256',
  'sha512',
  'size'
]
const BUILD_EVIDENCE_KEYS = [
  'artifact',
  'channel',
  'composition',
  'kind',
  'platform',
  'productName',
  'publicReleaseGuard',
  'schemaVersion',
  'sourceCommit',
  'tag',
  'version'
]
const BUILD_EVIDENCE_ARTIFACT_KEYS = ['fileName', 'sha256', 'sha512', 'size']
const FILE_ROLES = new Set([
  'blockmap',
  'download',
  'update-metadata',
  'update-package'
])
const PLATFORM_SPECS = Object.freeze({
  mac: Object.freeze({
    updateMetadataFileName: 'latest-mac.yml',
    requiredArtifactNames: (version) => [
      `SciForge-${version}-mac-arm64.dmg`,
      `SciForge-${version}-mac-arm64.zip`,
      `SciForge-${version}-mac-x64.dmg`,
      `SciForge-${version}-mac-x64.zip`
    ],
    assetPattern: (version) => new RegExp(
      `^SciForge-${escapeRegExp(version)}-mac-(?:arm64|x64)\\.(?:dmg|zip)(?:\\.blockmap)?$`,
      'u'
    )
  }),
  win: Object.freeze({
    updateMetadataFileName: 'latest.yml',
    requiredArtifactNames: (version) => [`SciForge-${version}-win-x64.exe`],
    assetPattern: (version) => new RegExp(
      `^SciForge-${escapeRegExp(version)}-win-x64\\.exe(?:\\.blockmap)?$`,
      'u'
    )
  }),
  linux: Object.freeze({
    updateMetadataFileName: 'latest-linux.yml',
    requiredArtifactNames: (version) => [
      `SciForge-${version}-linux-x86_64.AppImage`
    ],
    assetPattern: (version) => new RegExp(
      `^SciForge-${escapeRegExp(version)}-linux-x86_64\\.AppImage(?:\\.blockmap)?$`,
      'u'
    )
  })
})

function publicReleaseArtifactReceiptFileName(platform) {
  const normalizedPlatform = String(platform || '').trim()
  if (!Object.hasOwn(PLATFORM_SPECS, normalizedPlatform)) {
    throw new TypeError('Public release artifact receipt platform is invalid.')
  }
  return `release-${normalizedPlatform}.json`
}

function publicReleaseArtifactReceiptPath(distDir, platform) {
  return join(resolve(distDir), publicReleaseArtifactReceiptFileName(platform))
}

function publicReleaseArtifactBuildEvidencePath(distDir, platform, fileName) {
  if (!Object.hasOwn(PLATFORM_SPECS, platform) || !isSafeFileName(fileName)) {
    throw new TypeError('Public release artifact build evidence identity is invalid.')
  }
  return join(
    resolve(distDir),
    BUILD_EVIDENCE_DIRECTORY,
    platform,
    `${fileName}.json`
  )
}

function discoverPublicReleaseArtifactReceiptPlatforms(distDir) {
  return Object.keys(PLATFORM_SPECS).filter((platform) =>
    existsSync(publicReleaseArtifactReceiptPath(distDir, platform)))
}

function readPublicReleaseArtifactReceipt(distDir, platform) {
  const receiptPath = publicReleaseArtifactReceiptPath(distDir, platform)
  if (!existsSync(receiptPath)) {
    throw new Error(`[public-release] Missing public release artifact receipt: ${receiptPath}`)
  }
  const stat = lstatSync(receiptPath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_RECEIPT_BYTES) {
    throw new Error('[public-release] Public release artifact receipt must be a bounded regular file.')
  }
  const bytes = readFileSync(receiptPath)
  try {
    return {
      path: receiptPath,
      bytes,
      receipt: JSON.parse(bytes.toString('utf8'))
    }
  } catch (error) {
    throw new Error(
      '[public-release] Public release artifact receipt is not valid JSON.',
      { cause: error }
    )
  }
}

function createPublicReleaseArtifactBuildEvidence({
  distDir,
  platform,
  tag,
  channel,
  sourceCommit,
  publicReleaseGuard,
  internalRuntimeComposition,
  deploymentConfigurationComposition,
  artifactFileNames
}) {
  const version = validateReleaseIdentity({ platform, tag, channel, sourceCommit })
  const publicReleaseGuardReceipt = copyGuardResult(publicReleaseGuard)
  const composition = createEmptyCompositionReceipt(
    internalRuntimeComposition,
    deploymentConfigurationComposition
  )
  if (!Array.isArray(artifactFileNames) || artifactFileNames.length === 0) {
    throw new Error('[public-release] Build hook produced no public release artifacts.')
  }
  const spec = PLATFORM_SPECS[platform]
  const pattern = spec.assetPattern(version)
  const absoluteDistDir = resolve(distDir)
  const uniqueFileNames = [...new Set(artifactFileNames)].sort((left, right) =>
    left.localeCompare(right))
  const results = []
  for (const fileName of uniqueFileNames) {
    if (!isSafeFileName(fileName) || !pattern.test(fileName)) {
      throw new Error(`[public-release] Build hook returned invalid artifact: ${fileName}`)
    }
    const artifactPath = join(absoluteDistDir, fileName)
    const artifactStat = requireRegularFile(artifactPath, fileName)
    const artifactHashes = hashFile(artifactPath)
    const evidence = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      kind: BUILD_EVIDENCE_KIND,
      productName: 'SciForge',
      version,
      tag,
      channel,
      platform,
      sourceCommit,
      publicReleaseGuard: publicReleaseGuardReceipt,
      composition,
      artifact: {
        fileName,
        size: artifactStat.size,
        sha256: artifactHashes.sha256,
        sha512: artifactHashes.sha512
      }
    }
    validateBuildEvidenceShape(evidence)
    const evidencePath = publicReleaseArtifactBuildEvidencePath(
      absoluteDistDir,
      platform,
      fileName
    )
    const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
    mkdirSync(dirname(evidencePath), { recursive: true })
    writeFileSync(evidencePath, bytes, { flag: 'w', mode: 0o644 })
    results.push(Object.freeze({
      path: evidencePath,
      bytes,
      evidence: Object.freeze(evidence),
      sha256: createHash('sha256').update(bytes).digest('hex')
    }))
  }
  return Object.freeze(results)
}

function readPublicReleaseArtifactBuildEvidence(distDir, platform, fileName) {
  const evidencePath = publicReleaseArtifactBuildEvidencePath(distDir, platform, fileName)
  if (!existsSync(evidencePath)) {
    throw new Error(
      `[public-release] Missing build-issued evidence for release artifact: ${fileName}`
    )
  }
  const stat = lstatSync(evidencePath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_RECEIPT_BYTES) {
    throw new Error('[public-release] Artifact build evidence must be a bounded regular file.')
  }
  const bytes = readFileSync(evidencePath)
  let evidence
  try {
    evidence = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error('[public-release] Artifact build evidence is not valid JSON.', {
      cause: error
    })
  }
  validateBuildEvidenceShape(evidence)
  if (!bytes.equals(Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`))) {
    throw new Error('[public-release] Artifact build evidence is not canonically serialized.')
  }
  return Object.freeze({
    path: evidencePath,
    bytes,
    evidence,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}

function createPublicReleaseArtifactReceipt({
  distDir,
  platform,
  tag,
  channel,
  sourceCommit,
  publicReleaseGuard,
  internalRuntimeComposition,
  deploymentConfigurationComposition
}) {
  const version = validateReleaseIdentity({ platform, tag, channel, sourceCommit })
  const publicReleaseGuardReceipt = copyGuardResult(publicReleaseGuard)
  const composition = createEmptyCompositionReceipt(
    internalRuntimeComposition,
    deploymentConfigurationComposition
  )
  const artifactSet = collectPublicReleaseArtifactFiles({
    distDir,
    platform,
    version
  })
  const files = artifactSet.files.map((file) => {
    if (file.role === 'update-metadata') {
      return { buildEvidenceSha256: null, ...file }
    }
    const buildEvidence = readPublicReleaseArtifactBuildEvidence(
      distDir,
      platform,
      file.fileName
    )
    assertBuildEvidenceMatchesRelease({
      buildEvidence,
      channel,
      file,
      platform,
      sourceCommit,
      tag
    })
    return { buildEvidenceSha256: buildEvidence.sha256, ...file }
  })
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    productName: 'SciForge',
    version,
    tag,
    channel,
    platform,
    sourceCommit,
    releaseDate: artifactSet.releaseDate,
    updateMetadataFileName: artifactSet.updateMetadataFileName,
    publicReleaseGuard: publicReleaseGuardReceipt,
    composition,
    files,
    inventorySha256: createHash('sha256').update(JSON.stringify(files)).digest('hex')
  }
  validateReceiptShape(receipt)
  const receiptPath = publicReleaseArtifactReceiptPath(distDir, platform)
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, bytes, { flag: 'w', mode: 0o644 })
  return Object.freeze({
    path: receiptPath,
    bytes,
    receipt: Object.freeze(receipt),
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}

function verifyPublicReleaseArtifactReceipt({
  distDir,
  platform,
  tag,
  channel,
  sourceCommit
}) {
  const loaded = readPublicReleaseArtifactReceipt(distDir, platform)
  const receipt = validateReceiptShape(loaded.receipt)
  if (receipt.platform !== platform || receipt.tag !== tag ||
    receipt.channel !== channel || receipt.sourceCommit !== sourceCommit) {
    throw new Error(
      '[public-release] Public release artifact receipt identity does not match the publication request.'
    )
  }

  const canonicalBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  if (!loaded.bytes.equals(canonicalBytes)) {
    throw new Error('[public-release] Public release artifact receipt is not canonically serialized.')
  }

  const expectedInventorySha256 = createHash('sha256')
    .update(JSON.stringify(receipt.files))
    .digest('hex')
  if (receipt.inventorySha256 !== expectedInventorySha256) {
    throw new Error('[public-release] Public release artifact receipt inventory digest is invalid.')
  }

  const openArtifacts = []
  try {
    const absoluteDistDir = resolve(distDir)
    for (const file of receipt.files) {
      const path = join(absoluteDistDir, file.fileName)
      const artifact = openVerifiedArtifact(path, file)
      openArtifacts.push(artifact)
    }
    return createVerifiedReceiptHandle({ loaded, openArtifacts, receipt })
  } catch (error) {
    closeArtifactDescriptors(openArtifacts)
    throw error
  }
}

function openVerifiedArtifact(path, file) {
  if (!existsSync(path)) {
    throw new Error(
      `[public-release] Artifact is missing after the public release artifact receipt: ${file.fileName}`
    )
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  )
  try {
    const stat = fstatSync(descriptor)
    const pathStat = lstatSync(path)
    if (!stat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile() ||
      pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
      throw new Error(
        `[public-release] Public release artifact must be a stable regular file: ${file.fileName}`
      )
    }
    const hashes = hashDescriptor(descriptor)
    if (stat.size !== file.size || hashes.sha256 !== file.sha256 ||
      hashes.sha512 !== file.sha512) {
      throw new Error(
        `[public-release] Artifact changed after the public release artifact receipt: ${file.fileName}`
      )
    }
    return Object.freeze({
      descriptor,
      fileName: file.fileName,
      identity: fileIdentity(stat),
      path
    })
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function createVerifiedReceiptHandle({ loaded, openArtifacts, receipt }) {
  const artifactsByName = new Map(openArtifacts.map((artifact) => [
    artifact.fileName,
    artifact
  ]))
  let closed = false
  const requireOpen = () => {
    if (closed) throw new Error('[public-release] Public release artifact receipt is closed.')
  }
  const assertUnchanged = () => {
    requireOpen()
    for (const artifact of openArtifacts) assertOpenArtifactUnchanged(artifact)
  }
  const openReadStream = (fileName) => {
    requireOpen()
    const artifact = artifactsByName.get(fileName)
    if (!artifact) {
      throw new Error(`[public-release] Artifact is not bound to the receipt: ${fileName}`)
    }
    assertOpenArtifactUnchanged(artifact)
    return createReadStream(null, {
      autoClose: false,
      fd: artifact.descriptor,
      start: 0,
      end: artifact.identity.size - 1
    })
  }
  const close = () => {
    if (closed) return
    closed = true
    closeArtifactDescriptors(openArtifacts)
  }
  return Object.freeze({
    path: loaded.path,
    bytes: loaded.bytes,
    receipt,
    sha256: createHash('sha256').update(loaded.bytes).digest('hex'),
    assertUnchanged,
    openReadStream,
    close
  })
}

function assertOpenArtifactUnchanged(artifact) {
  const descriptorStat = fstatSync(artifact.descriptor)
  const pathStat = lstatSync(artifact.path)
  if (!descriptorStat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile() ||
    pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino ||
    !sameFileIdentity(fileIdentity(descriptorStat), artifact.identity)) {
    throw new Error(
      `[public-release] Public release artifact path identity changed: ${artifact.fileName}`
    )
  }
}

function fileIdentity(stat) {
  return Object.freeze({
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  })
}

function sameFileIdentity(left, right) {
  return left.ctimeMs === right.ctimeMs && left.dev === right.dev &&
    left.ino === right.ino && left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs && left.size === right.size
}

function closeArtifactDescriptors(artifacts) {
  for (const artifact of artifacts) closeSync(artifact.descriptor)
}

function validateReceiptShape(value) {
  requireRecord(value, 'Public release artifact receipt')
  assertExactKeys(value, RECEIPT_KEYS, 'Public release artifact receipt')
  if (value.schemaVersion !== RECEIPT_SCHEMA_VERSION || value.kind !== RECEIPT_KIND ||
    value.productName !== 'SciForge') {
    throw new Error('[public-release] Public release artifact receipt identity is invalid.')
  }
  const version = requireString(value.version, 'receipt version')
  if (!/^\d+\.\d+\.\d+$/u.test(version) || value.tag !== `v${version}`) {
    throw new Error('[public-release] Public release artifact receipt version is invalid.')
  }
  if (value.channel !== 'frontier' && value.channel !== 'stable') {
    throw new Error('[public-release] Public release artifact receipt channel is invalid.')
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(requireString(value.platform, 'receipt platform')) ||
    !SOURCE_COMMIT_PATTERN.test(requireString(value.sourceCommit, 'receipt sourceCommit')) ||
    !Number.isFinite(Date.parse(requireString(value.releaseDate, 'receipt releaseDate'))) ||
    !isSafeFileName(value.updateMetadataFileName)) {
    throw new Error('[public-release] Public release artifact receipt metadata is invalid.')
  }
  validateGuardResult(value.publicReleaseGuard)
  validateComposition(value.composition)
  if (!Array.isArray(value.files) || value.files.length < 2) {
    throw new Error('[public-release] Public release artifact receipt files are invalid.')
  }
  const names = new Set()
  let previousName = ''
  let updateMetadataCount = 0
  for (const [index, file] of value.files.entries()) {
    requireRecord(file, `Public release artifact receipt file ${index}`)
    assertExactKeys(file, FILE_KEYS, `Public release artifact receipt file ${index}`)
    if (!isSafeFileName(file.fileName) || names.has(file.fileName) ||
      (previousName && previousName.localeCompare(file.fileName) >= 0) ||
      !FILE_ROLES.has(file.role) || !Number.isSafeInteger(file.size) || file.size <= 0 ||
      !SHA256_PATTERN.test(file.sha256) || !SHA512_BASE64_PATTERN.test(file.sha512) ||
      (file.role === 'update-metadata'
        ? file.buildEvidenceSha256 !== null
        : !SHA256_PATTERN.test(file.buildEvidenceSha256))) {
      throw new Error(`[public-release] Public release artifact receipt file ${index} is invalid.`)
    }
    if (file.role === 'update-metadata') updateMetadataCount += 1
    names.add(file.fileName)
    previousName = file.fileName
  }
  if (updateMetadataCount !== 1 || !names.has(value.updateMetadataFileName) ||
    !SHA256_PATTERN.test(value.inventorySha256)) {
    throw new Error('[public-release] Public release artifact receipt inventory is invalid.')
  }
  validateReceiptArtifactContract(value, names)
  return value
}

function validateReceiptArtifactContract(receipt, names) {
  const spec = PLATFORM_SPECS[receipt.platform]
  if (!spec || receipt.updateMetadataFileName !== spec.updateMetadataFileName) {
    throw new Error('[public-release] Public release artifact receipt platform is invalid.')
  }
  const pattern = spec.assetPattern(receipt.version)
  let updatePackageCount = 0
  for (const file of receipt.files) {
    if (file.fileName === spec.updateMetadataFileName) {
      if (file.role !== 'update-metadata') {
        throw new Error('[public-release] Public release update metadata role is invalid.')
      }
      continue
    }
    if (!pattern.test(file.fileName) || file.role === 'update-metadata' ||
      (file.fileName.endsWith('.blockmap') !== (file.role === 'blockmap'))) {
      throw new Error('[public-release] Public release artifact role is invalid.')
    }
    if (file.role === 'update-package') updatePackageCount += 1
  }
  if (updatePackageCount === 0 ||
    spec.requiredArtifactNames(receipt.version).some((fileName) => !names.has(fileName))) {
    throw new Error('[public-release] Public release artifact set is incomplete.')
  }
}

function validateBuildEvidenceShape(value) {
  requireRecord(value, 'Public release artifact build evidence')
  assertExactKeys(value, BUILD_EVIDENCE_KEYS, 'Public release artifact build evidence')
  if (value.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    value.kind !== BUILD_EVIDENCE_KIND || value.productName !== 'SciForge') {
    throw new Error('[public-release] Public release artifact build evidence identity is invalid.')
  }
  const version = requireString(value.version, 'build evidence version')
  if (!Object.hasOwn(PLATFORM_SPECS, value.platform) || value.tag !== `v${version}` ||
    !/^\d+\.\d+\.\d+$/u.test(version) ||
    (value.channel !== 'frontier' && value.channel !== 'stable') ||
    !SOURCE_COMMIT_PATTERN.test(requireString(
      value.sourceCommit,
      'build evidence sourceCommit'
    ))) {
    throw new Error('[public-release] Public release artifact build evidence metadata is invalid.')
  }
  validateGuardResult(value.publicReleaseGuard)
  validateComposition(value.composition)
  requireRecord(value.artifact, 'Public release artifact build evidence artifact')
  assertExactKeys(
    value.artifact,
    BUILD_EVIDENCE_ARTIFACT_KEYS,
    'Public release artifact build evidence artifact'
  )
  if (!isSafeFileName(value.artifact.fileName) ||
    !PLATFORM_SPECS[value.platform].assetPattern(version).test(value.artifact.fileName) ||
    !Number.isSafeInteger(value.artifact.size) || value.artifact.size <= 0 ||
    !SHA256_PATTERN.test(value.artifact.sha256) ||
    !SHA512_BASE64_PATTERN.test(value.artifact.sha512)) {
    throw new Error('[public-release] Public release artifact build evidence artifact is invalid.')
  }
  return value
}

function assertBuildEvidenceMatchesRelease({
  buildEvidence,
  channel,
  file,
  platform,
  sourceCommit,
  tag
}) {
  const evidence = buildEvidence.evidence
  const artifact = evidence.artifact
  if (evidence.channel !== channel || evidence.platform !== platform ||
    evidence.sourceCommit !== sourceCommit || evidence.tag !== tag ||
    artifact.fileName !== file.fileName || artifact.size !== file.size ||
    artifact.sha256 !== file.sha256 || artifact.sha512 !== file.sha512) {
    throw new Error(
      `[public-release] Build-issued evidence does not match release artifact: ${file.fileName}`
    )
  }
}

function validateReleaseIdentity({ platform, tag, channel, sourceCommit }) {
  if (!Object.hasOwn(PLATFORM_SPECS, platform)) {
    throw new Error('[public-release] Public release artifact platform is unsupported.')
  }
  const match = String(tag || '').match(/^v(\d+\.\d+\.\d+)$/u)
  if (!match || (channel !== 'frontier' && channel !== 'stable') ||
    !SOURCE_COMMIT_PATTERN.test(String(sourceCommit || ''))) {
    throw new Error('[public-release] Public release artifact identity is invalid.')
  }
  return match[1]
}

function createEmptyCompositionReceipt(internalRuntime, deploymentConfigurations) {
  if (!internalRuntime || !Array.isArray(internalRuntime.extraResources) ||
    !Array.isArray(internalRuntime.packagedRuntimes) ||
    internalRuntime.extraResources.length !== 0 || internalRuntime.packagedRuntimes.length !== 0) {
    throw new Error('[public-release] Cannot seal non-empty internal runtime composition.')
  }
  if (!deploymentConfigurations ||
    !Array.isArray(deploymentConfigurations.extraResources) ||
    !Array.isArray(deploymentConfigurations.activeDeploymentConfigurationReceipts) ||
    deploymentConfigurations.extraResources.length !== 0 ||
    deploymentConfigurations.activeDeploymentConfigurationReceipts.length !== 0) {
    throw new Error('[public-release] Cannot seal non-empty deployment configuration composition.')
  }
  return {
    internalRuntime: { extraResources: [], packagedRuntimes: [] },
    deploymentConfigurations: {
      extraResources: [],
      activeDeploymentConfigurationReceipts: []
    }
  }
}

function collectPublicReleaseArtifactFiles({ distDir, platform, version }) {
  const spec = PLATFORM_SPECS[platform]
  if (!spec) throw new Error(`[public-release] Unsupported release platform: ${platform}`)
  const absoluteDistDir = resolve(distDir)
  const updateMetadataPath = join(absoluteDistDir, spec.updateMetadataFileName)
  requireRegularFile(updateMetadataPath, spec.updateMetadataFileName)
  const updateMetadataSource = readFileSync(updateMetadataPath, 'utf8')
  const updateMetadata = parseUpdateYml(updateMetadataSource)
  if (updateMetadata.version !== version) {
    throw new Error(
      `[public-release] Update metadata version ${updateMetadata.version} does not match ${version}.`
    )
  }

  const entries = readdirSync(absoluteDistDir, { withFileTypes: true })
  const exactAssetPattern = spec.assetPattern(version)
  const assets = entries
    .filter((entry) => exactAssetPattern.test(entry.name))
    .map((entry) => entry.name)
  for (const required of spec.requiredArtifactNames(version)) {
    if (!assets.includes(required)) {
      throw new Error(`[public-release] Required release artifact is missing: ${required}`)
    }
  }

  const referenced = new Set()
  for (const file of updateMetadata.files) {
    if (!isSafeFileName(file.url) || !exactAssetPattern.test(file.url) ||
      file.url.endsWith('.blockmap')) {
      throw new Error(`[public-release] Update metadata references invalid artifact: ${file.url}`)
    }
    referenced.add(file.url)
  }
  const fileNames = Array.from(new Set([
    spec.updateMetadataFileName,
    ...assets,
    ...referenced
  ])).sort((left, right) => left.localeCompare(right))
  const updateFiles = new Map(updateMetadata.files.map((file) => [file.url, file]))
  const files = fileNames.map((fileName) => {
    const path = join(absoluteDistDir, fileName)
    const stat = requireRegularFile(path, fileName)
    const hashes = hashFile(path)
    const declared = updateFiles.get(fileName)
    if (declared && (declared.size !== stat.size || declared.sha512 !== hashes.sha512)) {
      throw new Error(
        `[public-release] Update metadata integrity does not match artifact: ${fileName}`
      )
    }
    if (declared?.blockMapSize) {
      const blockmapName = `${fileName}.blockmap`
      const blockmapPath = join(absoluteDistDir, blockmapName)
      const blockmap = requireRegularFile(blockmapPath, blockmapName)
      if (blockmap.size !== declared.blockMapSize) {
        throw new Error(
          `[public-release] Update metadata blockmap size does not match artifact: ${blockmapName}`
        )
      }
    }
    return {
      fileName,
      role: fileName === spec.updateMetadataFileName
        ? 'update-metadata'
        : declared
          ? 'update-package'
          : fileName.endsWith('.blockmap')
            ? 'blockmap'
            : 'download',
      size: stat.size,
      sha256: hashes.sha256,
      sha512: hashes.sha512
    }
  })
  return {
    files,
    releaseDate: updateMetadata.releaseDate,
    updateMetadataFileName: spec.updateMetadataFileName
  }
}

function parseUpdateYml(source) {
  const version = quoteScalar(source.match(/^version:\s*(.+)$/mu)?.[1] ?? '')
  const releaseDate = quoteScalar(source.match(/^releaseDate:\s*(.+)$/mu)?.[1] ?? '')
  const files = []
  let current = null

  for (const line of source.split(/\r?\n/u)) {
    const url = line.match(/^\s*-\s+url:\s*(.+)$/u)
    if (url) {
      current = { url: quoteScalar(url[1]), sha512: '', size: 0, blockMapSize: 0 }
      files.push(current)
      continue
    }
    if (!current) continue
    const property = line.match(/^\s+(sha512|size|blockMapSize):\s*(.+)$/u)
    if (!property) continue
    const [, key, rawValue] = property
    current[key] = key === 'sha512'
      ? quoteScalar(rawValue)
      : Number.parseInt(rawValue, 10) || 0
  }
  if (!/^\d+\.\d+\.\d+$/u.test(version) ||
    !Number.isFinite(Date.parse(releaseDate)) || files.length === 0 ||
    files.some((file) => !file.url || !SHA512_BASE64_PATTERN.test(file.sha512) ||
      !Number.isSafeInteger(file.size) || file.size <= 0)) {
    throw new Error('[public-release] Update metadata is incomplete or invalid.')
  }
  return { version, releaseDate, files }
}

function quoteScalar(value) {
  return value.trim().replace(/^['"]|['"]$/gu, '')
}

function requireRegularFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[public-release] Release artifact is missing: ${label}`)
  }
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`[public-release] Release artifact must be a regular file: ${label}`)
  }
  return stat
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function validateGuardResult(value) {
  requireRecord(value, 'Public release guard receipt')
  assertExactKeys(value, PUBLIC_RELEASE_GUARD_KEYS, 'Public release guard receipt')
  if (PUBLIC_RELEASE_GUARD_KEYS.some((key) => value[key] !== 0)) {
    throw new Error('[public-release] Public release artifact receipt guard result is not clean.')
  }
}

function copyGuardResult(value) {
  validateGuardResult(value)
  return Object.fromEntries(
    PUBLIC_RELEASE_GUARD_KEYS.map((key) => [key, value[key]])
  )
}

function validateComposition(value) {
  requireRecord(value, 'Public release composition receipt')
  assertExactKeys(
    value,
    ['deploymentConfigurations', 'internalRuntime'],
    'Public release composition receipt'
  )
  requireRecord(value.internalRuntime, 'Internal runtime composition receipt')
  assertExactKeys(
    value.internalRuntime,
    ['extraResources', 'packagedRuntimes'],
    'Internal runtime composition receipt'
  )
  requireRecord(value.deploymentConfigurations, 'Deployment composition receipt')
  assertExactKeys(
    value.deploymentConfigurations,
    ['activeDeploymentConfigurationReceipts', 'extraResources'],
    'Deployment composition receipt'
  )
  const arrays = [
    value.internalRuntime.extraResources,
    value.internalRuntime.packagedRuntimes,
    value.deploymentConfigurations.extraResources,
    value.deploymentConfigurations.activeDeploymentConfigurationReceipts
  ]
  if (arrays.some((entries) => !Array.isArray(entries) || entries.length !== 0)) {
    throw new Error('[public-release] Public release artifact receipt composition is not empty.')
  }
}

function hashFile(path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  )
  try {
    return hashDescriptor(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function hashDescriptor(descriptor) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let position = 0
  let bytesRead
  do {
    bytesRead = readSync(descriptor, buffer, 0, buffer.length, position)
    if (bytesRead > 0) {
      const chunk = buffer.subarray(0, bytesRead)
      sha256.update(chunk)
      sha512.update(chunk)
      position += bytesRead
    }
  } while (bytesRead > 0)
  return {
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('base64')
  }
}

function readSourceCommit(projectRoot) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(projectRoot),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  if (!SOURCE_COMMIT_PATTERN.test(commit)) {
    throw new Error('[public-release] Could not resolve the release source commit.')
  }
  return commit
}

function isSafeFileName(value) {
  return typeof value === 'string' && Boolean(value) &&
    value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`[public-release] ${label} must be a non-empty string.`)
  }
  return value
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`[public-release] ${label} must be an object.`)
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`[public-release] ${label} has invalid fields.`)
  }
}

function clearPublicReleaseArtifactEvidence(distDir, platform) {
  rmSync(publicReleaseArtifactReceiptPath(distDir, platform), { force: true })
  rmSync(join(resolve(distDir), BUILD_EVIDENCE_DIRECTORY, platform), {
    force: true,
    recursive: true
  })
}

function importPublicReleaseArtifactBuildEvidence({ fromDistDir, toDistDir, platform }) {
  const sourceDirectory = join(
    resolve(fromDistDir),
    BUILD_EVIDENCE_DIRECTORY,
    platform
  )
  if (!existsSync(sourceDirectory) || lstatSync(sourceDirectory).isSymbolicLink() ||
    !lstatSync(sourceDirectory).isDirectory()) {
    throw new Error('[public-release] Public artifact build evidence directory is missing.')
  }
  let imported = 0
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const fileName = entry.name.slice(0, -'.json'.length)
    const loaded = readPublicReleaseArtifactBuildEvidence(
      fromDistDir,
      platform,
      fileName
    )
    const targetPath = publicReleaseArtifactBuildEvidencePath(
      toDistDir,
      platform,
      fileName
    )
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, loaded.bytes, { flag: 'w', mode: 0o644 })
    imported += 1
  }
  if (imported === 0) {
    throw new Error('[public-release] No public artifact build evidence was imported.')
  }
  return imported
}

function createPublicReleaseArtifactHooks({
  afterPack,
  projectRoot,
  internalRuntimeComposition,
  deploymentConfigurationComposition
}) {
  if (typeof afterPack !== 'function') {
    throw new TypeError('[public-release] Canonical afterPack hook is required.')
  }
  const absoluteProjectRoot = resolve(projectRoot)
  let verifiedAfterPackCount = 0
  const wrappedAfterPack = async (context) => {
    await afterPack(context)
    if (process.env.SCIFORGE_PUBLIC_RELEASE === '1') verifiedAfterPackCount += 1
  }
  const afterAllArtifactBuild = async (buildResult) => {
    const mode = process.env.SCIFORGE_PUBLIC_RELEASE
    if (mode === undefined) return []
    if (mode !== '1') {
      throw new Error(
        '[public-release] SCIFORGE_PUBLIC_RELEASE must be exactly 1 when configured.'
      )
    }
    if (!buildResult || !Array.isArray(buildResult.artifactPaths)) {
      throw new TypeError('[public-release] Electron Builder artifact result is invalid.')
    }
    if (verifiedAfterPackCount === 0) {
      throw new Error(
        '[public-release] Cannot issue build evidence without a successful public afterPack.'
      )
    }
    const { version, tag, channel } = readBuilderReleaseIdentity(buildResult)
    const sourceCommit = readSourceCommit(absoluteProjectRoot)
    const expectedSourceCommit = String(
      process.env.SCIFORGE_RELEASE_SOURCE_COMMIT || ''
    ).trim()
    if (expectedSourceCommit && expectedSourceCommit !== sourceCommit) {
      throw new Error('[public-release] Release source commit does not match the checkout.')
    }
    const { runPublicReleaseGuard } = require('./public-release-guard.cjs')
    const publicReleaseGuard = await runPublicReleaseGuard([])
    const outDir = resolve(buildResult.outDir)
    const artifactFileNamesByPlatform = new Map()
    for (const artifactPath of buildResult.artifactPaths) {
      const absoluteArtifactPath = resolve(artifactPath)
      if (dirname(absoluteArtifactPath) !== outDir) continue
      const fileName = basename(absoluteArtifactPath)
      for (const [platform, spec] of Object.entries(PLATFORM_SPECS)) {
        if (!spec.assetPattern(version).test(fileName)) continue
        const fileNames = artifactFileNamesByPlatform.get(platform) || []
        fileNames.push(fileName)
        artifactFileNamesByPlatform.set(platform, fileNames)
      }
    }
    for (const [platform, artifactFileNames] of artifactFileNamesByPlatform) {
      createPublicReleaseArtifactBuildEvidence({
        distDir: outDir,
        platform,
        tag,
        channel,
        sourceCommit,
        publicReleaseGuard,
        internalRuntimeComposition,
        deploymentConfigurationComposition,
        artifactFileNames
      })
    }
    return []
  }
  return Object.freeze({ afterPack: wrappedAfterPack, afterAllArtifactBuild })
}

function readBuilderReleaseIdentity(buildResult) {
  requireRecord(buildResult.configuration, 'Electron Builder configuration')
  requireRecord(
    buildResult.configuration.extraMetadata,
    'Electron Builder extraMetadata'
  )
  const version = requireString(
    buildResult.configuration.extraMetadata.version,
    'Electron Builder application version'
  )
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('[public-release] Electron Builder application version is invalid.')
  }
  const channel = String(
    buildResult.configuration.extraMetadata.updateChannel || ''
  ).trim()
  if (channel !== 'frontier' && channel !== 'stable') {
    throw new Error('[public-release] Electron Builder update channel is invalid.')
  }
  return Object.freeze({ channel, tag: `v${version}`, version })
}

async function sealConfiguredPublicReleaseArtifactReceipt({
  distDir,
  platform
}, options = {}) {
  const environment = options.environment || process.env
  const absoluteProjectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : resolve(__dirname, '..')
  const mode = environment.SCIFORGE_PUBLIC_RELEASE
  if (mode === undefined) {
    rmSync(publicReleaseArtifactReceiptPath(distDir, platform), { force: true })
    return undefined
  }
  if (mode !== '1') {
    throw new Error(
      '[public-release] SCIFORGE_PUBLIC_RELEASE must be exactly 1 when configured.'
    )
  }
  const version = requireString(environment.SCIFORGE_APP_VERSION, 'SCIFORGE_APP_VERSION')
  const tag = `v${version}`
  const channel = configuredReleaseChannel(environment)
  const sourceCommit = readSourceCommit(absoluteProjectRoot)
  const expectedSourceCommit = String(
    environment.SCIFORGE_RELEASE_SOURCE_COMMIT || ''
  ).trim()
  if (expectedSourceCommit && expectedSourceCommit !== sourceCommit) {
    throw new Error('[public-release] Release source commit does not match the checkout.')
  }
  const runGuard = options.runPublicReleaseGuard ||
    require('./public-release-guard.cjs').runPublicReleaseGuard
  const createInternalComposition = options.createInternalRuntimeComposition ||
    require('./internal-runtime-packaging.cjs').createInternalRuntimeComposition
  const createDeploymentComposition =
    options.createDeploymentConfigurationComposition ||
    require('./domain-package-deployment-config.cjs')
      .createDomainPackageDeploymentConfigurationComposition
  const publicReleaseGuard = await runGuard([])
  return createPublicReleaseArtifactReceipt({
    distDir,
    platform,
    tag,
    channel,
    sourceCommit,
    publicReleaseGuard,
    internalRuntimeComposition: createInternalComposition(absoluteProjectRoot),
    deploymentConfigurationComposition: createDeploymentComposition(absoluteProjectRoot)
  })
}

function configuredReleaseChannel(environment) {
  const channel = String(
    environment.RELEASE_CHANNEL || environment.SCIFORGE_UPDATE_CHANNEL || ''
  ).trim()
  if (channel !== 'frontier' && channel !== 'stable') {
    throw new Error('[public-release] Release channel must be frontier or stable.')
  }
  return channel
}

function parseCommandLine(argv) {
  const [command, ...remaining] = argv
  const flags = new Map()
  for (let index = 0; index < remaining.length; index += 1) {
    const flag = remaining[index]
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`)
    const value = remaining[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    flags.set(flag.slice(2), value)
    index += 1
  }
  return { command, flags }
}

async function main(argv) {
  const { command, flags } = parseCommandLine(argv)
  const platform = requireString(flags.get('platform'), '--platform')
  const distDir = resolve(flags.get('dist') || 'dist')
  if (command === 'clear') {
    clearPublicReleaseArtifactEvidence(distDir, platform)
    return
  }
  if (command === 'import-evidence') {
    const fromDistDir = resolve(requireString(flags.get('from'), '--from'))
    importPublicReleaseArtifactBuildEvidence({ fromDistDir, toDistDir: distDir, platform })
    return
  }
  if (command === 'seal') {
    const result = await sealConfiguredPublicReleaseArtifactReceipt({ distDir, platform })
    if (result) process.stdout.write(`[public-release] Sealed ${result.path}\n`)
    return
  }
  throw new Error(
    'Usage: node scripts/public-release-artifact-receipt.cjs clear|seal|import-evidence ' +
      '--platform mac|win|linux [--dist dist] [--from build-dist]'
  )
}

module.exports = {
  clearPublicReleaseArtifactEvidence,
  createPublicReleaseArtifactBuildEvidence,
  createPublicReleaseArtifactHooks,
  createPublicReleaseArtifactReceipt,
  collectPublicReleaseArtifactFiles,
  discoverPublicReleaseArtifactReceiptPlatforms,
  importPublicReleaseArtifactBuildEvidence,
  publicReleaseArtifactReceiptFileName,
  publicReleaseArtifactReceiptPath,
  readPublicReleaseArtifactReceipt,
  readSourceCommit,
  sealConfiguredPublicReleaseArtifactReceipt,
  verifyPublicReleaseArtifactReceipt
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
