// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MessageSquare } from 'lucide-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkbenchToolbarMenu } from './WorkbenchTopBar'
import { WorkbenchCommandRegistry } from '../../domain-modules/workbench-command-registry'
import { WORKBENCH_TOOLBAR_SLOT, WorkbenchToolbarActionContributionRegistry } from '../../domain-modules/workbench-toolbar-slot'
import i18n from '../../i18n'

vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { getSettings: async () => ({}) } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  await i18n.changeLanguage('en')
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.getSelection()?.removeAllRanges() })

function setup() {
  const commands = new WorkbenchCommandRegistry()
  const toolbar = new WorkbenchToolbarActionContributionRegistry(commands)
  const execute = vi.fn()
  commands.register({ id: 'review.selection', ownerId: 'review', contribution: {
    execute, isAvailable: context => context.sessionId === 'canvas-owner'
  } })
  toolbar.register({ id: 'review.toolbar', ownerId: 'review',
    contract: { location: WORKBENCH_TOOLBAR_SLOT, commandId: 'review.selection', label: 'Comment on selection' },
    value: { icon: MessageSquare } })
  const invocation = { sessionId: 'canvas-owner', runtimeId: 'codex', workspaceRoot: '/canvas-project',
    activeSurface: { kind: 'global-overlay' as const, contributionId: 'workspace.canvas' } }
  return { commands, toolbar, execute, invocation }
}

it('keeps installed tools in one compact menu and executes their command with the canvas owner and selection intact', async () => {
  const { commands, toolbar, execute, invocation } = setup()
  await act(async () => root.render(<>
    <p data-source>科研阶段中的原始选区</p>
    <WorkbenchToolbarMenu toolbarActions={toolbar.list()} toolbarCommandInvocation={invocation}
      onExecuteToolbarCommand={id => { void commands.execute(id, invocation) }} />
  </>))
  // Menu presentation is explicit, so a wide canvas does not expand all tools.
  expect(container.querySelector('[data-action-id="review.toolbar"]')).toBeNull()
  const more = container.querySelector<HTMLButtonElement>('button[aria-label="More tools"]')!
  expect(more).not.toBeNull()
  const source = container.querySelector('[data-source]')!
  const range = document.createRange(); range.selectNodeContents(source)
  window.getSelection()!.addRange(range)
  const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
  await act(async () => { more.dispatchEvent(down); more.click() })
  expect(down.defaultPrevented).toBe(true)
  const menu = document.body.querySelector('[role="dialog"][aria-label="More tools"]')!
  expect(menu.getAttribute('aria-hidden')).toBe('false')
  const action = menu.querySelector<HTMLButtonElement>('[data-action-id="review.toolbar"]')!
  await act(async () => {
    action.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    action.click()
  })
  expect(execute).toHaveBeenCalledOnce()
  expect(execute).toHaveBeenCalledWith(invocation)
  expect(window.getSelection()!.toString()).toBe('科研阶段中的原始选区')
  expect(source.isConnected).toBe(true)
  expect(menu.getAttribute('aria-hidden')).toBe('true')
})

it('respects command availability for the owning surface and does not invent unavailable tools', async () => {
  const { toolbar, invocation } = setup()
  await act(async () => root.render(<WorkbenchToolbarMenu toolbarActions={toolbar.list()}
    toolbarCommandInvocation={{ ...invocation, sessionId: 'unrelated-main' }} onExecuteToolbarCommand={vi.fn()} />))
  expect(document.body.querySelector('[data-action-id="review.toolbar"]')).toBeNull()
  expect(container.querySelector('button[aria-label="Customize toolbar"]')).not.toBeNull()
})
