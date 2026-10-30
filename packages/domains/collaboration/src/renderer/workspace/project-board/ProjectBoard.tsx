import React, { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { TaskCard } from '../task-card/TaskCard.js'
import type { BoardColumnId, TaskCardModel } from '../workspace-types.js'

const columns: readonly Readonly<{ id: BoardColumnId; label: string }>[] = [
  { id: 'intake', label: '收集箱' },
  { id: 'ready', label: '待开始' },
  { id: 'in-progress', label: '进行中' },
  { id: 'review', label: '待确认' },
  { id: 'completed', label: '已完成' },
]

const unassigned = '__unassigned__'

export function ProjectBoard({
  cards,
  selectedCardId,
  onSelectCard,
}: Readonly<{
  cards: readonly TaskCardModel[]
  selectedCardId: string | null
  onSelectCard?(card: TaskCardModel): void
}>): ReactElement {
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
  return (
    <section className="collaboration-workspace-board" aria-label="项目看板">
      <div className="collaboration-workspace-board-toolbar">
        <label className="collaboration-workspace-select">
          <span className="collaboration-workspace-visually-hidden">状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as BoardColumnId | '')}>
            <option value="">全部状态</option>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <label className="collaboration-workspace-select">
          <span className="collaboration-workspace-visually-hidden">负责人</span>
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">全部负责人</option>
            <option value={unassigned}>待分配</option>
            {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <label className="collaboration-workspace-search">
          <Search aria-hidden="true" />
          <span className="collaboration-workspace-visually-hidden">搜索任务</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" />
        </label>
        {filtered ? <button type="button" className="collaboration-workspace-button-ghost" onClick={() => { setStatus(''); setAssignee(''); setQuery('') }}>清除筛选</button> : null}
      </div>
      <div className="collaboration-workspace-board-heading">
        <h2>任务</h2>
        <span>{filtered ? `${visible.length} / ${cards.length} 个任务` : `${cards.length} 个任务`}</span>
        {cards.length === 0 ? <p className="collaboration-workspace-board-hint">需求确认后，Coordinator 拆出的工作模块会作为任务卡出现在收集箱。</p> : null}
      </div>
      <div className="collaboration-workspace-board-columns">
        {columns.map((column) => {
          const columnCards = visible.filter((card) => card.status === column.id)
          return (
            <section key={column.id} className={`collaboration-workspace-board-column status-${column.id}`} aria-label={`${column.label} ${columnCards.length} 个任务`}>
              <header>
                <span className="collaboration-workspace-board-column-dot" aria-hidden="true" />
                <h3>{column.label}</h3>
                <b>{columnCards.length}</b>
              </header>
              <div className="collaboration-workspace-board-column-cards">
                {columnCards.length ? columnCards.map((card) => (
                  <button type="button" key={card.id} className="collaboration-workspace-task-card-button" aria-pressed={card.id === selectedCardId} onClick={() => onSelectCard?.(card)}>
                    <TaskCard card={card} selected={card.id === selectedCardId} />
                  </button>
                )) : <div className="collaboration-workspace-board-empty">暂无任务</div>}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
