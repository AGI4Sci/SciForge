import type { DiscussionPort } from '../../ports/discussion'
import type { z } from 'zod'
import { anchoredCommentReplyInputSchema, type anchoredCommentReplyResultSchema } from '../contract'
import { buildConversationContext } from '../conversation-context'
import type { AnchoredCommentService } from './comment-service'

export class AnchoredConversationService {
  private disposed = false
  private readonly active = new Map<string, { requestId: string; controller: AbortController }>()

  constructor(private readonly comments: AnchoredCommentService, private readonly execution?: DiscussionPort) {}

  cancel(threadId: string, requestId: string): boolean {
    const active = this.active.get(threadId)
    if (!active || active.requestId !== requestId) return false
    active.controller.abort()
    return true
  }

  dispose(): void {
    this.disposed = true
    for (const active of this.active.values()) active.controller.abort()
  }

  async reply(input: z.infer<typeof anchoredCommentReplyInputSchema>): Promise<z.infer<typeof anchoredCommentReplyResultSchema>> {
    if (this.disposed) throw new Error('Conversation lifecycle ended.')
    const request = anchoredCommentReplyInputSchema.parse(input)
    if (this.active.has(request.threadId)) throw new Error('A reply is already running in this conversation.')
    const controller = new AbortController()
    this.active.set(request.threadId, { requestId: request.requestId, controller })
    let truncated = false
    try {
      let thread = await this.comments.getThread(request.threadId)
      if (!thread?.anchor.codeAnchor || thread.purpose !== 'research') throw new Error('A saved code conversation is required.')
      const existingQuestion = thread.messages.find((message) => message.id === `${request.requestId}:user`)
      if (existingQuestion && existingQuestion.body !== request.body) throw new Error('Request identity is already bound to another question.')
      if (thread.messages.some((message) => message.id === `${request.requestId}:ai`)) {
        return { thread, state: 'completed', truncated: buildConversationContext(thread).truncated }
      }
      if (!this.execution) throw new Error('Agent execution is unavailable.')
      if (thread.messages.length >= 499) throw new Error('Conversation is full. Fork from an earlier message to continue.')
      if (request.body && !existingQuestion) {
        const now = new Date().toISOString()
        thread = await this.comments.upsertThread({ ...thread,
          messages: [...thread.messages, { id: `${request.requestId}:user`, authorKind: 'user', body: request.body, createdAt: now, updatedAt: now }],
          updatedAt: now
        })
      } else if (thread.messages.at(-1)?.authorKind !== 'user') {
        throw new Error('Write a question before requesting a reply.')
      }
      const context = buildConversationContext(thread)
      truncated = context.truncated
      if (controller.signal.aborted) return { thread, state: 'cancelled', truncated }
      const result = await this.execution.run(context.prompt, controller.signal)
      if (controller.signal.aborted || result.state === 'cancelled') return { thread, state: 'cancelled', truncated }
      if (result.state !== 'completed' || !result.text.trim()) {
        return { thread, state: 'failed', truncated, error: result.failure?.message ?? 'The runtime returned no reply.' }
      }
      if (result.text.trim().length > 20_000) {
        return { thread, state: 'failed', truncated, error: 'Reply exceeds the 20,000 character message limit. Ask a narrower question.' }
      }
      const current = await this.comments.getThread(thread.id)
      if (controller.signal.aborted) return { thread, state: 'cancelled', truncated }
      if (!current || JSON.stringify(current.messages) !== JSON.stringify(thread.messages)) {
        throw new Error('Conversation changed during execution. Reply was not saved.')
      }
      const now = new Date().toISOString()
      const saved = await this.comments.upsertThread({ ...current,
        messages: [...current.messages, { id: `${request.requestId}:ai`, authorKind: 'ai', body: result.text.trim(), authorId: result.runtimeId, createdAt: now, updatedAt: now }],
        updatedAt: now, status: 'ai_responded'
      })
      return { thread: saved, state: 'completed', truncated }
    } catch (error) {
      const thread = await this.comments.getThread(request.threadId)
      if (!thread) throw error
      return { thread, state: controller.signal.aborted ? 'cancelled' : 'failed', truncated,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) }
    } finally {
      this.active.delete(request.threadId)
    }
  }
}
