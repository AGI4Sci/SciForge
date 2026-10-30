import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../locales/zh/common.json'
import { FloatingComposerQueuedMessages } from './FloatingComposerQueuedMessages'
import { FloatingComposerSessionFailure } from './FloatingComposerSessionFailure'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => String(Reflect.get(messages, key) ?? key).replace('{{count}}', String(options?.count ?? '')) })
}))

describe('failed Session input actions', () => {
  const receipt = { clientDirectiveId: 'input', revision: 3, payloadDigest: 'a'.repeat(64), mode: 'direct' as const,
    delivery: 'delivered' as const, execution: 'failed' as const, turnId: 'failed-turn' }
  it('shows reexecute and a Chinese explanation instead of replay for delivered failed input', () => {
    const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[{ id: 'input', text: '原文',
      admissionReceipt: receipt, sendFailure: { message: '本轮执行失败' } }]} onRemove={() => {}} onRetry={() => {}} onReexecute={() => {}} />)
    expect(html).toContain('重新执行')
    expect(html).toContain('新输入')
    expect(html).not.toContain('安全重试')
    expect(html).not.toContain('发送失败 / 未执行')
  })
  it('keeps safe replay for rejected queues and offers neither action for uncertain delivery', () => {
    for (const delivery of ['rejected', 'uncertain'] as const) {
      const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[{ id: 'input', text: '原文',
        admissionReceipt: { ...receipt, mode: 'queue', delivery }, sendFailure: { message: '待处理' } }]} onRemove={() => {}} onRetry={() => {}} onReexecute={() => {}} />)
      expect(html.includes('安全重试')).toBe(delivery === 'rejected')
      expect(html).not.toContain('aria-label="重新执行"')
    }
  })
  it('shows stopped history as a continuation fact with no original-input replay action', () => {
    const html = renderToStaticMarkup(<FloatingComposerSessionFailure
      failure={{ receipt: { ...receipt, execution: 'cancelled' } }} busy={false} onReexecute={() => {}} />)
    expect(html).toContain('本轮已停止')
    expect(html).toContain('直接发送新要求继续')
    expect(html).not.toContain('session-input-reexecute')
    expect(html).not.toContain('queuedMessagesTitle')
  })
  it('shows output validation as a readonly pending state without failure or replay actions', () => {
    const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[{ id: 'input', text: '原文',
      admissionReceipt: { ...receipt, mode: 'queue', execution: 'output_pending' }, sendFailure: { message: 'obsolete' } }]}
      onRemove={() => {}} onEdit={() => {}} onSteer={() => {}} onRetry={() => {}} onReexecute={() => {}} />)
    expect(html).toContain('正在验证结果')
    expect(html).not.toContain('发送失败 / 未执行')
    expect(html).not.toContain('obsolete')
    for (const action of ['queuedMessageEdit', 'queuedMessageSteer', 'queuedMessageRemove', 'queuedMessageRetry', 'queuedMessageReexecute']) {
      expect(html).not.toContain(`aria-label="${Reflect.get(messages, action)}"`)
    }
  })
  it.each(['delivering', 'delivered'] as const)('renders a known %s active input readonly instead of counting it as queued', (delivery) => {
    const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[{ id: 'input', text: '当前任务说明',
      admissionReceipt: { ...receipt, delivery, execution: 'active' }, sendFailure: { message: 'obsolete' } }]}
      onRemove={() => {}} onEdit={() => {}} onSteer={() => {}} onRetry={() => {}} onReexecute={() => {}} />)
    expect(html).toContain('正在执行')
    expect(html).not.toContain('已排队')
    expect(html).not.toContain('obsolete')
    expect(html).not.toContain('发送失败')
    for (const action of ['queuedMessageEdit', 'queuedMessageSteer', 'queuedMessageRemove', 'queuedMessageRetry', 'queuedMessageReexecute']) {
      expect(html).not.toContain(`aria-label="${Reflect.get(messages, action)}"`)
    }
  })
  it.each(['active', 'output_pending'] as const)('counts only the Member queue beside a readonly %s input', (execution) => {
    const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[
      { id: 'current', text: '当前任务说明', admissionReceipt: { ...receipt, execution } },
      { id: 'next', text: '新的成员要求', admissionReceipt: { ...receipt, clientDirectiveId: 'next', mode: 'queue',
        delivery: 'accepted', execution: 'not_started' } }
    ]} onRemove={() => {}} onEdit={() => {}} onSteer={() => {}} onRetry={() => {}} onReexecute={() => {}} />)
    expect(html).toContain('已排队 1 条')
    expect(html).not.toContain('已排队 2 条')
    expect(html).toContain(execution === 'active' ? '正在执行' : '正在验证结果')
    for (const action of ['queuedMessageEdit', 'queuedMessageSteer', 'queuedMessageRemove']) {
      expect(html.match(new RegExp(`aria-label="${Reflect.get(messages, action)}"`, 'g'))).toHaveLength(1)
    }
  })

  it.each(['active', 'output_pending'] as const)('keeps the %s input text in a closed keyboard-accessible disclosure', (execution) => {
    const html = renderToStaticMarkup(<FloatingComposerQueuedMessages messages={[{
      id: 'current', text: '原始任务格式要求', admissionReceipt: { ...receipt, execution }
    }]} onRemove={() => {}} />)
    expect(html).toContain('查看当前输入')
    expect(html).toContain('原始任务格式要求')
    expect(html).toMatch(/<details\b[^>]*><summary\b/)
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:[\s=>])/)
  })

})
