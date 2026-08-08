import type { z } from 'zod'

import type { DomainMainAgentExecutionHost } from './agent-execution.js'
import type { DomainPackageJsonValue } from './contract.js'
import type {
  DomainExecutionEventInput,
  DomainExecutionEventV1
} from './reproducibility.js'
import type { DomainMainPowerHost } from './power.js'
import type { TrustedDomainProcessEntryInput } from './process-entry.js'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererSessionResource,
  DomainRendererWorkbenchSendMessageInput,
  DomainRendererWorkbenchSendMessageResult,
  DomainRendererWorkbenchSurfaceActivation,
  DomainRendererWorkspaceFilePickerRequest,
  DomainRendererWorkspacePickResult
} from './renderer-contributions.js'
import type { DomainWorkflowExecutionReceiptProvider } from './workflow-template.js'
import type { DomainMainVisualCaptureHost } from './visual-capture.js'
import type {
  WorkspaceHostArtifact,
  WorkspaceHostOpenRemoteSessionInput
} from './workspace-host.js'
export * from './agent-execution.js'
export * from './power.js'
export * from './renderer-contributions.js'
export * from './visual-capture.js'
export * from './workflow-template.js'

export const MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND = 'main.runtime-lifecycle' as const
export const MAIN_ARTIFACT_CONSUMER_CONTRIBUTION_KIND =
  'main.artifact-consumer' as const
export const MAIN_ACTION_GUARD_CONTRIBUTION_KIND = 'main.action-guard' as const

export type DomainRuntimeContributionOwner = Readonly<{
  moduleId: string
  moduleVersion: string
}>

export type DomainMainRuntimeLogEntry = Readonly<{
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: unknown
}>

export type DomainAgentThreadListInput = Readonly<{
  runtimeId?: string
  limit?: number
  includeArchived?: boolean
  includeSide?: boolean
}>

export type DomainAgentThread = Readonly<{
  id: string
  runtimeId: string
  workspaceRoot?: string
  archived?: boolean
}>

export type DomainAgentThreadTurn = Readonly<{
  id: string
  status?: string
  completedAt?: string
  artifacts: readonly unknown[]
}>

export type DomainAgentThreadDetail = DomainAgentThread & Readonly<{
  watermark: string
  turns: readonly DomainAgentThreadTurn[]
  artifacts: readonly unknown[]
}>

type DomainMainTurnLifecycleEventBase = Readonly<{
  runtimeId: string
  threadId: string
  workspaceRoot?: string
  occurredAt: string
}>

export type DomainMainBeforeTurnEvent = DomainMainTurnLifecycleEventBase & Readonly<{
  kind: 'before-turn'
  state: 'starting'
  turnId?: string
}>

export type DomainMainAfterTurnEvent = DomainMainTurnLifecycleEventBase & Readonly<{
  kind: 'after-turn'
  state: 'completed' | 'failed' | 'cancelled'
  turnId: string
}>

export type DomainMainTurnLifecycleEvent =
  | DomainMainBeforeTurnEvent
  | DomainMainAfterTurnEvent

export type DomainMainTurnLifecycleEventsHost = Readonly<{
  subscribe: (
    listener: (event: DomainMainTurnLifecycleEvent) => void | Promise<void>
  ) => DomainMainRuntimeDisposer
}>

export type DomainMainAgentThreadsHost = Readonly<{
  list: (input?: DomainAgentThreadListInput) => Promise<readonly DomainAgentThread[]>
  read: (input: Readonly<{
    runtimeId: string
    threadId: string
  }>) => Promise<DomainAgentThreadDetail>
  hasActiveTurns: () => boolean
}>

export type DomainMainModuleEnablementHost = Readonly<{
  isEnabled: (moduleId: string) => boolean | Promise<boolean>
  subscribe: (
    moduleId: string,
    listener: (enabled: boolean) => void
  ) => DomainMainRuntimeDisposer
}>

export type DomainMainModuleEnablement = Readonly<{
  isEnabled: () => boolean | Promise<boolean>
  subscribe: (listener: (enabled: boolean) => void) => DomainMainRuntimeDisposer
}>

export type DomainCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

export type DomainMainSystemCapabilityInvoker = Readonly<{
  /**
   * Invokes a capability through host policy. This system-facing surface has no
   * approval argument: lifecycle code cannot manufacture user approval.
   * Approval-requiring effects fail unless the host already owns a valid grant.
   */
  invoke<TInput, TOutput>(
    contract: DomainCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      idempotencyKey?: string
      resource?: DomainCapabilityResourceHandle
      expectedRevision?: string
      authorization?: Readonly<{
        /**
         * The host may propagate an already-approved outer action. It must
         * reject this mode when no matching current action exists.
         */
        mode: 'inherit-current-action'
      }>
    }>
  ): Promise<TOutput>
}>

export type DomainMainTextReasoner = Readonly<{
  baseUrl: string
  apiKey: string
  model: string
}>

export type DomainMainModelAccessHost = Readonly<{
  textReasoner: () => Promise<DomainMainTextReasoner | null>
}>

/**
 * Process-level services shared with runtime lifecycle contributions.
 *
 * The host deliberately exposes data and diagnostics rather than host-private
 * service implementations. Domain packages keep ownership of their runtime.
 */
export type DomainMainRuntimeLifecycleHost = Readonly<{
  userDataDir: string
  appRoot: string
  environment: Readonly<Record<string, string | undefined>>
  agentThreads: DomainMainAgentThreadsHost
  turnEvents?: DomainMainTurnLifecycleEventsHost
  agentExecution?: DomainMainAgentExecutionHost
  power?: DomainMainPowerHost
  capabilities: DomainMainSystemCapabilityInvoker
  modelAccess: DomainMainModelAccessHost
  executionEvents: DomainMainExecutionEventsRouter
  enablement: DomainMainModuleEnablementHost
  log: (entry: DomainMainRuntimeLogEntry) => void
}>

export type DomainMainRuntimeLifecycleContext =
  Omit<DomainMainRuntimeLifecycleHost, 'enablement' | 'executionEvents'> & Readonly<{
    owner: DomainRuntimeContributionOwner
    signal: AbortSignal
    enablement: DomainMainModuleEnablement
    executionEvents: DomainMainExecutionEventsHost
    workflowExecutionReceipts: readonly DomainWorkflowExecutionReceiptProvider[]
  }>

export type DomainMainRuntimeDisposer = () => void | Promise<void>

export type DomainMainRuntimeLifecycleContribution = Readonly<{
  activate: (
    context: DomainMainRuntimeLifecycleContext
  ) => void | DomainMainRuntimeDisposer | Promise<void | DomainMainRuntimeDisposer>
}>

/** Opaque completed Agent turn delivered through the canonical artifact stream. */
export type DomainTurnArtifactEvent = Readonly<{
  contractVersion: 1
  kind: 'turn-completed'
  runtimeId: string
  threadId: string
  turnId: string
  targetWatermark: string
  sequence?: number
  workspaceRoot?: string
  occurredAt: string
  artifacts: readonly unknown[]
}>

/** Opaque completed non-Agent execution delivered through the same stream. */
export type DomainExecutionArtifactEvent = Readonly<{
  contractVersion: 1
  kind: 'execution-completed'
  /** Host-minted delivery facts; package event payloads cannot supply these. */
  hostBinding?: Readonly<{
    contractVersion: 1
    acceptanceSequence: number
    workspaceBinding: 'capability-caller' | 'unbound'
    workspaceRoot?: string
  }>
  producer: Readonly<{
    moduleId: string
    moduleVersion: string
  }>
  executionId: string
  runId: string
  activityId?: string
  targetWatermark: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  workspaceRoot?: string
  occurredAt: string
  artifacts: readonly unknown[]
}>

export type DomainArtifactEvent = DomainTurnArtifactEvent | DomainExecutionArtifactEvent

export type DomainArtifactEventScope = Readonly<{
  runtimeId: string
  threadId: string
  turnId?: string
  workspaceRoot?: string
}>

/**
 * Returns the one canonical DAG scope for both Agent turns and package-owned
 * executions. Executions that did not originate in a thread receive a stable
 * synthetic scope shared by every artifact consumer.
 */
export function domainArtifactEventScope(
  event: DomainArtifactEvent
): DomainArtifactEventScope {
  if (event.kind === 'turn-completed') {
    return Object.freeze({
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      ...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {})
    })
  }
  return Object.freeze({
    runtimeId: event.runtimeId?.trim() || `domain:${event.producer.moduleId}`,
    threadId: event.threadId?.trim() || `execution:${event.executionId}`,
    ...(event.turnId?.trim() ? { turnId: event.turnId.trim() } : {}),
    ...(event.workspaceRoot?.trim() ? { workspaceRoot: event.workspaceRoot.trim() } : {})
  })
}

export type DomainArtifactConsumer = Readonly<{
  /**
   * Delivery is at least once: after a partial fan-out the Host retries the
   * identical event for every consumer. Implementations must therefore apply
   * effects idempotently using the event scope and targetWatermark.
   */
  consume: (event: DomainArtifactEvent) => void | Promise<void>
}>

/**
 * The host persists each event to the single Full Trace stream before making
 * completed executions visible to artifact consumers.
 */
export type DomainMainExecutionEventsHost = Readonly<{
  publish: (event: DomainExecutionEventInput) => Promise<DomainExecutionEventV1>
}>

/** Main-process router used to bind a publisher to the activating package owner. */
export type DomainMainExecutionEventsRouter = Readonly<{
  publish: (
    owner: DomainRuntimeContributionOwner,
    event: DomainExecutionEventInput
  ) => Promise<DomainExecutionEventV1>
}>

export type DomainMainActionGuardInput = Readonly<{
  actionId: string
  payload: DomainPackageJsonValue
}>

export type DomainMainActionGuardResult = Readonly<{
  allowed: boolean
  message?: string
  metadata?: DomainPackageJsonValue
}>

export type DomainMainActionGuard = Readonly<{
  actions: readonly string[]
  evaluate: (
    input: DomainMainActionGuardInput
  ) => DomainMainActionGuardResult | Promise<DomainMainActionGuardResult>
}>

export function isDomainMainRuntimeLifecycleContribution(
  value: unknown
): value is DomainMainRuntimeLifecycleContribution {
  return isRecord(value) && typeof value.activate === 'function'
}

export function isDomainArtifactConsumer(
  value: unknown
): value is DomainArtifactConsumer {
  return isRecord(value) && typeof value.consume === 'function'
}

export function isDomainMainActionGuard(
  value: unknown
): value is DomainMainActionGuard {
  if (!isRecord(value) || typeof value.evaluate !== 'function' || !Array.isArray(value.actions)) {
    return false
  }
  const actions = value.actions
  return actions.length > 0 &&
    actions.every((action) => typeof action === 'string' && Boolean(action.trim())) &&
    new Set(actions).size === actions.length
}

export type DomainWorkbenchRightPanelSession = Readonly<{
  id: string
  runtimeId?: string
  workspaceRoot?: string
  resources?: readonly DomainRendererSessionResource[]
}>

export type DomainWorkbenchRightPanelActivation = Readonly<{
  contributionId: string
  revision: number
  payload: DomainPackageJsonValue
}>

export type DomainWorkbenchRightPanelRenderContext = Readonly<{
  active: boolean
  className: string
  onCollapse: () => void
  session: DomainWorkbenchRightPanelSession
  activation?: DomainWorkbenchRightPanelActivation
}>

export type DomainWorkbenchOpenRightPanelInput = Readonly<{
  contributionId: string
  sessionId: string
  activation?: DomainWorkbenchRightPanelActivation
}>

export type DomainWorkbenchOpenSurfaceInput = Readonly<{
  contributionId: string
  sessionId?: string
  activation?: DomainRendererWorkbenchSurfaceActivation
}>

export type DomainWorkbenchToggleGlobalOverlayInput =
  DomainWorkbenchOpenSurfaceInput & Readonly<{
    open?: boolean
  }>

export type DomainWorkspacePreviewTarget = Readonly<{
  path: string
  sessionId: string
  workspaceRoot?: string
  kind?: 'file' | 'directory'
  line?: number
  column?: number
  selection?: DomainPackageJsonValue
  anchor?: DomainPackageJsonValue
  integrity?: Readonly<{
    algorithm: 'sha256'
    expectedDigest: string
  }>
  returnTo?: Readonly<{
    contributionId: string
    label?: string
    activation?: DomainWorkbenchRightPanelActivation
  }>
}>

export type DomainRendererWorkspacePreviewHost = Readonly<{
  open: (target: DomainWorkspacePreviewTarget) => void
}>

export type DomainRendererWorkspaceHost = Readonly<{
  pickFile: (
    request: DomainRendererWorkspaceFilePickerRequest
  ) => Promise<DomainRendererWorkspacePickResult>
  openRemoteSession?: (
    input: WorkspaceHostOpenRemoteSessionInput
  ) => Promise<void>
}>

export type DomainRendererWorkbenchHost = Readonly<{
  openRightPanel: (input: DomainWorkbenchOpenRightPanelInput) => void
  openBottomPanel?: (input: DomainWorkbenchOpenSurfaceInput) => void
  toggleGlobalOverlay?: (input: DomainWorkbenchToggleGlobalOverlayInput) => void
  sendMessage?: (
    input: DomainRendererWorkbenchSendMessageInput
  ) => Promise<DomainRendererWorkbenchSendMessageResult>
}>

/**
 * Main-process services available to every trusted domain package.
 *
 * Capability definitions deliberately cross this boundary as unknown values:
 * the application host owns their concrete type and performs the authoritative
 * validation when the definition enters its registry.
 */
export type DomainMainHost = Readonly<{
  getUserDataDir: () => string
  defineCapability: (options: unknown) => unknown
  /** Opens one absolute local path with the operating system's configured application. */
  openPath?: (path: string) => Promise<void>
  resolveWorkspaceServerArtifact?: () => Promise<WorkspaceHostArtifact>
  capabilities?: DomainMainSystemCapabilityInvoker
  visualCapture?: DomainMainVisualCaptureHost
}>

export type DomainRendererCapabilityContract<TInput, TOutput> =
  DomainCapabilityContract<TInput, TOutput>

export type DomainRendererCapabilityObservationContract<TState> = Readonly<{
  resourceKind: string
  stateSchema: z.ZodType<TState>
}>

export type DomainRendererCapabilityObservation<TState> = Readonly<{
  resource: DomainCapabilityResourceHandle
  resourceRef: string
  resourceKind: string
  semanticRevision: string
  layoutRevision?: string
  observedAt: string
  state: TState
}>

export type DomainRendererCapabilityChange = Readonly<{
  resourceRef: string
  resourceKind: string
  actionId: string
  beforeRevision: string
  afterRevision: string
  changedAt: string
}>

export type DomainRendererCapabilityChangeDisposer = () => void

export type DomainVisibleContextResource = Readonly<{
  kind: string
  role?: string
  title?: string
  accessHint?: string
  capability?: Readonly<{
    resourceRef: string
    operations: readonly Readonly<{
      operationRef: string
      schemaRef: string
    }>[]
  }>
  metadata?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextComponent = Readonly<{
  id: string
  region: string
  component: string
  title?: string
  visible: boolean
  priority?: number
  updatedAt: string
  summary: string
  resources?: readonly DomainVisibleContextResource[]
  state?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextTarget = Readonly<{
  id: string
  kind: 'component' | 'document-page' | 'region' | 'window'
  contentType?: string
  active?: boolean
  redact?: boolean
  metadata?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextPoint = Readonly<{
  clientX: number
  clientY: number
}>

export type DomainVisibleContextViewportBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type DomainVisibleContextInspection =
  | Readonly<{
    selectable: true
    /** Opaque, host-signed reference accepted by the visual-capture port. */
    targetRef: string
    componentId: string
    target: DomainVisibleContextTarget
    bounds: DomainVisibleContextViewportBounds
  }>
  | Readonly<{
    selectable: false
    reason: 'redacted'
  }>

export type DomainVisibleContextSelectionInspection = Readonly<{
  /** Opaque, host-signed reference accepted by the visual-capture port. */
  targetRef: string
  componentId: string
  target: DomainVisibleContextTarget
  bounds: DomainVisibleContextViewportBounds
  text: string
}>

export type DomainRendererVisibleContextHost = Readonly<{
  registerComponent(component: DomainVisibleContextComponent): () => void
  registerVisualTarget(input: Readonly<{
    componentId: string
    target: DomainVisibleContextTarget
    /** Renderer-owned element handle; the host validates it before measuring. */
    element?: () => object | null
  }>): () => void
  inspectRegisteredTargetAt?(
    point: DomainVisibleContextPoint
  ): Promise<DomainVisibleContextInspection | null>
  inspectRegisteredTextSelection?(): Promise<DomainVisibleContextSelectionInspection | null>
}>

export type DomainRendererCapabilityInvoker = Readonly<{
  observe<TState>(
    contract: DomainRendererCapabilityObservationContract<TState>,
    resource: DomainCapabilityResourceHandle,
    options?: Readonly<{ workspaceId?: string }>
  ): Promise<DomainRendererCapabilityObservation<TState>>
  invoke<TInput, TOutput>(
    contract: DomainRendererCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      resource?: DomainCapabilityResourceHandle
      expectedRevision?: string
      approval?: Readonly<{ mode: 'confirmation' }>
    }>
  ): Promise<TOutput>
  subscribe?(
    resourceRef: string,
    listener: (change: DomainRendererCapabilityChange) => void,
    options?: Readonly<{ workspaceId?: string }>
  ): Promise<DomainRendererCapabilityChangeDisposer>
}>

/** Renderer-safe services available to every trusted domain package. */
export type DomainRendererHost = Readonly<{
  capabilityInvoker: DomainRendererCapabilityInvoker
  openExternal: (url: string) => void | Promise<void>
  workspace?: DomainRendererWorkspaceHost
  workspacePreview?: DomainRendererWorkspacePreviewHost
  workbench?: DomainRendererWorkbenchHost
  visibleContext?: DomainRendererVisibleContextHost
}>

export type DomainMainEntryFactory<Value = unknown> = (
  host: DomainMainHost
) => TrustedDomainProcessEntryInput<Value>

export type DomainRendererEntryFactory<Value = unknown> = (
  host: DomainRendererHost
) => TrustedDomainProcessEntryInput<Value>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
