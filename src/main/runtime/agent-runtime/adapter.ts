import type { AppSettingsV1 } from '../../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadPageInput,
  AgentRuntimeThreadRelation,
  AgentRuntimeThread,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeToolArtifact,
  AgentRuntimeToolArtifactReadInput,
  AgentRuntimeTransport,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import type { WorkspaceHostPlacement } from '../../../shared/workspace-host-state'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type { AgentRuntimeBrokerScope } from './agent-tool-surface'
import type {
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

export type AgentRuntimeAdapterContext = {
  settings: AppSettingsV1
  workspaceHost?: WorkspaceHostPlacement
  turnGovernanceSnapshot?: AgentRuntimeTurnGovernanceSnapshot
  /** @internal Host durability acknowledgement required before startTurn resolves. */
  onTurnAccepted?: (handle: AgentRuntimeTurnHandle) => Promise<void>
  /** @internal Host-captured turn attribution. Never populated from provider payloads. */
  principal?: PrincipalSnapshot
  /** @internal Exact Host authorization lease, including signed-out revisions. */
  principalContext?: PrincipalContextSnapshot
}

/** Adapter-owned exact identity persisted before provider launch. */
export type AgentRuntimePreparedTurn = Readonly<{
  handle: AgentRuntimeTurnHandle
  dispatch: () => Promise<AgentRuntimeTurnHandle>
}>

export type AgentRuntimeThreadRenameInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  title: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeThreadDeleteInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeEventSubscribeInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
  sinceSeq?: number
  streamId?: string
  signal?: AbortSignal
}

export type AgentRuntimeApprovalResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  approvalId: string
  decision: 'allowed' | 'denied'
  message?: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeUserInputResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  requestId: string
  answers: Array<{ id: string; label?: string; value: string }>
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeThreadCompactInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  reason?: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeThreadForkInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation?: AgentRuntimeThreadRelation
  title?: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeSessionResumeInput = {
  runtimeId: AgentRuntimeId
  sessionId: string
  model?: string
  mode?: string
  maxResumeCount?: number
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeSessionResumeHandle = {
  threadId: string
  sessionId: string
}

export type AgentRuntimeThreadRelationInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation: AgentRuntimeThreadRelation
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeTurnGovernanceSnapshot = {
  ownedVisualToolsAvailable: boolean
  nativeVisualProofChainPending: boolean
}

export type AgentRuntimeTurnGovernanceSnapshotInput = AgentRuntimeTurnTargetInput & {
  snapshot: AgentRuntimeTurnGovernanceSnapshot
}

export type AgentRuntimeSubagentTarget = {
  childId: string
  parentThreadId: string
  parentTurnId: string
}

export type AgentRuntimeSubagentThreadRef = {
  runtime?: string
  threadId: string
  turnId?: string
  url?: string
}

export type AgentRuntimeSubagentTranscriptEntry = {
  id: string
  kind: 'user_message' | 'assistant_message' | 'reasoning' | 'tool' | 'system' | 'event'
  text?: string
  summary?: string
  status?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeSubagentUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  cacheHitRate?: number | null
  turns?: number
  costUsd?: number
  costCny?: number
  cacheSavingsUsd?: number
  cacheSavingsCny?: number
  tokenEconomySavingsTokens?: number
  tokenEconomySavingsUsd?: number
  tokenEconomySavingsCny?: number
}

export type AgentRuntimeSubagentResult = {
  summary?: string
  usage?: AgentRuntimeSubagentUsage
  transcript?: readonly AgentRuntimeSubagentTranscriptEntry[]
  threadRef?: AgentRuntimeSubagentThreadRef
}

export type AgentRuntimeSubagentLiveness = {
  state: 'active' | 'missing'
  observedAt: string
}

export type AgentRuntimeSubagentMessageReceipt = {
  established: boolean
}

export type AgentRuntimeSubagentSpawnInput = AgentRuntimeSubagentTarget & {
  label?: string
  prompt: string
  workspace?: string
  model?: string
  allowedTools?: readonly string[]
  brokerScope?: AgentRuntimeBrokerScope
  maxToolCalls?: number
  signal: AbortSignal
  appendTranscript(entry: AgentRuntimeSubagentTranscriptEntry): Promise<void>
  onSpawned(threadRef: AgentRuntimeSubagentThreadRef): void | Promise<void>
}

export type AgentRuntimeSubagentInspectInput = AgentRuntimeSubagentTarget & {
  signal: AbortSignal
}

export type AgentRuntimeSubagentMessageInput = AgentRuntimeSubagentTarget & {
  message: string
  signal: AbortSignal
}

export type AgentRuntimeSubagentCancelInput = AgentRuntimeSubagentTarget & {
  reason: 'parent_abort' | 'parent_cancel'
  signal: AbortSignal
}

export type AgentRuntimeSubagentResumeInput = AgentRuntimeSubagentSpawnInput & {
  threadRef: AgentRuntimeSubagentThreadRef
}

export type AgentRuntimeSubagentDeleteInput = AgentRuntimeSubagentTarget & {
  threadRef?: AgentRuntimeSubagentThreadRef
  signal: AbortSignal
}

/**
 * Provider-owned child execution controls. AgentRuntime owns orchestration,
 * persistence, tool publication, and parent/child accounting; adapters only
 * translate these lifecycle operations to their provider protocol.
 */
export type AgentRuntimeSubagentAdapter = {
  spawn(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentSpawnInput
  ): Promise<AgentRuntimeSubagentResult>
  resume(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentResumeInput
  ): Promise<AgentRuntimeSubagentResult>
  inspect(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentInspectInput
  ): Promise<AgentRuntimeSubagentLiveness>
  message(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentMessageInput
  ): Promise<AgentRuntimeSubagentMessageReceipt>
  cancel(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentCancelInput
  ): Promise<void>
  delete(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSubagentDeleteInput
  ): Promise<void>
}

export type AgentRuntimeAdapter = {
  id: AgentRuntimeId
  transport: AgentRuntimeTransport
  subagents?: AgentRuntimeSubagentAdapter
  connect(context: AgentRuntimeAdapterContext): Promise<void>
  capabilities(context: AgentRuntimeAdapterContext): Promise<AgentRuntimeCapabilities>
  listThreads(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadListInput
  ): Promise<AgentRuntimeThread[]>
  startThread(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadStartInput
  ): Promise<AgentRuntimeThread>
  readThreadStatus(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadStatusInput
  ): Promise<AgentRuntimeThreadStatus>
  readThreadPage(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadPageInput
  ): Promise<AgentRuntimeThreadPage>
  readToolArtifact(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeToolArtifactReadInput
  ): Promise<AgentRuntimeToolArtifact>
  startTurn(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimeTurnHandle>
  prepareTurnCapture?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimePreparedTurn>
  interruptTurn(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnTargetInput
  ): Promise<void>
  steerTurn(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnSteerInput
  ): Promise<void>
  renameThread(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadRenameInput
  ): Promise<void>
  deleteThread(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadDeleteInput
  ): Promise<void>
  subscribeEvents(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeEventSubscribeInput
  ): AsyncIterable<AgentRuntimeEvent>
  publishSyntheticEvent?(
    context: AgentRuntimeAdapterContext,
    event: AgentRuntimeEvent
  ): Promise<AgentRuntimeEvent>
  updateTurnGovernanceSnapshot?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnGovernanceSnapshotInput
  ): Promise<void>

  resolveApproval?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeApprovalResolveInput
  ): Promise<void>
  resolveUserInput?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeUserInputResolveInput
  ): Promise<void>
  compactThread?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadCompactInput
  ): Promise<void>
  forkThread?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadForkInput
  ): Promise<AgentRuntimeThread>
  resumeSession?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeSessionResumeInput
  ): Promise<AgentRuntimeSessionResumeHandle>
  updateThreadRelation?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadRelationInput
  ): Promise<void>
  usage(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeUsageQuery
  ): Promise<AgentRuntimeUsageResponse>
  auxiliary?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeAuxiliaryInput
  ): Promise<unknown>
}
