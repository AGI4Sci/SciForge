import { create } from 'zustand'
import {
  buildGuiPlanId,
  guiPlanWorkspaceMatches,
  isGuiPlanRelativePath,
  normalizeGuiPlanRelativePath,
  planDisplayNameFromRelativePath
} from '@shared/gui-plan'

export type GuiPlanOperationStatus =
  | 'idle'
  | 'drafting'
  | 'ready'
  | 'refining'
  | 'building'
  | 'error'

export type GuiPlanSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export type GuiPlanArtifact = {
  id: string
  workspaceRoot: string
  threadId: string
  featureName: string
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  createdAt: string
  updatedAt: string
}

export type GuiPlanSessionState = {
  activePlan: GuiPlanArtifact | null
  content: string
  lastSavedContent: string
  saveStatus: GuiPlanSaveStatus
  operationStatus: GuiPlanOperationStatus
  error: string | null
}

export type GuiPlanState = {
  sessions: Record<string, GuiPlanSessionState>
  setActivePlan: (ownerSessionId: string, plan: GuiPlanArtifact, content: string) => void
  setContent: (ownerSessionId: string, content: string) => void
  setSaveStatus: (
    ownerSessionId: string,
    status: GuiPlanSaveStatus,
    error?: string | null
  ) => void
  markSaved: (ownerSessionId: string, planId: string, content: string) => void
  setOperationStatus: (
    ownerSessionId: string,
    status: GuiPlanOperationStatus,
    error?: string | null
  ) => void
  updateActivePlan: (
    ownerSessionId: string,
    planId: string,
    patch: Partial<Pick<GuiPlanArtifact, 'absolutePath'>>
  ) => void
  removeSession: (ownerSessionId: string) => void
  moveSession: (previousSessionId: string, nextSessionId: string) => void
  clearAllSessions: () => void
}

export const EMPTY_GUI_PLAN_SESSION: Readonly<GuiPlanSessionState> = Object.freeze({
  activePlan: null,
  content: '',
  lastSavedContent: '',
  saveStatus: 'saved',
  operationStatus: 'idle',
  error: null
})

const guiPlanSessionGenerations = new Map<string, number>()

function emptyGuiPlanSession(): GuiPlanSessionState {
  return { ...EMPTY_GUI_PLAN_SESSION }
}

function normalizeOwnerSessionId(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function normalizeWorkspaceRoot(value: string | undefined | null): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePlanArtifact(raw: unknown): GuiPlanArtifact | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(record.workspaceRoot))
  const relativePath = normalizeGuiPlanRelativePath(normalizeText(record.relativePath))
  if (!workspaceRoot || !isGuiPlanRelativePath(relativePath)) return null
  const id = buildGuiPlanId(workspaceRoot, relativePath)
  const threadId = normalizeText(record.threadId)
  if (!threadId) return null
  const absolutePath = normalizeText(record.absolutePath)
  const sourceRequest = typeof record.sourceRequest === 'string' ? record.sourceRequest : ''
  const featureName = normalizeText(record.featureName) || planDisplayNameFromRelativePath(relativePath)
  const createdAt = normalizeText(record.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(record.updatedAt) || createdAt
  return {
    id,
    workspaceRoot,
    threadId,
    featureName,
    relativePath,
    ...(absolutePath ? { absolutePath } : {}),
    sourceRequest,
    createdAt,
    updatedAt
  }
}

export function createGuiPlanArtifact(options: {
  workspaceRoot: string
  threadId: string
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  now?: number
}): GuiPlanArtifact {
  const now = new Date(options.now ?? Date.now()).toISOString()
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
  const threadId = normalizeOwnerSessionId(options.threadId)
  if (!threadId) throw new Error('A Session owner is required for a GUI plan.')
  const relativePath = normalizeGuiPlanRelativePath(options.relativePath)
  const featureName = planDisplayNameFromRelativePath(relativePath)
  return {
    id: buildGuiPlanId(workspaceRoot, relativePath),
    workspaceRoot,
    threadId,
    featureName,
    relativePath,
    ...(options.absolutePath ? { absolutePath: options.absolutePath } : {}),
    sourceRequest: options.sourceRequest,
    createdAt: now,
    updatedAt: now
  }
}

export function guiPlanMatchesContext(
  plan: GuiPlanArtifact,
  workspaceRoot: string,
  ownerSessionId: string
): boolean {
  const owner = normalizeOwnerSessionId(ownerSessionId)
  return Boolean(
    owner &&
      plan.threadId.trim() === owner &&
      guiPlanWorkspaceMatches(plan.workspaceRoot, normalizeWorkspaceRoot(workspaceRoot))
  )
}

export function guiPlanSession(
  state: Pick<GuiPlanState, 'sessions'>,
  ownerSessionId: string | null | undefined
): Readonly<GuiPlanSessionState> {
  const owner = normalizeOwnerSessionId(ownerSessionId)
  return (owner && state.sessions[owner]) || EMPTY_GUI_PLAN_SESSION
}

export function guiPlanSessionGeneration(ownerSessionId: string): number {
  return guiPlanSessionGenerations.get(normalizeOwnerSessionId(ownerSessionId)) ?? 0
}

function updateSession(
  sessions: Record<string, GuiPlanSessionState>,
  ownerSessionId: string,
  update: (current: GuiPlanSessionState) => GuiPlanSessionState
): Record<string, GuiPlanSessionState> {
  const owner = normalizeOwnerSessionId(ownerSessionId)
  if (!owner) return sessions
  const current = sessions[owner] ?? emptyGuiPlanSession()
  const next = update(current)
  return next === current ? sessions : { ...sessions, [owner]: next }
}

export const useGuiPlanStore = create<GuiPlanState>((set) => ({
  sessions: {},

  setActivePlan: (ownerSessionId, plan, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, () => {
        const owner = normalizeOwnerSessionId(ownerSessionId)
        const normalizedPlan = normalizePlanArtifact(plan) ?? plan
        return {
          activePlan: { ...normalizedPlan, threadId: owner },
          content,
          lastSavedContent: content,
          saveStatus: 'saved',
          operationStatus: 'ready',
          error: null
        }
      })
    })),

  setContent: (ownerSessionId, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, (current) => ({
        ...current,
        content,
        saveStatus: content === current.lastSavedContent ? 'saved' : 'dirty',
        error: current.saveStatus === 'error' ? null : current.error
      }))
    })),

  setSaveStatus: (ownerSessionId, saveStatus, error = null) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, (current) => ({
        ...current,
        saveStatus,
        error
      }))
    })),

  markSaved: (ownerSessionId, planId, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, (current) => {
        if (current.activePlan?.id !== planId) return current
        return {
          ...current,
          lastSavedContent: content,
          saveStatus: current.content === content ? 'saved' : 'dirty',
          error: current.operationStatus === 'error' ? current.error : null,
          activePlan: {
            ...current.activePlan,
            updatedAt: new Date().toISOString()
          }
        }
      })
    })),

  setOperationStatus: (ownerSessionId, operationStatus, error = null) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, (current) => ({
        ...current,
        operationStatus,
        error
      }))
    })),

  updateActivePlan: (ownerSessionId, planId, patch) =>
    set((state) => ({
      sessions: updateSession(state.sessions, ownerSessionId, (current) => {
        if (current.activePlan?.id !== planId) return current
        return {
          ...current,
          activePlan: {
            ...current.activePlan,
            ...patch,
            updatedAt: new Date().toISOString()
          }
        }
      })
    })),

  removeSession: (ownerSessionId) =>
    set((state) => {
      const owner = normalizeOwnerSessionId(ownerSessionId)
      if (!owner) return state
      guiPlanSessionGenerations.set(owner, guiPlanSessionGeneration(owner) + 1)
      if (!state.sessions[owner]) return state
      const sessions = { ...state.sessions }
      delete sessions[owner]
      return { sessions }
    }),

  moveSession: (previousSessionId, nextSessionId) =>
    set((state) => {
      const previous = normalizeOwnerSessionId(previousSessionId)
      const next = normalizeOwnerSessionId(nextSessionId)
      if (!previous || !next || previous === next) return state
      const session = state.sessions[previous]
      guiPlanSessionGenerations.set(previous, guiPlanSessionGeneration(previous) + 1)
      if (!session) return state
      const sessions = { ...state.sessions }
      delete sessions[previous]
      if (!sessions[next]) {
        sessions[next] = {
          ...session,
          activePlan: session.activePlan
            ? { ...session.activePlan, threadId: next }
            : null,
          saveStatus: session.saveStatus === 'saving' ? 'dirty' : session.saveStatus
        }
      }
      return { sessions }
    }),

  clearAllSessions: () => {
    guiPlanSessionGenerations.clear()
    set({ sessions: {} })
  }
}))
