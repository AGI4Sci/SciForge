import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RIGHT_PANEL_MODES, type RightPanelMode } from './chat/WorkbenchTopBar'
import { SessionRightPanelStack } from './SessionRightPanelStack'
import {
  createSessionRightPanelPane,
  createSessionRightPanelWorkspace,
  type SessionRightPanelWorkspace
} from './session-right-panel-workspaces'

function workspace(
  sessionId: string,
  modes: readonly Exclude<RightPanelMode, null>[]
): SessionRightPanelWorkspace {
  const panes = modes.map((mode, index) => ({
    ...createSessionRightPanelPane({ mode }),
    paneId: `${sessionId}-pane-${index + 1}`
  }))
  return {
    ...createSessionRightPanelWorkspace(sessionId),
    panes,
    focusedPaneId: panes[panes.length - 1]?.paneId ?? null
  }
}

function renderStack(
  workspaces: readonly SessionRightPanelWorkspace[],
  activeSessionId: string
): string {
  return renderToStaticMarkup(createElement(SessionRightPanelStack, {
    activeSessionId,
    workspaces,
    renderWorkspace: (entry, active) => createElement('div', {
      'data-rendered-session': entry.sessionId,
      'data-rendered-active': active ? 'true' : 'false'
    }, entry.panes.map((pane) => pane.mode).join(','))
  }))
}

function surfaceTag(markup: string, sessionId: string): string {
  const match = markup.match(new RegExp(
    `<section[^>]*data-session-right-panel-workspace="${sessionId}"[^>]*>`
  ))
  if (!match) throw new Error(`Missing right-panel surface for ${sessionId}.`)
  return match[0]
}

describe('SessionRightPanelStack', () => {
  it('keeps resident surfaces mounted and only switches foreground semantics', () => {
    const [firstMode, secondMode] = RIGHT_PANEL_MODES
    const workspaces = [
      workspace('session-1', [firstMode, secondMode]),
      workspace('session-2', [secondMode])
    ]

    const firstFocused = renderStack(workspaces, 'session-1')
    const firstActive = surfaceTag(firstFocused, 'session-1')
    const secondInactive = surfaceTag(firstFocused, 'session-2')

    expect(firstFocused.match(/data-session-right-panel-workspace=/g)).toHaveLength(2)
    expect(firstActive).toContain('data-right-panel-pane-count="2"')
    expect(firstActive).toContain('data-right-panel-focused-pane-id="session-1-pane-2"')
    expect(firstActive).toContain('data-active="true"')
    expect(firstActive).toContain('aria-hidden="false"')
    expect(firstActive).not.toContain(' inert=""')
    expect(firstActive).not.toContain('invisible')
    expect(secondInactive).toContain('data-right-panel-pane-count="1"')
    expect(secondInactive).toContain('data-right-panel-focused-pane-id="session-2-pane-1"')
    expect(secondInactive).toContain('data-active="false"')
    expect(secondInactive).toContain('aria-hidden="true"')
    expect(secondInactive).toContain('inert=""')
    expect(secondInactive).toContain('invisible pointer-events-none')
    expect(firstFocused).toContain('data-rendered-session="session-1" data-rendered-active="true"')
    expect(firstFocused).toContain('data-rendered-session="session-2" data-rendered-active="false"')

    const secondFocused = renderStack(workspaces, 'session-2')
    const firstInactive = surfaceTag(secondFocused, 'session-1')
    const secondActive = surfaceTag(secondFocused, 'session-2')

    expect(secondFocused.match(/data-session-right-panel-workspace=/g)).toHaveLength(2)
    expect(firstInactive).toContain('data-active="false"')
    expect(firstInactive).toContain('aria-hidden="true"')
    expect(firstInactive).toContain('inert=""')
    expect(firstInactive).toContain('invisible pointer-events-none')
    expect(secondActive).toContain('data-active="true"')
    expect(secondActive).toContain('aria-hidden="false"')
    expect(secondActive).not.toContain(' inert=""')
    expect(secondActive).not.toContain('invisible')
    expect(secondFocused).toContain('data-rendered-session="session-1" data-rendered-active="false"')
    expect(secondFocused).toContain('data-rendered-session="session-2" data-rendered-active="true"')
  })

  it('omits only closed workspaces whose pane collection is empty', () => {
    const [openMode] = RIGHT_PANEL_MODES
    const markup = renderStack([
      workspace('closed-session', []),
      workspace('open-session', [openMode])
    ], 'open-session')

    expect(markup).not.toContain('data-session-right-panel-workspace="closed-session"')
    expect(markup).not.toContain('data-rendered-session="closed-session"')
    expect(markup).toContain('data-session-right-panel-workspace="open-session"')
    expect(markup).toContain('data-right-panel-pane-count="1"')
    expect(markup).toContain('data-right-panel-focused-pane-id="open-session-pane-1"')
    expect(markup).toContain('data-rendered-session="open-session"')
  })
})
