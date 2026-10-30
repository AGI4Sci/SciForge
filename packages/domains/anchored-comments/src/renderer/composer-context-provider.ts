import {
  domainRendererComposerContextResultSchema,
  type DomainRendererComposerContextProvider
} from '@sciforge/domain-sdk/renderer'
import {
  buildAnchoredCommentContextReferences,
  renderAnchoredCommentContext
} from '../contract'
import { anchoredCommentStore } from './anchored-comment-store'
import type { AnchoredCommentsCapabilityClient } from './renderer-bridge'

const MAX_CONTEXT_ITEMS = 8
const MAX_CONTEXT_CHARS = 16_000

export function createAnchoredCommentsComposerContextProvider(
  client: AnchoredCommentsCapabilityClient
): DomainRendererComposerContextProvider {
  return Object.freeze({
    async provide(request) {
      if (request.signal.aborted) return { items: [] }
      const selected = anchoredCommentStore.getState().selectedForConversation
        .slice(0, MAX_CONTEXT_ITEMS)
      if (selected.length === 0) return { items: [] }

      const threads = (
        await Promise.all(selected.map(async (threadId) => {
          try {
            return (await client.get(threadId)).thread
          } catch {
            return null
          }
        }))
      ).filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
      if (request.signal.aborted || threads.length === 0) return { items: [] }

      const references = buildAnchoredCommentContextReferences(
        threads,
        selected,
        { maxThreads: MAX_CONTEXT_ITEMS }
      )
      const content = renderAnchoredCommentContext(references, {
        maxChars: MAX_CONTEXT_CHARS
      })
      if (!content) return { items: [] }

      return domainRendererComposerContextResultSchema.parse({
        items: [{
          id: 'anchored-comments.context.selected',
          title: references.length === 1
            ? `Comment: ${references[0]!.targetLabel}`.slice(0, 160)
            : `${references.length} anchored comments`,
          content,
          metadata: {
            schemaVersion: 1,
            threadIds: references.map((reference) => reference.threadId)
          }
        }]
      })
    }
  })
}
