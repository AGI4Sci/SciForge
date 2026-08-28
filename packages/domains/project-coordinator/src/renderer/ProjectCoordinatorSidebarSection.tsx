import React, { type ReactElement } from 'react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  FileText,
  FolderOpen,
  ListTodo,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import type {
  DomainRendererWorkbenchNavigationSectionRenderContext,
  DomainRendererWorkbenchNavigationSession
} from '@sciforge/domain-sdk/renderer'

import type {
  ProjectCoordinatorWorkspace
} from '../contract.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import {
  subscribeProjectCoordinatorWorkspaceInvalidation
} from './workspace-invalidation.js'

const CLOUD_PROJECTS_REFRESH_INTERVAL_MS = 30_000

export type ProjectCoordinatorSidebarViewId =
  | 'overview'
  | 'tasks'
  | 'files'
  | 'decisions'
  | 'recovery'

export type ProjectCoordinatorSidebarReadState = Readonly<{
  requestRevision: number
  loading: boolean
  refreshing: boolean
  workspace?: ProjectCoordinatorWorkspace
  error?: string
}>

export const initialProjectCoordinatorSidebarReadState:
  ProjectCoordinatorSidebarReadState = Object.freeze({
  requestRevision: 0,
  loading: true,
  refreshing: false
})

export type ProjectCoordinatorSidebarReadAction =
  | Readonly<{
      type: 'begin'
      revision: number
      mode: 'foreground' | 'background'
    }>
  | Readonly<{
      type: 'success'
      revision: number
      workspace: ProjectCoordinatorWorkspace
    }>
  | Readonly<{
      type: 'failure'
      revision: number
      error: string
    }>

export function projectCoordinatorSidebarReadReducer(
  state: ProjectCoordinatorSidebarReadState,
  action: ProjectCoordinatorSidebarReadAction
): ProjectCoordinatorSidebarReadState {
  if (action.type === 'begin') {
    if (action.revision <= state.requestRevision) return state
    return {
      ...state,
      requestRevision: action.revision,
      loading: action.mode === 'foreground',
      refreshing: action.mode === 'background',
      error: undefined
    }
  }
  if (action.revision !== state.requestRevision) return state
  if (action.type === 'success') {
    return {
      requestRevision: state.requestRevision,
      loading: false,
      refreshing: false,
      workspace: action.workspace
    }
  }
  return {
    requestRevision: state.requestRevision,
    loading: false,
    refreshing: false,
    error: action.error
  }
}

export type ProjectCoordinatorSidebarSectionProps = Readonly<{
  client: ProjectCoordinatorRendererClient
  context: DomainRendererWorkbenchNavigationSectionRenderContext
  sessionBindings?: readonly ProjectCoordinatorSidebarSessionBinding[]
  onCreateProject: () => void
  onOpenProject: (
    projectId: string,
    view: ProjectCoordinatorSidebarViewId
  ) => void
}>

export type ProjectCoordinatorSidebarSessionBinding = Readonly<{
  projectId: string
  runtimeId: string
  threadId: string
}>

export function projectCoordinatorSidebarSessionAliases(
  projectId: string,
  catalog: readonly DomainRendererWorkbenchNavigationSession[],
  bindings: readonly ProjectCoordinatorSidebarSessionBinding[]
): readonly DomainRendererWorkbenchNavigationSession[] {
  const sessionsByRuntimeThread = new Map(catalog.flatMap((session) => (
    session.runtimeId
      ? [[`${session.runtimeId}\u0000${session.id}`, session] as const]
      : []
  )))
  const selected = new Map<string, DomainRendererWorkbenchNavigationSession>()
  for (const binding of bindings) {
    if (binding.projectId !== projectId) continue
    const session = sessionsByRuntimeThread.get(
      `${binding.runtimeId}\u0000${binding.threadId}`
    )
    if (session) selected.set(session.id, session)
  }
  return Object.freeze([...selected.values()])
}

export function ProjectCoordinatorSidebarSection({
  client,
  context,
  sessionBindings = [],
  onCreateProject,
  onOpenProject
}: ProjectCoordinatorSidebarSectionProps): ReactElement {
  const [state, dispatch] = useReducer(
    projectCoordinatorSidebarReadReducer,
    initialProjectCoordinatorSidebarReadState
  )
  const [collapsed, setCollapsed] = useState(false)
  const [expandedProjectId, setExpandedProjectId] = useState<string>()
  const requestRevisionRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async (
    mode: 'foreground' | 'background' = 'background'
  ) => {
    const revision = requestRevisionRef.current + 1
    requestRevisionRef.current = revision
    dispatch({ type: 'begin', revision, mode })
    try {
      const workspace = await client.readWorkspace()
      if (!mountedRef.current) return
      dispatch({ type: 'success', revision, workspace })
    } catch (cause) {
      if (!mountedRef.current) return
      dispatch({
        type: 'failure',
        revision,
        error: cause instanceof Error ? cause.message : String(cause)
      })
    }
  }, [client])

  useEffect(() => {
    void refresh('foreground')
  }, [refresh, context.session.id])

  useEffect(() => subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    void refresh('background')
  }), [refresh])

  useEffect(() => {
    if (!context.active) return undefined
    const refreshWhenVisible = () => {
      if (globalThis.document?.visibilityState === 'hidden') return
      void refresh('background')
    }
    const timer = globalThis.setInterval(
      refreshWhenVisible,
      CLOUD_PROJECTS_REFRESH_INTERVAL_MS
    )
    const onVisibilityChange = () => {
      if (globalThis.document?.visibilityState === 'visible') refreshWhenVisible()
    }
    globalThis.document?.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      globalThis.clearInterval(timer)
      globalThis.document?.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [context.active, refresh])

  return (
    <ProjectCoordinatorSidebarView
      state={state}
      className={context.className}
      collapsed={collapsed}
      expandedProjectId={expandedProjectId}
      onCollapsedChange={setCollapsed}
      onExpandedProjectChange={setExpandedProjectId}
      onRefresh={() => void refresh('foreground')}
      sessionCatalog={context.sessions}
      sessionBindings={sessionBindings}
      onSelectSession={context.selectSession}
      onCreateProject={onCreateProject}
      onOpenProject={onOpenProject}
    />
  )
}

export type ProjectCoordinatorSidebarViewProps = Readonly<{
  state: ProjectCoordinatorSidebarReadState
  className?: string
  collapsed: boolean
  expandedProjectId?: string
  onCollapsedChange: (collapsed: boolean) => void
  onExpandedProjectChange: (projectId: string | undefined) => void
  onRefresh: () => void
  sessionCatalog?: readonly DomainRendererWorkbenchNavigationSession[]
  sessionBindings?: readonly ProjectCoordinatorSidebarSessionBinding[]
  onSelectSession?: (sessionId: string) => void
  onCreateProject: () => void
  onOpenProject: (
    projectId: string,
    view: ProjectCoordinatorSidebarViewId
  ) => void
}>

export function ProjectCoordinatorSidebarView({
  state,
  className,
  collapsed,
  expandedProjectId,
  onCollapsedChange,
  onExpandedProjectChange,
  onRefresh,
  sessionCatalog = [],
  sessionBindings = [],
  onSelectSession = () => undefined,
  onCreateProject,
  onOpenProject
}: ProjectCoordinatorSidebarViewProps): ReactElement {
  const { t } = useTranslation('common')
  const workspace = state.workspace
  const connection = workspace?.connection
  const projects = connection?.state === 'ready' ? workspace?.projects ?? [] : []

  return (
    <section
      className={`${className ?? ''} px-2 pb-1`}
      aria-label={t('projectCoordinatorSidebarCloudProjects')}
      data-project-coordinator-navigation="cloud-projects"
    >
      <header className="flex min-h-[38px] items-center justify-between py-1.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Cloud className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
          <span className="truncate">{t('projectCoordinatorSidebarCloudProjects')}</span>
          {collapsed
            ? <ChevronRight className="h-3 w-3 shrink-0" />
            : <ChevronDown className="h-3 w-3 shrink-0" />}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="rounded-md p-1.5 text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted disabled:opacity-50"
            aria-label={t('projectCoordinatorRefresh')}
            disabled={state.loading || state.refreshing}
            onClick={onRefresh}
          >
            {state.loading || state.refreshing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-accent"
            aria-label={t('projectCoordinatorCenterNewProject')}
            onClick={onCreateProject}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {!collapsed ? (
        <div className="space-y-1">
          {state.loading && !workspace ? (
            <SidebarNotice>{t('projectCoordinatorLoading')}</SidebarNotice>
          ) : null}
          {state.error ? (
            <SidebarNotice
              action={onRefresh}
              actionLabel={t('projectCoordinatorSidebarRetry')}
            >
              {state.error}
            </SidebarNotice>
          ) : null}
          {connection && connection.state !== 'ready' ? (
            <SidebarNotice
              action={onRefresh}
              actionLabel={t('projectCoordinatorSidebarRetry')}
            >
              {t(connectionMessageKey(connection.state))}
            </SidebarNotice>
          ) : null}
          {connection?.state === 'ready' && projects.length === 0 ? (
            <SidebarNotice>{t('projectCoordinatorSidebarNoProjects')}</SidebarNotice>
          ) : null}
          {projects.map(({ project }) => {
            const expanded = expandedProjectId === project.projectId
            const sessionAliases = projectCoordinatorSidebarSessionAliases(
              project.projectId,
              sessionCatalog,
              sessionBindings
            )
            return (
              <div
                key={project.projectId}
                className="border-l-2 border-accent/45 pl-1"
                data-project-status={project.status}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[var(--ds-sidebar-row-hover)]"
                    aria-expanded={expanded}
                    onClick={() => {
                      onExpandedProjectChange(expanded ? undefined : project.projectId)
                      onOpenProject(project.projectId, 'overview')
                    }}
                  >
                    {expanded
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" />}
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[12.5px] font-medium text-ds-ink">
                        {project.displayName}
                      </strong>
                      <small className="block truncate text-[10.5px] text-ds-faint">
                        {t(projectStatusMessageKey(project.status))}
                      </small>
                    </span>
                  </button>
                </div>
                {expanded ? (
                  <div className="ml-4 space-y-0.5 pb-1">
                    <ProjectToolRow
                      icon={<MessageSquare />}
                      label={t('projectCoordinatorSidebarSessions')}
                      disabled
                    />
                    {sessionAliases.map((session) => (
                      <ProjectSessionAliasRow
                        key={`${session.runtimeId ?? ''}:${session.id}`}
                        session={session}
                        onSelectSession={onSelectSession}
                      />
                    ))}
                    <ProjectToolRow
                      icon={<ListTodo />}
                      label={t('projectCoordinatorSidebarTasks')}
                      onClick={() => onOpenProject(project.projectId, 'tasks')}
                    />
                    <ProjectToolRow
                      icon={<FolderOpen />}
                      label={t('projectCoordinatorSidebarFiles')}
                      onClick={() => onOpenProject(project.projectId, 'files')}
                    />
                    <ProjectToolRow
                      icon={<FileText />}
                      label={t('projectCoordinatorSidebarDecisions')}
                      onClick={() => onOpenProject(project.projectId, 'decisions')}
                    />
                    <ProjectToolRow
                      icon={<RotateCcw />}
                      label={t('projectCoordinatorSidebarActivityRecovery')}
                      onClick={() => onOpenProject(project.projectId, 'recovery')}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

export function ProjectSessionAliasRow({
  session,
  onSelectSession
}: Readonly<{
  session: DomainRendererWorkbenchNavigationSession
  onSelectSession: (sessionId: string) => void
}>): ReactElement {
  return (
    <button
      type="button"
      className="ml-3 flex w-[calc(100%_-_0.75rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
      onClick={() => onSelectSession(session.id)}
    >
      <MessageSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{session.title}</span>
    </button>
  )
}

function ProjectToolRow({
  icon,
  label,
  disabled = false,
  onClick
}: Readonly<{
  icon: ReactElement
  label: string
  disabled?: boolean
  onClick?: () => void
}>): ReactElement {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] disabled:cursor-default disabled:text-ds-faint"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function SidebarNotice({
  children,
  action,
  actionLabel
}: Readonly<{
  children: string
  action?: () => void
  actionLabel?: string
}>): ReactElement {
  return (
    <div className="rounded-md border border-[var(--ds-border)] px-2 py-2 text-[11px] leading-4 text-ds-faint">
      <span>{children}</span>
      {action ? (
        <button
          type="button"
          className="mt-1 block text-accent hover:underline"
          onClick={action}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function connectionMessageKey(
  state: Exclude<ProjectCoordinatorWorkspace['connection']['state'], 'ready'>
): string {
  switch (state) {
    case 'identity_required':
      return 'projectCoordinatorIdentityRequired'
    case 'device_required':
      return 'projectCoordinatorDeviceRequired'
    case 'cloud_unavailable':
      return 'projectCoordinatorCloudUnavailable'
  }
}

function projectStatusMessageKey(
  status: ProjectCoordinatorWorkspace['projects'][number]['project']['status']
): string {
  switch (status) {
    case 'draft':
      return 'projectCoordinatorSidebarStatusDraft'
    case 'active':
      return 'projectCoordinatorSidebarStatusActive'
    case 'paused':
      return 'projectCoordinatorSidebarStatusPaused'
    case 'completed':
      return 'projectCoordinatorSidebarStatusCompleted'
    case 'cancelled':
      return 'projectCoordinatorSidebarStatusCancelled'
  }
}
