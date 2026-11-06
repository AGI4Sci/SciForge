import React, { useState, type ReactElement } from 'react'
import type { RecordQuery } from './research-record-presentation'

export function ResearchRecordSearch({ query, onQuery, disabled }: { query: RecordQuery; onQuery: (query: RecordQuery) => void; disabled: boolean }): ReactElement {
  const [text, setText] = useState(query.text ?? '')
  const [concern, setConcern] = useState(query.concern ?? '')
  const [sourceStatus, setSourceStatus] = useState(query.sourceStatus ?? '')
  return <form aria-label="本范围搜索" className="record-search mb-3 flex flex-wrap gap-2 record-caption" onSubmit={event => {
    event.preventDefault()
    onQuery({ ...(text.trim() ? { text: text.trim() } : {}), ...(concern ? { concern: concern as RecordQuery['concern'] } : {}), ...(sourceStatus ? { sourceStatus: sourceStatus as RecordQuery['sourceStatus'] } : {}) })
  }}>
    <input className="min-w-0 flex-1 rounded border border-ds-border bg-ds-main p-1" aria-label="本范围搜索文字" maxLength={256} value={text} onChange={event => setText(event.target.value)} placeholder="搜索本范围及其后代" />
    <select aria-label="关注筛选" className="min-w-0 rounded border border-ds-border bg-ds-main" value={concern} onChange={event => setConcern(event.target.value)}><option value="">全部关注状态</option><option value="negative">负例</option><option value="open">未决</option><option value="failed">失败/中断</option></select>
    <select aria-label="来源筛选" className="min-w-0 rounded border border-ds-border bg-ds-main" value={sourceStatus} onChange={event => setSourceStatus(event.target.value)}><option value="">全部来源状态</option><option value="current">当前</option><option value="changed">已变化</option><option value="unavailable">不可读</option><option value="unknown">未知</option></select>
    <button disabled={disabled} className="rounded border border-ds-border px-2 py-1 disabled:opacity-40">搜索本范围</button>
    <button type="button" disabled={disabled} className="rounded border border-ds-border px-2 py-1 disabled:opacity-40" onClick={() => { setText(''); setConcern(''); setSourceStatus(''); onQuery({}) }}>清除搜索</button>
    <details className="w-full text-ds-muted"><summary className="cursor-pointer">检索说明</summary><p className="mt-1">由已有记录检索；结果不是新增事实。来源状态为已记录状态，打开时重新核对。</p></details>
  </form>
}
