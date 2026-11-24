import type { DomainWorkbenchSideConversationContext } from '@sciforge/domain-sdk/host'
import type { SideConversation } from './chat-store-types'

export type DiscussionHandoffDraft = {
  document: string
  memory: string
  instruction: string
  preserve?: string
  verification?: string
  basis?: string
}
export type DiscussionCheckpoint = {
  threadId: string
  runtimeId: NonNullable<SideConversation['runtimeId']>
  parentThreadId: string
  workspaceRoot?: string
  title: string
  createdAt: string
  context: DomainWorkbenchSideConversationContext
  input: string
  handoffDraft?: DiscussionHandoffDraft
  handedOffBasis?: string
  handoffPending?: string
}

const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Private UI drafts in the existing chat-session envelope; never execution or approval authority. */
export function normalizeDiscussionCheckpoints(value: unknown): Record<string, DiscussionCheckpoint> {
  if (!record(value)) return {}
  const result: Record<string, DiscussionCheckpoint> = Object.create(null)
  let size = 0
  for (const [id, entry] of Object.entries(value)) {
    if (!record(entry) || id !== entry.threadId || !bounded(id, 512) || !id ||
      !['codex', 'claude', 'dsh'].includes(String(entry.runtimeId)) ||
      !bounded(entry.parentThreadId, 512) || !entry.parentThreadId || entry.parentThreadId === id ||
      !bounded(entry.title, 4000) || !bounded(entry.createdAt, 100) ||
      !bounded(entry.input, 8000) || (entry.workspaceRoot !== undefined && !bounded(entry.workspaceRoot, 4000))) continue
    const context = entry.context
    if (!record(context) || !bounded(context.id, 4000) || !context.id || !bounded(context.title, 4000) ||
      !bounded(context.text, 40000)) continue
    const refs = context.sourceRefs
    if (refs !== undefined && (!Array.isArray(refs) || refs.length > 100 || refs.some(ref => !record(ref) ||
      !bounded(ref.label, 4000) || ['uri', 'threadId', 'turnId', 'itemId'].some(key => ref[key] !== undefined && !bounded(ref[key], 12000))))) continue
    const rawDraft = entry.handoffDraft
    if (rawDraft !== undefined && (!record(rawDraft) || !bounded(rawDraft.document, 60000) ||
      !bounded(rawDraft.memory, 8000) || !bounded(rawDraft.instruction, 8000) ||
      ['preserve', 'verification'].some(key => rawDraft[key] !== undefined && !bounded(rawDraft[key], 8000)) ||
      (rawDraft.basis !== undefined && !bounded(rawDraft.basis, 200000)))) continue
    if (entry.handedOffBasis !== undefined && !bounded(entry.handedOffBasis, 300000)) continue
    if (entry.handoffPending !== undefined && !bounded(entry.handoffPending, 300000)) continue
    const checkpoint: DiscussionCheckpoint = {
      threadId: id, runtimeId: entry.runtimeId as DiscussionCheckpoint['runtimeId'],
      parentThreadId: entry.parentThreadId, title: entry.title, createdAt: entry.createdAt,
      ...(entry.workspaceRoot ? { workspaceRoot: entry.workspaceRoot as string } : {}),
      context: { id: context.id, title: context.title, text: context.text,
        ...(refs ? { sourceRefs: (refs as Record<string, string>[]).map(ref => ({ label: ref.label,
          ...Object.fromEntries(['uri', 'threadId', 'turnId', 'itemId'].flatMap(key => ref[key] === undefined ? [] : [[key, ref[key]]])) })) } : {}) },
      input: entry.input,
      ...(rawDraft ? { handoffDraft: { document: rawDraft.document as string, memory: rawDraft.memory as string,
        instruction: rawDraft.instruction as string,
        ...Object.fromEntries(['preserve', 'verification', 'basis'].flatMap(key => rawDraft[key] === undefined ? [] : [[key, rawDraft[key]]])) } } : {}),
      ...(entry.handedOffBasis ? { handedOffBasis: entry.handedOffBasis as string } : {}),
      ...(entry.handoffPending ? { handoffPending: entry.handoffPending as string } : {})
    }
    const length = JSON.stringify(checkpoint).length
    if (Object.keys(result).length >= 24 || size + length > 1_400_000) break
    result[id] = checkpoint; size += length
  }
  return result
}

export function checkpointDiscussions(sides: Record<string, SideConversation>, previous: Record<string, DiscussionCheckpoint>): Record<string, DiscussionCheckpoint> {
  let next = previous
  for (const side of Object.values(sides)) {
    if (!side.context || !side.runtimeId || (side.source ?? 'side') !== 'side') continue
    const current = previous[side.threadId]
    if (current && current.runtimeId === side.runtimeId && current.parentThreadId === side.parentThreadId &&
      current.workspaceRoot === side.workspaceRoot && current.title === side.title && current.context === side.context &&
      current.input === side.input && current.handoffDraft === side.handoffDraft && current.handedOffBasis === side.handedOffBasis && current.handoffPending === side.handoffPending) continue
    const entry = { threadId: side.threadId, runtimeId: side.runtimeId, parentThreadId: side.parentThreadId,
      title: side.title, createdAt: side.createdAt, workspaceRoot: side.workspaceRoot,
      context: side.context, input: side.input, handoffDraft: side.handoffDraft, handedOffBasis: side.handedOffBasis, handoffPending: side.handoffPending }
    const rest = { ...next }; delete rest[side.threadId]
    next = { [side.threadId]: entry, ...rest }
  }
  return next
}

/** Exact equality detects edits and new turns. This string is an edit guard, never a permission proof. */
export function discussionBasis(side: SideConversation): string {
  return JSON.stringify([side.runtimeId, side.parentThreadId, side.workspaceRoot, side.context,
    side.blocks.filter(block => block.kind === 'assistant' || block.kind === 'user').map(block => [block.id, block.text])])
}

export function discussionHandoffKey(draft: DiscussionHandoffDraft): string {
  return JSON.stringify([draft.document, draft.memory, draft.instruction, draft.preserve ?? '', draft.verification ?? '', draft.basis ?? ''])
}
