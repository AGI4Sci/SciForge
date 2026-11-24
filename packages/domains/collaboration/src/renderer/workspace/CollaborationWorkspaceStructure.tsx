import type { DeliveryValidationProps, ValidationAdoption } from './task-drawer/DeliveryValidationControls.js'
import { useWorkspaceTranslation } from './workspace-i18n.js'
import React, { type ReactElement, type ReactNode } from 'react'
import { ProjectBoard } from './project-board/ProjectBoard.js'
import { TaskDrawer } from './task-drawer/TaskDrawer.js'
import { ProjectHeader, type ProjectTab } from './project-header/ProjectHeader.js'
import { ProjectSidebar } from './project-sidebar/ProjectSidebar.js'
import { AssignmentAlert } from './assignment-alert/AssignmentAlert.js'
import type { HumanDecision, HumanAnswerFeedback } from './human-request-decision.js'
import type { TaskCardModel } from './workspace-types.js'
import type { OfferDecision } from './offer-decisions.js'
import type { WorkspaceViewModel } from './workspace-view-model.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import type { DeliveryFileEntry } from './files/delivery-files.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './task-drawer/delivery-draft-types.js'

type PersonalRoute = 'my-work' | 'inbox'

type AssignmentAlertModel = Readonly<{
  count: number
  titles: readonly string[]
  canAcceptAll: boolean
  busy: boolean
  onView(): void
  onAcceptAll(): void
  onDismiss(): void
}>

export function CollaborationWorkspaceStructure({ model, selectedCard, busy = false, pendingAction, taskError, taskErrorDetail, diagnosticsScope, onReadDiagnostics, content, switching = false, showDrawer, showProjectHeader, activeTab, activeRoute, boardCount = 0, boardBusy = false, boardBusyCardId = null, boardPendingAction, boardError, assignmentAlert, onSelectProject, onNavigate, onTabChange, onSelectCard, onCreateProject, onRenameProject, projectControls, onDeleteProject, deletingProjectId, onAdopt, validationManifest, onValidateDelivery, onRequestRevision, onOfferDecision, onCardOfferDecision, onHumanAnswer, onHumanDefer, humanAnswerFeedback, relatedChats, taskEditor, onStartTask, onReexecute, onContinueNewSession, onContinueSession, onReturnTask, onCancelFailedDelivery, onSubmitDelivery, onSummaryChange, onDeclaredMaterialChange, onMaterialsChange, onAiSummaryDecision, onAssign, onWithdraw, onComment, onCloseDrawer, onPrimaryAction, onConnect, onCopyUserId, activity, delivery, deliveryDetail, materialSelection, onPreviewDraftFile, deliveryError, deliveryFiles, onPreviewDeliveryFile, onPreviewSealedFile }: Readonly<{
  model: WorkspaceViewModel
  selectedCard: TaskCardModel
  busy?: boolean
  pendingAction?: string
  taskError?: string | null
  /** Trimmed original capability message for the 「复制错误详情」 action. */
  taskErrorDetail?: string
  diagnosticsScope?: string
  onReadDiagnostics?: React.ComponentProps<typeof TaskDrawer>['onReadDiagnostics']
  content?: ReactNode
  /** A newly selected Project is still loading its full facts. */
  switching?: boolean
  showDrawer: boolean
  showProjectHeader: boolean
  activeTab: ProjectTab
  activeRoute?: PersonalRoute
  /** Assignments waiting for this User on the board's tab entry. */
  boardCount?: number
  /** An Offer decision is in flight, so every card action waits. */
  boardBusy?: boolean
  boardBusyCardId?: string | null
  boardPendingAction?: string
  boardError?: string | null
  assignmentAlert?: AssignmentAlertModel
  onSelectProject(projectId: string): void
  onNavigate(route: PersonalRoute): void
  onTabChange(tab: ProjectTab): void
  onSelectCard(card: TaskCardModel): void
  onCreateProject(): void
  onRenameProject?(projectId: string): void
  projectControls?: ReactNode
  onDeleteProject?(projectId: string): void
  deletingProjectId?: string | null
  onAdopt(selection?: ValidationAdoption): void
  validationManifest?: DeliveryValidationProps['validationManifest']
  onValidateDelivery?: DeliveryValidationProps['onValidateDelivery']
  onRequestRevision(instruction: string): Promise<boolean> | void
  onOfferDecision(decision: OfferDecision): void
  onCardOfferDecision(card: TaskCardModel, decision: OfferDecision): void
  humanAnswerFeedback?: HumanAnswerFeedback
  onHumanDefer?(reason: string): Promise<boolean> | void
  onHumanAnswer(answer: string, decision?: HumanDecision, selectedOptionId?: string): Promise<boolean> | void
  onContinueNewSession?(reason: string): Promise<string | null>
  relatedChats?: ReactNode
  taskEditor?: ReactNode
  onStartTask?(mode: 'manual' | 'ai'): void
  onReexecute?(): void
  onContinueSession?(): void
  onReturnTask?(reason: string): Promise<boolean>
  onCancelFailedDelivery?(): Promise<boolean>
  onSubmitDelivery(summary: string, files: readonly DeliveryDraftFile[]): Promise<boolean> | void
  onSummaryChange?(summary: string): void
  onDeclaredMaterialChange?(file: DeliveryDraftFile): void
  onMaterialsChange?(files: readonly DeliveryDraftFile[]): void
  onAiSummaryDecision?(decision: 'replace' | 'keep', summary: string): void
  onAssign(userId: string): void
  onWithdraw(): void
  onComment(text: string, mentionedUserIds: readonly string[]): void
  onCloseDrawer(): void
  onPrimaryAction(): void
  onConnect(action: 'configure' | 'connect' | 'recover'): void
  onCopyUserId(): void | Promise<void>
  activity: readonly Readonly<{ actor: string; text: string; time: string; event?: boolean }>[]
  deliveryDetail?: DeliveryDraftData
  materialSelection?: DeliveryMaterialSelection
  onPreviewDraftFile?(file: DeliveryDraftFile): void
  deliveryError?: string
  deliveryFiles?: readonly DeliveryFileEntry[]
  onPreviewDeliveryFile?(name: string): void
  onPreviewSealedFile?(file: DeliveryFileEntry): void
  delivery: WorkerDeliveryView | null
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  // Dispatch is the Owner's authority alone: a Worker must never see these
  // controls, and an unresolved owner is not an Owner.
  const canManage = model.currentUserId !== null && model.currentUserId === model.currentProject.ownerUserId
  return (
    <div className="collaboration-workspace-structure">
      <ProjectSidebar
        projects={model.projects}
        selectedProjectId={showProjectHeader ? model.selectedProjectId ?? null : null}
        onSelectProject={onSelectProject}
        onNavigate={onNavigate}
        onCreateProject={onCreateProject}
        onRenameProject={onRenameProject}
        onDeleteProject={onDeleteProject}
        deletingProjectId={deletingProjectId}
        myWorkCount={model.myWork.length}
        inboxCount={model.inbox.length}
        activeRoute={activeRoute}
        loading={!model.loaded}
        connection={model.connection}
        currentUserId={model.currentUserId}
        onConnect={onConnect}
        onCopyUserId={onCopyUserId}
      />
      <main className="collaboration-workspace-main">
        {showProjectHeader && !switching ? (
          <ProjectHeader
            initials={model.currentProject.initials}
            name={model.currentProject.name}
            memberCount={model.currentProject.memberCount}
            status={model.currentProject.status}
            activeTab={activeTab}
            onTabChange={onTabChange}
            canManage={canManage}
            primaryActionLabel={model.currentProject.headerAction}
            progress={model.completion.total ? model.completion : undefined}
            boardCount={boardCount}
            onPrimaryAction={onPrimaryAction}
          />
        ) : null}
        <div className="collaboration-workspace-main-body">
          {showProjectHeader && !switching ? projectControls : null}
          {assignmentAlert ? <AssignmentAlert {...assignmentAlert} /> : null}
          {switching
            ? <div className="collaboration-workspace-project-loading" role="status" aria-busy="true">{cw('正在读取项目…')}</div>
            : content ?? <ProjectBoard cards={model.cards} selectedCardId={showDrawer ? selectedCard.id : null} busy={boardBusy} busyCardId={boardBusyCardId} pendingAction={boardPendingAction} error={boardError} canAssign={canManage} onSelectCard={onSelectCard} onOfferDecision={onCardOfferDecision} onAssignRequest={onSelectCard} />}
        </div>
        {showDrawer && !switching ? (
          <TaskDrawer
            key={selectedCard.id}
            card={selectedCard}
            busy={busy}
            pendingAction={pendingAction}
            error={taskError}
            errorDetail={taskErrorDetail}
            diagnosticsScope={diagnosticsScope}
            onReadDiagnostics={onReadDiagnostics}
            projectName={model.currentProject.name}
            currentUserId={model.currentUserId}
            members={model.members}
            mentionableUsers={model.mentionableUsers}
            activity={activity}
            revisionInstruction={model.project?.tasks.find((entry) => entry.task.taskId === selectedCard.cloudTaskId)?.delivery?.revisionRequest?.instruction}
            delivery={delivery}
            deliveryDetail={deliveryDetail}
            materialSelection={materialSelection}
            onPreviewDraftFile={onPreviewDraftFile}
            deliveryError={deliveryError}
            deliveryFiles={deliveryFiles}
            onPreviewDeliveryFile={onPreviewDeliveryFile}
            onPreviewSealedFile={onPreviewSealedFile}
            onClose={onCloseDrawer}
            onAdopt={onAdopt}
            validationManifest={validationManifest}
            onValidateDelivery={onValidateDelivery}
            onRequestRevision={onRequestRevision}
            onOfferDecision={onOfferDecision}
            onHumanAnswer={onHumanAnswer}
            onHumanDefer={onHumanDefer}
            humanAnswerFeedback={humanAnswerFeedback}
            relatedChats={relatedChats}
            taskEditor={taskEditor}
            onStartTask={onStartTask}
            onReturnTask={onReturnTask} onReexecute={onReexecute} onContinueNewSession={onContinueNewSession}
            onContinueSession={onContinueSession}
            onCancelFailedDelivery={onCancelFailedDelivery}
            onSubmitDelivery={onSubmitDelivery}
            onSummaryChange={onSummaryChange}
            onDeclaredMaterialChange={onDeclaredMaterialChange}
            onMaterialsChange={onMaterialsChange}
            onAiSummaryDecision={onAiSummaryDecision}
            onAssign={onAssign}
            onWithdraw={onWithdraw}
            onComment={onComment}
          />
        ) : null}
      </main>
    </div>
  )
}
