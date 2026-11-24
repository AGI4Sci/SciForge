import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { domainRendererSelectionSnapshotSchema, type DomainRendererSelectionSnapshot, type DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { domainWorkbenchOpenResourceInputSchema } from '@sciforge/domain-sdk/renderer'
import { MessageSquare, Plus, X } from 'lucide-react'
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
  const locked = useRef(false)
  useEffect(() => {
    epoch.current++; locked.current = false; setBusy(false); setSelection(null); setNotice('')
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
    return () => { epoch.current++; document.removeEventListener('selectionchange', inspect) }
  }, [active, root, scope, revision])
  if (!active || (!selection && !notice)) return null
  const perform = async (job: () => Promise<void>) => {
    if (!selection || locked.current) return
    const version = epoch.current; locked.current = true; setBusy(true)
    try { await job() }
    catch (error) { if (version === epoch.current) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (version === epoch.current) { locked.current = false; setBusy(false) } }
  }
  const annotate = async () => {
    if (!selection) return
    const version = epoch.current
    await openRecordSelection(selection, workbench)
    if (version === epoch.current) setNotice('已打开批注草稿，填写后保存。')
  }
  const copy = async () => {
    if (!selection) return
    const version = epoch.current
    await navigator.clipboard.writeText(JSON.stringify(selection, null, 2))
    if (version === epoch.current) setNotice('定位已复制，尚未保存批注。')
  }
  const dismiss = () => { epoch.current++; locked.current = false; setBusy(false); setSelection(null); setNotice('') }
  return <section data-native-view-occluder="true" aria-label="研究选区操作" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss() } }} className="absolute inset-x-2 bottom-2 z-30 max-h-[40%] overflow-auto rounded-xl border border-ds-border bg-ds-sidebar px-3 py-2 record-caption shadow-lg">
    <div className="flex min-w-0 items-center gap-2"><p className="min-w-0 flex-1 truncate font-medium" title={selection?.label}>{selection?.label || '选区提示'}</p><button type="button" className="rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label="关闭选区操作" onClick={dismiss}><X size={13} /></button></div>
    {selection && <><blockquote className="my-1 line-clamp-2 whitespace-pre-wrap break-words text-ds-muted">{selection.quote}</blockquote>
      <div className="flex flex-wrap items-center gap-1"><button disabled={busy} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-ds-hover disabled:opacity-50" onClick={() => void perform(() => onDiscuss(selection))}><MessageSquare size={13} />讨论选区</button>
      <button disabled={busy} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-ds-hover disabled:opacity-50" onClick={() => void perform(annotate)}><Plus size={13} />添加批注</button>
      <details className="text-ds-muted"><summary className="cursor-pointer px-2 py-1">定位</summary><p className="break-words">{selection.revision}</p><button disabled={busy} className="px-2 py-1 hover:bg-ds-hover" onClick={() => void perform(copy)}>复制批注定位</button></details></div></>}
    {notice && <p role="status" className="mt-1 break-words">{notice}</p>}
  </section>
}
