import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionInputReceipt } from '@sciforge/domain-sdk/agent-execution'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { MessageTimeline } from './MessageTimeline'

const text = '阅读右侧注释，优化报告'
const receipt: SessionInputReceipt = {
  clientDirectiveId: 'original-input', revision: 1, payloadDigest: 'a'.repeat(64),
  mode: 'direct', delivery: 'delivered', execution: 'active', turnId: 'turn-A'
}

function renderSession(threadId: string, queuedMessages: QueuedUserMessage[] = []): string {
  return renderToStaticMarkup(<MessageTimeline
    blocks={[{ id: 'runtime-user-id', kind: 'user', text, turnId: 'turn-A' }]}
    activeThreadId={threadId} queuedMessages={queuedMessages}
    live="" liveReasoning="" runtimeConnection="ready"
    onRetryConnection={() => {}} onOpenSettings={() => {}}
  />)
}

describe('Session queue hydration in the conversation timeline', () => {
  it.each([
    ['delivering', 'active'], ['delivered', 'active'], ['delivered', 'output_pending']
  ] as const)('does not append the original input after switching back with %s / %s', (delivery, execution) => {
    expect(renderSession('A').split(text)).toHaveLength(2)
    renderSession('B')
    const html = renderSession('A', [{ id: receipt.clientDirectiveId, text,
      admissionReceipt: { ...receipt, delivery, execution } }])
    expect(html.split(text)).toHaveLength(2)
  })

  it('preserves an intentionally queued identical follow-up without deduplicating by text', () => {
    const html = renderSession('A', [
      { id: receipt.clientDirectiveId, text, admissionReceipt: receipt },
      { id: 'follow-up', text, admissionReceipt: { ...receipt, clientDirectiveId: 'follow-up',
        mode: 'queue', delivery: 'accepted', execution: 'not_started' } }
    ])
    expect(html.split(text)).toHaveLength(3)
  })

  it('preserves an uncertain delivery for reconciliation', () => {
    const html = renderSession('A', [{ id: receipt.clientDirectiveId, text: 'unresolved input',
      admissionReceipt: { ...receipt, delivery: 'uncertain' } }])
    expect(html).toContain('unresolved input')
  })

  it('does not append either input when a queued follow-up has joined the active turn', () => {
    const followUpText = '本文的评测任务是什么，怎么构建的评测集？'
    const html = renderToStaticMarkup(<MessageTimeline
      blocks={[
        { id: 'runtime-user-id', kind: 'user', text, turnId: 'turn-A' },
        { id: 'follow-up', kind: 'user', text: followUpText, turnId: 'turn-A' }
      ]}
      activeThreadId="A" queuedMessages={[
        { id: receipt.clientDirectiveId, text, admissionReceipt: receipt },
        { id: 'follow-up', text: followUpText,
          admissionReceipt: { ...receipt, clientDirectiveId: 'follow-up', mode: 'queue' } }
      ]}
      live="Working" liveReasoning="" busyOverride runtimeConnection="ready"
      onRetryConnection={() => {}} onOpenSettings={() => {}}
    />)
    expect(html.split(text)).toHaveLength(2)
    expect(html.split(followUpText)).toHaveLength(2)
  })
})
