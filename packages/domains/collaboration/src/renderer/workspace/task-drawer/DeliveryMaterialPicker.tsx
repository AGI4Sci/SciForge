import React, { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { WORKSPACE_ATTACHMENT_ACCEPT } from '@sciforge/domain-sdk/attachment-policy'
import { DeliveryDialog } from './DeliveryDialog.js'
import { DeliveryFileInfo, DeliveryTotal, deliveryLimitError, deliverySourceLabel } from './DeliveryContent.js'
import type { DeliveryDraftFile, DeliveryMaterialSelection } from './delivery-draft-types.js'

export function DeliveryMaterialPicker({ selection, declaredFiles, additionalFiles, onConfirm, onClose }: Readonly<{
  selection: DeliveryMaterialSelection
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles: readonly DeliveryDraftFile[]
  onConfirm(files: readonly DeliveryDraftFile[]): void
  onClose(): void
}>): ReactElement {
  const titleId = useId()
  const taskPanelId = useId()
  const uploadPanelId = useId()
  const taskTab = useRef<HTMLButtonElement>(null)
  const uploadTab = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<'task' | 'upload'>('task')
  const [query, setQuery] = useState('')
  const [listed, setListed] = useState<readonly DeliveryDraftFile[]>(selection.files)
  const encountered = useRef(new Map<string, DeliveryDraftFile>())
  for (const file of listed) encountered.current.set(file.id, file)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const listSequence = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const list = useRef(selection.onList)
  list.current = selection.onList
  const load = async (nextCursor?: string): Promise<void> => {
    if (!list.current) return
    const sequence = ++listSequence.current
    setLoading(true)
    setListError(null)
    try {
      const result = await list.current({ ...(query.trim() ? { query: query.trim() } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) })
      if (sequence !== listSequence.current) return
      setListed((current) => nextCursor ? [...current, ...result.files] : result.files)
      setCursor(result.nextCursor)
      setTruncated(Boolean(result.truncated))
    } catch (cause) { if (sequence === listSequence.current) setListError(cause instanceof Error ? cause.message : '任务文件读取失败，请重试。') }
    finally { if (sequence === listSequence.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { listSequence.current += 1 } }, [query])
  const [selected, setSelected] = useState(() => new Set(additionalFiles.map((file) => file.id)))
  const [uploaded, setUploaded] = useState<readonly DeliveryDraftFile[]>([])
  const [uploading, setUploading] = useState(false)
  const uploadingRef = useRef(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedCount, setUploadedCount] = useState(0)
  const declaredIds = new Set(declaredFiles.map((file) => file.id))
  const declaredPaths = new Set(declaredFiles.map((file) => file.relativePath))
  const available = [...new Map([...encountered.current.values(), ...additionalFiles, ...uploaded].map((file) => [file.id, file])).values()]
    .filter((file) => !declaredIds.has(file.id) && !declaredPaths.has(file.relativePath))
    .sort((a, b) => Number(b.source === 'attachment') - Number(a.source === 'attachment'))
  const selectedFiles = available.filter((file) => selected.has(file.id))
  const allFiles = [...declaredFiles, ...selectedFiles]
  const limitError = deliveryLimitError(allFiles)
  const visible = available.filter((file) => `${file.name} ${file.source === 'attachment' ? '' : file.relativePath}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const uploadedFile = (file: DeliveryDraftFile): void => {
    setUploaded((current) => [...new Map([...current, file].map((entry) => [entry.id, entry])).values()])
    setSelected((current) => new Set([...current, file.id]))
    setUploadedCount((current) => current + 1)
  }
  const upload = async (inputFiles: readonly File[]): Promise<void> => {
    if (!selection.onUpload || uploadingRef.current) return
    uploadingRef.current = true
    setUploading(true)
    setUploadError(null)
    setUploadedCount(0)
    try {
      const files = await selection.onUpload(inputFiles, uploadedFile)
      setUploaded((current) => [...new Map([...current, ...files].map((file) => [file.id, file])).values()])
      setSelected((current) => new Set([...current, ...files.map((file) => file.id)]))
      setUploadedCount(files.length)
    } catch (cause) {
      setUploadError(`${cause instanceof Error ? cause.message : '上传失败'}。已选择的资料已保留，请再次上传。`)
    } finally {
      uploadingRef.current = false
      setUploading(false)
    }
  }
  return <DeliveryDialog titleId={titleId} testId="delivery-material-picker" busy={uploading} onClose={onClose}>
    <h2 id={titleId}>添加资料</h2>
    <div className="collaboration-workspace-delivery-tabs" role="tablist" aria-label="资料来源" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'task' : event.key === 'End' ? 'upload' : tab === 'task' ? 'upload' : 'task'
      setTab(next)
      ;(next === 'task' ? taskTab : uploadTab).current?.focus()
    }}>
      <button ref={taskTab} id={`${taskPanelId}-tab`} type="button" role="tab" aria-selected={tab === 'task'} aria-controls={taskPanelId} tabIndex={tab === 'task' ? 0 : -1} className="collaboration-workspace-button-ghost" data-testid="delivery-material-task-tab" disabled={uploading} onClick={() => setTab('task')}>任务文件</button>
      <button ref={uploadTab} id={`${uploadPanelId}-tab`} type="button" role="tab" aria-selected={tab === 'upload'} aria-controls={uploadPanelId} tabIndex={tab === 'upload' ? 0 : -1} className="collaboration-workspace-button-ghost" data-testid="delivery-material-upload-tab" disabled={uploading} onClick={() => setTab('upload')}>从本机上传</button>
    </div>
    {tab === 'task' ? <div id={taskPanelId} role="tabpanel" aria-labelledby={`${taskPanelId}-tab`} className="collaboration-workspace-delivery-picker-panel">
      <label className="collaboration-workspace-delivery-search"><span>搜索任务文件</span><input type="search" data-testid="delivery-material-search" placeholder="按文件名或相对路径搜索" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="collaboration-workspace-delivery-meta">仅显示本次任务工作目录中的文件，会话附件排在最前。任务产出已包含，无需重复选择。</p>
      <ul className="collaboration-workspace-delivery-picker-files" data-testid="delivery-material-options">
        {visible.map((file) => <li key={file.id}>
          <label className="collaboration-workspace-delivery-picker-option">
            <input type="checkbox" data-testid="delivery-material-checkbox" aria-label={`选择 ${file.name}（${deliverySourceLabel(file.source)}）`} checked={selected.has(file.id)} disabled={Boolean(limitError) && !selected.has(file.id)} onChange={(event) => setSelected((current) => {
              const next = new Set(current)
              if (event.target.checked) next.add(file.id)
              else next.delete(file.id)
              return next
            })} />
            <DeliveryFileInfo file={file} />
          </label>
        </li>)}
      </ul>
      {loading ? <p role="status" data-testid="delivery-material-loading">正在读取任务文件…</p> : null}
      {listError ? <p role="alert" data-testid="delivery-material-list-error">{listError}<button type="button" className="collaboration-workspace-button-ghost" onClick={() => { void load() }}>重新读取</button></p> : null}
      {cursor ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-material-more" disabled={loading} onClick={() => { void load(cursor) }}>显示更多文件</button> : null}
      {truncated ? <p className="collaboration-workspace-delivery-meta" role="status">目录较大，请输入更具体的文件名查找。</p> : null}
      {!visible.length && !loading ? <p className="collaboration-workspace-delivery-empty" data-testid="delivery-material-search-empty">{query.trim() ? '没有找到匹配的任务文件。' : '暂无可添加的任务文件，可以从本机上传。'}</p> : null}
    </div> : <div id={uploadPanelId} role="tabpanel" aria-labelledby={`${uploadPanelId}-tab`} className="collaboration-workspace-delivery-picker-panel">
      <input ref={fileInput} type="file" multiple hidden accept={WORKSPACE_ATTACHMENT_ACCEPT} data-testid="delivery-material-file-input" onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length) void upload(files)
      }} />
      <p>选择本机文件后，文件会复制到本次任务工作目录，并自动勾选。</p>
      <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-material-upload" disabled={!selection.onUpload || uploading || Boolean(limitError)} onClick={() => fileInput.current?.click()}>{uploading ? '正在上传…' : '选择本机文件'}</button>
      {uploading ? <div className="collaboration-workspace-delivery-upload-progress" data-testid="delivery-material-upload-progress" role="status"><progress aria-label="正在将资料复制到任务工作目录" /><span>正在将资料复制到任务工作目录…</span></div> : null}
      {uploadedCount ? <p className="collaboration-workspace-delivery-meta" data-testid="delivery-material-upload-complete" role="status">已上传并勾选 {uploadedCount} 项资料。</p> : null}
      {uploadError ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-material-upload-error" role="alert">{uploadError}</p> : null}
      {uploaded.length ? <ul className="collaboration-workspace-delivery-uploaded-files">{uploaded.map((file) => <li key={file.id}>{file.name} · 已勾选</li>)}</ul> : null}
    </div>}
    <div className="collaboration-workspace-delivery-picker-footer">
      <DeliveryTotal files={allFiles} />
      {limitError ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-material-limit-error" role="alert">{limitError}</p> : null}
      <div className="collaboration-workspace-dialog-actions">
        <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-material-cancel" disabled={uploading} onClick={onClose}>取消</button>
        <button type="button" className="collaboration-workspace-button-primary" data-testid="delivery-material-confirm" disabled={uploading || Boolean(limitError)} onClick={() => onConfirm(selectedFiles)}>添加所选资料（{selectedFiles.length}）</button>
      </div>
    </div>
  </DeliveryDialog>
}
