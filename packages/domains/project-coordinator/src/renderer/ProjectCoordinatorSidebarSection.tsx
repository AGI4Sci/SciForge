import React, { type ReactElement } from 'react'
import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
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
  RotateCcw,
  Trash2
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

type ProjectContextMenuState = Readonly<{
  projectId: string
  displayName: string
  x: number
  y: number
  trigger: HTMLButtonElement
}>

type ProjectDeleteError = Readonly<{
  projectId: string
  principalUserId: string
  message: string
}>

type ProjectDeleteFocusRequest = Readonly<{
  outcome: 'succeeded' | 'failed'
  trigger: HTMLButtonElement
}>

type ProjectDeleteConfirmationState = Readonly<{
  projectId: string
  displayName: string
  trigger: HTMLButtonElement
}>

const PROJECT_CONTEXT_MENU_WIDTH = 188
const PROJECT_CONTEXT_MENU_HEIGHT = 40
const PROJECT_CONTEXT_MENU_GUTTER = 8

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
  const [deletingProjectId, setDeletingProjectId] = useState<string>()
  const [deleteError, setDeleteError] = useState<ProjectDeleteError>()
  const requestRevisionRef = useRef(0)
  const deletingProjectIdRef = useRef<string | undefined>(undefined)
  const authoritativeWorkspaceRef = useRef<ProjectCoordinatorWorkspace | undefined>(undefined)
  const mountedRef = useRef(true)
  const { t } = useTranslation('common')

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
      if (!mountedRef.current || revision !== requestRevisionRef.current) return
      authoritativeWorkspaceRef.current = workspace
      setDeleteError((current) => (
        current && projectDeleteErrorMatchesWorkspace(current, workspace)
          ? current
          : undefined
      ))
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

  const deleteProject = useCallback(async (projectId: string) => {
    if (deletingProjectIdRef.current) return
    const workspace = authoritativeWorkspaceRef.current
    const principalUserId = workspace?.connection.state === 'ready'
      ? workspace.connection.userId
      : undefined
    deletingProjectIdRef.current = projectId
    setDeletingProjectId(projectId)
    setDeleteError(undefined)
    try {
      await client.deleteProject({ projectId })
      if (mountedRef.current) await refresh('foreground')
      if (!mountedRef.current) return
      setExpandedProjectId((current) => current === projectId ? undefined : current)
    } catch (cause) {
      if (mountedRef.current && principalUserId) {
        const currentWorkspace = authoritativeWorkspaceRef.current
        if (currentWorkspace && projectDeleteErrorMatchesWorkspace({
          projectId,
          principalUserId
        }, currentWorkspace)) {
          setDeleteError({
            projectId,
            principalUserId,
            message: cause instanceof Error
              ? cause.message
              : t('projectCoordinatorSidebarDeleteFailed')
          })
        }
      }
      throw cause
    } finally {
      deletingProjectIdRef.current = undefined
      if (mountedRef.current) setDeletingProjectId(undefined)
    }
  }, [client, refresh, t])

  return (
    <ProjectCoordinatorSidebarView
      state={state}
      className={context.className}
      collapsed={collapsed}
      expandedProjectId={expandedProjectId}
      onCollapsedChange={setCollapsed}
      onExpandedProjectChange={setExpandedProjectId}
      onRefresh={() => {
        void refresh('foreground')
      }}
      deletingProjectId={deletingProjectId}
      deleteError={deleteError?.message}
      sessionCatalog={context.sessions}
      sessionBindings={sessionBindings}
      onSelectSession={context.selectSession}
      onCreateProject={onCreateProject}
      onOpenProject={onOpenProject}
      onDeleteProject={deleteProject}
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
  deletingProjectId?: string
  deleteError?: string
  sessionCatalog?: readonly DomainRendererWorkbenchNavigationSession[]
  sessionBindings?: readonly ProjectCoordinatorSidebarSessionBinding[]
  onSelectSession?: (sessionId: string) => void
  onCreateProject: () => void
  onOpenProject: (
    projectId: string,
    view: ProjectCoordinatorSidebarViewId
  ) => void
  onDeleteProject?: ((projectId: string) => Promise<void>) | null
}>

export function ProjectCoordinatorSidebarView({
  state,
  className,
  collapsed,
  expandedProjectId,
  onCollapsedChange,
  onExpandedProjectChange,
  onRefresh,
  deletingProjectId = '',
  deleteError = '',
  sessionCatalog = [],
  sessionBindings = [],
  onSelectSession = () => undefined,
  onCreateProject,
  onOpenProject,
  onDeleteProject = null
}: ProjectCoordinatorSidebarViewProps): ReactElement {
  const { t } = useTranslation('common')
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(null)
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] =
    useState<ProjectDeleteConfirmationState | null>(null)
  const [deleteFocusRequest, setDeleteFocusRequest] = useState<ProjectDeleteFocusRequest | null>(null)
  const deleteConfirmationSubmittingRef = useRef(false)
  const sectionControlRef = useRef<HTMLButtonElement>(null)
  const workspace = state.workspace
  const connection = workspace?.connection
  const projects = connection?.state === 'ready' ? workspace?.projects ?? [] : []

  const contextMenuOwnerIsCurrent = projectContextMenu !== null &&
    connection?.state === 'ready' &&
    projects.some(({ project }) => (
      project.projectId === projectContextMenu.projectId &&
      project.ownerUserId === connection.userId
    ))

  const deleteConfirmationOwnerIsCurrent = projectDeleteConfirmation !== null &&
    connection?.state === 'ready' &&
    projects.some(({ project }) => (
      project.projectId === projectDeleteConfirmation.projectId &&
      project.ownerUserId === connection.userId
    ))

  const closeProjectContextMenu = useCallback((restoreFocus: boolean): void => {
    const menu = projectContextMenu
    setProjectContextMenu(null)
    if (!restoreFocus || !menu) return
    const target = menu.trigger.isConnected && !menu.trigger.disabled
      ? menu.trigger
      : sectionControlRef.current
    target?.focus()
  }, [projectContextMenu])

  useEffect(() => {
    if (!projectContextMenu) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeProjectContextMenu(true)
    }
    const closeWithoutRestoringFocus = (): void => closeProjectContextMenu(false)
    const closeAndRestoreFocus = (): void => closeProjectContextMenu(true)
    window.addEventListener('pointerdown', closeWithoutRestoringFocus)
    window.addEventListener('scroll', closeAndRestoreFocus, true)
    window.addEventListener('resize', closeAndRestoreFocus)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeWithoutRestoringFocus)
      window.removeEventListener('scroll', closeAndRestoreFocus, true)
      window.removeEventListener('resize', closeAndRestoreFocus)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeProjectContextMenu, projectContextMenu])

  useEffect(() => {
    if (projectContextMenu && (!contextMenuOwnerIsCurrent || deletingProjectId)) {
      closeProjectContextMenu(true)
    }
  }, [
    closeProjectContextMenu,
    contextMenuOwnerIsCurrent,
    deletingProjectId,
    projectContextMenu
  ])

  useEffect(() => {
    if (!projectDeleteConfirmation || deleteConfirmationOwnerIsCurrent) return
    setProjectDeleteConfirmation(null)
    const target = projectDeleteConfirmation.trigger.isConnected &&
      !projectDeleteConfirmation.trigger.disabled
      ? projectDeleteConfirmation.trigger
      : sectionControlRef.current
    target?.focus()
  }, [deleteConfirmationOwnerIsCurrent, projectDeleteConfirmation])

  useEffect(() => {
    if (!deleteFocusRequest || deletingProjectId) return
    const target = deleteFocusRequest.outcome === 'failed' &&
      deleteFocusRequest.trigger.isConnected &&
      !deleteFocusRequest.trigger.disabled
      ? deleteFocusRequest.trigger
      : sectionControlRef.current
    target?.focus()
    setDeleteFocusRequest(null)
  }, [deleteFocusRequest, deletingProjectId])

  const openProjectContextMenu = (
    projectId: string,
    displayName: string,
    trigger: HTMLButtonElement,
    clientX: number,
    clientY: number
  ): void => {
    const maximumX = Math.max(
      PROJECT_CONTEXT_MENU_GUTTER,
      window.innerWidth - PROJECT_CONTEXT_MENU_WIDTH - PROJECT_CONTEXT_MENU_GUTTER
    )
    const maximumY = Math.max(
      PROJECT_CONTEXT_MENU_GUTTER,
      window.innerHeight - PROJECT_CONTEXT_MENU_HEIGHT - PROJECT_CONTEXT_MENU_GUTTER
    )
    setProjectContextMenu({
      projectId,
      displayName,
      x: Math.max(PROJECT_CONTEXT_MENU_GUTTER, Math.min(clientX, maximumX)),
      y: Math.max(PROJECT_CONTEXT_MENU_GUTTER, Math.min(clientY, maximumY)),
      trigger
    })
  }

  const requestProjectDeletion = (
    projectId: string,
    displayName: string,
    trigger: HTMLButtonElement
  ): void => {
    closeProjectContextMenu(false)
    if (!onDeleteProject || deletingProjectId) return
    const projectView = projects.find(({ project }) => project.projectId === projectId)
    if (
      connection?.state !== 'ready' ||
      !projectView ||
      projectView.project.ownerUserId !== connection.userId
    ) return
    setProjectDeleteConfirmation({ projectId, displayName, trigger })
  }

  const cancelProjectDeletion = (): void => {
    const confirmation = projectDeleteConfirmation
    if (!confirmation || deletingProjectId) return
    setProjectDeleteConfirmation(null)
    const target = confirmation.trigger.isConnected && !confirmation.trigger.disabled
      ? confirmation.trigger
      : sectionControlRef.current
    target?.focus()
  }

  const deleteConfirmedProject = async (): Promise<void> => {
    const confirmation = projectDeleteConfirmation
    if (
      !confirmation ||
      !onDeleteProject ||
      deletingProjectId ||
      deleteConfirmationSubmittingRef.current
    ) return
    deleteConfirmationSubmittingRef.current = true
    try {
      await onDeleteProject(confirmation.projectId)
      setDeleteFocusRequest({ outcome: 'succeeded', trigger: confirmation.trigger })
    } catch {
      setDeleteFocusRequest({ outcome: 'failed', trigger: confirmation.trigger })
    } finally {
      deleteConfirmationSubmittingRef.current = false
      setProjectDeleteConfirmation(null)
    }
  }

  return (
    <section
      className={`${className ?? ''} px-2 pb-1`}
      aria-label={t('projectCoordinatorSidebarCloudProjects')}
      data-project-coordinator-navigation="cloud-projects"
    >
      <header className="flex min-h-[38px] items-center justify-between py-1.5">
        <button
          ref={sectionControlRef}
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
          {deleteError ? (
            <SidebarNotice role="alert">{deleteError}</SidebarNotice>
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
            const deleting = deletingProjectId === project.projectId
            const canDelete = Boolean(onDeleteProject) &&
              connection?.state === 'ready' &&
              connection.userId === project.ownerUserId
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
                <div className="group flex items-center gap-1" aria-busy={deleting}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[var(--ds-sidebar-row-hover)]"
                    aria-expanded={expanded}
                    aria-haspopup={canDelete ? 'menu' : undefined}
                    disabled={deleting}
                    onContextMenu={canDelete ? (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openProjectContextMenu(
                        project.projectId,
                        project.displayName,
                        event.currentTarget,
                        event.clientX,
                        event.clientY
                      )
                    } : undefined}
                    onKeyDown={canDelete ? (event) => {
                      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                      event.preventDefault()
                      event.stopPropagation()
                      const bounds = event.currentTarget.getBoundingClientRect()
                      openProjectContextMenu(
                        project.projectId,
                        project.displayName,
                        event.currentTarget,
                        bounds.left + 16,
                        bounds.bottom
                      )
                    } : undefined}
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
                  {canDelete ? (
                    <button
                      type="button"
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 focus-visible:opacity-100 disabled:cursor-not-allowed dark:hover:text-red-300 ${
                        deleting
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                      }`}
                      aria-label={t('projectCoordinatorSidebarDeleteProjectLabel', {
                        name: project.displayName
                      })}
                      title={t('projectCoordinatorSidebarDeleteProject')}
                      aria-busy={deleting}
                      disabled={Boolean(deletingProjectId)}
                      onClick={(event) => {
                        requestProjectDeletion(
                          project.projectId,
                          project.displayName,
                          event.currentTarget
                        )
                      }}
                    >
                      {deleting
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  ) : null}
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
      {projectContextMenu && contextMenuOwnerIsCurrent ? (
        <ProjectDeleteContextMenu
          state={projectContextMenu}
          busy={Boolean(deletingProjectId)}
          label={t('projectCoordinatorSidebarDeleteProject')}
          onClose={() => closeProjectContextMenu(false)}
          onDelete={() => {
            requestProjectDeletion(
              projectContextMenu.projectId,
              projectContextMenu.displayName,
              projectContextMenu.trigger
            )
          }}
        />
      ) : null}
      {projectDeleteConfirmation && deleteConfirmationOwnerIsCurrent ? (
        <ProjectDeleteConfirmationDialog
          state={projectDeleteConfirmation}
          busy={deletingProjectId === projectDeleteConfirmation.projectId}
          onCancel={cancelProjectDeletion}
          onConfirm={() => {
            void deleteConfirmedProject()
          }}
        />
      ) : null}
    </section>
  )
}

function ProjectDeleteConfirmationDialog({
  state,
  busy,
  onCancel,
  onConfirm
}: Readonly<{
  state: ProjectDeleteConfirmationState
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (busy) {
      dialogRef.current?.focus()
      return
    }
    cancelRef.current?.focus()
  }, [busy])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    if (busy) {
      event.preventDefault()
      return
    }
    const controls = [cancelRef.current, deleteRef.current].filter(
      (control): control is HTMLButtonElement => Boolean(control)
    )
    if (controls.length === 0) return
    const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
      : (currentIndex === controls.length - 1 ? 0 : currentIndex + 1)
    event.preventDefault()
    controls[nextIndex]?.focus()
  }

  return createPortal(
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[2px] dark:bg-black/45"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
      onKeyDown={handleKeyDown}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-[0_24px_72px_rgba(15,23,42,0.28)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        data-project-id={state.projectId}
      >
        <div className="flex min-h-0 items-start gap-3 overflow-y-auto px-5 pb-4 pt-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/12 text-red-600 dark:text-red-300">
            <AlertTriangle className="h-4.5 w-4.5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-semibold tracking-[-0.02em]">
              {t('projectCoordinatorSidebarDeleteDialogTitle')}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 break-words whitespace-pre-line text-[12.5px] leading-5 text-ds-muted"
            >
              {t('projectCoordinatorSidebarDeleteConfirm', { name: state.displayName })}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-border bg-ds-main/35 px-5 py-3.5">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-wait disabled:opacity-60"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
          <button
            ref={deleteRef}
            type="button"
            disabled={busy}
            className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-ds-card disabled:cursor-wait disabled:opacity-65"
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {busy
              ? t('projectCoordinatorSidebarDeletingProject')
              : t('projectCoordinatorSidebarDeleteProject')}
          </button>
        </div>
      </section>
    </div>,
    globalThis.document.body
  )
}

function ProjectDeleteContextMenu({
  state,
  busy,
  label,
  onClose,
  onDelete
}: Readonly<{
  state: ProjectContextMenuState
  busy: boolean
  label: string
  onClose: () => void
  onDelete: () => void
}>): ReactElement {
  const itemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    itemRef.current?.focus()
  }, [])

  return (
    <div
      role="menu"
      aria-label={state.displayName}
      className="ds-no-drag fixed z-50 w-[188px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_16px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose()
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        disabled={busy}
        aria-busy={busy}
        className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-red-600 transition hover:bg-red-500/10 focus-visible:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
        onClick={onDelete}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </div>
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
  actionLabel,
  role
}: Readonly<{
  children: string
  action?: () => void
  actionLabel?: string
  role?: 'alert' | 'status'
}>): ReactElement {
  return (
    <div
      role={role}
      className="rounded-md border border-[var(--ds-border)] px-2 py-2 text-[11px] leading-4 text-ds-faint"
    >
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

function projectDeleteErrorMatchesWorkspace(
  error: Pick<ProjectDeleteError, 'projectId' | 'principalUserId'>,
  workspace: ProjectCoordinatorWorkspace
): boolean {
  return workspace.connection.state === 'ready' &&
    workspace.connection.userId === error.principalUserId &&
    workspace.projects.some(({ project }) => project.projectId === error.projectId)
}
