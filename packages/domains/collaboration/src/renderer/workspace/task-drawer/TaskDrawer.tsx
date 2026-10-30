import React, { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { CalendarDays, Check, ChevronDown, Copy, Maximize2, Minimize2, Send, UserRound, X } from 'lucide-react'
import { deliveryRevisionRequestSchema } from '@sciforge/collaboration-contracts'
import type { BoardColumnId, TaskAssignmentModel, TaskCardModel } from '../workspace-types.js'
import type { WorkerDeliveryView } from '../../../worker-delivery.js'
import type { DeliveryFileEntry } from '../files/delivery-files.js'
import { stateTone } from '../task-card/TaskCard.js'
import { collaborationTaskReturnInputSchema } from '../../../contract.js'
import { offerAvailabilityPresentation } from '../offer-availability.js'
import { DeliveryDraft } from './DeliveryDraft.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryMaterialSelection } from './delivery-draft-types.js'
import { formatBytes } from '../files/format-bytes.js'
import { workerDeliveryPresentation } from './worker-delivery-presentation.js'

type ActivityItem = Readonly<{ actor: string; text: string; time: string; event?: boolean }>
type MentionableUser = Readonly<{ userId: string; displayName: string }>

const columnLabels: Readonly<Record<BoardColumnId, string>> = {
  intake: '收集箱', ready: '待开始', 'in-progress': '进行中', review: '待确认', completed: '已完成',
}

export function TaskDrawer({ card, projectName, busy = false, pendingAction, error, currentUserId, members = [], mentionableUsers = [], activity = [], revisionInstruction, delivery, deliveryDetail, materialSelection, onPreviewDraftFile, deliveryError, deliveryFiles = [], onPreviewDeliveryFile, onPreviewSealedFile, onClose, onAdopt, onRequestRevision, onOfferDecision, onHumanAnswer, onReexecute, onContinueSession, onReturnTask, onSubmitDelivery, onSummaryChange, onMaterialsChange, onAiSummaryDecision, onAssign, onWithdraw, onComment }: Readonly<{
  card: TaskCardModel
  busy?: boolean
  pendingAction?: string
  error?: string | null
  projectName: string
  currentUserId?: string | null
  members?: readonly Readonly<{ userId: string; name: string; role: string; state?: string }>[]
  mentionableUsers?: readonly MentionableUser[]
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
  onAdopt?(): void
  onRequestRevision?(instruction: string): Promise<boolean> | void
  onOfferDecision?(decision: 'accept' | 'reject'): void
  onHumanAnswer?(answer: string): Promise<boolean> | void
  onReexecute?(): void
  onContinueSession?(): void
  onReturnTask?(reason: string): Promise<boolean>
  onSubmitDelivery?(summary: string, files: readonly DeliveryDraftFile[]): Promise<boolean> | void
  onSummaryChange?(summary: string): void
  onMaterialsChange?(files: readonly DeliveryDraftFile[]): void
  onAiSummaryDecision?(decision: 'replace' | 'keep', summary: string): void
  onAssign?(userId: string): void
  onWithdraw?(): void
  onComment?(text: string, mentionedUserIds: readonly string[]): void
}>): ReactElement {
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const validInstruction = deliveryRevisionRequestSchema.shape.instruction.safeParse(instruction).success
  const sendRevision = async () => {
    if (busy || !validInstruction) return
    if (await onRequestRevision?.(instruction.trim()) === false) return
    setRevisionOpen(false)
    setInstruction('')
  }
  const [answer, setAnswer] = useState('')
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const validReturnReason = collaborationTaskReturnInputSchema.shape.reason.safeParse(returnReason).success
  const confirmReturn = async (): Promise<void> => {
    if (busy || !validReturnReason || !onReturnTask) return
    if (!await onReturnTask(returnReason.trim())) return
    setReturnOpen(false)
    setReturnReason('')
  }
  const sendAnswer = async (): Promise<void> => {
    const text = answer.trim()
    if (busy || !text) return
    // A rejected answer stays in the field so the Member can retry it.
    if (await onHumanAnswer?.(text) === false) return
    setAnswer('')
  }
  const [comment, setComment] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!onClose) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const mentionMap = useMemo(() => new Map(mentionableUsers.map((user) => [user.displayName, user.userId])), [mentionableUsers])
  const isOwner = Boolean(currentUserId && members.some((member) => member.userId === currentUserId && member.role === '所有者'))
  const isAssignedWorker = Boolean(currentUserId && card.assigneeUserId === currentUserId)
  const localDraft = delivery?.draft
  // The Owner may hold a pending Offer themselves and still need to hand it to
  // another eligible Member: accepting is a personal decision, reassigning is
  // an authority decision, so both stay available on the same card.
  const assignment = card.assignment
  const assignmentBand = isOwner && assignment
    ? <AssignmentBand assignment={assignment} members={members.filter((member) => member.userId !== currentUserId && (assignment.kind !== 'withdraw' || member.userId !== assignment.workerUserId) && (member.state === undefined || member.state === 'active') && (card.assignableWorkerUserIds === undefined || card.assignableWorkerUserIds.includes(member.userId)))} busy={busy} pendingAction={pendingAction} onAssign={onAssign} onWithdraw={onWithdraw} />
    : null
  const offerAvailability = card.offerAvailability
  const offerPresentation = offerAvailability ? offerAvailabilityPresentation(offerAvailability) : undefined
  const offerBand = offerAvailability && offerPresentation && isAssignedWorker
    ? <ActionBand title={offerAvailability.canAccept ? '这项任务分配给你' : offerPresentation.label} body={offerPresentation.detail}>{offerAvailability.canAccept && card.offerId ? <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={() => onOfferDecision?.('accept')}>{busy && pendingAction === 'offer-accept' ? '处理中…' : '接受任务'}</button> : null}{offerAvailability.canReject && card.offerId ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => onOfferDecision?.('reject')}>{busy && pendingAction === 'offer-reject' ? '处理中…' : '拒绝'}</button> : null}</ActionBand>
    : null
  const deliverySubmitted = deliveryDetail?.state === 'submitted' || deliveryDetail?.state === 'adopted' || delivery?.state === 'sealed'
  const showDeliveryDraft = (isAssignedWorker && Boolean(deliveryDetail || localDraft || card.executionFailure)) || (isOwner && deliverySubmitted && Boolean(deliveryDetail))
  const draftData = deliveryDetail ?? workerDeliveryPresentation(delivery, card, members, deliveryFiles)
  const ownerPreparing = isOwner && !isAssignedWorker && !deliverySubmitted && card.stateLabel !== '待你采纳' && Boolean(card.executionId)
  const returnControls = isAssignedWorker && card.canReturnExecution && onReturnTask && !deliverySubmitted
    ? <details className="collaboration-workspace-delivery-return" data-testid="delivery-return"><summary>遇到问题？退回任务</summary>
        {returnOpen ? <div className="collaboration-workspace-delivery-return-form" data-testid="delivery-return-form">
          <p>退回会终止本机执行，由系统尝试重新派发；无法自动改派时交由负责人处理。</p>
          <label className="collaboration-workspace-revision-input">退回原因<textarea aria-label="退回原因" data-testid="delivery-return-reason" required maxLength={500} rows={3} disabled={busy} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="请说明无法完成的原因" /></label>
          <div className="collaboration-workspace-delivery-actions">
            <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-return-confirm" disabled={busy || !validReturnReason} onClick={() => void confirmReturn()}>{busy && pendingAction === 'return-task' ? '处理中…' : '确认退回任务'}</button>
            <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-return-cancel" disabled={busy} onClick={() => setReturnOpen(false)}>取消</button>
          </div>
        </div> : <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-return-open" disabled={busy} onClick={() => setReturnOpen(true)}>无法完成，退回任务</button>}
      </details>
    : null
  const draft = showDeliveryDraft ? <DeliveryDraft
    key={`${card.executionId}:${draftData.revision}`}
    data={draftData}
    busy={busy}
    materialSelection={materialSelection}
    returnControls={returnControls}
    onPreview={onPreviewDraftFile ?? ((file) => {
      if (deliverySubmitted) {
        const sealed = deliveryFiles.find((entry) => entry.name === file.name)
        if (sealed) onPreviewSealedFile?.(sealed)
      } else onPreviewDeliveryFile?.(file.name)
    })}
    onReexecute={card.executionFailure?.reexecutionInputId ? onReexecute : undefined}
    onContinue={isAssignedWorker ? onContinueSession : undefined}
    onSubmit={isAssignedWorker ? onSubmitDelivery : undefined}
    onSummaryChange={isAssignedWorker ? onSummaryChange : undefined}
    onMaterialsChange={isAssignedWorker ? onMaterialsChange : undefined}
    onAiSummaryDecision={isAssignedWorker ? onAiSummaryDecision : undefined}
  /> : ownerPreparing ? <section className="collaboration-workspace-delivery-draft" data-testid="delivery-owner-preparing" aria-label="交付进度"><p role="status">成员正在准备交付{deliveryDetail ? `（第 ${deliveryDetail.revision} 版）` : ''}</p></section> : null
  const action = offerBand
    ? <>{offerBand}{assignmentBand}</>
    : card.stateLabel === '等待回答' && isAssignedWorker && card.humanRequestId
      ? <ActionBand tone="warning" title="Agent 在等你回答" body={card.question ?? '补充任务需要的边界或决定后，执行会继续。'}><div className="collaboration-workspace-answer-row"><input disabled={busy} value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendAnswer() }} placeholder="输入回答" aria-label="回答" /><button type="button" className="collaboration-workspace-button-primary" disabled={busy || !answer.trim()} onClick={() => void sendAnswer()}>{busy && pendingAction === 'answer' ? '处理中…' : '发送'}</button></div></ActionBand>
      : card.stateLabel === '等待成员回答'
        ? <ActionBand tone="warning" title={`${card.assignee ?? '成员'} 的 Agent 在等成员回答`} body="只有被派成员可以回答，回答后执行会继续。" />
        : card.stateLabel === '待你采纳' && isOwner
          ? <ActionBand title="交付等待你确认" body="成员已提交交付。采纳后任务完成；不满意可以要求返修。">
            {!showDeliveryDraft ? <FileList files={deliveryFiles} onPreview={onPreviewSealedFile} /> : null}
            {revisionOpen ? <>
              <label className="collaboration-workspace-revision-input">返修意见
                <textarea aria-label="返修意见" required maxLength={deliveryRevisionRequestSchema.shape.instruction.maxLength ?? undefined} rows={4} disabled={busy} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="请说明需要修改的内容和验收要求" />
              </label>
              <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !validInstruction} onClick={() => void sendRevision()}>{busy && pendingAction === 'revision' ? '处理中…' : '发送返修要求'}</button>
              <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => { setRevisionOpen(false); setInstruction('') }}>取消</button>
            </> : <>
              <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={onAdopt}>{busy && pendingAction === 'adopt' ? '处理中…' : '采纳交付'}</button>
              <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={() => setRevisionOpen(true)}>要求返修</button>
            </>}
          </ActionBand>
          : assignmentBand
  const submitComment = () => {
    const text = comment.trim()
    if (!text || busy) return
    const mentionedUserIds = [...text.matchAll(/@([^\s@]+)/gu)].map((match) => mentionMap.get(match[1]!)).filter((id): id is string => Boolean(id))
    onComment?.(text, [...new Set(mentionedUserIds)])
    setComment('')
  }
  const copyReference = () => {
    void navigator.clipboard?.writeText(`${projectName} ${card.reference} ${card.title}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <aside className={`collaboration-workspace-task-drawer${expanded ? ' is-expanded' : ''}`} aria-label="任务详情" aria-busy={busy}>
      <header className="collaboration-workspace-task-drawer-header">
        <span className="collaboration-workspace-task-drawer-breadcrumb"><span>{projectName}</span><span aria-hidden="true">/</span><b>{card.reference}</b></span>
        <div>
          <button type="button" aria-label={copied ? '已复制' : '复制'} title={copied ? '已复制' : '复制任务编号与标题'} onClick={copyReference}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button>
          <button type="button" aria-label={expanded ? '收起' : '展开'} title={expanded ? '收起' : '展开'} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
          <button type="button" aria-label="关闭" title="关闭（Esc）" onClick={onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div className="collaboration-workspace-task-drawer-content">
        <p className="collaboration-workspace-task-drawer-eyebrow">{card.moduleType}</p>
        <h2>{card.title}</h2>
        {card.description ? <p className="collaboration-workspace-task-drawer-description">{card.description}</p> : null}
        <dl className="collaboration-workspace-task-drawer-properties">
          <div><dt>状态</dt><dd><span className={`collaboration-workspace-property-chip status-${card.status}`}><span className="collaboration-workspace-board-column-dot" aria-hidden="true" />{deliverySubmitted ? draftData.state === 'adopted' ? '已完成' : '待负责人采纳' : columnLabels[card.status]}</span>{card.stateLabel && !(showDeliveryDraft && deliverySubmitted) ? <span className={`collaboration-workspace-task-card-state ${card.executionFailure ? 'tone-warning' : showDeliveryDraft ? 'tone-neutral' : stateTone(card.stateLabel)}`}>{card.stateLabel}</span> : null}</dd></div>
          <div><dt>负责人</dt><dd><span className="collaboration-workspace-property-chip"><UserRound aria-hidden="true" />{card.assignee ?? '待分配'}</span></dd></div>
          <div><dt>时间</dt><dd><span className="collaboration-workspace-property-chip"><CalendarDays aria-hidden="true" />{card.date}</span></dd></div>
        </dl>
        {card.blockedByLabel ? <p className="collaboration-workspace-task-card-state tone-warning">{card.blockedByLabel}</p> : null}
        {revisionInstruction && !deliveryDetail?.revisionRequest ? <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label="负责人返修意见"><strong>负责人返修意见</strong><p style={{ whiteSpace: 'pre-wrap' }}>{revisionInstruction}</p></section> : null}
        {draft}
        {action}
        {!showDeliveryDraft ? returnControls : null}
        {error || deliveryError || delivery?.error ? <p role="alert">{error ?? deliveryError ?? delivery?.error}</p> : null}
        <section className="collaboration-workspace-task-drawer-activity" aria-label="动态">
          <h3>动态</h3>
          {activity.length ? (
            <ol>
              {activity.map((item, index) => item.event
                ? <li className="is-event" key={`${item.time}:${index}`}><span className="collaboration-workspace-activity-event-dot" aria-hidden="true" /><p>{item.text}</p><time>{item.time}</time></li>
                : <li key={`${item.time}:${index}`}><span className="collaboration-workspace-avatar" aria-hidden="true">{item.actor.slice(0, 1)}</span><div><strong>{item.actor}<time>{item.time}</time></strong><p>{item.text}</p></div></li>)}
            </ol>
          ) : <p className="collaboration-workspace-empty-copy">还没有动态。派单、接受、交付和讨论都会记录在这里。</p>}
        </section>
      </div>
      <div className="collaboration-workspace-task-drawer-composer">
        <input disabled={busy} value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitComment() }} placeholder="发起新讨论… @成员" aria-label="发起新讨论" />
        <button type="button" aria-label="发送" title="发送" disabled={busy || !comment.trim()} onClick={submitComment}><Send aria-hidden="true" /></button>
      </div>
    </aside>
  )
}

function ActionBand({ tone = 'accent', title, body, children }: Readonly<{ tone?: 'accent' | 'warning'; title: string; body: string; children?: ReactNode }>): ReactElement {
  return (
    <section className={`collaboration-workspace-task-drawer-action tone-${tone}`} aria-label={title}>
      <strong>{title}</strong>
      {body ? <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p> : null}
      {children ? <div className="collaboration-workspace-task-drawer-action-controls">{children}</div> : null}
    </section>
  )
}

function AssignmentBand({ assignment, members, busy, pendingAction, onAssign, onWithdraw }: Readonly<{ busy: boolean; pendingAction?: string; assignment: TaskAssignmentModel; members: readonly Readonly<{ userId: string; name: string }>[]; onAssign?(userId: string): void; onWithdraw?(): void }>): ReactElement {
  const [workerUserId, setWorkerUserId] = useState('')
  if (assignment.kind === 'withdraw') {
    return (
      <ActionBand title="当前派单待接受" body={`已派给 ${assignment.workerName}，${assignment.expiresAt} 前有效。接受前可以改派给其他成员；改派会先撤回当前派单。`}>
        <label className="collaboration-workspace-select">
          <span className="collaboration-workspace-visually-hidden">改派给</span>
          <select disabled={busy} value={workerUserId} onChange={(event) => setWorkerUserId(event.target.value)}>
            <option value="">选择成员</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !workerUserId} onClick={() => onAssign?.(workerUserId)}>{busy && pendingAction === 'assign' ? '处理中…' : '改派'}</button>
        <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onWithdraw}>{busy && pendingAction === 'withdraw' ? '处理中…' : '撤回派单'}</button>
      </ActionBand>
    )
  }
  const first = assignment.kind === 'first'
  return (
    <ActionBand tone={first ? 'accent' : 'warning'} title={first ? '为这个模块选择执行人' : '任务需要重新派发'} body={first ? '选择成员后派发，对方在收件箱接受后开始执行。' : `${assignment.reason}，请选择新的执行人。`}>
      <label className="collaboration-workspace-select">
        <span className="collaboration-workspace-visually-hidden">执行人</span>
        <select disabled={busy} value={workerUserId} onChange={(event) => setWorkerUserId(event.target.value)}>
          <option value="">选择成员</option>
          {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !workerUserId} onClick={() => onAssign?.(workerUserId)}>{busy && pendingAction === 'assign' ? '处理中…' : first ? '派发任务' : '重新派发'}</button>
    </ActionBand>
  )
}

function FileList<File extends Readonly<{ name: string; mediaType: string; byteCount: number; key?: string }>>({ files, onPreview, required = false }: Readonly<{ required?: boolean; onPreview?(file: File): void; files: readonly File[] }>): ReactElement | null {
  if (!files.length) return null
  return <ul className="collaboration-workspace-delivery-files">{files.map((file) => <li key={file.key ?? file.name} data-testid="delivery-file-row"><strong>{file.name}{required ? <span className="collaboration-workspace-delivery-required" data-testid="delivery-file-required">必交</span> : null}</strong><small>{file.mediaType} · {formatBytes(file.byteCount)}</small>{onPreview ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-preview" aria-label={`预览 ${file.name}`} onClick={() => onPreview(file)}>预览 {file.name}</button> : null}</li>)}</ul>
}
