import {
  domainRendererWorkbenchNavigationSessionCatalogSchema,
  domainRendererWorkbenchNavigationSessionSchema,
  type DomainRendererWorkbenchNavigationSectionRenderContext,
  type DomainRendererWorkbenchSession
} from '@sciforge/domain-sdk/renderer'

import type { NormalizedThread } from '../agent/types'

const MAX_NAVIGATION_SESSIONS = 10_000

export function buildWorkbenchNavigationSectionRenderContext(input: Readonly<{
  active: boolean
  className: string
  session: DomainRendererWorkbenchSession
  threads: readonly NormalizedThread[]
  selectSession: (sessionId: string) => void
}>): DomainRendererWorkbenchNavigationSectionRenderContext {
  const sessions = domainRendererWorkbenchNavigationSessionCatalogSchema.parse(
    input.threads.slice(0, MAX_NAVIGATION_SESSIONS).flatMap((thread) => {
      const parsed = domainRendererWorkbenchNavigationSessionSchema.safeParse({
        id: thread.id,
        ...(thread.runtimeId ? { runtimeId: thread.runtimeId } : {}),
        title: thread.title,
        updatedAt: thread.updatedAt,
        ...(thread.workspace ? { workspaceRoot: thread.workspace } : {}),
        ...(thread.status ? { status: thread.status } : {}),
        ...(thread.archived === undefined ? {} : { archived: thread.archived })
      })
      return parsed.success ? [parsed.data] : []
    })
  )
  const sessionIds = new Set(sessions.map(({ id }) => id))

  return Object.freeze({
    active: input.active,
    className: input.className,
    session: input.session,
    sessions,
    selectSession: (sessionId: string) => {
      const normalized = sessionId.trim()
      if (!sessionIds.has(normalized)) return
      input.selectSession(normalized)
    }
  })
}
