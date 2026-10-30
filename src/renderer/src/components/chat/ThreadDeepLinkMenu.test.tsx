// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { ChildAgentsPanelView } from './ChildAgentsPanel'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key })
}))
let root: Root
let container: HTMLDivElement
const writeText = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function openMenu(element: Element): Promise<void> {
  await act(async () => { element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })) })
}
async function copy(): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'copyThreadDeepLink')!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
it('copies the running main session from its existing context menu', async () => {
  await act(async () => root.render(createElement(SidebarProjectsSection, {
      activeView: 'chat',
      runtimeReady: true,
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-a'],
      watchTurnCompletion: {},
      unreadThreadIds: {},
      locale: 'en',
      onPickWorkspace: vi.fn(),
      onRemoveWorkspace: vi.fn(),
      onCreateThreadInWorkspace: vi.fn(),
      onSelectThread: vi.fn(),
      onRenameThread: vi.fn(),
      onArchiveThread: vi.fn(),
      onDeleteThread: vi.fn(),
      onRestoreThread: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onShowArchivedChange: vi.fn(),
      t: (key: string) => key,
      threads: [{ id: 'main-session', title: 'Main session', workspace: '/Users/zxy/project-a', updatedAt: '2026-09-30T00:00:00Z', mode: 'agent', model: 'test' }],
      busy: true,
      activeThreadId: 'main-session'
  })))
  const row = Array.from(container.querySelectorAll('div')).find((item) => item.getAttribute('title') === 'Main session')
  const title = Array.from(container.querySelectorAll('*')).find((item) => item.textContent === 'Main session' && item.children.length === 0)!
  await openMenu(row ?? title)
  await copy()
  expect(writeText).toHaveBeenCalledWith('codex://threads/main-session')
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
it('copies the child session reference instead of the task id and reports clipboard failure', async () => {
  await act(async () => root.render(createElement(ChildAgentsPanelView, {
    activeThreadId: 'thread-main',
    activeRuntimeId: 'codex',
    children: [{ runtimeId: 'codex', parentThreadId: 'thread-main', id: 'task-id', kind: 'agent', name: 'research', status: 'running', openAsThreadRef: { runtimeId: 'codex', threadId: 'actual-session' } }],
    selectedChildId: null,
    loading: false,
    error: null,
    selectedSide: null,
    sideLoading: false,
    runtimeConnection: 'ready',
    composerPickList: ['deepseek-chat'],
    composerModelGroups: [],
    activeAgentRuntime: 'codex',
    runtimeCapabilities: {
      interrupt: true,
      stream: true,
      approvals: true,
      attachFiles: false
    },
    transcriptState: { status: 'idle' },
    onSelectChild: vi.fn(),
    onSideInputChange: vi.fn(),
    onSideSend: vi.fn(),
    onSideRemoveQueuedMessage: vi.fn(),
    onSideInterrupt: vi.fn(),
    onSideModelChange: vi.fn(),
    onSideReasoningEffortChange: vi.fn(),
    onCollapse: vi.fn(),
    t: (key: string) => key,
  })))
  await openMenu(container.querySelector('[role="tab"]')!)
  writeText.mockRejectedValueOnce(new Error('denied'))
  await copy()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('copyFailed')
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(writeText).toHaveBeenLastCalledWith('codex://threads/actual-session')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await openMenu(container.querySelector('[role="tab"]')!)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
