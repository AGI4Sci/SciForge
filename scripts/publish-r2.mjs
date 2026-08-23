#!/usr/bin/env node
import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { runPublicReleaseGuard } = require('./public-release-guard.cjs')
const {
  discoverPublicReleaseArtifactReceiptPlatforms,
  publicReleaseArtifactReceiptFileName,
  readSourceCommit,
  verifyPublicReleaseArtifactReceipt
} = require('./public-release-artifact-receipt.cjs')

const PRODUCT_NAME = 'SciForge'
const DEFAULT_RELEASE_PREFIX = 'sciforge'
const DEFAULT_RELEASE_CHANNEL = 'frontier'
const PLATFORMS = ['mac', 'win', 'linux']
const RELEASE_CHANNELS = ['frontier', 'stable']
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')

function usage() {
  console.log(`Usage:
  node scripts/publish-r2.mjs upload --platform mac|win|linux --tag vX.Y.Z [--dist dist] [--channel frontier|stable] [--dry-run]
  node scripts/publish-r2.mjs promote --tag vX.Y.Z [--dist dist] [--channel frontier|stable] [--platforms mac,win,linux] [--dry-run]

If --platforms is omitted, promote uses the build-issued receipts found in --dist.
If --channel is omitted, the default channel is frontier.

Environment:
  SCIFORGE_RELEASE_ENV=scripts/release.local.env
  RELEASE_CHANNEL=frontier|stable
  R2_BUCKET or S3_BUCKET
  R2_ENDPOINT or S3_ENDPOINT
  R2_ACCESS_KEY_ID or S3_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY
  R2_PUBLIC_BASE_URL
  R2_RELEASE_PREFIX=sciforge
`)
}

function parseEnvFile(content) {
  const values = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values.set(match[1], value)
  }
  return values
}

function loadLocalEnv() {
  const configured = (
    process.env.SCIFORGE_RELEASE_ENV || ''
  ).trim()
  const candidates = [
    configured,
    join(ROOT, 'scripts', 'release.local.env'),
    join(ROOT, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const values = parseEnvFile(readFileSync(candidate, 'utf8'))
    for (const [key, value] of values) {
      if (!process.env[key]) process.env[key] = value
    }
    console.log(`Loaded local release config: ${candidate}`)
    return candidate
  }
  return null
}

function readArgs(argv) {
  const flags = new Map()
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (name === 'dry-run' || name === 'help' || name === 'h' || name === 'stable' || name === 'frontier') {
      flags.set(name, true)
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`)
    }
    flags.set(name, value)
    i += 1
  }
  return { command: positionals[0], flags }
}

function requireFlag(flags, name) {
  const value = flags.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required flag --${name}`)
  }
  return value.trim()
}

function normalizeTag(raw) {
  const tag = raw.trim()
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Tag must look like vX.Y.Z. electron-updater cannot use four-part versions, got: ${raw}`)
  }
  return tag
}

function normalizeChannel(raw) {
  const channel = String(raw || '').trim() || DEFAULT_RELEASE_CHANNEL
  if (!RELEASE_CHANNELS.includes(channel)) {
    throw new Error(`Release channel must be one of: ${RELEASE_CHANNELS.join(', ')}`)
  }
  return channel
}

function readChannel(flags) {
  if (flags.has('stable') && flags.has('frontier')) {
    throw new Error('Use only one of --stable or --frontier.')
  }
  if (flags.has('stable')) return 'stable'
  if (flags.has('frontier')) return 'frontier'
  return normalizeChannel(
      flags.get('channel') ||
      process.env.RELEASE_CHANNEL ||
      process.env.SCIFORGE_UPDATE_CHANNEL ||
      DEFAULT_RELEASE_CHANNEL
  )
}

function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw || '').trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function runConcurrently(items, limit, worker) {
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        await worker(item)
      }
    })
  )
}

function normalizeBaseUrl(raw) {
  return raw.trim().replace(/\/+$/, '')
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '')
}

function joinUrl(base, ...parts) {
  return [normalizeBaseUrl(base), ...parts.map((p) => trimSlashes(p)).filter(Boolean)].join('/')
}

function channelBasePath(prefix, channel) {
  return `${prefix}/channels/${channel}`
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

function normalizeS3Endpoint(rawEndpoint, bucket) {
  const value = rawEndpoint.trim()
  if (!value) return ''
  const url = new URL(value)
  const normalizedBucket = bucket.trim()
  const path = url.pathname.replace(/\/+$/, '')
  if (normalizedBucket && path === `/${normalizedBucket}`) {
    url.pathname = ''
  }
  return url.toString().replace(/\/+$/, '')
}

function readConfig({ dryRun = false } = {}) {
  loadLocalEnv()
  const accountId = firstEnv('R2_ACCOUNT_ID')
  const bucket = firstEnv('R2_BUCKET', 'S3_BUCKET')
  const accessKeyId = firstEnv('R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
  const secretAccessKey = firstEnv(
    'R2_SECRET_ACCESS_KEY',
    'S3_SECRET_ACCESS_KEY',
    'AWS_SECRET_ACCESS_KEY'
  )
  const endpoint = normalizeS3Endpoint(firstEnv('R2_ENDPOINT', 'S3_ENDPOINT'), bucket)
  const publicBaseUrl = firstEnv('R2_PUBLIC_BASE_URL', 'PUBLIC_DOWNLOAD_BASE_URL')
  const prefix = trimSlashes(firstEnv('R2_RELEASE_PREFIX') || DEFAULT_RELEASE_PREFIX)

  if (!publicBaseUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required so manifests can contain public download URLs.')
  }
  if (!dryRun && /(^|\.)downloads\.example\.com$/i.test(new URL(publicBaseUrl).hostname)) {
    throw new Error('Replace the placeholder R2_PUBLIC_BASE_URL with your real R2 custom domain.')
  }

  if (!dryRun) {
    const missing = []
    if (!endpoint && !accountId) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
    if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID or S3_ACCESS_KEY_ID')
    if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY')
    if (!bucket) missing.push('R2_BUCKET or S3_BUCKET')
    if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`)
  }

  const resolvedEndpoint = endpoint || `https://${accountId}.r2.cloudflarestorage.com`
  const client = dryRun
    ? null
    : new S3Client({
        region: 'auto',
        endpoint: resolvedEndpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true
      })

  return { bucket, publicBaseUrl: normalizeBaseUrl(publicBaseUrl), prefix, client }
}

function contentType(fileName) {
  if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return 'text/yaml; charset=utf-8'
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8'
  if (fileName.endsWith('.zip')) return 'application/zip'
  if (fileName.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (fileName.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  return 'application/octet-stream'
}

function classifyDownload(fileName, platform) {
  const extension = fileName.endsWith('.AppImage')
    ? 'AppImage'
    : fileName.endsWith('.dmg')
      ? 'dmg'
      : fileName.endsWith('.zip')
        ? 'zip'
        : fileName.endsWith('.exe')
          ? 'exe'
          : 'bin'
  if (platform === 'mac') {
    const arch = fileName.includes('-arm64.') ? 'arm64' : 'x64'
    return {
      platform,
      arch,
      format: extension,
      label: arch === 'arm64'
        ? `macOS Apple Silicon ${extension.toUpperCase()}`
        : `macOS Intel ${extension.toUpperCase()}`
    }
  }
  if (platform === 'win') {
    return { platform, arch: 'x64', format: extension, label: 'Windows x64 installer' }
  }
  return { platform, arch: 'x64', format: extension, label: 'Linux x64 AppImage' }
}

function cacheControlFor(key) {
  if (/\/latest\/latest(?:-[\w]+)?\.(?:json|yml)$/.test(key)) {
    return 'public, max-age=60, must-revalidate'
  }
  if (/\/latest\/.+\.(?:dmg|zip|exe|AppImage|blockmap)$/.test(key)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=31536000, immutable'
}

async function putObject({ config, key, body, contentType: type, cacheControl, contentLength, dryRun }) {
  if (dryRun) {
    console.log(`[dry-run] put s3://${config.bucket || '<bucket>'}/${key}`)
    return
  }
  const input = {
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: type,
    CacheControl: cacheControl
  }
  if (typeof contentLength === 'number') input.ContentLength = contentLength
  await config.client.send(new PutObjectCommand(input))
}

async function copyObject({
  config,
  fromKey,
  sourceEtag,
  sourceVersionId,
  toKey,
  type,
  dryRun
}) {
  if (dryRun) {
    console.log(`[dry-run] copy s3://${config.bucket}/${fromKey} -> s3://${config.bucket}/${toKey}`)
    return
  }
  if (typeof sourceEtag !== 'string' || !sourceEtag.trim()) {
    throw new Error('[public-release] Conditional copy requires the verified source ETag.')
  }
  const encodedCopySource = `${config.bucket}/${fromKey}`
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const copySource = sourceVersionId
    ? `${encodedCopySource}?versionId=${encodeURIComponent(sourceVersionId)}`
    : encodedCopySource
  await config.client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: toKey,
      CopySource: copySource,
      CopySourceIfMatch: sourceEtag,
      ContentType: type,
      CacheControl: cacheControlFor(toKey),
      MetadataDirective: 'REPLACE'
    })
  )
}

export async function uploadPlatform({ flags, dryRun, artifactReceipt }, dependencies = {}) {
  const platform = requireFlag(flags, 'platform')
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`--platform must be one of: ${PLATFORMS.join(', ')}`)
  }
  const tag = normalizeTag(requireFlag(flags, 'tag'))
  const channel = readChannel(flags)
  const getConfig = dependencies.readConfig || readConfig
  const put = dependencies.putObject || putObject
  artifactReceipt.assertUnchanged()
  const config = getConfig({ dryRun })
  const release = artifactReceipt.receipt
  const basePath = channelBasePath(config.prefix, channel)
  const files = release.files.map((file) => ({
    ...file,
    key: `${basePath}/releases/${tag}/${file.fileName}`,
    contentType: contentType(file.fileName)
  }))

  console.log(
    `Uploading ${PRODUCT_NAME} ${release.version} ${platform} assets to R2 ${channel} archive ${tag}`
  )
  const uploadConcurrency = positiveInt(
    process.env.R2_UPLOAD_CONCURRENCY || process.env.RELEASE_UPLOAD_CONCURRENCY,
    4
  )
  console.log(`Using R2 upload concurrency: ${uploadConcurrency}`)
  artifactReceipt.assertUnchanged()
  await runConcurrently(files, uploadConcurrency, async (file) => {
    await put({
      config,
      key: file.key,
      body: dryRun ? undefined : artifactReceipt.openReadStream(file.fileName),
      contentType: file.contentType,
      cacheControl: cacheControlFor(file.key),
      contentLength: file.size,
      dryRun
    })
    artifactReceipt.assertUnchanged()
    console.log(`  ${file.fileName}`)
  })

  artifactReceipt.assertUnchanged()
  const receiptFileName = publicReleaseArtifactReceiptFileName(platform)
  const manifestKey = `${channelBasePath(config.prefix, channel)}/releases/${tag}/${receiptFileName}`
  await put({
    config,
    key: manifestKey,
    body: artifactReceipt.bytes,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable',
    dryRun
  })
  console.log(`  ${receiptFileName}`)
}

function readPromotionPlatforms(flags, distDir) {
  const requestedPlatforms = String(flags.get('platforms') || '')
    .split(',')
    .map((platform) => platform.trim())
    .filter(Boolean)
  const platforms = flags.has('platforms')
    ? requestedPlatforms
    : discoverPublicReleaseArtifactReceiptPlatforms(distDir)
  if (platforms.length === 0) {
    throw new Error(
      'No local public release artifact receipts found. Pass --dist with build-issued receipts.'
    )
  }
  if (new Set(platforms).size !== platforms.length) {
    throw new Error('Duplicate platform in --platforms.')
  }
  for (const platform of platforms) {
    if (!PLATFORMS.includes(platform)) {
      throw new Error(`Unsupported platform in --platforms: ${platform}`)
    }
  }
  return platforms
}

function verifyPromotionArtifactReceipts({ flags, tag, channel, sourceCommit }) {
  const distDir = resolve(flags.get('dist') || 'dist')
  const platforms = readPromotionPlatforms(flags, distDir)
  const artifactReceipts = []
  try {
    for (const platform of platforms) {
      artifactReceipts.push(verifyPublicReleaseArtifactReceipt({
        distDir,
        platform,
        tag,
        channel,
        sourceCommit
      }))
    }
    const versions = new Set(artifactReceipts.map(({ receipt }) => receipt.version))
    if (versions.size !== 1) {
      throw new Error(`Cannot promote mixed versions: ${Array.from(versions).join(', ')}`)
    }
    return artifactReceipts
  } catch (error) {
    for (const artifactReceipt of artifactReceipts) artifactReceipt.close()
    throw error
  }
}

async function listReleaseKeys(config, tag, channel) {
  const prefix = `${channelBasePath(config.prefix, channel)}/releases/${tag}/`
  const keys = []
  let ContinuationToken
  do {
    const res = await config.client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken
      })
    )
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    ContinuationToken = res.NextContinuationToken
  } while (ContinuationToken)
  return keys
}

async function getObjectSnapshot(config, key, { includeBytes = false } = {}) {
  const res = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
  if (!res.Body || !res.Body[Symbol.asyncIterator]) {
    throw new Error(`[public-release] Archived object body is not readable: ${key}`)
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const chunks = includeBytes ? [] : null
  let size = 0
  for await (const rawChunk of res.Body) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    size += chunk.length
    sha256.update(chunk)
    sha512.update(chunk)
    if (chunks) chunks.push(chunk)
  }
  if (Number.isSafeInteger(res.ContentLength) && res.ContentLength !== size) {
    throw new Error(`[public-release] Archived object length changed while reading: ${key}`)
  }
  return Object.freeze({
    bytes: chunks ? Buffer.concat(chunks, size) : undefined,
    etag: typeof res.ETag === 'string' ? res.ETag : '',
    versionId: typeof res.VersionId === 'string' ? res.VersionId : '',
    size,
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('base64')
  })
}

async function promoteRelease({ flags, dryRun, artifactReceipts }, dependencies = {}) {
  const tag = normalizeTag(requireFlag(flags, 'tag'))
  const channel = readChannel(flags)
  const platforms = artifactReceipts.map(({ receipt }) => receipt.platform)
  if (dryRun) {
    console.log(
      `[dry-run] validated local public release receipts for ${tag}: ${platforms.join(', ')}`
    )
    return
  }

  const getConfig = dependencies.readConfig || readConfig
  const listKeys = dependencies.listReleaseKeys || listReleaseKeys
  const readObjectSnapshot = dependencies.getObjectSnapshot || getObjectSnapshot
  const copy = dependencies.copyObject || copyObject
  const put = dependencies.putObject || putObject
  const config = getConfig({ dryRun: false })
  const releaseKeys = await listKeys(config, tag, channel)
  if (!releaseKeys.length) throw new Error(`No archived R2 objects found for ${tag}`)

  const platformManifests = []
  for (const artifactReceipt of artifactReceipts) {
    const platform = artifactReceipt.receipt.platform
    const receiptFileName = publicReleaseArtifactReceiptFileName(platform)
    const key = `${channelBasePath(config.prefix, channel)}/releases/${tag}/${receiptFileName}`
    if (!releaseKeys.includes(key)) {
      throw new Error(`Missing ${key}. Run upload for ${platform} before promoting.`)
    }
    const remoteReceipt = await readObjectSnapshot(config, key, { includeBytes: true })
    if (!Buffer.isBuffer(remoteReceipt.bytes) ||
      !remoteReceipt.bytes.equals(artifactReceipt.bytes) || !remoteReceipt.etag) {
      throw new Error(
        `[public-release] Archived receipt does not match local build receipt for ${platform}.`
      )
    }
    platformManifests.push(artifactReceipt.receipt)
  }

  const allFiles = new Map()
  for (const manifest of platformManifests) {
    for (const file of manifest.files) {
      if (allFiles.has(file.fileName)) {
        throw new Error(`Cannot promote duplicate artifact file name: ${file.fileName}`)
      }
      allFiles.set(file.fileName, {
        ...file,
        key: `${channelBasePath(config.prefix, channel)}/releases/${tag}/${file.fileName}`,
        contentType: contentType(file.fileName)
      })
    }
  }
  for (const file of allFiles.values()) {
    if (!releaseKeys.includes(file.key)) {
      throw new Error(`[public-release] Archived release artifact is missing: ${file.fileName}`)
    }
  }

  for (const [fileName, file] of allFiles) {
    const remoteObject = await readObjectSnapshot(config, file.key)
    if (!remoteObject.etag || remoteObject.size !== file.size ||
      remoteObject.sha256 !== file.sha256 || remoteObject.sha512 !== file.sha512) {
      throw new Error(
        `[public-release] Archived release artifact integrity does not match: ${fileName}`
      )
    }
    allFiles.set(fileName, {
      ...file,
      sourceEtag: remoteObject.etag,
      sourceVersionId: remoteObject.versionId
    })
  }

  const latestTargets = [{ basePath: channelBasePath(config.prefix, channel), label: `${channel} latest` }]
  if (channel === 'stable') {
    latestTargets.push({ basePath: config.prefix, label: 'legacy stable latest' })
  }

  const version = platformManifests[0].version
  const releaseDates = platformManifests
    .map((manifest) => manifest.releaseDate)
    .filter(Boolean)
    .sort()
  const releaseDate = releaseDates[releaseDates.length - 1] ?? new Date().toISOString()
  const orderedFiles = [...allFiles.values()].sort((left, right) => {
    const leftMetadata = left.role === 'update-metadata' ? 1 : 0
    const rightMetadata = right.role === 'update-metadata' ? 1 : 0
    return leftMetadata - rightMetadata || left.fileName.localeCompare(right.fileName)
  })
  const copyPlan = orderedFiles.flatMap((file) => latestTargets.map((target) => ({
    file,
    target,
    toKey: `${target.basePath}/latest/${file.fileName}`
  })))
  const latestManifestPlan = latestTargets.map((target) => {
    const downloads = platformManifests.flatMap((manifest) =>
      manifest.files
        .filter((file) => file.role === 'update-package')
        .map((file) => ({
          ...classifyDownload(file.fileName, manifest.platform),
          fileName: file.fileName,
          size: file.size,
          sha256: file.sha256,
          sha512: file.sha512,
          url: joinUrl(config.publicBaseUrl, target.basePath, 'latest', file.fileName)
        })))

    const body = JSON.stringify({
      schemaVersion: 1,
      productName: PRODUCT_NAME,
      channel,
      version,
      tag,
      releaseDate,
      generatedAt: new Date().toISOString(),
      githubReleaseUrl: `https://github.com/XingYu-Zhong/SciForge/releases/tag/${tag}`,
      updateBaseUrl: joinUrl(config.publicBaseUrl, target.basePath, 'latest') + '/',
      updateMetadata: Object.fromEntries(
        platformManifests.map((manifest) => [
          manifest.platform,
          {
            fileName: manifest.updateMetadataFileName,
            url: joinUrl(config.publicBaseUrl, target.basePath, 'latest', manifest.updateMetadataFileName)
          }
        ])
      ),
      downloads
    }, null, 2)
    return {
      body,
      key: `${target.basePath}/latest/latest.json`,
      target
    }
  })

  console.log(`Promoting ${PRODUCT_NAME} ${tag} to R2 ${channel} latest (${platforms.join(', ')})`)
  for (const item of copyPlan) {
    await copy({
      config,
      fromKey: item.file.key,
      sourceEtag: item.file.sourceEtag,
      sourceVersionId: item.file.sourceVersionId,
      toKey: item.toKey,
      type: item.file.contentType,
      dryRun
    })
    console.log(`  ${item.target.label}: ${item.file.fileName}`)
  }
  for (const item of latestManifestPlan) {
    await put({
      config,
      key: item.key,
      body: item.body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=60, must-revalidate',
      dryRun
    })
    console.log(`  ${item.target.label}/latest.json`)
    console.log(
      `Latest manifest: ${joinUrl(config.publicBaseUrl, item.target.basePath, 'latest', 'latest.json')}`
    )
  }
}

export async function runPublishR2Command(argv, dependencies = {}) {
  const { command, flags } = readArgs(argv)
  if (flags.has('help') || flags.has('h') || !command) {
    usage()
    return
  }
  const dryRun = flags.has('dry-run')
  const upload = dependencies.uploadPlatform || uploadPlatform
  const promote = dependencies.promoteRelease || promoteRelease

  if (!dryRun) await runPublicReleaseGuard([])

  if (command === 'upload') {
    const artifactReceipt = verifyPublicReleaseArtifactReceipt({
      distDir: resolve(flags.get('dist') || 'dist'),
      platform: requireFlag(flags, 'platform'),
      tag: normalizeTag(requireFlag(flags, 'tag')),
      channel: readChannel(flags),
      sourceCommit: readSourceCommit(ROOT)
    })
    try {
      await upload({ flags, dryRun, artifactReceipt }, dependencies)
    } finally {
      artifactReceipt.close()
    }
    return
  }
  if (command === 'promote') {
    const artifactReceipts = verifyPromotionArtifactReceipts({
      flags,
      tag: normalizeTag(requireFlag(flags, 'tag')),
      channel: readChannel(flags),
      sourceCommit: readSourceCommit(ROOT)
    })
    try {
      await promote({ flags, dryRun, artifactReceipts }, dependencies)
    } finally {
      for (const artifactReceipt of artifactReceipts) artifactReceipt.close()
    }
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPublishR2Command(process.argv.slice(2)).catch((error) => {
    console.error(`[publish-r2] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
