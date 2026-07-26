import type {
  AgentRuntimeCompletionReceipt,
  AgentRuntimeExecutionEffectClass
} from '../../../shared/agent-runtime-contract'

export type RuntimeToolFunctionDefinition = {
  type: 'function'
  /** Stable internal provider namespace. Never exposed as a model tool name. */
  namespace?: string
  /** Stable internal provider identity. */
  providerId?: string
  /** Original provider tool name. */
  providerToolName?: string
  name: string
  description: string
  inputSchema: unknown
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export type RuntimeToolDefinition = RuntimeToolFunctionDefinition

export type RuntimeToolCallRequest = {
  requestId: string | number
  runtimeId?: string
  threadId?: string
  turnId?: string
  callId?: string
  namespace?: string
  tool: string
  arguments: unknown
}

export type RuntimeToolOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

export type RuntimeToolCallResponse = {
  contentItems: RuntimeToolOutputContentItem[]
  success: boolean
  structuredContent?: unknown
  effects?: AgentRuntimeExecutionEffectClass[]
  completionReceipts?: AgentRuntimeCompletionReceipt[]
  errorCode?: string
  failureClass?: string
  retryable?: boolean
  resourceIdentity?: string
  evidenceDelta?: boolean
  stateChanged?: boolean
}

export type RuntimeToolReleaseReason =
  | 'user_stop'
  | 'service_shutdown'
  | 'runtime_disconnected'
  | 'settings_changed'
  | 'unknown'
  | (string & {})
