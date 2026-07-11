import { describe, expect, it } from 'vitest'

import {
  fitWorkbenchWidths,
  moveRightPanelHistory,
  projectDagReturnSelection,
  pushRightPanelHistoryEntry,
  shouldCloseRightPanelOnThreadChange
} from './workbench-layout'

describe('right panel history', () => {
  const fileA = {
    mode: 'file' as const,
    filePreviewTarget: { path: '/workspace/a.md', workspaceRoot: '/workspace' },
    filePreviewReturnContext: null
  }
  const browser = {
    mode: 'browser' as const,
    filePreviewTarget: null,
    filePreviewReturnContext: null
  }
  const changes = {
    mode: 'changes' as const,
    filePreviewTarget: null,
    filePreviewReturnContext: null
  }

  it('moves backward and forward across right panel states', () => {
    let history = pushRightPanelHistoryEntry({ entries: [], index: -1 }, fileA)
    history = pushRightPanelHistoryEntry(history, browser)

    history = moveRightPanelHistory(history, -1)
    expect(history.entries[history.index]).toEqual(fileA)
    history = moveRightPanelHistory(history, 1)
    expect(history.entries[history.index]).toEqual(browser)
  })

  it('drops the forward branch when a new state opens after going back', () => {
    let history = pushRightPanelHistoryEntry({ entries: [], index: -1 }, fileA)
    history = pushRightPanelHistoryEntry(history, browser)
    history = moveRightPanelHistory(history, -1)
    history = pushRightPanelHistoryEntry(history, changes)

    expect(history.entries).toEqual([fileA, changes])
    expect(moveRightPanelHistory(history, 1)).toBe(history)
  })

  it('does not duplicate the current state', () => {
    const history = pushRightPanelHistoryEntry({ entries: [], index: -1 }, fileA)
    expect(pushRightPanelHistoryEntry(history, fileA)).toBe(history)
  })
})

describe('projectDagReturnSelection', () => {
  it('preserves the legacy Claim fallback and a validated graph node', () => {
    expect(projectDagReturnSelection({
      kind: 'project-dag',
      claimId: 'claim:source',
      nodeId: 'evidence:source-1'
    })).toEqual({ claimId: 'claim:source', nodeId: 'evidence:source-1' })
  })

  it('drops malformed graph node IDs without losing a valid Claim fallback', () => {
    expect(projectDagReturnSelection({
      kind: 'project-dag',
      claimId: 'claim:source',
      nodeId: '../evidence source'
    })).toEqual({ claimId: 'claim:source' })
    expect(projectDagReturnSelection({
      kind: 'project-dag',
      nodeId: `evidence:${'a'.repeat(512)}`
    })).toBeNull()
  })
})

describe('fitWorkbenchWidths', () => {
  it('allows the right panel to consume the remaining width', () => {
    const widths = fitWorkbenchWidths(1480, 280, 2000, {
      leftPanelVisible: true,
      rightPanelVisible: true
    })

    expect(widths.left).toBe(280)
    expect(widths.right).toBe(1186)
  })

  it('allows the right panel to use the full stage when it is the only side panel', () => {
    const widths = fitWorkbenchWidths(1280, 304, 2000, {
      leftPanelVisible: false,
      rightPanelVisible: true
    })

    expect(widths.right).toBe(1273)
  })

  it('keeps a visible right panel usable when the stored width is tiny', () => {
    const widths = fitWorkbenchWidths(1480, 280, -200, {
      leftPanelVisible: true,
      rightPanelVisible: true
    })

    expect(widths.left).toBe(280)
    expect(widths.right).toBe(300)
  })
})

describe('shouldCloseRightPanelOnThreadChange', () => {
  it('keeps file previews open across thread changes', () => {
    expect(shouldCloseRightPanelOnThreadChange('file')).toBe(false)
  })

  it('closes thread-bound right panels across thread changes', () => {
    expect(shouldCloseRightPanelOnThreadChange('child-agents')).toBe(true)
  })

  it('keeps the web preview open across thread changes', () => {
    expect(shouldCloseRightPanelOnThreadChange('browser')).toBe(false)
  })
})
