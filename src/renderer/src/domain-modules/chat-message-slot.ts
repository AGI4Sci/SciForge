import {
  CHAT_MESSAGE_CONTRACT_VERSION,
  type DomainRendererChatMessageRenderContext,
  type DomainRendererChatMessageValue
} from '@sciforge/domain-sdk/renderer'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { ReactElement } from 'react'
import type { ChatBlock } from '../agent/types'
import { RendererSlotRegistry } from './renderer-slot-registry'
import { copyJsonMetadataFields } from '../lib/json-metadata'

const CHAT_MESSAGE_SLOT = 'chat.message' as const

/** Same ordering and owned registration lifetime as the other renderer slots. */
export class ChatMessageContributionRegistry<View = ReactElement> {
  private readonly slots = new RendererSlotRegistry<{
    [CHAT_MESSAGE_SLOT]: DomainRendererChatMessageValue<View>
  }>()

  register(input: { id: string; ownerId: string; order?: number; contribution: DomainRendererChatMessageValue<View> }): { dispose(): void } {
    return this.slots.register({ ...input, slot: CHAT_MESSAGE_SLOT })
  }

  list(): ReturnType<typeof this.slots.list<typeof CHAT_MESSAGE_SLOT>> {
    return this.slots.list(CHAT_MESSAGE_SLOT)
  }

  resolve(context: DomainRendererChatMessageRenderContext): View | null {
    for (const { contribution } of this.list()) {
      try {
        const body = contribution.render(context)
        if (body !== null && body !== undefined) return body
      } catch {
        // A package display failure cannot hide the original conversation.
      }
    }
    return null
  }

  dispose(): void {
    this.slots.dispose()
  }
}

type MessageBlock = Extract<ChatBlock, { kind: 'user' | 'assistant' }>
type UserBlock = Extract<ChatBlock, { kind: 'user' }>

export type ChatMessagePresentationScope = Readonly<{
  sessionId?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  turnLifecycle?: DomainRendererChatMessageRenderContext['turnLifecycle']
  relatedInput?: UserBlock
}>

/** Project copied JSON metadata, never share mutable Host transcript objects. */
export function createChatMessageRenderContext(
  input: ChatMessagePresentationScope & { block: MessageBlock }
): DomainRendererChatMessageRenderContext {
  const { block, relatedInput, ...scope } = input
  return freezeJson({
    contractVersion: CHAT_MESSAGE_CONTRACT_VERSION,
    ...scope,
    ...(scope.turnLifecycle ? { turnLifecycle: { ...scope.turnLifecycle } } : {}),
    message: {
      id: block.id,
      role: block.kind,
      rawText: block.text,
      ...(block.createdAt ? { createdAt: block.createdAt } : {}),
      ...messageMetadata(block.meta)
    },
    ...(relatedInput ? { relatedInput: {
      id: relatedInput.id,
      rawText: relatedInput.text,
      ...messageMetadata(relatedInput.meta)
    } } : {}),
    streaming: block.kind === 'assistant' && block.id === 'live-assistant'
  })
}

function messageMetadata(meta: MessageBlock['meta']): { metadata?: Record<string, DomainPackageJsonValue> } {
  const metadata = copyJsonMetadataFields(meta)
  return metadata ? { metadata } : {}
}

function freezeJson<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeJson(nested)
    Object.freeze(value)
  }
  return value
}
