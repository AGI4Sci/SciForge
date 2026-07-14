import {
  WORKFLOW_CALLABLE_RESOURCE_URI,
  WORKFLOW_TOOL_CONTRACTS,
  WorkflowExportInputSchema,
  WorkflowImportInputSchema,
  WorkflowInputFieldSchema,
  WorkflowListInputSchema,
  WorkflowRunInputSchema,
  WorkflowStatusInputSchema,
  WorkflowStopInputSchema,
  WorkflowValidateInputSchema,
  workflowSchemaResourceUri,
  type WorkflowCallableSummary,
  type WorkflowExportInput,
  type WorkflowExportResult,
  type WorkflowFacadeErrorCode,
  type WorkflowFacadeFailure,
  type WorkflowImportInput,
  type WorkflowImportResult,
  type WorkflowInputField,
  type WorkflowListInput,
  type WorkflowListResult,
  type WorkflowRunInput,
  type WorkflowRunResult,
  type WorkflowSchemaResult,
  type WorkflowSideEffectCategory,
  type WorkflowStatusInput,
  type WorkflowStatusResult,
  type WorkflowStopInput,
  type WorkflowStopResult,
  type WorkflowValidateInput,
  type WorkflowValidateIssue,
  type WorkflowValidateResult
} from './contract.js'
import {
  InMemoryWorkflowAuditRecorder,
  type WorkflowAuditAction,
  type WorkflowAuditRecorder,
  type WorkflowAuditRecord,
  type WorkflowAuditTarget
} from './audit.js'
import {
  mcpWriteConfirmationRequired,
  mcpWriteControlFromInput,
  mcpWriteNeedsConfirmation,
  mcpWriteRedactedInput
} from './write-action.js'

export type WorkflowFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type WorkflowInternalHttpRequest = {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  signal?: AbortSignal
}

export interface WorkflowInternalHttpClient {
  request(path: string, request?: WorkflowInternalHttpRequest): Promise<unknown>
}

export type WorkflowInternalHttpClientOptions = {
  baseUrl?: string
  secret?: string
  timeoutMs?: number
  fetch?: WorkflowFetch
}

export type WorkflowServiceOptions = {
  client?: WorkflowInternalHttpClient
  http?: WorkflowInternalHttpClientOptions
  auditRecorder?: WorkflowAuditRecorder
  nowIso?: () => string
  nextId?: (prefix: string) => string
}

export class WorkflowRuntimeHttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'WorkflowRuntimeHttpError'
    this.status = status
    this.body = body
  }
}

export class WorkflowService {
  private readonly client: WorkflowInternalHttpClient
  private readonly audit: WorkflowAuditRecorder

  constructor(options: WorkflowServiceOptions = {}) {
    this.client = options.client ?? createWorkflowInternalHttpClient(options.http)
    this.audit = options.auditRecorder ?? new InMemoryWorkflowAuditRecorder({
      nowIso: options.nowIso,
      nextId: options.nextId
    })
  }

  async list(input: WorkflowListInput = {}, signal?: AbortSignal): Promise<WorkflowListResult> {
    const parsed = WorkflowListInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('list', WORKFLOW_TOOL_CONTRACTS.gui_workflow_list.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Fix the list parameters and retry.'
      ))
    }

    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/list', { method: 'GET', signal })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      const workflows = asArray(record.workflows)
        .map(normalizeCallableWorkflow)
        .filter((workflow): workflow is WorkflowCallableSummary => workflow !== null)
      const offset = parsed.data.cursor ? Number.parseInt(parsed.data.cursor, 10) : 0
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0
      const limit = parsed.data.limit ?? workflows.length
      const page = workflows.slice(start, start + limit)
      const next = start + limit < workflows.length ? String(start + limit) : undefined
      return {
        ok: true,
        workflows: page,
        count: workflows.length,
        ...(next ? { nextCursor: next } : {})
      }
    })
    return this.auditAndReturn('list', WORKFLOW_TOOL_CONTRACTS.gui_workflow_list.sideEffect, result)
  }

  async run(input: WorkflowRunInput, signal?: AbortSignal): Promise<WorkflowRunResult> {
    const parsed = WorkflowRunInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Provide a workflow reference and valid run options.'
      ), auditContextFromUnknown(input))
    }
    const request = parsed.data
    const auditContext = {
      target: auditTargetFromWorkflowRef(request),
      dryRun: request.dry_run === true,
      preview: request.preview === true
    }

    if (request.dry_run || request.preview) {
      const schema = await this.schema({ workflow_id: workflowRef(request) }, signal)
      if (!schema.ok) return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, schema, auditContext)
      const validation = validateInputAgainstFields(schema.inputSchema, request.input, schema.workflowId)
      if (!validation.valid) {
        return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, failure(
          'validation_failed',
          validation.issues.map((issue) => issue.message).join('; '),
          false,
          'Provide the missing or invalid workflow input fields before running.'
        ), auditContext)
      }
      return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, {
        ok: true,
        runId: '',
        status: 'preview',
        message: 'Workflow run preview generated; runtime was not invoked.',
        workflow: schema.workflow,
        dryRun: request.dry_run === true,
        preview: request.preview === true,
        wouldRun: true,
        validation
      }, {
        ...auditContext,
        target: { workflowId: schema.workflowId }
      })
    }

    const runControl = mcpWriteControlFromInput(request)
    if (mcpWriteNeedsConfirmation(runControl)) {
      return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, confirmationRequiredFailure({
        tool: 'gui_workflow_run',
        action: 'run',
        destructive: false,
        confirmationId: runControl.confirmationId ?? `workflow_run:${workflowRef(request) || 'workflow'}`
      }), {
        ...auditContext,
        confirmationRequired: true
      })
    }

    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/run', {
        method: 'POST',
        body: runtimeRefBody(request, {
          input: request.input,
          workspaceRoot: request.workspace_root
        }),
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      return {
        ok: true,
        runId: stringValue(record.runId),
        status: stringValue(record.status, 'unknown'),
        message: stringValue(record.message, 'Workflow run completed.'),
        ...(record.output !== undefined ? { output: record.output } : {})
      }
    })
    return this.auditAndReturn('run', WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, result, {
      ...auditContext,
      target: result.ok
        ? { ...auditContext.target, runId: safeAuditId(result.runId) }
        : auditContext.target
    })
  }

  async status(input: WorkflowStatusInput = {}, signal?: AbortSignal): Promise<WorkflowStatusResult> {
    const parsed = WorkflowStatusInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('status', WORKFLOW_TOOL_CONTRACTS.gui_workflow_status.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Fix the status parameters and retry.'
      ), auditContextFromUnknown(input))
    }
    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/status', {
        method: 'POST',
        body: compact({
          runId: parsed.data.run_id,
          workflowId: parsed.data.workflow_id
        }),
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      return {
        ok: true,
        runId: stringValue(record.runId) || parsed.data.run_id,
        workflowId: stringValue(record.workflowId) || parsed.data.workflow_id,
        status: stringValue(record.status),
        runtime: asRecord(record.runtime),
        run: asRecord(record.run)
      }
    })
    return this.auditAndReturn('status', WORKFLOW_TOOL_CONTRACTS.gui_workflow_status.sideEffect, result, {
      target: auditTargetFromRunOrWorkflow(parsed.data.run_id, parsed.data.workflow_id)
    })
  }

  async stop(input: WorkflowStopInput, signal?: AbortSignal): Promise<WorkflowStopResult> {
    const parsed = WorkflowStopInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('stop', WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Provide run_id or workflow_id.'
      ), auditContextFromUnknown(input))
    }
    const request = parsed.data
    const auditContext = {
      target: auditTargetFromRunOrWorkflow(request.run_id, request.workflow_id),
      dryRun: request.dry_run === true,
      preview: request.preview === true
    }
    if (request.dry_run || request.preview) {
      return this.auditAndReturn('stop', WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.sideEffect, {
        ok: true,
        runId: request.run_id,
        workflowId: request.workflow_id,
        status: 'preview',
        message: 'Workflow stop preview generated; runtime was not invoked.',
        dryRun: request.dry_run === true,
        preview: request.preview === true,
        wouldStop: true
      }, auditContext)
    }
    const stopControl = mcpWriteControlFromInput(request)
    if (mcpWriteNeedsConfirmation(stopControl)) {
      return this.auditAndReturn('stop', WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.sideEffect, confirmationRequiredFailure({
        tool: 'gui_workflow_stop',
        action: 'stop',
        destructive: true,
        confirmationId: stopControl.confirmationId ?? `workflow_stop:${request.run_id ?? request.workflow_id ?? 'target'}`
      }), {
        ...auditContext,
        confirmationRequired: true
      })
    }
    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/stop', {
        method: 'POST',
        body: compact({ runId: request.run_id, workflowId: request.workflow_id }),
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      return {
        ok: true,
        runId: stringValue(record.runId) || request.run_id,
        workflowId: stringValue(record.workflowId) || request.workflow_id,
        status: stringValue(record.status, 'stopping'),
        message: stringValue(record.message, 'Workflow stop requested.')
      }
    })
    return this.auditAndReturn('stop', WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.sideEffect, result, auditContext)
  }

  async validate(input: WorkflowValidateInput, signal?: AbortSignal): Promise<WorkflowValidateResult> {
    const parsed = WorkflowValidateInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('validate', WORKFLOW_TOOL_CONTRACTS.gui_workflow_validate.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Provide a workflow document or workflow_id.'
      ), auditContextFromUnknown(input))
    }
    const request = parsed.data
    const auditContext = {
      target: request.workflow_id
        ? auditTargetFromRunOrWorkflow(undefined, request.workflow_id)
        : request.workflow !== undefined
          ? auditTargetFromWorkflowRef({ workflow: stringValue(request.workflow) })
          : undefined
    }

    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/validate', {
        method: 'POST',
        body: compact({
          workflowId: request.workflow_id,
          workflow: request.workflow,
          input: request.input
        }),
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      const issues = asArray(record.issues)
        .map(normalizeValidateIssue)
        .filter((issue): issue is WorkflowValidateIssue => issue !== null)
      const inputSchema = asArray(record.inputSchema)
        .map(normalizeInputField)
        .filter((field): field is WorkflowInputField => field !== null)
      return {
        ok: true,
        valid: record.valid === false ? false : issues.length === 0,
        workflowId: stringValue(record.workflowId) || request.workflow_id,
        issues,
        ...(inputSchema.length > 0 ? { inputSchema } : {})
      }
    })
    return this.auditAndReturn('validate', WORKFLOW_TOOL_CONTRACTS.gui_workflow_validate.sideEffect, result, auditContext)
  }

  async importWorkflow(input: WorkflowImportInput, signal?: AbortSignal): Promise<WorkflowImportResult> {
    const parsed = WorkflowImportInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('import', WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Provide a valid workflow import document.'
      ), auditContextFromUnknown(input))
    }
    const request = parsed.data
    const auditContext = {
      target: auditTargetFromRunOrWorkflow(undefined, request.workflow.id),
      dryRun: request.dry_run === true,
      preview: request.preview === true
    }
    if (request.dry_run || request.preview) {
      return this.auditAndReturn('import', WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.sideEffect, {
        ok: true,
        workflowId: request.workflow.id,
        workflow: {
          id: request.workflow.id ?? '',
          name: request.workflow.name,
          inputs: [],
          schemaResourceUri: request.workflow.id ? workflowSchemaResourceUri(request.workflow.id) : undefined
        },
        message: 'Workflow import preview generated; runtime was not invoked.',
        dryRun: request.dry_run === true,
        preview: request.preview === true,
        wouldImport: true
      }, auditContext)
    }
    const importControl = mcpWriteControlFromInput(request)
    if (mcpWriteNeedsConfirmation(importControl)) {
      return this.auditAndReturn('import', WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.sideEffect, confirmationRequiredFailure({
        tool: 'gui_workflow_import',
        action: 'import',
        destructive: false,
        confirmationId: importControl.confirmationId ?? `workflow_import:${request.workflow.id ?? request.workflow.name}`
      }), {
        ...auditContext,
        confirmationRequired: true
      })
    }
    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/import', {
        method: 'POST',
        body: { workflow: request.workflow },
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      const workflow = normalizeCallableWorkflow(record.workflow) ?? asRecord(record.workflow)
      return {
        ok: true,
        workflowId: stringValue(record.workflowId) || (workflow && 'id' in workflow ? stringValue(workflow.id) : undefined),
        workflow,
        message: stringValue(record.message, 'Workflow imported.')
      }
    })
    return this.auditAndReturn('import', WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.sideEffect, result, {
      ...auditContext,
      target: result.ok
        ? auditTargetFromRunOrWorkflow(undefined, result.workflowId)
        : auditContext.target
    })
  }

  async exportWorkflow(input: WorkflowExportInput, signal?: AbortSignal): Promise<WorkflowExportResult> {
    const parsed = WorkflowExportInputSchema.safeParse(input)
    if (!parsed.success) {
      return this.auditAndReturn('export', WORKFLOW_TOOL_CONTRACTS.gui_workflow_export.sideEffect, failure(
        'invalid_request',
        parsed.error.message,
        false,
        'Provide a workflow reference for export.'
      ), auditContextFromUnknown(input))
    }
    const request = parsed.data
    const auditContext = {
      target: auditTargetFromWorkflowRef(request),
      preview: request.preview === true
    }
    if (request.preview) {
      const schema = await this.schema({ workflow_id: workflowRef(request) }, signal)
      if (!schema.ok) return this.auditAndReturn('export', WORKFLOW_TOOL_CONTRACTS.gui_workflow_export.sideEffect, schema, auditContext)
      return this.auditAndReturn('export', WORKFLOW_TOOL_CONTRACTS.gui_workflow_export.sideEffect, {
        ok: true,
        workflowId: schema.workflowId,
        summary: schema.workflow,
        includeRuns: request.include_runs === true,
        preview: true
      }, {
        ...auditContext,
        target: { workflowId: schema.workflowId }
      })
    }
    const result = await this.capture(async () => {
      const raw = await this.client.request('/workflow/internal/export', {
        method: 'POST',
        body: runtimeRefBody(request, { includeRuns: request.include_runs === true }),
        signal
      })
      const runtimeFailure = failureFromRuntime(raw)
      if (runtimeFailure) return runtimeFailure
      const record = asRecord(raw)
      return {
        ok: true,
        workflowId: stringValue(record.workflowId) || workflowRef(request),
        workflow: asRecord(record.workflow),
        includeRuns: request.include_runs === true
      }
    })
    return this.auditAndReturn('export', WORKFLOW_TOOL_CONTRACTS.gui_workflow_export.sideEffect, result, auditContext)
  }

  async schema(input: { workflow_id?: string; workflow?: string; name?: string }, signal?: AbortSignal): Promise<WorkflowSchemaResult> {
    const ref = workflowRef(input)
    const auditContext = { target: auditTargetFromWorkflowRef(input) }
    if (!ref) {
      return this.auditAndReturn('schema', 'read-only', failure(
        'invalid_request',
        'Provide workflow_id, workflow, or name.',
        false,
        'Choose a workflow from gui_workflow_list.'
      ), auditContext)
    }
    const listed = await this.list({}, signal)
    if (!listed.ok) return this.auditAndReturn('schema', 'read-only', listed, auditContext)
    const lower = ref.toLowerCase()
    const workflow = listed.workflows.find((item) => item.id === ref || item.name.toLowerCase() === lower)
    if (!workflow) {
      return this.auditAndReturn('schema', 'read-only', failure(
        'workflow_not_found',
        `No agent-callable workflow matches "${ref}".`,
        false,
        'Use gui_workflow_list to choose an enabled callable workflow.'
      ), auditContext)
    }
    return this.auditAndReturn('schema', 'read-only', {
      ok: true,
      workflowId: workflow.id,
      workflow,
      inputSchema: workflow.inputs,
      jsonSchema: jsonSchemaForInputs(workflow.inputs)
    }, {
      target: { workflowId: workflow.id }
    })
  }

  auditRecords(): WorkflowAuditRecord[] {
    return this.audit.records()
  }

  private async capture<T>(operation: () => Promise<T | WorkflowFacadeFailure>): Promise<T | WorkflowFacadeFailure> {
    try {
      return await operation()
    } catch (error) {
      return failureFromThrown(error)
    }
  }

  private auditAndReturn<T extends WorkflowFacadeFailure | { ok: true }>(
    action: WorkflowAuditAction,
    sideEffect: WorkflowSideEffectCategory,
    result: T,
    context: {
      target?: WorkflowAuditTarget
      dryRun?: boolean
      preview?: boolean
      confirmationRequired?: boolean
    } = {}
  ): T {
    if (sideEffect === 'read-only') return result
    this.audit.record(compact({
      event: 'workflow_operation',
      action,
      sideEffect,
      outcome: result.ok ? 'success' : result.error.code === 'confirmation_required' ? 'rejected' : 'failed',
      ok: result.ok,
      dryRun: context.dryRun === true ? true : undefined,
      preview: context.preview === true ? true : undefined,
      confirmationRequired: context.confirmationRequired === true || (!result.ok && result.error.code === 'confirmation_required') ? true : undefined,
      errorCode: result.ok ? undefined : result.error.code,
      target: context.target && Object.keys(context.target).length > 0 ? context.target : undefined
    }))
    return result
  }
}

export function createWorkflowService(options: WorkflowServiceOptions = {}): WorkflowService {
  return new WorkflowService(options)
}

export function createWorkflowInternalHttpClient(options: WorkflowInternalHttpClientOptions = {}): WorkflowInternalHttpClient {
  const baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.GUI_WORKFLOW_INTERNAL_BASE_URL ?? 'http://127.0.0.1:8787')
  const secret = (options.secret ?? process.env.GUI_WORKFLOW_INTERNAL_SECRET ?? '').trim()
  const timeoutMs = options.timeoutMs ?? numberFromEnv(process.env.GUI_WORKFLOW_INTERNAL_TIMEOUT_MS, 15_000)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available for the workflow internal HTTP client.')
  }

  return {
    async request(path, request = {}) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const onAbort = (): void => controller.abort()
      request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const headers: Record<string, string> = {
          Accept: 'application/json'
        }
        const init: RequestInit = {
          method: request.method ?? (request.body ? 'POST' : 'GET'),
          headers,
          signal: controller.signal
        }
        if (request.body) {
          headers['Content-Type'] = 'application/json'
          init.body = JSON.stringify(request.body)
        }
        if (!secret) {
          throw new WorkflowRuntimeHttpError(401, {
            ok: false,
            code: 'runtime_http_error',
            message: 'Workflow internal secret is not configured.'
          }, 'Workflow internal secret is not configured.')
        }
        headers.Authorization = `Bearer ${secret}`
        const response = await fetchImpl(`${baseUrl}${path}`, init)
        const body = await parseResponseBody(response)
        if (!response.ok) {
          throw new WorkflowRuntimeHttpError(response.status, body, messageFromRuntimeBody(body) || `HTTP ${response.status}`)
        }
        return body
      } finally {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}

export function validateInputAgainstFields(
  fields: WorkflowInputField[],
  input: unknown,
  workflowId?: string
): Extract<WorkflowValidateResult, { ok: true }> {
  const source = asRecord(input)
  const issues: WorkflowValidateIssue[] = []
  for (const field of fields) {
    const value = source[field.key]
    if (field.required && (value === undefined || value === null || value === '')) {
      issues.push({
        code: 'missing_required_input',
        message: `Missing required input: ${field.key}`,
        path: field.key
      })
      continue
    }
    if (value !== undefined && value !== null) {
      const typeIssue = validateFieldType(field, value)
      if (typeIssue) issues.push(typeIssue)
    }
  }
  return {
    ok: true,
    valid: issues.length === 0,
    workflowId,
    issues,
    inputSchema: fields
  }
}

export function failure(
  code: WorkflowFacadeErrorCode,
  reason: string,
  retryable: boolean,
  suggestion: string,
  details: Partial<Pick<WorkflowFacadeFailure['error'], 'confirmationRequired'>> = {}
): WorkflowFacadeFailure {
  return {
    ok: false,
    error: { code, reason, retryable, suggestion, ...details }
  }
}

function confirmationRequiredFailure(options: {
  tool: string
  action: string
  destructive: boolean
  confirmationId?: string
}): WorkflowFacadeFailure {
  const confirmationRequired = mcpWriteConfirmationRequired({
    worker: 'workflow',
    tool: options.tool,
    action: options.action,
    destructive: options.destructive,
    confirmationId: options.confirmationId
  })
  return failure(
    'confirmation_required',
    confirmationRequired.message,
    false,
    'Ask the user to confirm, then call again with confirmed: true, or use dry_run/preview.',
    { confirmationRequired }
  )
}

function failureFromThrown(error: unknown): WorkflowFacadeFailure {
  if (error instanceof WorkflowRuntimeHttpError) {
    const runtime = failureFromRuntime(error.body)
    if (runtime) {
      const retryable = error.status >= 500 || error.status === 408 || error.status === 429
      return {
        ok: false,
        error: {
          ...runtime.error,
          code: error.status === 404 ? 'unsupported_operation' : retryable ? 'runtime_unavailable' : runtime.error.code,
          retryable
        }
      }
    }
    const retryable = error.status >= 500 || error.status === 408 || error.status === 429
    return failure(
      error.status === 404 ? 'unsupported_operation' : retryable ? 'runtime_unavailable' : 'runtime_http_error',
      error.message,
      retryable,
      error.status === 404
        ? 'The running SciForge app does not expose this workflow internal endpoint yet.'
        : 'Check that the SciForge app is running and that the workflow runtime is enabled.'
    )
  }
  if (isAbortError(error)) {
    return failure('aborted', 'The workflow facade request was aborted.', true, 'Retry the request if it is still needed.')
  }
  return failure(
    'runtime_error',
    error instanceof Error ? error.message : String(error),
    true,
    'Check the workflow runtime logs, then retry.'
  )
}

function failureFromRuntime(raw: unknown): WorkflowFacadeFailure | null {
  const record = asRecord(raw)
  if (record.ok !== false) return null
  const reason = messageFromRuntimeBody(record) || 'Workflow runtime rejected the request.'
  const code = codeFromRuntime(reason, record)
  return failure(code, reason, code === 'runtime_unavailable', suggestionForCode(code))
}

function normalizeCallableWorkflow(value: unknown): WorkflowCallableSummary | null {
  const record = asRecord(value)
  const id = stringValue(record.id)
  const name = stringValue(record.name)
  if (!id || !name) return null
  const inputs = asArray(record.inputs)
    .map(normalizeInputField)
    .filter((input): input is WorkflowInputField => input !== null)
  return {
    id,
    name,
    description: stringValue(record.description),
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(typeof record.callableByAgent === 'boolean' ? { callableByAgent: record.callableByAgent } : {}),
    inputs,
    schemaResourceUri: workflowSchemaResourceUri(id)
  }
}

function normalizeInputField(value: unknown): WorkflowInputField | null {
  const parsed = WorkflowInputFieldSchema.safeParse(value)
  if (parsed.success) return parsed.data
  const record = asRecord(value)
  const key = stringValue(record.key)
  if (!key) return null
  const rawType = stringValue(record.type)
  const type = isWorkflowInputFieldType(rawType) ? rawType : 'text'
  return {
    key,
    type,
    required: Boolean(record.required),
    description: stringValue(record.description),
    label: stringValue(record.label),
    options: asArray(record.options).map((option) => String(option)),
    defaultValue: record.defaultValue
  }
}

function isWorkflowInputFieldType(value: string): value is WorkflowInputField['type'] {
  return ['text', 'paragraph', 'number', 'boolean', 'select', 'json'].includes(value)
}

function normalizeValidateIssue(value: unknown): WorkflowValidateIssue | null {
  const record = asRecord(value)
  const message = stringValue(record.message)
  if (!message) return null
  const path = stringValue(record.path)
  return {
    code: stringValue(record.code, 'validation_issue'),
    message,
    ...(path ? { path } : {})
  }
}

function jsonSchemaForInputs(fields: WorkflowInputField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const field of fields) {
    properties[field.key] = compact({
      type: jsonSchemaTypeForField(field.type),
      description: field.description,
      enum: field.options && field.options.length > 0 ? field.options : undefined
    })
    if (field.required) required.push(field.key)
  }
  return compact({
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: true,
    resourceUri: WORKFLOW_CALLABLE_RESOURCE_URI
  })
}

function jsonSchemaTypeForField(type: WorkflowInputField['type']): string | string[] {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return ['object', 'array', 'string', 'number', 'boolean', 'null']
    case 'text':
    case 'paragraph':
    case 'select':
      return 'string'
  }
}

function validateFieldType(field: WorkflowInputField, value: unknown): WorkflowValidateIssue | null {
  switch (field.type) {
    case 'number':
      return typeof value === 'number'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a number.`, path: field.key }
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a boolean.`, path: field.key }
    case 'select':
      return field.options && field.options.length > 0 && !field.options.includes(String(value))
        ? { code: 'invalid_input_option', message: `Input ${field.key} must be one of: ${field.options.join(', ')}.`, path: field.key }
        : null
    case 'json':
      return null
    case 'text':
    case 'paragraph':
      return typeof value === 'string'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a string.`, path: field.key }
  }
}

function runtimeRefBody(
  input: { workflow_id?: string; workflow?: string; name?: string },
  extra: Record<string, unknown>
): Record<string, unknown> {
  return compact({
    workflowId: input.workflow_id,
    workflow: input.workflow,
    name: input.name,
    ...extra
  })
}

function auditContextFromUnknown(value: unknown): { target?: WorkflowAuditTarget; dryRun?: boolean; preview?: boolean } {
  const record = asRecord(value)
  return {
    target: {
      ...auditTargetFromWorkflowRef({
        workflow_id: stringValue(record.workflow_id),
        workflow: stringValue(record.workflow),
        name: stringValue(record.name)
      }),
      ...auditTargetFromRunOrWorkflow(stringValue(record.run_id), stringValue(record.workflow_id))
    },
    dryRun: record.dry_run === true,
    preview: record.preview === true
  }
}

function auditTargetFromWorkflowRef(input: { workflow_id?: string; workflow?: string; name?: string }): WorkflowAuditTarget | undefined {
  const workflowId = safeAuditId(input.workflow_id)
  if (workflowId) return { workflowId, refKind: 'workflow_id' }
  if (input.workflow) return { refKind: 'workflow' }
  if (input.name) return { refKind: 'name' }
  return undefined
}

function auditTargetFromRunOrWorkflow(runId?: string, workflowId?: string): WorkflowAuditTarget | undefined {
  const target: WorkflowAuditTarget = compact({
    runId: safeAuditId(runId),
    workflowId: safeAuditId(workflowId),
    refKind: workflowId ? 'workflow_id' as const : undefined
  })
  return Object.keys(target).length > 0 ? target : undefined
}

function safeAuditId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const redacted = mcpWriteRedactedInput(trimmed)
  if (typeof redacted === 'string' && redacted !== trimmed) return '[REDACTED]'
  const normalized = stripControlCharacters(trimmed)
  return normalized.length > 128 ? `${normalized.slice(0, 128)}...` : normalized
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
}

function workflowRef(input: { workflow_id?: string; workflow?: string; name?: string }): string {
  return input.workflow_id ?? input.workflow ?? input.name ?? ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function compact<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

function messageFromRuntimeBody(body: unknown): string {
  const record = asRecord(body)
  return stringValue(record.reason) || stringValue(record.message) || stringValue(record.error)
}

function codeFromRuntime(reason: string, body: Record<string, unknown>): WorkflowFacadeErrorCode {
  const code = stringValue(asRecord(body.error).code) || stringValue(body.code)
  if (isWorkflowFacadeCode(code)) return code
  const lower = reason.toLowerCase()
  if (lower.includes('not found') || lower.includes('no agent-callable workflow')) return 'workflow_not_found'
  if (lower.includes('missing required') || lower.includes('invalid')) return 'validation_failed'
  if (lower.includes('run') && lower.includes('not found')) return 'run_not_found'
  return 'runtime_error'
}

function isWorkflowFacadeCode(value: string): value is WorkflowFacadeErrorCode {
  return [
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
  ].includes(value)
}

function suggestionForCode(code: WorkflowFacadeErrorCode): string {
  switch (code) {
    case 'confirmation_required':
      return 'Retry with the required confirmation field, or call with dry_run/preview to inspect the target first.'
    case 'workflow_not_found':
      return 'Use gui_workflow_list to pick an enabled workflow marked callable by agent.'
    case 'run_not_found':
      return 'Check the run id from gui_workflow_run or read workflow://callable for available workflows.'
    case 'validation_failed':
      return 'Read workflow://schema/{workflowId}, then provide all required inputs with the expected types.'
    case 'unsupported_operation':
      return 'Update the running SciForge app to a runtime that exposes this workflow internal endpoint.'
    case 'runtime_unavailable':
      return 'Start SciForge, enable workflows, and verify the internal base URL and secret.'
    case 'invalid_request':
      return 'Fix the MCP tool arguments and retry.'
    case 'aborted':
      return 'Retry the request if it is still needed.'
    case 'parse_error':
      return 'Check the runtime response format and retry.'
    case 'runtime_http_error':
    case 'runtime_error':
      return 'Check the workflow runtime logs, then retry.'
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.trim() || `HTTP ${response.status}` }
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}
