import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import {
  buildSidebarWorkspaceGroups,
  SidebarProjectsSection,
  sortSidebarThreadsForDisplay,
  ThreadRenameDialog
} from './SidebarProjectsSection'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'reasonix',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.latestTurnStatus !== undefined ? { latestTurnStatus: overrides.latestTurnStatus } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function renderProjectsSectionHtml(
  overrides: Partial<Parameters<typeof SidebarProjectsSection>[0]>
): string {
  return renderToStaticMarkup(
    createElement(SidebarProjectsSection, {
      threads: [],
      activeView: 'chat',
      activeThreadId: null,
      runtimeReady: true,
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-a'],
      busy: false,
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
      ...overrides
    })
  )
}

describe('SidebarProjectsSection groups', () => {
  it('keeps remembered code workspaces visible even when the runtime lists only one workspace', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '/Users/zxy/project-c'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b',
      '/Users/zxy/project-c'
    ])
    expect(groups[1]?.[1]).toEqual([])
    expect(groups[2]?.[1]).toEqual([])
  })

  it('does not show registry-only empty workspaces while searching or viewing archives', () => {
    const base = {
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-b']
    }

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: 'project',
        showArchived: false
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: '',
        showArchived: true
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])
  })

  it('hides removed workspaces even when old threads still exist', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'hidden-thread', workspace: '/Users/zxy/project-hidden' }),
        thread({ id: 'visible-thread', workspace: '/Users/zxy/project-visible' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-visible',
      workspaceRoots: ['/Users/zxy/project-hidden', '/Users/zxy/project-visible'],
      hiddenWorkspaceRoots: ['/Users/zxy/project-hidden']
    })

    expect(groups.map(([workspace]) => workspace)).toEqual(['/Users/zxy/project-visible'])
  })

  it('shows the default workspace while filtering write workspaces from code project groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'default-code', workspace: '/Users/zxy/.sciforge/default_workspace' }),
        thread({ id: 'write-assistant', workspace: '~/.sciforge/write_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/.sciforge/default_workspace',
        '~/.sciforge/write_workspace'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/.sciforge/default_workspace'
    ])
    expect(groups[1]?.[1].map((item) => item.id)).toEqual(['default-code'])
  })

  it('merges default workspace aliases into one sidebar group', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'default-short', workspace: '~/.sciforge/default_workspace' }),
        thread({ id: 'default-absolute', workspace: 'C:\\Users\\zxy\\.sciforge\\default_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: 'C:\\Users\\zxy\\.sciforge\\default_workspace',
      workspaceRoots: [
        '~/.sciforge/default_workspace',
        'C:\\Users\\zxy\\.sciforge\\default_workspace'
      ]
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.[0]).toBe('C:\\Users\\zxy\\.sciforge\\default_workspace')
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['default-short', 'default-absolute'])
  })

  it('keeps running thread order stable while refreshed snapshots update timestamps', () => {
    const firstSnapshot = [
      thread({
        id: 'running-thread',
        title: 'Running',
        workspace: '/Users/zxy/project-a',
        updatedAt: '2026-06-01T00:00:00.000Z',
        status: 'running'
      }),
      thread({
        id: 'older-thread',
        title: 'Older',
        workspace: '/Users/zxy/project-a',
        updatedAt: '2026-05-31T23:59:00.000Z'
      })
    ]
    const runningSortKeys = new Map([
      ['running-thread', Date.parse(firstSnapshot[0].updatedAt)]
    ])
    const refreshedSnapshot = [
      {
        ...firstSnapshot[0],
        updatedAt: '2026-06-01T00:05:00.000Z'
      },
      thread({
        id: 'newer-thread',
        title: 'Newer idle',
        workspace: '/Users/zxy/project-a',
        updatedAt: '2026-06-01T00:01:00.000Z'
      }),
      firstSnapshot[1]
    ]

    expect(sortSidebarThreadsForDisplay(refreshedSnapshot, runningSortKeys).map((item) => item.id)).toEqual([
      'newer-thread',
      'running-thread',
      'older-thread'
    ])
  })

  it('shows a stable running label instead of relative time for running rows', () => {
    const html = renderProjectsSectionHtml({
      threads: [
        thread({
          id: 'running-thread',
          title: 'Running local',
          workspace: '/Users/zxy/project-a',
          updatedAt: '2026-06-01T00:00:00.000Z',
          status: 'running'
        })
      ]
    })

    expect(html).toContain('Running local')
    expect(html).toContain('Running')
    expect(html).not.toContain('2026')
  })
})

describe('ThreadRenameDialog', () => {
  it('renders an in-app rename form with the current thread title prefilled', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRenameDialog, {
        state: {
          thread: thread({
            id: 'thr_rename',
            title: 'Build rename dialog',
            workspace: '/Users/zxy/project-a'
          }),
          value: 'Build rename dialog',
          submitting: false
        },
        onClose: vi.fn(),
        onValueChange: vi.fn(),
        onSubmit: vi.fn(),
        t: (key: string) => key
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('sidebarThreadRename')
    expect(html).toContain('value="Build rename dialog"')
    expect(html).toContain('type="submit" disabled=""')
  })
})
