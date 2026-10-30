import type {
  DomainRendererChatResultPanelRenderContext,
  DomainRendererChatResultPanelValue
} from '@sciforge/domain-sdk/renderer'
import type { ReactElement } from 'react'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const CHAT_RESULT_PANEL_SLOT = 'chat.result-panel' as const
export type ChatResultPanelRenderContext = DomainRendererChatResultPanelRenderContext
export type ChatResultPanelContribution = DomainRendererChatResultPanelValue<ReactElement>

type ChatResultRendererSlots = {
  [CHAT_RESULT_PANEL_SLOT]: ChatResultPanelContribution
}

export type RegisteredChatResultPanelContribution =
  RegisteredRendererSlotContribution<
    ChatResultRendererSlots,
    typeof CHAT_RESULT_PANEL_SLOT
  >

export class ChatResultPanelContributionRegistry {
  private readonly slots = new RendererSlotRegistry<ChatResultRendererSlots>()

  register(input: {
    ownerId: string
    order?: number
    contribution: ChatResultPanelContribution
  }): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: CHAT_RESULT_PANEL_SLOT,
      id: input.contribution.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: input.contribution
    })
  }

  list(): readonly RegisteredChatResultPanelContribution[] {
    return this.slots.list(CHAT_RESULT_PANEL_SLOT)
  }

  dispose(): void {
    this.slots.dispose()
  }
}
