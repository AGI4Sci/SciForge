import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldSendZulipNotification } from './notifications.js'

describe('Zulip notification filtering', () => {
  it('allows only bounded human-attention categories', () => {
    assert.equal(shouldSendZulipNotification({
      kind: 'personal.final_reply',
      targetUserId: 'user-a',
      content: '完成。'
    }), true)
    assert.equal(shouldSendZulipNotification({
      kind: 'human.needed',
      targetUserId: 'user-b',
      content: '请选择数据集。'
    }), true)
    assert.equal(shouldSendZulipNotification({
      kind: 'task.progress',
      targetUserId: 'user-a',
      content: '50%'
    }), false)
    assert.equal(shouldSendZulipNotification({
      kind: 'tool.log',
      targetUserId: 'user-a',
      content: 'command output'
    }), false)
    assert.equal(shouldSendZulipNotification({
      kind: 'approval.allowed',
      targetUserId: 'user-a',
      content: 'approval',
      remoteApprovalAllowed: false
    }), false)
  })
})
