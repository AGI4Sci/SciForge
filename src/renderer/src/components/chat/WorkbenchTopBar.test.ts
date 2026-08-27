import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'
import { WorkbenchTopBar } from './WorkbenchTopBar'

describe('WorkbenchTopBar toolbar contributions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    i18n.addResourceBundle('en', 'common', {
      rightPanelEvidenceDag: 'Evidence DAG',
      rightPanelProjectDag: 'Project DAG'
    }, true, true)
  })

  it('does not invent a Paper Radar entry without a registered toolbar action', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn()
    }))

    expect(html).not.toContain('Paper Radar')
  })

  it('does not hard-code a Desktop identity control without a registered action', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Identity"')
    expect(html).not.toContain('aria-label="Sign in"')
  })

  it('renders identity through its registered toolbar contribution', () => {
    const identityAction = installedRendererContributions.toolbarActions.list()
      .find(({ id }) => id === 'identity-access.workbench-toolbar-action')
    expect(identityAction).toBeDefined()
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      toolbarActions: [identityAction!],
      toolbarCommandInvocation: { sessionId: 'thread-1' },
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).toContain('aria-label="Identity"')
    expect(html).not.toContain('aria-label="Sign in"')
  })

  it('renders and marks a registered toolbar action from its metadata', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      toolbarActions: installedRendererContributions.toolbarActions.list(),
      toolbarCommandInvocation: {
        activeSurface: {
          kind: 'right-panel',
          contributionId: 'paper-radar.workbench-right-panel'
        }
      },
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).toContain('Paper Radar')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Customize toolbar"')
    expect(html).toContain('>Customize toolbar</span>')
  })

  it('omits a registered contribution when its generic availability predicate fails', () => {
    const registered = installedRendererContributions.toolbarActions.list()[0]!
    const isAvailable = vi.fn(() => false)
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/lab',
      toolbarCommandInvocation: { workspaceRoot: '/workspace/lab' },
      toolbarActions: [{
        ...registered,
        contribution: {
          ...registered.contribution,
          isAvailable
        }
      }],
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).not.toContain('Paper Radar')
    expect(isAvailable).toHaveBeenCalledWith({
      workspaceRoot: '/workspace/lab'
    })
  })

  it('shows Evidence DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'evidence-dag',
      onToggleFocusedRightPanelMode: vi.fn(),
      toolbarActions: installedRendererContributions.toolbarActions.list(),
      toolbarCommandInvocation: {
        activeSurface: {
          kind: 'right-panel',
          contributionId: 'evidence-dag.workbench-right-panel'
        }
      },
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Project DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'project-dag',
      onToggleFocusedRightPanelMode: vi.fn(),
      toolbarActions: installedRendererContributions.toolbarActions.list(),
      toolbarCommandInvocation: {
        activeSurface: {
          kind: 'right-panel',
          contributionId: 'project-dag.workbench-right-panel'
        }
      },
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).toContain('Project DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Create Loop only through its registered toolbar contribution', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'create-loop.workbench-right-panel',
      onToggleFocusedRightPanelMode: vi.fn(),
      toolbarActions: installedRendererContributions.toolbarActions.list(),
      toolbarCommandInvocation: {
        sessionId: 'thread-1',
        workspaceRoot: '/workspace',
        activeSurface: {
          kind: 'right-panel',
          contributionId: 'create-loop.workbench-right-panel'
        }
      },
      onExecuteToolbarCommand: vi.fn()
    }))

    expect(html).toContain('Create Loop')
    expect(html).toContain('aria-pressed="true"')
  })

  it('keeps right-panel controls reachable in narrow workbench widths', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'workflow',
      onToggleFocusedRightPanelMode: vi.fn()
    }))

    expect(html).toContain('chat-workbench-topbar')
    expect(html).toContain('justify-start')
    expect(html).toContain('overflow-x-auto')
  })

  it('marks core panel controls from the focused pane when focus changes between open panes', () => {
    const fileFocusedHtml = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'file',
      onToggleFocusedRightPanelMode: vi.fn(),
      planPanelEnabled: true
    }))
    const planFocusedHtml = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'plan',
      onToggleFocusedRightPanelMode: vi.fn(),
      planPanelEnabled: true
    }))

    expect(fileFocusedHtml).toMatch(
      /<button(?=[^>]*aria-label="Files")(?=[^>]*aria-pressed="true")[^>]*>/
    )
    expect(fileFocusedHtml).toMatch(
      /<button(?=[^>]*aria-label="Plan")(?=[^>]*aria-pressed="false")[^>]*>/
    )
    expect(planFocusedHtml).toMatch(
      /<button(?=[^>]*aria-label="Files")(?=[^>]*aria-pressed="false")[^>]*>/
    )
    expect(planFocusedHtml).toMatch(
      /<button(?=[^>]*aria-label="Plan")(?=[^>]*aria-pressed="true")[^>]*>/
    )
  })

  it('renders separate controls for opening the workspace and choosing the default editor', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/sciforge'
    }))

    expect(html).toContain('aria-label="Open workspace in editor"')
    expect(html).toContain('aria-label="Choose default editor"')
  })

  it('does not expose manual Todo or environment info controls', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/sciforge'
    }))

    expect(html).not.toContain('aria-label="Todo"')
    expect(html).not.toContain('aria-label="Environment info"')
  })

  it('hides the child agent status button until children exist', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      childAgentCount: 0,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Children"')
  })

  it('shows the child agent status button with count and active state', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'child-agents',
      onToggleFocusedRightPanelMode: vi.fn(),
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

  it('shows the exact child count instead of clamping counts above nine', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      childAgentCount: 27,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).toContain('>27</span>')
    expect(html).not.toContain('>9</span>')
  })

  it('marks deep child interactions that need the user', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: 'file',
      onToggleFocusedRightPanelMode: vi.fn(),
      childAgentCount: 3,
      childAgentAttentionCount: 1,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).toContain('aria-label="1 child agent(s) need your attention"')
    expect(html).toContain('bg-red-500')
  })

  it('hides the side chat entry when the side conversation gate is unavailable', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      sideChatEnabled: false,
      onOpenSideChat: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Open side chat"')
  })

  it('shows the side chat entry when side conversations are available', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      focusedRightPanelMode: null,
      onToggleFocusedRightPanelMode: vi.fn(),
      sideChatEnabled: true,
      sideChatCount: 2,
      onOpenSideChat: vi.fn()
    }))

    expect(html).toContain('aria-label="Open side chat"')
    expect(html).toContain('>2</span>')
  })
})
