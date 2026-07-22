import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import {
  AnchoredCommentsTopBarActionsView,
  useAnchoredCommentStore
} from '../anchored-comments'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'
import { WorkbenchTopBar } from './WorkbenchTopBar'

describe('WorkbenchTopBar right-panel contributions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useAnchoredCommentStore.setState({
      commentMode: false,
      threads: [],
      panelOpen: false
    })
  })

  it('does not invent a Paper Radar entry without a registered contribution', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).not.toContain('Paper Radar')
  })

  it('renders and marks a registered right-panel contribution from its metadata', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'paper',
      onToggleRightPanelMode: vi.fn(),
      rightPanelContributions: installedRendererContributions.rightPanels.list()
    }))

    expect(html).toContain('Paper Radar')
    expect(html).toContain('aria-pressed="true"')
  })

  it('omits a registered contribution when its generic availability predicate fails', () => {
    const registered = installedRendererContributions.rightPanels.list()[0]!
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      rightPanelContributions: [{
        ...registered,
        contribution: {
          ...registered.contribution,
          isAvailable: () => false
        }
      }]
    }))

    expect(html).not.toContain('Paper Radar')
  })

  it('shows Evidence DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'evidence',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Project DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'project-dag',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Project DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Create Loop as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'workflow',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Create Loop')
    expect(html).toContain('aria-pressed="true"')
  })

  it('keeps the global comment actions in the top row', () => {
    const initial = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn()
    }))
    expect(initial).toContain('aria-label="Comment on anything"')
    expect(initial).not.toContain('data-sciforge-comment-launcher')
    expect(initial).not.toContain('aria-label="Open comments"')

    const active = renderToStaticMarkup(createElement(AnchoredCommentsTopBarActionsView, {
      commentMode: true,
      panelOpen: true,
      threadCount: 1,
      onToggleCommentMode: vi.fn(),
      onTogglePanel: vi.fn()
    }))
    expect(active).toContain('aria-label="Exit comment mode"')
    expect(active).toContain('aria-label="Open comments"')
    expect(active).toContain('aria-expanded="true"')
    expect(active).toContain('>1</span>')
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
