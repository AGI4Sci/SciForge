import type { ReactElement } from 'react'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const CHAT_RESULT_PANEL_SLOT = 'chat.result-panel' as const
export const RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND =
  'renderer.chat-result-panel' as const

export type ChatResultPanelRenderContext = Readonly<{
  blocks: readonly unknown[]
  workspaceRoot?: string
  sessionId?: string
  onContinuePrompt?: (prompt: string) => void
}>

export type ChatResultPanelContribution = Readonly<{
  id: string
  render: (context: ChatResultPanelRenderContext) => ReactElement | null
}>

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
