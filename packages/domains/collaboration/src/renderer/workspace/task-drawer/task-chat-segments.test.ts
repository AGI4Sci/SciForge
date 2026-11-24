import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskChatAssociation } from '../../../chat-association-contract.js'
import { taskChatSegments } from './task-chat-segments.js'
const row = (messageId: string, changes: Partial<TaskChatAssociation> = {}): TaskChatAssociation => ({ userId: 'user', projectId: 'project', taskId: 'task', runtimeId: 'runtime', threadId: 'chat', messageId, occurredAt: `2026-11-09T00:00:0${messageId}Z`, ...changes })
test('groups repeated messages, keeps interleaved chats independent, and splits explicit ends', () => {
  const groups = taskChatSegments([row('1'), row('2', { threadId: 'other' }), row('3', { endedAt: '2026-11-09T00:00:04Z' }), row('4')])
  assert.equal(groups.length, 3)
  assert.deepEqual(groups.map(group => [group.first.messageId, group.last.messageId, group.messageCount]), [['4', '4', 1], ['1', '3', 2], ['2', '2', 1]])
})
test('different task or runtime never merges into one segment', () => {
  assert.equal(taskChatSegments([row('1'), row('2', { taskId: 'second' }), row('3'), row('4', { runtimeId: 'second-runtime' })]).length, 4)
})
