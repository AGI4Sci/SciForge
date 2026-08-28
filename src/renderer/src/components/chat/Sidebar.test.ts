import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  Sidebar,
  buildSidebarVisibleContextComponent
} from './Sidebar'

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
    codeWorkspaceRoots: ['/workspace'],
    hiddenCodeWorkspaceRoots: [],
    chooseWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: []
  })
}))

describe('Sidebar navigation continuity', () => {
  it.each(['schedule'] as const)(
    'keeps core navigation and conversation history visible in the %s view',
    (activeView) => {
      const html = renderToStaticMarkup(
        createElement(Sidebar, {
          navigationSections: [{
            id: 'fixture.cloud-projects',
            content: createElement('section', null, 'fixtureCloudProjects')
          }],
          threads: [],
          activeThreadId: null,
          activeView,
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
        })
      )

      expect(html).toContain('newAgent')
      expect(html).toContain('plugins')
      expect(html).toContain('schedule')
      expect(html).not.toContain('workflow')
      expect(html).toContain('fixtureCloudProjects')
      expect(html).toContain('sidebarLocalWorkspaces')
      expect(html.indexOf('fixtureCloudProjects')).toBeLessThan(
        html.indexOf('sidebarLocalWorkspaces')
      )
      expect(html).not.toContain('workflowSidebarHint')
    }
  )
})

describe('Sidebar visible context', () => {
  it('publishes bounded semantic navigation state without list or message contents', () => {
    const component = buildSidebarVisibleContextComponent({
      activeThreadId: 'thread-active',
      activeView: 'chat',
      pluginsActive: false,
      runtimeReady: true,
      threadSearch: 'private search text',
      showArchivedThreads: false,
      threads: [
        {
          id: 'thread-active',
          title: 'private session title',
          preview: 'private session message',
          updatedAt: '2026-06-13T00:00:00.000Z',
          model: 'auto',
          mode: 'agent',
          workspace: '/workspace'
        },
        {
          id: 'thread-archived',
          title: 'archived title',
          preview: 'archived message',
          updatedAt: '2026-06-12T00:00:00.000Z',
          model: 'auto',
          mode: 'agent',
          workspace: '/workspace',
          archived: true
        }
      ],
      workspaceRoot: '/workspace',
      workspaceCount: 3,
      hiddenWorkspaceCount: 1,
      updatedAt: '2026-06-13T00:03:00.000Z'
    })

    expect(component).toMatchObject({
      id: 'left-sidebar',
      region: 'left-sidebar',
      component: 'navigation-sidebar',
      visible: true,
      resources: [
        { kind: 'workspace', role: 'selected-workspace', workspaceRoot: '/workspace' },
        { kind: 'agentSession', role: 'selected-session', selectedThreadId: 'thread-active' }
      ],
      state: {
        activeEntry: 'session',
        selectedSessionId: 'thread-active',
        selectedWorkspaceRoot: '/workspace',
        sessionCount: 2,
        archivedSessionCount: 1,
        workspaceCount: 3,
        hiddenWorkspaceCount: 1,
        searchActive: true,
        showingArchivedSessions: false,
        runtimeReady: true,
        availableEntries: expect.arrayContaining(['projects', 'settings'])
      }
    })
    const serialized = JSON.stringify(component)
    expect(serialized).not.toContain('private session title')
    expect(serialized).not.toContain('private session message')
    expect(serialized).not.toContain('private search text')
  })

  it('reflects navigation selection changes while keeping component identity stable', () => {
    const base = {
      activeThreadId: null,
      activeView: 'chat' as const,
      pluginsActive: false,
      runtimeReady: true,
      threadSearch: '',
      showArchivedThreads: false,
      threads: [],
      workspaceRoot: '/workspace',
      workspaceCount: 1,
      hiddenWorkspaceCount: 0,
      updatedAt: '2026-06-13T00:03:00.000Z'
    }
    const projects = buildSidebarVisibleContextComponent(base)
    const plugins = buildSidebarVisibleContextComponent({
      ...base,
      pluginsActive: true,
      updatedAt: '2026-06-13T00:04:00.000Z'
    })

    expect(projects.id).toBe(plugins.id)
    expect(projects.region).toBe(plugins.region)
    expect(projects.state?.activeEntry).toBe('projects')
    expect(plugins.state?.activeEntry).toBe('plugins')
    expect(plugins.updatedAt).not.toBe(projects.updatedAt)
  })
})
