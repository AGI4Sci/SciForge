import { describe, expect, it } from 'vitest'

import { RIGHT_PANEL_MODES, type RightPanelMode } from './chat/WorkbenchTopBar'
import { draftSessionRightPanelId } from '../lib/session-right-panel-owner'
import {
  ensureSessionRightPanelWorkspace,
  moveSessionRightPanelWorkspaceOwner,
  navigateSessionRightPanelHistory,
  updateSessionRightPanelWorkspace,
  type SessionRightPanelWorkspaceMap
} from './session-right-panel-workspaces'

type OpenRightPanelMode = Exclude<RightPanelMode, null>
type CoreRightPanelMode = (typeof RIGHT_PANEL_MODES)[number]

function nextMode(mode: CoreRightPanelMode): CoreRightPanelMode {
  const index = RIGHT_PANEL_MODES.indexOf(mode)
  return RIGHT_PANEL_MODES[(index + 1) % RIGHT_PANEL_MODES.length]
}

function workspacesFor(...sessionIds: string[]): SessionRightPanelWorkspaceMap {
  return sessionIds.reduce<SessionRightPanelWorkspaceMap>(
    (workspaces, sessionId) => ensureSessionRightPanelWorkspace(workspaces, sessionId),
    {}
  )
}

describe('Session right-panel workspaces', () => {
  it('derives one stable draft owner from the workspace root', () => {
    expect(draftSessionRightPanelId(' /workspace/project a ')).toBe(
      'right-panel-draft:%2Fworkspace%2Fproject%20a'
    )
    expect(draftSessionRightPanelId('')).toBeNull()
  })

  it.each(RIGHT_PANEL_MODES)(
    'keeps the %s mode on the same Session-owned state path',
    (mode) => {
      let workspaces = workspacesFor('session-1')
      workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
        mode,
        width: 428
      })
      const sessionOne = workspaces['session-1']
      const sessionOneHistory = sessionOne.history

      workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-2', {
        mode: nextMode(mode),
        width: 516
      })

      expect(workspaces['session-1']).toBe(sessionOne)
      expect(workspaces['session-1']).toMatchObject({
        sessionId: 'session-1',
        mode,
        width: 428,
        history: sessionOneHistory
      })
      expect(workspaces['session-2']).toMatchObject({
        sessionId: 'session-2',
        mode: nextMode(mode),
        width: 516
      })
      expect(workspaces['session-2'].history).not.toBe(sessionOneHistory)
    }
  )

  it('keeps history navigation and width changes isolated by Session', () => {
    const [firstMode, secondMode, thirdMode] = RIGHT_PANEL_MODES
    let workspaces = workspacesFor('session-1', 'session-2')
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: firstMode,
      width: 410
    })
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: secondMode,
      width: 440
    })
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-2', {
      mode: thirdMode,
      width: 620
    })
    const sessionTwo = workspaces['session-2']

    workspaces = navigateSessionRightPanelHistory(workspaces, 'session-1', -1)

    expect(workspaces['session-1']).toMatchObject({ mode: firstMode, width: 440 })
    expect(workspaces['session-1'].history).toMatchObject({ index: 0 })
    expect(workspaces['session-2']).toBe(sessionTwo)
    expect(workspaces['session-2']).toMatchObject({ mode: thirdMode, width: 620 })
  })

  it('restores contribution activation data with generic right-panel history', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: 'fixture.first',
      panelActivation: {
        contributionId: 'fixture.first.panel',
        revision: 1,
        payload: { nodeId: 'node-1' }
      }
    })
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: 'fixture.second',
      panelActivation: {
        contributionId: 'fixture.second.panel',
        revision: 2,
        payload: { nodeId: 'node-2' }
      }
    })

    workspaces = navigateSessionRightPanelHistory(workspaces, 'session-1', -1)

    expect(workspaces['session-1']).toMatchObject({
      mode: 'fixture.first',
      panelActivation: {
        contributionId: 'fixture.first.panel',
        revision: 1,
        payload: { nodeId: 'node-1' }
      }
    })
  })

  it('routes focused commands and hidden owner callbacks to exactly one Session', () => {
    const [focusedMode, ownerMode] = RIGHT_PANEL_MODES
    let workspaces = workspacesFor('session-1', 'session-2')
    const focusedSessionId = 'session-2'

    workspaces = updateSessionRightPanelWorkspace(workspaces, focusedSessionId, {
      mode: focusedMode
    })
    const focusedSession = workspaces[focusedSessionId]

    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: ownerMode,
      childPanelFocusRequest: { childId: 'child-from-session-1', key: 1 }
    })

    expect(workspaces[focusedSessionId]).toBe(focusedSession)
    expect(workspaces[focusedSessionId].childPanelFocusRequest).toEqual({
      childId: null,
      key: 0
    })
    expect(workspaces['session-1']).toMatchObject({
      mode: ownerMode,
      childPanelFocusRequest: { childId: 'child-from-session-1', key: 1 }
    })
  })

  it('does not merge two Sessions that use the same filesystem workspace', () => {
    let workspaces: SessionRightPanelWorkspaceMap = {}
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'paper/report.pdf',
        workspaceRoot: '/workspace/shared',
        line: 12
      }
    })
    const sessionOne = workspaces['session-1']
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-2', {
      mode: 'file',
      filePreviewTarget: {
        path: 'paper/report.pdf',
        workspaceRoot: '/workspace/shared',
        line: 88
      }
    })

    expect(workspaces['session-1']).toBe(sessionOne)
    expect(workspaces['session-1'].filePreviewTarget?.line).toBe(12)
    expect(workspaces['session-2'].filePreviewTarget?.line).toBe(88)
  })

  it('moves ownership without replacing the mounted workspace identity or its state', () => {
    let workspaces = workspacesFor('session-1', 'session-2')
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-1', {
      mode: 'file',
      width: 492,
      filePreviewTarget: {
        path: 'paper/report.pdf',
        workspaceRoot: '/workspace/shared',
        line: 37
      },
      childPanelFocusRequest: { childId: 'child-1', key: 4 }
    })
    const original = workspaces['session-1']
    const untouched = workspaces['session-2']

    workspaces = moveSessionRightPanelWorkspaceOwner(
      workspaces,
      ' session-1 ',
      ' session-promoted '
    )

    expect(workspaces['session-1']).toBeUndefined()
    expect(workspaces['session-promoted']).toMatchObject({
      instanceKey: original.instanceKey,
      sessionId: 'session-promoted',
      mode: 'file',
      width: 492,
      filePreviewTarget: { line: 37 },
      childPanelFocusRequest: { childId: 'child-1', key: 4 }
    })
    expect(workspaces['session-promoted'].history).toBe(original.history)
    expect(workspaces['session-2']).toBe(untouched)
  })

  it('preserves the canonical target workspace when a handoff collides', () => {
    let workspaces = workspacesFor('session-source', 'session-target')
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-source', { mode: 'file' })
    workspaces = updateSessionRightPanelWorkspace(workspaces, 'session-target', {
      mode: 'fixture.contributed'
    })
    const target = workspaces['session-target']

    workspaces = moveSessionRightPanelWorkspaceOwner(
      workspaces,
      'session-source',
      'session-target'
    )

    expect(workspaces['session-source']).toBeUndefined()
    expect(workspaces['session-target']).toBe(target)
    expect(workspaces['session-target'].mode).toBe('fixture.contributed')
  })
})
