import type { ChatBlock, RuntimeDisclosureMetadata, ToolBlock } from '../../agent/types'
import {
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay,
} from '../../lib/diff-stats'
import {
  findTrailingAssistantContentStart,
  isProcessBlock,
  splitThink,
  type Turn
} from './message-timeline-turns'

export type TurnAssistantBlock = Extract<ChatBlock, { kind: 'assistant' }>
export type TurnConversationBlock = Extract<ChatBlock, { kind: 'assistant' | 'approval' | 'user' | 'user_input' }>

export type TurnTimelineSection =
  | { kind: 'process'; blocks: ChatBlock[] }
  | { kind: 'conversation'; block: TurnConversationBlock }
  | { kind: 'result'; block: ChatBlock }

export type TurnSections = {
  timeline: TurnTimelineSection[]
  turnFileChanges: ToolBlock[]
}

type ResolvedFileChangeBlock = ToolBlock & {
  detail: string
  filePath: string
}

type DeriveTurnSectionsInput = {
  turn: Turn
  isProcessing: boolean
  liveProcessText: string
  liveProcessMeta?: RuntimeDisclosureMetadata | null
  liveContent: string
  workspaceRoot: string
}

function fileChangeGroupKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function mergeFileChangeBlocks(changes: ResolvedFileChangeBlock[]): ToolBlock[] {
  const merged: ResolvedFileChangeBlock[] = []
  const indexByPath = new Map<string, number>()

  for (const change of changes) {
    const key = fileChangeGroupKey(change.filePath)
    const existingIndex = indexByPath.get(key)
    if (existingIndex === undefined) {
      indexByPath.set(key, merged.length)
      merged.push(change)
      continue
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...existing,
      detail: [existing.detail, change.detail].filter(Boolean).join('\n\n')
    }
  }

  return merged
}

function isInternalUserInputToolBlock(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  if (toolName === 'request_user_input' || toolName === 'user_input') return true
  return /^(request_user_input|user_input)\s*:/i.test(block.summary.trim())
}

/** Updates replace an item's value at its first position, including history replay. */
export function stableTimelineItems(blocks: ChatBlock[]): ChatBlock[] {
  const positions = new Map<string, number>()
  const items: ChatBlock[] = []
  for (const block of blocks) {
    const key = block.kind === 'user_input' ? `input:${block.requestId.trim() || block.id}` : `item:${block.id}`
    const position = positions.get(key)
    if (position === undefined) {
      positions.set(key, items.length)
      items.push(block)
    } else {
      items[position] = block
    }
  }
  return items
}

/** Preserve source-item anchors independently of process disclosure and modality. */
export function deriveTurnSections({
  turn,
  isProcessing,
  liveProcessText,
  liveProcessMeta,
  liveContent,
  workspaceRoot
}: DeriveTurnSectionsInput): TurnSections {
  const timeline: TurnTimelineSection[] = []
  const pushProcess = (block: ChatBlock): void => {
    timeline.push({ kind: 'process', blocks: [block] })
  }
  const pushConversation = (block: TurnConversationBlock): void => {
    timeline.push({ kind: 'conversation', block })
  }
  const items = stableTimelineItems(turn.blocks)
  const trailingAssistantStart = isProcessing ? items.length : findTrailingAssistantContentStart(items)
  const fallbackFinalAssistantId = !isProcessing && trailingAssistantStart === items.length
    ? [...items].reverse().find((block) => block.kind === 'assistant' && splitThink(block.text).content.trim())?.id
    : undefined

  for (const [index, block] of items.entries()) {
    if (block.kind === 'user') {
      pushConversation(block)
      continue
    }
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think && !(isProcessing && liveProcessText.trim())) {
        pushProcess({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        if (isProcessing || (index < trailingAssistantStart && block.id !== fallbackFinalAssistantId)) {
          pushProcess(contentBlock)
        } else {
          pushConversation(contentBlock)
        }
      }
      continue
    }
    if (block.kind === 'approval') {
      if (block.status === 'pending') pushConversation(block)
      continue
    }
    if (isInternalUserInputToolBlock(block)) {
      continue
    }
    if (block.kind === 'user_input') {
      pushConversation(block)
      continue
    }
    if (isProcessBlock(block)) {
      pushProcess(block)
    } else {
      timeline.push({ kind: 'result', block })
    }
  }

  if (liveProcessText.trim()) {
    pushProcess({
      kind: 'reasoning',
      id: 'live-reasoning',
      text: liveProcessText,
      ...(liveProcessMeta ? { meta: liveProcessMeta } : {})
    })
  }

  const turnFileChanges: ToolBlock[] = isProcessing
    ? []
    : mergeFileChangeBlocks(turn.blocks.flatMap((block): ResolvedFileChangeBlock[] => {
        if (
          !(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')
        ) {
          return []
        }

        const detailText = extractUnifiedDiffText(block.detail)
        if (!detailText) return []

        const resolvedFilePath = formatFilePathForDisplay(
          extractDiffFilePath(detailText, block.filePath),
          workspaceRoot
        )
        if (!resolvedFilePath) return []

        return [{ ...block, detail: detailText, filePath: resolvedFilePath }]
      }))

  return { timeline, turnFileChanges }
}
