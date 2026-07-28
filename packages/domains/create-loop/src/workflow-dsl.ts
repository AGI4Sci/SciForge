import type { WorkflowEnvVarV1, WorkflowV1 } from './contract.js'
import { normalizeWorkflow } from './workflow-settings.js'

const WORKFLOW_DSL_VERSION = 1 as const
const WORKFLOW_DSL_KIND = 'workflow' as const

export type WorkflowDslV1 = {
  dsv: typeof WORKFLOW_DSL_VERSION
  kind: typeof WORKFLOW_DSL_KIND
  app: string
  exportedAt: string
  workflow: WorkflowV1
}

export function exportWorkflowDsl(workflow: WorkflowV1, app: string, exportedAt: string): WorkflowDslV1 {
  return {
    dsv: WORKFLOW_DSL_VERSION,
    kind: WORKFLOW_DSL_KIND,
    app,
    exportedAt,
    workflow: asPortableWorkflow(workflow)
  }
}

export function serializeWorkflowDsl(workflow: WorkflowV1, app: string, exportedAt: string): string {
  return JSON.stringify(exportWorkflowDsl(workflow, app, exportedAt), null, 2)
}

export type WorkflowImportResult =
  | { ok: true; workflow: WorkflowV1 }
  | { ok: false; error: 'invalid-json' | 'unsupported' | 'empty' }

export function parseWorkflowDsl(text: string, now: string): WorkflowImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  const candidate = selectWorkflowPayload(parsed)
  if (!candidate) return { ok: false, error: 'unsupported' }

  const normalized = normalizeWorkflow(candidate, 0, now)
  if (normalized.nodes.length === 0) return { ok: false, error: 'empty' }
  return { ok: true, workflow: asPortableWorkflow(normalized) }
}

function asPortableWorkflow(workflow: WorkflowV1): WorkflowV1 {
  return {
    ...workflow,
    enabled: false,
    callableByAgent: false,
    env: workflow.env.map(withoutSecretValue),
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: []
  }
}

function withoutSecretValue(entry: WorkflowEnvVarV1): WorkflowEnvVarV1 {
  return entry.type === 'secret' ? { ...entry, value: '' } : entry
}

function selectWorkflowPayload(value: unknown): Partial<WorkflowV1> | null {
  const body = asRecord(value)
  if (!body) return null

  if (isWorkflowEnvelope(body)) {
    return body.workflow as Partial<WorkflowV1>
  }
  if (Array.isArray(body.nodes)) {
    return body as Partial<WorkflowV1>
  }
  return null
}

function isWorkflowEnvelope(value: Record<string, unknown>): boolean {
  return value.kind === WORKFLOW_DSL_KIND &&
    value.dsv === WORKFLOW_DSL_VERSION &&
    Boolean(asRecord(value.workflow))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
