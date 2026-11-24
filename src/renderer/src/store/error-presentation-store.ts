import { create } from 'zustand'

/** Presentation state only: never changes runtime connectivity or failure history. */
type ErrorPresentationState = {
  dismissed: Record<string, true>
  dismiss: (identity: string) => void
  beginAttempt: (runtimeId: string, sessionId: string | null) => void
}

export function errorPresentationIdentity(
  runtimeId: string,
  sessionId: string | null,
  source: string,
  ...identity: unknown[]
): string {
  return JSON.stringify([runtimeId, sessionId, source, ...identity])
}

export const useErrorPresentationStore = create<ErrorPresentationState>((set) => ({
  dismissed: {},
  dismiss: (identity) => set((state) => ({ dismissed: { ...state.dismissed, [identity]: true } })),
  // Only explicit user attempts reset presentation; polling must never call this.
  beginAttempt: (runtimeId, sessionId) => set((state) => {
    const prefix = JSON.stringify([runtimeId, sessionId]).slice(0, -1) + ','
    const dismissed = Object.fromEntries(Object.entries(state.dismissed).filter(([identity]) => !identity.startsWith(prefix)))
    return { dismissed }
  })
}))
