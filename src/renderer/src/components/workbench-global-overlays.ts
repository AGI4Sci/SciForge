import type { DomainWorkbenchToggleGlobalOverlayInput } from '@sciforge/domain-sdk/host'
import type { DomainRendererWorkbenchSession } from '@sciforge/domain-sdk/renderer'
import type { NormalizedThread } from '../agent/types'

export type WorkbenchOverlayPlacement = 'window' | 'workspace'
export type WorkbenchOverlaySelection = DomainWorkbenchToggleGlobalOverlayInput & Readonly<{
  session: DomainRendererWorkbenchSession
}>
export type WorkbenchGlobalOverlays = Readonly<Record<WorkbenchOverlayPlacement, WorkbenchOverlaySelection | null>>

/** Resolve every field from the owner, never from an unrelated active Session. */
export function resolveWorkbenchOverlaySession(
  ownerId: string,
  threads: readonly NormalizedThread[],
  fallback?: DomainRendererWorkbenchSession
): DomainRendererWorkbenchSession | undefined {
  const owner = threads.find(thread => thread.id === ownerId)
  if (!owner) return fallback?.id === ownerId ? fallback : undefined
  return {
    id: owner.id,
    ...(owner.title ? { title: owner.title } : {}),
    ...(owner.runtimeId ? { runtimeId: owner.runtimeId } : {}),
    ...(owner.workspace ? { workspaceRoot: owner.workspace } : {})
  }
}

/** Window annotations may cover a workspace canvas without replacing its DOM. */
export function updateWorkbenchGlobalOverlays(
  state: WorkbenchGlobalOverlays,
  placement: WorkbenchOverlayPlacement,
  request: DomainWorkbenchToggleGlobalOverlayInput,
  session?: DomainRendererWorkbenchSession
): WorkbenchGlobalOverlays {
  const contributionId = request.contributionId.trim()
  const current = state[placement]
  if (request.open === false || (request.open !== true && current?.contributionId === contributionId)) {
    return current?.contributionId === contributionId ? { ...state, [placement]: null } : state
  }
  if (!contributionId || !session) return state
  return {
    ...state,
    [placement]: {
      contributionId,
      sessionId: session.id,
      session,
      ...(request.activation ? { activation: request.activation } : {}),
      open: true
    }
  }
}
