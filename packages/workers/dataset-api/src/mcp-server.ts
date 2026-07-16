import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  DATASET_API_MCP_FLAG,
  DATASET_API_MCP_SERVER_NAME,
  DATASET_API_MCP_SERVER_VERSION,
  datasetApiCatalogInputSchema,
  datasetApiRegisterProviderInputSchema,
  datasetApiListInputSchema,
  datasetApiMetadataInputSchema,
  datasetApiRawDataInputSchema,
  datasetApiRegisterInputSchema
} from './contract.js'
import { EXECUTABLE_DATASET_PROVIDER_PRESETS } from './provider-presets.js'
import { createDatasetApiService, DatasetApiRequestError, type DatasetApiService } from './service.js'

type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const EXECUTABLE_PROVIDER_NAMES = Object.values(EXECUTABLE_DATASET_PROVIDER_PRESETS)
  .map((preset) => preset.source.name)
  .join(', ')

export function createDatasetApiMcpServer(service: DatasetApiService = createDatasetApiService()): McpServer {
  const server = new McpServer(
    { name: DATASET_API_MCP_SERVER_NAME, version: DATASET_API_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('dataset_api_catalog', {
    title: 'Browse Biology Dataset Providers',
    description: 'Browse the built-in catalog of public biology data providers. Each entry distinguishes metadata access from raw-data access and declares whether generic HTTP, a provider-specific adapter, or an SDK is required.',
    inputSchema: datasetApiCatalogInputSchema,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await service.catalog(datasetApiCatalogInputSchema.parse(args))
    return textResult(
      result.providers.length
        ? `Biology dataset providers:\n${result.providers.map((provider) => `- ${provider.id}: ${provider.transport}, adapter=${provider.adapter}`).join('\n')}`
        : 'No biology dataset providers match the requested filters.',
      { result }
    )
  }))

  server.registerTool('dataset_api_register_provider', {
    title: 'Register Built-in Biology Provider',
    description: `Register one of ${Object.keys(EXECUTABLE_DATASET_PROVIDER_PRESETS).length} executable built-in provider presets: ${EXECUTABLE_PROVIDER_NAMES}. The result includes metadata and raw-data usage examples.`,
    inputSchema: datasetApiRegisterProviderInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async (args) => runTool(async () => {
    const result = await service.registerProvider(datasetApiRegisterProviderInputSchema.parse(args))
    return textResult(
      `Registered built-in provider '${result.providerId}' as dataset source '${result.source.id}'.`,
      { result }
    )
  }))

  server.registerTool('dataset_api_list', {
    title: 'List Dataset Databases',
    description: 'List workspace-registered dataset databases, including their metadata and raw-data endpoint templates.',
    inputSchema: datasetApiListInputSchema,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await service.list(datasetApiListInputSchema.parse(args))
    return textResult(
      result.sources.length
        ? `Registered dataset databases:\n${result.sources.map((source) => `- ${source.id}: metadata=${source.metadataEndpoint}, raw=${source.rawDataEndpoint}`).join('\n')}`
        : 'No dataset databases are registered in this workspace.',
      { result }
    )
  }))

  server.registerTool('dataset_api_register', {
    title: 'Register Dataset Database',
    description: 'Register an API-backed dataset database with separate metadata and raw-data endpoint templates. Secrets are referenced by environment-variable name and are never stored.',
    inputSchema: datasetApiRegisterInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async (args) => runTool(async () => {
    const result = await service.register(datasetApiRegisterInputSchema.parse(args))
    return textResult(
      `Registered dataset database '${result.source.id}' with metadata and raw-data endpoints.`,
      { result }
    )
  }))

  server.registerTool('dataset_api_metadata', {
    title: 'Read Dataset Metadata',
    description: 'Read metadata from a registered dataset database with built-in transient-network retries and structured diagnostics. responseMode=auto (default) returns complete small payloads and a bounded structural summary for payloads over 64 KiB; use full only when the complete payload is necessary. Endpoint placeholders are supplied through pathParameters and query parameters remain structured. If this tool reports an error, report that Dataset API error; do not bypass it with shell, curl, or workspace search.',
    inputSchema: datasetApiMetadataInputSchema,
    annotations: { ...READ_ONLY_ANNOTATIONS, openWorldHint: true }
  }, async (args) => runTool(async () => {
    const input = datasetApiMetadataInputSchema.parse(args)
    const result = await service.metadata(input)
    return textResult(
      `Read ${result.response.bytes} metadata bytes from '${result.source.id}'${shouldSummarizeMetadata(result.response.bytes, input.responseMode) ? ' (returned as a bounded structural summary)' : ''}.`,
      { result: compactMetadataResult(result, input.responseMode) }
    )
  }))

  server.registerTool('dataset_api_raw_data', {
    title: 'Download Dataset Raw Data',
    description: 'Stream validated raw data from a registered dataset database into the workspace dataset cache. Supports endpoint placeholders, byte ranges, checksums, expected-format validation, size limits, transient-network retries, NCBI Gene-to-genomic-FASTA resolution, and non-overwriting writes. If this tool reports an error, report that Dataset API error; do not bypass it with shell or curl.',
    inputSchema: datasetApiRawDataInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async (args) => runTool(async () => {
    const result = await service.rawData(datasetApiRawDataInputSchema.parse(args))
    return textResult(
      `Downloaded ${result.response.bytes} raw-data bytes to ${result.artifact.path} (sha256 ${result.artifact.sha256}).`,
      { result }
    )
  }))

  return server
}

export async function startDatasetApiMcpServer(
  service: DatasetApiService = createDatasetApiService(),
  options: { transport?: Transport } = {}
): Promise<void> {
  await createDatasetApiMcpServer(service).connect(options.transport ?? new StdioServerTransport())
}

export async function runDatasetApiMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(DATASET_API_MCP_FLAG)) return false
  const workspaceRoot = argValue(argv, '--workspace-root')?.trim()
  await startDatasetApiMcpServer(createDatasetApiService({ workspaceRoot }))
  return true
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

async function runTool(operation: () => Promise<McpTextResult>): Promise<McpTextResult> {
  try {
    return await operation()
  } catch (error) {
    const errorMessage = message(error)
    return {
      content: [{
        type: 'text',
        text: `${errorMessage}\nDo not bypass Dataset API failures with shell or curl; retry through the Dataset API tool or report the structured diagnostic.`
      }],
      structuredContent: {
        error: error instanceof DatasetApiRequestError
          ? { code: error.code, message: errorMessage, retryable: true, ...error.details }
          : { code: 'DATASET_API_ERROR', message: errorMessage, retryable: false }
      },
      isError: true
    }
  }
}

function textResult(text: string, structuredContent?: Record<string, unknown>): McpTextResult {
  return { content: [{ type: 'text', text }], ...(structuredContent ? { structuredContent } : {}) }
}

type DatasetApiMetadataResult = Awaited<ReturnType<DatasetApiService['metadata']>>

function shouldSummarizeMetadata(bytes: number, mode: 'auto' | 'summary' | 'full' | undefined): boolean {
  return mode === 'summary' || (mode !== 'full' && bytes > 64 * 1024)
}

function compactMetadataResult(
  result: DatasetApiMetadataResult,
  mode: 'auto' | 'summary' | 'full' | undefined
): DatasetApiMetadataResult | Record<string, unknown> {
  if (!shouldSummarizeMetadata(result.response.bytes, mode)) return result
  const { metadata, ...rest } = result
  return {
    ...rest,
    metadata: summarizeMetadata(metadata),
    metadataTruncated: true,
    metadataResponseMode: 'summary',
    guidance: 'Call dataset_api_metadata with responseMode=full only if the complete metadata payload is required.'
  }
}

function summarizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length <= 500 ? value : `${value.slice(0, 500)}…`
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      sample: depth >= 2 ? [] : value.slice(0, 3).map((entry) => summarizeMetadata(entry, depth + 1))
    }
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const selected = entries.slice(0, 30).map(([key, entry]) => [
      key,
      depth >= 2 && typeof entry === 'object' && entry !== null
        ? Array.isArray(entry) ? { type: 'array', count: entry.length } : { type: 'object', keys: Object.keys(entry).slice(0, 20) }
        : summarizeMetadata(entry, depth + 1)
    ])
    return {
      ...Object.fromEntries(selected),
      ...(entries.length > selected.length ? { omittedKeyCount: entries.length - selected.length } : {})
    }
  }
  return String(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
