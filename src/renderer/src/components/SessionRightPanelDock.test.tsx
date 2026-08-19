// @vitest-environment happy-dom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionRightPanelDock,
  type SessionRightPanelDockLabels,
  type SessionRightPanelDockProps
} from './SessionRightPanelDock'
import {
  createSessionRightPanelPane,
  createSessionRightPanelWorkspace,
  splitSessionRightPanelPane,
  type SessionRightPanelPane,
  type SessionRightPanelWorkspace,
  type SessionRightPanelWorkspaceMap
} from './session-right-panel-workspaces'
import {
  useRightPanelSurfaceId
} from './right-panel-session-scope'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)
const scrollIntoView = vi.fn()

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: readonly number[]
  readonly observed = new Set<Element>()

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? '0px'
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0]
    MockIntersectionObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  trigger(visibleTargets: readonly Element[]): void {
    const visible = new Set(visibleTargets)
    this.callback(
      Array.from(this.observed, (target) => ({
        target,
        isIntersecting: visible.has(target)
      }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver
    )
  }
}

const labels: SessionRightPanelDockLabels = {
  dock: 'Session right sidebars',
  pane: ({ index, bindingLabel, focused }) =>
    `${bindingLabel} pane ${index + 1}${focused ? ', focused' : ''}`,
  back: 'Back in pane',
  forward: 'Forward in pane',
  binding: 'Pane binding',
  resize: 'Resize pane',
  split: 'Open a copy in a new pane',
  splitAction: 'New pane',
  close: 'Close pane'
}

const bindings = [
  { id: 'file' as const, label: 'Files' },
  { id: 'plan' as const, label: 'Plan' },
  { id: 'fixture.panel', label: 'Fixture panel' }
]

function pane(
  paneId: string,
  mode: SessionRightPanelPane['mode'],
  width: number
): SessionRightPanelPane {
  return {
    ...createSessionRightPanelPane({ mode }, width),
    paneId,
    instanceKey: `instance:${paneId}`
  }
}

function workspace(
  panes: SessionRightPanelPane[],
  focusedPaneId: string | null = panes[0]?.paneId ?? null
): SessionRightPanelWorkspace {
  return {
    ...createSessionRightPanelWorkspace('session-1'),
    instanceKey: 'workspace:session-1',
    panes,
    focusedPaneId
  }
}

function callbacks(): Pick<
  SessionRightPanelDockProps,
  | 'onFocusPane'
  | 'onNavigatePane'
  | 'onRebindPane'
  | 'onBeginResizePane'
  | 'onSplitPane'
  | 'onClosePane'
> {
  return {
    onFocusPane: vi.fn(),
    onNavigatePane: vi.fn(),
    onRebindPane: vi.fn(),
    onBeginResizePane: vi.fn(),
    onSplitPane: vi.fn(),
    onClosePane: vi.fn()
  }
}

describe('SessionRightPanelDock', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
    MockIntersectionObserver.instances = []
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
    root = null
    container = null
  })

  it('renders ordered panes by stable instance identity and preserves mounted content on reorder', async () => {
    const first = pane('pane-1', 'file', 340)
    const second = pane('pane-2', 'file', 420)
    const initialTokens = new Map<string, string>()
    let sequence = 0

    function StatefulPane({ paneId }: { paneId: string }) {
      const [token] = useState(() => `${paneId}:${++sequence}`)
      initialTokens.set(paneId, initialTokens.get(paneId) ?? token)
      return createElement('div', { 'data-stateful-pane': paneId, 'data-token': token })
    }

    const props = {
      active: true,
      bindings,
      labels,
      ...callbacks(),
      renderPane: (entry: SessionRightPanelPane) =>
        createElement(StatefulPane, { paneId: entry.paneId })
    }
    root = createRoot(container as HTMLDivElement)
    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        ...props,
        workspace: workspace([first, second])
      }))
    })

    const initialOrder = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    ).map((element) => element.dataset.sessionRightPanelPane)
    expect(initialOrder).toEqual(['pane-1', 'pane-2'])
    expect(container?.querySelector<HTMLElement>('[data-session-right-panel-pane="pane-1"]')?.style.width)
      .toBe('340px')
    expect(container?.querySelector<HTMLElement>('[data-session-right-panel-pane="pane-2"]')?.style.width)
      .toBe('420px')

    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        ...props,
        workspace: workspace([second, first], 'pane-2')
      }))
    })

    const reordered = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    )
    expect(reordered.map((element) => element.dataset.sessionRightPanelPane))
      .toEqual(['pane-2', 'pane-1'])
    for (const element of reordered) {
      const paneId = element.dataset.sessionRightPanelPane as string
      expect(element.querySelector('[data-stateful-pane]')?.getAttribute('data-token'))
        .toBe(initialTokens.get(paneId))
    }
  })

  it('provides each rendered pane with its stable Host surface identity', async () => {
    const first = pane('pane-1', 'file', 340)
    const second = pane('pane-2', 'file', 340)

    function ScopedPane() {
      const surfaceId = useRightPanelSurfaceId()
      return createElement('div', { 'data-scoped-surface-id': surfaceId ?? '' })
    }

    root = createRoot(container as HTMLDivElement)
    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        workspace: workspace([first, second]),
        active: true,
        bindings,
        labels,
        ...callbacks(),
        renderPane: () => createElement(ScopedPane)
      }))
    })

    expect(Array.from(container?.querySelectorAll('[data-scoped-surface-id]') ?? [])
      .map((element) => element.getAttribute('data-scoped-surface-id')))
      .toEqual(['pane-1', 'pane-2'])
  })

  it('exposes focused, accessible pane chrome and routes every action to its owning pane', async () => {
    const first = pane('pane-1', 'file', 360)
    first.history = {
      entries: [
        first.history.entries[0],
        { ...first.history.entries[0], mode: 'plan' },
        { ...first.history.entries[0], mode: 'fixture.panel' }
      ],
      index: 1
    }
    const second = pane('pane-2', 'fixture.missing', 360)
    const handlers = callbacks()
    const renderPane = vi.fn((entry: SessionRightPanelPane) =>
      createElement('div', { 'data-rendered-pane': entry.paneId })
    )
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        workspace: workspace([first, second]),
        active: true,
        bindings,
        labels,
        ...handlers,
        renderPane
      }))
    })

    const dock = container?.querySelector<HTMLElement>('[data-session-right-panel-dock]')
    expect(dock?.getAttribute('role')).toBe('region')
    expect(dock?.getAttribute('aria-label')).toBe(labels.dock)
    expect(dock?.className).toContain('overflow-x-auto')

    const paneElements = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    )
    expect(paneElements).toHaveLength(2)
    expect(container?.querySelectorAll('[data-right-panel-pane-resizer]')).toHaveLength(2)
    expect(paneElements[0].dataset.focused).toBe('true')
    expect(paneElements[1].dataset.focused).toBe('false')
    for (const paneElement of paneElements) {
      const titleId = paneElement.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      expect(container?.querySelector(`#${CSS.escape(titleId as string)}`)?.textContent)
        .toContain('pane')
      expect(paneElement.querySelector('header[data-right-panel-pane-header]')).not.toBeNull()
    }
    expect(renderPane).toHaveBeenCalledWith(first, { active: true, focused: true })
    expect(renderPane).toHaveBeenCalledWith(second, { active: false, focused: false })

    const firstPane = paneElements[0]
    const button = (label: string): HTMLButtonElement => {
      const match = firstPane.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      if (!match) throw new Error(`Missing button: ${label}`)
      return match
    }

    expect(button(labels.back).disabled).toBe(false)
    expect(button(labels.forward).disabled).toBe(false)
    expect(button(labels.split).textContent).toContain(labels.splitAction)
    await act(async () => button(labels.back).click())
    await act(async () => button(labels.forward).click())
    await act(async () => button(labels.split).click())
    await act(async () => button(labels.close).click())
    expect(handlers.onNavigatePane).toHaveBeenNthCalledWith(1, 'session-1', 'pane-1', -1)
    expect(handlers.onNavigatePane).toHaveBeenNthCalledWith(2, 'session-1', 'pane-1', 1)
    expect(handlers.onSplitPane).toHaveBeenCalledWith('session-1', 'pane-1')
    expect(handlers.onClosePane).toHaveBeenCalledWith('session-1', 'pane-1')

    const selector = firstPane.querySelector<HTMLSelectElement>('[data-right-panel-binding-selector]')
    if (!selector) throw new Error('Missing pane binding selector.')
    selector.value = 'plan'
    await act(async () => selector.dispatchEvent(new Event('change', { bubbles: true })))
    expect(handlers.onRebindPane).toHaveBeenCalledWith('session-1', 'pane-1', 'plan')

    const secondResizer = container?.querySelector<HTMLElement>(
      '[data-right-panel-pane-resizer="pane-2"]'
    )
    if (!secondResizer) throw new Error('Missing pane resizer.')
    await act(async () => {
      secondResizer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(handlers.onBeginResizePane).toHaveBeenCalledWith(
      'session-1',
      'pane-2',
      expect.any(Object),
      'start'
    )

    expect(paneElements[1].querySelector<HTMLSelectElement>('select')?.value)
      .toBe('fixture.missing')
    await act(async () => {
      paneElements[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(handlers.onFocusPane).toHaveBeenCalledWith('session-1', 'pane-2')
  })

  it('creates and focuses an adjacent pane through the visible new-pane action', async () => {
    const initialWorkspace = workspace([pane('pane-1', 'file', 360)])

    function StatefulDock() {
      const [workspaceMap, setWorkspaceMap] = useState<SessionRightPanelWorkspaceMap>({
        [initialWorkspace.sessionId]: initialWorkspace
      })
      const currentWorkspace = workspaceMap[initialWorkspace.sessionId]
      return createElement(SessionRightPanelDock, {
        workspace: currentWorkspace,
        active: true,
        bindings,
        labels,
        ...callbacks(),
        onSplitPane: (sessionId: string, paneId: string) => {
          setWorkspaceMap((current) => splitSessionRightPanelPane(current, sessionId, paneId))
        },
        renderPane: (entry: SessionRightPanelPane) =>
          createElement('div', { 'data-rendered-pane': entry.paneId })
      })
    }

    root = createRoot(container as HTMLDivElement)
    await act(async () => root?.render(createElement(StatefulDock)))
    const newPaneButton = container?.querySelector<HTMLButtonElement>(
      `button[aria-label="${labels.split}"]`
    )
    if (!newPaneButton) throw new Error('Missing visible new-pane action.')

    await act(async () => newPaneButton.click())

    const panes = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    )
    expect(panes).toHaveLength(2)
    expect(panes[0].dataset.sessionRightPanelPane).toBe('pane-1')
    expect(panes[1].dataset.focused).toBe('true')
    expect(panes[1].dataset.rightPanelMode).toBe('file')
  })

  it('keeps inactive resident panes rendered without activating any context', async () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      pane(`pane-${index + 1}`, 'file', 360)
    )
    const handlers = callbacks()
    const renderPane = vi.fn((entry: SessionRightPanelPane, context: { active: boolean }) =>
      createElement('div', {
        'data-rendered-pane': entry.paneId,
        'data-rendered-active': context.active ? 'true' : 'false'
      })
    )
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        workspace: workspace(entries, entries[2].paneId),
        active: false,
        bindings,
        labels,
        ...handlers,
        renderPane
      }))
    })

    const paneElements = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    )
    expect(paneElements).toHaveLength(entries.length)
    expect(paneElements.every((element) => element.dataset.active === 'false')).toBe(true)
    expect(container?.querySelectorAll('[data-rendered-active="true"]')).toHaveLength(0)
    await act(async () => {
      paneElements[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(handlers.onFocusPane).not.toHaveBeenCalled()
  })

  it('keeps an unbounded pane set mounted while activating only viewport intersections', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const entries = Array.from({ length: 80 }, (_, index) =>
      pane(`pane-${index + 1}`, 'file', 360)
    )
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        workspace: workspace(entries, 'pane-70'),
        active: true,
        bindings,
        labels,
        ...callbacks(),
        renderPane: (entry, context) => createElement('div', {
          'data-rendered-pane': entry.paneId,
          'data-rendered-active': context.active ? 'true' : 'false'
        })
      }))
    })

    const dock = container?.querySelector<HTMLElement>('[data-session-right-panel-dock]')
    const paneElements = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    )
    expect(paneElements).toHaveLength(80)
    expect(MockIntersectionObserver.instances).toHaveLength(1)
    const observer = MockIntersectionObserver.instances[0]
    expect(observer.root).toBe(dock)
    expect(observer.observed.size).toBe(80)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })

    const visiblePaneIds = new Set(['pane-1', 'pane-2', 'pane-70'])
    await act(async () => {
      observer.trigger(paneElements.filter((element) =>
        visiblePaneIds.has(element.dataset.sessionRightPanelPane ?? '')
      ))
    })

    expect(container?.querySelectorAll('[data-session-right-panel-pane]')).toHaveLength(80)
    expect(container?.querySelectorAll('[data-rendered-active="true"]')).toHaveLength(3)
    expect(container?.querySelector(
      '[data-session-right-panel-pane="pane-30"] [data-rendered-active="false"]'
    )).not.toBeNull()
    expect(container?.querySelector(
      '[data-session-right-panel-pane="pane-70"] [data-rendered-active="true"]'
    )).not.toBeNull()
  })

  it('falls back to only the focused pane and scrolls new focus into view', async () => {
    const entries = Array.from({ length: 70 }, (_, index) =>
      pane(`pane-${index + 1}`, 'file', 360)
    )
    const props = {
      active: true,
      bindings,
      labels,
      ...callbacks(),
      renderPane: (entry: SessionRightPanelPane, context: { active: boolean }) =>
        createElement('div', {
          'data-rendered-pane': entry.paneId,
          'data-rendered-active': context.active ? 'true' : 'false'
        })
    }
    root = createRoot(container as HTMLDivElement)

    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        ...props,
        workspace: workspace(entries, 'pane-65')
      }))
    })
    expect(container?.querySelectorAll('[data-rendered-active="true"]')).toHaveLength(1)
    expect(container?.querySelector(
      '[data-session-right-panel-pane="pane-65"] [data-rendered-active="true"]'
    )).not.toBeNull()

    scrollIntoView.mockClear()
    await act(async () => {
      root?.render(createElement(SessionRightPanelDock, {
        ...props,
        workspace: workspace(entries, 'pane-70')
      }))
    })

    expect(container?.querySelectorAll('[data-session-right-panel-pane]')).toHaveLength(70)
    expect(container?.querySelectorAll('[data-rendered-active="true"]')).toHaveLength(1)
    expect(container?.querySelector(
      '[data-session-right-panel-pane="pane-70"] [data-rendered-active="true"]'
    )).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
