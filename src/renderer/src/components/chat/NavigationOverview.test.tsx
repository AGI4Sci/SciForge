import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NavigationOverview } from './NavigationOverview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('navigation overview', () => {
  it('explains missing history instead of presenting a blank page or collapse action', () => {
    const html = renderToStaticMarkup(createElement(NavigationOverview, {
      title: 'Completed research', sidebarCollapsed: false, onExpandSidebar: () => {}
    }))
    expect(html).toContain('Completed research')
    expect(html).toContain('navigationOverviewDescription')
    expect(html).not.toContain('sidebarCollapse')
    expect(html).not.toContain('<button')
  })

  it('makes hidden navigation reachable without obscuring the empty-state explanation', () => {
    const html = renderToStaticMarkup(createElement(NavigationOverview, {
      title: 'Research', sidebarCollapsed: true, onExpandSidebar: () => {}
    }))
    expect(html).toContain('aria-label="sidebarExpand"')
    expect(html).toContain('navigationOverviewDescription')
  })
})
