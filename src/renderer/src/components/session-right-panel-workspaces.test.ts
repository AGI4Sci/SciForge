import { describe, expect, it } from 'vitest'

import { draftSessionRightPanelId } from '../lib/session-right-panel-owner'
import {
  addSessionRightPanelPane,
  closeSessionRightPanelPane,
  discardSessionRightPanelResource,
  ensureSessionRightPanelWorkspace,
  focusSessionRightPanelPane,
  focusedSessionRightPanelPane,
  moveSessionRightPanelWorkspaceOwner,
  navigateSessionRightPanelPaneHistory,
  placeSessionRightPanelPane,
  rebindSessionRightPanelPane,
  removeSessionRightPanelWorkspace,
  sessionRightPanelPaneById,
  sessionRightPanelWorkspaceList,
  setSessionRightPanelPaneWidth,
  splitSessionRightPanelPane,
  updateSessionRightPanelPane,
  type SessionRightPanelPane,
  type SessionRightPanelWorkspaceMap
} from './session-right-panel-workspaces'

function workspacesFor(...sessionIds: string[]): SessionRightPanelWorkspaceMap {
  return sessionIds.reduce<SessionRightPanelWorkspaceMap>(
    (workspaces, sessionId) => ensureSessionRightPanelWorkspace(workspaces, sessionId),
    {}
  )
}

function paneAt(
  workspaces: SessionRightPanelWorkspaceMap,
  sessionId: string,
  index: number
): SessionRightPanelPane {
  const pane = workspaces[sessionId]?.panes[index]
  if (!pane) throw new Error(`Missing pane ${index} for ${sessionId}`)
  return pane
}

describe('Session right-panel workspaces', () => {
  it('derives one stable draft owner from the workspace root', () => {
    expect(draftSessionRightPanelId(' /workspace/project a ')).toBe(
      'right-panel-draft:%2Fworkspace%2Fproject%20a'
    )
    expect(draftSessionRightPanelId('')).toBeNull()
  })

  it('creates an empty Session dock with no legacy singleton page state', () => {
    const workspaces = workspacesFor(' session-1 ')

    expect(workspaces['session-1']).toMatchObject({
      sessionId: 'session-1',
      panes: [],
      focusedPaneId: null
    })
    expect(workspaces['session-1']).not.toHaveProperty('mode')
    expect(workspaces['session-1']).not.toHaveProperty('width')
    expect(workspaces['session-1']).not.toHaveProperty('history')
  })

  it('keeps file targets, history, widths, and updates independent between panes', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'paper/first.pdf',
        workspaceRoot: '/workspace/shared',
        line: 12
      }
    }, 'focused', { width: 410 })
    const first = paneAt(workspaces, 'session-1', 0)
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'paper/second.pdf',
        workspaceRoot: '/workspace/shared',
        line: 88
      }
    }, 'new', { width: 620 })
    const second = paneAt(workspaces, 'session-1', 1)
    const secondHistory = second.history

    workspaces = updateSessionRightPanelPane(
      workspaces,
      'session-1',
      first.paneId,
      {
        filePreviewTarget: {
          path: 'paper/first-revised.pdf',
          workspaceRoot: '/workspace/shared',
          line: 37
        }
      }
    )
    workspaces = setSessionRightPanelPaneWidth(
      workspaces,
      'session-1',
      first.paneId,
      492
    )

    expect(sessionRightPanelPaneById(workspaces['session-1'], first.paneId)).toMatchObject({
      width: 492,
      filePreviewTarget: { path: 'paper/first-revised.pdf', line: 37 },
      history: { index: 1 }
    })
    expect(sessionRightPanelPaneById(workspaces['session-1'], second.paneId)).toBe(second)
    expect(second).toMatchObject({
      width: 620,
      filePreviewTarget: { path: 'paper/second.pdf', line: 88 }
    })
    expect(second.history).toBe(secondHistory)
  })

  it('enforces the shared hard minimum without recording width navigation', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(
      workspaces,
      'session-1',
      { mode: 'file' },
      { width: 120 }
    )
    const pane = paneAt(workspaces, 'session-1', 0)
    const history = pane.history

    workspaces = setSessionRightPanelPaneWidth(
      workspaces,
      'session-1',
      pane.paneId,
      180
    )

    expect(paneAt(workspaces, 'session-1', 0)).toMatchObject({ width: 300 })
    expect(paneAt(workspaces, 'session-1', 0).history).toBe(history)
    expect(setSessionRightPanelPaneWidth(
      workspaces,
      'session-1',
      pane.paneId,
      Number.NaN
    )).toBe(workspaces)
  })

  it('splits a pane adjacently with duplicate mode and independent stable identities', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'fixture.contributed',
      panelActivation: {
        contributionId: 'fixture.panel',
        revision: 1,
        payload: { nodeId: 'node-1' }
      }
    })
    const source = paneAt(workspaces, 'session-1', 0)

    workspaces = splitSessionRightPanelPane(workspaces, 'session-1', source.paneId)
    const duplicate = paneAt(workspaces, 'session-1', 1)

    expect(workspaces['session-1'].focusedPaneId).toBe(duplicate.paneId)
    expect(duplicate).toMatchObject({
      mode: source.mode,
      width: source.width,
      panelActivation: source.panelActivation
    })
    expect(duplicate.paneId).not.toBe(source.paneId)
    expect(duplicate.instanceKey).not.toBe(source.instanceKey)
    expect(duplicate.history).not.toBe(source.history)
    expect(duplicate.history.entries).not.toBe(source.history.entries)

    workspaces = updateSessionRightPanelPane(
      workspaces,
      'session-1',
      source.paneId,
      { panelActivation: { contributionId: 'fixture.panel', revision: 2, payload: null } }
    )
    expect(sessionRightPanelPaneById(workspaces['session-1'], duplicate.paneId)).toBe(duplicate)
  })

  it('applies focused placement in place and new placement adjacent to current focus', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', { mode: 'file' })
    const first = paneAt(workspaces, 'session-1', 0)
    workspaces = placeSessionRightPanelPane(
      workspaces,
      'session-1',
      { mode: 'fixture.first' },
      'new'
    )
    const second = paneAt(workspaces, 'session-1', 1)
    workspaces = focusSessionRightPanelPane(workspaces, 'session-1', first.paneId)

    workspaces = placeSessionRightPanelPane(
      workspaces,
      'session-1',
      { mode: 'fixture.focused' },
      'focused',
      { width: 515 }
    )

    expect(workspaces['session-1'].panes).toHaveLength(2)
    expect(paneAt(workspaces, 'session-1', 0)).toMatchObject({
      paneId: first.paneId,
      instanceKey: first.instanceKey,
      mode: 'fixture.focused',
      width: 515
    })
    expect(paneAt(workspaces, 'session-1', 1)).toBe(second)

    workspaces = placeSessionRightPanelPane(
      workspaces,
      'session-1',
      { mode: 'fixture.new' },
      'new'
    )
    const inserted = paneAt(workspaces, 'session-1', 1)
    expect(workspaces['session-1'].panes.map((pane) => pane.mode)).toEqual([
      'fixture.focused',
      'fixture.new',
      'fixture.first'
    ])
    expect(workspaces['session-1'].focusedPaneId).toBe(inserted.paneId)
  })

  it('rebinds only the addressed pane and restores its activation through local history', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'fixture.first',
      panelActivation: {
        contributionId: 'fixture.first.panel',
        revision: 1,
        payload: { nodeId: 'node-1' }
      }
    })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'fixture.untouched'
    })
    const first = paneAt(workspaces, 'session-1', 0)
    const untouched = paneAt(workspaces, 'session-1', 1)

    workspaces = rebindSessionRightPanelPane(
      workspaces,
      'session-1',
      first.paneId,
      {
        mode: 'fixture.second',
        panelActivation: {
          contributionId: 'fixture.second.panel',
          revision: 2,
          payload: { nodeId: 'node-2' }
        }
      }
    )
    workspaces = navigateSessionRightPanelPaneHistory(
      workspaces,
      'session-1',
      first.paneId,
      -1
    )

    expect(sessionRightPanelPaneById(workspaces['session-1'], first.paneId)).toMatchObject({
      mode: 'fixture.first',
      panelActivation: {
        contributionId: 'fixture.first.panel',
        revision: 1,
        payload: { nodeId: 'node-1' }
      },
      history: { index: 0 }
    })
    expect(sessionRightPanelPaneById(workspaces['session-1'], untouched.paneId)).toBe(untouched)
  })

  it('preserves omitted file-tree state and clears explicit nullable binding state', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      fileTreeWorkspaceOverride: '/workspace/alternate',
      fileTreeInitialDirectory: {
        workspaceRoot: '/workspace/alternate',
        path: 'papers',
        nonce: 1
      }
    })
    const paneId = paneAt(workspaces, 'session-1', 0).paneId

    workspaces = rebindSessionRightPanelPane(
      workspaces,
      'session-1',
      paneId,
      { mode: 'fixture.contributed' }
    )
    expect(sessionRightPanelPaneById(workspaces['session-1'], paneId)).toMatchObject({
      fileTreeWorkspaceOverride: '/workspace/alternate',
      fileTreeInitialDirectory: {
        workspaceRoot: '/workspace/alternate',
        path: 'papers',
        nonce: 1
      }
    })

    workspaces = rebindSessionRightPanelPane(
      workspaces,
      'session-1',
      paneId,
      {
        mode: 'file',
        fileTreeWorkspaceOverride: null,
        fileTreeInitialDirectory: null
      }
    )
    expect(sessionRightPanelPaneById(workspaces['session-1'], paneId)).toMatchObject({
      fileTreeWorkspaceOverride: null,
      fileTreeInitialDirectory: null
    })
  })

  it('routes a mounted hidden-pane callback by explicit pane identity after focus changes', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'file' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'file' })
    const hiddenOwner = paneAt(workspaces, 'session-1', 0)
    const focused = paneAt(workspaces, 'session-1', 1)

    workspaces = updateSessionRightPanelPane(
      workspaces,
      'session-1',
      hiddenOwner.paneId,
      { childPanelFocusRequest: { childId: 'child-from-hidden-pane', key: 1 } },
      { recordHistory: false }
    )

    expect(workspaces['session-1'].focusedPaneId).toBe(focused.paneId)
    expect(sessionRightPanelPaneById(workspaces['session-1'], hiddenOwner.paneId))
      .toMatchObject({ childPanelFocusRequest: { childId: 'child-from-hidden-pane', key: 1 } })
    expect(sessionRightPanelPaneById(workspaces['session-1'], focused.paneId)).toBe(focused)
  })

  it('moves focus to the right neighbor, then left, and hides an empty dock', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'fixture.first' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'fixture.second' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'fixture.third' })
    const [first, second, third] = workspaces['session-1'].panes
    workspaces = focusSessionRightPanelPane(workspaces, 'session-1', second.paneId)

    workspaces = closeSessionRightPanelPane(workspaces, 'session-1', second.paneId)
    expect(workspaces['session-1'].focusedPaneId).toBe(third.paneId)
    expect(workspaces['session-1'].panes).toEqual([first, third])

    workspaces = closeSessionRightPanelPane(workspaces, 'session-1', third.paneId)
    expect(workspaces['session-1'].focusedPaneId).toBe(first.paneId)

    workspaces = closeSessionRightPanelPane(workspaces, 'session-1', first.paneId)
    expect(workspaces['session-1']).toMatchObject({ panes: [], focusedPaneId: null })
  })

  it('discards every current matching resource and only matching history entries', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: { path: 'deleted.pdf', workspaceRoot: '/workspace' }
    })
    const first = paneAt(workspaces, 'session-1', 0)
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: { path: 'deleted.pdf', workspaceRoot: '/workspace' }
    }, 'new')
    workspaces = placeSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: { path: 'deleted.pdf', workspaceRoot: '/workspace' }
    }, 'new')
    const survivorId = workspaces['session-1'].focusedPaneId!
    workspaces = updateSessionRightPanelPane(
      workspaces,
      'session-1',
      survivorId,
      { filePreviewTarget: { path: 'kept.pdf', workspaceRoot: '/workspace' } }
    )
    workspaces = focusSessionRightPanelPane(workspaces, 'session-1', first.paneId)

    workspaces = discardSessionRightPanelResource(
      workspaces,
      'session-1',
      'file',
      { path: ' deleted.pdf ' }
    )

    expect(workspaces['session-1'].panes).toHaveLength(1)
    expect(workspaces['session-1'].focusedPaneId).toBe(survivorId)
    expect(paneAt(workspaces, 'session-1', 0)).toMatchObject({
      paneId: survivorId,
      filePreviewTarget: { path: 'kept.pdf' },
      history: { index: 0 }
    })
    expect(paneAt(workspaces, 'session-1', 0).history.entries).toEqual([
      expect.objectContaining({ filePreviewTarget: expect.objectContaining({ path: 'kept.pdf' }) })
    ])
  })

  it('qualifies resource discard by normalized workspace root when supplied', () => {
    let workspaces = workspacesFor('session-1')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'shared/report.pdf',
        workspaceRoot: '/Workspace/First/'
      }
    })
    const first = paneAt(workspaces, 'session-1', 0)
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'shared/report.pdf',
        workspaceRoot: '/workspace/second'
      }
    })
    const second = paneAt(workspaces, 'session-1', 1)

    workspaces = discardSessionRightPanelResource(
      workspaces,
      'session-1',
      'file',
      { path: 'shared/report.pdf', workspaceRoot: '/workspace/first' }
    )

    expect(workspaces['session-1'].panes).toEqual([second])
    expect(workspaces['session-1'].focusedPaneId).toBe(second.paneId)
    expect(workspaces['session-1'].panes).not.toContain(first)

    workspaces = discardSessionRightPanelResource(
      workspaces,
      'session-1',
      'file',
      { path: 'shared/report.pdf' }
    )
    expect(workspaces['session-1']).toMatchObject({ panes: [], focusedPaneId: null })
  })

  it('does not impose a pane-count limit', () => {
    let workspaces = workspacesFor('session-1')
    for (let index = 0; index < 75; index += 1) {
      workspaces = placeSessionRightPanelPane(
        workspaces,
        'session-1',
        { mode: 'fixture.duplicate' },
        'new'
      )
    }

    expect(workspaces['session-1'].panes).toHaveLength(75)
    expect(new Set(workspaces['session-1'].panes.map((pane) => pane.paneId)).size).toBe(75)
    expect(new Set(workspaces['session-1'].panes.map((pane) => pane.instanceKey)).size).toBe(75)
  })

  it('preserves every pane and its mounted identity across Session switching', () => {
    let workspaces = workspacesFor('session-1', 'session-2')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'file' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'fixture.first' })
    const sessionOne = workspaces['session-1']
    const sessionOnePanes = [...sessionOne.panes]
    workspaces = addSessionRightPanelPane(workspaces, 'session-2', { mode: 'fixture.second' })

    expect(sessionRightPanelWorkspaceList(workspaces)).toEqual([
      sessionOne,
      workspaces['session-2']
    ])
    expect(workspaces['session-1']).toBe(sessionOne)
    expect(workspaces['session-1'].panes).toEqual(sessionOnePanes)
    expect(focusedSessionRightPanelPane(workspaces['session-1']))
      .toBe(sessionOnePanes[1])
  })

  it('rekeys a complete dock without replacing workspace or pane identities', () => {
    let workspaces = workspacesFor('session-1', 'session-2')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'file',
      filePreviewTarget: {
        path: 'paper/report.pdf',
        workspaceRoot: '/workspace/shared',
        line: 37
      }
    }, { width: 492 })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', {
      mode: 'fixture.contributed'
    })
    const original = workspaces['session-1']
    const originalPanes = original.panes
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
      focusedPaneId: original.focusedPaneId
    })
    expect(workspaces['session-promoted'].panes).toBe(originalPanes)
    expect(workspaces['session-2']).toBe(untouched)
  })

  it('preserves the canonical target dock and discards the source when a rekey collides', () => {
    let workspaces = workspacesFor('session-source', 'session-target')
    workspaces = addSessionRightPanelPane(workspaces, 'session-source', { mode: 'file' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-target', {
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
  })

  it('removes every pane for exactly one disposed Session', () => {
    let workspaces = workspacesFor('session-1', 'session-2')
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'file' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-1', { mode: 'fixture.first' })
    workspaces = addSessionRightPanelPane(workspaces, 'session-2', { mode: 'fixture.second' })
    const untouched = workspaces['session-2']

    workspaces = removeSessionRightPanelWorkspace(workspaces, ' session-1 ')

    expect(workspaces['session-1']).toBeUndefined()
    expect(workspaces['session-2']).toBe(untouched)
    expect(removeSessionRightPanelWorkspace(workspaces, '')).toBe(workspaces)
    expect(removeSessionRightPanelWorkspace(workspaces, 'missing')).toBe(workspaces)
  })
})
