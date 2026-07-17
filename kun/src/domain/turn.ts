import type {
  GuiPlanContextJson,
  Turn,
  BashCommandPolicyJson,
  FilePathPolicyJson,
  TurnFileAttachmentJson,
  TurnReasoningEffort,
  TurnStatus
} from '../contracts/turns.js'
import type { ThreadMode } from '../contracts/threads.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { TurnItem } from '../contracts/items.js'

export type TurnEntity = Turn

export function createTurnRecord(input: {
  id: string
  threadId: string
  prompt: string
  model?: string
  reasoningEffort?: TurnReasoningEffort
  attachmentIds?: string[]
  attachments?: TurnFileAttachmentJson[]
  guiPlan?: GuiPlanContextJson
  remoteTargetId?: string
  mode?: ThreadMode
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  allowedToolNames?: string[]
  allowedMcpServerIds?: string[]
  bashCommandPolicy?: BashCommandPolicyJson
  filePathPolicy?: FilePathPolicyJson
  strictAllowedToolNames?: boolean
  createdAt?: string
  status?: TurnStatus
}): TurnEntity {
  const model = input.model?.trim()
  const reasoningEffort = normalizeReasoningEffort(input.reasoningEffort)
  const allowedToolNames = normalizeAllowedToolNames(input.allowedToolNames)
  const allowedMcpServerIds = normalizeAllowedToolNames(input.allowedMcpServerIds)
  return {
    id: input.id,
    threadId: input.threadId,
    status: input.status ?? 'queued',
    prompt: input.prompt,
    steering: [],
    items: [],
    attachmentIds: [...(input.attachmentIds ?? [])],
    attachments: [...(input.attachments ?? [])],
    activeSkillIds: [],
    injectedMemoryIds: [],
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(input.guiPlan ? { guiPlan: input.guiPlan } : {}),
    ...(input.remoteTargetId?.trim() ? { remoteTargetId: input.remoteTargetId.trim() } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
    ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
    ...(allowedToolNames !== undefined ? { allowedToolNames } : {}),
    ...(allowedMcpServerIds !== undefined ? { allowedMcpServerIds } : {}),
    ...(input.bashCommandPolicy ? { bashCommandPolicy: input.bashCommandPolicy } : {}),
    ...(input.filePathPolicy ? { filePathPolicy: input.filePathPolicy } : {}),
    ...(input.strictAllowedToolNames !== undefined ? { strictAllowedToolNames: input.strictAllowedToolNames } : {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

function normalizeReasoningEffort(effort: TurnReasoningEffort | undefined): TurnReasoningEffort | undefined {
  return effort && effort !== 'auto' ? effort : undefined
}

function normalizeAllowedToolNames(names: string[] | undefined): string[] | undefined {
  if (names === undefined) return undefined
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
}

export function appendTurnItem(turn: TurnEntity, item: TurnItem): TurnEntity {
  if (turn.items.some((existing) => existing.id === item.id)) {
    return {
      ...turn,
      items: turn.items.map((existing) => (existing.id === item.id ? item : existing))
    }
  }
  return { ...turn, items: [...turn.items, item] }
}

export function replaceTurnItem(
  turn: TurnEntity,
  itemId: string,
  patch: Partial<TurnItem>
): TurnEntity {
  return {
    ...turn,
    items: turn.items.map((existing) =>
      existing.id === itemId ? ({ ...existing, ...patch } as TurnItem) : existing
    )
  }
}

export function startTurn(turn: TurnEntity, startedAt?: string): TurnEntity {
  return {
    ...turn,
    status: 'running',
    startedAt: startedAt ?? new Date().toISOString()
  }
}

export function finishTurn(
  turn: TurnEntity,
  status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>,
  finishedAt?: string
): TurnEntity {
  return {
    ...turn,
    status,
    finishedAt: finishedAt ?? new Date().toISOString(),
    steering: []
  }
}
