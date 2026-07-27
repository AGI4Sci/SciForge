import type { z } from 'zod'

import type { DomainPackageJsonValue } from './contract.js'
import type { TrustedDomainProcessEntryInput } from './process-entry.js'

export const MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND = 'main.runtime-lifecycle' as const
export const MAIN_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION_KIND =
  'main.agent-artifact-consumer' as const
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
  invoke<TInput, TOutput>(
    contract: DomainCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      idempotencyKey?: string
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
  capabilities: DomainMainSystemCapabilityInvoker
  modelAccess: DomainMainModelAccessHost
  enablement: DomainMainModuleEnablementHost
  log: (entry: DomainMainRuntimeLogEntry) => void
}>

export type DomainMainRuntimeLifecycleContext =
  Omit<DomainMainRuntimeLifecycleHost, 'enablement'> & Readonly<{
  owner: DomainRuntimeContributionOwner
  signal: AbortSignal
  enablement: DomainMainModuleEnablement
}>

export type DomainMainRuntimeDisposer = () => void | Promise<void>

export type DomainMainRuntimeLifecycleContribution = Readonly<{
  activate: (
    context: DomainMainRuntimeLifecycleContext
  ) => void | DomainMainRuntimeDisposer | Promise<void | DomainMainRuntimeDisposer>
}>

/**
 * Opaque completed-turn payload delivered to package-owned artifact consumers.
 *
 * Consumers validate the artifact values they own. The host only guarantees the
 * generic turn identity, ordering watermark, and immutable payload envelope.
 */
export type DomainAgentArtifactEvent = Readonly<{
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

export type DomainAgentArtifactConsumer = Readonly<{
  consume: (event: DomainAgentArtifactEvent) => void | Promise<void>
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

export function isDomainAgentArtifactConsumer(
  value: unknown
): value is DomainAgentArtifactConsumer {
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

export type DomainRendererWorkbenchHost = Readonly<{
  openRightPanel: (input: DomainWorkbenchOpenRightPanelInput) => void
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
}>

export type DomainRendererCapabilityContract<TInput, TOutput> =
  DomainCapabilityContract<TInput, TOutput>

/** Structurally matches an opaque capability resource handle issued by the host. */
export type DomainCapabilityResourceHandle = Readonly<{
  token: string
  semanticRevision: string
  expiresAt: string
}>

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

export type DomainRendererVisibleContextHost = Readonly<{
  registerComponent(component: DomainVisibleContextComponent): () => void
  registerVisualTarget(input: Readonly<{
    componentId: string
    target: DomainVisibleContextTarget
    /** Renderer-owned element handle; the host validates it before measuring. */
    element?: () => object | null
  }>): () => void
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
}>

/** Renderer-safe services available to every trusted domain package. */
export type DomainRendererHost = Readonly<{
  capabilityInvoker: DomainRendererCapabilityInvoker
  openExternal: (url: string) => void | Promise<void>
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
