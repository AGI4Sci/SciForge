import { codeConversationPageResponseSchema, codeConversationSchema, type CodeConversation } from '@sciforge/collaboration-contracts'

export type SharedConversationProjection = Readonly<{
  projectId: string
  afterSequence: number
  conversations: readonly CodeConversation[]
}>

/** Apply one validated page without mutating the caller's persisted snapshot. */
export function applySharedConversationPage(state: SharedConversationProjection, raw: unknown): SharedConversationProjection {
  const page = codeConversationPageResponseSchema.parse(raw)
  if (page.projectId !== state.projectId) throw new Error('Shared conversation Project mismatch.')
  const conversations = new Map(state.conversations.map(conversation => [conversation.conversationId, structuredClone(conversation)]))
  let sequence = state.afterSequence
  let lastPageSequence = 0
  for (const event of page.events) {
    if (event.projectId !== state.projectId || event.sequence <= lastPageSequence) throw new Error('Invalid shared event ordering.')
    lastPageSequence = event.sequence
    if (event.sequence <= state.afterSequence) continue
    if (event.sequence !== sequence + 1) throw new Error('Shared conversation event gap.')
    const current = conversations.get(event.conversationId)
    if (event.change.kind === 'created') {
      const created = event.change.conversation
      if (current || event.revision !== 1 || created.projectId !== state.projectId ||
          created.conversationId !== event.conversationId || created.revision !== 1) throw new Error('Invalid shared conversation creation.')
      conversations.set(created.conversationId, structuredClone(created))
    } else {
      if (!current || current.revision + 1 !== event.revision) throw new Error('Shared conversation revision gap.')
      if (event.change.kind === 'message') {
        const message = event.change.message
        if (current.messages.some(candidate => candidate.messageId === message.messageId)) throw new Error('Duplicate shared message.')
        current.messages.push(message)
        current.status = 'open'
      } else {
        if (current.messages.at(-1)?.messageId !== event.change.observedMessageId) throw new Error('Shared status message boundary mismatch.')
        current.status = event.change.status
      }
      current.revision = event.revision
      codeConversationSchema.parse(current)
    }
    sequence = event.sequence
  }
  if (page.nextSequence !== (page.events.at(-1)?.sequence ?? state.afterSequence)) throw new Error('Invalid shared page cursor.')
  return { projectId: state.projectId, afterSequence: sequence, conversations: [...conversations.values()] }
}
