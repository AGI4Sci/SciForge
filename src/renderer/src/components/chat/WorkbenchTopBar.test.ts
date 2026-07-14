import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { WorkbenchTopBar } from './WorkbenchTopBar'

describe('WorkbenchTopBar Paper Radar entry', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('hides Paper Radar when the extension is not enabled', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      paperRadarEnabled: false
    }))

    expect(html).not.toContain('Paper Radar')
  })

  it('shows and marks Paper Radar when the extension is enabled', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'paper',
      onToggleRightPanelMode: vi.fn(),
      paperRadarEnabled: true
    }))

    expect(html).toContain('Paper Radar')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Evidence DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'evidence',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Project evidence as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'project-dag',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Project evidence')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows and marks Biology Room as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'biology',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Biology Room')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows pending BioGym result count on the Biology Room control', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      biologyRunUnreadCount: 3
    }))

    expect(html).toContain('aria-label="3 new BioGym results"')
    expect(html).toContain('>3</span>')
  })

  it('keeps right-panel controls reachable in narrow workbench widths', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'project-dag',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('chat-workbench-topbar')
    expect(html).toContain('justify-start')
    expect(html).toContain('overflow-x-auto')
  })

  it('renders separate controls for opening the workspace and choosing the default editor', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/sciforge'
    }))

    expect(html).toContain('aria-label="Open workspace in editor"')
    expect(html).toContain('aria-label="Choose default editor"')
  })

  it('does not expose manual Todo or environment info controls', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/sciforge'
    }))

    expect(html).not.toContain('aria-label="Todo"')
    expect(html).not.toContain('aria-label="Environment info"')
  })

  it('hides the child agent status button until children exist', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      childAgentCount: 0,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Children"')
  })

  it('shows the child agent status button with count and active state', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'child-agents',
      onToggleRightPanelMode: vi.fn(),
      childAgentCount: 2,
      childAgentRunningCount: 1,
      childAgentsOpen: true,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).toContain('aria-label="Children"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('>2</span>')
    expect(html).toContain('animate-pulse')
  })

  it('marks deep child interactions that need the user', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'file',
      onToggleRightPanelMode: vi.fn(),
      childAgentCount: 3,
      childAgentAttentionCount: 1,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).toContain('aria-label="1 child agent(s) need your attention"')
    expect(html).toContain('bg-red-500')
  })

  it('hides the side chat entry when the side conversation gate is unavailable', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      sideChatEnabled: false,
      onOpenSideChat: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Open side chat"')
  })

  it('shows the side chat entry when side conversations are available', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      sideChatEnabled: true,
      sideChatCount: 2,
      onOpenSideChat: vi.fn()
    }))

    expect(html).toContain('aria-label="Open side chat"')
    expect(html).toContain('>2</span>')
  })
})
