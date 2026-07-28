import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { DomainWorkbenchRightPanelActivation } from '@sciforge/domain-sdk/host'
import type { WorkspaceFilePreviewReturnContext } from '../lib/workspace-file-preview'
import type { RightPanelMode } from './chat/WorkbenchTopBar'

export const SESSION_RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_HISTORY_LIMIT = 50
let fallbackWorkspaceInstanceSequence = 0

export type SessionRightPanelHistoryEntry = {
  mode: Exclude<RightPanelMode, null>
  filePreviewTarget: WorkspaceFileTarget | null
  filePreviewReturnContext: WorkspaceFilePreviewReturnContext | null
  panelActivation: DomainWorkbenchRightPanelActivation | null
}

export type SessionRightPanelHistory = {
  entries: SessionRightPanelHistoryEntry[]
  index: number
}

export type SessionRightPanelWorkspace = {
  instanceKey: string
  sessionId: string
  mode: RightPanelMode
  width: number
  filePreviewTarget: WorkspaceFileTarget | null
  filePreviewReturnContext: WorkspaceFilePreviewReturnContext | null
  panelActivation: DomainWorkbenchRightPanelActivation | null
  childPanelFocusRequest: { childId: string | null; key: number }
  fileTreeWorkspaceOverride: string | null
  fileTreeInitialDirectory: { workspaceRoot: string; path: string; nonce: number } | null
  history: SessionRightPanelHistory
}

export type SessionRightPanelWorkspaceMap = Record<string, SessionRightPanelWorkspace>

export type SessionRightPanelWorkspacePatch = Partial<Omit<
  SessionRightPanelWorkspace,
  'instanceKey' | 'sessionId' | 'history'
>>

function normalizedSessionId(sessionId: string | null | undefined): string | null {
  const normalized = sessionId?.trim()
  return normalized || null
}

function createWorkspaceInstanceKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `right-panel:${globalThis.crypto.randomUUID()}`
  }
  fallbackWorkspaceInstanceSequence += 1
  return `right-panel:${Date.now()}:${fallbackWorkspaceInstanceSequence}`
}

export function createSessionRightPanelWorkspace(
  sessionId: string,
  width = SESSION_RIGHT_PANEL_DEFAULT_WIDTH
): SessionRightPanelWorkspace {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) throw new Error('A Session ID is required for a right-panel workspace.')
  return {
    instanceKey: createWorkspaceInstanceKey(),
    sessionId: normalized,
    mode: null,
    width,
    filePreviewTarget: null,
    filePreviewReturnContext: null,
    panelActivation: null,
    childPanelFocusRequest: { childId: null, key: 0 },
    fileTreeWorkspaceOverride: null,
    fileTreeInitialDirectory: null,
    history: { entries: [], index: -1 }
  }
}

export function moveSessionRightPanelWorkspaceOwner(
  workspaces: SessionRightPanelWorkspaceMap,
  previousSessionId: string,
  nextSessionId: string
): SessionRightPanelWorkspaceMap {
  const previous = normalizedSessionId(previousSessionId)
  const next = normalizedSessionId(nextSessionId)
  if (!previous || !next || previous === next) return workspaces
  const workspace = workspaces[previous]
  if (!workspace) return workspaces
  const result = { ...workspaces }
  delete result[previous]
  if (!result[next]) result[next] = { ...workspace, sessionId: next }
  return result
}

export function ensureSessionRightPanelWorkspace(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  width = SESSION_RIGHT_PANEL_DEFAULT_WIDTH
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized || workspaces[normalized]) return workspaces
  return {
    ...workspaces,
    [normalized]: createSessionRightPanelWorkspace(normalized, width)
  }
}

export function sessionRightPanelHistoryEntryKey(entry: SessionRightPanelHistoryEntry): string {
  return JSON.stringify(entry)
}

export function pushSessionRightPanelHistoryEntry(
  history: SessionRightPanelHistory,
  entry: SessionRightPanelHistoryEntry
): SessionRightPanelHistory {
  if (sessionRightPanelHistoryEntryKey(history.entries[history.index]) === sessionRightPanelHistoryEntryKey(entry)) {
    return history
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry]
    .slice(-RIGHT_PANEL_HISTORY_LIMIT)
  return { entries, index: entries.length - 1 }
}

export function moveSessionRightPanelHistory(
  history: SessionRightPanelHistory,
  offset: -1 | 1
): SessionRightPanelHistory {
  if (history.entries.length === 0) return history
  const index = Math.min(history.entries.length - 1, Math.max(0, history.index + offset))
  return index === history.index ? history : { ...history, index }
}

function historyEntryFromWorkspace(
  workspace: SessionRightPanelWorkspace
): SessionRightPanelHistoryEntry | null {
  if (!workspace.mode) return null
  return {
    mode: workspace.mode,
    filePreviewTarget: workspace.mode === 'file' ? workspace.filePreviewTarget : null,
    filePreviewReturnContext: workspace.mode === 'file' ? workspace.filePreviewReturnContext : null,
    panelActivation: workspace.panelActivation
  }
}

export function updateSessionRightPanelWorkspace(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  patch: SessionRightPanelWorkspacePatch,
  options: { recordHistory?: boolean } = {}
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) return workspaces
  const ensured = ensureSessionRightPanelWorkspace(workspaces, normalized)
  const current = ensured[normalized]
  let next: SessionRightPanelWorkspace = { ...current, ...patch }
  if (options.recordHistory !== false) {
    const entry = historyEntryFromWorkspace(next)
    if (entry) next = { ...next, history: pushSessionRightPanelHistoryEntry(next.history, entry) }
  }
  if (next === current) return ensured
  return { ...ensured, [normalized]: next }
}

export function toggleSessionRightPanelMode(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  mode: Exclude<RightPanelMode, null>
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) return workspaces
  const current = workspaces[normalized]
  return updateSessionRightPanelWorkspace(workspaces, normalized, {
    mode: current?.mode === mode ? null : mode
  })
}

export function navigateSessionRightPanelHistory(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  offset: -1 | 1
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) return workspaces
  const current = workspaces[normalized]
  if (!current) return workspaces
  const history = moveSessionRightPanelHistory(current.history, offset)
  if (history === current.history) return workspaces
  const entry = history.entries[history.index]
  return {
    ...workspaces,
    [normalized]: {
      ...current,
      mode: entry.mode,
      filePreviewTarget: entry.filePreviewTarget,
      filePreviewReturnContext: entry.filePreviewReturnContext,
      panelActivation: entry.panelActivation,
      history
    }
  }
}

export function discardSessionRightPanelResource(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  mode: 'file',
  resourceId: string
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedResourceId = resourceId.trim()
  if (!normalized || !normalizedResourceId) return workspaces
  const current = workspaces[normalized]
  if (!current) return workspaces
  const entries = current.history.entries.filter((entry) => {
    if (entry.mode !== mode) return true
    return entry.filePreviewTarget?.path.trim() !== normalizedResourceId
  })
  const matchesCurrent = current.filePreviewTarget?.path.trim() === normalizedResourceId
  return {
    ...workspaces,
    [normalized]: {
      ...current,
      ...(matchesCurrent ? {
        mode: current.mode === mode ? null : current.mode,
        filePreviewTarget: null,
        filePreviewReturnContext: null
      } : {}),
      history: { entries, index: entries.length - 1 }
    }
  }
}

export function sessionRightPanelWorkspaceList(
  workspaces: SessionRightPanelWorkspaceMap
): SessionRightPanelWorkspace[] {
  return Object.values(workspaces)
}
