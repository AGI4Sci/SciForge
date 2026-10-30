import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererWorkspacePreviewHost, DomainRendererWorkbenchHost, DomainRendererWorkspaceHost, DomainRendererResourcePreviewHost } from '@sciforge/domain-sdk/host'
import { workspaceAttachmentDisplayName } from '@sciforge/domain-sdk/attachment-policy'
import type { DomainRendererWorkbenchSurfaceActivation } from '@sciforge/domain-sdk/renderer-contributions'
import { DEFAULT_TASK_OFFER_TTL_MS, deliveryRevisionRequestSchema, type DeliveryDriveView, type ProjectRequirementsDocument } from '@sciforge/collaboration-contracts'
import { ProjectCoordinatorRequirementsCompletionClientError, type ProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'
import type { ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import type { CollaborationRendererClient } from '../collaboration-capability-client.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import { CollaborationWorkspaceStructure } from './CollaborationWorkspaceStructure.js'
import { createWorkspaceViewModel, type WorkspacePersonalItem, type WorkspaceRoute } from './workspace-view-model.js'
import { RequirementsView } from './requirements/RequirementsView.js'
import { SettingsView } from './settings/SettingsView.js'
import { PersonalList } from './personal/PersonalList.js'
import { FilesView } from './files/FilesView.js'
import { deliveryFileGroups, deliveryManifestEntries, type DeliveryFileEntry } from './files/delivery-files.js'
import { readSealedDeliverySummary } from './files/delivery-bundle-summary.js'
import { NewProjectDialog } from './projects/NewProjectDialog.js'
import { CompleteProjectDialog } from './dialogs/CompleteProjectDialog.js'
import { waitForRefresh } from '../../refresh-await.js'
import { acceptReviewedInvitation } from './accept-reviewed-invitation.js'

import { openCollaborationTaskSession } from '../task-session-navigation.js'
import { taskActivityItems } from './task-activity.js'
import { useWorkerDeliveryDraft } from './use-worker-delivery-draft.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './task-drawer/delivery-draft-types.js'
import { deliverySubmissionError, workerDeliveryPresentation } from './task-drawer/worker-delivery-presentation.js'

/** Other members' actions show up without a click while the page is in front. */
const LIVE_REFRESH_INTERVAL_MS = 8_000
const REFRESH_TIMEOUT_MS = 30_000
type RefreshOptions = Readonly<{ silent?: boolean; refreshDashboards?: boolean }>
type RefreshRequest = Readonly<{ projectId?: string; options: RefreshOptions }>

function opaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function CollaborationWorkspacePage({ coordinatorClient, collaborationClient, workspacePreview, resourcePreview, workspace: workspaceHost, workbench, activation, active = true, className }: Readonly<{ coordinatorClient: ProjectCoordinatorRendererClient; collaborationClient: CollaborationRendererClient; workspacePreview?: DomainRendererWorkspacePreviewHost; resourcePreview?: DomainRendererResourcePreviewHost; workspace?: DomainRendererWorkspaceHost; workbench?: DomainRendererWorkbenchHost; activation?: DomainRendererWorkbenchSurfaceActivation; active?: boolean; className?: string }>): ReactElement {
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<CollaborationRendererClient['readStatus']>>>()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null)
  const [route, setRoute] = useState<WorkspaceRoute>('my-work')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<Readonly<{
    message: string
    failedCompletionDraft?: ProjectRequirementsDocument
  }> | null>(null)
  const error = pageError?.message ?? null
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [action, setAction] = useState<Readonly<{ kind: string; target: string }> | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [files, setFiles] = useState<DeliveryDriveView | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [confirmOnOpen, setConfirmOnOpen] = useState(false)
  const [workerDeliveries, setWorkerDeliveries] = useState<Readonly<Record<string, WorkerDeliveryView>>>({})
  const [deliveryErrors, setDeliveryErrors] = useState<Readonly<Record<string, string>>>({})
  const [sealedSummaries, setSealedSummaries] = useState<Record<string, string>>({})
  const [sealedSummaryErrors, setSealedSummaryErrors] = useState<Record<string, string>>({})
  const [materialCatalog, setMaterialCatalog] = useState<Record<string, readonly DeliveryDraftFile[]>>({})

  // Polling must read the Project the User selected most recently, not the
  // value captured by the render that installed the interval. Writes that are
  // older than the newest read are dropped so they cannot move the selection
  // or the data back.
  const selectedProjectIdRef = useRef<string | null>(null)
  const switchingProjectIdRef = useRef<string | null>(null)
  const readSequence = useRef(0)
  const refreshFlight = useRef<Promise<void> | null>(null)
  const refreshAbort = useRef<AbortController | null>(null)
  const queuedRefresh = useRef<RefreshRequest | null>(null)
  const refreshLifetime = useRef(0)

  const applySelection = useCallback((projectId: string | null) => {
    selectedProjectIdRef.current = projectId
    setSelectedProjectId(projectId)
  }, [])
  const beginProjectSwitch = useCallback((projectId: string) => {
    switchingProjectIdRef.current = projectId
    setSwitchingProjectId(projectId)
  }, [])
  const endProjectSwitch = useCallback(() => {
    switchingProjectIdRef.current = null
    setSwitchingProjectId(null)
  }, [])

  const readPage = useCallback(async (projectId: string | undefined, options: RefreshOptions, signal: AbortSignal, sequence: number) => {
    if (!options.silent) setPageError(null)
    let requestedProjectId = projectId ?? selectedProjectIdRef.current ?? undefined
    try {
      let nextWorkspace: ProjectCoordinatorWorkspace | undefined
      let nextSnapshot: Awaited<ReturnType<CollaborationRendererClient['readStatus']>> | undefined
      // Choose an initial Project only after a successful read. Once chosen,
      // selection belongs to the User; missing/recovering lists cannot move it.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [workspaceRead, statusRead] = await Promise.all([
          coordinatorClient.readWorkspace(requestedProjectId ? { projectId: requestedProjectId } : {}, { signal }),
          // Another window may change the Cloud Dashboard without sending this
          // Desktop an inbox message; foreground auto-refresh therefore joins
          // the main process's single-flight Dashboard read.
          collaborationClient.readStatus(options.refreshDashboards ? { refreshDashboards: true } : {}, { signal })
        ])
        if (signal.aborted || sequence !== readSequence.current) return
        nextWorkspace = workspaceRead
        nextSnapshot = statusRead
        const currentSelection = selectedProjectIdRef.current
        const nextSelection = currentSelection ?? (workspaceRead.connection.state === 'ready'
          ? workspaceRead.projects[0]?.project.projectId ?? null : null)
        if (nextSelection !== currentSelection) applySelection(nextSelection)
        if (attempt === 0 && nextSelection && nextSelection !== requestedProjectId &&
            workspaceRead.focusedProjectId !== nextSelection && workspaceRead.projects.length > 1) {
          beginProjectSwitch(nextSelection)
          requestedProjectId = nextSelection
          continue
        }
        break
      }
      if (!nextWorkspace || !nextSnapshot) return
      // Enumerate only local, dedicated executions owned by this User. Other
      // Devices and members have no private candidate on this Desktop.
      const userId = nextWorkspace.connection.state === 'ready' ? nextWorkspace.connection.userId : null
      const localExecutions = new Set(nextSnapshot.projects.flatMap((project) => project.tasks.filter((task) => task.workerUserId === userId && task.hasDedicatedSession).map((task) => task.executionId)))
      const targets = nextSnapshot.dashboards.flatMap((dashboard) => dashboard.tasks.filter((task) => task.assigneeUserId === userId && task.executionId && localExecutions.has(task.executionId)).map((task) => ({ projectId: task.projectId, taskId: task.taskId, executionId: task.executionId! })))
      const reads = await Promise.allSettled(targets.map((target) => collaborationClient.readWorkerDelivery(target, { signal })))
      if (signal.aborted || sequence !== readSequence.current) return
      const deliveries: Record<string, WorkerDeliveryView> = {}
      const errors: Record<string, string> = {}
      reads.forEach((read, index) => {
        const target = targets[index]!
        if (read.status === 'fulfilled') deliveries[target.executionId] = read.value.delivery
        else errors[target.executionId] = read.reason instanceof Error ? read.reason.message : '本机交付读取失败'
      })
      setWorkerDeliveries((current) => Object.fromEntries(Object.entries(deliveries).map(([id, view]) => {
        const previous = current[id]
        return [id, previous?.draft && view.draft && previous.draft.revision > view.draft.revision ? previous : view]
      })))
      setDeliveryErrors(errors)
      setWorkspace(nextWorkspace)
      setSnapshot(nextSnapshot)
      if (switchingProjectIdRef.current !== null && requestedProjectId === switchingProjectIdRef.current) {
        endProjectSwitch()
      }
    } catch (cause) {
      if (signal.aborted || sequence !== readSequence.current) return
      if (!options.silent) setPageError({ message: cause instanceof Error ? cause.message : 'Collaboration 数据读取失败' })
      if (switchingProjectIdRef.current !== null) endProjectSwitch()
    }
  }, [applySelection, beginProjectSwitch, collaborationClient, coordinatorClient, endProjectSwitch])

  const refresh = useCallback((projectId?: string, options: RefreshOptions = {}): Promise<void> => {
    const previous = queuedRefresh.current
    queuedRefresh.current = {
      projectId: projectId ?? previous?.projectId,
      options: {
        silent: options.silent === true && previous?.options.silent !== false,
        refreshDashboards: Boolean(options.refreshDashboards || previous?.options.refreshDashboards)
      }
    }
    if (refreshFlight.current) {
      // Routine hints coalesce without invalidating a useful current result.
      // A new selection or a post-command read must fence the older snapshot.
      if (projectId !== undefined || !options.silent) {
        readSequence.current += 1
        refreshAbort.current?.abort(new Error('Project refresh superseded.'))
      }
      return refreshFlight.current
    }
    const lifetime = refreshLifetime.current
    const run = async () => {
      while (queuedRefresh.current && lifetime === refreshLifetime.current) {
        const request = queuedRefresh.current
        queuedRefresh.current = null
        const controller = new AbortController()
        refreshAbort.current = controller
        const sequence = ++readSequence.current
        const timer = window.setTimeout(() => controller.abort(new Error('协作刷新超时，请重试。')), REFRESH_TIMEOUT_MS)
        try {
          await waitForRefresh(readPage(request.projectId, request.options, controller.signal, sequence), controller.signal)
        } catch (cause) {
          if (lifetime === refreshLifetime.current && sequence === readSequence.current) {
            if (!request.options.silent) setPageError({ message: cause instanceof Error ? cause.message : 'Collaboration 数据读取失败' })
            endProjectSwitch()
          }
        } finally {
          window.clearTimeout(timer)
          controller.abort()
          if (refreshAbort.current === controller) refreshAbort.current = null
        }
      }
    }
    const pending = run().finally(() => {
      if (refreshFlight.current === pending) refreshFlight.current = null
    })
    refreshFlight.current = pending
    return pending
  }, [endProjectSwitch, readPage])

  useEffect(() => {
    if (active) void refresh(undefined, { refreshDashboards: true })
    return () => {
      refreshLifetime.current += 1
      readSequence.current += 1
      queuedRefresh.current = null
      refreshAbort.current?.abort(new Error('Collaboration page is inactive.'))
      refreshFlight.current = null
    }
  }, [active, refresh])
  const liveRefresh = useRef<() => void>(() => undefined)
  liveRefresh.current = () => {
    // A running action keeps its page state; only the connection status is
    // re-read so a queued command can show what it is waiting for.
    if (busy) {
      void collaborationClient.readStatus({}).then(setSnapshot, () => undefined)
      const delivery = action?.kind === 'submit-delivery'
        ? Object.values(workerDeliveries).find((view) => view.taskId === action.target) : undefined
      if (delivery) {
        const { projectId, taskId, executionId } = delivery
        const lifetime = refreshLifetime.current
        const sequence = readSequence.current
        void collaborationClient.readWorkerDelivery({ projectId, taskId, executionId }).then((result) => {
          if (lifetime === refreshLifetime.current && sequence === readSequence.current && busyRef.current && selectedProjectIdRef.current === projectId) {
            setWorkerDeliveries((current) => ({ ...current, [executionId]: result.delivery }))
          }
        }, () => undefined)
      }
    }
    else if (switchingProjectIdRef.current === null) void refresh(undefined, { silent: true, refreshDashboards: true })
  }
  useEffect(() => {
    if (!active) return
    const onFocus = () => liveRefresh.current()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') liveRefresh.current() }, LIVE_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [active])

  const model = useMemo(() => createWorkspaceViewModel({ workspace, snapshot, selectedProjectId, route, files, workerDeliveries }), [files, route, selectedProjectId, snapshot, workspace, workerDeliveries])
  // Only a receipt from the canonical completion write can supersede an error.
  // Ordinary saves and absent attempt projections are never success evidence.
  useEffect(() => {
    const failed = pageError?.failedCompletionDraft
    const current = model.project?.confirmedRequirements ?? model.project?.requirementsDraft
    const receipt = model.project?.requirementsCompletion
    if (failed && current && model.projectId === failed.projectId &&
        current.projectId === failed.projectId &&
        current.requirementsDocumentId === failed.requirementsDocumentId &&
        receipt?.state === 'completed' &&
        receipt.requirementsDocumentId === failed.requirementsDocumentId &&
        receipt.sourceRevision === failed.revision &&
        receipt.sourceContentDigest === failed.contentDigest &&
        receipt.resultRevision === current.revision &&
        receipt.resultContentDigest === current.contentDigest) {
      setPageError((latest) => latest === pageError ? null : latest)
    }
  }, [model.project, model.projectId, pageError])
  const invitationItem = model.inbox.find((item) => item.kind === 'invite' && item.projectId === model.projectId) ?? null
  const selectedCard = model.cards.find((card) => card.id === selectedCardId) ?? model.selectedCard
  const workerDelivery = selectedCard.assigneeUserId === model.currentUserId && selectedCard.executionId
    ? workerDeliveries[selectedCard.executionId] ?? null : null
  const acceptWorkerDelivery = useCallback((view: WorkerDeliveryView) => setWorkerDeliveries((current) => {
    const previous = current[view.executionId]
    if (previous?.draft && view.draft && previous.draft.revision > view.draft.revision) return current
    return { ...current, [view.executionId]: view }
  }), [])
  const localDraft = useWorkerDeliveryDraft(collaborationClient, workerDelivery, acceptWorkerDelivery)
  const rememberMaterials = useCallback((executionId: string, entries: readonly DeliveryDraftFile[]) => {
    setMaterialCatalog((current) => ({ ...current, [executionId]: [...new Map([...(current[executionId] ?? []), ...entries].map((file) => [file.relativePath, file])).values()] }))
  }, [])
  const listMaterials = useCallback(async (input: Readonly<{ query?: string; cursor?: string }>) => {
    if (!workerDelivery || selectedCard.assigneeUserId !== model.currentUserId) throw new Error('当前账户无法读取这些任务文件。')
    const result = await collaborationClient.listWorkerDeliveryMaterials({ projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId, ...input })
    const entries = result.files.map((file) => ({ id: file.relativePath, name: file.fileName, ...file }))
    rememberMaterials(workerDelivery.executionId, entries)
    return { ...result, files: entries }
  }, [collaborationClient, model.currentUserId, rememberMaterials, selectedCard.assigneeUserId, workerDelivery])
  const importMaterials = useCallback(async (files: readonly File[], onImported: (file: DeliveryDraftFile) => void) => {
    if (!workerDelivery || selectedCard.assigneeUserId !== model.currentUserId || !workspaceHost?.importAttachments) throw new Error('当前会话暂不能导入文件。')
    const session = await collaborationClient.openTaskSession({ projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId })
    const entries: DeliveryDraftFile[] = []
    const errors: string[] = []
    for (const file of files) {
      try {
        const imported = await workspaceHost.importAttachments({ runtimeId: session.runtimeId, threadId: session.threadId, files: [file] })
        for (const result of imported) {
          const entry: DeliveryDraftFile = { id: result.relativePath, ...result, source: 'member', imported: true }
          entries.push(entry)
          rememberMaterials(workerDelivery.executionId, [entry])
          onImported(entry)
        }
      } catch (cause) { errors.push(`${file.name}：${cause instanceof Error ? cause.message : '导入失败'}`) }
    }
    if (errors.length) throw new Error(errors.join('；'))
    return entries
  }, [collaborationClient, model.currentUserId, rememberMaterials, selectedCard.assigneeUserId, workerDelivery, workspaceHost])
  const materialSelection: DeliveryMaterialSelection = {
    files: workerDelivery ? materialCatalog[workerDelivery.executionId] ?? [] : [],
    onList: listMaterials,
    ...(workspaceHost?.importAttachments && workerDelivery ? { onUpload: importMaterials } : {})
  }
  const changeMaterials = useCallback((files: readonly DeliveryDraftFile[]) => {
    if (!workerDelivery) return
    rememberMaterials(workerDelivery.executionId, files)
    localDraft.onMaterialsChange(files.map((file) => ({ relativePath: file.relativePath, ...(file.imported || localDraft.selectedMaterials?.some((selected) => selected.relativePath === file.relativePath && selected.source === 'member') ? { source: 'member' as const } : {}) })))
  }, [localDraft, rememberMaterials, workerDelivery])
  const deliveryError = selectedCard.executionId ? deliveryErrors[selectedCard.executionId] : undefined
  const selectedTaskView = model.project?.tasks.find((entry) => entry.task.taskId === selectedCard.id)
  // The Owner adopts a delivery that another Device sealed, so the drawer reads
  // the very same sealed objects the Files page lists.
  const selectedDeliveryFiles = selectedTaskView?.delivery?.manifest
    ? deliveryManifestEntries(selectedTaskView.delivery.manifest, {
      members: model.project?.memberUsers ?? [],
      executions: selectedTaskView.executions,
      fallbackSubmitter: selectedCard.assignee ?? null
    })
    : []
  const selectedManifest = selectedTaskView?.delivery?.manifest
  const revisingSubmittedVersion = selectedTaskView?.delivery?.revisionRequest?.deliveryManifestId === selectedManifest?.deliveryManifestId && Boolean(selectedManifest)
  useEffect(() => {
    if (!active || revisingSubmittedVersion || !selectedCardId || !selectedManifest?.bundleObjectId || !selectedManifest.resultRevision || selectedCard.assigneeUserId === model.currentUserId || sealedSummaries[selectedManifest.deliveryManifestId] !== undefined) return
    const bundle = selectedManifest.objects.find((object) => object.objectId === selectedManifest.bundleObjectId)
    if (!bundle) return
    let cancelled = false
    void readSealedDeliverySummary(coordinatorClient, selectedManifest).then((summary) => {
      if (!cancelled) setSealedSummaries((current) => ({ ...current, [selectedManifest.deliveryManifestId]: summary }))
    }).catch(() => { if (!cancelled) setSealedSummaryErrors((current) => ({ ...current, [selectedManifest.deliveryManifestId]: '交付说明读取失败，请重新打开任务。' })) })
    return () => { cancelled = true }
  }, [active, coordinatorClient, model.currentUserId, revisingSubmittedVersion, sealedSummaries, selectedCard.assigneeUserId, selectedCardId, selectedManifest])
  const fileGroups = useMemo(() => deliveryFileGroups({
    drive: model.files,
    project: model.project,
    dashboards: snapshot?.dashboards ?? []
  }), [model.files, model.project, snapshot?.dashboards])
  const dashboard = snapshot?.dashboards?.find((item) => item.projectId === model.projectId)
  const activity = taskActivityItems(dashboard?.activity ?? [], selectedCard.id)

  useEffect(() => {
    if (!active || !model.projectId || route !== 'files') return
    setFilesLoading(true)
    void coordinatorClient.listDrive({ projectId: model.projectId }).then(setFiles).catch((cause) => { setFiles(null); setPageError({ message: cause instanceof Error ? cause.message : '文件读取失败' }) }).finally(() => setFilesLoading(false))
  }, [active, coordinatorClient, model.projectId, route])

  const run = useCallback(async (operation: () => Promise<unknown>, nextAction: Readonly<{ kind: string; target: string }> = { kind: 'operation', target: 'page' }): Promise<boolean> => {
    if (busyRef.current) return false
    const failedCompletionDraft = nextAction.kind === 'complete-requirements' &&
      nextAction.target === `requirements:${model.projectId}`
      ? model.project?.requirementsDraft ?? undefined : undefined
    busyRef.current = true
    setBusy(true); setAction(nextAction); setPageError(null)
    try {
      await operation()
      await refresh()
      return true
    } catch (cause) {
      // The original attempt continues. Refresh its authoritative progress
      // instead of reporting a duplicate request as a failed model run.
      const completionFailure = cause instanceof ProjectCoordinatorRequirementsCompletionClientError
      setPageError(completionFailure && cause.reason === 'completion_in_progress' ? null : {
        message: cause instanceof Error ? cause.message : '操作失败',
        ...(completionFailure && failedCompletionDraft ? { failedCompletionDraft } : {})
      })
      await refresh(undefined, { silent: true })
      return false
    } finally { busyRef.current = false; setBusy(false) }
  }, [model.project, model.projectId, refresh])
  const selectProject = useCallback((projectId: string) => {
    const alreadyLoaded = workspace?.focusedProjectId === projectId
    applySelection(projectId); setSelectedCardId(null)
    // An invited member lands on the requirements page so the invitation banner is the first thing they see.
    setRoute(model.inbox.some((item) => item.kind === 'invite' && item.projectId === projectId) ? 'requirements' : 'board')
    if (!alreadyLoaded) beginProjectSwitch(projectId)
    void refresh(projectId)
  }, [applySelection, beginProjectSwitch, model.inbox, refresh, workspace?.focusedProjectId])
  useEffect(() => {
    const payload = activation?.payload
    if (!active || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.projectId !== 'string' || typeof payload.taskId !== 'string') return
    applySelection(payload.projectId)
    setRoute('board')
    setSelectedCardId(payload.taskId)
    void refresh(payload.projectId)
  }, [activation, active, applySelection, refresh])
  const selectRoute = useCallback((nextRoute: WorkspaceRoute) => { setRoute(nextRoute); setSelectedCardId(null); setConfirmOnOpen(false) }, [])
  const openRequirements = useCallback(() => { setRoute('requirements'); setSelectedCardId(null); setConfirmOnOpen(model.currentProject.headerAction === '确认需求') }, [model.currentProject.headerAction])
  const openModuleCard = useCallback((reference: string) => { const target = model.cards.find((card) => card.reference === reference); setRoute('board'); setConfirmOnOpen(false); setSelectedCardId(target?.id ?? null) }, [model.cards])
  const openPersonalItem = useCallback((item: WorkspacePersonalItem) => {
    applySelection(item.projectId)
    if (workspace?.focusedProjectId !== item.projectId) beginProjectSwitch(item.projectId)
    if (item.membershipId) setRoute('requirements')
    else if (item.taskId) { setSelectedCardId(item.taskId); setRoute('board') }
    else { setRoute('requirements') }
    // One inbox row may merge several process events about the same Task, so
    // opening it acknowledges every event the row stands for.
    for (const notificationId of new Set(item.notificationIds ?? (item.notificationId ? [item.notificationId] : []))) {
      const notification = snapshot?.notifications?.find((entry) => entry.notificationId === notificationId)
      if (notification) void collaborationClient.markNotificationRead({ notificationId: notification.notificationId, expectedRevision: notification.revision })
    }
    void refresh(item.projectId)
  }, [applySelection, beginProjectSwitch, collaborationClient, refresh, snapshot?.notifications, workspace?.focusedProjectId])
  const acceptInvitationItem = useCallback((item: WorkspacePersonalItem) => {
    if (!item.membershipId) return
    const project = workspace?.projects.find((entry) => entry.project.projectId === item.projectId)
    const membership = project?.memberships.find((entry) => entry.projectMembershipId === item.membershipId)
    if (!project || !membership || workspace?.connection.state !== 'ready') return
    const userId = workspace.connection.userId
    void run(() => acceptReviewedInvitation({ client: coordinatorClient, project, membershipId: membership.projectMembershipId, userId }), { kind: 'accept-invitation', target: `invitation:${membership.projectMembershipId}` })
  }, [coordinatorClient, run, workspace])
  const addMember = useCallback((userId: string) => { if (!model.projectId || !model.project) return; void run(() => coordinatorClient.addMember({ projectId: model.projectId!, expectedProjectRevision: model.project!.project.revision, userId })) }, [coordinatorClient, model.project, model.projectId, run])
  const removeMember = useCallback((membershipId: string) => { const membership = model.project?.memberships.find((entry) => entry.projectMembershipId === membershipId); if (!model.projectId || !model.project || !membership) return; void run(() => coordinatorClient.removeMember({ projectId: model.projectId!, projectMembershipId: membershipId, expectedProjectRevision: model.project!.project.revision, expectedMembershipRevision: membership.revision })) }, [coordinatorClient, model.project, model.projectId, run])
  const createProject = useCallback((name: string, description: string) => {
    if (!model.currentUserId) { setAction({ kind: 'create-project', target: 'create-project' }); setPageError({ message: '请先连接云端账户后创建项目' }); return }
    void run(async () => {
      const result = await coordinatorClient.createProject({ createIntentId: opaqueId('pct'), displayName: name, goal: description, budget: { maxTasks: 100, maxTasksPerRound: 8, maxCoordinationRounds: 100, maxTaskRetries: 1 } })
      setNewProjectOpen(false); applySelection(result.createdProjectId); setRoute('requirements'); setWorkspace(result.workspace)
    }, { kind: 'create-project', target: 'create-project' })
  }, [applySelection, coordinatorClient, model.currentUserId, run])
  const adoptSelected = useCallback(() => { const manifest = selectedTaskView?.delivery?.manifest; if (!model.projectId || !manifest) return; void run(() => coordinatorClient.decideAdoption({ projectId: model.projectId!, taskId: selectedCard.id, deliveryManifestId: manifest.deliveryManifestId, integrationRevision: 1, validationEvidence: ['Owner reviewed the submitted delivery in the task drawer.'], operationId: opaqueId('adoption'), disposition: 'adopted' }), { kind: 'adopt', target: selectedCard.id }) }, [coordinatorClient, model.projectId, run, selectedCard.id, selectedTaskView])
  const requestSelectedRevision = useCallback(async (instruction: string): Promise<boolean> => {
    const manifest = selectedTaskView?.delivery?.manifest
    const parsed = deliveryRevisionRequestSchema.shape.instruction.safeParse(instruction)
    if (!model.projectId || !manifest || !parsed.success) return false
    return run(() => coordinatorClient.requestRevision({ projectId: model.projectId!, taskId: selectedCard.id, deliveryManifestId: manifest.deliveryManifestId, instruction: parsed.data }), { kind: 'revision', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.id, selectedTaskView])
  const decideSelectedOffer = useCallback((decision: 'accept' | 'reject') => { if (!selectedCard.offerId || !(decision === 'accept' ? selectedCard.offerAvailability?.canAccept : selectedCard.offerAvailability?.canReject)) return; void run(() => collaborationClient.decideTaskOffer({ taskOfferId: selectedCard.offerId!, decision }), { kind: `offer-${decision}`, target: selectedCard.id }) }, [collaborationClient, run, selectedCard.id, selectedCard.offerId, selectedCard.offerAvailability])
  const reexecuteSelectedTask = useCallback(() => {
    const sourceId = selectedCard.executionFailure?.reexecutionInputId
    if (!model.projectId || !selectedCard.executionId || !sourceId || !workbench?.sendMessage ||
        selectedCard.assigneeUserId !== model.currentUserId) return
    void run(async () => {
      const session = await collaborationClient.openTaskSession({ projectId: model.projectId!, taskId: selectedCard.id, executionId: selectedCard.executionId! })
      const result = await workbench.sendMessage!({ sessionId: session.threadId,
        reexecuteInput: { runtimeId: session.runtimeId, clientDirectiveId: sourceId } })
      if (!result.ok) throw new Error(result.error.message)
    }, { kind: 'reexecute', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, workbench])
  const continueSelectedTask = useCallback(() => {
    if (!model.projectId || !selectedCard.executionId || !workbench?.openSession ||
        selectedCard.assigneeUserId !== model.currentUserId) return
    void run(async () => {
      const session = await collaborationClient.openTaskSession({ projectId: model.projectId!, taskId: selectedCard.id, executionId: selectedCard.executionId! })
      const opened = await openCollaborationTaskSession(workbench, session, {
        projectId: model.projectId!, taskId: selectedCard.id,
        taskReference: selectedCard.reference
      })
      if (!opened) throw new Error('任务会话暂时无法打开，请稍后重试。')
    }, { kind: 'continue-session', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, workbench])
  const returnSelectedTask = useCallback((reason: string): Promise<boolean> => {
    if (!model.projectId || !selectedCard.executionId || !selectedCard.canReturnExecution || selectedCard.assigneeUserId !== model.currentUserId) return Promise.resolve(false)
    return run(() => collaborationClient.returnTask({ projectId: model.projectId!, taskId: selectedCard.id, executionId: selectedCard.executionId!, reason }), { kind: 'return-task', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard])
  const answerSelectedHumanRequest = useCallback((answer: string): Promise<boolean> | void => {
    const request = model.project?.pendingHumanNeeded.find((item) => item.humanRequestId === selectedCard.humanRequestId)
    const text = answer.trim()
    // Only the Member the Agent asked may answer; every other reader stays read-only.
    if (!model.projectId || !request || !text || request.targetUserId !== model.currentUserId) return
    return run(() => coordinatorClient.answerHumanNeeded({ projectId: model.projectId!, humanRequestId: request.humanRequestId, requestRevision: request.revision, answer: text }), { kind: 'answer', target: selectedCard.id })
  }, [coordinatorClient, model.currentUserId, model.project?.pendingHumanNeeded, model.projectId, run, selectedCard.humanRequestId, selectedCard.id])
  const submitDelivery = useCallback((summary: string): Promise<boolean> => {
    if (!workerDelivery?.draft || selectedCard.assigneeUserId !== model.currentUserId) return Promise.resolve(false)
    return run(async () => {
      try {
        const saved = await localDraft.flush(summary)
        const current = (await collaborationClient.readWorkerDelivery({ projectId: saved.projectId, taskId: saved.taskId, executionId: saved.executionId })).delivery
        acceptWorkerDelivery(current)
        if (current.draft?.summary.trim() !== summary.trim()) throw new Error('结果说明有新改动，请检查后再次提交。')
        if (JSON.stringify(current.draft?.outputs) !== JSON.stringify(saved.draft?.outputs)) throw new Error('文件有新改动，请预览后再次提交。')
        if (!current.confirmationTarget) throw new Error('请检查结果说明和任务产出后再次提交。')
        const result = await collaborationClient.submitWorkerDelivery({ target: current.confirmationTarget })
        acceptWorkerDelivery(result.delivery)
        if (result.delivery.error) throw new Error(result.delivery.error)
      } catch (cause) {
        throw new Error(deliverySubmissionError(cause instanceof Error ? cause.message : ''))
      }
    }, { kind: 'submit-delivery', target: selectedCard.id })
  }, [acceptWorkerDelivery, collaborationClient, localDraft, model.currentUserId, run, selectedCard.assigneeUserId, selectedCard.id, workerDelivery])
  const assignSelected = useCallback((workerUserId: string) => {
    const assignment = selectedCard.assignment
    if (!model.projectId || !workerUserId || !assignment) return
    const projectId = model.projectId
    const offerExpiresAt = new Date(Date.now() + DEFAULT_TASK_OFFER_TTL_MS).toISOString()
    void run(async () => {
      if (assignment.kind === 'first') {
        await coordinatorClient.reassignTaskOffer({ projectId, taskId: assignment.taskId, previousTaskOfferId: null, workerUserId, offerExpiresAt, nextOutputFileName: null, requirementsDocumentId: assignment.requirementsDocumentId, planItemId: assignment.planItemId })
        setSelectedCardId(assignment.taskId)
      } else if (assignment.kind === 'withdraw') {
        // The Cloud only accepts a terminal previous Offer. Handing a pending
        // Offer to another Member is therefore the canonical withdraw followed
        // by the canonical reassignment, in one Owner action.
        await coordinatorClient.withdrawTaskOffer({ projectId, taskId: selectedCard.id, taskOfferId: assignment.taskOfferId, reason: '负责人将待接受的派单改派给其他成员。' })
        await coordinatorClient.reassignTaskOffer({ projectId, taskId: selectedCard.id, previousTaskOfferId: assignment.taskOfferId, workerUserId, offerExpiresAt, nextOutputFileName: null })
      } else {
        await coordinatorClient.reassignTaskOffer({ projectId, taskId: selectedCard.id, previousTaskOfferId: assignment.previousTaskOfferId, workerUserId, offerExpiresAt, nextOutputFileName: null })
      }
    }, { kind: 'assign', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.assignment, selectedCard.id])
  const withdrawSelected = useCallback(() => {
    const assignment = selectedCard.assignment
    if (!model.projectId || assignment?.kind !== 'withdraw') return
    const projectId = model.projectId
    void run(() => coordinatorClient.withdrawTaskOffer({ projectId, taskId: selectedCard.id, taskOfferId: assignment.taskOfferId, reason: '负责人撤回了待接受的派单。' }), { kind: 'withdraw', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.assignment, selectedCard.id])
  const completeProject = useCallback((summary: string) => {
    const target = model.completion.target
    if (!target || busyRef.current) return
    busyRef.current = true
    void (async () => {
      setBusy(true); setCompletionError(null)
      try {
        await coordinatorClient.completeProject({ target: { ...target, summary } })
        setCompleting(false)
        await refresh(target.projectId)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : ''
        setCompletionError(/no longer matches|revision|conflict/iu.test(message) ? '项目已在其他设备更新，请关闭后重新检查再结项。' : `结项失败：${message || '请稍后重试'}`)
      } finally { busyRef.current = false; setBusy(false) }
    })()
  }, [coordinatorClient, model.completion.target, refresh])
  const publishComment = useCallback((text: string, mentionedUserIds: readonly string[]) => { if (!model.projectId || selectedCard.id === 'empty') return; void run(() => collaborationClient.publishComment({ commentId: opaqueId('cmt'), projectId: model.projectId!, taskId: selectedCard.id, text, mentionedUserIds: [...mentionedUserIds] }), { kind: 'comment', target: selectedCard.id }) }, [collaborationClient, model.projectId, run, selectedCard.id])
  const confirmRequirements = useCallback(() => {
    const document = model.project?.requirementsDraft ?? model.project?.confirmedRequirements
    if (!document || !model.projectId) { setRoute('requirements'); return Promise.resolve(false) }
    return run(() => coordinatorClient.confirmRequirements({ projectId: model.projectId!, requirementsDocumentId: document.requirementsDocumentId, expectedProjectRevision: model.project!.project.revision, expectedRequirementsRevision: document.revision, contentDigest: document.contentDigest }), { kind: 'confirm-requirements', target: `requirements:${model.projectId}` })
  }, [coordinatorClient, model.project, model.projectId, run])
  const openDeliveryPreview = useCallback((file: DeliveryFileEntry) => {
    setPageError(null)
    void (async () => {
      try {
        if (!file.descriptor) throw new Error('这份资料尚未封存为交付文件。')
        if (!resourcePreview) throw new Error('文件预览暂不可用，请稍后重试。')
        const expected = file.descriptor
        const opened = await coordinatorClient.openDeliveryObject({ deliveryManifestId: expected.deliveryManifestId, objectId: expected.objectId })
        const object = opened.object
        if (object.objectId !== expected.objectId || object.projectId !== expected.projectId || object.sha256 !== expected.sha256 ||
            object.revision !== expected.objectRevision || object.byteCount !== expected.byteCount || object.mediaType !== expected.mediaType) {
          throw new Error('预览文件与已提交快照不一致，请刷新后重试。')
        }
        if (!resourcePreview.open({ resource: opened.resource, file: { name: file.name, mimeType: file.mediaType, size: file.byteCount } })) {
          throw new Error('文件预览暂不可用，请稍后重试。')
        }
      } catch (cause) { setPageError({ message: cause instanceof Error ? cause.message : '交付文件预览失败，请稍后重试。' }) }
    })()
  }, [coordinatorClient, resourcePreview])
  const previewDeliveryFile = useCallback((relativePath: string) => {
    if (!workerDelivery?.draft || selectedCard.assigneeUserId !== model.currentUserId) return
    setAction({ kind: 'preview', target: selectedCard.id }); setPageError(null)
    void (async () => {
      try {
        if (!workspacePreview) throw new Error('文件预览暂不可用')
        const saved = await localDraft.flush(localDraft.summary ?? workerDelivery.draft!.summary)
        const file = saved.draft?.outputs.find((item) => item.relativePath === relativePath)
        if (!file) throw new Error('文件有新改动，请重新选择后预览。')
        const session = await collaborationClient.openTaskSession({ projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId })
        if (workbench?.openSession) {
          const opened = await openCollaborationTaskSession(workbench, session, { projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, taskReference: selectedCard.reference })
          if (!opened) throw new Error('无法打开任务文件所在的会话，请稍后重试。')
        }
        workspacePreview.open({ path: file.relativePath, sessionId: session.sessionId, mimeType: file.mediaType, kind: 'file', integrity: { algorithm: 'sha256', expectedDigest: file.sha256 } })
      } catch (cause) { setPageError({ message: cause instanceof Error ? cause.message : '交付文件预览失败' }) }
    })()
  }, [collaborationClient, localDraft, model.currentUserId, selectedCard, workbench, workerDelivery, workspacePreview])
  const previewDraftFile = useCallback((file: import('./task-drawer/delivery-draft-types.js').DeliveryDraftFile) => {
    const historical = workerDelivery?.history.find((entry) => file.id.startsWith(`${entry.deliveryManifestId}:`))
    const files = historical ? deliveryManifestEntries(historical.manifest, { members: model.project?.memberUsers ?? [], executions: selectedTaskView?.executions,
      fallbackSubmitter: selectedCard.assignee ?? null }) : selectedDeliveryFiles
    if (historical || workerDelivery?.state === 'sealed' || !workerDelivery) {
      const sealed = files.find((entry) => entry.relativePath && entry.relativePath === file.relativePath) ?? files.find((entry) => entry.name === file.name) ?? (files.length === 1 ? files[0] : undefined)
      if (sealed) openDeliveryPreview(sealed)
    } else previewDeliveryFile(file.relativePath)
  }, [model.project?.memberUsers, openDeliveryPreview, previewDeliveryFile, selectedCard.assignee, selectedDeliveryFiles, selectedTaskView, workerDelivery])
  const closeDrawer = useCallback(() => setSelectedCardId(null), [])
  const connectCollaboration = useCallback((action: 'configure' | 'connect' | 'recover') => {
    void run(() => action === 'configure' ? collaborationClient.configureConnection({}) : collaborationClient.changeConnection({ action }))
  }, [collaborationClient, run])
  // Signing in after launch leaves Collaboration unconfigured; join the identity's Cloud once without a click.
  const autoConfigured = useRef(false)
  useEffect(() => {
    if (!active || autoConfigured.current || model.connection.action !== 'configure') return
    autoConfigured.current = true
    void collaborationClient.configureConnection({}).then(() => refresh(undefined, { silent: true }), () => undefined)
  }, [active, collaborationClient, model.connection.action, refresh])
  const copyUserId = useCallback(async () => {
    const userId = model.currentUserId
    if (!userId) return
    await navigator.clipboard?.writeText(userId)
  }, [model.currentUserId])

  const revision = selectedTaskView?.delivery?.revisionRequest
  const deliveryDetail: DeliveryDraftData | undefined = workerDelivery ? {
    ...workerDeliveryPresentation(workerDelivery, selectedCard, model.members, selectedDeliveryFiles),
    ...(action?.kind === 'submit-delivery' && action.target === selectedCard.id && error ? { submitError: error } : {}),
    ...(workerDelivery.state !== 'sealed' ? { summary: localDraft.summary ?? '', saveState: localDraft.saveState,
      additionalFiles: localDraft.selectedMaterials?.flatMap((selected) => {
        const stored = workerDelivery.draft?.outputs.find((file) => file.relativePath === selected.relativePath)
        const file = stored ? { id: stored.relativePath, name: stored.fileName, ...stored } : materialCatalog[workerDelivery.executionId]?.find((entry) => entry.relativePath === selected.relativePath)
        return [file ?? { id: selected.relativePath, name: workspaceAttachmentDisplayName(selected.relativePath), relativePath: selected.relativePath, source: selected.source ?? (selected.relativePath.startsWith('.sciforge/uploads/') ? 'attachment' as const : 'member' as const), mediaType: '', byteCount: 0, unavailable: true }]
      }) ?? [] } : {}),
    ...(selectedTaskView?.delivery?.receipt?.disposition === 'adopted' ? { state: 'adopted' as const } : {}),
    ...(revision ? { revisionRequest: { author: model.project?.memberUsers.find((user) => user.userId === revision.requestedByUserId)?.displayName ?? '负责人', at: revision.requestedAt, instruction: revision.instruction } } : {})
  } : !revisingSubmittedVersion && selectedManifest?.resultRevision && sealedSummaries[selectedManifest.deliveryManifestId] !== undefined ? {
    revision: selectedManifest.resultRevision, summary: sealedSummaries[selectedManifest.deliveryManifestId]!,
    state: selectedTaskView?.delivery?.receipt?.disposition === 'adopted' ? 'adopted' : 'submitted',
    submitter: selectedDeliveryFiles[0]?.submitter ?? selectedCard.assignee ?? '成员', submittedAt: selectedManifest.sealedAt,
    declaredFiles: selectedDeliveryFiles.filter((file) => file.role !== 'member').map((file) => ({ id: file.key, name: file.name, relativePath: file.relativePath ?? '', mediaType: file.mediaType, byteCount: file.byteCount, source: file.source ?? 'unknown' })),
    additionalFiles: selectedDeliveryFiles.filter((file) => file.role === 'member').map((file) => ({ id: file.key, name: file.name, relativePath: file.relativePath ?? '', mediaType: file.mediaType, byteCount: file.byteCount, source: file.source ?? 'unknown' }))
  } : model.currentUserId === model.currentProject.ownerUserId && selectedCard.executionId && (!selectedManifest || revisingSubmittedVersion) ? { revision: (selectedManifest?.resultRevision ?? 0) + 1, summary: '', state: 'ready', declaredFiles: [] } : undefined
  const taskAction = action?.target === selectedCard.id ? action.kind : undefined
  const taskError = taskAction ? error : null
  const requirementsError = action?.target === `requirements:${model.projectId}` || action?.target === `invitation:${invitationItem?.membershipId}` ? error : null
  const createError = action?.target === 'create-project' ? error : null
  const errorShownInline = (route === 'board' && selectedCardId !== null && taskError) || (route === 'requirements' && requirementsError) || (newProjectOpen && createError)
  const content = route === 'board' ? undefined
    : route === 'requirements' ? <RequirementsView key={`${model.projectId}:${confirmOnOpen}`} model={model} busy={busy} error={requirementsError} pendingAction={busy ? action?.kind : undefined} invitation={invitationItem} confirmOnOpen={confirmOnOpen} onAcceptInvitation={invitationItem ? () => acceptInvitationItem(invitationItem) : undefined} onOpenModule={openModuleCard} onSave={(goals, inputs) => void run(() => coordinatorClient.saveRequirementsDraft({ projectId: model.projectId!, expectedProjectRevision: model.project!.project.revision, expectedRequirementsRevision: model.requirements?.revision ?? 0, goalsDeliverables: goals, inputsBoundaries: inputs }), { kind: 'save-requirements', target: `requirements:${model.projectId}` })} onComplete={() => void run(() => coordinatorClient.completeRequirements({ projectId: model.projectId!, expectedRequirementsRevision: model.requirements?.revision ?? undefined }), { kind: 'complete-requirements', target: `requirements:${model.projectId}` })} onConfirm={confirmRequirements} />
    : route === 'settings' ? <SettingsView key={model.projectId} model={model} busy={busy} onAddMember={addMember} onRemoveMember={removeMember} />
    : route === 'my-work' ? <PersonalList title="我的工作" subtitle="跨所有项目，分配给你和等你处理的任务" items={model.myWork} loading={!model.loaded} onOpen={openPersonalItem} />
    : route === 'inbox' ? <PersonalList title="收件箱" subtitle="邀请、待接受的任务、Agent 提问和待采纳的交付" items={model.inbox} loading={!model.loaded} onOpen={openPersonalItem} />
    : <FilesView groups={fileGroups} loading={filesLoading} onPreview={openDeliveryPreview} />
  const projectRoute = route === 'board' || route === 'requirements' || route === 'files' || route === 'settings'
  const activeRoute = route === 'my-work' || route === 'inbox' ? route : undefined
  const activeTab = route === 'requirements' ? 'requirements' : route === 'files' ? 'files' : route === 'settings' ? 'settings' : 'board'
  return (
    <div className={`collaboration-workspace-page${className ? ` ${className}` : ''}`}>
      <CollaborationWorkspaceStructure
        model={model}
        selectedCard={selectedCard}
        busy={busy}
        pendingAction={busy ? taskAction : undefined}
        taskError={taskError}
        content={content}
        switching={switchingProjectId !== null}
        showDrawer={projectRoute && route === 'board' && selectedCardId !== null}
        showProjectHeader={projectRoute && model.projectId !== null}
        activeRoute={activeRoute}
        activeTab={activeTab}
        onSelectProject={selectProject}
        onNavigate={selectRoute}
        onTabChange={selectRoute}
        onPrimaryAction={model.completion.target ? () => { setCompletionError(null); setCompleting(true) } : openRequirements}
        onCreateProject={() => setNewProjectOpen(true)}
        onSelectCard={(card) => setSelectedCardId(card.id)}
        onCloseDrawer={closeDrawer}
        onConnect={connectCollaboration}
        onCopyUserId={copyUserId}
        onAdopt={adoptSelected}
        onRequestRevision={requestSelectedRevision}
        onOfferDecision={decideSelectedOffer}
        onHumanAnswer={answerSelectedHumanRequest}
        onReturnTask={returnSelectedTask}
        onReexecute={workbench?.sendMessage ? reexecuteSelectedTask : undefined}
        onContinueSession={workbench?.openSession ? continueSelectedTask : undefined}
        onSubmitDelivery={submitDelivery}
        onAssign={assignSelected}
        onWithdraw={withdrawSelected}
        onComment={publishComment}
        activity={activity}
        delivery={workerDelivery}
        deliveryDetail={deliveryDetail}
        materialSelection={materialSelection}
        onMaterialsChange={changeMaterials}
        onSummaryChange={localDraft.onSummaryChange}
        onAiSummaryDecision={localDraft.onAiSummaryDecision}
        deliveryError={deliveryError ?? (selectedManifest ? sealedSummaryErrors[selectedManifest.deliveryManifestId] : undefined)}
        deliveryFiles={selectedDeliveryFiles}
        onPreviewDraftFile={previewDraftFile}
        onPreviewSealedFile={openDeliveryPreview}
      />
      {error && !errorShownInline ? <div className="collaboration-workspace-page-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>重试</button><button type="button" aria-label="关闭提示" onClick={() => setPageError(null)}>×</button></div> : null}
      {completing && model.completion.target ? <CompleteProjectDialog projectName={model.currentProject.name} adopted={model.completion.adopted} requirementsVersion={model.currentProject.requirementsRevision} error={completionError} busy={busy} onConfirm={completeProject} onCancel={() => setCompleting(false)} /> : null}
      {newProjectOpen ? <NewProjectDialog busy={busy} waiting={model.connection.waiting} error={createError} onSubmit={createProject} onCancel={() => setNewProjectOpen(false)} /> : null}
    </div>
  )
}
