import React, { type ReactElement } from 'react'

/** Server pages are separate from the bounded DOM windows within each page. */
export function ResearchRecordPaging({ label, offset, count, total, hasPrevious, hasNext, disabled = false, onPrevious, onNext }: {
  label: string; offset: number; count: number; total: number; hasPrevious: boolean; hasNext: boolean; disabled?: boolean
  onPrevious: () => void; onNext: () => void
}): ReactElement {
  return <nav aria-label={`${label}服务端分页`} className="my-2 flex flex-wrap items-center gap-2 record-caption text-ds-muted">
    <button className="rounded border border-ds-border px-2 py-1 disabled:opacity-40" disabled={disabled || !hasPrevious} onClick={onPrevious}>上一页{label}</button>
    <span>已读取 {count ? offset + 1 : 0}–{offset + count} / {total} 项{total > count ? '；其余未在本页加载' : ''}</span>
    <button className="rounded border border-ds-border px-2 py-1 disabled:opacity-40" disabled={disabled || !hasNext} onClick={onNext}>下一页{label}</button>
    {disabled && <span>保留活动选区；取消选区后可翻页。</span>}
  </nav>
}
