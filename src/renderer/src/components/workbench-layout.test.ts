import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fitWorkbenchWidths,
  initialRightPanelMode,
  moveRightPanelHistory,
  normalizeRightPanelSessionContext,
  persistRightPanelContext,
  pruneRightPanelHistory,
  projectDagReturnSelection,
  pushRightPanelHistoryEntry,
  readStoredRightPanelContext,
  RIGHT_PANEL_SESSION_CONTEXT_KEY,
  shouldCloseRightPanelOnThreadChange,
  validateRestoredRightPanelContext
} from './workbench-layout'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('right panel session context', () => {
  it('restores only lightweight file and visual-review references', () => {
    expect(normalizeRightPanelSessionContext({
      version: 1,
      mode: 'file',
      workspaceRoot: '/workspace',
      threadId: 'ignored-for-file',
      filePreviewTarget: {
        path: 'paper/report.pdf',
        workspaceRoot: '/workspace',
        selection: { giant: 'payload must not survive' },
        content: 'sensitive content must not survive'
      },
      filePreviewReturnContext: {
        kind: 'evidence-dag',
        threadId: 'thread-1',
        nodeId: 'evidence:source-1',
        label: 'not persisted'
      }
    })).toEqual({
      version: 1,
      mode: 'file',
      workspaceRoot: '/workspace',
      filePreviewTarget: { path: 'paper/report.pdf', workspaceRoot: '/workspace' },
      filePreviewReturnContext: {
        kind: 'evidence-dag',
        threadId: 'thread-1',
        nodeId: 'evidence:source-1'
      }
    })

    expect(normalizeRightPanelSessionContext({
      version: 1,
      mode: 'visual-review',
      workspaceRoot: '/workspace',
      visualDocumentId: 'visual-thread-1',
      sourceImageBase64: 'must not survive'
    })).toEqual({
      version: 1,
      mode: 'visual-review',
      workspaceRoot: '/workspace',
      visualDocumentId: 'visual-thread-1'
    })
  })

  it('restores evidence and child-agent panels only for the same live thread', () => {
    const child = normalizeRightPanelSessionContext({
      version: 1,
      mode: 'child-agents',
      workspaceRoot: '/workspace',
      threadId: 'thread-1'
    })
    const evidence = normalizeRightPanelSessionContext({
      version: 1,
      mode: 'evidence',
      workspaceRoot: '/workspace',
      threadId: 'thread-1'
    })

    expect(validateRestoredRightPanelContext(child, {
      activeThreadId: 'thread-1',
      workspaceRoot: '/workspace'
    })).toEqual(child)
    expect(validateRestoredRightPanelContext(evidence, {
      activeThreadId: 'deleted-thread',
      workspaceRoot: '/workspace'
    })).toBeNull()
    expect(validateRestoredRightPanelContext(child, {
      activeThreadId: 'thread-1',
      workspaceRoot: '/other-workspace'
    })).toBeNull()
  })

  it('fails open for malformed targets and persistence payloads', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    })

    expect(normalizeRightPanelSessionContext({ version: 1, mode: 'file' })).toBeNull()
    expect(normalizeRightPanelSessionContext({ version: 1, mode: 'visual-review' })).toBeNull()
    expect(normalizeRightPanelSessionContext({ version: 1, mode: 'child-agents' })).toBeNull()

    persistRightPanelContext({
      version: 1,
      mode: 'visual-review',
      workspaceRoot: '/workspace',
      visualDocumentId: 'visual-1'
    })
    expect(readStoredRightPanelContext()).toEqual({
      version: 1,
      mode: 'visual-review',
      workspaceRoot: '/workspace',
      visualDocumentId: 'visual-1'
    })

    values.set(RIGHT_PANEL_SESSION_CONTEXT_KEY, '{broken')
    expect(readStoredRightPanelContext()).toBeNull()
  })

  it('does not apply legacy mode-only state to targeted panels', () => {
    expect(initialRightPanelMode(null, 'file')).toBeNull()
    expect(initialRightPanelMode(null, 'evidence')).toBeNull()
    expect(initialRightPanelMode(null, 'visual-review')).toBeNull()
    expect(initialRightPanelMode(null, 'changes')).toBe('changes')
    expect(initialRightPanelMode({
      version: 1,
      mode: 'child-agents',
      threadId: 'thread-1'
    }, null)).toBe('child-agents')
  })
})

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

  it('drops stale thread/workspace entries so back and forward cannot reopen them', () => {
    const history = {
      entries: [{
        mode: 'child-agents' as const,
        filePreviewTarget: null,
        filePreviewReturnContext: null,
        threadId: 'deleted-thread'
      }, {
        mode: 'evidence' as const,
        filePreviewTarget: null,
        filePreviewReturnContext: null,
        threadId: 'live-thread'
      }, {
        mode: 'file' as const,
        filePreviewTarget: { path: 'paper.pdf', workspaceRoot: '/deleted-workspace' },
        filePreviewReturnContext: null,
        workspaceRoot: '/deleted-workspace'
      }],
      index: 2
    }

    expect(pruneRightPanelHistory(history, {
      activeThreadId: 'live-thread',
      workspaceRoot: '/workspace'
    })).toEqual({
      entries: [expect.objectContaining({ mode: 'evidence', threadId: 'live-thread' })],
      index: 0
    })
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

  it('keeps child agents open so the panel follows the newly focused thread', () => {
    expect(shouldCloseRightPanelOnThreadChange('child-agents')).toBe(false)
  })

  it('keeps the web preview open across thread changes', () => {
    expect(shouldCloseRightPanelOnThreadChange('browser')).toBe(false)
  })
})
