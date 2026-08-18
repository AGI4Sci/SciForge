import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { DomainWorkbenchRightPanelActivation } from '@sciforge/domain-sdk/host'
import type { WorkspaceFilePreviewReturnContext } from '../lib/workspace-file-preview'
import { workspaceRootIdentityKey } from '../lib/workspace-path'
import type { RightPanelMode } from './chat/WorkbenchTopBar'

export const SESSION_RIGHT_PANEL_DEFAULT_WIDTH = 360
export const SESSION_RIGHT_PANEL_MIN_WIDTH = 300
const RIGHT_PANEL_HISTORY_LIMIT = 50
let fallbackInstanceSequence = 0

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

export type SessionRightPanelPane = {
  paneId: string
  instanceKey: string
  mode: Exclude<RightPanelMode, null>
  width: number
  filePreviewTarget: WorkspaceFileTarget | null
  filePreviewReturnContext: WorkspaceFilePreviewReturnContext | null
  panelActivation: DomainWorkbenchRightPanelActivation | null
  childPanelFocusRequest: { childId: string | null; key: number }
  fileTreeWorkspaceOverride: string | null
  fileTreeInitialDirectory: { workspaceRoot: string; path: string; nonce: number } | null
  history: SessionRightPanelHistory
}

export type SessionRightPanelWorkspace = {
  instanceKey: string
  sessionId: string
  panes: SessionRightPanelPane[]
  focusedPaneId: string | null
}

export type SessionRightPanelWorkspaceMap = Record<string, SessionRightPanelWorkspace>

export type SessionRightPanelPaneBinding = {
  mode: Exclude<RightPanelMode, null>
  filePreviewTarget?: WorkspaceFileTarget | null
  filePreviewReturnContext?: WorkspaceFilePreviewReturnContext | null
  panelActivation?: DomainWorkbenchRightPanelActivation | null
  childPanelFocusRequest?: { childId: string | null; key: number }
  fileTreeWorkspaceOverride?: string | null
  fileTreeInitialDirectory?: { workspaceRoot: string; path: string; nonce: number } | null
}

export type SessionRightPanelPanePatch = Partial<Pick<
  SessionRightPanelPane,
  | 'filePreviewTarget'
  | 'filePreviewReturnContext'
  | 'panelActivation'
  | 'childPanelFocusRequest'
  | 'fileTreeWorkspaceOverride'
  | 'fileTreeInitialDirectory'
>>

export type SessionRightPanelPlacement = 'focused' | 'new'

export type SessionRightPanelPaneUpdateOptions = { recordHistory?: boolean }

function normalizedSessionId(sessionId: string | null | undefined): string | null {
  const normalized = sessionId?.trim()
  return normalized || null
}

function createInstanceKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}:${globalThis.crypto.randomUUID()}`
  }
  fallbackInstanceSequence += 1
  return `${prefix}:${Date.now()}:${fallbackInstanceSequence}`
}

function historyEntryFromPane(
  pane: SessionRightPanelPane
): SessionRightPanelHistoryEntry {
  return {
    mode: pane.mode,
    filePreviewTarget: pane.mode === 'file' ? pane.filePreviewTarget : null,
    filePreviewReturnContext: pane.mode === 'file' ? pane.filePreviewReturnContext : null,
    panelActivation: pane.panelActivation
  }
}

function paneStateFromBinding(
  binding: SessionRightPanelPaneBinding
): Pick<
  SessionRightPanelPane,
  | 'mode'
  | 'filePreviewTarget'
  | 'filePreviewReturnContext'
  | 'panelActivation'
  | 'childPanelFocusRequest'
  | 'fileTreeWorkspaceOverride'
  | 'fileTreeInitialDirectory'
> {
  return {
    mode: binding.mode,
    filePreviewTarget: binding.mode === 'file' ? binding.filePreviewTarget ?? null : null,
    filePreviewReturnContext:
      binding.mode === 'file' ? binding.filePreviewReturnContext ?? null : null,
    panelActivation: binding.panelActivation ?? null,
    childPanelFocusRequest: binding.childPanelFocusRequest ?? { childId: null, key: 0 },
    fileTreeWorkspaceOverride: binding.fileTreeWorkspaceOverride ?? null,
    fileTreeInitialDirectory: binding.fileTreeInitialDirectory ?? null
  }
}

function replacePane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string,
  paneId: string,
  update: (pane: SessionRightPanelPane) => SessionRightPanelPane
): SessionRightPanelWorkspaceMap {
  const workspace = workspaces[sessionId]
  if (!workspace) return workspaces
  const paneIndex = workspace.panes.findIndex((pane) => pane.paneId === paneId)
  if (paneIndex < 0) return workspaces
  const currentPane = workspace.panes[paneIndex]
  const nextPane = update(currentPane)
  if (nextPane === currentPane) return workspaces
  const panes = [...workspace.panes]
  panes[paneIndex] = nextPane
  return {
    ...workspaces,
    [sessionId]: { ...workspace, panes }
  }
}

function updatePaneAndHistory(
  pane: SessionRightPanelPane,
  patch: Partial<SessionRightPanelPane>,
  options: SessionRightPanelPaneUpdateOptions
): SessionRightPanelPane {
  let next = { ...pane, ...patch }
  if (options.recordHistory !== false) {
    next = {
      ...next,
      history: pushSessionRightPanelHistoryEntry(next.history, historyEntryFromPane(next))
    }
  }
  return next
}

function focusedPaneIdAfterRemoval(
  workspace: SessionRightPanelWorkspace,
  panes: readonly SessionRightPanelPane[]
): string | null {
  if (!workspace.focusedPaneId) return panes[0]?.paneId ?? null
  if (panes.some((pane) => pane.paneId === workspace.focusedPaneId)) {
    return workspace.focusedPaneId
  }
  const focusedIndex = workspace.panes.findIndex(
    (pane) => pane.paneId === workspace.focusedPaneId
  )
  if (focusedIndex < 0) return panes[0]?.paneId ?? null
  for (let index = focusedIndex + 1; index < workspace.panes.length; index += 1) {
    const paneId = workspace.panes[index].paneId
    if (panes.some((pane) => pane.paneId === paneId)) return paneId
  }
  for (let index = focusedIndex - 1; index >= 0; index -= 1) {
    const paneId = workspace.panes[index].paneId
    if (panes.some((pane) => pane.paneId === paneId)) return paneId
  }
  return null
}

export function createSessionRightPanelPane(
  binding: SessionRightPanelPaneBinding,
  width = SESSION_RIGHT_PANEL_DEFAULT_WIDTH
): SessionRightPanelPane {
  const normalizedWidth = Number.isFinite(width)
    ? Math.max(SESSION_RIGHT_PANEL_MIN_WIDTH, width)
    : SESSION_RIGHT_PANEL_DEFAULT_WIDTH
  const pane = {
    paneId: createInstanceKey('right-panel-pane'),
    instanceKey: createInstanceKey('right-panel-pane-instance'),
    ...paneStateFromBinding(binding),
    width: normalizedWidth,
    history: { entries: [], index: -1 }
  }
  return {
    ...pane,
    history: pushSessionRightPanelHistoryEntry(pane.history, historyEntryFromPane(pane))
  }
}

export function createSessionRightPanelWorkspace(
  sessionId: string
): SessionRightPanelWorkspace {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) throw new Error('A Session ID is required for a right-panel workspace.')
  return {
    instanceKey: createInstanceKey('right-panel-workspace'),
    sessionId: normalized,
    panes: [],
    focusedPaneId: null
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

export function removeSessionRightPanelWorkspace(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized || !workspaces[normalized]) return workspaces
  const result = { ...workspaces }
  delete result[normalized]
  return result
}

export function ensureSessionRightPanelWorkspace(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized || workspaces[normalized]) return workspaces
  return {
    ...workspaces,
    [normalized]: createSessionRightPanelWorkspace(normalized)
  }
}

export function sessionRightPanelHistoryEntryKey(
  entry: SessionRightPanelHistoryEntry | undefined
): string | undefined {
  return entry ? JSON.stringify(entry) : undefined
}

export function pushSessionRightPanelHistoryEntry(
  history: SessionRightPanelHistory,
  entry: SessionRightPanelHistoryEntry
): SessionRightPanelHistory {
  if (
    sessionRightPanelHistoryEntryKey(history.entries[history.index]) ===
    sessionRightPanelHistoryEntryKey(entry)
  ) {
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

export function focusedSessionRightPanelPane(
  workspace: SessionRightPanelWorkspace | null | undefined
): SessionRightPanelPane | null {
  if (!workspace?.focusedPaneId) return null
  return workspace.panes.find((pane) => pane.paneId === workspace.focusedPaneId) ?? null
}

export function sessionRightPanelPaneById(
  workspace: SessionRightPanelWorkspace | null | undefined,
  paneId: string | null | undefined
): SessionRightPanelPane | null {
  const normalizedPaneId = paneId?.trim()
  if (!workspace || !normalizedPaneId) return null
  return workspace.panes.find((pane) => pane.paneId === normalizedPaneId) ?? null
}

export function addSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  binding: SessionRightPanelPaneBinding,
  options: {
    afterPaneId?: string | null
    focus?: boolean
    width?: number
  } = {}
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) return workspaces
  const ensured = ensureSessionRightPanelWorkspace(workspaces, normalized)
  const workspace = ensured[normalized]
  const pane = createSessionRightPanelPane(binding, options.width)
  const requestedPredecessor = options.afterPaneId === undefined
    ? workspace.focusedPaneId
    : options.afterPaneId
  const predecessorIndex = requestedPredecessor
    ? workspace.panes.findIndex((candidate) => candidate.paneId === requestedPredecessor)
    : -1
  const insertionIndex = predecessorIndex >= 0 ? predecessorIndex + 1 : workspace.panes.length
  const panes = [...workspace.panes]
  panes.splice(insertionIndex, 0, pane)
  return {
    ...ensured,
    [normalized]: {
      ...workspace,
      panes,
      focusedPaneId:
        options.focus === false ? workspace.focusedPaneId ?? pane.paneId : pane.paneId
    }
  }
}

export function updateSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined,
  patch: SessionRightPanelPanePatch,
  options: SessionRightPanelPaneUpdateOptions = {}
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  return replacePane(workspaces, normalized, normalizedPaneId, (pane) =>
    updatePaneAndHistory(pane, patch, options)
  )
}

export function focusSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  const workspace = workspaces[normalized]
  if (
    !workspace ||
    workspace.focusedPaneId === normalizedPaneId ||
    !workspace.panes.some((pane) => pane.paneId === normalizedPaneId)
  ) {
    return workspaces
  }
  return {
    ...workspaces,
    [normalized]: { ...workspace, focusedPaneId: normalizedPaneId }
  }
}

export function splitSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  const workspace = workspaces[normalized]
  const paneIndex = workspace?.panes.findIndex((pane) => pane.paneId === normalizedPaneId) ?? -1
  if (!workspace || paneIndex < 0) return workspaces
  const source = workspace.panes[paneIndex]
  const pane: SessionRightPanelPane = {
    ...source,
    paneId: createInstanceKey('right-panel-pane'),
    instanceKey: createInstanceKey('right-panel-pane-instance'),
    childPanelFocusRequest: { ...source.childPanelFocusRequest },
    fileTreeInitialDirectory: source.fileTreeInitialDirectory
      ? { ...source.fileTreeInitialDirectory }
      : null,
    history: { ...source.history, entries: [...source.history.entries] }
  }
  const panes = [...workspace.panes]
  panes.splice(paneIndex + 1, 0, pane)
  return {
    ...workspaces,
    [normalized]: { ...workspace, panes, focusedPaneId: pane.paneId }
  }
}

export function closeSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  const workspace = workspaces[normalized]
  if (!workspace?.panes.some((pane) => pane.paneId === normalizedPaneId)) return workspaces
  const panes = workspace.panes.filter((pane) => pane.paneId !== normalizedPaneId)
  return {
    ...workspaces,
    [normalized]: {
      ...workspace,
      panes,
      focusedPaneId: focusedPaneIdAfterRemoval(workspace, panes)
    }
  }
}

export function rebindSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined,
  binding: SessionRightPanelPaneBinding,
  options: SessionRightPanelPaneUpdateOptions = {}
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  return replacePane(workspaces, normalized, normalizedPaneId, (pane) => {
    const hasFileTreeWorkspaceOverride = Object.prototype.hasOwnProperty.call(
      binding,
      'fileTreeWorkspaceOverride'
    )
    const hasFileTreeInitialDirectory = Object.prototype.hasOwnProperty.call(
      binding,
      'fileTreeInitialDirectory'
    )
    const boundState = paneStateFromBinding({
      ...binding,
      childPanelFocusRequest:
        binding.childPanelFocusRequest ?? pane.childPanelFocusRequest,
      fileTreeWorkspaceOverride:
        hasFileTreeWorkspaceOverride
          ? binding.fileTreeWorkspaceOverride
          : pane.fileTreeWorkspaceOverride,
      fileTreeInitialDirectory:
        hasFileTreeInitialDirectory
          ? binding.fileTreeInitialDirectory
          : pane.fileTreeInitialDirectory
    })
    return updatePaneAndHistory(pane, boundState, options)
  })
}

export function placeSessionRightPanelPane(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  binding: SessionRightPanelPaneBinding,
  placement: SessionRightPanelPlacement = 'focused',
  options: SessionRightPanelPaneUpdateOptions & { width?: number } = {}
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  if (!normalized) return workspaces
  const workspace = workspaces[normalized]
  const focusedPane = focusedSessionRightPanelPane(workspace)
  if (placement === 'focused' && focusedPane) {
    const rebound = rebindSessionRightPanelPane(
      workspaces,
      normalized,
      focusedPane.paneId,
      binding,
      options
    )
    return options.width === undefined
      ? rebound
      : setSessionRightPanelPaneWidth(rebound, normalized, focusedPane.paneId, options.width)
  }
  return addSessionRightPanelPane(workspaces, normalized, binding, {
    afterPaneId: workspace?.focusedPaneId,
    width: options.width
  })
}

export function navigateSessionRightPanelPaneHistory(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined,
  offset: -1 | 1
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId) return workspaces
  return replacePane(workspaces, normalized, normalizedPaneId, (pane) => {
    const history = moveSessionRightPanelHistory(pane.history, offset)
    if (history === pane.history) return pane
    const entry = history.entries[history.index]
    return {
      ...pane,
      mode: entry.mode,
      filePreviewTarget: entry.filePreviewTarget,
      filePreviewReturnContext: entry.filePreviewReturnContext,
      panelActivation: entry.panelActivation,
      history
    }
  })
}

export function setSessionRightPanelPaneWidth(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  paneId: string | null | undefined,
  width: number
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedPaneId = paneId?.trim()
  if (!normalized || !normalizedPaneId || !Number.isFinite(width)) {
    return workspaces
  }
  const normalizedWidth = Math.max(SESSION_RIGHT_PANEL_MIN_WIDTH, width)
  return replacePane(workspaces, normalized, normalizedPaneId, (pane) =>
    pane.width === normalizedWidth ? pane : { ...pane, width: normalizedWidth }
  )
}

export function discardSessionRightPanelResource(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string | null | undefined,
  mode: 'file',
  target: WorkspaceFileTarget
): SessionRightPanelWorkspaceMap {
  const normalized = normalizedSessionId(sessionId)
  const normalizedResourcePath = target.path.trim()
  const normalizedWorkspaceRoot = workspaceRootIdentityKey(target.workspaceRoot)
  if (!normalized || !normalizedResourcePath) return workspaces
  const workspace = workspaces[normalized]
  if (!workspace) return workspaces

  const matchesTarget = (candidate: WorkspaceFileTarget | null): boolean => {
    if (candidate?.path.trim() !== normalizedResourcePath) return false
    return !normalizedWorkspaceRoot
      || workspaceRootIdentityKey(candidate.workspaceRoot) === normalizedWorkspaceRoot
  }

  let changed = false
  const panes = workspace.panes.flatMap((pane) => {
    const matchesCurrent = pane.mode === mode && matchesTarget(pane.filePreviewTarget)
    if (matchesCurrent) {
      changed = true
      return []
    }

    const retainedEntries: SessionRightPanelHistoryEntry[] = []
    let retainedIndex = -1
    pane.history.entries.forEach((entry, index) => {
      const matches = entry.mode === mode && matchesTarget(entry.filePreviewTarget)
      if (matches) {
        changed = true
        return
      }
      retainedEntries.push(entry)
      if (index <= pane.history.index) retainedIndex = retainedEntries.length - 1
    })
    if (retainedEntries.length === pane.history.entries.length) return [pane]
    return [{
      ...pane,
      history: {
        entries: retainedEntries,
        index: retainedEntries.length === 0 ? -1 : retainedIndex
      }
    }]
  })

  if (!changed) return workspaces
  return {
    ...workspaces,
    [normalized]: {
      ...workspace,
      panes,
      focusedPaneId: focusedPaneIdAfterRemoval(workspace, panes)
    }
  }
}

export function sessionRightPanelWorkspaceList(
  workspaces: SessionRightPanelWorkspaceMap
): SessionRightPanelWorkspace[] {
  return Object.values(workspaces)
}
