import {
  agentVisualCaptureOutputSchema,
  agentVisualLookOutputSchema
} from '../../../shared/agent-visual'
import type {
  AgentRuntimeCompletionReceipt,
  AgentRuntimeExecutionEffectClass
} from '../../../shared/agent-runtime-contract'

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

export type NativeAgentToolExecutionMetadata = Readonly<{
  effects: AgentRuntimeExecutionEffectClass[]
  completionReceipts: AgentRuntimeCompletionReceipt[]
}>

/**
 * Converts only validated results from the two reserved native visual tools
 * into semantic completion receipts. Broker outputs, model text, shell stdout,
 * and arbitrary structuredContent never pass through this function.
 */
export function nativeAgentToolExecutionMetadata(
  result: Pick<AgentRuntimeToolResult, 'tool' | 'value'>,
  callId: string
): NativeAgentToolExecutionMetadata {
  const normalizedCallId = callId.trim()
  if (!normalizedCallId) return { effects: [], completionReceipts: [] }
  if (result.tool === 'sciforge_look') {
    const parsed = agentVisualLookOutputSchema.safeParse(result.value)
    if (!parsed.success) return { effects: [], completionReceipts: [] }
    const output = parsed.data
    if (!output.evidence.claims.length) return { effects: [], completionReceipts: [] }
    return {
      effects: ['read'],
      completionReceipts: [{
        contractVersion: 'completion-receipt.v1',
        receiptId: output.proof.proofRef,
        kind: 'visual.look',
        status: 'satisfied',
        issuer: 'sciforge.agent-visual',
        callId: normalizedCallId,
        subjectRef: output.proof.sourceRef ?? output.snapshotRef,
        relatedRefs: [
          output.snapshotRef,
          ...output.regions.map((region) => region.regionRef)
        ],
        ...('parentProofRef' in output.proof && typeof output.proof.parentProofRef === 'string'
          ? { parentReceiptIds: [output.proof.parentProofRef] }
          : {}),
        attestation: output.proof.attestation,
        createdAt: output.proof.createdAt
      }]
    }
  }
  if (result.tool === 'sciforge_capture') {
    const parsed = agentVisualCaptureOutputSchema.safeParse(result.value)
    if (!parsed.success) return { effects: [], completionReceipts: [] }
    const output = parsed.data
    return {
      effects: ['local_write'],
      completionReceipts: [{
        contractVersion: 'completion-receipt.v1',
        receiptId: output.proof.proofRef,
        kind: 'visual.capture',
        status: 'satisfied',
        issuer: 'sciforge.agent-visual',
        callId: normalizedCallId,
        subjectRef: output.artifactRef,
        relatedRefs: [
          output.artifactRef,
          ...(output.proof.cropped && output.proof.regionRef ? [output.proof.regionRef] : [])
        ],
        parentReceiptIds: [output.proof.inspectionProofRef],
        sha256: output.sha256,
        createdAt: output.proof.createdAt
      }]
    }
  }
  return { effects: [], completionReceipts: [] }
}

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
