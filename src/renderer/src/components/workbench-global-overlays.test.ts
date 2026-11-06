import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { resolveWorkbenchOverlaySession, updateWorkbenchGlobalOverlays, type WorkbenchGlobalOverlays } from './workbench-global-overlays'

describe('Workbench overlay ownership and placement', () => {
  const owner = { id: 'source', title: 'Source', runtimeId: 'codex', workspaceRoot: '/source' }
  const empty: WorkbenchGlobalOverlays = { window: null, workspace: null }

  it('keeps the canvas selection mounted while opening and closing a window overlay', () => {
    const canvas = updateWorkbenchGlobalOverlays(empty, 'workspace', { contributionId: 'canvas', open: true }, owner)
    const both = updateWorkbenchGlobalOverlays(canvas, 'window', { contributionId: 'annotations', open: true }, owner)
    expect(both.workspace).toBe(canvas.workspace)
    expect(both.window?.session).toBe(owner)
    const closed = updateWorkbenchGlobalOverlays(both, 'window', { contributionId: 'annotations', open: false })
    expect(closed.workspace).toBe(canvas.workspace)
    expect(closed.window).toBeNull()
    expect(updateWorkbenchGlobalOverlays(closed, 'workspace', { contributionId: 'canvas', open: false })).toEqual(empty)
  })

  it('closes only the requested contribution in its placement', () => {
    const canvas = updateWorkbenchGlobalOverlays(empty, 'workspace', { contributionId: 'canvas' }, owner)
    expect(updateWorkbenchGlobalOverlays(canvas, 'window', { contributionId: 'canvas', open: false })).toBe(canvas)
    expect(updateWorkbenchGlobalOverlays(canvas, 'workspace', { contributionId: 'other', open: false })).toBe(canvas)
    expect(updateWorkbenchGlobalOverlays(canvas, 'workspace', { contributionId: 'canvas' })).toEqual(empty)
  })

  it('resolves all metadata from the requested owner after active navigation changes', () => {
    const threads: NormalizedThread[] = [
      { id: 'other', title: 'Other', runtimeId: 'claude', workspace: '/other', model: '', mode: 'agent', updatedAt: '' },
      { id: 'source', title: 'Source renamed', runtimeId: 'codex', workspace: '/source', model: '', mode: 'agent', updatedAt: '' }
    ]
    expect(resolveWorkbenchOverlaySession('source', threads, owner)).toEqual({ ...owner, title: 'Source renamed' })
    expect(resolveWorkbenchOverlaySession('unknown', threads, owner)).toBeUndefined()
    expect(resolveWorkbenchOverlaySession('source', [], owner)).toBe(owner)
    expect(updateWorkbenchGlobalOverlays(empty, 'workspace', { contributionId: 'canvas' })).toBe(empty)
  })
})
