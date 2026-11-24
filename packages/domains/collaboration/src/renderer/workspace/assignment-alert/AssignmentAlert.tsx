import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import { Bell, X } from 'lucide-react'

/**
 * The workspace-wide assignment reminder. It states one count, offers the
 * single unambiguous bulk action only when every pending Offer is proved, and
 * always lets the User jump to the Inbox and close it.
 */
export function AssignmentAlert({
  count,
  titles = [],
  canAcceptAll = false,
  busy = false,
  onView,
  onAcceptAll,
  onDismiss
}: Readonly<{
  count: number
  titles?: readonly string[]
  canAcceptAll?: boolean
  busy?: boolean
  onView?(): void
  onAcceptAll?(): void
  onDismiss?(): void
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const preview = titles.slice(0, 2).map((title) => cw('「{{title}}」', { title })).join(cw('、'))
  const detail = titles.length === 0
    ? cw('接受后选择完成方式；也可以先到收件箱逐项查看。')
    : count > titles.slice(0, 2).length
      ? cw('{{titles}} 等 {{count}} 个任务等你接受。', { titles: preview, count })
      : cw(count === 1 ? '{{titles}} 在等你接受。' : '{{titles}} 都等你接受。', { titles: preview })
  return (
    <section className="collaboration-workspace-assignment-alert" role="region" aria-label={cw('任务分配提醒')} aria-live="polite">
      <span className="collaboration-workspace-assignment-alert-icon" aria-hidden="true"><Bell /></span>
      <span className="collaboration-workspace-assignment-alert-copy">
        <strong>{cw('有 {{count}} 个任务分配给你', { count })}</strong>
        <span>{detail}</span>
      </span>
      <span className="collaboration-workspace-assignment-alert-actions">
        {canAcceptAll ? <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={onAcceptAll}>{cw(busy ? '处理中…' : '全部接受')}</button> : null}
        <button type="button" className="collaboration-workspace-button-secondary" onClick={onView}>{cw('查看')}</button>
        <button type="button" className="collaboration-workspace-icon-button" aria-label={cw('关闭任务分配提醒')} title={cw('关闭')} onClick={onDismiss}><X aria-hidden="true" /></button>
      </span>
    </section>
  )
}
