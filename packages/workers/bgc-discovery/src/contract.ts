import { z } from 'zod'

export const BGC_DISCOVERY_MCP_FLAG = '--bgc-discovery-mcp-server'
export const BGC_DISCOVERY_MCP_SERVER_NAME = 'sciforge-bgc-discovery'
export const BGC_DISCOVERY_MCP_SERVER_VERSION = '0.1.0'

export const BGC_DISCOVERY_TOOL_SIDE_EFFECTS = {
  bgc_status: 'read',
  bgc_plan: 'read',
  bgc_resource_status: 'read',
  bgc_register_resource: 'controlled-write',
  bgc_download_resource: 'controlled-write',
  bgc_run_pipeline: 'controlled-write'
} as const

export type BgcDiscoveryToolName = keyof typeof BGC_DISCOVERY_TOOL_SIDE_EFFECTS

export const optionalPathSchema = z.string().trim().min(1).max(4096).optional()
export const bgcResourceKindSchema = z.enum([
  'antismash',
  'bigscape',
  'mibig_json',
  'pfam_a_hmm',
  'custom'
])

export const bgcStatusInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  antismashBin: optionalPathSchema,
  bigscapeBin: optionalPathSchema,
  mibigPath: optionalPathSchema,
  pfamPath: optionalPathSchema,
  outputDir: optionalPathSchema
}).strict()

export const bgcPlanInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  genomePath: optionalPathSchema,
  antismashOutput: optionalPathSchema,
  mibigPath: optionalPathSchema,
  bigscapePath: optionalPathSchema,
  goal: z.string().trim().max(4000).optional()
}).strict()

export const bgcResourceStatusInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  cacheRoot: optionalPathSchema,
  antismashBin: optionalPathSchema,
  bigscapeBin: optionalPathSchema,
  mibigPath: optionalPathSchema,
  bigscapePath: optionalPathSchema,
  pfamPath: optionalPathSchema
}).strict()

export const bgcRegisterResourceInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  kind: bgcResourceKindSchema,
  path: optionalPathSchema,
  url: z.string().trim().url().max(4096).optional(),
  version: z.string().trim().min(1).max(128).optional(),
  notes: z.string().trim().max(2000).optional()
}).strict().refine((value) => value.path || value.url, {
  message: 'Either path or url is required.'
})

export const bgcDownloadResourceInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  cacheRoot: optionalPathSchema,
  kind: bgcResourceKindSchema.default('custom'),
  url: z.string().trim().url().max(4096).optional(),
  version: z.string().trim().min(1).max(128).optional(),
  targetDir: optionalPathSchema,
  fileName: z.string().trim().min(1).max(256).optional(),
  extract: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  register: z.boolean().optional().default(true),
  notes: z.string().trim().max(2000).optional()
}).strict()

export const bgcRunPipelineInputSchema = z.object({
  workspaceRoot: optionalPathSchema,
  genomePath: optionalPathSchema,
  accession: z.string().trim().min(1).max(256).optional(),
  antismashOutput: optionalPathSchema,
  runAntismash: z.boolean().optional(),
  taxon: z.enum(['fungi', 'bacteria', 'plants', 'auto']).optional(),
  antismashBin: optionalPathSchema,
  mibigPath: optionalPathSchema,
  bigscapePath: optionalPathSchema,
  bigscapeBin: optionalPathSchema,
  outputDir: optionalPathSchema,
  cpus: z.number().int().min(1).max(32).optional(),
  maxRegions: z.number().int().min(1).max(10000).optional()
}).strict()
