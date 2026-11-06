import type { SideConversation } from '../../store/chat-store-types'

/** Start with an actual answer. The user edits it before making it a main-chat input. */
export function sideConversationHandoffDraft(side: SideConversation): string {
  const answer = [...side.blocks].reverse().find(block => block.kind === 'assistant')
  const result = answer?.kind === 'assistant' ? answer.text : ''
  const references = [...new Set(side.context?.sourceRefs?.flatMap(ref => {
    const label = readableLabel(ref.label, [ref.threadId, ref.turnId, ref.itemId])
    const uri = readableLocation(ref.uri)
    const source = label && uri && label !== uri ? `${label} (${uri})` : label || uri
    return source ? [`- ${source}`] : []
  }) ?? [])]
  return [
    `# ${side.title}`, '', '## 讨论成果（发送前请核对）', '',
    result || '请填写要交给主对话的结论或建议。', '', '## 待验证与下一步', '',
    '请补充尚未验证的部分和希望主对话继续完成的事项。', '', '## 来源', '',
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
