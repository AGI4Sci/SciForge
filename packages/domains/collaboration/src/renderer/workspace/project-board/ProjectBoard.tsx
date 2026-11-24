import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, CircleCheckBig, ClipboardCheck, Inbox, ListTodo, LoaderCircle, Search, UserRoundPlus } from 'lucide-react'
import { offerDecisionFromActionKind, type OfferDecision } from '../offer-decisions.js'
import { TaskCard } from '../task-card/TaskCard.js'
import type { BoardColumnId, TaskCardModel } from '../workspace-types.js'

type ColumnDefinition = Readonly<{
  id: BoardColumnId
  label: string
  /** Shown inside an empty column instead of a bare "no tasks" line. */
  hint: string
  icon: ReactElement
}>

const columns: readonly ColumnDefinition[] = [
  { id: 'intake', label: '收集箱', hint: '需求确认后，拆出的工作模块会先到这里。', icon: <Inbox aria-hidden="true" /> },
  { id: 'ready', label: '待开始', hint: '已派发、等待成员接受的任务会停在这里。', icon: <ListTodo aria-hidden="true" /> },
  { id: 'in-progress', label: '进行中', hint: '成员开始处理的任务会出现在这里，可以自己完成或与 AI 协作。', icon: <LoaderCircle aria-hidden="true" /> },
  { id: 'review', label: '待确认', hint: '提交的交付会排队等你确认或采纳。', icon: <ClipboardCheck aria-hidden="true" /> },
  { id: 'completed', label: '已完成', hint: '已采纳的任务会归档到这里。', icon: <CircleCheckBig aria-hidden="true" /> },
]

const unassigned = '__unassigned__'

export function ProjectBoard({
  cards,
  selectedCardId,
  busy = false,
  busyCardId = null,
  pendingAction,
  error,
  canAssign = false,
  onSelectCard,
  onOfferDecision,
  onAssignRequest,
}: Readonly<{
  cards: readonly TaskCardModel[]
  selectedCardId: string | null
  /** An Offer decision is in flight somewhere on the board; every card waits. */
  busy?: boolean
  /** The card whose Offer decision is currently in flight. */
  busyCardId?: string | null
  pendingAction?: string
  /** A failed card action; never swallowed by the board. */
  error?: string | null
  /** The current User owns the Project, so dispatch is theirs to do. */
  canAssign?: boolean
  onSelectCard?(card: TaskCardModel): void
  onOfferDecision?(card: TaskCardModel, decision: OfferDecision): void
  /** Opens the same assignment UI the card action opens. */
  onAssignRequest?(card: TaskCardModel): void
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const [status, setStatus] = useState<BoardColumnId | ''>('')
  const [assignee, setAssignee] = useState('')
  const [query, setQuery] = useState('')
  const assignees = useMemo(() => [...new Set(cards.flatMap((card) => card.assignee ? [card.assignee] : []))], [cards])
  const needle = query.trim().toLowerCase()
  const visible = cards.filter((card) =>
    (!status || card.status === status)
    && (!assignee || (assignee === unassigned ? card.assignee === null : card.assignee === assignee))
    && (!needle || `${card.reference} ${card.title}`.toLowerCase().includes(needle)))
  const filtered = Boolean(status || assignee || needle)
  const pendingDecision = offerDecisionFromActionKind(pendingAction)
  // The board-level entry point targets what the Owner is looking at: the
  // opened card, else the first module still waiting for an assignee.
  const assignable = canAssign ? visible.filter((card) => card.assignment) : []
  const assignTarget = assignable.find((card) => card.id === selectedCardId)
    ?? assignable.find((card) => !card.assignee)
    ?? assignable[0]
  return (
    <section className="collaboration-workspace-board" aria-label={cw('项目看板')}>
      <div className="collaboration-workspace-board-head">
        <div className="collaboration-workspace-board-heading">
          <h2>{cw('任务')}</h2>
          <span>{filtered ? cw('{{visible}} / {{count}} 个任务', { visible: visible.length, count: cards.length }) : cw('{{count}} 个任务', { count: cards.length })}</span>
        </div>
        <div className="collaboration-workspace-board-toolbar">
          {canAssign ? (
            <button
              type="button"
              className="collaboration-workspace-button-secondary"
              data-testid="board-assign-task"
              disabled={!assignTarget}
              title={assignTarget ? cw('打开 {{reference}} {{title}}，选择成员后派发', { reference: assignTarget.reference, title: assignTarget.title }) : cw('当前没有可分配的任务')}
              onClick={() => { if (assignTarget) onAssignRequest?.(assignTarget) }}
            >
              <UserRoundPlus aria-hidden="true" />{cw('分配任务')}
            </button>
          ) : null}
          <label className="collaboration-workspace-select">
            <span className="collaboration-workspace-visually-hidden">{cw('状态')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as BoardColumnId | '')}>
              <option value="">{cw('全部状态')}</option>
              {columns.map((column) => <option key={column.id} value={column.id}>{cw(column.label)}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <label className="collaboration-workspace-select">
            <span className="collaboration-workspace-visually-hidden">{cw('负责人')}</span>
            <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">{cw('全部负责人')}</option>
              <option value={unassigned}>{cw('待分配')}</option>
              {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <label className="collaboration-workspace-search">
            <Search aria-hidden="true" />
            <span className="collaboration-workspace-visually-hidden">{cw('搜索任务')}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={cw('搜索任务')} />
          </label>
          {filtered ? <button type="button" className="collaboration-workspace-button-ghost" onClick={() => { setStatus(''); setAssignee(''); setQuery('') }}>{cw('清除筛选')}</button> : null}
        </div>
      </div>
      {cards.length === 0 ? <p className="collaboration-workspace-board-hint">{cw('需求确认后，Coordinator 拆出的工作模块会作为任务卡出现在收集箱。')}</p> : null}
      {error ? <p className="collaboration-workspace-board-error" role="alert">{error}</p> : null}
      {cards.length ? <nav className="collaboration-workspace-board-toolbar" aria-label={cw('按任务状态查看')}>
        {columns.map((column) => <button key={column.id} type="button" className="collaboration-workspace-button-secondary" aria-pressed={status === column.id} onClick={() => setStatus(status === column.id ? '' : column.id)}>{cw(column.label)} · {cards.filter((card) => card.status === column.id).length}</button>)}
      </nav> : null}
      <div className="collaboration-workspace-board-columns">
        {columns.filter((column) => !status || column.id === status).map((column) => {
          const columnCards = visible.filter((card) => card.status === column.id)
          return (
            <section key={column.id} className={`collaboration-workspace-board-column status-${column.id}`} aria-label={cw('{{column}} {{count}} 个任务', { column: cw(column.label), count: columnCards.length })}>
              <header className="collaboration-workspace-board-column-header">
                <span className="collaboration-workspace-board-column-dot" aria-hidden="true" />
                <h3>{cw(column.label)}</h3>
                <b>{columnCards.length}</b>
              </header>
              <div className="collaboration-workspace-board-column-cards">
                {columnCards.length ? columnCards.map((card) => (
                  <TaskCard
                    key={card.id}
                    card={card}
                    selected={card.id === selectedCardId}
                    busy={busy || busyCardId === card.id}
                    pendingDecision={busyCardId === card.id ? pendingDecision ?? undefined : undefined}
                    canAssign={canAssign}
                    onOpen={onSelectCard}
                    onDecide={onOfferDecision}
                    onAssignRequest={onAssignRequest}
                  />
                )) : (
                  <div className="collaboration-workspace-board-empty">
                    <span className="collaboration-workspace-board-empty-icon" aria-hidden="true">{column.icon}</span>
                    <strong>{cw('暂无任务')}</strong>
                    <span>{cw(column.hint)}</span>
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
