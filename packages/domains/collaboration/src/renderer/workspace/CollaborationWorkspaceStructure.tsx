import React, { type ReactElement, type ReactNode } from 'react'
import { ProjectBoard } from './project-board/ProjectBoard.js'
import { TaskDrawer } from './task-drawer/TaskDrawer.js'
import { ProjectHeader } from './project-header/ProjectHeader.js'
import { ProjectSidebar } from './project-sidebar/ProjectSidebar.js'
import type { TaskCardModel } from './workspace-types.js'
import type { WorkspaceViewModel } from './workspace-view-model.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import type { DeliveryFileEntry } from './files/delivery-files.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './task-drawer/delivery-draft-types.js'

type ProjectTab = 'board' | 'requirements' | 'files' | 'settings'
type PersonalRoute = 'my-work' | 'inbox' | 'settings'

export function CollaborationWorkspaceStructure({ model, selectedCard, busy = false, pendingAction, taskError, content, switching = false, showDrawer, showProjectHeader, activeTab, activeRoute, onSelectProject, onNavigate, onTabChange, onSelectCard, onCreateProject, onAdopt, onRequestRevision, onOfferDecision, onHumanAnswer, onReexecute, onContinueSession, onReturnTask, onSubmitDelivery, onSummaryChange, onMaterialsChange, onAiSummaryDecision, onAssign, onWithdraw, onComment, onCloseDrawer, onPrimaryAction, onConnect, onCopyUserId, activity, delivery, deliveryDetail, materialSelection, onPreviewDraftFile, deliveryError, deliveryFiles, onPreviewDeliveryFile, onPreviewSealedFile }: Readonly<{
  model: WorkspaceViewModel
  selectedCard: TaskCardModel
  busy?: boolean
  pendingAction?: string
  taskError?: string | null
  content?: ReactNode
  /** A newly selected Project is still loading its full facts. */
  switching?: boolean
  showDrawer: boolean
  showProjectHeader: boolean
  activeTab: ProjectTab
  activeRoute?: PersonalRoute
  onSelectProject(projectId: string): void
  onNavigate(route: PersonalRoute): void
  onTabChange(tab: ProjectTab): void
  onSelectCard(card: TaskCardModel): void
  onCreateProject(): void
  onAdopt(): void
  onRequestRevision(instruction: string): Promise<boolean> | void
  onOfferDecision(decision: 'accept' | 'reject'): void
  onHumanAnswer(answer: string): Promise<boolean> | void
  onReexecute?(): void
  onContinueSession?(): void
  onReturnTask?(reason: string): Promise<boolean>
  onSubmitDelivery(summary: string, files: readonly DeliveryDraftFile[]): Promise<boolean> | void
  onSummaryChange?(summary: string): void
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
  const canOpenSettings = model.currentUserId == null || model.currentProject.ownerUserId == null || model.currentUserId === model.currentProject.ownerUserId
  return (
    <div className="collaboration-workspace-structure">
      <ProjectSidebar
        projects={model.projects}
        selectedProjectId={showProjectHeader ? model.selectedProjectId ?? null : null}
        onSelectProject={onSelectProject}
        onNavigate={onNavigate}
        onCreateProject={onCreateProject}
        myWorkCount={model.myWork.length}
        inboxCount={model.inbox.length}
        canOpenSettings={canOpenSettings && model.projectId !== null}
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
            canOpenSettings={canOpenSettings}
            primaryActionLabel={model.currentProject.headerAction}
            progress={model.completion.total ? model.completion : undefined}
            onPrimaryAction={onPrimaryAction}
          />
        ) : null}
        <div className="collaboration-workspace-main-body">
          {switching
            ? <div className="collaboration-workspace-project-loading" role="status" aria-busy="true">正在读取项目…</div>
            : content ?? <ProjectBoard cards={model.cards} selectedCardId={showDrawer ? selectedCard.id : null} onSelectCard={onSelectCard} />}
        </div>
        {showDrawer && !switching ? (
          <TaskDrawer
            key={selectedCard.id}
            card={selectedCard}
            busy={busy}
            pendingAction={pendingAction}
            error={taskError}
            projectName={model.currentProject.name}
            currentUserId={model.currentUserId}
            members={model.members}
            mentionableUsers={model.mentionableUsers}
            activity={activity}
            revisionInstruction={model.project?.tasks.find((entry) => entry.task.taskId === selectedCard.id)?.delivery?.revisionRequest?.instruction}
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
            onRequestRevision={onRequestRevision}
            onOfferDecision={onOfferDecision}
            onHumanAnswer={onHumanAnswer}
            onReturnTask={onReturnTask} onReexecute={onReexecute}
            onContinueSession={onContinueSession}
            onSubmitDelivery={onSubmitDelivery}
            onSummaryChange={onSummaryChange}
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
