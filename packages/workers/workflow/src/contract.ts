import { z } from 'zod'
import type { McpWriteConfirmationRequired } from './write-action.js'

export const WORKFLOW_CALLABLE_RESOURCE_URI = 'workflow://callable'
export const WORKFLOW_RUN_RESOURCE_URI_TEMPLATE = 'workflow://run/{runId}'
export const WORKFLOW_SCHEMA_RESOURCE_URI_TEMPLATE = 'workflow://schema/{workflowId}'

export function workflowRunResourceUri(runId: string): string {
  return `workflow://run/${encodeURIComponent(runId)}`
}

export function workflowSchemaResourceUri(workflowId: string): string {
  return `workflow://schema/${encodeURIComponent(workflowId)}`
}

export type WorkflowSideEffectCategory = 'read-only' | 'write' | 'destructive'

export const WorkflowSideEffectCategorySchema = z.enum(['read-only', 'write', 'destructive'])

export type WorkflowToolName =
  | 'gui_workflow_list'
  | 'gui_workflow_run'
  | 'gui_workflow_status'
  | 'gui_workflow_stop'
  | 'gui_workflow_validate'
  | 'gui_workflow_import'
  | 'gui_workflow_export'

export type WorkflowToolContract = {
  sideEffect: WorkflowSideEffectCategory
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export const WORKFLOW_TOOL_CONTRACTS = {
  gui_workflow_list: {
    sideEffect: 'read-only',
    annotations: {
      title: 'List workflows',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_workflow_run: {
    sideEffect: 'write',
    annotations: {
      title: 'Run workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  gui_workflow_status: {
    sideEffect: 'read-only',
    annotations: {
      title: 'Read workflow status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_workflow_stop: {
    sideEffect: 'destructive',
    annotations: {
      title: 'Stop workflow run',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  gui_workflow_validate: {
    sideEffect: 'read-only',
    annotations: {
      title: 'Validate workflow',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_workflow_import: {
    sideEffect: 'write',
    annotations: {
      title: 'Import workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  gui_workflow_export: {
    sideEffect: 'read-only',
    annotations: {
      title: 'Export workflow',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
} as const satisfies Record<WorkflowToolName, WorkflowToolContract>

export type WorkflowFacadeErrorCode =
  | 'invalid_request'
  | 'confirmation_required'
  | 'runtime_unavailable'
  | 'runtime_http_error'
  | 'runtime_error'
  | 'workflow_not_found'
  | 'run_not_found'
  | 'validation_failed'
  | 'unsupported_operation'
  | 'aborted'
  | 'parse_error'

export type WorkflowFacadeError = {
  code: WorkflowFacadeErrorCode
  reason: string
  retryable: boolean
  suggestion: string
  confirmationRequired?: McpWriteConfirmationRequired
}

export type WorkflowFacadeFailure = {
  ok: false
  error: WorkflowFacadeError
}

export const WorkflowFacadeErrorSchema = z.object({
  code: z.enum([
    'invalid_request',
    'confirmation_required',
    'runtime_unavailable',
    'runtime_http_error',
    'runtime_error',
    'workflow_not_found',
    'run_not_found',
    'validation_failed',
    'unsupported_operation',
    'aborted',
    'parse_error'
  ]),
  reason: z.string().min(1),
  retryable: z.boolean(),
  suggestion: z.string().min(1),
  confirmationRequired: z.unknown().optional()
}).strict()

export const WorkflowFacadeFailureSchema = z.object({
  ok: z.literal(false),
  error: WorkflowFacadeErrorSchema
}).strict()

export const WorkflowInputFieldSchema = z.object({
  key: z.string().trim().min(1).max(128),
  type: z.enum(['text', 'paragraph', 'number', 'boolean', 'select', 'json']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional()
}).strict()

export type WorkflowInputField = z.infer<typeof WorkflowInputFieldSchema>

export const WorkflowCallableSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  callableByAgent: z.boolean().optional(),
  inputs: z.array(WorkflowInputFieldSchema),
  schemaResourceUri: z.string().optional()
}).strict()

export type WorkflowCallableSummary = z.infer<typeof WorkflowCallableSummarySchema>

export const WorkflowListInputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().trim().min(1).max(256).optional()
}).strict()

export const WorkflowRefInputSchema = z.object({
  workflow_id: z.string().trim().min(1).max(256).optional(),
  workflow: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(256).optional()
}).strict().refine(
  (value) => Boolean(value.workflow_id || value.workflow || value.name),
  'Provide workflow_id, workflow, or name.'
)

export const WorkflowRunInputSchema = z.object({
  workflow_id: z.string().trim().min(1).max(256).optional(),
  workflow: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(256).optional(),
  input: z.unknown().optional(),
  workspace_root: z.string().trim().min(1).max(4096).optional(),
  dry_run: z.boolean().optional().describe('Validate inputs and return what would run without invoking the workflow runtime.'),
  preview: z.boolean().optional().describe('Alias for dry_run that returns a non-mutating run preview.'),
  confirmed: z.boolean().optional().describe('Set true only after explicit user confirmation for write/destructive workflow actions.'),
  confirmation_id: z.string().trim().min(1).max(256).optional().describe('Optional confirmation id from a confirmation_required response.')
}).strict().refine(
  (value) => Boolean(value.workflow_id || value.workflow || value.name),
  'Provide workflow_id, workflow, or name.'
)

export const WorkflowStatusInputSchema = z.object({
  run_id: z.string().trim().min(1).max(256).optional(),
  workflow_id: z.string().trim().min(1).max(256).optional()
}).strict()

export const WorkflowStopInputSchema = z.object({
  run_id: z.string().trim().min(1).max(256).optional(),
  workflow_id: z.string().trim().min(1).max(256).optional(),
  confirmation: z.string().trim().min(1).max(256).optional().describe('Required for a live stop request. Omit only with dry_run or preview.'),
  dry_run: z.boolean().optional().describe('Return the stop target without asking the runtime to stop anything.'),
  preview: z.boolean().optional().describe('Alias for dry_run that returns a non-mutating stop preview.'),
  confirmed: z.boolean().optional().describe('Set true only after explicit user confirmation for destructive stop actions.'),
  confirmation_id: z.string().trim().min(1).max(256).optional().describe('Optional confirmation id from a confirmation_required response.')
}).strict().refine(
  (value) => Boolean(value.run_id || value.workflow_id),
  'Provide run_id or workflow_id.'
)

export const WorkflowValidateInputSchema = z.object({
  workflow_id: z.string().trim().min(1).max(256).optional(),
  workflow: z.unknown().optional(),
  input: z.unknown().optional()
}).strict().refine(
  (value) => value.workflow !== undefined || Boolean(value.workflow_id),
  'Provide workflow_id or workflow.'
)

export const WorkflowNodeImportSchema = z.object({
  id: z.string().trim().min(1).max(256),
  type: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256).optional(),
  config: z.record(z.string(), z.unknown()).optional()
}).passthrough()

export const WorkflowConnectionImportSchema = z.object({
  id: z.string().trim().min(1).max(256).optional(),
  source: z.string().trim().min(1).max(256),
  target: z.string().trim().min(1).max(256),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional()
}).passthrough()

export const WorkflowImportDocumentSchema = z.object({
  id: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(256),
  enabled: z.boolean().optional().describe(
    'Round-trip metadata only. Imported workflows are always staged disabled until a user enables them in the SciForge workflow editor.'
  ),
  callableByAgent: z.boolean().optional().describe(
    'Round-trip metadata only. Imported workflows are never agent-callable until a user enables agent access in the SciForge workflow editor.'
  ),
  nodes: z.array(WorkflowNodeImportSchema).min(1),
  connections: z.array(WorkflowConnectionImportSchema).optional(),
  env: z.array(z.record(z.string(), z.unknown())).optional()
}).passthrough()

export const WorkflowImportInputSchema = z.object({
  workflow: WorkflowImportDocumentSchema,
  dry_run: z.boolean().optional().describe('Validate and summarize the workflow import without writing it.'),
  preview: z.boolean().optional().describe('Alias for dry_run that returns a non-mutating import preview.'),
  confirmed: z.boolean().optional().describe('Set true only after explicit user confirmation for workflow import writes.'),
  confirmation_id: z.string().trim().min(1).max(256).optional().describe('Optional confirmation id from a confirmation_required response.')
}).strict()

export const WorkflowExportInputSchema = z.object({
  workflow_id: z.string().trim().min(1).max(256).optional(),
  workflow: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(256).optional(),
  include_runs: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict().refine(
  (value) => Boolean(value.workflow_id || value.workflow || value.name),
  'Provide workflow_id, workflow, or name.'
)

export type WorkflowListInput = z.infer<typeof WorkflowListInputSchema>
export type WorkflowRunInput = z.infer<typeof WorkflowRunInputSchema>
export type WorkflowStatusInput = z.infer<typeof WorkflowStatusInputSchema>
export type WorkflowStopInput = z.infer<typeof WorkflowStopInputSchema>
export type WorkflowValidateInput = z.infer<typeof WorkflowValidateInputSchema>
export type WorkflowImportInput = z.infer<typeof WorkflowImportInputSchema>
export type WorkflowExportInput = z.infer<typeof WorkflowExportInputSchema>

export type WorkflowListResult = WorkflowFacadeFailure | {
  ok: true
  workflows: WorkflowCallableSummary[]
  count: number
  nextCursor?: string
}

export type WorkflowRunResult = WorkflowFacadeFailure | {
  ok: true
  runId: string
  status: string
  message: string
  output?: unknown
  workflow?: WorkflowCallableSummary
  dryRun?: boolean
  preview?: boolean
  wouldRun?: boolean
  validation?: WorkflowValidateResult
}

export type WorkflowStatusResult = WorkflowFacadeFailure | {
  ok: true
  runId?: string
  workflowId?: string
  status?: string
  runtime?: Record<string, unknown>
  run?: Record<string, unknown>
}

export type WorkflowStopResult = WorkflowFacadeFailure | {
  ok: true
  runId?: string
  workflowId?: string
  status?: string
  message: string
  dryRun?: boolean
  preview?: boolean
  wouldStop?: boolean
}

export type WorkflowValidateIssue = {
  code: string
  message: string
  path?: string
}

export type WorkflowValidateResult = WorkflowFacadeFailure | {
  ok: true
  valid: boolean
  workflowId?: string
  issues: WorkflowValidateIssue[]
  inputSchema?: WorkflowInputField[]
}

export type WorkflowImportResult = WorkflowFacadeFailure | {
  ok: true
  workflowId?: string
  workflow?: WorkflowCallableSummary | Record<string, unknown>
  message: string
  dryRun?: boolean
  preview?: boolean
  wouldImport?: boolean
}

export type WorkflowExportResult = WorkflowFacadeFailure | {
  ok: true
  workflowId?: string
  workflow?: Record<string, unknown>
  summary?: WorkflowCallableSummary
  includeRuns: boolean
  preview?: boolean
}

export type WorkflowSchemaResult = WorkflowFacadeFailure | {
  ok: true
  workflowId: string
  workflow: WorkflowCallableSummary
  inputSchema: WorkflowInputField[]
  jsonSchema: Record<string, unknown>
}

export type WorkflowFacadeResult =
  | WorkflowListResult
  | WorkflowRunResult
  | WorkflowStatusResult
  | WorkflowStopResult
  | WorkflowValidateResult
  | WorkflowImportResult
  | WorkflowExportResult
  | WorkflowSchemaResult
