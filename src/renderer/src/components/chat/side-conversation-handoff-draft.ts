import type { SideConversation } from '../../store/chat-store-types'

/** Start with an actual answer. The user edits it before making it a main-chat input. */
export function sideConversationHandoffDraft(side: SideConversation): string {
  const answer = [...side.blocks].reverse().find(block => block.kind === 'assistant')
  const result = answer?.kind === 'assistant' ? answer.text : ''
  const questions = side.blocks.filter(block => block.kind === 'user').map(block => block.text)
  const quoted: string[] = []
  let remaining = 12000
  for (const question of [...questions].reverse()) {
    if (question.length > remaining) break
    quoted.unshift(question); remaining -= question.length
  }
  const references = [...new Set(side.context?.sourceRefs?.flatMap(ref => {
    const label = readableLabel(ref.label, [ref.threadId, ref.turnId, ref.itemId])
    const uri = readableLocation(ref.uri)
    const source = label && uri && label !== uri ? `${label} (${uri})` : label || uri
    return source ? [`- ${source}`] : []
  }) ?? [])]
  return [
    result || '请填写要带回主对话的内容。',
    ...(quoted.length ? ['', '你的问题与补充：', '', ...quoted] : []),
    ...(quoted.length < questions.length ? ['部分用户消息未带入，请回看讨论并补齐关键条件。', ''] : []),
    ...(side.context || references.length ? ['', '参考：'] : []),
    ...(side.context ? [`- 讨论范围：${side.context.title}`] : []), ...references
  ].join('\n')
}

function readableLabel(value: string, identities: Array<string | undefined>): string {
  const label = value.trim()
  if (!label || identities.includes(label) || label.startsWith('{') || label.startsWith('[') ||
    /^(?:[\w.-]+[:_])*[a-f\d-]{16,}$/i.test(label)) return ''
  return label.replace(/\s+/g, ' ')
}

/** Opaque source URIs remain in the structured handoff, never in the editable prose. */
function readableLocation(value: string | undefined): string {
  const uri = value?.trim() ?? ''
  if (!uri || /[\r\n]/.test(uri)) return ''
  if (/^(?:https?:|file:)/i.test(uri)) {
    try {
      const parsed = new URL(uri)
      return parsed.protocol === 'file:' || parsed.hostname ? uri : ''
    } catch { return '' }
  }
  if (/[{}[\]]/.test(uri)) return ''
  return /^(?:[a-z]:[\\/]|\/|\\\\|\.\.?[\\/]|~[\\/])/i.test(uri) ||
    /^[^\s:]+[\\/].+$/.test(uri) ? uri : ''
}
