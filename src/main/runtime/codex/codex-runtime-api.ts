import type {
  AgentRuntimeChild,
  AgentRuntimeCompletionReceipt,
  AgentRuntimeExecutionEffectClass,
  AgentRuntimeFileReference,
  AgentRuntimePhase,
  AgentRuntimeThreadRelation,
  AgentRuntimeThreadSidebarVisibility,
  AgentRuntimeThreadGoalStatus,
  AgentRuntimeUsage
} from '../../../shared/agent-runtime-contract'
import type {
  CodexAppServerAccount,
  CodexAppServerGetAccountRateLimitsResponse,
  CodexAppServerPlanType
} from './app-server/protocol'

export type CodexJsonObject = Record<string, unknown>

export type CodexNormalizedThread = {
  id: string
  codexThreadId?: string
  title: string
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  status?: string
  archived?: boolean
  preview?: string
  latestTurnId?: string
  latestTurnStatus?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
  titleSource?: string
  agentNickname?: string
  agentRole?: string
}

type CodexChatBlockBase = {
  id: string
  createdAt?: string
  turnId?: string
}

export type CodexChatBlock =
  | (CodexChatBlockBase & { kind: 'user'; text: string; displayText?: string })
  | (CodexChatBlockBase & { kind: 'assistant'; text: string; snapshot?: boolean })
  | (CodexChatBlockBase & { kind: 'reasoning'; text: string; meta?: Record<string, unknown> })
  | (CodexChatBlockBase & {
      kind: 'tool'
      summary: string
      status: 'running' | 'success' | 'error'
      toolKind?: 'tool_call' | 'command_execution' | 'file_change'
      detail?: string
      filePath?: string
      meta?: Record<string, unknown>
    })
  | (CodexChatBlockBase & {
      kind: 'system'
      text: string
      code?: string
      detail?: string
      severity?: 'info' | 'warning' | 'error'
    })

export type CodexThreadDetail = {
  blocks: CodexChatBlock[]
  latestSeq: number
  workspace?: string
  threadStatus?: string
  latestTurnId?: string
  latestUserMessageId?: string
  usage?: AgentRuntimeUsage
}

export type CodexThreadEventPayload = {
  threadId: string
  turnId?: string
  seq?: number
  deltas?: Array<{ text: string; kind: 'agent_message' | 'agent_reasoning'; seq?: number; snapshot?: boolean }>
  userMessage?: {
    itemId: string
    turnId?: string
    createdAt?: string
    text: string
    displayText?: string
  }
  tool?: {
    itemId: string
    summary: string
    status: 'running' | 'success' | 'error'
    toolKind?: 'tool_call' | 'command_execution' | 'file_change'
    effects?: AgentRuntimeExecutionEffectClass[]
    completionReceipts?: AgentRuntimeCompletionReceipt[]
    detail?: string
    filePath?: string
    meta?: Record<string, unknown>
  }
  runtimeError?: {
    itemId: string
    createdAt?: string
    message: string
    code?: string
    details?: unknown
    severity?: 'info' | 'warning' | 'error'
  }
  runtimeStatus?: {
    itemId?: string
    phase: AgentRuntimePhase
    message?: string
    latencyMs?: number
    createdAt?: string
  }
  goal?: {
    itemId?: string
    createdAt?: string
    objective?: string
    status?: AgentRuntimeThreadGoalStatus
    cleared?: boolean
  }
  child?: AgentRuntimeChild
  usage?: AgentRuntimeUsage
  turnComplete?: boolean
}

export function codexModelDeltaItemId(
  event: Pick<CodexThreadEventPayload, 'seq' | 'turnId'>,
  delta: NonNullable<CodexThreadEventPayload['deltas']>[number],
  index: number
): string {
  const sequence = event.seq ?? delta.seq
  const eventIdentity =
    typeof sequence === 'number' && Number.isFinite(sequence)
      ? Math.floor(sequence)
      : event.turnId?.trim() || 'event'
  return `${delta.kind}-${eventIdentity}-${Math.max(0, Math.floor(index))}`
}

export type CodexRuntimeFailure = {
  ok: false
  message: string
  code?: string
  recoverable?: boolean
}

export type CodexRuntimeOk<T extends CodexJsonObject = CodexJsonObject> = {
  ok: true
} & T

export type CodexConnectResult =
  | CodexRuntimeOk<{ info: CodexJsonObject }>
  | CodexRuntimeFailure

export type CodexCodingPlanAccountResult =
  | CodexRuntimeOk<{
    account: CodexAppServerAccount | null
    planType: CodexAppServerPlanType | null
    requiresOpenaiAuth: boolean
  }>
  | CodexRuntimeFailure

export type CodexCodingPlanLoginMethod = 'browser' | 'device'

export type CodexCodingPlanLoginStartResult =
  | CodexRuntimeOk<{
    method: CodexCodingPlanLoginMethod
    loginId: string
    authUrl?: string
    verificationUrl?: string
    userCode?: string
  }>
  | CodexRuntimeFailure

export type CodexCodingPlanLoginCompletionResult =
  | CodexRuntimeOk<{
    loginId: string
    success: boolean
    error?: string
    account?: CodexAppServerAccount | null
    planType?: CodexAppServerPlanType | null
  }>
  | CodexRuntimeFailure

export type CodexCodingPlanRateLimitsResult =
  | CodexRuntimeOk<CodexAppServerGetAccountRateLimitsResponse>
  | CodexRuntimeFailure

export type CodexThreadListResult =
  | CodexRuntimeOk<{ threads: CodexNormalizedThread[] }>
  | CodexRuntimeFailure

export type CodexThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
}

export type CodexThreadStartPayload = {
  threadId?: string
  workspace?: string
  title?: string
  model?: string
  modelProvider?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
}

export type CodexThreadStartResult =
  | CodexRuntimeOk<{ thread: CodexNormalizedThread }>
  | CodexRuntimeFailure

export type CodexThreadReadResult =
  | CodexRuntimeOk<{ detail: CodexThreadDetail }>
  | CodexRuntimeFailure

export type CodexThreadMutationResult =
  | CodexRuntimeOk
  | CodexRuntimeFailure

export type CodexTurnStartPayload = {
  threadId: string
  text: string
  displayText?: string
  workspace?: string
  model?: string
  reasoningEffort?: string
  fileReferences?: AgentRuntimeFileReference[]
}

export type CodexTurnStartResult =
  | CodexRuntimeOk<{ threadId: string; turnId: string; userMessageItemId?: string }>
  | CodexRuntimeFailure

export type CodexTurnSteerPayload = {
  threadId: string
  turnId: string
  text: string
}

export type CodexTurnInterruptOptions = {
  discard?: boolean
}

export type CodexTurnMutationResult =
  | CodexRuntimeOk
  | CodexRuntimeFailure

export type CodexThreadForkResult =
  | CodexRuntimeOk<{ thread: CodexNormalizedThread }>
  | CodexRuntimeFailure

export type CodexSessionResumeResult =
  | CodexRuntimeOk<{ threadId: string; sessionId: string }>
  | CodexRuntimeFailure

export type CodexEventPayload = {
  event: CodexThreadEventPayload
}

export type CodexErrorPayload = {
  message: string
  code?: string
  detail?: unknown
}

export type CodexClosedPayload = {
  reason?: string
}
