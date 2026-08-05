import { createHash } from 'node:crypto'
import type { LookupAddress } from 'node:dns'
import { lookup as systemLookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { access, link, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import type { LookupFunction } from 'node:net'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'
import {
  datasetApiListInputSchema,
  datasetApiCatalogInputSchema,
  datasetApiRegisterProviderInputSchema,
  datasetApiMetadataInputSchema,
  datasetApiRawDataInputSchema,
  datasetApiRegisterInputSchema,
  type DatasetApiListInput,
  type DatasetApiCatalogInput,
  type DatasetApiRegisterProviderInput,
  type DatasetApiMetadataInput,
  type DatasetApiRawDataInput,
  type DatasetApiRegisterInput,
  type DatasetApiSource
} from './contract.js'
import { BIOLOGY_DATASET_PROVIDERS } from './providers.js'
import { EXECUTABLE_DATASET_PROVIDER_PRESETS } from './provider-presets.js'

type DatasetApiRegistry = {
  version: 1
  sources: DatasetApiSource[]
}

export type DatasetApiService = ReturnType<typeof createDatasetApiService>

const resilientDatasetFetch = createResilientDatasetFetch()
const RAW_ARTIFACT_PREVIEW_BYTES = 2 * 1024
const DEFAULT_DATASET_MAX_RETRIES = 3

export class DatasetApiRequestError extends Error {
  readonly code = 'DATASET_API_NETWORK_ERROR'

  constructor(
    message: string,
    readonly details: {
      sourceId: string
      host: string
      attempts: number
      causeCode?: string
      causeMessage: string
    }
  ) {
    super(message)
    this.name = 'DatasetApiRequestError'
  }
}

export function createDatasetApiService(options: {
  workspaceRoot?: string
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
} = {}) {
  const defaultWorkspaceRoot = options.workspaceRoot?.trim()
  const fetchImpl = options.fetchImpl ?? resilientDatasetFetch
  const env = options.env ?? process.env

  return {
    async catalog(raw: DatasetApiCatalogInput) {
      const input = datasetApiCatalogInputSchema.parse(raw)
      const query = input.query?.toLocaleLowerCase()
      const providers = BIOLOGY_DATASET_PROVIDERS.filter((provider) => {
        if (input.category && provider.category !== input.category) return false
        if (input.transport && provider.transport !== input.transport) return false
        if (!query) return true
        return [provider.id, provider.name, provider.metadata, provider.rawData]
          .some((value) => value.toLocaleLowerCase().includes(query))
      })
      return {
        providers,
        total: providers.length,
        note: 'provider-specific and sdk-required entries need dedicated adapters before execution; catalog presence alone does not imply generic HTTP compatibility.'
      }
    },

    async list(raw: DatasetApiListInput) {
      const input = datasetApiListInputSchema.parse(raw)
      const registryPath = resolveRegistryPath(input.workspaceRoot, defaultWorkspaceRoot)
      const registry = await readRegistry(registryPath)
      return {
        registryPath,
        sources: registry.sources.map((source) => ({
          ...source,
          auth: source.auth ? { ...source.auth, configured: !!env[source.auth.envVar] } : undefined
        }))
      }
    },

    async registerProvider(raw: DatasetApiRegisterProviderInput) {
      const input = datasetApiRegisterProviderInputSchema.parse(raw)
      const preset = EXECUTABLE_DATASET_PROVIDER_PRESETS[input.providerId]
      const sourceId = input.sourceId ?? preset.source.id
      const registered = await registerSource({
        ...preset.source,
        id: sourceId,
        workspaceRoot: input.workspaceRoot,
        overwrite: input.overwrite
      }, defaultWorkspaceRoot)
      return {
        ...registered,
        providerId: input.providerId,
        usage: {
          metadata: withSourceId(preset.metadataExample, sourceId),
          rawData: withSourceId(preset.rawDataExample, sourceId)
        }
      }
    },

    async register(raw: DatasetApiRegisterInput) {
      const input = datasetApiRegisterInputSchema.parse(raw)
      return registerSource(input, defaultWorkspaceRoot)
    },

    async metadata(raw: DatasetApiMetadataInput) {
      const input = datasetApiMetadataInputSchema.parse(raw)
      const { source, workspaceRoot } = await registeredSource(input.sourceId, input.workspaceRoot, defaultWorkspaceRoot)
      const url = buildEndpointUrl(source, source.metadataEndpoint, input.pathParameters, input.query, env)
      const response = await requestDataset(
        fetchImpl,
        url,
        source,
        env,
        input.timeoutMs ?? 30_000,
        undefined,
        input.maxRetries ?? DEFAULT_DATASET_MAX_RETRIES
      )
      const maxBytes = input.maxBytes ?? 2 * 1024 * 1024
      if (!response.ok) throw await httpError(response, maxBytes)
      const body = await readResponseBody(response, maxBytes)
      const contentType = response.headers.get('content-type') ?? ''
      const metadata = parseMetadata(body, contentType)
      const responseMode = input.responseMode ?? 'auto'
      const summarizeResponse = responseMode === 'summary' || (
        responseMode === 'auto' && Buffer.byteLength(body) > 64 * 1024
      )
      const responseMetadata = summarizeResponse
        ? summarizeMetadata(metadata)
        : metadata
      const sourceRecord = { id: source.id, name: source.name }
      const requestRecord = { url: redactUrl(url) }
      const responseRecord = { status: response.status, contentType, bytes: Buffer.byteLength(body) }
      let artifact: Record<string, unknown> | undefined
      if (input.outputFileName) {
        const format = typeof metadata === 'string' ? 'text' : 'json'
        const data = format === 'json'
          ? Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
          : Buffer.from(String(metadata))
        const sha256 = sha256Bytes(data)
        const outputDirectory = join(workspaceRoot, '.sciforge', 'datasets', 'metadata', source.id)
        await mkdir(outputDirectory, { recursive: true })
        const fileName = resolveRawFileName(input.outputFileName, response, url, input.sourceId)
        const requestedPath = join(outputDirectory, fileName)
        const temporaryPath = `${requestedPath}.${process.pid}.tmp`
        await writeFile(temporaryPath, data, { flag: 'wx' })
        let artifactPath = requestedPath
        let reused = false
        try {
          if (await pathExists(requestedPath)) {
            if (await hashFile(requestedPath) === sha256) reused = true
            else {
              artifactPath = versionedRawArtifactPath(requestedPath, sha256)
              reused = await installRawArtifact(temporaryPath, artifactPath, sha256)
            }
          } else reused = await installRawArtifact(temporaryPath, requestedPath, sha256)
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined)
        }
        artifactPath = await realpath(artifactPath)
        const manifestPath = `${artifactPath}.manifest.json`
        await writeRawArtifactManifest(manifestPath, {
          version: 1,
          artifactId: `sha256:${sha256}`,
          operation: 'dataset_api_metadata',
          format,
          path: artifactPath,
          manifestPath,
          sha256,
          bytes: data.byteLength,
          parents: [],
          parameters: {
            sourceId: source.id,
            responseMode: input.responseMode ?? 'auto',
            ...(input.planId ? { planId: input.planId } : {})
          },
          summary: { responseBytes: responseRecord.bytes, artifactBytes: data.byteLength, reused },
          schema: rawArtifactSchema(format),
          source: sourceRecord,
          request: requestRecord,
          response: responseRecord,
          origins: [{ source: sourceRecord, request: requestRecord, response: responseRecord }],
          createdAt: new Date().toISOString()
        })
        artifact = {
          path: artifactPath,
          manifestPath,
          sha256,
          bytes: data.byteLength,
          fileName: basename(artifactPath),
          format,
          reused
        }
      }
      return {
        ...(artifact ? { artifact } : {}),
        source: sourceRecord,
        request: requestRecord,
        response: responseRecord,
        metadata: responseMetadata,
        metadataResponseMode: summarizeResponse ? 'summary' : 'full',
        metadataTruncated: summarizeResponse
      }
    },

    async rawData(raw: DatasetApiRawDataInput) {
      const input = datasetApiRawDataInputSchema.parse(raw)
      const { source, workspaceRoot } = await registeredSource(
        input.sourceId,
        input.workspaceRoot,
        defaultWorkspaceRoot
      )
      let url = buildEndpointUrl(source, source.rawDataEndpoint, input.pathParameters, input.query, env)
      let resolvedFrom: Record<string, unknown> | undefined
      if (isNcbiGeneFastaRequest(source, input.query, input.expectedFormat, input.outputFileName)) {
        const resolved = await resolveNcbiGeneFastaRequest(
          fetchImpl,
          source,
          input.query ?? {},
          env,
          input.timeoutMs ?? 30_000,
          input.maxRetries ?? DEFAULT_DATASET_MAX_RETRIES
        )
        url = resolved.url
        resolvedFrom = resolved.resolvedFrom
      }
      const headers = buildRequestHeaders(source, env)
      if (input.range) {
        headers.set('range', `bytes=${input.range.start}-${input.range.end ?? ''}`)
      }
      const response = await requestDataset(
        fetchImpl,
        url,
        source,
        env,
        input.timeoutMs ?? 5 * 60_000,
        headers,
        input.maxRetries ?? DEFAULT_DATASET_MAX_RETRIES
      )
      const maxBytes = input.maxBytes ?? 256 * 1024 * 1024
      if (!response.ok) throw await httpError(response, Math.min(maxBytes, 16 * 1024))
      const fileName = resolveRawFileName(input.outputFileName, response, url, input.sourceId)
      const expectedFormat = resolveExpectedFormat(input.expectedFormat, input.outputFileName, input.query, response)
      const outputDir = join(workspaceRoot, '.sciforge', 'datasets', 'raw', input.sourceId)
      const artifactPath = join(outputDir, fileName)
      await mkdir(outputDir, { recursive: true })
      if (!input.overwrite && await pathExists(artifactPath)) {
        throw new Error(`Raw dataset artifact already exists: ${artifactPath}`)
      }
      const temporaryPath = `${artifactPath}.${process.pid}.tmp`
      const streamed = await streamResponseToFile(response, temporaryPath, maxBytes, expectedFormat)
      let finalArtifactPath = artifactPath
      let reused = false
      try {
        if (await pathExists(artifactPath)) {
          const existingHash = await hashFile(artifactPath)
          if (existingHash === streamed.sha256) {
            reused = true
          } else {
            finalArtifactPath = versionedRawArtifactPath(artifactPath, streamed.sha256)
            reused = await installRawArtifact(temporaryPath, finalArtifactPath, streamed.sha256)
          }
        } else {
          reused = await installRawArtifact(temporaryPath, artifactPath, streamed.sha256)
        }
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }
      finalArtifactPath = await realpath(finalArtifactPath)
      const sourceRecord = { id: source.id, name: source.name }
      const requestRecord = {
        url: redactUrl(url),
        ...(input.range ? { range: input.range } : {}),
        ...(resolvedFrom ? { resolvedFrom } : {})
      }
      const responseRecord = {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        contentRange: response.headers.get('content-range') ?? undefined,
        rangeSatisfied: input.range ? response.status === 206 : undefined,
        bytes: streamed.bytes
      }
      const manifestPath = `${finalArtifactPath}.manifest.json`
      await writeRawArtifactManifest(manifestPath, {
        version: 1,
        artifactId: `sha256:${streamed.sha256}`,
        operation: 'dataset_api_raw_data',
        format: expectedFormat,
        path: finalArtifactPath,
        manifestPath,
        sha256: streamed.sha256,
        bytes: streamed.bytes,
        parents: [],
        parameters: {
          sourceId: source.id,
          expectedFormat,
          ...(input.planId ? { planId: input.planId } : {}),
          ...(input.range ? { range: input.range } : {})
        },
        summary: { responseBytes: streamed.bytes, reused },
        schema: rawArtifactSchema(expectedFormat),
        source: sourceRecord,
        request: requestRecord,
        response: responseRecord,
        origins: [{ source: sourceRecord, request: requestRecord, response: responseRecord }],
        createdAt: new Date().toISOString()
      })
      const preview = expectedFormat === 'fasta' || expectedFormat === 'json' || expectedFormat === 'text'
        ? await readArtifactPreview(finalArtifactPath, RAW_ARTIFACT_PREVIEW_BYTES)
        : undefined
      return {
        artifact: {
          path: finalArtifactPath,
          manifestPath,
          sha256: streamed.sha256,
          bytes: streamed.bytes,
          fileName: basename(finalArtifactPath),
          format: expectedFormat,
          reused,
          ...(preview ? {
            preview: preview.content,
            previewTruncated: preview.truncated
          } : {})
        },
        source: sourceRecord,
        request: requestRecord,
        response: responseRecord
      }
    }
  }
}

async function readArtifactPreview(
  path: string,
  maxBytes: number
): Promise<{ content: string; truncated: boolean }> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return {
      content: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
      truncated: bytesRead > maxBytes
    }
  } finally {
    await handle.close()
  }
}

async function registerSource(
  input: DatasetApiRegisterInput,
  defaultWorkspaceRoot: string | undefined
): Promise<{ registryPath: string; source: DatasetApiSource; reused: boolean }> {
  const registryPath = resolveRegistryPath(input.workspaceRoot, defaultWorkspaceRoot)
  validateBaseUrl(input.baseUrl)
  validateEndpoint(input.metadataEndpoint, 'metadataEndpoint')
  validateEndpoint(input.rawDataEndpoint, 'rawDataEndpoint')
  validateHeaders(input.defaultHeaders)
  const registry = await readRegistry(registryPath)
  const existingIndex = registry.sources.findIndex((source) => source.id === input.id)
  const now = new Date().toISOString()
  const previous = existingIndex >= 0 ? registry.sources[existingIndex] : undefined
  const source: DatasetApiSource = {
    id: input.id,
    name: input.name ?? input.id,
    ...(input.description ? { description: input.description } : {}),
    baseUrl: input.baseUrl,
    metadataEndpoint: input.metadataEndpoint,
    rawDataEndpoint: input.rawDataEndpoint,
    ...(input.defaultHeaders ? { defaultHeaders: input.defaultHeaders } : {}),
    ...(input.auth ? { auth: input.auth } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  }
  if (previous && !input.overwrite) {
    if (sameSourceConfiguration(previous, source)) {
      return { registryPath, source: previous, reused: true }
    }
    throw new Error(`Dataset source '${input.id}' already exists with different settings. Set overwrite=true to replace it.`)
  }
  if (existingIndex >= 0) registry.sources[existingIndex] = source
  else registry.sources.push(source)
  registry.sources.sort((left, right) => left.id.localeCompare(right.id))
  await writeRegistry(registryPath, registry)
  return { registryPath, source, reused: false }
}

function sameSourceConfiguration(left: DatasetApiSource, right: DatasetApiSource): boolean {
  const configuration = (source: DatasetApiSource) => ({
    id: source.id,
    name: source.name,
    description: source.description,
    baseUrl: source.baseUrl,
    metadataEndpoint: source.metadataEndpoint,
    rawDataEndpoint: source.rawDataEndpoint,
    defaultHeaders: source.defaultHeaders,
    auth: source.auth
  })
  return JSON.stringify(configuration(left)) === JSON.stringify(configuration(right))
}

function withSourceId(example: Record<string, unknown>, sourceId: string): Record<string, unknown> {
  return { ...example, sourceId }
}

async function registeredSource(
  sourceId: string,
  requestedRoot: string | undefined,
  defaultRoot: string | undefined
): Promise<{ source: DatasetApiSource; workspaceRoot: string }> {
  const workspaceRoot = resolveWorkspaceRoot(requestedRoot, defaultRoot)
  const registry = await readRegistry(registryPathFor(workspaceRoot))
  const source = registry.sources.find((candidate) => candidate.id === sourceId)
  if (!source) throw new Error(`Dataset source '${sourceId}' is not registered.`)
  return { source, workspaceRoot }
}

function resolveWorkspaceRoot(requestedRoot: string | undefined, defaultRoot: string | undefined): string {
  const root = requestedRoot?.trim() || defaultRoot
  if (!root) throw new Error('workspaceRoot is required for Dataset API access.')
  return resolve(root)
}

function registryPathFor(workspaceRoot: string): string {
  return join(workspaceRoot, '.sciforge', 'datasets', 'api-sources.json')
}

function resolveRegistryPath(requestedRoot: string | undefined, defaultRoot: string | undefined): string {
  return registryPathFor(resolveWorkspaceRoot(requestedRoot, defaultRoot))
}

async function readRegistry(path: string): Promise<DatasetApiRegistry> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<DatasetApiRegistry>
    return { version: 1, sources: Array.isArray(parsed.sources) ? parsed.sources : [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sources: [] }
    throw new Error(`Failed to read Dataset API registry: ${message(error)}`)
  }
}

async function writeRegistry(path: string, registry: DatasetApiRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

function validateBaseUrl(value: string): void {
  const url = new URL(value)
  if (url.username || url.password) throw new Error('Dataset baseUrl must not contain credentials.')
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return
  throw new Error('Dataset baseUrl must use HTTPS; HTTP is allowed only for loopback development APIs.')
}

function validateEndpoint(value: string, field: string): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new Error(`${field} must be relative to baseUrl.`)
  }
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  const normalized = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function validateHeaders(headers: Record<string, string> | undefined): void {
  for (const name of Object.keys(headers ?? {})) {
    if (['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())) {
      throw new Error(`Secret-bearing header '${name}' must be configured through auth.envVar.`)
    }
  }
}

function buildEndpointUrl(
  source: DatasetApiSource,
  endpoint: string,
  pathParameters: Record<string, string> | undefined,
  query: Record<string, string | number | boolean | Array<string | number | boolean>> | undefined,
  env: NodeJS.ProcessEnv
): URL {
  const renderedEndpoint = endpoint.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = pathParameters?.[name] ?? (
      name === 'identifier'
        ? pathParameters?.accession ?? pathParameters?.id
        : undefined
    )
    if (!value) throw new Error(`Dataset endpoint requires pathParameters.${name}.`)
    return encodeURIComponent(value)
  })
  const base = new URL(source.baseUrl)
  const normalizedBase = base.toString().endsWith('/') ? base : new URL(`${base.toString()}/`)
  const url = new URL(renderedEndpoint, normalizedBase)
  if (url.origin !== base.origin) throw new Error('Dataset endpoint must stay on the registered origin.')
  for (const [name, rawValue] of Object.entries(query ?? {})) {
    url.searchParams.delete(name)
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      url.searchParams.append(name, String(value))
    }
  }
  if (source.auth?.type === 'query') {
    const secret = authSecret(source, env)
    if (secret) url.searchParams.set(source.auth.queryName ?? 'api_key', secret)
  }
  return url
}

function buildRequestHeaders(source: DatasetApiSource, env: NodeJS.ProcessEnv): Headers {
  validateHeaders(source.defaultHeaders)
  const headers = new Headers(source.defaultHeaders)
  if (!headers.has('accept')) headers.set('accept', 'application/json, application/octet-stream;q=0.9, */*;q=0.5')
  if (!headers.has('user-agent')) headers.set('user-agent', 'SciForge-Dataset-API/0.1.0')
  if (source.auth) {
    if (source.auth.type === 'query') return headers
    const secret = authSecret(source, env)
    if (!secret) return headers
    if (source.auth.type === 'bearer') headers.set('authorization', `Bearer ${secret}`)
    else headers.set(source.auth.headerName ?? 'x-api-key', secret)
  }
  return headers
}

function createResilientDatasetFetch(): typeof fetch {
  const dispatcher = new Agent({
    connect: {
      lookup: createCachedDnsLookup()
    }
  })
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher }
    ) as unknown as Promise<Response>) as typeof fetch
}

function createCachedDnsLookup(): LookupFunction {
  const cache = new Map<string, { addresses: LookupAddress[]; expiresAt: number }>()
  const ttlMs = 5 * 60_000
  const staleTtlMs = 60 * 60_000
  return (hostname, options, callback) => {
    const key = hostname.toLowerCase()
    const cached = cache.get(key)
    const now = Date.now()
    const deliver = (addresses: LookupAddress[]) => {
      const family = typeof options.family === 'number' ? options.family : 0
      const filtered = family === 4 || family === 6
        ? addresses.filter((address) => address.family === family)
        : addresses
      const usable = filtered.length ? filtered : addresses
      if (!usable.length) {
        callback(Object.assign(new Error(`No DNS addresses resolved for ${hostname}.`), { code: 'ENOTFOUND' }), '', 0)
        return
      }
      if (options.all) callback(null, usable)
      else callback(null, usable[0]!.address, usable[0]!.family)
    }
    if (cached && cached.expiresAt > now) {
      deliver(cached.addresses)
      return
    }
    void systemLookup(hostname, { all: true, verbatim: true }).then((addresses) => {
      cache.set(key, { addresses, expiresAt: Date.now() + ttlMs })
      deliver(addresses)
    }).catch((error: unknown) => {
      if (cached && cached.expiresAt + staleTtlMs > now) {
        deliver(cached.addresses)
        return
      }
      callback(error as NodeJS.ErrnoException, '', 0)
    })
  }
}

function authSecret(source: DatasetApiSource, env: NodeJS.ProcessEnv): string | undefined {
  if (!source.auth) return undefined
  const secret = env[source.auth.envVar]
  if (!secret && source.auth.required !== false) {
    throw new Error(`Dataset auth environment variable '${source.auth.envVar}' is not configured.`)
  }
  return secret
}

async function requestDataset(
  fetchImpl: typeof fetch,
  url: URL,
  source: DatasetApiSource,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  providedHeaders?: Headers,
  maxRetries = 2
): Promise<Response> {
  let lastError: unknown
  const attempts = maxRetries + 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: providedHeaders ?? buildRequestHeaders(source, env),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!isRetryableStatus(response.status) || attempt === attempts) return response
      await response.body?.cancel().catch(() => undefined)
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts || !isRetryableNetworkError(error)) {
        throw requestError(source, url, attempt, error)
      }
    }
    await retryDelay(attempt)
  }
  throw requestError(source, url, attempts, lastError)
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  const code = errorCode(error)
  return error.name === 'TypeError' || error.name === 'TimeoutError' || error.name === 'AbortError' ||
    ['EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(code ?? '')
}

function requestError(source: DatasetApiSource, url: URL, attempts: number, error: unknown): DatasetApiRequestError {
  const causeMessage = message(error)
  const causeCode = errorCode(error)
  const diagnostic = [causeCode, nestedCauseMessage(error)].filter(Boolean).join(': ')
  return new DatasetApiRequestError(
    `Dataset API request to '${source.id}' (${url.hostname}) failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${causeMessage}${diagnostic ? `; cause=${diagnostic}` : ''}`,
    {
      sourceId: source.id,
      host: url.hostname,
      attempts,
      ...(causeCode ? { causeCode } : {}),
      causeMessage: nestedCauseMessage(error) || causeMessage
    }
  )
}

function errorCode(error: unknown): string | undefined {
  const direct = (error as NodeJS.ErrnoException | undefined)?.code
  if (typeof direct === 'string') return direct
  const cause = (error as Error & { cause?: NodeJS.ErrnoException } | undefined)?.cause
  return typeof cause?.code === 'string' ? cause.code : undefined
}

function nestedCauseMessage(error: unknown): string | undefined {
  const cause = (error as Error & { cause?: unknown } | undefined)?.cause
  return cause instanceof Error ? cause.message : cause === undefined ? undefined : String(cause)
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(150 * (2 ** (attempt - 1)), 1_000)))
}

function isNcbiGeneFastaRequest(
  source: DatasetApiSource,
  query: DatasetApiRawDataInput['query'],
  expectedFormat: DatasetApiRawDataInput['expectedFormat'],
  outputFileName: string | undefined
): boolean {
  if (source.id !== 'ncbi-eutils') return false
  const db = scalarQueryValue(query?.db)?.toLowerCase()
  const rettype = scalarQueryValue(query?.rettype)?.toLowerCase()
  return db === 'gene' && (
    rettype === 'fasta' || expectedFormat === 'fasta' || /\.(?:fa|faa|fna|fasta)$/i.test(outputFileName ?? '')
  )
}

async function resolveNcbiGeneFastaRequest(
  fetchImpl: typeof fetch,
  source: DatasetApiSource,
  query: NonNullable<DatasetApiRawDataInput['query']>,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxRetries: number
): Promise<{ url: URL; resolvedFrom: Record<string, unknown> }> {
  const geneId = scalarQueryValue(query.id)
  if (!geneId) throw new Error('NCBI Gene FASTA access requires query.id with one Gene ID.')
  const summaryUrl = buildEndpointUrl(source, 'esummary.fcgi', undefined, {
    db: 'gene',
    id: geneId,
    retmode: 'json',
    ...(query.tool !== undefined ? { tool: query.tool } : {})
  }, env)
  const summaryResponse = await requestDataset(
    fetchImpl,
    summaryUrl,
    source,
    env,
    timeoutMs,
    undefined,
    maxRetries
  )
  if (!summaryResponse.ok) throw await httpError(summaryResponse, 1024 * 1024)
  const summaryBody = await readResponseBody(summaryResponse, 1024 * 1024)
  const summary = JSON.parse(summaryBody) as {
    result?: Record<string, { genomicinfo?: Array<{ chraccver?: string; chrstart?: number; chrstop?: number }> }>
  }
  const genomic = summary.result?.[geneId]?.genomicinfo?.[0]
  const accession = genomic?.chraccver?.trim()
  const chrStart = Number(genomic?.chrstart)
  const chrStop = Number(genomic?.chrstop)
  if (!accession || !Number.isInteger(chrStart) || !Number.isInteger(chrStop) || chrStart < 0 || chrStop < 0) {
    throw new Error(`NCBI Gene ${geneId} does not expose resolvable genomic sequence coordinates.`)
  }
  const sequenceStart = Math.min(chrStart, chrStop) + 1
  const sequenceStop = Math.max(chrStart, chrStop) + 1
  const strand = chrStart > chrStop ? 2 : 1
  const url = buildEndpointUrl(source, source.rawDataEndpoint, undefined, {
    db: 'nuccore',
    id: accession,
    seq_start: sequenceStart,
    seq_stop: sequenceStop,
    strand,
    rettype: 'fasta',
    retmode: 'text',
    ...(query.tool !== undefined ? { tool: query.tool } : {})
  }, env)
  return {
    url,
    resolvedFrom: {
      database: 'gene',
      geneId,
      accession,
      sequenceStart,
      sequenceStop,
      strand
    }
  }
}

function scalarQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : undefined
  return value === undefined ? undefined : String(value)
}

async function httpError(response: Response, maxBytes: number): Promise<Error> {
  const body = await readResponseBody(response, maxBytes).catch(() => '')
  return new Error(`Dataset API returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`)
}

async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Dataset response exceeds the ${maxBytes}-byte limit.`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`Dataset response exceeds the ${maxBytes}-byte limit.`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

function parseMetadata(body: string, contentType: string): unknown {
  const firstCharacter = body.trimStart()[0]
  if (/json/i.test(contentType) || firstCharacter === '[' || firstCharacter === '{') {
    try {
      return JSON.parse(body)
    } catch (error) {
      throw new Error(`Dataset metadata is not valid JSON: ${message(error)}`)
    }
  }
  return body
}

function summarizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.length > 256 ? `${value.slice(0, 256)}…` : value
  }
  if (depth >= 2) {
    if (Array.isArray(value)) return { itemCount: value.length }
    if (typeof value === 'object') return { fieldCount: Object.keys(value).length }
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.slice(0, 2).map((item) => summarizeMetadata(item, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, summarizeMetadata(item, depth + 1)])
    )
  }
  return String(value)
}

async function streamResponseToFile(
  response: Response,
  outputPath: string,
  maxBytes: number,
  expectedFormat: 'fasta' | 'json' | 'text' | 'binary'
): Promise<{ bytes: number; sha256: string }> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Raw dataset response exceeds the ${maxBytes}-byte limit.`)
  }
  const handle = await open(outputPath, 'wx')
  const hash = createHash('sha256')
  let bytes = 0
  const prefixChunks: Uint8Array[] = []
  let prefixBytes = 0
  try {
    const reader = response.body?.getReader()
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw new Error(`Raw dataset response exceeds the ${maxBytes}-byte limit.`)
        }
        hash.update(value)
        if (prefixBytes < 4096) {
          const remaining = 4096 - prefixBytes
          const prefix = value.subarray(0, remaining)
          prefixChunks.push(prefix)
          prefixBytes += prefix.byteLength
        }
        await handle.write(value)
      }
    }
    validateResponseFormat(
      new TextDecoder().decode(Buffer.concat(prefixChunks.map((chunk) => Buffer.from(chunk)))),
      expectedFormat
    )
  } catch (error) {
    await handle.close()
    await rm(outputPath, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  return { bytes, sha256: hash.digest('hex') }
}

function resolveExpectedFormat(
  requested: DatasetApiRawDataInput['expectedFormat'],
  outputFileName: string | undefined,
  query: DatasetApiRawDataInput['query'],
  response: Response
): 'fasta' | 'json' | 'text' | 'binary' {
  if (requested && requested !== 'auto') return requested
  const rettype = scalarQueryValue(query?.rettype)?.toLowerCase()
  const contentType = response.headers.get('content-type') ?? ''
  const fileName = outputFileName ?? ''
  if (rettype === 'fasta' || /format\s*=\s*fasta/i.test(contentType) || /\.(?:fa|faa|fna|fasta)$/i.test(fileName)) {
    return 'fasta'
  }
  if (/json/i.test(contentType) || /\.json$/i.test(fileName)) return 'json'
  if (/^text\//i.test(contentType) || /\.(?:txt|tsv|csv)$/i.test(fileName)) return 'text'
  return 'binary'
}

function validateResponseFormat(prefix: string, expectedFormat: 'fasta' | 'json' | 'text' | 'binary'): void {
  if (expectedFormat === 'binary') return
  const trimmed = prefix.trimStart()
  if (expectedFormat === 'fasta' && !trimmed.startsWith('>')) {
    throw new Error('Dataset response format mismatch: expected FASTA data beginning with a ">" header.')
  }
  if (expectedFormat === 'json' && trimmed[0] !== '{' && trimmed[0] !== '[') {
    throw new Error('Dataset response format mismatch: expected a JSON object or array.')
  }
  if (expectedFormat === 'text' && prefix.includes('\u0000')) {
    throw new Error('Dataset response format mismatch: expected text but received binary data.')
  }
}

function resolveRawFileName(
  requested: string | undefined,
  response: Response,
  url: URL,
  sourceId: string
): string {
  const dispositionName = response.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1]
  const urlName = basename(url.pathname)
  const inferred = dispositionName ? decodeURIComponent(dispositionName) : urlName || `${sourceId}-raw${extensionForContentType(response.headers.get('content-type'))}`
  const candidate = requested ?? inferred
  if (candidate !== basename(candidate) || candidate === '.' || candidate === '..') {
    throw new Error('outputFileName must be a plain file name without directory segments.')
  }
  const sanitized = candidate.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  if (!sanitized) throw new Error('Unable to derive a safe raw-data file name.')
  return extname(sanitized) ? sanitized : `${sanitized}${extensionForContentType(response.headers.get('content-type'))}`
}

function extensionForContentType(contentType: string | null): string {
  if (/json/i.test(contentType ?? '')) return '.json'
  if (/csv/i.test(contentType ?? '')) return '.csv'
  if (/zip/i.test(contentType ?? '')) return '.zip'
  if (/gzip/i.test(contentType ?? '')) return '.gz'
  return '.bin'
}

function rawArtifactSchema(format: 'fasta' | 'json' | 'text' | 'binary'): Record<string, unknown> {
  if (format === 'fasta') {
    return {
      version: 1,
      format,
      fields: [
        { name: 'header', types: { string: 1 }, nullable: false },
        { name: 'id', types: { string: 1 }, nullable: false },
        { name: 'description', types: { string: 1 }, nullable: true },
        { name: 'sequence', types: { string: 1 }, nullable: false },
        { name: 'length', types: { number: 1 }, nullable: false }
      ]
    }
  }
  return {
    version: 1,
    format,
    fields: [],
    inference: format === 'json' ? 'deferred-to-dataset_profile' : 'not-applicable'
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function versionedRawArtifactPath(path: string, sha256: string): string {
  const extension = extname(path)
  const stem = basename(path, extension)
  return join(dirname(path), `${stem}-${sha256.slice(0, 12)}${extension}`)
}

async function installRawArtifact(temporaryPath: string, targetPath: string, sha256: string): Promise<boolean> {
  try {
    await link(temporaryPath, targetPath)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (await hashFile(targetPath) !== sha256) {
      throw new Error(`Raw dataset artifact collision at content-addressed path: ${targetPath}`)
    }
    return true
  }
}

async function writeRawArtifactManifest(path: string, manifest: Record<string, unknown>): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = JSON.parse(await readFile(path, 'utf8')) as { sha256?: string; path?: string }
    if (existing.sha256 !== manifest.sha256 || existing.path !== manifest.path) {
      throw new Error(`Raw dataset manifest collision: ${path}`)
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function redactUrl(url: URL): string {
  const safe = new URL(url)
  for (const key of safe.searchParams.keys()) {
    if (/token|secret|key|auth|password/i.test(key)) safe.searchParams.set(key, '[REDACTED]')
  }
  return safe.toString()
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
