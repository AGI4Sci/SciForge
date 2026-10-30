import { useGuiPlanStore } from '../plan/plan-store'
import { useSddDraftStore } from '../sdd/sdd-draft-store'

export type SessionRightPanelDisposeListener = (sessionId: string) => void
export type SessionRightPanelRekeyListener = (
  previousSessionId: string,
  nextSessionId: string
) => void

const disposeListeners = new Set<SessionRightPanelDisposeListener>()
const rekeyListeners = new Set<SessionRightPanelRekeyListener>()

export function subscribeSessionRightPanelDisposals(
  listener: SessionRightPanelDisposeListener
): () => void {
  disposeListeners.add(listener)
  return () => disposeListeners.delete(listener)
}

export function subscribeSessionRightPanelRekeys(
  listener: SessionRightPanelRekeyListener
): () => void {
  rekeyListeners.add(listener)
  return () => rekeyListeners.delete(listener)
}

/**
 * Ends the renderer lifetime of one session-owned right-panel workspace.
 * Session removal actions are the only callers; focus and route changes must
 * never publish this notification.
 */
export function disposeSessionRightPanelWorkspace(sessionId: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return
  useGuiPlanStore.getState().removeSession(normalizedSessionId)
  useSddDraftStore.getState().removeSession(normalizedSessionId)
  for (const listener of disposeListeners) listener(normalizedSessionId)
}

export function rekeySessionRightPanelWorkspace(
  previousSessionId: string,
  nextSessionId: string
): void {
  const previous = previousSessionId.trim()
  const next = nextSessionId.trim()
  if (!previous || !next || previous === next) return
  useGuiPlanStore.getState().moveSession(previous, next)
  useSddDraftStore.getState().moveSession(previous, next)
  for (const listener of rekeyListeners) listener(previous, next)
}
