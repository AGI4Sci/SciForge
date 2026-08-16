export const ZULIP_NOTIFICATION_KINDS = [
  'personal.user_message',
  'personal.final_reply',
  'human.needed',
  'approval.allowed',
  'failure.important',
  'summary.milestone',
  'summary.final',
  'task.progress',
  'agent.heartbeat',
  'tool.log',
  'agent.reasoning',
  'agent.internal'
] as const

export type ZulipNotificationKind = typeof ZULIP_NOTIFICATION_KINDS[number]

const HUMAN_ATTENTION_KINDS = new Set<ZulipNotificationKind>([
  'personal.user_message',
  'personal.final_reply',
  'human.needed',
  'approval.allowed',
  'failure.important',
  'summary.milestone',
  'summary.final'
])

export type ZulipNotification = {
  kind: ZulipNotificationKind
  targetUserId: string
  content: string
  remoteApprovalAllowed?: boolean
}

export function shouldSendZulipNotification(notification: ZulipNotification): boolean {
  if (!notification.targetUserId.trim() || !notification.content.trim()) return false
  if (notification.kind === 'approval.allowed') return notification.remoteApprovalAllowed === true
  return HUMAN_ATTENTION_KINDS.has(notification.kind)
}
