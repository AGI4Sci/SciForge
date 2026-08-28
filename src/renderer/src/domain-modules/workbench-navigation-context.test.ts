import { describe, expect, it, vi } from 'vitest'

import { buildWorkbenchNavigationSectionRenderContext } from './workbench-navigation-context'

describe('Workbench navigation section context', () => {
  it('projects bounded ordinary Sessions and delegates only exact catalog selections', () => {
    const selectSession = vi.fn()
    const context = buildWorkbenchNavigationSectionRenderContext({
      active: true,
      className: 'navigation-section',
      session: {
        id: 'thread-active',
        title: 'Active session',
        runtimeId: 'codex',
        workspaceRoot: '/workspace'
      },
      threads: [{
        id: ' thread-active ',
        title: ' Active session ',
        updatedAt: '2026-08-28T00:00:00.000Z',
        model: 'auto',
        mode: 'agent',
        runtimeId: 'codex',
        workspace: '/workspace',
        status: 'idle',
        archived: false
      }],
      selectSession
    })

    expect(context.sessions).toEqual([{
      id: 'thread-active',
      title: 'Active session',
      updatedAt: '2026-08-28T00:00:00.000Z',
      runtimeId: 'codex',
      workspaceRoot: '/workspace',
      status: 'idle',
      archived: false
    }])
    context.selectSession(' thread-active ')
    context.selectSession('thread-not-in-catalog')
    expect(selectSession).toHaveBeenCalledTimes(1)
    expect(selectSession).toHaveBeenCalledWith('thread-active')
  })

  it('uses the current draft presentation owner without inventing a Session row', () => {
    const context = buildWorkbenchNavigationSectionRenderContext({
      active: true,
      className: 'navigation-section',
      session: { id: 'draft:/workspace', workspaceRoot: '/workspace' },
      threads: [],
      selectSession: vi.fn()
    })

    expect(context.session.id).toBe('draft:/workspace')
    expect(context.sessions).toEqual([])
  })
})
