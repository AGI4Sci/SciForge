import { describe, expect, it, vi } from 'vitest'
import { ChatMessageContributionRegistry, createChatMessageRenderContext } from './chat-message-slot'

const context = () => createChatMessageRenderContext({
  block: { kind: 'assistant', id: 'output-1', text: 'untouched output', meta: { approval: { detail: 'original' } } },
  relatedInput: { kind: 'user', id: 'input-1', text: 'untouched input', meta: { source: 'fixture.task' } },
  runtimeId: 'runtime-1', threadId: 'thread-1', turnId: 'turn-1'
})

describe('chat message body contribution registry', () => {
  it('uses declared priority then stable owner/id order and the first non-null body', () => {
    const registry = new ChatMessageContributionRegistry<string>()
    const later = vi.fn(() => 'later')
    registry.register({ id: 'z', ownerId: 'z', order: 20, contribution: { render: later } })
    registry.register({ id: 'b', ownerId: 'a', order: 10, contribution: { render: () => 'chosen' } })
    registry.register({ id: 'a', ownerId: 'a', order: 10, contribution: { render: () => null } })
    expect(registry.resolve(context())).toBe('chosen')
    expect(later).not.toHaveBeenCalled()
  })

  it('isolates failing contributions and falls back after removal/disposal', () => {
    const registry = new ChatMessageContributionRegistry<string>()
    registry.register({ id: 'broken', ownerId: 'a', contribution: { render: () => { throw new Error('render failed') } } })
    const registration = registry.register({ id: 'good', ownerId: 'b', contribution: { render: () => 'body' } })
    expect(registry.resolve(context())).toBe('body')
    registration.dispose()
    registration.dispose()
    expect(registry.resolve(context())).toBeNull()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })

  it('projects only stable JSON message facts and protects nested metadata from mutation', () => {
    const input = { kind: 'user' as const, id: 'input', text: '  raw prompt\n', meta: { source: 'fixture', nested: { items: ['original'] } } }
    const projected = createChatMessageRenderContext({ block: input, relatedInput: input, turnId: 'turn-exact' })
    expect(projected.message.rawText).toBe(input.text)
    expect(projected.relatedInput?.metadata).toEqual(input.meta)
    expect(Object.isFrozen(projected.message.metadata)).toBe(true)
    expect(Object.isFrozen(projected.relatedInput?.metadata?.nested)).toBe(true)
    expect(projected.turnId).toBe('turn-exact')
    expect(projected.runtimeId).toBeUndefined()
    expect(() => Reflect.set(projected.message.metadata!.nested as object, 'items', [])).not.toThrow()
    expect(input.meta.nested.items).toEqual(['original'])
    expect(projected.message.metadata!.nested).toEqual({ items: ['original'] })
  })

  it('keeps valid JSON provenance when optional or non-JSON metadata fields are present', () => {
    const projected = createChatMessageRenderContext({ block: {
      kind: 'user', id: 'input', text: 'original',
      meta: { source: 'fixture.task', ownerRef: 'owner-1', optional: undefined, callback() {} }
    } })
    expect(projected.message.metadata).toEqual({ source: 'fixture.task', ownerRef: 'owner-1' })
  })
})
