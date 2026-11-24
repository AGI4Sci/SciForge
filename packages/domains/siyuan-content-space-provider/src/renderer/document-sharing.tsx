import { useEffect, useRef, useState } from 'react'
import { useSiYuanLocale } from './locale.js'
import { documentSharingErrorText } from './document-sharing-error.js'

export type DocumentShareLink = Readonly<{ id: string; url: string | null; revision: number; permission: 'comment' | 'edit'; revoked: boolean }>
/** A frozen document target. These closures bind the capability resource in the renderer entry. */
export type ShareableDocument = Readonly<{
  title: string
  list: (signal: AbortSignal) => Promise<readonly DocumentShareLink[]>
  create: (permission: 'comment' | 'edit', signal: AbortSignal) => Promise<DocumentShareLink>
  revoke: (link: DocumentShareLink, signal: AbortSignal) => Promise<void>
}>
export type DocumentSharingControls = Readonly<{
  current: (input: { sessionId: string; spaceId: string }, signal: AbortSignal) => Promise<ShareableDocument | null>
}>

/** Mount only for the active account/chat/space; unmounting fences every pending result. */
export function DocumentSharing({ controls, sessionId, spaceId }: Readonly<{
  controls: DocumentSharingControls; sessionId: string; spaceId: string
}>) {
  const { text } = useSiYuanLocale()
  const [document, setDocument] = useState<ShareableDocument | null>(null)
  const [links, setLinks] = useState<readonly DocumentShareLink[]>([])
  const [permission, setPermission] = useState<'comment' | 'edit'>('comment')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState<string>()
  const pending = useRef<AbortController | null>(null)
  const close = () => { pending.current?.abort(); pending.current = null; setDocument(null); setLinks([]); setError(undefined); setBusy(false); setCopied(undefined) }
  useEffect(() => () => { pending.current?.abort() }, [])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(undefined)
    try { await action(controller.signal) }
    catch (failure) { if (!controller.signal.aborted) setError(documentSharingErrorText(failure, text)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const open = () => { void run(async signal => {
    const target = await controls.current({ sessionId, spaceId }, signal)
    if (signal.aborted) return
    if (!target) { setError(text('请先打开一篇笔记，再分享当前文档。', 'Open a note before sharing the current document.')); return }
    setDocument(target); setLinks([]); setCopied(undefined); setPermission('comment')
    const next = await target.list(signal)
    if (!signal.aborted) setLinks(next)
  }) }
  return <>
    <button type="button" disabled={busy && !document} onClick={open}>{text('分享当前文档', 'Share current document')}</button>
    {!document && error ? <p role="alert" className="w-full text-sm">{error}</p> : null}
    {document ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" data-native-view-occluder="true" aria-modal="true" aria-label={text('分享文档', 'Share document')} onKeyDown={event => { if (event.key === 'Escape') close() }}>
      <section className="max-h-[80vh] w-full max-w-lg space-y-4 overflow-auto rounded-lg border border-ds-border bg-ds-bg p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3"><h2 className="break-words font-semibold">{document.title}</h2><button type="button" onClick={close} aria-label={text('关闭分享', 'Close sharing')}>{text('关闭', 'Close')}</button></div>
        <p className="text-sm text-ds-muted">{text('仅分享这篇文档。持有链接的人需登录 SciForge 后加入，不会获得其他笔记或整个空间的访问权限。', 'Only this document is shared. Link holders must sign in to SciForge to join; other notes and the rest of the space remain private.')}</p>
        {!links.some(link => !link.revoked) ? <div className="flex items-center gap-2">
          <label>{text('链接权限', 'Link permission')}<select aria-label={text('链接权限', 'Link permission')} disabled={busy} value={permission} onChange={event => setPermission(event.target.value as 'comment' | 'edit')}>
            <option value="comment">{text('可评论', 'Can comment')}</option><option value="edit">{text('可编辑', 'Can edit')}</option>
          </select></label>
          <button type="button" disabled={busy} onClick={() => { void run(async signal => { const created = await document.create(permission, signal); if (!signal.aborted) setLinks([created]) }) }}>{text('创建分享链接', 'Create share link')}</button>
        </div> : <p className="text-sm text-ds-muted">{text('如需修改权限，请先撤销当前链接，再创建新链接。', 'To change permissions, revoke the current link, then create a new one.')}</p>}
        {error ? <p role="alert">{error}</p> : null}
        {busy ? <p role="status">{text('正在更新分享…', 'Updating sharing…')}</p> : null}
        {!busy && links.length === 0 ? <p>{text('尚无分享链接。', 'No share links yet.')}</p> : null}
        <ul className="space-y-3">{links.map(link => { const url = link.url; return <li key={link.id} className="space-y-2 rounded border border-ds-border p-3">
          <div>{link.permission === 'edit' ? text('可编辑', 'Can edit') : text('可评论', 'Can comment')} · {link.revoked ? text('已撤销', 'Revoked') : text('有效', 'Active')}</div>
          {!link.revoked && url ? <><input aria-label={text('分享链接', 'Share link')} className="w-full" readOnly value={url} onFocus={event => event.target.select()} />
            <div className="flex gap-3"><button type="button" onClick={() => { const signal = pending.current?.signal; void navigator.clipboard.writeText(url).then(() => { if (signal && !signal.aborted) setCopied(link.id) }).catch(() => { if (signal && !signal.aborted) setError(text('无法复制，请选中链接手动复制。', 'Could not copy. Select the link and copy it manually.')) }) }}>{copied === link.id ? text('已复制', 'Copied') : text('复制链接', 'Copy link')}</button></div></> : null}
          {!link.revoked ? <button type="button" disabled={busy} onClick={() => { void run(async signal => { await document.revoke(link, signal); if (!signal.aborted) setLinks(current => current.map(item => item.id === link.id ? { ...item, revoked: true } : item)) }) }}>{text('撤销链接', 'Revoke link')}</button> : null}
        </li> })}</ul>
      </section>
    </div> : null}
  </>
}
