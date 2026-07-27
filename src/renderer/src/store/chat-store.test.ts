import { describe, expect, it } from 'vitest'
import { useChatStore } from './chat-store'

describe('chat store defaults', () => {
  it('starts new renderer state on Codex', () => {
    expect(useChatStore.getInitialState().activeAgentRuntime).toBe('codex')
  })
})
