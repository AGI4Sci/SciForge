import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentFocusNavigation } from './AgentFocusNavigation'

const labels: Record<string, string> = {
  agentFocusNavigation: 'Agent focus navigation',
  agentFocusBack: 'Back to previous agent',
  agentFocusForward: 'Forward to next agent',
  agentFocusUp: 'Go to parent agent',
  sidebarChildrenStatusCompleted: 'Completed',
  sidebarChildrenStatusRunning: 'Running'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => labels[key] ?? key })
}))

describe('AgentFocusNavigation', () => {
  it('renders history controls and the full accessible lineage', () => {
    const html = renderToStaticMarkup(createElement(AgentFocusNavigation, {
      lineage: [
        { threadId: 'main', label: 'Main' },
        { threadId: 'research', label: 'Research', status: 'completed' },
        { threadId: 'reviewer', label: 'Reviewer', status: 'running' }
      ],
      canGoBack: true,
      canGoForward: false,
      onBack: vi.fn(),
      onForward: vi.fn(),
      onUp: vi.fn(),
      onNavigateTo: vi.fn()
    }))

    expect(html).toContain('aria-label="Agent focus navigation"')
    expect(html).toContain('aria-label="Back to previous agent"')
    expect(html).toContain('aria-label="Forward to next agent"')
    expect(html).toContain('aria-label="Go to parent agent"')
    expect(html).toContain('Main')
    expect(html).toContain('Research')
    expect(html).toContain('Reviewer')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="Running"')
  })

  it('disables parent navigation at the lineage root', () => {
    const html = renderToStaticMarkup(createElement(AgentFocusNavigation, {
      lineage: [{ threadId: 'main', label: 'Main' }],
      canGoBack: false,
      canGoForward: false,
      onBack: vi.fn(),
      onForward: vi.fn(),
      onUp: vi.fn(),
      onNavigateTo: vi.fn()
    }))

    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })
})
