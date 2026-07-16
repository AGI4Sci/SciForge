import { z } from 'zod'

export const DATASET_API_MCP_FLAG = '--dataset-api-mcp-server'
export const DATASET_API_MCP_SERVER_NAME = 'sciforge-dataset-api'
export const DATASET_API_MCP_SERVER_VERSION = '0.1.0'

export const DATASET_API_TOOL_SIDE_EFFECTS = {
  dataset_api_catalog: 'read',
  dataset_api_register_provider: 'controlled-write',
  dataset_api_list: 'read',
  dataset_api_register: 'controlled-write',
  dataset_api_metadata: 'network-read',
  dataset_api_raw_data: 'network-read-controlled-write'
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
  sourceId: datasetIdSchema,
  pathParameters: pathParametersSchema,
  query: querySchema,
  responseMode: z.enum(['auto', 'summary', 'full']).optional(),
  maxBytes: z.number().int().min(1024).max(10 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
  maxRetries: z.number().int().min(0).max(3).optional()
}).strict()

export const datasetApiRawDataInputSchema = z.object({
  workspaceRoot: optionalWorkspaceRootSchema,
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
