import React, { useRef, useSyncExternalStore, type ReactElement } from 'react'
import { sourceTextPage } from './research-record-source-content'
import type { ResearchRecordPresentation } from './research-record-presentation'
import { useRecordSelectionLock } from './RecordWindow'

/** The same text paging as original sources; closed text is not mounted. */
export function RecordLongText({ id, label, text, presentation }: {
  id: string; label: string; text: string; presentation: ResearchRecordPresentation
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const key = `text:${id}`, open = state.expanded.has(key)
  const page = sourceTextPage(text, state.offsets[key] ?? 0)
  const root = useRef<HTMLElement>(null)
  const selected = useRecordSelectionLock(root)
  return <section ref={root} className="record-caption" data-record-long-text={id}>
    <button className="rounded px-1 py-1 text-left hover:bg-ds-hover" aria-expanded={open} onClick={() => presentation.toggle(key)}>{label} · {text.length} 字符</button>
    {open && <div className="mt-1">
      <pre className="record-code select-text whitespace-pre-wrap break-words">{page.text}</pre>
      {page.pages > 1 && <nav aria-label={`${label}分段`} className="mt-1 flex flex-wrap gap-2">
        <button disabled={selected || !page.page} onClick={() => presentation.offset(key, page.page - 1)}>上一段</button>
        <span>{page.page + 1} / {page.pages} 段 · 展示分段，原文保留</span>
        <button disabled={selected || page.page + 1 >= page.pages} onClick={() => presentation.offset(key, page.page + 1)}>下一段</button>
        {selected && <span>保留活动选区；取消后可换段。</span>}
      </nav>}
    </div>}
  </section>
}
