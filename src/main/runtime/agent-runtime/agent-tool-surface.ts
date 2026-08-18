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
  /** Host-private delivery classification; runtime adapters must not expose it to the model. */
  deliveryEffect?: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
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
  recovery?: AgentRuntimeToolRecovery
  providerStage?: string
}>

export type AgentRuntimeToolRecovery = Readonly<{
  action: string
  instruction: string
}>

/**
 * Produces the canonical model-visible failure payload for every in-process
 * runtime tool transport. Keep this deliberately limited to the stable error
 * contract: provider response bodies and other untrusted diagnostics must not
 * be reflected back into the model context.
 */
export function modelVisibleAgentRuntimeToolFailure(
  toolName: string,
  error: unknown
): string {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {}
  const recoveryRecord = record.recovery && typeof record.recovery === 'object'
    ? record.recovery as Record<string, unknown>
    : {}
  const message = error instanceof Error ? error.message : String(error)
  const code = optionalString(record.code) ?? 'runtime_tool_error'
  const failureClass = optionalString(record.failureClass)
  const providerStage = optionalString(record.providerStage)
  const resourceIdentity = optionalString(record.resourceIdentity)
  const recoveryAction = optionalString(recoveryRecord.action)
  const recoveryInstruction = optionalString(recoveryRecord.instruction)
    ?? optionalString(record.recoveryGuidance)

  return JSON.stringify({
    tool: toolName,
    status: 'failed',
    error: {
      code,
      message,
      ...(failureClass ? { failureClass } : {}),
      ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
      ...(providerStage ? { providerStage } : {}),
      ...(resourceIdentity ? { resourceIdentity } : {}),
      ...(recoveryAction || recoveryInstruction
        ? {
            recovery: {
              ...(recoveryAction ? { action: recoveryAction } : {}),
              ...(recoveryInstruction ? { instruction: recoveryInstruction } : {})
            }
          }
        : {})
    }
  }, null, 2)
}

export type NativeVisualToolErrorCode =
  | 'visual_invalid_arguments'
  | 'visual_invalid_result'
  | 'visual_layout_owner_changed'
  | 'visual_layout_refresh_timeout'
  | 'visual_layout_refresh_unavailable'
  | 'visual_operation_aborted'
  | 'capture_surface_unsupported'
  | 'capture_surface_unavailable'
  | 'visual_source_unavailable'
  | 'visual_source_retired'
  | 'visual_snapshot_stale'
  | 'visual_target_stale'
  | 'visual_inspection_unavailable'
  | 'visual_inspection_timeout'
  | 'visual_inspection_invalid'
  | 'visual_inspection_unverified'
  | 'visual_evidence_attestation_missing'
  | 'visual_evidence_grounding_missing'
  | 'visual_evidence_synthesis_unavailable'
  | 'vision_evidence_unavailable'
  | 'visual_source_invalid'
  | 'visual_runtime_unavailable'
  | 'visual_look_failed'
  | 'visual_capture_failed'

export type NativeVisualToolErrorContext = Readonly<{
  operation: 'look' | 'capture'
  phase?: 'arguments' | 'runtime' | 'result'
  resourceIdentity?: string
}>

export class AgentRuntimeToolError extends Error {
  readonly code: string
  readonly failureClass?: string
  readonly retryable?: boolean
  readonly resourceIdentity?: string
  readonly evidenceDelta?: boolean
  readonly stateChanged?: boolean
  readonly recovery?: AgentRuntimeToolRecovery
  readonly providerStage?: string

  constructor(message: string, metadata: AgentRuntimeToolFailureMetadata) {
    super(message)
    this.name = 'AgentRuntimeToolError'
    this.code = metadata.code
    this.failureClass = metadata.failureClass
    this.retryable = metadata.retryable
    this.resourceIdentity = metadata.resourceIdentity
    this.evidenceDelta = metadata.evidenceDelta
    this.stateChanged = metadata.stateChanged
    this.recovery = metadata.recovery
    this.providerStage = metadata.providerStage
  }
}

/**
 * Converts errors from the reserved native visual tools into the stable
 * runtime-neutral failure contract consumed by every agent adapter. The
 * visual runtime, transport, and execution governor must share this one
 * classification path so incidental provider wording cannot create a new
 * retry objective.
 */
export function normalizeNativeVisualToolError(
  error: unknown,
  context: NativeVisualToolErrorContext
): AgentRuntimeToolError {
  if (error instanceof AgentRuntimeToolError) return error

  const message = errorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const upstreamCode = errorCode(error)
  const resourceIdentity = normalizeVisualResourceIdentity(context.resourceIdentity)
  const structuredFailure = structuredToolFailureMetadata(error)

  if (upstreamCode && structuredFailure) {
    return nativeVisualError(
      message,
      {
        code: upstreamCode,
        ...structuredFailure,
        resourceIdentity: structuredFailure.resourceIdentity ?? resourceIdentity
      }
    )
  }

  if (
    context.phase === 'arguments' ||
    errorName(error) === 'ZodError' ||
    upstreamCode === 'invalid_arguments' ||
    upstreamCode === 'invalid_visual_arguments'
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_invalid_arguments',
        failureClass: 'invalid_arguments',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'correct_arguments',
          instruction: 'Correct the visual tool arguments using only opaque references returned by the current SciForge tool results.'
        }
      }
    )
  }

  if (context.phase === 'result' || upstreamCode === 'invalid_visual_result') {
    return nativeVisualError(
      message,
      {
        code: 'visual_invalid_result',
        failureClass: 'contract_violation',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'stop',
          instruction: 'Stop this visual path and report that the native visual provider returned an invalid typed result.'
        }
      }
    )
  }

  if (
    upstreamCode === 'visual_runtime_unavailable' ||
    normalizedMessage.includes('visual frame materialization is unavailable') ||
    normalizedMessage.includes('native sciforge visual runtime is unavailable')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_runtime_unavailable',
        failureClass: 'capability_unavailable',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'stop',
          instruction: 'Stop retrying and report that the native SciForge visual runtime must be configured or restored.'
        }
      }
    )
  }

  if (
    errorName(error) === 'AbortError' ||
    upstreamCode === 'aborted' ||
    normalizedMessage.includes('aborted')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_operation_aborted',
        failureClass: 'aborted',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'stop',
          instruction: 'Do not retry this visual call in the stopped turn.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('another session or resource is visible') ||
    normalizedMessage.includes('bound surface layout became unavailable') ||
    normalizedMessage.includes('current visual surface belongs to a different workspace')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_layout_owner_changed',
        failureClass: 'layout_unavailable',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'restore_bound_surface',
          instruction: 'Restore the task-bound SciForge session and resource to the visible surface, then start a new visual call.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('surface target is no longer visible') ||
    normalizedMessage.includes('visual target is unavailable') ||
    normalizedMessage.includes('visual target is stale')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_target_stale',
        failureClass: 'stale_resource',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'reobserve_visual_target',
          instruction: 'Observe the current surface again and use a newly published target reference; do not retry the stale target reference.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('layout refresh is unavailable') ||
    normalizedMessage.includes('cannot refresh the surface layout')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_layout_refresh_unavailable',
        failureClass: 'capability_unavailable',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'stop',
          instruction: 'Stop retrying until renderer layout refresh is available for the visible bound surface.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('layout did not refresh') ||
    normalizedMessage.includes('layout refresh timed out') ||
    normalizedMessage.includes('layout refresh timeout')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_layout_refresh_timeout',
        failureClass: 'timeout',
        retryable: true,
        resourceIdentity,
        recovery: {
          action: 'refresh_visual_layout',
          instruction: 'Request or wait for a new renderer layout publication, then retry this visual call once.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('visual understanding is unavailable') ||
    normalizedMessage.includes('visual inspection is unavailable') ||
    normalizedMessage.includes('visual inspection failed') ||
    upstreamCode === 'visual_inspection_unavailable'
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_inspection_unavailable',
        failureClass: 'upstream_unavailable',
        retryable: true,
        resourceIdentity,
        recovery: {
          action: 'retry_visual_inspection',
          instruction: 'Retry the same native visual inspection once after the visual provider becomes available.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('did not attest the immutable source snapshot') ||
    normalizedMessage.includes('no grounded evidence')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_inspection_unverified',
        failureClass: 'evidence_unverified',
        retryable: true,
        resourceIdentity,
        recovery: {
          action: 'retry_visual_inspection',
          instruction: 'Retry native inspection once and require grounded evidence for the immutable source; do not treat the failed result as proof.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('snapshot changed') ||
    normalizedMessage.includes('visual snapshot has no verified look proof') ||
    normalizedMessage.includes('visual inspection proof is unavailable')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_snapshot_stale',
        failureClass: 'stale_resource',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'repeat_visual_look',
          instruction: 'Run sciforge_look again on the current source and use only the new snapshot, region, and proof references.'
        }
      }
    )
  }

  if (
    upstreamCode === 'resource_ref_retired' ||
    normalizedMessage.includes('resource reference has been retired')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_source_retired',
        failureClass: 'stale_resource',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'stop',
          instruction: 'Stop using this historical source reference and report that its task-owned lifetime has ended; do not substitute the current foreground workspace.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('no visible sciforge surface') ||
    normalizedMessage.includes('visible surface is no longer available') ||
    normalizedMessage.includes('no visual source provider is available') ||
    normalizedMessage.includes('visual snapshot is unavailable') ||
    normalizedMessage.includes('visual artifact is unavailable')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_source_unavailable',
        failureClass: 'capability_unavailable',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'open_visual_source',
          instruction: 'Open or re-observe an authorized visual source and call the native visual tool with its current opaque source reference.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('cannot select another visual frame') ||
    normalizedMessage.includes('cannot be combined with a live surface target') ||
    normalizedMessage.includes('visual operations require')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_invalid_arguments',
        failureClass: 'invalid_arguments',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'correct_arguments',
          instruction: 'Correct the visual tool arguments and use compatible opaque source, target, snapshot, and region references.'
        }
      }
    )
  }

  if (
    normalizedMessage.includes('mime type does not match') ||
    normalizedMessage.includes('dimensions do not match') ||
    normalizedMessage.includes('source dimensions changed') ||
    normalizedMessage.includes('not a supported png') ||
    normalizedMessage.includes('source revision') ||
    normalizedMessage.includes('redactions must use normalized')
  ) {
    return nativeVisualError(
      message,
      {
        code: 'visual_source_invalid',
        failureClass: 'invalid_resource',
        retryable: false,
        resourceIdentity,
        recovery: {
          action: 'open_visual_source',
          instruction: 'Obtain a fresh valid visual source from its canonical provider; do not reuse the invalid frame.'
        }
      }
    )
  }

  return nativeVisualError(
    message,
    {
      code: context.operation === 'look' ? 'visual_look_failed' : 'visual_capture_failed',
      failureClass: 'execution_error',
      retryable: false,
      resourceIdentity,
      recovery: {
        action: 'stop',
        instruction: `Stop retrying this native visual ${context.operation} operation and report the structured failure.`
      }
    }
  )
}

export function nativeVisualResourceIdentity(value: unknown): string {
  if (!value || typeof value !== 'object') return 'visual:current'
  const record = value as Record<string, unknown>
  for (const key of ['regionRef', 'snapshotRef', 'sourceRef', 'targetRef', 'artifactRef']) {
    const candidate = typeof record[key] === 'string' ? record[key].trim() : ''
    if (candidate) return normalizeVisualResourceIdentity(candidate) ?? 'visual:current'
  }
  return 'visual:current'
}

function nativeVisualError(
  message: string,
  metadata: AgentRuntimeToolFailureMetadata & { code: string }
): AgentRuntimeToolError {
  const instruction = metadata.recovery?.instruction.trim()
  const normalizedMessage = message.trim() || 'The native visual operation failed.'
  const actionableMessage = instruction && !normalizedMessage.includes(instruction)
    ? `${normalizedMessage} Recovery: ${instruction}`
    : normalizedMessage
  return new AgentRuntimeToolError(actionableMessage, {
    evidenceDelta: false,
    stateChanged: false,
    ...metadata
  })
}

function structuredToolFailureMetadata(
  error: unknown
): Omit<AgentRuntimeToolFailureMetadata, 'code'> | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  const failureClass = optionalString(record.failureClass)
  const retryable = typeof record.retryable === 'boolean' ? record.retryable : undefined
  const recovery = toolRecovery(record.recovery)
  if (!failureClass || retryable === undefined || recovery === undefined) return undefined
  const resourceIdentity = optionalString(record.resourceIdentity)
  const providerStage = optionalString(record.providerStage)
  const evidenceDelta = typeof record.evidenceDelta === 'boolean' ? record.evidenceDelta : undefined
  const stateChanged = typeof record.stateChanged === 'boolean' ? record.stateChanged : undefined
  return {
    failureClass,
    retryable,
    recovery,
    ...(resourceIdentity ? { resourceIdentity } : {}),
    ...(providerStage ? { providerStage } : {}),
    ...(evidenceDelta !== undefined ? { evidenceDelta } : {}),
    ...(stateChanged !== undefined ? { stateChanged } : {})
  }
}

function toolRecovery(value: unknown): AgentRuntimeToolRecovery | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const action = optionalString(record.action)
  const instruction = optionalString(record.instruction)
  return action && instruction ? { action, instruction } : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeVisualResourceIdentity(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return normalized.startsWith('visual:') ? normalized : `visual:${normalized}`
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code.trim() : ''
}

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object' || !('name' in error)) return ''
  return typeof error.name === 'string' ? error.name : ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'The native visual operation failed without diagnostic detail.'
}

/**
 * Runtime-neutral host tool surface. Runtime adapters only translate this
 * contract to their provider protocol; tool discovery and execution stay here.
 */
export type AgentRuntimeToolSurface = Readonly<{
  tools(): readonly AgentRuntimeToolDefinition[]
  /** Host-private exact historical-turn Principal lease verification. */
  assertPrincipalLease?(context: AgentRuntimeToolCallContext): void
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

/** Narrows both publication and dispatch to one explicit per-run tool policy. */
export function filterAgentRuntimeToolSurface(
  surface: AgentRuntimeToolSurface,
  allowedTools: readonly string[] | undefined
): AgentRuntimeToolSurface {
  if (allowedTools === undefined) return surface
  const allowed = new Set(allowedTools)
  return {
    tools: () => surface.tools().filter((tool) => allowed.has(tool.name)),
    assertPrincipalLease: (context) => surface.assertPrincipalLease?.(context),
    call: (request, options) => {
      if (!allowed.has(request.name)) {
        throw new Error(`AgentRuntime tool is not allowed for this execution: ${request.name}`)
      }
      return surface.call(request, options)
    },
    abortTurn: (identity, reason) => surface.abortTurn?.(identity, reason) ?? 0
  }
}

/** Composes runtime-neutral tool owners while rejecting ambiguous tool names. */
export function composeAgentRuntimeToolSurfaces(
  surfaces: readonly AgentRuntimeToolSurface[]
): AgentRuntimeToolSurface {
  const owners = (): Map<string, AgentRuntimeToolSurface> => {
    const result = new Map<string, AgentRuntimeToolSurface>()
    for (const surface of surfaces) {
      for (const definition of surface.tools()) {
        if (result.has(definition.name)) {
          throw new Error(`AgentRuntime tool ${definition.name} has more than one owner.`)
        }
        result.set(definition.name, surface)
      }
    }
    return result
  }
  return {
    tools: () => {
      owners()
      return surfaces.flatMap((surface) => [...surface.tools()])
    },
    assertPrincipalLease: (context) => {
      for (const surface of surfaces) surface.assertPrincipalLease?.(context)
    },
    call: (request, options) => {
      const owner = owners().get(request.name)
      if (!owner) throw new Error(`Unknown AgentRuntime tool: ${request.name}`)
      return owner.call(request, options)
    },
    abortTurn: (identity, reason) => surfaces.reduce(
      (count, surface) => count + (surface.abortTurn?.(identity, reason) ?? 0),
      0
    )
  }
}

/** Resolves a late-bound Host surface without adding a second dispatch path. */
export function createDeferredAgentRuntimeToolSurface(
  resolve: () => AgentRuntimeToolSurface | null | undefined
): AgentRuntimeToolSurface {
  return {
    tools: () => resolve()?.tools() ?? [],
    assertPrincipalLease: (context) => {
      const surface = resolve()
      if (!surface) throw new Error('AgentRuntime Host tools are not initialized.')
      surface.assertPrincipalLease?.(context)
    },
    call: (request, options) => {
      const surface = resolve()
      if (!surface) throw new Error('AgentRuntime Host tools are not initialized.')
      return surface.call(request, options)
    },
    abortTurn: (identity, reason) => resolve()?.abortTurn?.(identity, reason) ?? 0
  }
}
