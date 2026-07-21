export type AgentRuntimeToolDefinition = Readonly<{
  type: 'function'
  name: string
  description: string
  inputSchema: Record<string, unknown>
}>

export type AgentRuntimeToolCallContext = Readonly<{
  requestId: string | number
  runtimeId: string
  threadId?: string
  turnId?: string
  callId?: string
  workspaceId?: string
}>

export type AgentRuntimeToolCall = Readonly<{
  name: string
  arguments?: unknown
  context: AgentRuntimeToolCallContext
}>

export type AgentRuntimeToolResult = Readonly<{
  tool: string
  value: unknown
}>

export type AgentRuntimeToolTurnIdentity = Readonly<{
  runtimeId: string
  threadId: string
  turnId: string
}>

export type AgentRuntimeToolFailureMetadata = Readonly<{
  code: string
  failureClass?: string
  retryable?: boolean
  resourceIdentity?: string
  evidenceDelta?: boolean
  stateChanged?: boolean
}>

export class AgentRuntimeToolError extends Error {
  readonly code: string
  readonly failureClass?: string
  readonly retryable?: boolean
  readonly resourceIdentity?: string
  readonly evidenceDelta?: boolean
  readonly stateChanged?: boolean

  constructor(message: string, metadata: AgentRuntimeToolFailureMetadata) {
    super(message)
    this.name = 'AgentRuntimeToolError'
    this.code = metadata.code
    this.failureClass = metadata.failureClass
    this.retryable = metadata.retryable
    this.resourceIdentity = metadata.resourceIdentity
    this.evidenceDelta = metadata.evidenceDelta
    this.stateChanged = metadata.stateChanged
  }
}

/**
 * Runtime-neutral host tool surface. Runtime adapters only translate this
 * contract to their provider protocol; tool discovery and execution stay here.
 */
export type AgentRuntimeToolSurface = Readonly<{
  tools(): readonly AgentRuntimeToolDefinition[]
  call(
    request: AgentRuntimeToolCall,
    options?: { signal?: AbortSignal }
  ): Promise<AgentRuntimeToolResult>
  abortTurn?(identity: AgentRuntimeToolTurnIdentity, reason?: string): number
}>

export type AgentRuntimeToolSessionContext = Readonly<{
  runtimeId: string
  threadId?: string
  turnId?: string
  workspaceId?: string
  requestId?: string | number
}>
