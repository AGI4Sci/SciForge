import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { domainRendererSelectionSnapshotSchema, type DomainRendererSelectionSnapshot, type DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { domainWorkbenchOpenResourceInputSchema } from '@sciforge/domain-sdk/renderer'
import type { ResearchRecordScope } from '../research-record-contract'

/** Match both ends to the same smallest owned item; never guess from a parent group. */
export function readRecordSelection(root: HTMLElement, scope: ResearchRecordScope, revision: number): DomainRendererSelectionSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const start = element(range.startContainer)?.closest<HTMLElement>('[data-selection-record-id]')
  const end = element(range.endContainer)?.closest<HTMLElement>('[data-selection-record-id]')
  if (!start || start !== end || !root.contains(start)) return null
  const quote = selection.toString()
  if (!quote.trim()) return null
  if (quote.length > 4000) throw new Error('选区超过 4000 字符，请缩小到单项内容；不会自动截断。')
  const rect = range.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return domainRendererSelectionSnapshotSchema.parse({
    schemaVersion: 1, kind: 'resource-text-selection', resourceKind: 'research-record-node',
    resourceId: start.dataset.selectionRecordId, label: start.dataset.selectionRecordLabel,
    quote, revision: 'record:' + revision, capturedAt: new Date().toISOString(), scope,
    ...(start.dataset.selectionSource ? { source: JSON.parse(start.dataset.selectionSource) } : {}),
    bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight, scaleFactor: devicePixelRatio }
  })
}

/** Use the public exact-resource route; context is data, never a grant. */
export async function openRecordSelection(selection: DomainRendererSelectionSnapshot, workbench?: Pick<DomainRendererWorkbenchHost, 'canOpenResource' | 'openResource'>): Promise<void> {
  if (!workbench?.canOpenResource?.('resource-text-selection') || !workbench.openResource) throw new Error('没有已安装且获准的批注入口。请启用锚定批注插件并授予所需权限；尚未保存批注。')
  const value = domainRendererSelectionSnapshotSchema.parse(selection)
  const input = domainWorkbenchOpenResourceInputSchema.parse({ sessionId: value.scope.threadId,
    resource: { resourceKind: value.kind, resourceId: value.resourceId, context: value } })
  if (!await workbench.openResource(input)) throw new Error('批注入口不可用或已停用；尚未保存批注。')
}

export function ResearchRecordSelection({ root, scope, revision, active, onDiscuss, workbench }: {
  root: RefObject<HTMLElement | null>; scope: ResearchRecordScope; revision: number; active: boolean
  workbench?: DomainRendererWorkbenchHost
  onDiscuss: (selection: DomainRendererSelectionSnapshot) => Promise<void>
}): ReactElement | null {
  const [selection, setSelection] = useState<DomainRendererSelectionSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++; setBusy(false); setSelection(null); setNotice('')
    if (!active) return
    const inspect = () => {
      if (!root.current) return
      try {
        const next = readRecordSelection(root.current, scope, revision)
        if (next) { setSelection(next); setNotice('') }
        else if (!window.getSelection()?.isCollapsed) setSelection(null)
      } catch (error) { setSelection(null); setNotice(error instanceof Error ? error.message : String(error)) }
    }
    document.addEventListener('selectionchange', inspect)
    return () => document.removeEventListener('selectionchange', inspect)
  }, [active, root, scope, revision])
  if (!active || (!selection && !notice)) return null
  const annotate = async () => {
    if (!selection) return
    const version = epoch.current; setBusy(true)
    try { await openRecordSelection(selection, workbench); if (version === epoch.current) setNotice('已打开批注草稿。请填写正文并保存；选区尚未保存。') }
    catch (error) { if (version === epoch.current) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (version === epoch.current) setBusy(false) }
  }
  const copy = async () => {
    if (!selection) return
    try { await navigator.clipboard.writeText(JSON.stringify(selection, null, 2)); setNotice('选区定位已复制。打开“锚定批注”插件面板，粘贴定位并填写批注后保存。尚未保存批注。') }
    catch (error) { setNotice('复制失败：' + (error instanceof Error ? error.message : String(error))) }
  }
  return <section aria-label="研究选区操作" className="absolute inset-x-2 bottom-2 z-30 max-h-[40%] overflow-auto rounded-lg border border-ds-border bg-ds-sidebar px-3 py-2 record-caption shadow-lg">
    {selection && <><p className="truncate" title={selection.label}>选区：{selection.label}</p><blockquote className="max-h-16 overflow-auto whitespace-pre-wrap break-words">{selection.quote}</blockquote>
      <div className="mt-1 flex flex-wrap gap-2"><button disabled={busy} className="rounded border border-ds-border px-2 py-1" onClick={() => void annotate()}>添加批注</button><button disabled={busy} className="rounded border border-ds-border px-2 py-1" onClick={() => { setBusy(true); void onDiscuss(selection).finally(() => setBusy(false)) }}>讨论选区</button>
      <button className="rounded border border-ds-border px-2 py-1" onClick={() => void copy()}>复制批注定位</button>
      <button className="px-2 py-1" onClick={() => { setSelection(null); setNotice('') }}>取消选区</button></div></>}
    {notice && <p role="status" className="mt-1 break-words">{notice}</p>}
  </section>
}
