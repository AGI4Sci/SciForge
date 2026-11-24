import { DeliveryValidationControls, type DeliveryValidationProps, type ValidationAdoption } from './DeliveryValidationControls.js'
import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CalendarDays, Check, ChevronDown, Copy, Maximize2, Minimize2, UserRound, X } from 'lucide-react'
import { deliveryRevisionRequestSchema } from '@sciforge/collaboration-contracts'
import type { BoardColumnId, TaskAssignmentModel, TaskCardModel } from '../workspace-types.js'
import type { WorkerDeliveryView } from '../../../worker-delivery.js'
import type { DeliveryFileEntry } from '../files/delivery-files.js'
import { stateTone } from '../task-card/TaskCard.js'
import { collaborationTaskReturnInputSchema } from '../../../contract.js'
import { offerAvailabilityPresentation } from '../offer-availability.js'
import { offerActions, offerDecisionActionKind, offerDecisionBusyLabel, type OfferDecision } from '../offer-decisions.js'
import { DeliveryDraft } from './DeliveryDraft.js'
import { DeliveryContent } from './DeliveryContent.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './delivery-draft-types.js'
import { formatBytes } from '../files/format-bytes.js'
import { HumanRequestForm } from './HumanRequestForm.js'
import type { HumanDecision, HumanAnswerFeedback } from '../human-request-decision.js'
import { workerDeliveryPresentation } from './worker-delivery-presentation.js'
import { collaborationFailure } from '../collaboration-errors.js'
import type { CollaborationRendererClient } from '../../collaboration-capability-client.js'
import { useWorkspaceDocument } from '../workspace-document.js'
import { TaskDiscussionComposer, type TaskDiscussionMentionableUser } from './TaskDiscussionComposer.js'

type ActivityItem = Readonly<{ actor: string; text: string; time: string; event?: boolean }>

const columnLabels: Readonly<Record<BoardColumnId, string>> = {
  intake: '收集箱', ready: '待开始', 'in-progress': '进行中', review: '待确认', completed: '已完成',
}

export function TaskDrawer({ card, projectName, busy = false, pendingAction, error, errorDetail, diagnosticsScope, onReadDiagnostics, currentUserId, members = [], mentionableUsers = [], activity = [], revisionInstruction, delivery, deliveryDetail, materialSelection, onPreviewDraftFile, deliveryError, deliveryFiles = [], onPreviewDeliveryFile, onPreviewSealedFile, onClose, onAdopt, validationManifest, onValidateDelivery, onRequestRevision, onOfferDecision, onHumanAnswer, onHumanDefer, humanAnswerFeedback, relatedChats, taskEditor, onStartTask, onReexecute, onContinueNewSession, onContinueSession, onReturnTask, onCancelFailedDelivery, onSubmitDelivery, onSummaryChange, onDeclaredMaterialChange, onMaterialsChange, onAiSummaryDecision, onAssign, onWithdraw, onComment }: Readonly<{
  card: TaskCardModel
  busy?: boolean
  pendingAction?: string
  error?: string | null
  /** Trimmed original capability message for the 「复制错误详情」 action. */
  errorDetail?: string
  diagnosticsScope?: string
  onReadDiagnostics?(): ReturnType<CollaborationRendererClient['readTaskInteraction']>
  projectName: string
  currentUserId?: string | null
  members?: readonly Readonly<{ userId: string; name: string; role: string; state?: string }>[]
  mentionableUsers?: readonly TaskDiscussionMentionableUser[]
  activity?: readonly ActivityItem[]
  revisionInstruction?: string
  delivery?: WorkerDeliveryView | null
  deliveryDetail?: DeliveryDraftData
  materialSelection?: DeliveryMaterialSelection
  onPreviewDraftFile?(file: DeliveryDraftFile): void
  deliveryError?: string
  /** Sealed Delivery files readable in this page, independent of any local Session. */
  deliveryFiles?: readonly DeliveryFileEntry[]
  onPreviewDeliveryFile?(name: string): void
  onPreviewSealedFile?(file: DeliveryFileEntry): void
  onClose?(): void
  onAdopt?(selection?: ValidationAdoption): void
  validationManifest?: DeliveryValidationProps['validationManifest']
  onValidateDelivery?: DeliveryValidationProps['onValidateDelivery']
  onRequestRevision?(instruction: string): Promise<boolean> | void
  onOfferDecision?(decision: OfferDecision): void
  humanAnswerFeedback?: HumanAnswerFeedback
  onHumanDefer?(reason: string): Promise<boolean> | void
  onHumanAnswer?(answer: string, decision?: HumanDecision, selectedOptionId?: string): Promise<boolean> | void
  onContinueNewSession?(reason: string): Promise<string | null>
  relatedChats?: ReactNode
  taskEditor?: ReactNode
  onStartTask?(mode: 'manual' | 'ai'): void
  onReexecute?(): void
  onContinueSession?(): void
  onReturnTask?(reason: string): Promise<boolean>
  onCancelFailedDelivery?(): Promise<boolean>
  onSubmitDelivery?(summary: string, files: readonly DeliveryDraftFile[]): Promise<boolean> | void
  onSummaryChange?(summary: string): void
  onDeclaredMaterialChange?(file: DeliveryDraftFile): void
  onMaterialsChange?(files: readonly DeliveryDraftFile[]): void
  onAiSummaryDecision?(decision: 'replace' | 'keep', summary: string): void
  onAssign?(userId: string): void
  onWithdraw?(): void
  onComment?(text: string, mentionedUserIds: readonly string[]): void
}>): ReactElement {
  useWorkspaceTranslation()
  const [validationRequired, setValidationRequired] = useState(false)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const validInstruction = deliveryRevisionRequestSchema.shape.instruction.safeParse(instruction).success
  const sendRevision = async () => {
    if (busy || !validInstruction) return
    if (await onRequestRevision?.(instruction.trim()) === false) return
    setRevisionOpen(false)
    setInstruction('')
  }
  const [cancelFailedOpen, setCancelFailedOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const validReturnReason = collaborationTaskReturnInputSchema.shape.reason.safeParse(returnReason).success
  const confirmReturn = async (): Promise<void> => {
    if (busy || !validReturnReason || !onReturnTask) return
    if (!await onReturnTask(returnReason.trim())) return
    setReturnOpen(false)
    setReturnReason('')
  }
  const [expanded, setExpanded] = useState(false)
  const document = useWorkspaceDocument()
  const drawer = useRef<HTMLElement>(null)
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    drawer.current?.querySelector<HTMLButtonElement>('[data-testid="task-drawer-close"]')?.focus()
    return () => { if (trigger?.isConnected) trigger.focus() }
  }, [card.id, document])
  const [copied, setCopied] = useState(false)
  const [copiedError, setCopiedError] = useState(false)
  // One mapping for every capability failure: the page already passes the
  // mapped message, but a drawer rendered on its own must not leak envelopes.
  const failure = error ? collaborationFailure(error) : null
  const failureDetail = errorDetail ?? failure?.detail
  const copyFailureDetail = (): void => {
    if (!failureDetail) return
    void navigator.clipboard?.writeText(failureDetail)
    setCopiedError(true)
    window.setTimeout(() => setCopiedError(false), 1500)
  }
  useEffect(() => {
    if (!onClose) return
    const window = document.defaultView!
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, document])
  const isOwner = Boolean(currentUserId && members.some((member) => member.userId === currentUserId && member.role === '所有者'))
  const isAssignedWorker = Boolean(currentUserId && card.assigneeUserId === currentUserId)
  const localDraft = delivery?.draft
  // The Owner may hold a pending Offer themselves and still need to hand it to
  // another eligible Member: accepting is a personal decision, reassigning is
  // an authority decision, so both stay available on the same card.
  const assignment = card.assignment
  const assignmentBand = isOwner && assignment
    ? <AssignmentBand assignment={assignment} blockedByLabel={card.blockedByLabel} members={members.filter((member) => (assignment.kind !== 'withdraw' || member.userId !== assignment.workerUserId) && (member.state === undefined || member.state === 'active') && (card.assignableWorkerUserIds === undefined || card.assignableWorkerUserIds.includes(member.userId)))} busy={busy} pendingAction={pendingAction} onAssign={onAssign} onWithdraw={onWithdraw} />
    : null
  const offerAvailability = card.offerAvailability
  const offerPresentation = offerAvailability ? offerAvailabilityPresentation(offerAvailability) : undefined
  // The board card and this band render the very same gate; neither invents a permission.
  const offerActionsForCard = offerAvailability && card.offerId ? offerActions(offerAvailability) : []
  const offerBand = offerAvailability && offerPresentation && isAssignedWorker
    ? <ActionBand title={offerAvailability.canAccept ? cw("这项任务分配给你") : cw(offerPresentation.label)} body={cw(offerPresentation.detail)}>{offerActionsForCard.map((action) => <button key={action.decision} type="button" data-decision={action.decision} className={action.tone === 'primary' ? 'collaboration-workspace-button-primary' : 'collaboration-workspace-button-secondary'} disabled={busy} onClick={() => onOfferDecision?.(action.decision)}>{busy && pendingAction === offerDecisionActionKind(action.decision) ? offerDecisionBusyLabel(action.decision) : cw(action.detailLabel)}</button>)}</ActionBand>
    : null
  const deliverySubmitted = deliveryDetail?.state === 'submitted' || deliveryDetail?.state === 'adopted' || delivery?.state === 'sealed'
  const showDeliveryDraft = (isAssignedWorker && Boolean(deliveryDetail || localDraft || card.executionFailure)) || (isOwner && deliverySubmitted && Boolean(deliveryDetail))
  const activeExecution = Boolean(card.executionId && ['accepted_awaiting_runtime', 'running', 'needs_human'].includes(card.executionState ?? '') && (!delivery || delivery.executionId === card.executionId))
  const canWork = isAssignedWorker && activeExecution
  const draftData = deliveryDetail ?? workerDeliveryPresentation(delivery, card, members, deliveryFiles)
  const ownerPreparing = isOwner && !isAssignedWorker && !deliverySubmitted && card.stateLabel !== '待你采纳' && Boolean(card.executionId)
  const failedRecovery = canWork && delivery?.canCancelFailedSubmission && onCancelFailedDelivery
    ? <div data-testid="delivery-failed-recovery">
        {cancelFailedOpen ? <>
          <p>{cw("撤回后可修改草稿或退回任务。原冻结快照、确认凭证和上传记录将保留；再次提交需要重新确认。")}</p>
          <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-failed-cancel-confirm" disabled={busy} onClick={() => { void onCancelFailedDelivery().then(ok => { if (ok) setCancelFailedOpen(false) }) }}>{cw("确认撤回失败提交")}</button>
          <button type="button" className="collaboration-workspace-button-ghost" disabled={busy} onClick={() => setCancelFailedOpen(false)}>{cw("取消")}</button>
        </> : <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-failed-cancel-open" disabled={busy} onClick={() => setCancelFailedOpen(true)}>{cw("撤回失败提交并继续编辑")}</button>}
      </div> : null
  const returnControls = canWork && card.canReturnExecution && onReturnTask && !deliverySubmitted
    ? <details className="collaboration-workspace-delivery-return" data-testid="delivery-return"><summary>{cw("遇到问题？退回任务")}</summary>
        {returnOpen ? <div className="collaboration-workspace-delivery-return-form" data-testid="delivery-return-form">
          <p>{cw("退回会终止本机执行，由系统尝试重新派发；无法自动改派时交由负责人处理。")}</p>
          <label className="collaboration-workspace-revision-input">{cw("退回原因")}<textarea aria-label={cw("退回原因")} data-testid="delivery-return-reason" required maxLength={500} rows={3} disabled={busy} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder={cw("请说明无法完成的原因")} /></label>
          <div className="collaboration-workspace-delivery-actions">
            <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-return-confirm" disabled={busy || !validReturnReason} onClick={() => void confirmReturn()}>{busy && pendingAction === 'return-task' ? cw("处理中…") : cw("确认退回任务")}</button>
            <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-return-cancel" disabled={busy} onClick={() => setReturnOpen(false)}>{cw("取消")}</button>
          </div>
        </div> : <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-return-open" disabled={busy} onClick={() => setReturnOpen(true)}>{cw("无法完成，退回任务")}</button>}
      </details>
    : null
  const draft = showDeliveryDraft && !deliverySubmitted && !activeExecution ? <section className="collaboration-workspace-delivery-draft" data-testid="delivery-ended-draft" aria-label={cw("历史草稿")}>
    <h3>{cw("历史草稿 · 只读")}</h3><p role="status">{cw("原执行已结束，不能继续执行或提交。请等待负责人重新派发，并接受新的任务要求。")}</p>
    <h4>{cw("结果说明")}</h4><p>{draftData.summary || cw("尚未填写结果说明")}</p>
    <DeliveryContent declaredFiles={draftData.declaredFiles} additionalFiles={draftData.additionalFiles} showAdditional readOnly onPreview={onPreviewDraftFile} />
  </section> : showDeliveryDraft ? <DeliveryDraft
    key={`${card.executionId}:${draftData.revision}`}
    data={draftData}
    busy={busy}
    materialSelection={materialSelection}
    returnControls={<>{failedRecovery}{returnControls}</>}
    onPreview={onPreviewDraftFile ?? ((file) => {
      if (deliverySubmitted) {
        const sealed = deliveryFiles.find((entry) => entry.name === file.name)
        if (sealed) onPreviewSealedFile?.(sealed)
      } else onPreviewDeliveryFile?.(file.name)
    })}
    onReexecute={canWork && card.executionFailure?.reexecutionInputId ? onReexecute : undefined}
    onContinueNew={canWork ? onContinueNewSession : undefined}
    onContinue={canWork ? onContinueSession : undefined}
    onSubmit={canWork ? onSubmitDelivery : undefined}
    onSummaryChange={canWork ? onSummaryChange : undefined}
    onDeclaredMaterialChange={canWork ? onDeclaredMaterialChange : undefined}
    onMaterialsChange={canWork ? onMaterialsChange : undefined}
    onAiSummaryDecision={canWork ? onAiSummaryDecision : undefined}
  /> : ownerPreparing ? <section className="collaboration-workspace-delivery-draft" data-testid="delivery-owner-preparing" aria-label={cw("交付进度")}><p role="status">{cw("成员正在准备交付")}{deliveryDetail ? cw("（第 {{value0}} 版）", { value0: deliveryDetail.revision }) : ''}</p></section> : null
  const action = offerBand
    ? <>{offerBand}{assignmentBand}</>
    : card.humanRequest && activeExecution
      ? <HumanRequestForm key={`${card.humanRequest.humanRequestId}:${card.humanRequest.revision}:${card.humanRequest.confirmableAction?.actionDigest ?? ''}:${currentUserId}`} request={card.humanRequest} currentUserId={currentUserId} targetName={members.find(member => member.userId === card.humanRequest?.targetUserId)?.name} busy={busy} onAnswer={onHumanAnswer} onDefer={onHumanDefer} />
        : card.stateLabel === '待你采纳' && isOwner
          ? <ActionBand title={cw("交付等待你确认")} body={cw("成员已提交交付。采纳后任务完成；不满意可以要求返修。")}>
            {!showDeliveryDraft ? <FileList files={deliveryFiles} onPreview={onPreviewSealedFile} /> : null}
            {revisionOpen ? <>
              <label className="collaboration-workspace-revision-input">{cw("返修意见")}<textarea aria-label={cw("返修意见")} required maxLength={deliveryRevisionRequestSchema.shape.instruction.maxLength ?? undefined} rows={4} disabled={busy} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={cw("请说明需要修改的内容和验收要求")} />
              </label>
              <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !validInstruction} onClick={() => void sendRevision()}>{busy && pendingAction === 'revision' ? cw("处理中…") : cw("发送返修要求")}</button>
              <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => { setRevisionOpen(false); setInstruction('') }}>{cw("取消")}</button>
            </> : <>
              <DeliveryValidationControls key={`${card.id}:${currentUserId}:${JSON.stringify(validationManifest)}`} validationManifest={validationManifest} onValidateDelivery={onValidateDelivery} busy={busy} adopting={busy && pendingAction === 'adopt'} onAdopt={onAdopt} required={validationRequired} onRequiredChange={setValidationRequired} />
              <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => setRevisionOpen(true)}>{cw("要求返修")}</button>
            </>}
          </ActionBand>
          : assignmentBand
  const copyReference = () => {
    void navigator.clipboard?.writeText(card.cloudTaskId ?? `${projectName} ${card.reference} ${card.title}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <aside ref={drawer} className={`collaboration-workspace-task-drawer${expanded ? ' is-expanded' : ''}`} aria-label={cw("任务详情")} aria-busy={busy}>
      <header className="collaboration-workspace-task-drawer-header">
        <span className="collaboration-workspace-task-drawer-breadcrumb"><span>{projectName}</span><span aria-hidden="true">/</span><b>{card.reference}</b></span>
        <div>
          <button type="button" aria-label={copied ? cw("已复制") : cw("复制")} title={copied ? cw("已复制") : card.cloudTaskId ? cw("复制任务 ID") : cw("复制模块引用")} onClick={copyReference}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button>
          <button type="button" aria-label={expanded ? cw("收起") : cw("展开")} title={expanded ? cw("收起") : cw("展开")} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
          <button type="button" data-testid="task-drawer-close" aria-label={cw("关闭")} title={cw("关闭（Esc）")} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div className="collaboration-workspace-task-drawer-content">
        <p className="collaboration-workspace-task-drawer-eyebrow">{card.moduleType}</p>
        <h2>{card.title}</h2>
        {card.description ? <p className="collaboration-workspace-task-drawer-description">{card.description}</p> : null}
        {!card.cloudTaskId ? <p className="collaboration-workspace-empty-copy">{cw("此模块尚未派发，暂不能在聊天中 @ 引用；派发后可复制任务 ID。")}</p> : null}
        {relatedChats}
        {taskEditor}
        <dl className="collaboration-workspace-task-drawer-properties">
          <div><dt>{cw("状态")}</dt><dd><span className={`collaboration-workspace-property-chip status-${card.status}`}><span className="collaboration-workspace-board-column-dot" aria-hidden="true" />{deliverySubmitted ? draftData.state === 'adopted' ? cw("已完成") : cw("待负责人采纳") : cw(columnLabels[card.status])}</span>{card.stateLabel && !(showDeliveryDraft && deliverySubmitted) ? <span className={`collaboration-workspace-task-card-state ${card.executionFailure ? 'tone-warning' : showDeliveryDraft ? 'tone-neutral' : stateTone(card.stateLabel)}`}>{cw(card.stateLabel)}</span> : null}</dd></div>
          <div><dt>{cw("负责人")}</dt><dd><span className="collaboration-workspace-property-chip"><UserRound aria-hidden="true" />{card.assignee ?? cw("待分配")}</span></dd></div>
          <div><dt>{cw("时间")}</dt><dd><span className="collaboration-workspace-property-chip"><CalendarDays aria-hidden="true" />{card.date}</span></dd></div>
        </dl>
        {card.blockedByLabel ? <p className="collaboration-workspace-task-card-state tone-warning">{card.blockedByLabel}</p> : null}
        {revisionInstruction && !deliveryDetail?.revisionRequest ? <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label={cw("负责人返修意见")}><strong>{cw("负责人返修意见")}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{revisionInstruction}</p></section> : null}
        {canWork && delivery && !deliverySubmitted && !card.executionFailure && draftData.state === 'ready' && !draftData.source && onStartTask ? <ActionBand title={cw("选择完成方式")} body={cw("任务已接受。你可以直接填写交付草稿，或授权 AI 开始执行；提交前由你确认。")}>
          <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => onStartTask('manual')}>{cw("自己完成")}</button>
          {onContinueSession ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onContinueSession}>{cw("与 AI 一起完成")}</button> : null}
          <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={() => onStartTask('ai')}>{cw("授权 AI 开始")}</button>
        </ActionBand> : null}
        {delivery?.followup?.state === 'cancelled' ? <section role="status" className="collaboration-workspace-task-drawer-action"><strong>{cw("复查已取消")}</strong><p>{delivery.followup.reason}</p></section> : null}
        {delivery?.followup && ['waiting', 'dispatching', 'unknown'].includes(delivery.followup.state) ? <section className="collaboration-workspace-delivery-draft" data-testid="task-followup" aria-label={cw("任务复查")}>
          <h3>{delivery.followup.state === 'waiting' ? cw("等待到期复查") : delivery.followup.state === 'unknown' ? cw("复查结果待核实") : cw("正在核对复查结果")}</h3>
          <p>{cw("约定时间：")}{new Date(delivery.followup.at).toLocaleString()}</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{delivery.followup.about}</p>
          <p role="status">{delivery.followup.reason ?? cw("等待期间不启动模型轮次；到期后重新核对权限。这不代表任务或科学验收已完成。")}</p>
          {onContinueSession ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onContinueSession}>{cw("查看任务会话")}</button> : null}
          {returnControls}
        </section> : draft}
        {action}
        {humanAnswerFeedback && !card.humanRequest ? <section className="collaboration-workspace-task-drawer-action" aria-label={cw("决定后进度")}>
          <strong>{humanAnswerFeedback.decision === 'approve' ? cw("已批准该动作") : humanAnswerFeedback.decision === 'reject' ? cw("已拒绝该动作") : cw("回答已记录")}</strong>
          <p role="status">{cw("决定已记录。")}{card.executionState === 'running' ? cw("Agent 执行中，请查看任务进度；这不代表动作已经完成。") : card.executionState === 'completed' ? cw("任务执行已结束，请查看交付结果。") : ['failed', 'cancelled', 'manual_recovery_required'].includes(card.executionState ?? '') ? cw("任务暂未继续或已停止，请查看当前状态和处理原因。") : cw("正在等待 Agent 接收或更新执行状态，请稍后刷新。")}</p>
          {isAssignedWorker && onContinueSession ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onContinueSession}>{cw("查看任务会话")}</button> : null}
        </section> : null}
        {!showDeliveryDraft ? returnControls : null}
        {failure || deliveryError || delivery?.error ? <div className="collaboration-workspace-task-drawer-error">
          <p role="alert">{failure?.message ?? deliveryError ?? delivery?.error}</p>
          {failureDetail && failure ? <button type="button" className="collaboration-workspace-button-ghost" onClick={copyFailureDetail}>{copiedError ? cw("已复制") : cw("复制错误详情")}</button> : null}
        </div> : null}
        {diagnosticsScope && onReadDiagnostics ? <TaskRuntimeDiagnostics key={diagnosticsScope} onRead={onReadDiagnostics} failureCode={card.executionFailure?.code} /> : null}
        <section className="collaboration-workspace-task-drawer-activity" aria-label={cw("动态")}>
          <h3>{cw("动态")}</h3>
          {activity.length ? (
            <ol>
              {activity.map((item, index) => item.event
                ? <li className="is-event" key={`${item.time}:${index}`}><span className="collaboration-workspace-activity-event-dot" aria-hidden="true" /><p>{item.text}</p><time>{item.time}</time></li>
                : <li key={`${item.time}:${index}`}><span className="collaboration-workspace-avatar" aria-hidden="true">{item.actor.slice(0, 1)}</span><div><strong>{item.actor}<time>{item.time}</time></strong><p>{item.text}</p></div></li>)}
            </ol>
          ) : <p className="collaboration-workspace-empty-copy">{cw("还没有动态。派单、接受、交付和讨论都会记录在这里。")}</p>}
        </section>
      </div>
      <TaskDiscussionComposer key={card.cloudTaskId ?? card.id} cloudTaskId={card.cloudTaskId} busy={busy} mentionableUsers={mentionableUsers} onComment={onComment} />
    </aside>
  )
}

function ActionBand({ tone = 'accent', title, body, note, children }: Readonly<{ tone?: 'accent' | 'warning'; title: string; body: string; note?: string; children?: ReactNode }>): ReactElement {
  useWorkspaceTranslation()
  return (
    <section className={`collaboration-workspace-task-drawer-action tone-${tone}`} aria-label={title}>
      <strong>{title}</strong>
      {body ? <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p> : null}
      {note ? <p className="collaboration-workspace-task-drawer-action-note" role="status">{note}</p> : null}
      {children ? <div className="collaboration-workspace-task-drawer-action-controls">{children}</div> : null}
    </section>
  )
}

function AssignmentBand({ assignment, blockedByLabel, members, busy, pendingAction, onAssign, onWithdraw }: Readonly<{ busy: boolean; pendingAction?: string; assignment: TaskAssignmentModel; blockedByLabel?: string; members: readonly Readonly<{ userId: string; name: string }>[]; onAssign?(userId: string): void; onWithdraw?(): void }>): ReactElement {
  useWorkspaceTranslation()
  const [workerUserId, setWorkerUserId] = useState('')
  // The board card already proves the requirement-module dependency state.
  // Handing work out while a dependency is unfinished can only fail in the
  // Coordinator, so the control stays visible but cannot be sent.
  const dependencyNote = blockedByLabel ? cw("依赖未完成：{{value0}}后才能派发", { value0: blockedByLabel }) : undefined
  const dispatchBlocked = Boolean(dependencyNote)
  const dispatch = (): void => {
    if (dispatchBlocked || busy || !workerUserId) return
    onAssign?.(workerUserId)
  }
  if (assignment.kind === 'withdraw') {
    return (
      <ActionBand title={cw("当前派单待接受")} body={cw("已派给 {{value0}}，{{value1}} 前有效。接受前可以改派给其他成员；改派会先撤回当前派单。", { value0: assignment.workerName, value1: assignment.expiresAt })} note={dependencyNote}>
        <label className="collaboration-workspace-select">
          <span className="collaboration-workspace-visually-hidden">{cw("改派给")}</span>
          <select disabled={busy} value={workerUserId} onChange={(event) => setWorkerUserId(event.target.value)}>
            <option value="">{cw("选择成员")}</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <button type="button" className="collaboration-workspace-button-primary" disabled={busy || dispatchBlocked || !workerUserId} onClick={dispatch}>{busy && pendingAction === 'assign' ? cw("处理中…") : cw("改派")}</button>
        <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onWithdraw}>{busy && pendingAction === 'withdraw' ? cw("处理中…") : cw("撤回派单")}</button>
      </ActionBand>
    )
  }
  const first = assignment.kind === 'first'
  return (
    <ActionBand tone={first ? 'accent' : 'warning'} title={first ? cw("为这个模块选择执行人") : cw("任务需要重新派发")} body={first ? cw("选择成员后派发，对方接受后选择自己完成、与 AI 协作或授权 AI 执行。") : cw("{{value0}}，请选择新的执行人。", { value0: assignment.reason })} note={dependencyNote}>
      <label className="collaboration-workspace-select">
        <span className="collaboration-workspace-visually-hidden">{cw("执行人")}</span>
        <select disabled={busy} value={workerUserId} onChange={(event) => setWorkerUserId(event.target.value)}>
          <option value="">{cw("选择成员")}</option>
          {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy || dispatchBlocked || !workerUserId} onClick={dispatch}>{busy && pendingAction === 'assign' ? cw("处理中…") : first ? cw("派发任务") : cw("重新派发")}</button>
    </ActionBand>
  )
}

function FileList<File extends Readonly<{ name: string; mediaType: string; byteCount: number; key?: string }>>({ files, onPreview, required = false }: Readonly<{ required?: boolean; onPreview?(file: File): void; files: readonly File[] }>): ReactElement | null {
  useWorkspaceTranslation()
  if (!files.length) return null
  return <ul className="collaboration-workspace-delivery-files">{files.map((file) => <li key={file.key ?? file.name} data-testid="delivery-file-row"><strong>{file.name}{required ? <span className="collaboration-workspace-delivery-required" data-testid="delivery-file-required">{cw("必交")}</span> : null}</strong><small>{file.mediaType} · {formatBytes(file.byteCount)}</small>{onPreview ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-preview" aria-label={cw("预览 {{value0}}", { value0: file.name })} onClick={() => onPreview(file)}>{cw("预览")}{' '}{file.name}</button> : null}</li>)}</ul>
}

function TaskRuntimeDiagnostics({ onRead, failureCode }: Readonly<{
  onRead(): ReturnType<CollaborationRendererClient['readTaskInteraction']>
  failureCode?: string
}>): ReactElement {
  const [view, setView] = useState<Awaited<ReturnType<CollaborationRendererClient['readTaskInteraction']>>['view']>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const lifetime = useRef(true)
  useEffect(() => { lifetime.current = true; return () => { lifetime.current = false } }, [])
  const read = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    setError(undefined)
    try {
      const result = await onRead()
      if (lifetime.current) setView(result.view)
    } catch (cause) {
      if (lifetime.current) setError(collaborationFailure(cause).message)
    } finally {
      if (lifetime.current) setLoading(false)
    }
  }
  const diagnostics = view?.runtimeDiagnostics
  return <section aria-label={cw('执行技术详情')} data-testid="task-runtime-diagnostics">
    <button type="button" className="collaboration-workspace-button-ghost" disabled={loading} onClick={() => void read()}>{loading ? cw('正在读取执行详情…') : cw('读取执行技术详情')}</button>
    {error ? <p role="alert">{error}</p> : null}
    {view ? <details open>
      <summary>{cw('执行技术详情')}</summary>
      {failureCode ? <p>{cw('失败代码')}：<code>{failureCode}</code></p> : null}
      <p>{cw('本机记录仅覆盖当前任务执行；未包含的记录不代表不存在。')}</p>
      {diagnostics ? <>
        <p>{cw('记录覆盖：{{included}} / {{total}}；省略 {{omitted}}；截断 {{truncated}}。', { included: diagnostics.coverage.included, total: diagnostics.coverage.total, omitted: diagnostics.coverage.omitted, truncated: diagnostics.coverage.truncated })}</p>
        {diagnostics.agentJournal.length ? diagnostics.agentJournal.map((entry) => <pre key={entry.logicalInvocationId} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(entry, null, 2)}</pre>) : <p>{cw('没有本机执行日志。')}</p>}
      </> : <p>{cw('没有本机执行日志。')}</p>}
    </details> : null}
  </section>
}
