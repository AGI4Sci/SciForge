import { describe, expect, it } from 'vitest'
import { RIGHT_PANEL_MODES } from './chat/WorkbenchTopBar'
import { buildRightPanelVisibleContextComponent } from './Workbench'

const UPDATED_AT = '2026-07-19T00:00:00.000Z'

describe('Workbench right-panel visible context', () => {
  it('publishes every right-panel mode through the same session-owned component', () => {
    for (const mode of RIGHT_PANEL_MODES) {
      const component = buildRightPanelVisibleContextComponent({
        mode,
        sessionId: 'session-a',
        width: 420,
        workspaceRoot: '/workspace/a',
        updatedAt: UPDATED_AT
      })

      expect(component.id).toBe('right-sidebar')
      expect(component.region).toBe('right-sidebar')
      expect(component.component).toBe('right-panel')
      expect(component.state).toMatchObject({
        mode,
        sessionId: 'session-a',
        width: 420,
        currentResource: {
          sessionId: 'session-a',
          workspaceRoot: '/workspace/a'
        }
      })
    }
  })

  it('derives contributed panel context metadata from the registry', () => {
    const component = buildRightPanelVisibleContextComponent({
      mode: 'paper',
      sessionId: 'session-a',
      width: 420,
      workspaceRoot: '/workspace/a',
      updatedAt: UPDATED_AT
    })

    expect(component.title).toBe('Paper radar')
    expect(component.state?.currentResource).toMatchObject({
      kind: 'paper-radar',
      title: 'Paper radar',
      sessionId: 'session-a'
    })
  })

  it('switches modes without retaining resource state from the previous panel', () => {
    const file = buildRightPanelVisibleContextComponent({
      mode: 'file',
      sessionId: 'session-a',
      width: 420,
      workspaceRoot: '/workspace/a',
      filePreviewTarget: {
        path: 'papers/current.pdf',
        workspaceRoot: '/workspace/a'
      },
      updatedAt: UPDATED_AT
    })
    const changes = buildRightPanelVisibleContextComponent({
      mode: 'changes',
      sessionId: 'session-a',
      width: 500,
      workspaceRoot: '/workspace/a',
      updatedAt: UPDATED_AT
    })

    expect(file.state?.currentResource).toMatchObject({
      kind: 'workspace-file-preview',
      path: 'papers/current.pdf'
    })
    expect(changes.state).toMatchObject({
      mode: 'changes',
      width: 500,
      currentResource: {
        kind: 'session-changes'
      }
    })
    expect(changes.state?.currentResource).not.toHaveProperty('path')
  })

  it('isolates otherwise identical panels by their owning session', () => {
    const first = buildRightPanelVisibleContextComponent({
      mode: 'todo',
      sessionId: 'session-a',
      width: 360,
      workspaceRoot: '/workspace/a',
      updatedAt: UPDATED_AT
    })
    const second = buildRightPanelVisibleContextComponent({
      mode: 'todo',
      sessionId: 'session-b',
      width: 640,
      workspaceRoot: '/workspace/b',
      updatedAt: UPDATED_AT
    })

    expect(first.state).toMatchObject({
      sessionId: 'session-a',
      width: 360,
      currentResource: { sessionId: 'session-a', workspaceRoot: '/workspace/a' }
    })
    expect(second.state).toMatchObject({
      sessionId: 'session-b',
      width: 640,
      currentResource: { sessionId: 'session-b', workspaceRoot: '/workspace/b' }
    })
  })

  it('points at the canonical file-preview component without republishing its resource', () => {
    const component = buildRightPanelVisibleContextComponent({
      mode: 'file',
      sessionId: 'session-a',
      width: 480,
      workspaceRoot: '/workspace/a',
      filePreviewTarget: {
        path: 'papers/current.pdf',
        workspaceRoot: '/workspace/a'
      },
      updatedAt: UPDATED_AT
    })

    expect(component.resources).toBeUndefined()
    expect(component.state?.currentResource).toMatchObject({
      kind: 'workspace-file-preview',
      title: 'current.pdf',
      summary: 'Canonical workspace preview for current.pdf.',
      sessionId: 'session-a',
      workspaceRoot: '/workspace/a',
      path: 'papers/current.pdf',
      canonicalComponentId: 'right-sidebar.file-preview'
    })
  })
})
