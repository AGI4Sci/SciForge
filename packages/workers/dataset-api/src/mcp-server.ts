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
  datasetApiRegisterInputSchema,
  datasetPreparePlanInputSchema,
  datasetProfileInputSchema,
  datasetFilterInputSchema,
  datasetSelectColumnsInputSchema,
  datasetTransformInputSchema,
  datasetDeduplicateInputSchema,
  datasetIdMapInputSchema,
  datasetJoinInputSchema,
  datasetValidateInputSchema,
  datasetPublishInputSchema
} from './contract.js'
import { EXECUTABLE_DATASET_PROVIDER_PRESETS } from './provider-presets.js'
import { createDatasetProcessingService, type DatasetProcessingService } from './processing.js'
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

const CONTROLLED_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const EXECUTABLE_PROVIDER_NAMES = Object.values(EXECUTABLE_DATASET_PROVIDER_PRESETS)
  .map((preset) => preset.source.name)
  .join(', ')

export function createDatasetApiMcpServer(
  service: DatasetApiService = createDatasetApiService(),
  processing: DatasetProcessingService = createDatasetProcessingService()
): McpServer {
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

  server.registerTool('dataset_prepare_plan', {
    title: 'Prepare Dataset Processing Plan',
    description: 'Persist a deterministic, reviewable dataset-preparation plan that records providers, operations, exclusions, outputs, and whether the user confirmed it. Mutating processing tools only accept confirmed plans.',
    inputSchema: datasetPreparePlanInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.preparePlan(datasetPreparePlanInputSchema.parse(args))
    return textResult(
      `Prepared ${result.plan.status} dataset plan '${result.plan.planId}' with ${result.plan.operations.length} operations.`,
      { result }
    )
  }))

  server.registerTool('dataset_profile', {
    title: 'Profile Dataset Artifact',
    description: 'Inspect a workspace JSON, JSONL, CSV, TSV, or FASTA artifact and persist a profile report with record counts, fields, inferred types, missing values, uniqueness, samples, size, and checksum.',
    inputSchema: datasetProfileInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.profile(datasetProfileInputSchema.parse(args))
    return textResult(
      `Profiled ${result.profile.records} records from a ${result.profile.format} dataset. Report: ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_filter', {
    title: 'Filter Dataset Artifact',
    description: 'Apply structured, code-free filter conditions to a confirmed-plan dataset artifact. The source is never overwritten; a deterministic child artifact, checksum, manifest, and exclusion counts are produced.',
    inputSchema: datasetFilterInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.filter(datasetFilterInputSchema.parse(args))
    return textResult(
      `Filtered ${result.counts.inputRecords} records to ${result.counts.outputRecords}; wrote ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_select_columns', {
    title: 'Select and Rename Dataset Fields',
    description: 'Select, rename, default, and require structured fields without arbitrary SQL or code. Supports deterministic conversion among JSON, JSONL, CSV, TSV, and FASTA-compatible records.',
    inputSchema: datasetSelectColumnsInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.selectColumns(datasetSelectColumnsInputSchema.parse(args))
    return textResult(
      `Selected fields for ${result.counts.outputRecords} records; wrote ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_transform', {
    title: 'Transform and Standardize Dataset Fields',
    description: 'Apply only allow-listed structured transformations such as trimming, case and whitespace normalization, scalar conversion, literal replacement, categorical mapping, and defaults. Arbitrary code, SQL, and expressions are not accepted; the source is preserved and the output is reproducible.',
    inputSchema: datasetTransformInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.transform(datasetTransformInputSchema.parse(args))
    return textResult(
      `Applied ${result.operations.length} structured transformations to ${result.counts.outputRecords} records; wrote ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_deduplicate', {
    title: 'Deduplicate Dataset Artifact',
    description: 'Deduplicate records by one or more structured keys, keep the first or last occurrence deterministically, preserve the source, and report removed duplicates.',
    inputSchema: datasetDeduplicateInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.deduplicate(datasetDeduplicateInputSchema.parse(args))
    return textResult(
      `Removed ${result.counts.duplicateRecordsRemoved} duplicate records; wrote ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_id_map', {
    title: 'Map Biomedical Dataset Identifiers',
    description: 'Map identifiers through a workspace mapping artifact using explicit source and target fields. Handles one-to-many mappings with first, all, or explode semantics and persists separate unmatched and ambiguous reports; no arbitrary scripts or implicit fuzzy matching are used.',
    inputSchema: datasetIdMapInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.mapIds(datasetIdMapInputSchema.parse(args))
    return textResult(
      `Mapped ${result.counts.mappedRecords}/${result.counts.inputRecords} records; unmatched=${result.counts.unmatchedRecords}, ambiguous=${result.counts.ambiguousRecords}.`,
      { result }
    )
  }))

  server.registerTool('dataset_join', {
    title: 'Join Dataset Artifacts',
    description: 'Deterministically join two confirmed-plan JSON, JSONL, CSV, or TSV artifacts using explicit key mappings and inner, left, right, or full semantics. Produces a new joined artifact plus separate unmatched-left and unmatched-right artifacts with checksums and provenance.',
    inputSchema: datasetJoinInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.join(datasetJoinInputSchema.parse(args))
    return textResult(
      `Joined ${result.counts.leftRecords} left and ${result.counts.rightRecords} right records into ${result.counts.outputRecords}; unmatched left=${result.counts.unmatchedLeftRecords}, right=${result.counts.unmatchedRightRecords}.`,
      { result }
    )
  }))

  server.registerTool('dataset_validate', {
    title: 'Validate Dataset Artifact',
    description: 'Validate record counts, required fields, types, uniqueness, ranges, allowed values, missingness, and FASTA integrity. A persistent quality report is produced without modifying the source.',
    inputSchema: datasetValidateInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.validate(datasetValidateInputSchema.parse(args))
    return textResult(
      `Dataset validation ${result.validation.valid ? 'passed' : 'failed'} with ${result.validation.errorCount} errors. Report: ${result.artifact.path}.`,
      { result }
    )
  }))

  server.registerTool('dataset_publish', {
    title: 'Publish Prepared Dataset',
    description: 'Publish confirmed-plan artifacts into a non-overwriting workspace release containing copied data, manifest, schema, quality report, checksums, parent provenance, and the preparation plan.',
    inputSchema: datasetPublishInputSchema,
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (args) => runTool(async () => {
    const result = await processing.publish(datasetPublishInputSchema.parse(args))
    return textResult(
      `Published ${result.publication.artifactCount} artifacts to ${result.publication.path}. Manifest: ${result.publication.manifestPath}.`,
      { result }
    )
  }))

  return server
}

export async function startDatasetApiMcpServer(
  service: DatasetApiService = createDatasetApiService(),
  options: { transport?: Transport; processing?: DatasetProcessingService } = {}
): Promise<void> {
  await createDatasetApiMcpServer(service, options.processing).connect(options.transport ?? new StdioServerTransport())
}

export async function runDatasetApiMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(DATASET_API_MCP_FLAG)) return false
  const workspaceRoot = argValue(argv, '--workspace-root')?.trim()
  await startDatasetApiMcpServer(createDatasetApiService({ workspaceRoot }), {
    processing: createDatasetProcessingService({ workspaceRoot })
  })
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
        text: `${errorMessage}\nDo not bypass Dataset tool failures with shell or curl, SQL, or ad hoc scripts; retry through the Dataset MCP tool or report the structured diagnostic.`
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
