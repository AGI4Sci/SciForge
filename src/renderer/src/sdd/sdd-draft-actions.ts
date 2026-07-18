import { selectSddDraftSession, useSddDraftStore, type SddDraft } from './sdd-draft-store'

type SddDraftDiskSnapshot = {
  path?: string
  content?: string
  size?: number
  truncated?: boolean
  message?: string
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function snapshotMatchesDraft(draft: SddDraft, path: string): boolean {
  const normalized = normalizePath(path)
  const relativePath = normalizePath(draft.relativePath)
  const candidates = [
    draft.absolutePath,
    draft.relativePath,
    `${draft.workspaceRoot}/${draft.relativePath}`
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizePath)
  return candidates.includes(normalized) || normalized.endsWith(`/${relativePath}`)
}

/**
 * Apply an external file snapshot to exactly one SDD session. The owner is
 * resolved before any asynchronous read and revalidated afterwards, so a
 * session switch or a replacement draft cannot redirect the update.
 */
export async function syncSddDraftFromDisk(
  ownerSessionId: string,
  snapshot: SddDraftDiskSnapshot
): Promise<boolean> {
  const session = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
  if (!session) return false
  if (session.saveStatus === 'dirty' || session.saveStatus === 'saving') return false
  if (snapshot.path && !snapshotMatchesDraft(session.draft, snapshot.path)) return false

  if (snapshot.message) {
    useSddDraftStore.getState().setSessionSaveStatus(ownerSessionId, 'error', snapshot.message)
    return false
  }

  let content = snapshot.content
  if (typeof content !== 'string') {
    const result = await window.sciforge.readWorkspaceFile({
      workspaceRoot: session.draft.workspaceRoot,
      path: session.draft.relativePath
    })
    if (!result.ok) {
      const latest = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
      if (latest?.draft.id === session.draft.id) {
        useSddDraftStore.getState().setSessionSaveStatus(ownerSessionId, 'error', result.message)
      }
      return false
    }
    content = result.content
  }

  const latest = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
  if (latest?.draft.id !== session.draft.id) return false
  if (latest.saveStatus === 'dirty' || latest.saveStatus === 'saving') return false

  useSddDraftStore.getState().setSessionContent(ownerSessionId, content)
  useSddDraftStore.getState().markSessionSaved(ownerSessionId, content)
  return true
}

/** Save exactly one session-owned draft without consulting the focused session. */
export async function saveSddDraftToDisk(ownerSessionId: string): Promise<boolean> {
  const session = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
  if (!session) return true
  if (session.saveStatus === 'saved' && session.content === session.lastSavedContent) return true

  useSddDraftStore.getState().setSessionSaveStatus(ownerSessionId, 'saving')
  try {
    const result = await window.sciforge.writeWorkspaceFile({
      workspaceRoot: session.draft.workspaceRoot,
      path: session.draft.relativePath,
      content: session.content
    })
    const latest = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (latest?.draft.id !== session.draft.id) return result.ok
    if (!result.ok) {
      useSddDraftStore.getState().setSessionSaveStatus(ownerSessionId, 'error', result.message)
      return false
    }
    useSddDraftStore.getState().markSessionSaved(ownerSessionId, session.content)
    return true
  } catch (error) {
    const latest = selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
    if (latest?.draft.id === session.draft.id) {
      useSddDraftStore.getState().setSessionSaveStatus(
        ownerSessionId,
        'error',
        error instanceof Error ? error.message : String(error)
      )
    }
    return false
  }
}
