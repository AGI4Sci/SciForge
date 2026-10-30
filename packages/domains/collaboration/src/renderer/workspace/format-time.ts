/** Dates shown together in task activity, delivery provenance and snapshots use the viewer's timezone. */
export function formatWorkspaceTime(value: string): string {
  if (!value) return '时间待同步'
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
