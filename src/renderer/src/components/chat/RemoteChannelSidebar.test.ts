import { describe, expect, it } from 'vitest'
import type { RemoteChannelV1 } from '@shared/app-settings'
import { conversationRuntimeId } from './RemoteChannelSidebar'

type RemoteConversation = RemoteChannelV1['conversations'][number]

describe('RemoteChannelSidebar runtime mapping', () => {
  it('falls back new unmapped conversations to Codex', () => {
    const channel = { runtimeId: undefined } as unknown as RemoteChannelV1
    const conversation = { runtimeId: undefined } as unknown as RemoteConversation

    expect(conversationRuntimeId(channel, conversation)).toBe('codex')
  })

  it('preserves an explicit legacy SciForge mapping for read-only display', () => {
    const channel = { runtimeId: 'codex' } as unknown as RemoteChannelV1
    const conversation = { runtimeId: 'sciforge' } as unknown as RemoteConversation

    expect(conversationRuntimeId(channel, conversation)).toBe('sciforge')
  })
})
