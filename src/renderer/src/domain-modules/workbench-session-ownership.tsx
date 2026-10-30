import { useCallback, useEffect, type ReactElement } from 'react'
import type {
  DomainRendererWorkbenchNavigationSectionRenderContext,
  DomainRendererWorkbenchSessionOwnership
} from '@sciforge/domain-sdk/renderer'
import { workspaceRootIdentityKey } from '../lib/workspace-path'
import type { NormalizedThread } from '../agent/types'
import type { RegisteredWorkbenchNavigationSectionContribution } from './workbench-navigation-section-slot'

export function navigationSessionKey(session: { runtimeId?: string; threadId: string }): string {
  return `${session.runtimeId ?? ''}\u0000${session.threadId}`
}

export function partitionNavigationSessions(
  threads: readonly NormalizedThread[],
  owners: readonly DomainRendererWorkbenchSessionOwnership[]
): { localThreads: NormalizedThread[]; ownedWorkspaceKeys: ReadonlySet<string> } {
  const keys = new Set(owners.map(navigationSessionKey))
  const isOwned = (thread: NormalizedThread): boolean => keys.has(navigationSessionKey({
    runtimeId: thread.runtimeId,
    threadId: thread.id
  }))
  const localThreads = threads.filter(thread => !isOwned(thread))
  const localRoots = new Set(localThreads.map(thread => workspaceRootIdentityKey(thread.workspace ?? '')))
  const ownedWorkspaceKeys = new Set(threads
    .filter(isOwned)
    .map(thread => workspaceRootIdentityKey(thread.workspace ?? ''))
    .filter(root => root && !localRoots.has(root)))
  return { localThreads, ownedWorkspaceKeys }
}

export function WorkbenchNavigationSectionOutlet({ section, context, publish, showOverview }: {
  section: RegisteredWorkbenchNavigationSectionContribution
  context: DomainRendererWorkbenchNavigationSectionRenderContext
  publish: (id: string, ownership: readonly DomainRendererWorkbenchSessionOwnership[] | undefined) => void
  showOverview: (title: string) => void
}): ReactElement | null {
  const report = useCallback((ownership: readonly DomainRendererWorkbenchSessionOwnership[]) => {
    publish(section.id, ownership)
  }, [publish, section.id])
  useEffect(() => () => publish(section.id, undefined), [publish, section.id])
  return section.contribution.render({ ...context, publishSessionOwnership: report, showOverview })
}
