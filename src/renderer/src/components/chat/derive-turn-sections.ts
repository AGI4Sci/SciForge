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
export type TurnConversationBlock = Extract<ChatBlock, { kind: 'assistant' | 'approval' | 'user_input' }>

export type TurnSections = {
  processBlocks: ChatBlock[]
  conversationBlocks: TurnConversationBlock[]
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

function latestUserInputBlockIndexes(blocks: ChatBlock[]): Map<string, number> {
  const latestIndexes = new Map<string, number>()
  for (const [index, block] of blocks.entries()) {
    if (block.kind !== 'user_input') continue
    latestIndexes.set(block.requestId.trim() || block.id, index)
  }
  return latestIndexes
}

/**
 * Pure derivation of a turn's three view slices:
 *  - `processBlocks`: chronological reasoning/tool/compaction
 *    trace, including in-flight assistant output while a turn is processing.
 *  - `conversationBlocks`: assistant content and user-facing interaction cards
 *    that should render directly in the conversation.
 *  - `turnFileChanges`: successful file_change tool blocks whose detail
 *    is a unified diff, with paths normalised for display.
 *
 * Pulled out of `MessageTurn` so the derivation is testable in isolation
 * and the component body stays focused on rendering.
 */
export function deriveTurnSections({
  turn,
  isProcessing,
  liveProcessText,
  liveProcessMeta,
  liveContent,
  workspaceRoot
}: DeriveTurnSectionsInput): TurnSections {
  const processBlocks: ChatBlock[] = []
  const conversationBlocks: TurnConversationBlock[] = []
  let latestAssistantContentBlock: TurnAssistantBlock | null = null
  let renderedAssistantContentCount = 0
  const trailingAssistantStart = isProcessing ? turn.blocks.length : findTrailingAssistantContentStart(turn.blocks)
  const fallbackFinalAssistantId = !isProcessing && trailingAssistantStart === turn.blocks.length
    ? [...turn.blocks].reverse().find((block) => block.kind === 'assistant' && splitThink(block.text).content.trim())?.id
    : undefined
  const latestInputIndexes = latestUserInputBlockIndexes(turn.blocks)

  for (const [index, block] of turn.blocks.entries()) {
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think) {
        processBlocks.push({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        latestAssistantContentBlock = contentBlock
        if (isProcessing || (index < trailingAssistantStart && block.id !== fallbackFinalAssistantId)) {
          processBlocks.push(contentBlock)
        } else {
          conversationBlocks.push(contentBlock)
          renderedAssistantContentCount += 1
        }
      }
      continue
    }
    if (block.kind === 'approval') {
      if (block.status === 'pending') conversationBlocks.push(block)
      continue
    }
    if (isInternalUserInputToolBlock(block)) {
      continue
    }
    if (block.kind === 'user_input' && latestInputIndexes.get(block.requestId.trim() || block.id) !== index) {
      continue
    }
    if (block.kind === 'user_input') {
      conversationBlocks.push(block)
      continue
    }
    if (isProcessBlock(block)) {
      processBlocks.push(block)
    }
  }

  if (!isProcessing && renderedAssistantContentCount === 0 && latestAssistantContentBlock) {
    conversationBlocks.push(latestAssistantContentBlock)
  }

  if (liveProcessText.trim()) {
    processBlocks.push({
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

  return { processBlocks, conversationBlocks, turnFileChanges }
}
