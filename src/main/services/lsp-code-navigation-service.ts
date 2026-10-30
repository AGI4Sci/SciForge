import {
  createRuntimeInspectorService,
  type RuntimeInspectorService,
  type RuntimeInspectorServiceOptions
} from '../../../packages/workers/runtime-inspector/src/service'
import type {
  AgentRuntimeCodeNavigationInput,
  AgentRuntimeCodeNavigationOutput,
  AgentRuntimeFailure,
  AgentRuntimeResult
} from '../../shared/agent-runtime-contract'

export type LspCodeNavigationServiceOptions = {
  runtimeInspector?: RuntimeInspectorService
  runtimeInspectorOptions?: RuntimeInspectorServiceOptions
}

const RECOVERABLE_AGENT_CODES = new Set([
  'aborted',
  'file_not_found',
  'invalid_request',
  'language_server_missing',
  'lsp_request_failed',
  'lsp_request_timeout',
  'lsp_session_closed',
  'unsupported_language'
])

export class LspCodeNavigationService {
  private readonly runtimeInspector: RuntimeInspectorService

  constructor(options: LspCodeNavigationServiceOptions = {}) {
    this.runtimeInspector = options.runtimeInspector ?? createRuntimeInspectorService(options.runtimeInspectorOptions)
  }

  async query(input: AgentRuntimeCodeNavigationInput): Promise<AgentRuntimeResult<AgentRuntimeCodeNavigationOutput>> {
    const result = await this.runtimeInspector.lspQuery({
      workspace_root: input.workspaceRoot,
      operation: input.operation,
      ...(input.filePath ? { file_path: input.filePath } : {}),
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.character !== undefined ? { character: input.character } : {}),
      ...(input.query ? { query: input.query } : {}),
      unsaved_buffer_policy: 'reject'
    })

    if (!result.ok) {
      return {
        ok: false,
        failure: agentRuntimeFailure(result.error)
      }
    }

    return {
      ok: true,
      value: {
        operation: result.operation,
        workspaceRoot: result.workspaceRoot,
        ...(result.filePath ? { filePath: result.filePath } : {}),
        result: result.result
      }
    }
  }

  shutdown(): void {
    this.runtimeInspector.shutdown()
  }
}

function agentRuntimeFailure(error: {
  code: string
  reason: string
  retryable: boolean
  suggestion: string
  details?: unknown
}): AgentRuntimeFailure {
  const recoverable = error.retryable || RECOVERABLE_AGENT_CODES.has(error.code)
  return {
    code: error.code,
    message: error.reason,
    recoverable,
    severity: recoverable ? 'warning' : 'error',
    details: {
      suggestion: error.suggestion,
      ...(error.details !== undefined ? { details: error.details } : {})
    }
  }
}
