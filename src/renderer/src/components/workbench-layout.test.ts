// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS,
  WORKBENCH_MAIN_SURFACE_MIN_WIDTH,
  fitWorkbenchWidths,
  hostSidebarPresentation,
  rightPanelPaneMaximumWidth,
  rightPanelPaneWidthFromPointerDelta,
  workbenchPanelOverlays,
  useWorkbenchLayout
} from './workbench-layout'

async function readRepositoryFile(relativePath: string): Promise<string> {
  const nodeFs = 'node:fs/promises'
  const { readFile } = await import(/* @vite-ignore */ nodeFs)
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ''
  return readFile(`${cwd}/${relativePath}`, 'utf8')
}

const LEFT_SIDEBAR_COLLAPSED_KEY = 'sciforge.layout.leftSidebarCollapsed'

type HostSidebarPreference = 'expanded' | 'collapsed'

let mounted: { root: Root; container: HTMLElement } | null = null

function mountLayoutHook(preferredHostSidebar: HostSidebarPreference, activeSessionId: string | null = null) {
  let layout!: ReturnType<typeof useWorkbenchLayout>
  const props: { preferredHostSidebar: HostSidebarPreference } = { preferredHostSidebar }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  function Harness() {
    layout = useWorkbenchLayout({
      activeSessionId,
      preferredHostSidebar: props.preferredHostSidebar
    })
    return null
  }
  const render = (): void => {
    act(() => {
      root.render(createElement(Harness))
    })
  }
  render()
  return {
    get layout() {
      return layout
    },
    setPreferredHostSidebar(next: HostSidebarPreference): void {
      props.preferredHostSidebar = next
      render()
    },
    toggle(): void {
      act(() => {
        layout.toggleLeftSidebar()
      })
    }
  }
}

function ensureLocalStorage(): void {
  try {
    // vitest's DOM environments expose a partial localStorage without clear().
    if (window.localStorage && typeof window.localStorage.clear === 'function') return
  } catch {
    // fall through and install the stub
  }
  const store = new Map<string, string>()
  const stub: Storage = {
    get length() { return store.size },
    clear: () => { store.clear() },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => { store.delete(key) },
    setItem: (key: string, value: string) => { store.set(key, String(value)) }
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: stub })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ensureLocalStorage()
  window.localStorage.clear()
})

afterEach(() => {
  if (!mounted) return
  const { root, container } = mounted
  act(() => {
    root.unmount()
  })
  container.remove()
  mounted = null
})

describe('right panel visual boundary', () => {
  it('keeps a one-pixel visible edge without shrinking the resize target', () => {
    expect(WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS).toContain('border-l')
    expect(WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS).not.toContain('border-l-2')
  })

  it('keeps the wide resize target transparent around a one-pixel line', async () => {
    const css = await readRepositoryFile('src/renderer/src/styles/base-shell.css')
    const rule = css.match(/\[data-right-panel-pane-resizer\]::before\s*\{(?<body>[^}]*)\}/u)

    expect(rule?.groups?.body).toContain('width: 1px')
    expect(rule?.groups?.body).toContain('pointer-events: none')
    expect(rule?.groups?.body).not.toContain('inset-inline: -4px')
  })
})

describe('fitWorkbenchWidths', () => {
  it('caps the dock viewport while retaining the main-surface minimum', () => {
    const widths = fitWorkbenchWidths(1480, 280, [2000], {
      leftPanelVisible: true
    })

    expect(widths).toEqual({
      left: 280,
      rightDockViewport: 833,
      rightDockContent: 2011
    })
    expect(1480 - 7 - widths.left - widths.rightDockViewport).toBe(
      WORKBENCH_MAIN_SURFACE_MIN_WIDTH
    )
  })

  it('caps a lone dock after reserving the main surface', () => {
    const widths = fitWorkbenchWidths(1280, 304, [2000], {
      leftPanelVisible: false
    })

    expect(widths.rightDockViewport).toBe(920)
    expect(widths.rightDockContent).toBe(2011)
  })

  it('keeps each pane at its hard minimum without inflating the dock viewport', () => {
    const widths = fitWorkbenchWidths(1480, 280, [-200, 120], {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(622)
    expect(widths.rightDockViewport).toBe(622)
  })

  it('uses dock-local overflow when preferred pane widths exceed the viewport', () => {
    const paneWidths = [320, 480, 360, 640]
    const widths = fitWorkbenchWidths(1480, 280, paneWidths, {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(1844)
    expect(widths.rightDockViewport).toBe(833)
    expect(widths.rightDockContent).toBeGreaterThan(widths.rightDockViewport)
    expect(paneWidths).toEqual([320, 480, 360, 640])
  })

  it('overlays navigation before the right dock becomes an unusable slice', () => {
    const wide = fitWorkbenchWidths(1400, 304, [720], {
      leftPanelVisible: true
    })
    const narrow = fitWorkbenchWidths(820, 304, [720], {
      leftPanelVisible: true
    })

    expect(wide).toMatchObject({ left: 304, rightDockViewport: 729 })
    expect(narrow).toMatchObject({ left: 304, rightDockViewport: 460 })
    expect(workbenchPanelOverlays(820, true)).toEqual({ left: true, right: false })
    expect(820 - narrow.rightDockViewport).toBe(
      WORKBENCH_MAIN_SURFACE_MIN_WIDTH
    )
    expect(narrow.rightDockContent).toBe(731)
  })


  it.each([720, 1024, 1440, 576, 819, 1152])('keeps dock controls and the main surface reachable at %ipx', (width) => {
    const requested = [560, 420]
    const overlays = workbenchPanelOverlays(width, true)
    const fit = fitWorkbenchWidths(width, 304, requested, { leftPanelVisible: true })
    const main = width - (overlays.left ? 0 : fit.left + 7) - (overlays.right ? 0 : fit.rightDockViewport)
    expect(main).toBeGreaterThanOrEqual(360)
    expect(fit.rightDockViewport).toBeGreaterThanOrEqual(311)
    expect(fit.rightDockViewport).toBeLessThanOrEqual(width)
    expect(requested).toEqual([560, 420])
  })

  it('uses a right overlay below the two-pane minimum and restores wide preferred widths', () => {
    expect(workbenchPanelOverlays(576, true)).toEqual({ left: true, right: true })
    expect(fitWorkbenchWidths(576, 304, [560], { leftPanelVisible: true })).toEqual({
      left: 304, rightDockViewport: 528, rightDockContent: 571
    })
    expect(workbenchPanelOverlays(1440, true)).toEqual({ left: false, right: false })
    expect(fitWorkbenchWidths(1440, 304, [560], { leftPanelVisible: true })).toEqual({
      left: 304, rightDockViewport: 571, rightDockContent: 571
    })
  })

  it('does not impose a pane-count limit', () => {
    const paneWidths = Array.from({ length: 128 }, () => 300)
    const widths = fitWorkbenchWidths(1480, 280, paneWidths, {
      leftPanelVisible: true
    })

    expect(widths.rightDockContent).toBe(39_808)
    expect(widths.rightDockViewport).toBe(833)
  })
})

describe('responsive presentation persistence', () => {
  it('keeps panes, history and user preferences across narrow and wide window transitions', () => {
    const originalWidth = window.innerWidth
    const resize = (width: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      act(() => { window.dispatchEvent(new Event('resize')) })
    }
    try {
      resize(1440)
      const hook = mountLayoutHook('expanded', 'session-layout')
      act(() => hook.layout.addRightPanelPaneForSession('session-layout', { mode: 'file' }, { width: 560 }))
      act(() => hook.layout.splitRightPanelPaneForSession('session-layout', hook.layout.focusedRightPanelPane!.paneId))
      const workspace = JSON.stringify(hook.layout.activeRightPanelWorkspace)
      const stored = window.localStorage.getItem('sciforge.layout.sessionRightPanelWorkspaces.v1')
      for (const width of [1024, 720, 576, 1440]) {
        resize(width)
        expect(JSON.stringify(hook.layout.activeRightPanelWorkspace)).toBe(workspace)
        expect(window.localStorage.getItem('sciforge.layout.sessionRightPanelWorkspaces.v1')).toBe(stored)
        expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('0')
        expect(window.localStorage.getItem('sciforge.layout.leftSidebarWidth')).toBe('304')
        expect(hook.layout.rightPanelOverlay).toBe(width === 576)
      }
      expect(hook.layout.leftSidebarCollapsed).toBe(false)
      expect(hook.layout.leftSidebarWidth).toBe(304)
    } finally {
      resize(originalWidth)
    }
  })
})

describe('hostSidebarPresentation', () => {
  it('collapses a full page to the icon rail and a Session page to nothing', () => {
    expect(hostSidebarPresentation({ collapsed: false, mainAreaActive: true })).toBe('expanded')
    expect(hostSidebarPresentation({ collapsed: true, mainAreaActive: true })).toBe('rail')
    expect(hostSidebarPresentation({ collapsed: true, mainAreaActive: false })).toBe('hidden')
  })
})

describe('generic main-area sidebar preference', () => {
  it('keeps the host preference contract-driven without domain checks', async () => {
    const source = await readRepositoryFile('src/renderer/src/components/Workbench.tsx')
    expect(source).toContain('preferredHostSidebar')
    const forbiddenDomainNames = new RegExp(['collab', 'oration', '|', 'we', 'work', '|', 'we', 'gent'].join(''), 'iu')
    expect(source).not.toMatch(forbiddenDomainNames)
  })

  it('leaves the full page whenever another Host destination opens', async () => {
    const source = await readRepositoryFile('src/renderer/src/components/Workbench.tsx')
    for (const destination of ['openThread', 'startNewChat', 'startNewChatInWorkspace', 'openPluginsView', 'openScheduleView']) {
      const start = source.indexOf(`const ${destination} =`)
      const end = source.indexOf('\n  const ', start + 1)
      const body = source.slice(start, end === -1 ? undefined : end)
      expect(body, destination).toContain('setMainAreaPageId(null)')
    }
  })
})

describe('main-area sidebar collapse', () => {
  it('keeps narrow-window hover navigation non-modal', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    try {
      const hook = mountLayoutHook('expanded')
      expect(hook.layout.leftSidebarModal).toBe(true)
      act(() => hook.layout.leftSidebarEdge.setBehavior('auto'))
      act(() => hook.layout.leftSidebarEdge.edgeProps.onClick())
      expect(hook.layout.leftSidebarCollapsed).toBe(false)
      expect(hook.layout.leftSidebarOverlay).toBe(true)
      expect(hook.layout.leftSidebarModal).toBe(false)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    }
  })
  it('keeps the temporary full-page collapse out of the persisted preference', () => {
    window.localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, '0')

    const hook = mountLayoutHook('collapsed')

    expect(hook.layout.leftSidebarCollapsed).toBe(true)
    expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('0')
  })

  it('restores the user preference when the full page closes', () => {
    window.localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, '0')

    const hook = mountLayoutHook('collapsed')
    expect(hook.layout.leftSidebarCollapsed).toBe(true)

    hook.setPreferredHostSidebar('expanded')

    expect(hook.layout.leftSidebarCollapsed).toBe(false)
    expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('0')
  })

  it('keeps a manual in-page expand and collapse temporary', () => {
    window.localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, '0')

    const hook = mountLayoutHook('collapsed')
    hook.toggle()
    expect(hook.layout.leftSidebarCollapsed).toBe(false)
    expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('0')

    hook.toggle()
    expect(hook.layout.leftSidebarCollapsed).toBe(true)
    expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('0')

    hook.setPreferredHostSidebar('expanded')
    expect(hook.layout.leftSidebarCollapsed).toBe(false)
  })

  it('persists a manual collapse on a Session page', () => {
    window.localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, '0')

    const hook = mountLayoutHook('expanded')
    hook.toggle()

    expect(hook.layout.leftSidebarCollapsed).toBe(true)
    expect(window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY)).toBe('1')
  })
})

describe('main-area outlet lifetime', () => {
  it('keeps the outlet mounted while plugins or schedule is open', async () => {
    const source = await readRepositoryFile('src/renderer/src/components/Workbench.tsx')
    expect(source).toContain(
      "const mainAreaHidden = route === 'plugins' || route === 'schedule'"
    )
    expect(source.match(/<WorkbenchMainAreaOutlet/g) ?? []).toHaveLength(1)
    expect(source).toContain('hidden={mainAreaHidden}')
    expect(source).toContain('activePageId={mainAreaHidden ? null : mainAreaPageId}')
  })
})

describe('rightPanelPaneWidthFromPointerDelta', () => {
  it('derives the adjacent pane width from either separator edge and enforces its minimum', () => {
    expect(rightPanelPaneWidthFromPointerDelta(420, -80, 'start')).toBe(500)
    expect(rightPanelPaneWidthFromPointerDelta(420, 80, 'end')).toBe(500)
    expect(rightPanelPaneWidthFromPointerDelta(320, 80, 'start')).toBe(300)
  })

  it('caps expansion before it consumes the main work surface', () => {
    const maximum = rightPanelPaneMaximumWidth(1280, 304, { leftPanelVisible: true })
    expect(maximum).toBe(598)
    expect(rightPanelPaneWidthFromPointerDelta(420, -500, 'start', maximum)).toBe(598)
  })

  it('uses the reclaimed sidebar width when the left panel is collapsed', () => {
    expect(rightPanelPaneMaximumWidth(1280, 304, { leftPanelVisible: false })).toBe(909)
  })
})
