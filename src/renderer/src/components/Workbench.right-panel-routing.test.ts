import { describe, expect, it } from 'vitest'
import {
  addSessionRightPanelPane,
  createSessionRightPanelWorkspace
} from './session-right-panel-workspaces'
import { resolveRightPanelLaunchTarget } from './Workbench'

function workspaceWithPane() {
  const sessionId = 'session-a'
  const map = addSessionRightPanelPane(
    { [sessionId]: createSessionRightPanelWorkspace(sessionId) },
    sessionId,
    { mode: 'file' }
  )
  return map[sessionId]
}

describe('Workbench right-panel launch routing', () => {
  it('defaults ordinary launches to the focused-pane placement policy', () => {
    expect(resolveRightPanelLaunchTarget(workspaceWithPane(), {})).toEqual({
      kind: 'placement',
      placement: 'focused'
    })
    expect(resolveRightPanelLaunchTarget(workspaceWithPane(), { placement: 'new' })).toEqual({
      kind: 'placement',
      placement: 'new'
    })
  })

  it('routes a mounted surface identity to that exact pane', () => {
    const workspace = workspaceWithPane()
    const paneId = workspace.panes[0].paneId

    expect(resolveRightPanelLaunchTarget(workspace, { surfaceId: paneId })).toEqual({
      kind: 'exact',
      paneId
    })
  })

  it('never falls back when an exact surface is stale or the request is ambiguous', () => {
    const workspace = workspaceWithPane()

    expect(resolveRightPanelLaunchTarget(workspace, { surfaceId: 'missing-pane' })).toBeNull()
    expect(resolveRightPanelLaunchTarget(workspace, {
      placement: 'new',
      surfaceId: workspace.panes[0].paneId
    })).toBeNull()
    expect(resolveRightPanelLaunchTarget(workspace, { placement: 'unexpected' })).toBeNull()
  })
})
