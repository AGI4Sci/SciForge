// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdaptiveToolbar,
  TOOLBAR_RAIL_WIDTH,
  fittingToolbarActions,
  placeToolbarPopup,
  planVerticalToolbarFit,
  type ToolbarAction
} from './AdaptiveToolbar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'workbenchToolbarMore' ? 'More tools' : key)
  })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

async function readRepositoryFile(relativePath: string): Promise<string> {
  const nodeFs = 'node:fs/promises'
  const { readFile } = await import(/* @vite-ignore */ nodeFs)
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ''
  return readFile(`${cwd}/${relativePath}`, 'utf8')
}

function icon(): ReactElement {
  return createElement('svg', { width: 16, height: 16, 'aria-hidden': true })
}

/** Mirrors the real `WorkbenchToolbarCustomizer` trigger, whose label is a plain span. */
function customizeTrigger(): ReactElement<{ className?: string }> {
  return createElement(
    'button',
    { type: 'button' },
    createElement('span', { className: 'whitespace-nowrap' }, 'Customize toolbar')
  ) as ReactElement<{ className?: string }>
}

const actions: ToolbarAction[] = [
  { id: 'files', label: 'Files', icon: icon(), onClick: vi.fn() },
  { id: 'plan', label: 'Plan', icon: icon(), onClick: vi.fn() },
  { id: 'research', label: 'Research', icon: icon(), onClick: vi.fn() },
  { id: 'terminal', label: 'Terminal', icon: icon(), onClick: vi.fn() },
  { id: 'browser', label: 'Browser', icon: icon(), onClick: vi.fn() }
]

describe('vertical toolbar capacity', () => {
  it('reserves the trailing pill and gaps at the exact fit boundary', () => {
    expect(fittingToolbarActions(140, [44, 44, 44], 44, 4)).toBe(2)
    expect(fittingToolbarActions(139, [44, 44, 44], 44, 4)).toBe(1)
    expect(fittingToolbarActions(188, [44, 44, 44], 44, 4)).toBe(3)
  })

  it('uses measured heights and preserves order rather than skipping a tall action', () => {
    expect(fittingToolbarActions(150, [44, 80, 20], 44, 4)).toBe(1)
  })

  it('allows every action in a tall rail and none in a collapsed one', () => {
    expect(fittingToolbarActions(2000, [44, 44, 44], 44, 4)).toBe(3)
    expect(fittingToolbarActions(44, [44, 44, 44], 44, 4)).toBe(0)
    expect(fittingToolbarActions(2000, [], 44, 4)).toBe(0)
  })
})

describe('vertical toolbar fit plan', () => {
  const measurements = {
    customizeTailHeight: 44,
    moreTailHeight: 44,
    gap: 4
  }
  const itemHeights = [44, 44, 44]

  it('renders the whole set when every action plus the customization pill fits', () => {
    expect(planVerticalToolbarFit({ ...measurements, height: 500, itemHeights })).toEqual({
      visibleCount: 3
    })
  })

  it('reserves the "More tools" pill and overflows the tail of the list', () => {
    // Three actions + customization need 44 + 3 * (44 + 4) = 188px.
    expect(planVerticalToolbarFit({ ...measurements, height: 150, itemHeights })).toEqual({
      visibleCount: 2
    })
  })

  it('always leaves at least one action for the overflow menu', () => {
    // A tall customization pill no longer fits, while "More" (44px) would leave
    // room for all three actions; the rail must still overflow one of them
    // rather than open an empty "More" panel.
    expect(
      planVerticalToolbarFit({
        height: 250,
        itemHeights,
        customizeTailHeight: 200,
        moreTailHeight: 44,
        gap: 4
      })
    ).toEqual({ visibleCount: 2 })
  })

  it('collapses to only the "More tools" pill when even one action does not fit', () => {
    expect(planVerticalToolbarFit({ ...measurements, height: 60, itemHeights })).toEqual({
      visibleCount: 0
    })
  })

  it('has nothing to degrade without actions', () => {
    expect(planVerticalToolbarFit({ ...measurements, height: 10, itemHeights: [] })).toEqual({
      visibleCount: 0
    })
  })
})

describe('toolbar popup placement', () => {
  it('anchors a right-edge rail button and opens its menu to the left', () => {
    expect(
      placeToolbarPopup({
        anchor: { left: 1184, right: 1228, top: 200, bottom: 244 },
        viewport: { width: 1280, height: 800 },
        preferredWidth: 280,
        preferredMaxHeight: 420
      })
    ).toEqual({ left: 896, top: 252, width: 280, maxHeight: 420 })
  })

  it('anchors a horizontal top-bar button and opens its menu below it', () => {
    expect(
      placeToolbarPopup({
        anchor: { left: 100, right: 140, top: 20, bottom: 56 },
        viewport: { width: 1280, height: 800 },
        preferredWidth: 280,
        preferredMaxHeight: 420
      })
    ).toEqual({ left: 148, top: 64, width: 280, maxHeight: 420 })
  })

  it('flips above a trigger that has no room below', () => {
    const placement = placeToolbarPopup({
      anchor: { left: 100, right: 140, top: 700, bottom: 744 },
      viewport: { width: 1280, height: 800 },
      preferredWidth: 280,
      preferredMaxHeight: 420
    })
    expect(placement.top).toBeLessThan(700)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(700)
  })

  it('clamps the menu into the viewport', () => {
    const placement = placeToolbarPopup({
      anchor: { left: 2, right: 46, top: 10, bottom: 54 },
      viewport: { width: 300, height: 400 },
      preferredWidth: 280
    })
    expect(placement.left).toBeGreaterThanOrEqual(8)
    expect(placement.left + placement.width).toBeLessThanOrEqual(300)
  })
})

describe('vertical toolbar rail', () => {
  let root: Root | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = undefined
    }
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  /**
   * Layout APIs return no geometry in happy-dom, so the measurements the rail
   * reads are stubbed: every pill measures `itemHeight`, the tail measures
   * `tailHeight` and the rail reports `height`.
   */
  function stubRailLayout(input: {
    height: number
    itemHeight?: number
    tailHeight?: number
  }): void {
    const itemHeight = input.itemHeight ?? 44
    const tailHeight = input.tailHeight ?? 44
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement): number {
        if (this.classList.contains('toolbar-tail')) return tailHeight
        if (this.classList.contains('toolbar-action')) return itemHeight
        return 0
      }
    )
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement): number {
        return this.classList.contains('chat-workbench-topbar') ? input.height : 0
      }
    )
  }

  async function renderToolbar(): Promise<HTMLElement> {
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(AdaptiveToolbar, { actions, customization: customizeTrigger() }))
    })
    const rail = document.querySelector<HTMLElement>('.chat-workbench-topbar')
    expect(rail).toBeTruthy()
    return rail!
  }

  it('renders a vertical toolbar rail with icon-only pills and full accessible names', async () => {
    stubRailLayout({ height: 2000 })
    const rail = await renderToolbar()

    expect(rail.getAttribute('role')).toBe('toolbar')
    expect(rail.getAttribute('aria-orientation')).toBe('vertical')

    for (const action of actions) {
      const button = rail.querySelector<HTMLButtonElement>(`[data-action-id="${action.id}"]`)
      expect(button).toBeTruthy()
      expect(button?.querySelector('svg')).toBeTruthy()
      // The label stays in the DOM for the overflow menu but the rail renders
      // icon-only: the full string is still the accessible name and tooltip.
      expect(button?.querySelector('.toolbar-action-label')?.textContent).toBe(action.label)
      expect(button?.getAttribute('aria-label')).toBe(action.label)
      expect(button?.title).toBe(action.label)
    }
    expect(rail.querySelector('.toolbar-overflow')).toBeNull()
  })

  it('keeps the tab order of the ordered action list', async () => {
    stubRailLayout({ height: 2000 })
    const rail = await renderToolbar()

    // DOM order is tab order: the rail must never reorder or hoist an action
    // just because it renders as a column.
    const rendered = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-action-id]'))
      .map((button) => button.dataset.actionId)
    expect(rendered).toEqual(actions.map((action) => action.id))
  })

  it('keeps active state, badges and attention dots on the rail pills', async () => {
    stubRailLayout({ height: 2000 })
    const activeActions: ToolbarAction[] = [
      {
        id: 'children',
        label: 'Children',
        icon: icon(),
        onClick: vi.fn(),
        active: true,
        attention: true,
        badge: createElement('span', { className: 'count-badge' }, '3')
      }
    ]
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(AdaptiveToolbar, {
        actions: activeActions,
        customization: customizeTrigger()
      }))
    })

    const button = document.querySelector<HTMLButtonElement>('[data-action-id="children"]')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.className).toContain('is-active')
    expect(button?.querySelector('.count-badge')?.textContent).toBe('3')
    expect(button?.querySelector('.toolbar-attention')).toBeTruthy()
  })

  it('moves the tail of the list into "More tools" when the rail runs out of height', async () => {
    // 150px fits the customization pill + two pills (44 + 2 * 48 = 140).
    stubRailLayout({ height: 150 })
    const rail = await renderToolbar()

    expect(rail.querySelector('[data-action-id="files"]')).toBeTruthy()
    expect(rail.querySelector('[data-action-id="plan"]')).toBeTruthy()
    expect(rail.querySelector('[data-action-id="research"]')).toBeNull()
    expect(rail.querySelector('[data-action-id="terminal"]')).toBeNull()

    const more = rail.querySelector<HTMLButtonElement>('.toolbar-more')
    expect(more?.className).not.toContain('hidden')
    expect(more?.getAttribute('aria-label')).toBe('More tools')
    expect(more?.getAttribute('aria-haspopup')).toBe('dialog')

    const overflow = document.querySelector('.toolbar-overflow')
    expect(overflow).toBeTruthy()
    for (const action of actions.slice(2)) {
      const menuButton = overflow?.querySelector<HTMLButtonElement>(
        `[data-action-id="${action.id}"]`
      )
      expect(menuButton).toBeTruthy()
      expect(menuButton?.className).toContain('toolbar-menu-action')
      expect(menuButton?.querySelector('.toolbar-action-label')?.textContent).toBe(action.label)
    }
    // The customization entry moves into the same menu while the set overflows.
    expect(overflow?.querySelector('.toolbar-customize')).toBeTruthy()
    expect(overflow?.textContent).toContain('Customize toolbar')
  })

  it('opens the overflow menu from the rail "More tools" pill', async () => {
    stubRailLayout({ height: 150 })
    const rail = await renderToolbar()
    const more = rail.querySelector<HTMLButtonElement>('.toolbar-more')
    expect(more).toBeTruthy()

    await act(async () => {
      more!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(more?.getAttribute('aria-expanded')).toBe('true')
    const overflow = document.querySelector<HTMLElement>('.toolbar-overflow')
    expect(overflow?.getAttribute('aria-hidden')).toBe('false')
    expect(overflow?.style.visibility).toBe('visible')
    expect(overflow?.style.left).toBeTruthy()
  })

  it('renders only the shared trigger for the menu presentation', async () => {
    stubRailLayout({ height: 2000 })
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(AdaptiveToolbar, {
        actions,
        customization: customizeTrigger(),
        presentation: 'menu'
      }))
    })

    const trigger = document.querySelector<HTMLElement>('.chat-workbench-toolbar-menu')
    expect(trigger).toBeTruthy()
    expect(trigger?.getAttribute('role')).toBeNull()
    // The canvas header owns the chrome: only one pill, whose menu carries every
    // installed action plus the customization entry.
    expect(trigger?.querySelectorAll('button').length).toBe(1)
    const overflow = document.querySelector('.toolbar-overflow')
    expect(overflow).toBeTruthy()
    for (const action of actions) {
      expect(overflow?.querySelector(`[data-action-id="${action.id}"]`)).toBeTruthy()
    }
  })

  it('documents the rail as one fixed vertical column aligned with the sidebar rail', async () => {
    const css = await readRepositoryFile('src/renderer/src/styles/base-shell.css')
    const railRule = css.match(/\.chat-workbench-topbar\s*\{(?<body>[^}]*)\}/u)
    expect(railRule?.groups?.body).toContain('flex-direction: column')
    expect(css).toContain(`--ds-sidebar-rail-width: ${TOOLBAR_RAIL_WIDTH}px`)
    const actionRule = css.match(/\n\.toolbar-action\s*\{(?<body>[^}]*)\}/u)
    expect(actionRule?.groups?.body).toContain('width: 44px')
    expect(actionRule?.groups?.body).toContain('height: 44px')
    const hostRule = css.match(/\.ds-workbench-toolbar-rail-host\s*\{(?<body>[^}]*)\}/u)
    expect(hostRule?.groups?.body).toContain('flex: 0 0 var(--ds-sidebar-rail-width)')
  })
})
