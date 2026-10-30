// @vitest-environment happy-dom
import { act, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import {
  WORKBENCH_MAIN_AREA_CONTRACT_VERSION,
  WORKBENCH_MAIN_AREA_LOCATION,
  type DomainRendererWorkbenchMainAreaRenderContext
} from '@sciforge/domain-sdk/renderer'
import {
  WorkbenchMainAreaContributionRegistry,
  WorkbenchMainAreaOutlet,
  type WorkbenchSessionDockHost
} from './workbench-main-area'
import { WorkbenchSessionReturn } from './workbench-session-return'

type PageContext = DomainRendererWorkbenchMainAreaRenderContext<ReactElement | null>

function FixturePage({ context }: { context: PageContext }): ReactElement {
  const [count, setCount] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  return (
    <div className={context.className}>
      <p id="activation">{JSON.stringify(context.activation)}</p>
      <button id="count" onClick={() => setCount(count + 1)}>{count}</button>
      <button id="open-detail" onClick={() => setDetailOpen(true)}>detail</button>
      <button id="dock-own" onClick={() => setSessionId('own-session')}>own</button>
      <button id="dock-foreign" onClick={() => setSessionId('foreign-session')}>foreign</button>
      {detailOpen ? context.renderSessionDock({
        label: 'Fixture detail',
        companion: <p id="companion">companion</p>,
        sessionId,
        onClose: () => setDetailOpen(false),
        onCloseSession: () => setSessionId(null)
      }) : null}
    </div>
  )
}

const registry = new WorkbenchMainAreaContributionRegistry()
registry.register({
  id: 'fixture.page',
  ownerId: 'fixture',
  contract: {
    location: WORKBENCH_MAIN_AREA_LOCATION,
    contractVersion: WORKBENCH_MAIN_AREA_CONTRACT_VERSION,
    label: 'fixturePage',
    preferredHostSidebar: 'expanded'
  },
  value: { render: (context) => <FixturePage context={context} /> }
})

const containers: HTMLElement[] = []
afterEach(() => {
  for (const container of containers.splice(0)) container.remove()
})

async function mount() {
  const activations: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  containers.push(container)
  const root = createRoot(container)
  let state: { activePageId: string | null; activeSessionId: string | null; activations?: Parameters<typeof WorkbenchMainAreaOutlet>[0]['activations'] } = {
    activePageId: 'fixture.page',
    activeSessionId: 'previous-session'
  }
  const dock = (): WorkbenchSessionDockHost => ({
    ownedSessionIds: new Set(['previous-session', 'own-session']),
    activeSessionId: state.activeSessionId,
    sessionView: <section id="session-view">{state.activeSessionId}</section>,
    activateSession: (id) => {
      activations.push(id)
      state = { ...state, activeSessionId: id }
      render()
    },
    labels: { refused: 'refused', close: 'Close' }
  })
  const render = () => root.render(
    <WorkbenchMainAreaOutlet
      pages={registry.list()}
      activePageId={state.activePageId}
      activations={state.activations}
      dock={dock()}
    />
  )
  const update = async (next: Partial<typeof state>) => {
    state = { ...state, ...next }
    await act(async () => { render() })
  }
  await act(async () => { render() })
  const click = async (selector: string) => {
    await act(async () => { container.querySelector<HTMLElement>(selector)!.click() })
  }
  return { container, root, activations, update, click }
}

it('docks only the principal’s own Session beside the page companion and refuses others', async () => {
  const { container, root, activations, click } = await mount()
  await click('#open-detail')
  const dialog = container.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-label')).toBe('Fixture detail')
  expect(container.querySelector('#companion')).not.toBeNull()
  expect(container.querySelector('#session-view')).toBeNull()

  await click('#dock-foreign')
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('refused')
  expect(container.querySelector('#session-view')).toBeNull()
  expect(activations).toEqual([])

  await click('#dock-own')
  expect(activations).toEqual(['own-session'])
  expect(container.querySelector('#session-view')?.textContent).toBe('own-session')
  expect(container.querySelector('#companion')).not.toBeNull()
  expect(container.querySelector('.workbench-session-dock-track')
    ?.getAttribute('data-has-session')).toBe('true')

  await click('button[aria-label="Close"]')
  expect(container.querySelector('#session-view')).toBeNull()
  expect(container.querySelector('#companion')).not.toBeNull()

  await act(async () => {
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { root.unmount() })
})

it('closes the docked Session on Escape before closing the page drawer', async () => {
  const { container, root, click } = await mount()
  await click('#open-detail')
  await click('#dock-own')
  const escape = () => act(async () => {
    container.querySelector('#companion')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
  })
  await escape()
  expect(container.querySelector('#session-view')).toBeNull()
  expect(container.querySelector('#companion')).not.toBeNull()
  await escape()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { root.unmount() })
})

it('restores page state on return and never mounts the Session UI from a hidden page', async () => {
  const { container, root, activations, update, click } = await mount()
  await click('#count')
  await click('#open-detail')
  await click('#dock-own')
  expect(container.querySelector('#count')?.textContent).toBe('1')

  await update({ activePageId: null, activeSessionId: 'other-session' })
  expect(container.querySelector('#count')?.closest('[hidden]')).not.toBeNull()
  // A display utility on the hidden wrapper would override [hidden] and leave the
  // page painted beside the Session page.
  const hiddenWrapper = container.querySelector('#count')!.closest('[hidden]')!
  expect(hiddenWrapper.className.split(/\s+/)).not.toContain('flex')
  expect(hiddenWrapper.className.split(/\s+/)).toContain('hidden')
  expect(container.querySelector('#session-view')).toBeNull()

  await update({ activePageId: 'fixture.page' })
  expect(container.querySelector('#count')?.textContent).toBe('1')
  expect(activations).toEqual(['own-session', 'own-session'])
  expect(container.querySelector('#session-view')?.textContent).toBe('own-session')
  await act(async () => { root.unmount() })
})

it('returns an opaque navigation activation only to its installed main-area contribution', async () => {
  const { container, root, update, click } = await mount()
  await click('#count')
  await update({ activePageId: null, activeSessionId: 'own-session' })
  const activation = { revision: 2, payload: { taskId: 'task-1' } }
  await update({ activePageId: 'fixture.page', activations: { 'fixture.page': activation } })
  expect(container.querySelector('#activation')?.textContent).toBe(JSON.stringify(activation))
  expect(container.querySelector('#count')?.textContent).toBe('1')
  expect(container.querySelector('#session-view')).toBeNull()
  await act(async () => { root.unmount() })
})

it('the standard Session return action restores the owning page with its exact opaque task activation', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  containers.push(container)
  const root = createRoot(container)
  const target = { contributionId: 'fixture.page', label: 'Task #1 · Return to delivery',
    activation: { revision: 1, payload: { projectId: 'project-1', taskId: 'task-1' } } }
  function Shell() {
    const [active, setActive] = useState(false)
    const [activations, setActivations] = useState<Parameters<typeof WorkbenchMainAreaOutlet>[0]['activations']>({})
    return <>
      {!active ? <WorkbenchSessionReturn target={target} onReturn={next => {
        setActivations({ [next.contributionId]: next.activation! })
        setActive(true)
      }} /> : null}
      <WorkbenchMainAreaOutlet pages={registry.list()} activePageId={active ? target.contributionId : null}
        activations={activations} dock={{ ownedSessionIds: new Set(['own-session']), activeSessionId: 'own-session',
          sessionView: <section>Standard Session</section>, activateSession: () => undefined,
          labels: { refused: 'refused', close: 'close' } }} />
    </>
  }
  await act(async () => root.render(<Shell />))
  const back = container.querySelector<HTMLButtonElement>('[data-testid="session-return-to-domain"]')!
  back.focus()
  expect(document.activeElement).toBe(back)
  expect(back.textContent).toBe(target.label)
  await act(async () => back.click())
  expect(container.querySelector('#activation')?.textContent).toBe(JSON.stringify(target.activation))
  expect(container.querySelector('[data-testid="session-return-to-domain"]')).toBeNull()
  await act(async () => root.unmount())
})
