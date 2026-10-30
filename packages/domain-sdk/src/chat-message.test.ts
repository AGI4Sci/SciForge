import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAT_MESSAGE_CONTRACT_VERSION,
  RENDERER_CHAT_MESSAGE_CONTRIBUTION_KIND,
  domainRendererChatMessageContractSchema,
  domainRendererChatMessageRenderContextSchema,
  isDomainRendererChatMessageValue
} from './renderer.js'

describe('read-only chat message presentation contract', () => {
  it('versions one body contribution without exposing host blocks or writes', () => {
    assert.equal(RENDERER_CHAT_MESSAGE_CONTRIBUTION_KIND, 'renderer.chat-message')
    assert.deepEqual(domainRendererChatMessageContractSchema.parse({ contractVersion: CHAT_MESSAGE_CONTRACT_VERSION }), { contractVersion: '1.0.0' })
    assert.equal(domainRendererChatMessageContractSchema.safeParse({ contractVersion: '2.0.0' }).success, false)
    assert.equal(domainRendererChatMessageContractSchema.safeParse({ contractVersion: '1.0.0', source: 'specific-domain' }).success, false)
    assert.equal(isDomainRendererChatMessageValue({ render: () => null }), true)
    assert.equal(isDomainRendererChatMessageValue({ render: () => null, sendMessage() {} }), false)
  })

  it('accepts exact message/input identity and JSON metadata but rejects host-private state', () => {
    const context = {
      contractVersion: '1.0.0',
      message: { id: 'output-1', role: 'assistant', rawText: '{"summary":"done"}', metadata: { nested: ['value', 1, null] } },
      relatedInput: { id: 'input-1', rawText: 'original prompt', metadata: { source: 'fixture.task' } },
      runtimeId: 'runtime-1', threadId: 'thread-1', turnId: 'turn-1', sessionId: 'session-1',
      streaming: false,
      turnLifecycle: { phase: 'settled', revision: '1', isLatest: true }
    }
    assert.deepEqual(domainRendererChatMessageRenderContextSchema.parse(context), context)
    assert.equal(domainRendererChatMessageRenderContextSchema.safeParse({ ...context, blocks: [] }).success, false)
    assert.equal(domainRendererChatMessageRenderContextSchema.safeParse({ ...context, message: { ...context.message, metadata: { callback() {} } } }).success, false)
    assert.equal(domainRendererChatMessageRenderContextSchema.safeParse({ ...context, message: { ...context.message, role: 'tool' } }).success, false)
  })
})
