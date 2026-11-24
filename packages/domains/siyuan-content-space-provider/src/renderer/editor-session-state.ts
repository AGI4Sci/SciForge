export type EditorSessionState = Readonly<{ spaceId: string; settingsOpen: boolean; reloadRevision: number; configurationRevision?: number }>
const empty: EditorSessionState = Object.freeze({ spaceId: '', settingsOpen: false, reloadRevision: 0 })

/** One renderer package instance owns these drafts; they never cross account/session keys. */
export function createEditorSessionStateStore() {
  const states = new Map<string, EditorSessionState>()
  const listeners = new Set<() => void>()
  return {
    read: (key: string) => states.get(key) ?? empty,
    update(key: string, patch: Partial<EditorSessionState>) {
      states.set(key, { ...(states.get(key) ?? empty), ...patch })
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
}
export type EditorSessionStateStore = ReturnType<typeof createEditorSessionStateStore>
