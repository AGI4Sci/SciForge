import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const visibleContextMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  effects: [] as Array<void | (() => void)>,
  register: vi.fn()
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => {
    visibleContextMocks.effects.push(effect())
  }
}))

vi.mock('../../lib/visible-context', () => ({
  registerVisibleContextComponent: visibleContextMocks.register
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' }
  })
}))

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    workspaceRoot: '/workspace',
    codeWorkspaceRoots: ['/workspace', '/workspace-two'],
    hiddenCodeWorkspaceRoots: ['/workspace-hidden'],
    chooseWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: []
  })
}))

// The projects section is incidental to the sidebar's own registration
// lifecycle; it also reads runtime settings and window events on mount, which
// this node-environment render cannot provide.
vi.mock('./SidebarProjectsSection', () => ({
  SidebarProjectsSection: () => null
}))

import { Sidebar } from './Sidebar'

beforeEach(() => {
  visibleContextMocks.effects.length = 0
  vi.stubGlobal('window', new EventTarget())
})

afterEach(() => {
  for (const cleanup of visibleContextMocks.effects) {
    if (typeof cleanup === 'function' && cleanup !== visibleContextMocks.cleanup) cleanup()
  }
  vi.unstubAllGlobals()
})

describe('Sidebar visible-context lifecycle', () => {
  it('returns the canonical registration cleanup and publishes the current props', () => {
    visibleContextMocks.register.mockReturnValue(visibleContextMocks.cleanup)

    renderToStaticMarkup(createElement(Sidebar, {
      threads: [{
        id: 'thread-active',
        title: 'Session',
        updatedAt: '2026-06-13T00:00:00.000Z',
        model: 'auto',
        mode: 'agent',
        workspace: '/workspace'
      }],
      activeThreadId: 'thread-active',
      activeView: 'schedule',
      pluginsActive: false,
      runtimeReady: true,
      threadSearch: '',
      showArchivedThreads: false,
      onThreadSearchChange: vi.fn(),
      onShowArchivedThreadsChange: vi.fn(),
      onSelectThread: vi.fn(),
      onRenameThread: vi.fn(async () => undefined),
      onArchiveThread: vi.fn(async () => undefined),
      onDeleteThread: vi.fn(async () => undefined),
      onRestoreThread: vi.fn(async () => undefined),
      onNewChat: vi.fn(),
      onNewChatInWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenPlugins: vi.fn(),
      onScheduleOpen: vi.fn(),
      onToggleSidebar: vi.fn()
    }))

    expect(visibleContextMocks.register).toHaveBeenCalledOnce()
    expect(visibleContextMocks.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'left-sidebar',
      region: 'left-sidebar',
      state: expect.objectContaining({
        activeEntry: 'schedule',
        selectedSessionId: 'thread-active',
        selectedWorkspaceRoot: '/workspace',
        sessionCount: 1,
        workspaceCount: 2,
        hiddenWorkspaceCount: 1
      })
    }))

    const cleanup = visibleContextMocks.effects.find(
      (effect): effect is () => void => typeof effect === 'function'
    )
    expect(cleanup).toBe(visibleContextMocks.cleanup)
    cleanup?.()
    expect(visibleContextMocks.cleanup).toHaveBeenCalledOnce()
  })
})
