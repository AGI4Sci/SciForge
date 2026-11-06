// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkbenchMainAreaContributionRegistry, WorkbenchMainAreaOutlet } from './workbench-main-area'
import { PAGE_DOCK_STORAGE_KEY, useWorkbenchPageLayout, type WorkbenchPageLayout } from '../components/workbench-page-layout'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let container: HTMLDivElement
let root: Root
let layout: WorkbenchPageLayout
let setMain: (id: string | null) => void
let setVisible: (visible: boolean) => void
let mounts: string[]
const registry = new WorkbenchMainAreaContributionRegistry()
function Page({ id, active }: { id: string; active: boolean }): ReactElement {
  const [count, setCount] = useState(0)
  useEffect(() => { mounts.push(id) }, [id])
  return <button data-page-content={id} data-active={active} onClick={() => setCount(count + 1)}>{count}</button>
}
for (const [id, position] of [['fixture.notes', 'right'], ['fixture.team', 'main']] as const) {
  registry.register({ id, ownerId: 'fixture',
    contract: { location: 'workbench.main-area', contractVersion: '1.0.0', label: id,
      preferredHostSidebar: 'expanded', docking: { defaultPosition: position } },
    value: { render: ({ active }) => <Page id={id} active={active} /> } })
}
const pages = registry.list()
function Harness() {
  const [main, updateMain] = useState<string | null>(null)
  const [visible, updateVisible] = useState(true)
  setMain = updateMain
  setVisible = updateVisible
  layout = useWorkbenchPageLayout(pages, main, updateMain)
  return <WorkbenchMainAreaOutlet pages={pages} activePageId={main} layout={layout} visible={visible} rightPanel={<aside id="resource-preview">Preview</aside>}
    dock={{ ownedSessionIds: new Set(), activeSessionId: null, sessionView: <p>Session</p>, activateSession: () => {}, labels: { refused: 'refused', close: 'Close' } }}>
    <div id="center">Session</div>
  </WorkbenchMainAreaOutlet>
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.removeItem(PAGE_DOCK_STORAGE_KEY)
  mounts = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
const page = (id: string) => container.querySelector<HTMLElement>(`[data-dock-page="fixture.${id}"]`)!
const content = (id: string) => container.querySelector<HTMLElement>(`[data-page-content="fixture.${id}"]`)!

it('opens a default edge page beside the Session and preserves it during Session navigation', async () => {
  await act(async () => layout.openPage('fixture.notes'))
  expect(page('notes').dataset.dockPosition).toBe('right')
  expect(page('notes').hidden).toBe(false)
  expect(container.querySelector('#center')!.closest('[hidden]')).toBeNull()
  await act(async () => setMain(null))
  expect(content('notes').dataset.active).toBe('true')
})

it('moves one mounted page through left, bottom, main and right and retains edits', async () => {
  await act(async () => layout.openPage('fixture.notes'))
  await act(async () => content('notes').click())
  for (const position of ['left', 'bottom', 'main', 'right'] as const) {
    await act(async () => {
      const select = page('notes').querySelector('select')!
      select.value = position
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page('notes').dataset.dockPosition).toBe(position)
    expect(page('notes').hidden).toBe(false)
    expect(content('notes').textContent).toBe('1')
    expect(container.querySelector('#center')!.closest('[hidden]') !== null).toBe(position === 'main')
    expect(container.querySelector('#resource-preview')!.closest('[hidden]')).toBeNull()
  }
  expect(mounts).toEqual(['fixture.notes'])
})

it('tabs pages on one edge while keeping other edges active independently', async () => {
  await act(async () => { layout.openPage('fixture.notes'); layout.movePage('fixture.team', 'right') })
  expect(page('notes').hidden).toBe(true)
  expect(page('team').hidden).toBe(false)
  expect(page('team').querySelectorAll('[role="tab"]')).toHaveLength(2)
  await act(async () => (page('team').querySelectorAll('[role="tab"]')[0] as HTMLElement).click())
  expect(content('notes').dataset.active).toBe('true')
  expect(content('team').dataset.active).toBe('false')
  await act(async () => layout.movePage('fixture.team', 'left'))
  expect(content('notes').dataset.active).toBe('true')
  expect(content('team').dataset.active).toBe('true')
  await act(async () => layout.closePage('fixture.team'))
  expect(content('team').dataset.active).toBe('false')
  expect(content('notes').dataset.active).toBe('true')
})

it('closes and reopens a page and restores layout, tabs and sizes on restart', async () => {
  await act(async () => { layout.movePage('fixture.notes', 'bottom'); layout.resize('bottom', 416) })
  await act(async () => content('notes').click())
  await act(async () => page('notes').querySelector<HTMLButtonElement>('button[aria-label="close"]')!.click())
  expect(page('notes').hidden).toBe(true)
  await act(async () => layout.openPage('fixture.notes'))
  expect(content('notes').textContent).toBe('1')
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
  expect(page('notes').dataset.dockPosition).toBe('bottom')
  expect(page('notes').hidden).toBe(false)
  expect(layout.state.sizes.bottom).toBe(416)
})

it('marks docked pages inactive while the whole Workbench surface is hidden', async () => {
  await act(async () => layout.openPage('fixture.notes'))
  await act(async () => setVisible(false))
  expect(content('notes').dataset.active).toBe('false')
  await act(async () => setVisible(true))
  expect(content('notes').dataset.active).toBe('true')
})

it('resizes with pointer and keyboard input and releases capture and the resize shield', async () => {
  await act(async () => layout.openPage('fixture.notes'))
  const separator = container.querySelector<HTMLElement>('[role="separator"]')!
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(layout.state.sizes.right).toBe(504)
  await act(async () => separator.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 700, bubbles: true })))
  expect(container.querySelector('.workbench-page-dock-resize-shield')).not.toBeNull()
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 640 })))
  expect(layout.state.sizes.right).toBe(564)
  await act(async () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })))
  expect(container.querySelector('.workbench-page-dock-resize-shield')).toBeNull()
  expect(document.body.style.cursor).toBe('')
})
