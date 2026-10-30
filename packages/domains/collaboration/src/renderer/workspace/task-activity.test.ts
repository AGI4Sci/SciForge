import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DashboardActivityItem } from '@sciforge/collaboration-contracts'
import { taskActivityItems } from './task-activity'

const taskId = 'tsk_activityDelivery01'
const at = '2026-10-21T06:00:00.000Z'
const localTime = new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
function activity(kind: 'delivery' | 'review' | 'adoption', summary: string, sequence: number, targetTaskId = taskId): DashboardActivityItem {
  return {
    schemaVersion: 1, type: 'dashboard_activity_item', revision: sequence, createdAt: at, updatedAt: at,
    public: true, actorDisplayName: null,
    event: { schemaVersion: 1, type: 'public_activity_event', projectId: 'prj_activityDelivery01',
      taskId: targetTaskId, eventId: `evt_activityDelivery${sequence}`, sequence, kind, payload: { summary },
      occurredAt: at, revision: sequence, createdAt: at, updatedAt: at }
  }
}

describe('task activity from the canonical Cloud dashboard', () => {
  it('shows committed delivery versions, revision and adoption text in authority order', () => {
    const events = [activity('delivery', '第 1 版已提交', 1), activity('review', '负责人要求返修', 2),
      activity('delivery', '第 2 版已提交', 3), activity('adoption', '已采纳', 4)]
    assert.deepEqual(taskActivityItems(events, taskId), [
      { actor: '系统', text: '第 1 版已提交', time: localTime, event: true },
      { actor: '系统', text: '负责人要求返修', time: localTime, event: true },
      { actor: '系统', text: '第 2 版已提交', time: localTime, event: true },
      { actor: '系统', text: '已采纳', time: localTime, event: true }
    ])
  })

  it('formats authority UTC timestamps in the member’s local timezone', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      const [item] = taskActivityItems([activity('delivery', '第 1 版已提交', 1)], taskId)
      assert.match(item.time, /14:00$/u)
      assert.equal(item.time, new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('does not synthesize events or display another task’s activity', () => {
    assert.deepEqual(taskActivityItems([], taskId), [])
    assert.deepEqual(taskActivityItems([activity('delivery', '第 1 版已提交', 1, 'tsk_otherDelivery01')], taskId), [])
  })
})
