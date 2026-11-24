import { translateWorkspace } from './workspace-i18n.js'
import type { DashboardActivityItem } from '@sciforge/collaboration-contracts'
import { formatWorkspaceTime } from './format-time.js'
import { localizeActivityText } from './activity-messages.js'

/** The same typed Cloud activity projection is used by task details and source previews. */
export function taskActivityItems(activity: readonly DashboardActivityItem[], taskId: string) {
  return activity.filter((item) => item.event.taskId === taskId).map((item) => ({
    actor: item.actorDisplayName?.trim() || translateWorkspace(item.event.kind === 'comment' || item.event.kind === 'mention' ? '成员（作者未记录）' : '系统'),
    text: 'summary' in item.event.payload ? localizeActivityText(item.event.payload.summary) : translateWorkspace('协作状态已更新'),
    time: formatWorkspaceTime(item.event.occurredAt),
    event: item.event.kind !== 'comment' && item.event.kind !== 'mention'
  }))
}
