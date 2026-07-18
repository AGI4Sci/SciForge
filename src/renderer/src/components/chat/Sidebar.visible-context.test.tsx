import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

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
    queuedMessages: [],
    remoteChannels: [],
    activeRemoteChannelId: null,
    remoteGuardChannelId: null,
    selectRemoteGuardChannel: vi.fn(),
    addRemoteChannel: vi.fn(),
    deleteRemoteChannel: vi.fn()
  })
}))

import { Sidebar } from './Sidebar'

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
      connectPhoneSidebarOpen: false,
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
      onToggleConnectPhone: vi.fn(),
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
