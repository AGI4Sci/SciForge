import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  LayoutGrid,
  Plus,
  Settings
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import type { VisibleContextComponentSnapshot } from '@shared/visible-context'
import { registerVisibleContextComponent } from '../../lib/visible-context'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import {
  SidebarCommandRow,
  SidebarFrame
} from '../sidebar/SidebarPrimitives'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'schedule'
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onShowArchivedThreadsChange: (show: boolean) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onScheduleOpen: () => void
  onToggleSidebar: () => void
}

type SidebarVisibleContextInput = {
  activeThreadId: string | null
  activeView: Props['activeView']
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceCount: number
  hiddenWorkspaceCount: number
  updatedAt?: string
}

export function buildSidebarVisibleContextComponent({
  activeThreadId,
  activeView,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  threads,
  workspaceRoot,
  workspaceCount,
  hiddenWorkspaceCount,
  updatedAt = new Date().toISOString()
}: SidebarVisibleContextInput): VisibleContextComponentSnapshot {
  const activeEntry = pluginsActive
        ? 'plugins'
        : activeView === 'schedule'
          ? 'schedule'
          : activeThreadId
            ? 'session'
            : 'projects'
  const resources = [
    ...(workspaceRoot
      ? [{
          kind: 'workspace',
          role: 'selected-workspace',
          workspaceRoot
        }]
      : []),
    ...(activeThreadId
      ? [{
          kind: 'agentSession',
          role: 'selected-session',
          selectedThreadId: activeThreadId
        }]
      : [])
  ]

  return {
    id: 'left-sidebar',
    region: 'left-sidebar',
    component: 'navigation-sidebar',
    title: 'Navigation sidebar',
    visible: true,
    priority: 20,
    updatedAt,
    summary: `Left navigation is focused on ${activeEntry}; ${threads.length} sessions and ${workspaceCount} workspaces are available.`,
    ...(resources.length > 0 ? { resources } : {}),
    state: {
      activeEntry,
      selectedSessionId: activeThreadId,
      selectedWorkspaceRoot: workspaceRoot || null,
      sessionCount: threads.length,
      archivedSessionCount: threads.filter((thread) => thread.archived === true).length,
      workspaceCount,
      hiddenWorkspaceCount,
      searchActive: threadSearch.trim().length > 0,
      showingArchivedSessions: showArchivedThreads,
      runtimeReady,
      availableEntries: [
        'new-agent',
        'plugins',
        'schedule',
        'projects',
        'settings'
      ]
    }
  }
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onShowArchivedThreadsChange,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onOpenSettings,
  onOpenPlugins,
  onScheduleOpen,
  onToggleSidebar
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const hiddenCodeWorkspaceRoots = useChatStore((s) => s.hiddenCodeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  useEffect(() => registerVisibleContextComponent(buildSidebarVisibleContextComponent({
    activeThreadId,
    activeView,
    pluginsActive,
    runtimeReady,
    threadSearch,
    showArchivedThreads,
    threads,
    workspaceRoot,
    workspaceCount: codeWorkspaceRoots.length,
    hiddenWorkspaceCount: hiddenCodeWorkspaceRoots.length
  })), [
    activeThreadId,
    activeView,
    codeWorkspaceRoots.length,
    hiddenCodeWorkspaceRoots.length,
    pluginsActive,
    runtimeReady,
    showArchivedThreads,
    threadSearch,
    threads,
    workspaceRoot
  ])
  return (
    <>
    <SidebarFrame
      title={t('appName')}
      onCollapse={onToggleSidebar}
      footer={
        <div className="space-y-1">
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={() => onOpenSettings('general')}
            variant="footer"
          />
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col px-1">
        <SidebarCommandRow
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label={t('newAgent')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('schedule')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
      </div>

      <div className="ds-no-drag mx-1 my-3" />

      <SidebarProjectsSection
        threads={threads}
        activeView="chat"
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        hiddenWorkspaceRoots={hiddenCodeWorkspaceRoots}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        onShowArchivedChange={onShowArchivedThreadsChange}
        t={t}
      />

    </SidebarFrame>

    </>
  )
}
