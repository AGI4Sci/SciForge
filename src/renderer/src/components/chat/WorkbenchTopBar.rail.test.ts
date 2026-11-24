// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { WorkbenchTopBar, type WorkbenchTopBarProps } from './WorkbenchTopBar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * The rail is portaled into a workbench-owned slot, so it can only be asserted
 * against a real DOM host. The static-render assertions stay in
 * `WorkbenchTopBar.test.ts`, which renders with no slot and therefore no portal.
 */
describe('workbench toolbar rail host', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    document.body.innerHTML = ''
    // The toolbar settings hook resolves through the preload bridge; a minimal
    // stub keeps the render synchronous without inventing editor data.
    Object.defineProperty(window, 'sciforge', {
      configurable: true,
      value: { getSettings: () => Promise.resolve({}) }
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = undefined
    container = undefined
    document.body.innerHTML = ''
  })

  async function renderTopBar(
    props: Partial<WorkbenchTopBarProps> = {}
  ): Promise<{ rail: HTMLElement | null; host: HTMLDivElement; topBar: HTMLElement }> {
    container = document.body.appendChild(document.createElement('div'))
    const host = document.body.appendChild(document.createElement('div'))
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(WorkbenchTopBar, {
        focusedRightPanelMode: null,
        onToggleFocusedRightPanelMode: vi.fn(),
        railHost: host,
        ...props
      }))
    })
    return { rail: host.querySelector<HTMLElement>('.chat-workbench-topbar'), host, topBar: container }
  }

  it('ports the vertical rail into the workbench slot instead of the top bar', async () => {
    const { rail, host, topBar } = await renderTopBar()

    expect(rail).toBeTruthy()
    expect(topBar.contains(rail)).toBe(false)
    expect(host.contains(rail)).toBe(true)
    expect(rail?.getAttribute('role')).toBe('toolbar')
    expect(rail?.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('keeps the ordered actions and the overflow trigger inside the rail', async () => {
    const { rail } = await renderTopBar({ planPanelEnabled: true })

    // The rail renders the contributed actions in order; the same ordered list
    // drives the overflow menu, so assert the structural contract instead of
    // hard-coding command ids that belong to domain packages.
    const railActions = Array.from(rail?.querySelectorAll<HTMLElement>('[data-action-id]') ?? [])
      .map((button) => button.dataset.actionId)
    expect(railActions.length).toBeGreaterThan(0)
    expect(new Set(railActions).size).toBe(railActions.length)

    const more = rail?.querySelector<HTMLButtonElement>('.toolbar-more')
    expect(more).toBeTruthy()
    expect(more?.getAttribute('aria-label')).toBe('More tools')
    expect(more?.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('renders the same single rail inline when no slot is provided', async () => {
    container = document.body.appendChild(document.createElement('div'))
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(WorkbenchTopBar, {
        focusedRightPanelMode: null,
        onToggleFocusedRightPanelMode: vi.fn()
      }))
    })

    // A host-less caller (server rendering, another embedder) must never lose
    // the toolbar, and must never get a second copy of it.
    const rail = container.querySelector<HTMLElement>('.chat-workbench-topbar')
    expect(rail).toBeTruthy()
    expect(rail?.getAttribute('aria-orientation')).toBe('vertical')
    expect(document.querySelectorAll('.chat-workbench-topbar')).toHaveLength(1)
  })
})
