import type { AppSettingsV1 } from '../../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeThreadRelation,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadSidebarProbe,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTransport,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'

export type AgentRuntimeAdapterContext = {
  settings: AppSettingsV1
  turnGovernanceSnapshot?: AgentRuntimeTurnGovernanceSnapshot
}

export type AgentRuntimeThreadRenameInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  title: string
}

export type AgentRuntimeThreadDeleteInput = {
  runtimeId: AgentRuntimeId
  threadId: string
}

export type AgentRuntimeEventSubscribeInput = {
  runtimeId: AgentRuntimeId
  threadId: string
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
}

export type AgentRuntimeUserInputResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  requestId: string
  answers: Array<{ id: string; label?: string; value: string }>
}

export type AgentRuntimeThreadCompactInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  reason?: string
}

export type AgentRuntimeThreadForkInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation?: AgentRuntimeThreadRelation
  title?: string
}

export type AgentRuntimeSessionResumeInput = {
  runtimeId: AgentRuntimeId
  sessionId: string
  model?: string
  mode?: string
  maxResumeCount?: number
}

export type AgentRuntimeSessionResumeHandle = {
  threadId: string
  sessionId: string
}

export type AgentRuntimeThreadRelationInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation: AgentRuntimeThreadRelation
}

export type AgentRuntimeTurnGovernanceSnapshot = {
  ownedVisualToolsAvailable: boolean
  nativeVisualProofChainPending: boolean
}

export type AgentRuntimeTurnGovernanceSnapshotInput = AgentRuntimeTurnTargetInput & {
  snapshot: AgentRuntimeTurnGovernanceSnapshot
}

export type AgentRuntimeAdapter = {
  id: AgentRuntimeId
  transport: AgentRuntimeTransport
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
  readThread(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadReadInput
  ): Promise<AgentRuntimeThreadDetail>
  readThreadSidebarProbe?(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadReadInput
  ): Promise<AgentRuntimeThreadSidebarProbe>
  startTurn(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimeTurnHandle>
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
