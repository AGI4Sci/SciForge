import { z } from 'zod'

export const DATASET_API_MCP_FLAG = '--dataset-api-mcp-server'
export const DATASET_API_MCP_SERVER_NAME = 'sciforge-dataset-api'
export const DATASET_API_MCP_SERVER_VERSION = '0.7.0'

export const DATASET_API_TOOL_SIDE_EFFECTS = {
  dataset_api_catalog: 'read',
  dataset_api_register_provider: 'controlled-write',
  dataset_api_list: 'read',
  dataset_api_register: 'controlled-write',
  dataset_api_metadata: 'network-read',
  dataset_api_raw_data: 'network-read-controlled-write',
  dataset_prepare_plan: 'controlled-write',
  dataset_profile: 'controlled-write',
  dataset_filter: 'controlled-write',
  dataset_select_columns: 'controlled-write',
  dataset_transform: 'controlled-write',
  dataset_deduplicate: 'controlled-write',
  dataset_id_map: 'controlled-write',
  dataset_id_map_provider: 'network-read-controlled-write',
  dataset_join: 'controlled-write',
  dataset_structure_profile: 'controlled-write',
  dataset_structure_validate: 'controlled-write',
  dataset_graph_organize: 'controlled-write',
  dataset_validate: 'controlled-write',
  dataset_publish: 'controlled-write'
} as const

export type DatasetApiToolName = keyof typeof DATASET_API_TOOL_SIDE_EFFECTS

const optionalWorkspaceRootSchema = z.string().trim().min(1).max(4096).optional()
const datasetIdSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/)
const headerNameSchema = z.string().trim().min(1).max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
const envVarSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const safeHeadersSchema = z.record(headerNameSchema, z.string().max(4096)).optional()
const endpointSchema = z.string().trim().min(1).max(2048)
const pathValueSchema = z.string().trim().min(1).max(1024)
const queryValueSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(4096), z.number().finite(), z.boolean()])).max(100)
])
const querySchema = z.record(z.string().trim().min(1).max(256), queryValueSchema).optional()
const pathParametersSchema = z.record(
  z.string().trim().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  pathValueSchema
).optional()
const artifactPathSchema = z.string().trim().min(1).max(4096)
const outputFileNameSchema = z.string().trim().min(1).max(255)
const processingMaxBytesSchema = z.number().int().min(1024).max(256 * 1024 * 1024).optional()

export const datasetProcessingFormatSchema = z.enum(['auto', 'json', 'jsonl', 'csv', 'tsv', 'fasta'])
export const datasetConcreteFormatSchema = z.enum(['json', 'jsonl', 'csv', 'tsv', 'fasta'])

const datasetPlanSourceSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(1000),
  metadataRequest: z.record(z.string(), z.unknown()).optional(),
  rawDataRequest: z.record(z.string(), z.unknown()).optional()
}).strict()

const datasetPlanOperationSchema = z.object({
  tool: z.enum([
    'dataset_api_metadata',
    'dataset_api_raw_data',
    'dataset_profile',
    'dataset_filter',
    'dataset_select_columns',
    'dataset_transform',
    'dataset_deduplicate',
    'dataset_id_map',
    'dataset_id_map_provider',
    'dataset_join',
    'dataset_structure_profile',
    'dataset_structure_validate',
    'dataset_graph_organize',
    'dataset_validate',
    'dataset_publish'
  ]),
  description: z.string().trim().min(1).max(1000),
  parameters: z.record(z.string(), z.unknown()).optional()
}).strict()

const datasetPlanOutputSchema = z.object({
  name: outputFileNameSchema,
  format: datasetConcreteFormatSchema,
  description: z.string().trim().min(1).max(1000).optional()
}).strict()

export const datasetPreparePlanInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  draftPlanId: z.string().regex(/^plan-[a-f0-9]{16}$/).optional(),
  objective: z.string().trim().min(1).max(8000).optional(),
  sources: z.array(datasetPlanSourceSchema).max(50).optional(),
  operations: z.array(datasetPlanOperationSchema).min(1).max(100).optional(),
  outputs: z.array(datasetPlanOutputSchema).min(1).max(20).optional(),
  exclusions: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
  confirmationNotes: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
  confirmedByUser: z.boolean()
}).strict().superRefine((input, context) => {
  if (input.draftPlanId) {
    if (!input.confirmedByUser) {
      context.addIssue({ code: 'custom', path: ['confirmedByUser'], message: 'Draft confirmation requires confirmedByUser=true.' })
    }
    for (const field of ['objective', 'sources', 'operations', 'outputs', 'exclusions', 'confirmationNotes'] as const) {
      if (input[field] !== undefined) {
        context.addIssue({ code: 'custom', path: [field], message: `Do not resubmit ${field} when confirming a draft plan.` })
      }
    }
    return
  }
  if (!input.objective) context.addIssue({ code: 'custom', path: ['objective'], message: 'A plan objective is required.' })
  if (!input.operations) context.addIssue({ code: 'custom', path: ['operations'], message: 'At least one plan operation is required.' })
  if (!input.outputs) context.addIssue({ code: 'custom', path: ['outputs'], message: 'At least one plan output is required.' })
})

const datasetInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  inputArtifact: artifactPathSchema,
  format: datasetProcessingFormatSchema.optional(),
  recordPath: z.string().trim().min(1).max(1024).optional(),
  maxBytes: processingMaxBytesSchema
}).strict()

export const datasetProfileInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema.optional(),
  outputFileName: outputFileNameSchema.optional()
}).strict()

export const datasetFilterConditionSchema = z.object({
  field: z.string().trim().min(1).max(512),
  operator: z.enum([
    'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
    'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'
  ]),
  value: z.unknown().optional(),
  caseSensitive: z.boolean().optional()
}).strict()

export const datasetFilterInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema,
  conditions: z.array(datasetFilterConditionSchema).min(1).max(100),
  combine: z.enum(['all', 'any']).optional(),
  outputFileName: outputFileNameSchema
}).strict()

const datasetColumnSelectionSchema = z.object({
  source: z.string().trim().min(1).max(512),
  target: z.string().trim().min(1).max(512).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional()
}).strict()

export const datasetSelectColumnsInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema,
  columns: z.array(datasetColumnSelectionSchema).min(1).max(500),
  outputFormat: datasetConcreteFormatSchema.optional(),
  outputFileName: outputFileNameSchema
}).strict()

const transformFieldSchema = z.string().trim().min(1).max(512)
const transformScalarSchema = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])
const transformOnErrorSchema = z.enum(['fail', 'null', 'keep'])

export const datasetTransformOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('trim'), field: transformFieldSchema, target: transformFieldSchema.optional() }).strict(),
  z.object({ operation: z.literal('lowercase'), field: transformFieldSchema, target: transformFieldSchema.optional() }).strict(),
  z.object({ operation: z.literal('uppercase'), field: transformFieldSchema, target: transformFieldSchema.optional() }).strict(),
  z.object({ operation: z.literal('normalize_whitespace'), field: transformFieldSchema, target: transformFieldSchema.optional() }).strict(),
  z.object({
    operation: z.literal('to_number'),
    field: transformFieldSchema,
    target: transformFieldSchema.optional(),
    onError: transformOnErrorSchema.optional()
  }).strict(),
  z.object({
    operation: z.literal('to_boolean'),
    field: transformFieldSchema,
    target: transformFieldSchema.optional(),
    trueValues: z.array(transformScalarSchema).min(1).max(50).optional(),
    falseValues: z.array(transformScalarSchema).min(1).max(50).optional(),
    onError: transformOnErrorSchema.optional()
  }).strict(),
  z.object({
    operation: z.literal('replace_literal'),
    field: transformFieldSchema,
    target: transformFieldSchema.optional(),
    search: z.string().min(1).max(1024),
    replacement: z.string().max(4096),
    replaceAll: z.boolean().optional()
  }).strict(),
  z.object({
    operation: z.literal('map_values'),
    field: transformFieldSchema,
    target: transformFieldSchema.optional(),
    mappings: z.array(z.object({ from: transformScalarSchema, to: transformScalarSchema }).strict()).min(1).max(1000),
    caseSensitive: z.boolean().optional(),
    onUnmapped: z.enum(['keep', 'null', 'fail']).optional()
  }).strict(),
  z.object({
    operation: z.literal('set_default'),
    field: transformFieldSchema,
    target: transformFieldSchema.optional(),
    value: transformScalarSchema
  }).strict()
])

export const datasetTransformInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema,
  operations: z.array(datasetTransformOperationSchema).min(1).max(500),
  outputFormat: datasetConcreteFormatSchema.optional(),
  outputFileName: outputFileNameSchema
}).strict()

export const datasetDeduplicateInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema,
  keys: z.array(z.string().trim().min(1).max(512)).min(1).max(50),
  keep: z.enum(['first', 'last']).optional(),
  outputFileName: outputFileNameSchema
}).strict()

const datasetJoinFormatSchema = z.enum(['auto', 'json', 'jsonl', 'csv', 'tsv'])
const datasetJoinOutputFormatSchema = z.enum(['json', 'jsonl', 'csv', 'tsv'])

export const datasetIdMapInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema,
  inputArtifact: artifactPathSchema,
  mappingArtifact: artifactPathSchema,
  inputFormat: datasetProcessingFormatSchema.optional(),
  mappingFormat: datasetJoinFormatSchema.optional(),
  inputRecordPath: z.string().trim().min(1).max(1024).optional(),
  mappingRecordPath: z.string().trim().min(1).max(1024).optional(),
  inputField: transformFieldSchema,
  mappingFromField: transformFieldSchema,
  mappingToField: transformFieldSchema,
  outputField: transformFieldSchema,
  cardinality: z.enum(['first', 'all', 'explode']).optional(),
  onUnmapped: z.enum(['keep', 'null', 'drop', 'fail']).optional(),
  caseSensitive: z.boolean().optional(),
  deduplicateTargets: z.boolean().optional(),
  outputFormat: datasetJoinOutputFormatSchema.optional(),
  outputFileName: outputFileNameSchema,
  maxOutputRecords: z.number().int().min(1).max(5_000_000).optional(),
  maxBytes: processingMaxBytesSchema
}).strict()

export const datasetProviderIdMapInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema,
  inputArtifact: artifactPathSchema,
  inputFormat: datasetProcessingFormatSchema.optional(),
  inputRecordPath: z.string().trim().min(1).max(1024).optional(),
  inputField: transformFieldSchema,
  provider: z.literal('uniprot'),
  fromDatabase: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:/-]+$/),
  toDatabase: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:/-]+$/),
  taxId: z.number().int().positive().optional(),
  outputField: transformFieldSchema,
  cardinality: z.enum(['first', 'all', 'explode']).optional(),
  onUnmapped: z.enum(['keep', 'null', 'drop', 'fail']).optional(),
  caseSensitive: z.boolean().optional(),
  deduplicateTargets: z.boolean().optional(),
  outputFormat: datasetJoinOutputFormatSchema.optional(),
  outputFileName: outputFileNameSchema,
  maxIds: z.number().int().min(1).max(100_000).optional(),
  maxOutputRecords: z.number().int().min(1).max(5_000_000).optional(),
  maxBytes: processingMaxBytesSchema,
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  pollIntervalMs: z.number().int().min(100).max(10_000).optional(),
  maxPollAttempts: z.number().int().min(1).max(300).optional(),
  maxRetries: z.number().int().min(0).max(3).optional()
}).strict()

export const datasetJoinInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema,
  leftArtifact: artifactPathSchema,
  rightArtifact: artifactPathSchema,
  leftFormat: datasetJoinFormatSchema.optional(),
  rightFormat: datasetJoinFormatSchema.optional(),
  leftRecordPath: z.string().trim().min(1).max(1024).optional(),
  rightRecordPath: z.string().trim().min(1).max(1024).optional(),
  keys: z.array(z.object({
    left: transformFieldSchema,
    right: transformFieldSchema
  }).strict()).min(1).max(50),
  joinType: z.enum(['inner', 'left', 'right', 'full']).optional(),
  rightPrefix: z.string().trim().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/).optional(),
  outputFormat: datasetJoinOutputFormatSchema.optional(),
  outputFileName: outputFileNameSchema,
  maxOutputRecords: z.number().int().min(1).max(5_000_000).optional(),
  maxBytes: processingMaxBytesSchema
}).strict()

const datasetStructureFormatSchema = z.enum(['auto', 'sdf', 'mmcif'])

export const datasetStructureProfileInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema.optional(),
  inputArtifact: artifactPathSchema,
  format: datasetStructureFormatSchema.optional(),
  outputFileName: outputFileNameSchema.optional(),
  maxBytes: processingMaxBytesSchema
}).strict()

export const datasetStructureValidateInputSchema = datasetStructureProfileInputSchema.extend({
  minRecords: z.number().int().nonnegative().optional(),
  requireCoordinates: z.boolean().optional(),
  failOnInvalid: z.boolean().optional()
}).strict()

export const datasetGraphOrganizeInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema,
  graphType: z.enum(['pathway', 'network']),
  sourceField: transformFieldSchema,
  targetField: transformFieldSchema,
  edgeTypeField: transformFieldSchema.optional(),
  weightField: transformFieldSchema.optional(),
  includeFields: z.array(transformFieldSchema).max(100).optional(),
  directed: z.boolean().optional(),
  deduplicateEdges: z.boolean().optional(),
  onInvalid: z.enum(['drop', 'fail']).optional(),
  outputFileName: outputFileNameSchema,
  maxOutputEdges: z.number().int().min(1).max(5_000_000).optional()
}).strict()

const datasetFieldRuleSchema = z.object({
  field: z.string().trim().min(1).max(512),
  required: z.boolean().optional(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional(),
  unique: z.boolean().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  allowedValues: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(1000).optional()
}).strict()

export const datasetValidateInputSchema = datasetInputSchema.extend({
  planId: datasetIdSchema.optional(),
  rules: z.array(datasetFieldRuleSchema).max(500).default([]),
  minRecords: z.number().int().nonnegative().optional(),
  maxMissingFraction: z.number().min(0).max(1).optional(),
  failOnInvalid: z.boolean().optional(),
  outputFileName: outputFileNameSchema.optional()
}).strict()

export const datasetPublishInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema,
  name: datasetIdSchema,
  artifacts: z.array(artifactPathSchema).min(1).max(100),
  description: z.string().trim().max(4000).optional(),
  outputDirectoryName: datasetIdSchema.optional(),
  requireValidation: z.boolean().optional(),
  allowInvalid: z.boolean().optional()
}).strict()

export const datasetProviderCategorySchema = z.enum([
  'core',
  'drug-and-small-molecule',
  'pathway-and-network',
  'structure-and-single-cell'
])

export const datasetProviderTransportSchema = z.enum([
  'rest',
  'graphql',
  'rest-and-graphql',
  'sdk-object-store'
])

export const EXECUTABLE_DATASET_PROVIDER_IDS = [
  'ncbi-eutils',
  'ensembl',
  'uniprot',
  'ucsc-genome-browser',
  'pubchem-pug-rest',
  'clinicaltrials-gov',
  'kegg',
  'reactome',
  'quickgo',
  'string',
  'alphafold-db'
] as const

export const executableDatasetProviderIdSchema = z.enum(EXECUTABLE_DATASET_PROVIDER_IDS)

export const datasetApiCatalogInputSchema = z.object({
  category: datasetProviderCategorySchema.optional(),
  transport: datasetProviderTransportSchema.optional(),
  query: z.string().trim().min(1).max(160).optional()
}).strict()

export const datasetApiListInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema
}).strict()

export const datasetApiRegisterProviderInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  providerId: executableDatasetProviderIdSchema,
  sourceId: datasetIdSchema.optional(),
  overwrite: z.boolean().optional()
}).strict()

export const datasetApiRegisterInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  id: datasetIdSchema,
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  baseUrl: z.string().trim().url().max(4096),
  metadataEndpoint: endpointSchema,
  rawDataEndpoint: endpointSchema,
  defaultHeaders: safeHeadersSchema,
  auth: z.object({
    type: z.enum(['bearer', 'header', 'query']),
    envVar: envVarSchema,
    headerName: headerNameSchema.optional(),
    queryName: z.string().trim().min(1).max(128).optional(),
    required: z.boolean().optional()
  }).strict().optional(),
  overwrite: z.boolean().optional()
}).strict()

export const datasetApiMetadataInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema.optional(),
  sourceId: datasetIdSchema,
  pathParameters: pathParametersSchema,
  query: querySchema,
  responseMode: z.enum(['auto', 'summary', 'full']).optional(),
  outputFileName: z.string().trim().min(1).max(255).optional(),
  maxBytes: z.number().int().min(1024).max(10 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
  maxRetries: z.number().int().min(0).max(3).optional()
}).strict()

export const datasetApiRawDataInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
  planId: datasetIdSchema.optional(),
  sourceId: datasetIdSchema,
  pathParameters: pathParametersSchema,
  query: querySchema,
  outputFileName: z.string().trim().min(1).max(255).optional(),
  expectedFormat: z.enum(['auto', 'fasta', 'json', 'text', 'binary']).optional(),
  range: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative().optional()
  }).strict().refine((value) => value.end === undefined || value.end >= value.start, {
    message: 'range.end must be greater than or equal to range.start.'
  }).optional(),
  overwrite: z.boolean().optional(),
  maxBytes: z.number().int().min(1024).max(1024 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(100).max(10 * 60_000).optional(),
  maxRetries: z.number().int().min(0).max(3).optional()
}).strict()

export type DatasetApiListInput = z.infer<typeof datasetApiListInputSchema>
export type DatasetApiCatalogInput = z.infer<typeof datasetApiCatalogInputSchema>
export type DatasetApiRegisterProviderInput = z.infer<typeof datasetApiRegisterProviderInputSchema>
export type DatasetApiRegisterInput = z.infer<typeof datasetApiRegisterInputSchema>
export type DatasetApiMetadataInput = z.infer<typeof datasetApiMetadataInputSchema>
export type DatasetApiRawDataInput = z.infer<typeof datasetApiRawDataInputSchema>
export type DatasetProcessingFormat = z.infer<typeof datasetConcreteFormatSchema>
export type DatasetPreparePlanInput = z.infer<typeof datasetPreparePlanInputSchema>
export type DatasetProfileInput = z.infer<typeof datasetProfileInputSchema>
export type DatasetFilterInput = z.infer<typeof datasetFilterInputSchema>
export type DatasetSelectColumnsInput = z.infer<typeof datasetSelectColumnsInputSchema>
export type DatasetTransformInput = z.infer<typeof datasetTransformInputSchema>
export type DatasetDeduplicateInput = z.infer<typeof datasetDeduplicateInputSchema>
export type DatasetIdMapInput = z.infer<typeof datasetIdMapInputSchema>
export type DatasetProviderIdMapInput = z.infer<typeof datasetProviderIdMapInputSchema>
export type DatasetJoinInput = z.infer<typeof datasetJoinInputSchema>
export type DatasetStructureProfileInput = z.infer<typeof datasetStructureProfileInputSchema>
export type DatasetStructureValidateInput = z.infer<typeof datasetStructureValidateInputSchema>
export type DatasetGraphOrganizeInput = z.infer<typeof datasetGraphOrganizeInputSchema>
export type DatasetValidateInput = z.infer<typeof datasetValidateInputSchema>
export type DatasetPublishInput = z.infer<typeof datasetPublishInputSchema>

export type DatasetApiSource = {
  id: string
  name: string
  description?: string
  baseUrl: string
  metadataEndpoint: string
  rawDataEndpoint: string
  defaultHeaders?: Record<string, string>
  auth?: {
    type: 'bearer' | 'header' | 'query'
    envVar: string
    headerName?: string
    queryName?: string
    required?: boolean
  }
  createdAt: string
  updatedAt: string
}

export type DatasetProviderCategory = z.infer<typeof datasetProviderCategorySchema>
export type DatasetProviderTransport = z.infer<typeof datasetProviderTransportSchema>

export type DatasetProvider = {
  id: string
  name: string
  category: DatasetProviderCategory
  transport: DatasetProviderTransport
  auth: 'none' | 'optional-api-key' | 'api-key'
  metadata: string
  rawData: string
  adapter: 'generic-http' | 'provider-specific' | 'sdk-required'
  documentationUrl: string
}
