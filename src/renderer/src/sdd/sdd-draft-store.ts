import { create } from 'zustand'
import { buildSddDraftRelativePath, normalizeSddRelativePath } from '@shared/sdd'
import { browserStorage } from '../lib/browser-storage'

export type SddDraftSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type SddDraftOperationStatus = 'idle' | 'upgrading' | 'error'

export type SddDraft = {
  id: string
  workspaceRoot: string
  relativePath: string
  absolutePath?: string
  createdAt: string
  updatedAt: string
}

type PersistedSddDraftRegistry = {
  version: 1
  activeByWorkspace: Record<string, string>
  drafts: Record<string, SddDraft>
  contentByDraft: Record<string, SddDraftContentSnapshot>
}

export type SddDraftContentSnapshot = {
  draftId: string
  content: string
  lastSavedContent: string
  updatedAt: string
}

export type SddDraftSessionState = {
  ownerSessionId: string
  draft: SddDraft
  content: string
  lastSavedContent: string
  saveStatus: SddDraftSaveStatus
  operationStatus: SddDraftOperationStatus
  error: string | null
}

export type SddDraftState = {
  sessions: Record<string, SddDraftSessionState>
  setSessionDraft: (
    ownerSessionId: string,
    draft: SddDraft,
    content: string,
    options?: {
      lastSavedContent?: string
      saveStatus?: SddDraftSaveStatus
    }
  ) => void
  setSessionContent: (ownerSessionId: string, content: string) => void
  setSessionSaveStatus: (
    ownerSessionId: string,
    status: SddDraftSaveStatus,
    error?: string | null
  ) => void
  markSessionSaved: (ownerSessionId: string, content: string) => void
  setSessionOperationStatus: (
    ownerSessionId: string,
    status: SddDraftOperationStatus,
    error?: string | null
  ) => void
  removeSession: (ownerSessionId: string) => void
  moveSession: (previousSessionId: string, nextSessionId: string) => void
}

const SDD_DRAFT_REGISTRY_STORAGE_KEY = 'sciforge.sdd.draft.registry.v1'

function normalizeWorkspaceRoot(value: string | undefined | null): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildSddDraftId(workspaceRoot: string, relativePath: string): string {
  return `${normalizeWorkspaceRoot(workspaceRoot)}:${normalizeSddRelativePath(relativePath)}`
}

function normalizeContentSnapshot(raw: unknown, fallbackDraftId = ''): SddDraftContentSnapshot | null {
  if (!isRecord(raw)) return null
  const draftId = normalizeText(raw.draftId) || normalizeText(fallbackDraftId)
  if (!draftId || typeof raw.content !== 'string') return null
  const lastSavedContent = typeof raw.lastSavedContent === 'string' ? raw.lastSavedContent : raw.content
  return {
    draftId,
    content: raw.content,
    lastSavedContent,
    updatedAt: normalizeText(raw.updatedAt) || new Date(0).toISOString()
  }
}

function normalizeDraft(raw: unknown, fallbackId = ''): SddDraft | null {
  if (!isRecord(raw)) return null
  const id = normalizeText(raw.id) || normalizeText(fallbackId)
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(raw.workspaceRoot))
  const relativePath = normalizeSddRelativePath(normalizeText(raw.relativePath))
  if (!id || !workspaceRoot || !relativePath) return null
  const absolutePath = normalizeText(raw.absolutePath)
  const createdAt = normalizeText(raw.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(raw.updatedAt) || createdAt
  return {
    id,
    workspaceRoot,
    relativePath,
    ...(absolutePath ? { absolutePath } : {}),
    createdAt,
    updatedAt
  }
}

function emptyRegistry(): PersistedSddDraftRegistry {
  return { version: 1, activeByWorkspace: {}, drafts: {}, contentByDraft: {} }
}

function readRegistry(storage = browserStorage()): PersistedSddDraftRegistry {
  if (!storage) return emptyRegistry()
  try {
    const raw = storage.getItem(SDD_DRAFT_REGISTRY_STORAGE_KEY)
    if (!raw) return emptyRegistry()
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return emptyRegistry()
    const drafts: Record<string, SddDraft> = {}
    if (isRecord(parsed.drafts)) {
      for (const [id, value] of Object.entries(parsed.drafts)) {
        const draft = normalizeDraft(value, id)
        if (draft) drafts[draft.id] = draft
      }
    }
    const activeByWorkspace: Record<string, string> = {}
    if (isRecord(parsed.activeByWorkspace)) {
      for (const [workspace, value] of Object.entries(parsed.activeByWorkspace)) {
        const normalizedWorkspace = normalizeWorkspaceRoot(workspace)
        const activeId = normalizeText(value)
        const draft = drafts[activeId]
        if (normalizedWorkspace && draft && normalizeWorkspaceRoot(draft.workspaceRoot) === normalizedWorkspace) {
          activeByWorkspace[normalizedWorkspace] = draft.id
        }
      }
    }
    const contentByDraft: Record<string, SddDraftContentSnapshot> = {}
    if (isRecord(parsed.contentByDraft)) {
      for (const [id, value] of Object.entries(parsed.contentByDraft)) {
        const snapshot = normalizeContentSnapshot(value, id)
        if (snapshot && drafts[snapshot.draftId]) {
          contentByDraft[snapshot.draftId] = snapshot
        }
      }
    }
    return { version: 1, activeByWorkspace, drafts, contentByDraft }
  } catch {
    return emptyRegistry()
  }
}

function writeRegistry(registry: PersistedSddDraftRegistry, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(SDD_DRAFT_REGISTRY_STORAGE_KEY, JSON.stringify(registry))
  } catch {
    /* ignore storage failures */
  }
}

export function createSddDraft(options: {
  id: string
  workspaceRoot: string
  absolutePath?: string
  now?: number
}): SddDraft {
  const now = new Date(options.now ?? Date.now()).toISOString()
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
  const relativePath = buildSddDraftRelativePath(options.id)
  return {
    id: buildSddDraftId(workspaceRoot, relativePath),
    workspaceRoot,
    relativePath,
    ...(options.absolutePath ? { absolutePath: options.absolutePath } : {}),
    createdAt: now,
    updatedAt: now
  }
}

export function rememberSddDraft(draft: SddDraft): void {
  const normalized = normalizeDraft(draft)
  if (!normalized) return
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(normalized.workspaceRoot)
  registry.drafts[normalized.id] = normalized
  if (workspace) registry.activeByWorkspace[workspace] = normalized.id
  writeRegistry(registry)
}

export function rememberSddDraftContent(
  draft: Pick<SddDraft, 'id'>,
  content: string,
  lastSavedContent = content
): void {
  const draftId = normalizeText(draft.id)
  if (!draftId) return
  const registry = readRegistry()
  if (!registry.drafts[draftId]) return
  registry.contentByDraft[draftId] = {
    draftId,
    content,
    lastSavedContent,
    updatedAt: new Date().toISOString()
  }
  writeRegistry(registry)
}

export function readRememberedSddDraft(workspaceRoot: string): SddDraft | null {
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const id = registry.activeByWorkspace[workspace]
  const draft = registry.drafts[id ?? ''] ?? null
  return draft && normalizeWorkspaceRoot(draft.workspaceRoot) === workspace ? draft : null
}

export function readRememberedSddDrafts(workspaceRoot?: string): SddDraft[] {
  const registry = readRegistry()
  const workspace = workspaceRoot ? normalizeWorkspaceRoot(workspaceRoot) : ''
  return Object.values(registry.drafts)
    .filter((draft) => !workspace || normalizeWorkspaceRoot(draft.workspaceRoot) === workspace)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export function readRememberedSddDraftContent(
  draft: Pick<SddDraft, 'id'>
): SddDraftContentSnapshot | null {
  const draftId = normalizeText(draft.id)
  if (!draftId) return null
  const registry = readRegistry()
  return registry.contentByDraft[draftId] ?? null
}

export function forgetRememberedSddDraft(draft: Pick<SddDraft, 'id' | 'workspaceRoot'>): void {
  const normalizedId = normalizeText(draft.id)
  if (!normalizedId) return
  const registry = readRegistry()
  delete registry.drafts[normalizedId]
  delete registry.contentByDraft[normalizedId]
  for (const [key, activeId] of Object.entries(registry.activeByWorkspace)) {
    if (activeId === normalizedId) {
      delete registry.activeByWorkspace[key]
    }
  }
  writeRegistry(registry)
}

function normalizedOwnerSessionId(ownerSessionId: string): string {
  return ownerSessionId.trim()
}

export function selectSddDraftSession(
  state: SddDraftState,
  ownerSessionId: string | null | undefined
): SddDraftSessionState | null {
  const id = normalizedOwnerSessionId(ownerSessionId ?? '')
  return id ? state.sessions[id] ?? null : null
}

export const useSddDraftStore = create<SddDraftState>((set) => ({
  sessions: {},

  setSessionDraft: (ownerSessionId, draft, content, options = {}) => {
    const sessionId = normalizedOwnerSessionId(ownerSessionId)
    if (!sessionId) return
    const lastSavedContent = options.lastSavedContent ?? content
    const saveStatus = options.saveStatus ?? (content === lastSavedContent ? 'saved' : 'dirty')
    rememberSddDraft(draft)
    rememberSddDraftContent(draft, content, lastSavedContent)
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ownerSessionId: sessionId,
          draft,
          content,
          lastSavedContent,
          saveStatus,
          operationStatus: 'idle',
          error: null
        }
      }
    }))
  },

  setSessionContent: (ownerSessionId, content) =>
    set((state) => {
      const sessionId = normalizedOwnerSessionId(ownerSessionId)
      const session = state.sessions[sessionId]
      if (!session) return state
      rememberSddDraftContent(session.draft, content, session.lastSavedContent)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            content,
            saveStatus: content === session.lastSavedContent ? 'saved' : 'dirty',
            error: session.saveStatus === 'error' ? null : session.error
          }
        }
      }
    }),

  setSessionSaveStatus: (ownerSessionId, status, error = null) =>
    set((state) => {
      const sessionId = normalizedOwnerSessionId(ownerSessionId)
      const session = state.sessions[sessionId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, saveStatus: status, error }
        }
      }
    }),

  markSessionSaved: (ownerSessionId, content) =>
    set((state) => {
      const sessionId = normalizedOwnerSessionId(ownerSessionId)
      const session = state.sessions[sessionId]
      if (!session) return state
      const draft = { ...session.draft, updatedAt: new Date().toISOString() }
      rememberSddDraft(draft)
      rememberSddDraftContent(draft, session.content, content)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            draft,
            lastSavedContent: content,
            saveStatus: session.content === content ? 'saved' : 'dirty',
            error: session.operationStatus === 'error' ? session.error : null
          }
        }
      }
    }),

  setSessionOperationStatus: (ownerSessionId, status, error = null) =>
    set((state) => {
      const sessionId = normalizedOwnerSessionId(ownerSessionId)
      const session = state.sessions[sessionId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, operationStatus: status, error }
        }
      }
    }),

  removeSession: (ownerSessionId) =>
    set((state) => {
      const sessionId = normalizedOwnerSessionId(ownerSessionId)
      if (!sessionId || !state.sessions[sessionId]) return state
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return { sessions }
    }),

  moveSession: (previousSessionId, nextSessionId) =>
    set((state) => {
      const previous = normalizedOwnerSessionId(previousSessionId)
      const next = normalizedOwnerSessionId(nextSessionId)
      if (!previous || !next || previous === next) return state
      const session = state.sessions[previous]
      if (!session) return state
      const sessions = { ...state.sessions }
      delete sessions[previous]
      if (!sessions[next]) {
        sessions[next] = {
          ...session,
          ownerSessionId: next,
          saveStatus: session.saveStatus === 'saving' ? 'dirty' : session.saveStatus
        }
      }
      return { sessions }
    })
}))
