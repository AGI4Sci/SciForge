import type { ValidationAdoption } from './task-drawer/DeliveryValidationControls.js'
import { DecisionRequests } from './DecisionRequests.js'
import { useTranslation } from 'react-i18next'
import { translateWorkspace as cw } from './workspace-i18n.js'
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererWorkspacePreviewHost, DomainRendererWorkbenchHost, DomainRendererWorkspaceHost, DomainRendererResourcePreviewHost } from '@sciforge/domain-sdk/host'
import { workspaceAttachmentDisplayName } from '@sciforge/domain-sdk/attachment-policy'
import type { DomainRendererWorkbenchSurfaceActivation } from '@sciforge/domain-sdk/renderer-contributions'
import { DEFAULT_TASK_OFFER_TTL_MS, deliveryRevisionRequestSchema, integrationReceiptSchema, type DeliveryDriveView, type IntegrationReceipt, type ProjectRequirementsDocument } from '@sciforge/collaboration-contracts'
import { ProjectCoordinatorRequirementsCompletionClientError, type ProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'
import type { ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import type { CollaborationRendererClient } from '../collaboration-capability-client.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import { COLLABORATION_MAIN_AREA_CONTRIBUTION } from '../../definition.js'
import { CollaborationWorkspaceStructure } from './CollaborationWorkspaceStructure.js'
import { createWorkspaceViewModel, type WorkspacePersonalItem, type WorkspaceRoute } from './workspace-view-model.js'
import type { TaskCardModel } from './workspace-types.js'
import { offerDecisionActionKind, offerDecisionAllowed, offerDecisionFromActionKind, offerDecisionInput, type OfferDecision } from './offer-decisions.js'
import { assignmentAlertSignature, assignmentOfferIds, canAcceptAllAssignments, pendingAssignments as derivePendingAssignments } from './assignment-alerts.js'
import { ResearchView } from './research/ResearchView.js'
import { sendResearchQuestion } from './research/research-conversation.js'
import { RequirementsView } from './requirements/RequirementsView.js'
import { ProjectInfoView } from './project-info/ProjectInfoView.js'
import { MembersView } from './members/MembersView.js'
import { PersonalList } from './personal/PersonalList.js'
import { FilesView } from './files/FilesView.js'
import { deliveryFileGroups, deliveryManifestEntries, type DeliveryFileEntry } from './files/delivery-files.js'
import { readSealedDeliverySummary } from './files/delivery-bundle-summary.js'
import { RelatedTaskChats } from './task-drawer/RelatedTaskChats.js'
import { TaskContentEditor } from './task-drawer/TaskContentEditor.js'
import { ProjectExecutionControls } from './projects/ProjectExecutionControls.js'
import { RenameProjectDialog } from './projects/RenameProjectDialog.js'
import { NewProjectDialog } from './projects/NewProjectDialog.js'
import { retainProjectCreationAttempt, type ProjectCreationAttempt, type ProjectCreationRecovery } from './projects/project-creation.js'
import { ProjectCreationRecovery as ProjectCreationRecoveryNotice } from './projects/ProjectCreationRecovery.js'
import { CompleteProjectDialog } from './dialogs/CompleteProjectDialog.js'
import { ConfirmationDialog } from './dialogs/ConfirmationDialog.js'
import { collaborationFailure } from './collaboration-errors.js'
import { waitForRefresh } from '../../refresh-await.js'
import { answerReviewedHumanRequest, type HumanDecision, type HumanAnswerFeedback } from './human-request-decision.js'
import { acceptReviewedInvitation } from './accept-reviewed-invitation.js'
import { reconcileAdoptionReceipts } from './adoption-receipts.js'

import { openCollaborationTaskSession } from '../task-session-navigation.js'
import { taskActivityItems } from './task-activity.js'
import { useWorkerDeliveryDraft } from './use-worker-delivery-draft.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './task-drawer/delivery-draft-types.js'
import { deliverySubmissionError, workerDeliveryPresentation } from './task-drawer/worker-delivery-presentation.js'
import { WorkspaceDocumentContext } from './workspace-document.js'

/** Other members' actions show up without a click while the page is in front. */
const LIVE_REFRESH_INTERVAL_MS = 8_000
const REFRESH_TIMEOUT_MS = 30_000
type RefreshOptions = Readonly<{ silent?: boolean; refreshDashboards?: boolean }>
type RefreshRequest = Readonly<{ projectId?: string; options: RefreshOptions }>

function opaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function CollaborationWorkspacePage({ coordinatorClient, collaborationClient, workspacePreview, resourcePreview, workspace: workspaceHost, workbench, activation, active = true, className, ownerDocument }: Readonly<{ coordinatorClient: ProjectCoordinatorRendererClient; collaborationClient: CollaborationRendererClient; workspacePreview?: DomainRendererWorkspacePreviewHost; resourcePreview?: DomainRendererResourcePreviewHost; workspace?: DomainRendererWorkspaceHost; workbench?: DomainRendererWorkbenchHost; activation?: DomainRendererWorkbenchSurfaceActivation; active?: boolean; className?: string; ownerDocument?: Document }>): ReactElement {
  const { i18n } = useTranslation('common')
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<CollaborationRendererClient['readStatus']>>>()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null)
  const [route, setRoute] = useState<WorkspaceRoute>('my-work')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  /** Set of assignments the User closed the top alert for; a new set re-opens it. */
  const [dismissedAssignmentKey, setDismissedAssignmentKey] = useState<string | null>(null)
  const [pageError, setPageError] = useState<Readonly<{
    message: string
    /** The stripped original capability message, kept for 「复制错误详情」. */
    detail?: string
    failedCompletionDraft?: ProjectRequirementsDocument
  }> | null>(null)
  const error = pageError?.message ?? null
  const [copiedErrorDetail, setCopiedErrorDetail] = useState<string | null>(null)
  const [humanAnswerFeedback, setHumanAnswerFeedback] = useState<HumanAnswerFeedback>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [action, setAction] = useState<Readonly<{ kind: string; target: string }> | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const creationAttempt = useRef<ProjectCreationAttempt | null>(null)
  const [creationRecovery, setCreationRecovery] = useState<ProjectCreationRecovery | null>(null)
  const [renameTarget, setRenameTarget] = useState<Readonly<{ id: string; name: string; revision: number }> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Readonly<{ id: string; name: string }> | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
  const adoptionReceipts = useRef<readonly IntegrationReceipt[]>([])

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
          nextSnapshot ? Promise.resolve(nextSnapshot)
            : collaborationClient.readStatus(options.refreshDashboards ? { refreshDashboards: true } : {}, { signal })
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
      const localExecutions = new Set(nextSnapshot.projects.flatMap((project) => project.tasks.filter((task) => task.workerUserId === userId).map((task) => task.executionId)))
      const targets = nextSnapshot.dashboards.flatMap((dashboard) => dashboard.tasks.filter((task) => task.assigneeUserId === userId && task.executionId && localExecutions.has(task.executionId)).map((task) => ({ projectId: task.projectId, taskId: task.taskId, executionId: task.executionId! })))
      const reads = await Promise.allSettled(targets.map((target) => collaborationClient.readWorkerDelivery(target, { signal })))
      if (signal.aborted || sequence !== readSequence.current) return
      const deliveries: Record<string, WorkerDeliveryView> = {}
      const errors: Record<string, string> = {}
      reads.forEach((read, index) => {
        const target = targets[index]!
        if (read.status === 'fulfilled') deliveries[target.executionId] = read.value.delivery
        else errors[target.executionId] = collaborationFailure(read.reason, cw("本机交付读取失败")).message
      })
      setWorkerDeliveries((current) => Object.fromEntries(Object.entries(deliveries).map(([id, view]) => {
        const previous = current[id]
        return [id, previous?.draft && view.draft && previous.draft.revision > view.draft.revision ? previous : view]
      })))
      setDeliveryErrors(errors)
      const reconciled = reconcileAdoptionReceipts(nextWorkspace, adoptionReceipts.current)
      adoptionReceipts.current = reconciled.pending
      setWorkspace(reconciled.workspace)
      setSnapshot(nextSnapshot)
      if (switchingProjectIdRef.current !== null && requestedProjectId === switchingProjectIdRef.current) {
        endProjectSwitch()
      }
    } catch (cause) {
      if (signal.aborted || sequence !== readSequence.current) return
      if (!options.silent) setPageError(collaborationFailure(cause, cw("Collaboration 数据读取失败")))
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
        const timer = window.setTimeout(() => controller.abort(new Error(cw("协作刷新超时，请重试。"))), REFRESH_TIMEOUT_MS)
        try {
          await waitForRefresh(readPage(request.projectId, request.options, controller.signal, sequence), controller.signal)
        } catch (cause) {
          if (lifetime === refreshLifetime.current && sequence === readSequence.current) {
            if (!request.options.silent) setPageError(collaborationFailure(cause, cw("Collaboration 数据读取失败")))
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
    const document = ownerDocument ?? globalThis.document
    const window = document.defaultView!
    const onFocus = () => liveRefresh.current()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') liveRefresh.current() }, LIVE_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [active, ownerDocument])

  const model = useMemo(() => createWorkspaceViewModel({ workspace, snapshot, selectedProjectId, route, files, workerDeliveries }), [files, route, selectedProjectId, snapshot, workspace, workerDeliveries, i18n.resolvedLanguage])
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
  // The alert, the 看板 badge and the quick acceptance all read one list.
  const pendingAssignmentItems = useMemo(() => derivePendingAssignments(model.cards, model.inbox), [model.cards, model.inbox])
  const pendingAssignmentKey = useMemo(() => assignmentAlertSignature(pendingAssignmentItems), [pendingAssignmentItems])
  const selectedCardBase = model.cards.find((card) => card.id === selectedCardId) ?? model.selectedCard
  const selectedReceipt = model.project?.tasks.find((view) => view.task.taskId === selectedCardBase.cloudTaskId)?.delivery?.receipt
  const selectedCard = selectedReceipt?.disposition === 'adopted' ? { ...selectedCardBase, status: 'completed' as const, stateLabel: undefined } : selectedCardBase
  // Every Cloud capability targets the Cloud Task, never the board identity of
  // the card: a requirement module that is still in 收集箱 has no Task yet.
  const selectedCloudTaskId = selectedCard.cloudTaskId
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
    if (!workerDelivery || selectedCard.assigneeUserId !== model.currentUserId) throw new Error(cw("当前账户无法读取这些任务文件。"))
    const result = await collaborationClient.listWorkerDeliveryMaterials({ projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId, ...input })
    const entries = result.files.map((file) => ({ id: file.relativePath, name: file.fileName, ...file }))
    rememberMaterials(workerDelivery.executionId, entries)
    return { ...result, files: entries }
  }, [collaborationClient, model.currentUserId, rememberMaterials, selectedCard.assigneeUserId, workerDelivery])
  const importMaterials = useCallback(async (files: readonly File[], onImported: (file: DeliveryDraftFile) => void) => {
    if (!workerDelivery || selectedCard.assigneeUserId !== model.currentUserId) throw new Error(cw("当前会话暂不能导入文件。"))
    const entries: DeliveryDraftFile[] = []
    const errors: string[] = []
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        const { file: result } = await collaborationClient.importWorkerDeliveryMaterial({
          projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId,
          fileName: file.name, contentBase64: btoa(binary)
        })
        const entry: DeliveryDraftFile = { id: result.relativePath, name: result.fileName, ...result, source: 'member', imported: true }
        entries.push(entry)
        rememberMaterials(workerDelivery.executionId, [entry])
        onImported(entry)
      } catch (cause) { errors.push(cw('{{name}}：{{message}}', { name: file.name, message: cause instanceof Error ? cause.message : cw('导入失败') })) }
    }
    if (errors.length) throw new Error(errors.join('；'))
    return entries
  }, [collaborationClient, model.currentUserId, rememberMaterials, selectedCard.assigneeUserId, workerDelivery])
  const materialSelection: DeliveryMaterialSelection = {
    files: workerDelivery ? materialCatalog[workerDelivery.executionId] ?? [] : [],
    onList: listMaterials,
    ...(workerDelivery ? { onUpload: importMaterials } : {})
  }
  const changeMaterials = useCallback((files: readonly DeliveryDraftFile[]) => {
    if (!workerDelivery) return
    rememberMaterials(workerDelivery.executionId, files)
    localDraft.onMaterialsChange(files.map((file) => ({ relativePath: file.relativePath, ...(file.imported || localDraft.selectedMaterials?.some((selected) => selected.relativePath === file.relativePath && selected.source === 'member') ? { source: 'member' as const } : {}) })))
  }, [localDraft, rememberMaterials, workerDelivery])
  const deliveryError = selectedCard.executionId ? deliveryErrors[selectedCard.executionId] : undefined
  const selectedTaskView = model.project?.tasks.find((entry) => entry.task.taskId === selectedCloudTaskId)
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
    }).catch(() => { if (!cancelled) setSealedSummaryErrors((current) => ({ ...current, [selectedManifest.deliveryManifestId]: cw("交付说明读取失败，请重新打开任务。") })) })
    return () => { cancelled = true }
  }, [active, coordinatorClient, model.currentUserId, revisingSubmittedVersion, sealedSummaries, selectedCard.assigneeUserId, selectedCardId, selectedManifest])
  const fileGroups = useMemo(() => deliveryFileGroups({
    drive: model.files,
    project: model.project,
    dashboards: snapshot?.dashboards ?? []
  }), [model.files, model.project, snapshot?.dashboards])
  const dashboard = snapshot?.dashboards?.find((item) => item.projectId === model.projectId)
  const activity = taskActivityItems(dashboard?.activity ?? [], selectedCloudTaskId ?? '')

  useEffect(() => {
    if (!active || !model.projectId || route !== 'files') return
    setFilesLoading(true)
    void coordinatorClient.listDrive({ projectId: model.projectId }).then(setFiles).catch((cause) => { setFiles(null); setPageError(collaborationFailure(cause, cw("文件读取失败"))) }).finally(() => setFilesLoading(false))
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
      await refresh(undefined, { refreshDashboards: nextAction.kind === 'answer' })
      return true
    } catch (cause) {
      // The original attempt continues. Refresh its authoritative progress
      // instead of reporting a duplicate request as a failed model run.
      const completionFailure = cause instanceof ProjectCoordinatorRequirementsCompletionClientError
      const failure = collaborationFailure(cause, cw("操作失败"))
      setPageError(completionFailure && cause.reason === 'completion_in_progress' ? null : {
        ...failure,
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
    setRoute(model.inbox.some((item) => item.kind === 'invite' && item.projectId === projectId) ? 'requirements' : 'research')
    if (!alreadyLoaded) beginProjectSwitch(projectId)
    void refresh(projectId)
  }, [applySelection, beginProjectSwitch, model.inbox, refresh, workspace?.focusedProjectId])
  useEffect(() => {
    const payload = activation?.payload
    if (!active || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.projectId !== 'string' || (typeof payload.taskId !== 'string' && payload.route !== 'research')) return
    applySelection(payload.projectId)
    setRoute(payload.route === 'research' ? 'research' : 'board')
    setSelectedCardId(typeof payload.taskId === 'string' ? payload.taskId : null)
    void refresh(payload.projectId)
  }, [activation, active, applySelection, refresh])
  const selectRoute = useCallback((nextRoute: WorkspaceRoute) => { setRoute(nextRoute); setSelectedCardId(null); setConfirmOnOpen(false) }, [])
  const openRequirements = useCallback(() => { setRoute('requirements'); setSelectedCardId(null); setConfirmOnOpen(model.currentProject.headerAction === '确认需求') }, [model.currentProject.headerAction])
  /** Opening one inbox row acknowledges every process event the row merged. */
  const markNotificationsRead = useCallback((item: WorkspacePersonalItem | undefined) => {
    if (!item) return
    for (const notificationId of new Set(item.notificationIds ?? (item.notificationId ? [item.notificationId] : []))) {
      const notification = snapshot?.notifications?.find((entry) => entry.notificationId === notificationId)
      if (notification) void collaborationClient.markNotificationRead({ notificationId: notification.notificationId, expectedRevision: notification.revision })
    }
  }, [collaborationClient, snapshot?.notifications])
  const findInboxItemForTask = useCallback((card: TaskCardModel) => (
    model.inbox.find((item) => item.projectId === card.projectId && item.taskId === card.id)
  ), [model.inbox])
  /** Opening a task from the board acknowledges the same inbox event as opening it from the inbox. */
  const selectCard = useCallback((card: TaskCardModel) => {
    setSelectedCardId(card.id)
    markNotificationsRead(findInboxItemForTask(card))
  }, [findInboxItemForTask, markNotificationsRead])
  const openModuleCard = useCallback((reference: string) => {
    const target = model.cards.find((card) => card.reference === reference)
    setRoute('board'); setConfirmOnOpen(false); setSelectedCardId(target?.id ?? null)
    if (target) markNotificationsRead(findInboxItemForTask(target))
  }, [findInboxItemForTask, markNotificationsRead, model.cards])
  const openPersonalItem = useCallback((item: WorkspacePersonalItem) => {
    applySelection(item.projectId)
    if (workspace?.focusedProjectId !== item.projectId) beginProjectSwitch(item.projectId)
    if (item.membershipId) setRoute('requirements')
    else if (item.taskId) { setSelectedCardId(item.taskId); setRoute('board') }
    else { setRoute('requirements') }
    markNotificationsRead(item)
    void refresh(item.projectId)
  }, [applySelection, beginProjectSwitch, markNotificationsRead, refresh, workspace?.focusedProjectId])
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
  useEffect(() => {
    if (creationAttempt.current && creationAttempt.current.principalUserId !== model.currentUserId) {
      creationAttempt.current = null
      setCreationRecovery(null)
    }
  }, [model.currentUserId])
  const executeCreation = useCallback((attempt: ProjectCreationAttempt) => {
    void run(async () => {
      const result = await coordinatorClient.createProject(attempt.input)
      if (creationAttempt.current !== attempt) return
      setWorkspace(result.workspace)
      if (result.initializationState === 'session_pending') {
        setCreationRecovery(result)
        return
      }
      creationAttempt.current = null
      setCreationRecovery(null)
      setNewProjectOpen(false); applySelection(result.createdProjectId); setRoute('requirements')
    }, { kind: 'create-project', target: 'create-project' })
  }, [applySelection, coordinatorClient, run])
  const createProject = useCallback((name: string, description: string) => {
    if (!model.currentUserId) { setAction({ kind: 'create-project', target: 'create-project' }); setPageError({ message: cw("请先连接云端账户后创建项目") }); return }
    const attempt = retainProjectCreationAttempt(creationAttempt.current, model.currentUserId, { displayName: name, goal: description, budget: { maxTasks: 100, maxTasksPerRound: 8, maxCoordinationRounds: 100, maxTaskRetries: 1 } }, () => opaqueId('pct'))
    creationAttempt.current = attempt
    executeCreation(attempt)
  }, [executeCreation, model.currentUserId])
  const retryCreation = useCallback(() => {
    if (creationAttempt.current && creationAttempt.current.principalUserId === model.currentUserId) executeCreation(creationAttempt.current)
  }, [executeCreation, model.currentUserId])
  const createOtherProject = useCallback(() => {
    if (busyRef.current) return
    // A separate user intent releases only the current recovery view. The durable
    // creation receipt is retained, and its draft stays in the Project list.
    creationAttempt.current = null
    setCreationRecovery(null)
    setAction(null)
    setPageError(null)
    setNewProjectOpen(true)
  }, [])
  const openCreatedDraft = useCallback(() => {
    if (!creationRecovery) return
    setNewProjectOpen(false); applySelection(creationRecovery.createdProjectId); setRoute('requirements')
  }, [applySelection, creationRecovery])
  const requestDeleteProject = useCallback((projectId: string) => {
    if (deletingProjectId !== null) return
    const target = workspace?.projects.find((entry) => entry.project.projectId === projectId)
    if (!target) return
    setDeleteError(null)
    setDeleteTarget({ id: target.project.projectId, name: target.project.displayName })
  }, [deletingProjectId, workspace?.projects])
  const cancelDeleteProject = useCallback(() => {
    if (deletingProjectId !== null) return
    setDeleteTarget(null); setDeleteError(null)
  }, [deletingProjectId])
  const confirmDeleteProject = useCallback(() => {
    const target = deleteTarget
    if (!target || deletingProjectId !== null) return
    setDeletingProjectId(target.id); setDeleteError(null)
    void (async () => {
      try {
        await coordinatorClient.deleteProject({ projectId: target.id })
        const deletedWasSelected = selectedProjectIdRef.current === target.id
        const fallback = workspace?.projects.find((entry) => entry.project.projectId !== target.id)?.project.projectId ?? null
        setDeleteTarget(null)
        if (deletedWasSelected) {
          applySelection(fallback)
          setSelectedCardId(null)
          if (fallback === null) setRoute('my-work')
        }
        // Re-read the authoritative list so the deleted Project leaves the rail
        // and, when it was selected, the fallback Project (or personal route)
        // becomes the visible Project.
        if (deletedWasSelected && fallback !== null) await refresh(fallback)
        else await refresh()
      } catch (cause) {
        setDeleteError(collaborationFailure(cause, cw("删除项目失败，请稍后重试。")).message)
      } finally { setDeletingProjectId(null) }
    })()
  }, [applySelection, coordinatorClient, deleteTarget, deletingProjectId, refresh, workspace?.projects])
  const adoptSelected = useCallback((selection?: ValidationAdoption) => {
    if (selection?.required && !selection.reference) return; const manifest = selectedTaskView?.delivery?.manifest; if (!model.projectId || !manifest || !selectedCloudTaskId) return; void run(async () => {
    const receipt = await coordinatorClient.decideAdoption({ projectId: model.projectId!, taskId: selectedCloudTaskId, deliveryManifestId: manifest.deliveryManifestId, integrationRevision: 1, validationEvidence: ['Owner reviewed the submitted delivery in the task drawer.'], operationId: opaqueId('adoption'), disposition: 'adopted', ...(selection?.required ? { deliveryValidation: selection.reference } : {}) })
    const parsed = integrationReceiptSchema.safeParse(receipt)
    if (parsed.success && parsed.data.projectId === model.projectId && parsed.data.taskId === selectedCloudTaskId && parsed.data.deliveryManifestId === manifest.deliveryManifestId && parsed.data.disposition === 'adopted') {
      adoptionReceipts.current = [...adoptionReceipts.current.filter((entry) => entry.taskId !== parsed.data.taskId || entry.projectId !== parsed.data.projectId), parsed.data]
      setWorkspace((current) => current ? reconcileAdoptionReceipts(current, adoptionReceipts.current).workspace : current)
    }
  }, { kind: 'adopt', target: selectedCard.id }) }, [coordinatorClient, model.projectId, run, selectedCard.id, selectedCloudTaskId, selectedTaskView])
  const requestSelectedRevision = useCallback(async (instruction: string): Promise<boolean> => {
    const manifest = selectedTaskView?.delivery?.manifest
    const parsed = deliveryRevisionRequestSchema.shape.instruction.safeParse(instruction)
    if (!model.projectId || !manifest || !selectedCloudTaskId || !parsed.success) return false
    return run(() => coordinatorClient.requestRevision({ projectId: model.projectId!, taskId: selectedCloudTaskId, deliveryManifestId: manifest.deliveryManifestId, instruction: parsed.data }), { kind: 'revision', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.id, selectedCloudTaskId, selectedTaskView])
  /** The single board/drawer Offer decision path; the gate decides what may be sent. */
  const decideOffer = useCallback((card: TaskCardModel, decision: OfferDecision) => {
    const taskOfferId = card.offerId
    if (!taskOfferId || !offerDecisionAllowed(card.offerAvailability, decision)) return
    void run(() => collaborationClient.decideTaskOffer(offerDecisionInput(taskOfferId, decision)), { kind: offerDecisionActionKind(decision), target: card.id })
      .then((succeeded) => {
        // A dismissed assignment leaves the board, so its drawer cannot stay open on it.
        if (succeeded && decision === 'dismiss') setSelectedCardId((current) => current === card.id ? null : current)
      })
  }, [collaborationClient, run])
  const decideSelectedOffer = useCallback((decision: OfferDecision) => { decideOffer(selectedCard, decision) }, [decideOffer, selectedCard])
  /**
   * 全部接受 exists only when every pending assignment is a proved local Offer,
   * and each of them still goes through the canonical decision capability.
   */
  const acceptAllAssignments = useCallback(() => {
    if (!canAcceptAllAssignments(pendingAssignmentItems)) return
    const offers = assignmentOfferIds(pendingAssignmentItems)
    void run(async () => {
      for (const taskOfferId of offers) await collaborationClient.decideTaskOffer(offerDecisionInput(taskOfferId, 'accept'))
    }, { kind: 'offer-accept-all', target: 'page' })
  }, [collaborationClient, pendingAssignmentItems, run])
  const startSelectedTask = useCallback((mode: 'manual' | 'ai') => {
    if (!model.projectId || !selectedCloudTaskId || !selectedCard.executionId || selectedCard.assigneeUserId !== model.currentUserId) return
    void run(() => collaborationClient.startTask({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId!, mode }), { kind: 'start-task', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, selectedCloudTaskId])
  const reexecuteSelectedTask = useCallback(() => {
    const sourceId = selectedCard.executionFailure?.reexecutionInputId
    if (!model.projectId || !selectedCloudTaskId || !selectedCard.executionId || !sourceId || !workbench?.sendMessage ||
        selectedCard.assigneeUserId !== model.currentUserId) return
    void run(async () => {
      const session = await collaborationClient.openTaskSession({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId! })
      const result = await workbench.sendMessage!({ sessionId: session.threadId,
        reexecuteInput: { runtimeId: session.runtimeId, clientDirectiveId: sourceId } })
      if (!result.ok) throw new Error(result.error.message)
    }, { kind: 'reexecute', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, selectedCloudTaskId, workbench])
  const continueInNewSession = useCallback(async (reason: string): Promise<string | null> => {
    if (!model.projectId || !selectedCloudTaskId || !selectedCard.executionId || selectedCard.assigneeUserId !== model.currentUserId) return null
    let context: string | null = null
    await run(async () => {
      const predecessor = await collaborationClient.openTaskSession({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId! })
      const receipt = await collaborationClient.continueTaskSession({ projectId: model.projectId!, taskId: selectedCloudTaskId,
        executionId: selectedCard.executionId!, predecessorRuntimeId: predecessor.runtimeId, predecessorThreadId: predecessor.threadId, reason })
      context = receipt.context
    }, { kind: 'continue-new-session', target: selectedCard.id })
    return context
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, selectedCloudTaskId])
  const continueSelectedTask = useCallback(() => {
    if (!model.projectId || !selectedCloudTaskId || !selectedCard.executionId || !workbench?.openSession ||
        selectedCard.assigneeUserId !== model.currentUserId) return
    void run(async () => {
      const session = await collaborationClient.openTaskSession({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId! })
      const opened = await openCollaborationTaskSession(workbench, session, {
        projectId: model.projectId!, taskId: selectedCloudTaskId,
        taskReference: selectedCard.reference
      })
      if (!opened) throw new Error(cw("任务会话暂时无法打开，请稍后重试。"))
    }, { kind: 'continue-session', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, selectedCloudTaskId, workbench])
  const returnSelectedTask = useCallback((reason: string): Promise<boolean> => {
    if (!model.projectId || !selectedCloudTaskId || !selectedCard.executionId || !selectedCard.canReturnExecution || selectedCard.assigneeUserId !== model.currentUserId) return Promise.resolve(false)
    return run(() => collaborationClient.returnTask({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId!, reason }), { kind: 'return-task', target: selectedCard.id })
  }, [collaborationClient, model.currentUserId, model.projectId, run, selectedCard, selectedCloudTaskId])
  const answerSelectedHumanRequest = useCallback((answer: string, decision?: HumanDecision, selectedOptionId?: string): Promise<boolean> => {
    const request = selectedCard.humanRequest
    const userId = model.currentUserId
    if (!request || !userId || !model.projectId) return Promise.resolve(false)
    // Freeze what was actually displayed; never approve a newer unseen revision.
    const reviewed = structuredClone(request)
    return run(async () => {
      await answerReviewedHumanRequest(coordinatorClient, reviewed, userId, answer, decision, selectedOptionId)
      if (reviewed.context.scope === 'worker_execution') setHumanAnswerFeedback({
        projectId: reviewed.projectId, taskId: reviewed.context.taskId, executionId: reviewed.context.executionId,
        userId, humanRequestId: reviewed.humanRequestId, ...(decision ? { decision } : {})
      })
    }, { kind: 'answer', target: selectedCard.id })
  }, [coordinatorClient, model.currentUserId, model.projectId, run, selectedCard.humanRequest, selectedCard.id])
  const cancelFailedDelivery = useCallback((): Promise<boolean> => {
    if (!workerDelivery?.operationId || selectedCard.assigneeUserId !== model.currentUserId) return Promise.resolve(false)
    const { projectId, taskId, executionId, operationId } = workerDelivery
    return run(async () => {
      const result = await collaborationClient.cancelFailedWorkerDelivery({ projectId, taskId, executionId, operationId })
      acceptWorkerDelivery(result.delivery)
    }, { kind: 'cancel-failed-delivery', target: selectedCard.id })
  }, [acceptWorkerDelivery, collaborationClient, model.currentUserId, run, selectedCard.assigneeUserId, selectedCard.id, workerDelivery])
  const submitDelivery = useCallback((summary: string): Promise<boolean> => {
    if (!workerDelivery?.draft || selectedCard.assigneeUserId !== model.currentUserId) return Promise.resolve(false)
    return run(async () => {
      try {
        const saved = await localDraft.flush(summary)
        const current = (await collaborationClient.readWorkerDelivery({ projectId: saved.projectId, taskId: saved.taskId, executionId: saved.executionId })).delivery
        acceptWorkerDelivery(current)
        if (current.draft?.summary.trim() !== summary.trim()) throw new Error(cw("结果说明有新改动，请检查后再次提交。"))
        if (JSON.stringify(current.draft?.outputs) !== JSON.stringify(saved.draft?.outputs)) throw new Error(cw("文件有新改动，请预览后再次提交。"))
        if (!current.confirmationTarget) throw new Error(cw("请检查结果说明和任务产出后再次提交。"))
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
    // A card whose requirement-module dependency is not adopted cannot be
    // dispatched: the Coordinator rejects it in the same way the card already
    // proves. Never send a call the guard knows will fail.
    if (!model.projectId || !workerUserId || !assignment || selectedCard.blockedByLabel) return
    // A first assignment mints the Cloud Task from the requirements module; a
    // reassignment targets the Task that already exists.
    if (assignment.kind !== 'first' && !selectedCloudTaskId) return
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
        await coordinatorClient.withdrawTaskOffer({ projectId, taskId: selectedCloudTaskId!, taskOfferId: assignment.taskOfferId, reason: '负责人将待接受的派单改派给其他成员。' })
        await coordinatorClient.reassignTaskOffer({ projectId, taskId: selectedCloudTaskId!, previousTaskOfferId: assignment.taskOfferId, workerUserId, offerExpiresAt, nextOutputFileName: null })
      } else {
        await coordinatorClient.reassignTaskOffer({ projectId, taskId: selectedCloudTaskId!, previousTaskOfferId: assignment.previousTaskOfferId, workerUserId, offerExpiresAt, nextOutputFileName: null })
      }
    }, { kind: 'assign', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.assignment, selectedCard.blockedByLabel, selectedCard.id, selectedCloudTaskId])
  const withdrawSelected = useCallback(() => {
    const assignment = selectedCard.assignment
    if (!model.projectId || !selectedCloudTaskId || assignment?.kind !== 'withdraw') return
    const projectId = model.projectId
    void run(() => coordinatorClient.withdrawTaskOffer({ projectId, taskId: selectedCloudTaskId, taskOfferId: assignment.taskOfferId, reason: '负责人撤回了待接受的派单。' }), { kind: 'withdraw', target: selectedCard.id })
  }, [coordinatorClient, model.projectId, run, selectedCard.assignment, selectedCard.id, selectedCloudTaskId])
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
        setCompletionError(/no longer matches|revision|conflict/iu.test(message) ? cw("项目已在其他设备更新，请关闭后重新检查再结项。") : cw('结项失败：{{message}}', { message: collaborationFailure(cause, cw('请稍后重试')).message }))
      } finally { busyRef.current = false; setBusy(false) }
    })()
  }, [coordinatorClient, model.completion.target, refresh])
  /**
   * A discussion is a Cloud activity event on an existing Task. A requirement
   * module that is not dispatched yet has no Task, so the action is unavailable
   * (the drawer explains why) instead of sending an id the contract rejects.
   */
  const publishComment = useCallback((text: string, mentionedUserIds: readonly string[]) => {
    if (!model.projectId || !selectedCloudTaskId) return
    void run(() => collaborationClient.publishComment({ commentId: opaqueId('cmt'), projectId: model.projectId!, taskId: selectedCloudTaskId, text, mentionedUserIds: [...mentionedUserIds] }), { kind: 'comment', target: selectedCard.id })
  }, [collaborationClient, model.projectId, run, selectedCard.id, selectedCloudTaskId])
  const confirmRequirements = useCallback(() => {
    const document = model.project?.requirementsDraft ?? model.project?.confirmedRequirements
    if (!document || !model.projectId) { setRoute('requirements'); return Promise.resolve(false) }
    return run(() => coordinatorClient.confirmRequirements({ projectId: model.projectId!, requirementsDocumentId: document.requirementsDocumentId, expectedProjectRevision: model.project!.project.revision, expectedRequirementsRevision: document.revision, contentDigest: document.contentDigest }), { kind: 'confirm-requirements', target: `requirements:${model.projectId}` })
  }, [coordinatorClient, model.project, model.projectId, run])
  const openDeliveryPreview = useCallback((file: DeliveryFileEntry) => {
    setPageError(null)
    void (async () => {
      try {
        if (!file.descriptor) throw new Error(cw("这份资料尚未封存为交付文件。"))
        if (!resourcePreview) throw new Error(cw("文件预览暂不可用，请稍后重试。"))
        const expected = file.descriptor
        const opened = await coordinatorClient.openDeliveryObject({ deliveryManifestId: expected.deliveryManifestId, objectId: expected.objectId })
        const object = opened.object
        if (object.objectId !== expected.objectId || object.projectId !== expected.projectId || object.sha256 !== expected.sha256 ||
            object.revision !== expected.objectRevision || object.byteCount !== expected.byteCount || object.mediaType !== expected.mediaType) {
          throw new Error(cw("预览文件与已提交快照不一致，请刷新后重试。"))
        }
        if (!resourcePreview.open({ resource: opened.resource, file: { name: file.name, mimeType: file.mediaType, size: file.byteCount } })) {
          throw new Error(cw("文件预览暂不可用，请稍后重试。"))
        }
      } catch (cause) { setPageError(collaborationFailure(cause, cw("交付文件预览失败，请稍后重试。"))) }
    })()
  }, [coordinatorClient, resourcePreview])
  const previewDeliveryFile = useCallback((relativePath: string) => {
    if (!workerDelivery?.draft || selectedCard.assigneeUserId !== model.currentUserId) return
    setAction({ kind: 'preview', target: selectedCard.id }); setPageError(null)
    void (async () => {
      try {
        if (!workspacePreview) throw new Error(cw("文件预览暂不可用"))
        const saved = await localDraft.flush(localDraft.summary ?? workerDelivery.draft!.summary)
        const file = saved.draft?.outputs.find((item) => item.relativePath === relativePath)
        if (!file) throw new Error(cw("文件有新改动，请重新选择后预览。"))
        const session = await collaborationClient.openTaskSession({ projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, executionId: workerDelivery.executionId })
        if (workbench?.openSession) {
          const opened = await openCollaborationTaskSession(workbench, session, { projectId: workerDelivery.projectId, taskId: workerDelivery.taskId, taskReference: selectedCard.reference })
          if (!opened) throw new Error(cw("无法打开任务文件所在的会话，请稍后重试。"))
        }
        workspacePreview.open({ path: file.role === 'declared' ? saved.draft?.declaredMaterial?.relativePath ?? file.relativePath : file.relativePath, sessionId: session.sessionId, mimeType: file.mediaType, kind: 'file', integrity: { algorithm: 'sha256', expectedDigest: file.sha256 } })
      } catch (cause) { setPageError(collaborationFailure(cause, cw("交付文件预览失败"))) }
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
  const copyErrorDetail = useCallback(async () => {
    const detail = pageError?.detail
    if (!detail) return
    await navigator.clipboard?.writeText(detail)
    setCopiedErrorDetail(detail)
  }, [pageError?.detail])

  const requestRenameProject = (projectId: string): void => {
    const project = workspace?.projects.find((entry) => entry.project.projectId === projectId)?.project
    if (project && project.ownerUserId === model.currentUserId) setRenameTarget({ id: projectId, name: project.displayName, revision: project.revision })
  }
  const saveProjectName = (displayName: string): void => {
    if (!renameTarget) return
    void run(() => coordinatorClient.renameProject({ projectId: renameTarget.id, expectedRevision: renameTarget.revision, displayName }), { kind: 'rename-project', target: renameTarget.id }).then((saved) => { if (saved) setRenameTarget(null) })
  }
  const pausableLocalTasks = snapshot?.projects.find((project) => project.projectId === model.projectId)?.tasks.filter((task) => task.workerUserId === model.currentUserId && task.executionMode === 'ai' && task.executionId && task.state === 'running') ?? []
  const revision = selectedTaskView?.delivery?.revisionRequest
  const deliveryDetail: DeliveryDraftData | undefined = workerDelivery ? {
    ...workerDeliveryPresentation(workerDelivery, selectedCard, model.members, selectedDeliveryFiles),
    ...(action?.kind === 'submit-delivery' && action.target === selectedCard.id && error ? { submitError: error } : {}),
    ...(workerDelivery.state !== 'sealed' ? { summary: localDraft.summary ?? '', saveState: localDraft.saveState, saveError: localDraft.saveError,
      additionalFiles: localDraft.selectedMaterials?.flatMap((selected) => {
        const stored = workerDelivery.draft?.outputs.find((file) => file.relativePath === selected.relativePath)
        const file = stored ? { id: stored.relativePath, name: stored.fileName, ...stored } : materialCatalog[workerDelivery.executionId]?.find((entry) => entry.relativePath === selected.relativePath)
        return [file ?? { id: selected.relativePath, name: workspaceAttachmentDisplayName(selected.relativePath), relativePath: selected.relativePath, source: selected.source ?? (selected.relativePath.startsWith('.sciforge/uploads/') ? 'attachment' as const : 'member' as const), mediaType: '', byteCount: 0, unavailable: true }]
      }) ?? [] } : {}),
    ...(selectedTaskView?.delivery?.receipt?.disposition === 'adopted' ? { state: 'adopted' as const } : {}),
    ...(revision ? { revisionRequest: { author: model.project?.memberUsers.find((user) => user.userId === revision.requestedByUserId)?.displayName ?? cw("负责人"), at: revision.requestedAt, instruction: revision.instruction } } : {})
  } : !revisingSubmittedVersion && selectedManifest?.resultRevision && sealedSummaries[selectedManifest.deliveryManifestId] !== undefined ? {
    revision: selectedManifest.resultRevision, summary: sealedSummaries[selectedManifest.deliveryManifestId]!,
    state: selectedTaskView?.delivery?.receipt?.disposition === 'adopted' ? 'adopted' : 'submitted',
    submitter: selectedDeliveryFiles[0]?.submitter ?? selectedCard.assignee ?? cw("成员"), submittedAt: selectedManifest.sealedAt,
    declaredFiles: selectedDeliveryFiles.filter((file) => file.role !== 'member').map((file) => ({ id: file.key, name: file.name, relativePath: file.relativePath ?? '', mediaType: file.mediaType, byteCount: file.byteCount, source: file.source ?? 'unknown' })),
    additionalFiles: selectedDeliveryFiles.filter((file) => file.role === 'member').map((file) => ({ id: file.key, name: file.name, relativePath: file.relativePath ?? '', mediaType: file.mediaType, byteCount: file.byteCount, source: file.source ?? 'unknown' }))
  } : model.currentUserId === model.currentProject.ownerUserId && selectedCard.executionId && (!selectedManifest || revisingSubmittedVersion) ? { revision: (selectedManifest?.resultRevision ?? 0) + 1, summary: '', state: 'ready', declaredFiles: [] } : undefined
  const editableDocument = model.project?.requirementsDraft ?? model.project?.confirmedRequirements
  const editableModule = !selectedCard.cloudTaskId ? editableDocument?.workModules.find((module) => selectedCard.id === `module:${module.planItemId}`) : undefined
  const taskEditor = selectedTaskView && (model.currentUserId === model.currentProject.ownerUserId || model.currentUserId === selectedCard.assigneeUserId) ? <TaskContentEditor key={selectedTaskView.task.taskId} task={selectedTaskView.task} projectStatus={model.project?.project.status} content={selectedTaskView.task} pending={selectedTaskView.task.contentChange} canDecide={Boolean(selectedTaskView.task.contentChange && (selectedTaskView.task.contentChange.proposedByUserId !== model.currentUserId || model.currentProject.ownerUserId === selectedCard.assigneeUserId))} busy={busy} onSave={(content, expectedTaskRevision) => expectedTaskRevision === undefined ? Promise.resolve(false) : run(() => coordinatorClient.updateTaskContent({ taskId: selectedTaskView.task.taskId, expectedTaskRevision, title: content.title, objective: content.objective, completionCriteria: [...content.completionCriteria] }), { kind: 'edit-task', target: selectedCard.id })} onDecide={(decision) => void run(() => coordinatorClient.decideTaskContent({ taskId: selectedTaskView.task.taskId, expectedTaskRevision: selectedTaskView.task.revision, decision }), { kind: 'decide-task-edit', target: selectedCard.id })} /> : editableModule && editableDocument && model.currentUserId === model.currentProject.ownerUserId ? <TaskContentEditor key={`${editableDocument.requirementsDocumentId}:${editableDocument.revision}:${editableModule.planItemId}`} editOutput output={editableModule.output} content={{ title: editableModule.title, objective: editableModule.objective, completionCriteria: editableDocument.acceptanceCriteria.filter((item) => item.target === editableModule.planItemId).map((item) => item.criteria) }} canDecide={false} busy={busy} onDecide={() => {}} onSave={(content) => run(async () => {
    await coordinatorClient.saveRequirementsDraft({ projectId: model.projectId!, expectedProjectRevision: model.project!.project.revision, expectedRequirementsRevision: model.project?.requirementsDraft?.revision ?? 0, goalsDeliverables: editableDocument.goalsDeliverables, inputsBoundaries: editableDocument.inputsBoundaries, workModules: editableDocument.workModules.map((module) => module.planItemId === editableModule.planItemId ? { ...module, title: content.title, objective: content.objective, output: content.output } : module), acceptanceCriteria: [...editableDocument.acceptanceCriteria.filter((item) => item.target !== editableModule.planItemId), ...content.completionCriteria.map((criteria, index) => ({ target: editableModule.planItemId, criteria, evidenceMethod: editableDocument.acceptanceCriteria.filter((item) => item.target === editableModule.planItemId)[index]?.evidenceMethod ?? '负责人检查交付结果' }))] })
    setRoute('requirements')
  }, { kind: 'edit-module', target: selectedCard.id })} /> : undefined
  const taskAction = selectedCardId !== null && action?.target === selectedCardId ? action.kind : undefined
  const taskError = taskAction ? error : null
  // A board-card decision that is not already shown inside the drawer stays by
  // the board, so a failed accept/ignore/reject is never swallowed.
  const boardError = route === 'board' && !taskError &&
    (offerDecisionFromActionKind(action?.kind) !== null || action?.kind === 'offer-accept-all') ? error : null
  const requirementsError = action?.target === `requirements:${model.projectId}` || action?.target === `invitation:${invitationItem?.membershipId}` ? error : null
  const createError = action?.target === 'create-project' ? error : null
  const errorShownInline = Boolean(boardError) || (route === 'board' && selectedCardId !== null && taskError) || (route === 'requirements' && requirementsError) || (newProjectOpen && createError)
  const decisionProjects = route === 'inbox' || route === 'my-work' ? workspace?.projects ?? [] : model.project ? [model.project] : []
  const decisionCards = <DecisionRequests requests={decisionProjects.flatMap(project => project.pendingHumanNeeded).filter(request => selectedCardId === null || request.humanRequestId !== selectedCard.humanRequest?.humanRequestId)} records={decisionProjects.flatMap(project => project.records ?? [])} userId={model.currentUserId} busy={busy}
    onAnswer={(request, answer, decision, selectedOptionId) => run(() => answerReviewedHumanRequest(coordinatorClient, structuredClone(request), model.currentUserId!, answer, decision, selectedOptionId), { kind: 'answer', target: 'page' })}
    onDefer={(request, reason) => run(() => coordinatorClient.deferHumanNeeded({ projectId: request.projectId, humanRequestId: request.humanRequestId, requestRevision: request.revision, reason }), { kind: 'defer-request', target: 'page' })} />
  const content = route === 'research' ? <ResearchView key={model.projectId} model={model} client={coordinatorClient} busy={busy} onSend={(input) => run(() => { if (!workbench) throw new Error(cw("研究会话入口暂不可用。")); return sendResearchQuestion(coordinatorClient, workbench, input) }, { kind: 'research', target: 'page' })} onOpenTask={(card) => { setSelectedCardId(card.id); setRoute('board') }} onPlan={() => selectRoute('requirements')} />
    : route === 'board' ? undefined
    : route === 'requirements' ? <RequirementsView key={`${model.currentUserId}:${model.projectId}:${confirmOnOpen}`} model={model} busy={busy} error={requirementsError} creationNotice={creationRecovery?.createdProjectId === model.projectId ? <ProjectCreationRecoveryNotice recovery={creationRecovery} busy={busy} onRetry={retryCreation} onCreateOther={createOtherProject} /> : undefined} pendingAction={busy ? action?.kind : undefined} invitation={invitationItem} confirmOnOpen={confirmOnOpen} onAcceptInvitation={invitationItem ? () => acceptInvitationItem(invitationItem) : undefined} onOpenModule={openModuleCard} onSave={(goals, inputs, draft) => run(() => coordinatorClient.saveRequirementsDraft({ projectId: model.projectId!, expectedProjectRevision: model.project!.project.revision, expectedRequirementsRevision: draft.expectedRequirementsRevision, goalsDeliverables: goals, inputsBoundaries: inputs, inputReferences: draft.inputReferences, workModules: draft.workModules, acceptanceCriteria: draft.acceptanceCriteria }), { kind: 'save-requirements', target: `requirements:${model.projectId}` })} onComplete={() => void run(() => coordinatorClient.completeRequirements({ projectId: model.projectId!, expectedRequirementsRevision: model.requirements?.revision ?? undefined }), { kind: 'complete-requirements', target: `requirements:${model.projectId}` })} onConfirm={confirmRequirements} />
    : route === 'members' ? <MembersView key={model.projectId} model={model} busy={busy} onAddMember={addMember} onRemoveMember={removeMember} />
    : route === 'info' ? <ProjectInfoView key={model.projectId} model={model} onRename={model.currentUserId === model.currentProject.ownerUserId && model.projectId ? () => requestRenameProject(model.projectId!) : undefined} />
    : route === 'my-work' ? <PersonalList title="我的工作" subtitle={cw("跨所有项目，分配给你和等你处理的任务")} items={model.myWork} loading={!model.loaded} onOpen={openPersonalItem} />
    : route === 'inbox' ? <PersonalList title="收件箱" subtitle={cw("邀请、待接受的任务、Agent 提问和待采纳的交付")} items={model.inbox} loading={!model.loaded} onOpen={openPersonalItem} />
    : <FilesView groups={fileGroups} loading={filesLoading} onPreview={openDeliveryPreview} onOpenTaskDeliveries={() => { setSelectedCardId(null); setRoute('board') }} />
  const projectRoute = route === 'research' || route === 'board' || route === 'members' || route === 'requirements' || route === 'files' || route === 'info'
  const activeRoute = route === 'my-work' || route === 'inbox' ? route : undefined
  const activeTab = route === 'research' ? 'research' : route === 'members' ? 'members' : route === 'requirements' ? 'requirements' : route === 'files' ? 'files' : route === 'info' ? 'info' : 'board'
  return (
    <WorkspaceDocumentContext.Provider value={ownerDocument}>
    <div className={`collaboration-workspace-page${className ? ` ${className}` : ''}`}>
      <CollaborationWorkspaceStructure
        model={model}
        selectedCard={selectedCard}
        busy={busy}
        pendingAction={busy ? taskAction : undefined}
        taskError={taskError}
        taskErrorDetail={taskError ? pageError?.detail : undefined}
        content={route === 'inbox' || route === 'my-work' ? <>{decisionCards}{content}</> : content}
        switching={switchingProjectId !== null}
        diagnosticsScope={active && model.projectId && selectedCloudTaskId && selectedCard.executionId ? JSON.stringify([model.currentUserId, model.projectId, selectedCloudTaskId, selectedCard.executionId]) : undefined}
        onReadDiagnostics={active && model.projectId && selectedCloudTaskId && selectedCard.executionId ? () => collaborationClient.readTaskInteraction({ projectId: model.projectId!, taskId: selectedCloudTaskId, executionId: selectedCard.executionId! }) : undefined}
        showDrawer={projectRoute && route === 'board' && selectedCardId !== null}
        showProjectHeader={projectRoute && model.projectId !== null}
        activeRoute={activeRoute}
        activeTab={activeTab}
        boardCount={pendingAssignmentItems.filter((item) => item.projectId === model.projectId).length}
        boardBusy={busy && (offerDecisionFromActionKind(action?.kind) !== null || action?.kind === 'offer-accept-all')}
        boardBusyCardId={busy ? action?.target ?? null : null}
        boardPendingAction={busy ? action?.kind : undefined}
        boardError={boardError}
        assignmentAlert={pendingAssignmentItems.length > 0 && dismissedAssignmentKey !== pendingAssignmentKey ? {
          count: pendingAssignmentItems.length,
          titles: pendingAssignmentItems.map((item) => item.title),
          canAcceptAll: canAcceptAllAssignments(pendingAssignmentItems),
          busy,
          onView: () => selectRoute('inbox'),
          onAcceptAll: acceptAllAssignments,
          onDismiss: () => setDismissedAssignmentKey(pendingAssignmentKey)
        } : undefined}
        onSelectProject={selectProject}
        onNavigate={selectRoute}
        onTabChange={selectRoute}
        onPrimaryAction={model.completion.target ? () => { setCompletionError(null); setCompleting(true) } : openRequirements}
        onCreateProject={() => setNewProjectOpen(true)}
        projectControls={<>{decisionCards}<ProjectExecutionControls key={model.projectId} model={model} busy={busy} onOpenResearch={() => { const session = model.project?.leaderSession; if (session) void run(async () => { if (!workbench?.openSession || !await workbench.openSession({ ...session, readOnly: true, returnTo: { contributionId: COLLABORATION_MAIN_AREA_CONTRIBUTION.id, label: cw("返回协作项目"), activation: { revision: 1, payload: { projectId: model.projectId!, route } } } })) throw new Error(cw("无法打开 AI 领队会话，请稍后重试。")) }, { kind: 'open-leader-session', target: 'page' }) }} onRetry={() => { if (model.projectId) void run(() => coordinatorClient.retryLeaderProposal({ projectId: model.projectId! }), { kind: 'retry-leader-proposal', target: 'page' }) }} onDefer={(key) => { if (model.projectId) void run(() => coordinatorClient.deferLeaderProposal({ projectId: model.projectId!, key }), { kind: 'defer-leader-proposal', target: 'page' }) }} canPauseLocal={pausableLocalTasks.length > 0} onMode={(mode, pauseLocal) => { const project = model.project?.project; if (project) void run(async () => { await coordinatorClient.setProjectExecutionMode({ projectId: project.projectId, expectedRevision: project.revision, mode }); if (pauseLocal) for (const task of pausableLocalTasks) await collaborationClient.pauseTask({ projectId: project.projectId, taskId: task.taskId, executionId: task.executionId! }) }, { kind: 'project-mode', target: 'page' }) }} onAuthorize={(assignments) => { const project = model.project?.project; const document = model.project?.confirmedRequirements; if (project && document) void run(() => coordinatorClient.authorizeProjectDispatch({ projectId: project.projectId, expectedRevision: project.revision, requirementsDocumentId: document.requirementsDocumentId, requirementsDocumentRevision: document.documentRevision, requirementsContentDigest: document.contentDigest, assignments: [...assignments], expiresAt: new Date(Date.now() + DEFAULT_TASK_OFFER_TTL_MS).toISOString() }), { kind: 'authorize-dispatch', target: 'page' }) }} /></>}
        onRenameProject={requestRenameProject}
        onDeleteProject={requestDeleteProject}
        deletingProjectId={deletingProjectId}
        onSelectCard={selectCard}
        onCloseDrawer={closeDrawer}
        onConnect={connectCollaboration}
        onCopyUserId={copyUserId}
        onAdopt={adoptSelected}
        validationManifest={selectedManifest ?? undefined}
        onValidateDelivery={(spec) => coordinatorClient.validateDelivery(spec)}
        onRequestRevision={requestSelectedRevision}
        onOfferDecision={decideSelectedOffer}
        onCardOfferDecision={decideOffer}
        onHumanAnswer={answerSelectedHumanRequest}
        onHumanDefer={reason => { const request = selectedCard.humanRequest; return request ? run(() => coordinatorClient.deferHumanNeeded({ projectId: request.projectId, humanRequestId: request.humanRequestId, requestRevision: request.revision, reason }), { kind: 'defer-request', target: selectedCard.id }) : Promise.resolve(false) }}
        humanAnswerFeedback={humanAnswerFeedback?.projectId === model.projectId && humanAnswerFeedback?.taskId === selectedCloudTaskId && humanAnswerFeedback?.executionId === selectedCard.executionId && humanAnswerFeedback?.userId === model.currentUserId ? humanAnswerFeedback : undefined}
        onReturnTask={returnSelectedTask}
        relatedChats={selectedCloudTaskId ? <RelatedTaskChats key={`${model.currentUserId}:${selectedCloudTaskId}`} active={active} revision={snapshot?.revision} taskId={selectedCloudTaskId} client={collaborationClient} workbench={workbench} delivery={workerDelivery} /> : undefined}
        taskEditor={taskEditor}
        onStartTask={workerDelivery ? startSelectedTask : undefined}
        onReexecute={workbench?.sendMessage ? reexecuteSelectedTask : undefined}
        onContinueNewSession={workbench?.openSession ? continueInNewSession : undefined}
        onContinueSession={workbench?.openSession ? continueSelectedTask : undefined}
        onCancelFailedDelivery={cancelFailedDelivery}
        onSubmitDelivery={submitDelivery}
        onAssign={assignSelected}
        onWithdraw={withdrawSelected}
        onComment={publishComment}
        activity={activity}
        delivery={workerDelivery}
        deliveryDetail={deliveryDetail}
        materialSelection={materialSelection}
        onDeclaredMaterialChange={(file) => {
          if (!workerDelivery) return
          rememberMaterials(workerDelivery.executionId, [file])
          localDraft.onDeclaredMaterialChange({ relativePath: file.relativePath, ...(file.imported || file.source === 'member' ? { source: 'member' as const } : file.source === 'attachment' ? { source: 'attachment' as const } : {}) })
          if (localDraft.selectedMaterials?.some((material) => material.relativePath === file.relativePath)) localDraft.onMaterialsChange(localDraft.selectedMaterials.filter((material) => material.relativePath !== file.relativePath))
        }}
        onMaterialsChange={changeMaterials}
        onSummaryChange={localDraft.onSummaryChange}
        onAiSummaryDecision={localDraft.onAiSummaryDecision}
        deliveryError={deliveryError ?? (selectedManifest ? sealedSummaryErrors[selectedManifest.deliveryManifestId] : undefined)}
        deliveryFiles={selectedDeliveryFiles}
        onPreviewDraftFile={previewDraftFile}
        onPreviewSealedFile={openDeliveryPreview}
      />
      {error && !errorShownInline ? <div className="collaboration-workspace-page-error" role="alert"><span>{error}</span>{pageError?.detail ? <button type="button" onClick={() => void copyErrorDetail()}>{copiedErrorDetail === pageError.detail ? cw("已复制") : cw("复制错误详情")}</button> : null}<button type="button" onClick={() => void refresh()}>{cw("重试")}</button><button type="button" aria-label={cw("关闭提示")} onClick={() => setPageError(null)}>×</button></div> : null}
      {completing && model.completion.target ? <CompleteProjectDialog projectName={model.currentProject.name} adopted={model.completion.adopted} requirementsVersion={model.currentProject.requirementsRevision} error={completionError} busy={busy} onConfirm={completeProject} onCancel={() => setCompleting(false)} /> : null}
      {newProjectOpen ? <NewProjectDialog busy={busy} waiting={model.connection.waiting} error={createError} recovery={creationRecovery} onRetry={retryCreation} onOpenDraft={openCreatedDraft} onCreateOther={createOtherProject} onSubmit={createProject} onCancel={() => setNewProjectOpen(false)} /> : null}
      {renameTarget ? <RenameProjectDialog key={renameTarget.id} name={renameTarget.name} busy={busy} error={action?.kind === 'rename-project' ? error : null} onSave={saveProjectName} onCancel={() => setRenameTarget(null)} /> : null}
      {deleteTarget ? <ConfirmationDialog title={cw("删除项目")} message={cw('将删除「{{name}}」。删除后该项目及其任务将从你的列表中移除，此操作不可撤销。', { name: deleteTarget.name })} confirmLabel={cw("删除项目")} busy={deletingProjectId !== null} error={deleteError} onConfirm={confirmDeleteProject} onCancel={cancelDeleteProject} /> : null}
    </div>
    </WorkspaceDocumentContext.Provider>
  )
}
