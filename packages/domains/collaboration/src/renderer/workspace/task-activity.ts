import type { DashboardActivityItem } from '@sciforge/collaboration-contracts'
import { formatWorkspaceTime } from './format-time.js'

/** The same typed Cloud activity projection is used by task details and source previews. */
export function taskActivityItems(activity: readonly DashboardActivityItem[], taskId: string) {
  return activity.filter((item) => item.event.taskId === taskId).map((item) => ({
    actor: item.actorDisplayName ?? '系统',
    text: 'summary' in item.event.payload ? item.event.payload.summary : '协作状态已更新',
    time: formatWorkspaceTime(item.event.occurredAt),
    event: item.event.kind !== 'comment' && item.event.kind !== 'mention'
  }))
}
