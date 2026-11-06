import type { ReactElement } from 'react'
import { AlertCircle, Check, CircleDot, FileText, GitBranch, Image as ImageIcon, Layers, MessageSquare, PencilLine, Puzzle, Sparkles, Terminal, Target } from 'lucide-react'
import type { ResearchRecordNode, ResearchRecordReview } from '../research-record-contract'
import { recordNarrativeLayer } from './research-record-presentation'

export type RecordTone = 'neutral' | 'check' | 'active' | 'done'
export type RecordVisualState = Readonly<{ tone: RecordTone; label: string; reason: string }>
/** Color describes recorded process state, never scientific approval. */
export function recordVisualState(node: ResearchRecordNode): RecordVisualState {
  if (['failed', 'error', 'cancelled', 'canceled', 'aborted', 'interrupted'].includes(node.status)) {
    const failed = ['failed', 'error'].includes(node.status)
    return { tone: 'check', label: failed ? '执行失败' : '已取消／中断', reason: '保留原始执行状态与来源；未自动重试。' }
  }
  if (node.synthesis?.entries.some(entry => entry.kind === 'open' && entry.status === 'active')) {
    return { tone: 'check', label: '待核查', reason: '存在有来源的未决问题；查看依据后判断。' }
  }
  if (node.behaviorCounts && (node.behaviorCounts.failed || node.behaviorCounts.cancelled)) {
    return { tone: 'check', label: '含异常记录', reason: '内部存在失败或取消记录；不改变整个轮次的完成状态。' }
  }
  if (node.synthesis?.entries.some(entry => entry.kind === 'negative')) return { tone: 'check', label: '含负例', reason: '负例继续保留；不等于已经判定整项研究失败。' }
  if (node.status === 'running') return { tone: 'active', label: node.kind === 'round' ? '推进中' : '执行中', reason: '记录中的执行仍在进行。' }
  if (node.status === 'pending') return { tone: 'neutral', label: '待处理', reason: '记录处于等待状态。' }
  if (['completed', 'success'].includes(node.status) && ['round', 'event'].includes(node.kind)) {
    return { tone: 'done', label: node.kind === 'round' ? '本轮完成' : '执行完成', reason: '执行结束，不代表科研结论已验证。' }
  }
  return { tone: 'neutral', label: '', reason: '' }
}
export function recordReviewTone(item: Pick<ResearchRecordReview['items'][number], 'kind'>): RecordTone {
  return ['open', 'negative', 'model-rejected'].includes(item.kind) ? 'check' : 'neutral'
}
export type RecordOperation = 'phase' | 'round' | 'step' | 'capability' | 'terminal' | 'message' | 'source' | 'human' | 'summary' | 'attention' | 'goal' | 'figure'
export function recordOperation(node: ResearchRecordNode): RecordOperation {
  if (['phase', 'round', 'step'].includes(node.kind)) return node.kind as 'phase' | 'round' | 'step'
  if (recordNarrativeLayer(node) === 'capability') return 'capability'
  if (['capability', 'event'].includes(node.kind) && node.title === 'command_execution') return 'terminal'
  if (['capability', 'event'].includes(node.kind) && ['user_message', 'assistant_message', 'user-message', 'assistant-message'].includes(node.title)) return 'message'
  if (['image', 'image_generation', 'image-generation', 'image_file'].includes(node.title)) return 'figure'
  return 'source'
}
export function RecordOperationIcon({ kind }: { kind: RecordOperation }): ReactElement {
  const Icon = { phase: Layers, round: CircleDot, step: GitBranch, capability: Puzzle, terminal: Terminal, message: MessageSquare,
    source: FileText, human: PencilLine, summary: Sparkles, attention: AlertCircle, goal: Target, figure: ImageIcon }[kind]
  return <Icon size={14} className="record-operation-icon" aria-hidden="true" />
}
export function RecordStatus({ value }: { value: RecordVisualState }): ReactElement | null {
  if (!value.label) return null
  const Icon = value.tone === 'check' ? AlertCircle : value.tone === 'done' ? Check : CircleDot
  return <span className="record-status" data-record-tone={value.tone} title={value.reason}><Icon size={12} aria-hidden="true" />{value.label}</span>
}
