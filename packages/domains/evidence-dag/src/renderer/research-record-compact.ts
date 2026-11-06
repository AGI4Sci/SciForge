import type { ResearchRecordNode } from '../research-record-contract'

export const recordKindLabels = { phase: '阶段', round: '轮次', step: '步骤', capability: '工具组', event: '来源' }
const names: Record<string, string> = { user_message: '用户要求', 'user-message': '用户要求', assistant_message: '助手说明', 'assistant-message': '助手说明', command_execution: '终端执行', tool_call: '工具调用' }
/** Short display only. Never mutate the source or infer an unrecorded result. */
export function compactRecord(node: ResearchRecordNode) {
  const entries = (node.synthesis?.entries ?? []).filter(entry => entry.membership !== 'historical')
  const progress = [...entries].reverse().find(entry => entry.kind === 'progress')
  const negative = node.summaryProjection?.negative ?? node.concernCounts?.negative ?? entries.filter(entry => entry.kind === 'negative').length
  const open = node.summaryProjection?.open ?? node.concernCounts?.open ?? entries.filter(entry => entry.kind === 'open' && entry.status === 'active').length
  const failed = node.behaviorCounts?.failed ?? (['failed', 'error'].includes(node.status) ? 1 : 0)
  const cancelled = node.behaviorCounts?.cancelled ?? (['cancelled', 'canceled', 'aborted', 'interrupted'].includes(node.status) ? 1 : 0)
  return { title: (names[node.title] ?? node.title) || '未命名记录', summary: (progress?.text ?? node.summary).replace(/\s+/g, ' ').trim(),
    alerts: [!node.behaviorCounts && node.counts?.failedRounds ? `失败/中断轮次 ${node.counts.failedRounds}` : '', failed ? `失败 ${failed}` : '', cancelled ? `中断 ${cancelled}` : '', negative ? `负例 ${negative}` : '', open ? `未决 ${open}` : '',
      node.sourceStatus === 'changed' ? '来源变化' : node.sourceStatus === 'unavailable' ? '来源不可读' : '', node.synthesisStatus === 'stale' ? '摘要待更新' : ''].filter(Boolean) }
}
