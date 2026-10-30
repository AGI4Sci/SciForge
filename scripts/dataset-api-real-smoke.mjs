import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  EXECUTABLE_DATASET_PROVIDER_PRESETS,
  createDatasetApiService,
  createDatasetObjectStoreService
} from '@sciforge/domain-dataset-api/smoke'

const REMAINING_PUBLIC_PROVIDERS = [
  'ncbi-eutils',
  'ucsc-genome-browser',
  'pubchem-pug-rest',
  'clinicaltrials-gov',
  'kegg',
  'quickgo',
  'alphafold-db'
]

const args = new Set(process.argv.slice(2))
const runPublic = args.size === 0 || args.has('--public')
const runPrivate = args.has('--private')
const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-real-smoke-'))
const results = []

try {
  if (runPublic) await smokePublicProviders(workspaceRoot, results)
  if (runPrivate) await smokePrivateObjectStore(workspaceRoot, results)
} finally {
  await rm(workspaceRoot, { recursive: true, force: true })
}

const report = {
  ok: results.length > 0 && results.every((result) => result.ok),
  passed: results.filter((result) => result.ok).length,
  failed: results.filter((result) => !result.ok).length,
  results
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1

async function smokePublicProviders(root, output) {
  const service = createDatasetApiService({ workspaceRoot: root })
  for (const providerId of REMAINING_PUBLIC_PROVIDERS) {
    const preset = EXECUTABLE_DATASET_PROVIDER_PRESETS[providerId]
    try {
      await service.registerProvider({ providerId, overwrite: true })
    } catch (error) {
      output.push(failure(providerId, 'register-provider', error))
      continue
    }

    try {
      const result = await service.metadata({
        ...preset.metadataExample,
        responseMode: 'summary',
        maxRetries: 3
      })
      output.push(success(providerId, 'metadata', result))
    } catch (error) {
      output.push(failure(providerId, 'metadata', error))
    }

    try {
      const result = await service.rawData({
        ...preset.rawDataExample,
        overwrite: true,
        maxRetries: 3
      })
      output.push(success(providerId, 'raw-data', result))
    } catch (error) {
      output.push(failure(providerId, 'raw-data', error))
    }
  }
}

async function smokePrivateObjectStore(root, output) {
  const endpoint = requiredEnv('DATASET_SMOKE_S3_ENDPOINT')
  const bucket = requiredEnv('DATASET_SMOKE_S3_BUCKET')
  const accessKeyId = requiredEnv('DATASET_SMOKE_S3_ACCESS_KEY')
  const secretAccessKey = requiredEnv('DATASET_SMOKE_S3_SECRET_KEY')
  const prefix = process.env.DATASET_SMOKE_S3_PREFIX?.trim() || undefined
  const region = process.env.DATASET_SMOKE_S3_REGION?.trim() || 'us-east-1'
  const sourceId = process.env.DATASET_SMOKE_S3_SOURCE_ID?.trim() || 'private-smoke'
  const env = {
    DATASET_SMOKE_S3_ACCESS_KEY: accessKeyId,
    DATASET_SMOKE_S3_SECRET_KEY: secretAccessKey
  }
  const service = createDatasetObjectStoreService({ workspaceRoot: root, env })

  try {
    await service.register({
      id: sourceId,
      endpoint,
      bucket,
      prefix,
      region,
      forcePathStyle: true,
      allowInsecureHttp: endpoint.startsWith('http://'),
      credentialEnv: {
        accessKeyId: 'DATASET_SMOKE_S3_ACCESS_KEY',
        secretAccessKey: 'DATASET_SMOKE_S3_SECRET_KEY'
      },
      overwrite: true
    })
    output.push({ target: sourceId, operation: 'register-object-store', ok: true })
  } catch (error) {
    output.push(failure(sourceId, 'register-object-store', error))
    return
  }

  let object
  try {
    const result = await service.listObjects({ sourceId, maxKeys: 100 })
    object = result.objects.find((entry) => typeof entry.relativeKey === 'string' && (entry.size ?? 0) > 0)
      ?? result.objects.find((entry) => typeof entry.relativeKey === 'string')
    output.push({
      target: sourceId,
      operation: 'list-objects',
      ok: true,
      status: result.response.status,
      bytes: result.objects.length
    })
  } catch (error) {
    output.push(failure(sourceId, 'list-objects', error))
    return
  }

  const key = object?.relativeKey
  if (!key) {
    output.push({ target: sourceId, operation: 'select-object', ok: false, error: 'No object was returned below the configured prefix.' })
    return
  }

  try {
    const result = await service.metadata({ sourceId, key })
    output.push({
      target: sourceId,
      operation: 'object-metadata',
      ok: true,
      status: result.response.status,
      bytes: result.metadata.size
    })
  } catch (error) {
    output.push(failure(sourceId, 'object-metadata', error))
  }

  try {
    const size = typeof object.size === 'number' ? object.size : 4096
    const end = Math.max(0, Math.min(size - 1, 4095))
    const result = await service.rawData({
      sourceId,
      key,
      outputFileName: `smoke-${basename(key) || 'object.bin'}`,
      expectedFormat: 'binary',
      range: { start: 0, end },
      maxBytes: 8192,
      overwrite: true
    })
    output.push({
      target: sourceId,
      operation: 'object-raw-data-range',
      ok: true,
      status: result.response.status,
      bytes: result.artifact.bytes,
      artifactSha256: result.artifact.sha256
    })
  } catch (error) {
    output.push(failure(sourceId, 'object-raw-data-range', error))
  }
}

function success(target, operation, result) {
  return {
    target,
    operation,
    ok: true,
    status: result.response?.status,
    bytes: result.response?.bytes ?? result.artifact?.bytes,
    artifactSha256: result.artifact?.sha256
  }
}

function failure(target, operation, error) {
  return {
    target,
    operation,
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for --private smoke testing.`)
  return value
}
