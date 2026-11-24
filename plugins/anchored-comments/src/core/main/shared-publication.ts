import { codeConversationPublishSchema, codeConversationMessageInputSchema } from '@sciforge/collaboration-contracts'
import type { AnchoredCommentThread } from '../contract.js'

/** Explicit projection: no local capture, workspace, drafts or window state crosses this boundary. */
export function sharedPublicationOf(thread: AnchoredCommentThread, input: Readonly<{
  projectId: string
  requestId: string
  idempotencyKey: string
  messageIds: readonly string[]
}>) {
  if (!thread.anchor.codeAnchor) throw new Error('Only frozen code conversations can be published.')
  if (thread.anchorResolution === 'needs_retargeting') throw new Error('Retarget stale code before publishing.')
  if (thread.fork) throw new Error('Publish a shared fork from its shared parent message.')
  const selected = new Set(input.messageIds)
  if (selected.size !== input.messageIds.length || selected.size === 0) throw new Error('Select unique messages to publish.')
  const messages = thread.messages.filter(message => selected.has(message.id)).map(message => {
    if (message.authorKind === 'system') throw new Error('System messages cannot be published.')
    return codeConversationMessageInputSchema.parse({ messageId: message.id, kind: message.authorKind, body: message.body })
  })
  if (messages.length !== selected.size) throw new Error('Publication selection contains an unknown message.')
  const anchor = thread.anchor.codeAnchor
  return codeConversationPublishSchema.parse({
    protocolVersion: '1.0', type: 'project.code_conversation.publish',
    projectId: input.projectId, requestId: input.requestId, idempotencyKey: input.idempotencyKey,
    conversationId: thread.id,
    anchor: { filePath: anchor.filePath, side: anchor.side, line: anchor.line,
      ...(anchor.endLine === undefined ? {} : { endLine: anchor.endLine }), hunkHeader: anchor.hunkHeader,
      code: anchor.code, baseRevision: anchor.baseRevision, contentDigest: anchor.contentDigest },
    messages
  })
}
