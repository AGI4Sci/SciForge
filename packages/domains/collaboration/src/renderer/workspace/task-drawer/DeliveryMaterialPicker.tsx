import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { DELIVERY_MATERIAL_ACCEPT, DELIVERY_ADDITIONAL_MATERIAL_ACCEPT, additionalDeliveryMaterialKind, deliveryMaterialKind, deliveryMaterialMaxBytes, deliveryOutputMaxBytes, deliveryMaterialAdmissionError } from '../../../delivery-material-policy.js'
import { DeliveryDialog } from './DeliveryDialog.js'
import { DeliveryFileInfo, DeliveryTotal, deliveryLimitError, deliverySourceLabel } from './DeliveryContent.js'
import type { DeliveryDraftFile, DeliveryMaterialSelection } from './delivery-draft-types.js'

export function DeliveryMaterialPicker({ selection, declaredFiles, additionalFiles, requiredOutput, disabled = false, onConfirm, onClose }: Readonly<{
  disabled?: boolean
  requiredOutput?: DeliveryDraftFile
  selection: DeliveryMaterialSelection
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles: readonly DeliveryDraftFile[]
  onConfirm(files: readonly DeliveryDraftFile[]): void
  onClose(): void
}>): ReactElement {
  useWorkspaceTranslation()
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
    } catch (cause) { if (sequence === listSequence.current) setListError(cause instanceof Error ? cause.message : cw("任务文件读取失败，请重试。")) }
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
  const limitError = selectedFiles.map((file) => deliveryMaterialAdmissionError({ name: file.name, byteCount: file.byteCount }, requiredOutput ? { mediaType: requiredOutput.mediaType, maxBytes: requiredOutput.maxBytes ?? Infinity } : null)).find(Boolean) ?? deliveryLimitError(allFiles)
  const visible = available.filter((file) => !deliveryMaterialAdmissionError({ name: file.name, byteCount: file.byteCount }, requiredOutput ? { mediaType: requiredOutput.mediaType, maxBytes: requiredOutput.maxBytes ?? Infinity } : null) && `${file.name} ${file.source === 'attachment' ? '' : file.relativePath}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const uploadedFile = (file: DeliveryDraftFile): void => {
    setUploaded((current) => [...new Map([...current, file].map((entry) => [entry.id, entry])).values()])
    setSelected((current) => new Set(requiredOutput ? [file.id] : [...current, file.id]))
    setUploadedCount((current) => current + 1)
  }
  const upload = async (inputFiles: readonly File[]): Promise<void> => {
    if (disabled || !selection.onUpload || uploadingRef.current) return
    uploadingRef.current = true
    setUploading(true)
    setUploadError(null)
    setUploadedCount(0)
    try {
      const incoming = requiredOutput ? inputFiles.slice(0, 1) : inputFiles
      for (const file of incoming) {
        const admissionError = deliveryMaterialAdmissionError({ name: file.name, byteCount: file.size }, requiredOutput ? { mediaType: requiredOutput.mediaType, maxBytes: requiredOutput.maxBytes ?? Infinity } : null)
        if (admissionError) throw new Error(`${file.name}：${admissionError}`)
        const kind = requiredOutput ? deliveryMaterialKind(file) : additionalDeliveryMaterialKind(file)
        if (kind === 'unsupported') throw new Error(cw("附加资料不支持 ZIP；ZIP 仅可作为任务声明的必交文件。"))
        const max = Math.min(deliveryMaterialMaxBytes(kind), requiredOutput?.maxBytes === undefined ? Infinity : deliveryOutputMaxBytes(requiredOutput.maxBytes))
        if (file.size > max) throw new Error(cw("“{{value0}}”超过本地导入上限 {{value1}} 字节。", { value0: file.name, value1: max }))
      }
      const incomingLimit = deliveryLimitError([...(requiredOutput ? [] : [...declaredFiles, ...selectedFiles]), ...incoming.map((file) => ({ id: file.name, name: file.name, relativePath: file.name, byteCount: file.size, mediaType: file.type, source: 'member' as const }))])
      if (incomingLimit) throw new Error(incomingLimit)
      const files = await selection.onUpload(incoming, uploadedFile)
      setUploaded((current) => [...new Map([...current, ...files].map((file) => [file.id, file])).values()])
      setSelected((current) => new Set(requiredOutput ? files.slice(-1).map((file) => file.id) : [...current, ...files.map((file) => file.id)]))
      setUploadedCount(files.length)
    } catch (cause) {
      setUploadError(cw("{{value0}}。已选择的资料已保留，请再次上传。", { value0: cause instanceof Error ? cause.message : cw("上传失败") }))
    } finally {
      uploadingRef.current = false
      setUploading(false)
    }
  }
  return <DeliveryDialog titleId={titleId} testId="delivery-material-picker" busy={uploading || disabled} onClose={onClose}>
    <h2 id={titleId}>{requiredOutput ? cw("选择必交文件：{{value0}}", { value0: requiredOutput.name }) : cw("添加资料")}</h2>
    {!requiredOutput ? <p>{cw("附加资料不支持 ZIP；ZIP 仅可作为任务声明的必交文件。")}</p> : null}
    {requiredOutput ? <p>{cw("选择或上传一份文件作为「")}{requiredOutput.name}{cw("」交付；保留原文件，不覆盖任务目录中的文件。")} {cw("格式：{{type}}；任务有效上限 {{task}} 字节；本机导入上限 {{import}} 字节；必交文件不能为空。", { type: requiredOutput.mediaType, task: deliveryOutputMaxBytes(requiredOutput.maxBytes ?? Infinity), import: Math.min(deliveryOutputMaxBytes(requiredOutput.maxBytes ?? Infinity), deliveryMaterialMaxBytes(deliveryMaterialKind(requiredOutput))) })}</p> : null}
    <div className="collaboration-workspace-delivery-tabs" role="tablist" aria-label={cw("资料来源")} onKeyDown={(event) => {
      if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'task' : event.key === 'End' ? 'upload' : tab === 'task' ? 'upload' : 'task'
      setTab(next)
      ;(next === 'task' ? taskTab : uploadTab).current?.focus()
    }}>
      <button ref={taskTab} id={`${taskPanelId}-tab`} type="button" role="tab" aria-selected={tab === 'task'} aria-controls={taskPanelId} tabIndex={tab === 'task' ? 0 : -1} className="collaboration-workspace-button-ghost" data-testid="delivery-material-task-tab" disabled={uploading || disabled} onClick={() => setTab('task')}>{cw("任务文件")}</button>
      <button ref={uploadTab} id={`${uploadPanelId}-tab`} type="button" role="tab" aria-selected={tab === 'upload'} aria-controls={uploadPanelId} tabIndex={tab === 'upload' ? 0 : -1} className="collaboration-workspace-button-ghost" data-testid="delivery-material-upload-tab" disabled={uploading || disabled} onClick={() => setTab('upload')}>{cw("从本机上传")}</button>
    </div>
    {tab === 'task' ? <div id={taskPanelId} role="tabpanel" aria-labelledby={`${taskPanelId}-tab`} className="collaboration-workspace-delivery-picker-panel">
      <label className="collaboration-workspace-delivery-search"><span>{cw("搜索任务文件")}</span><input type="search" disabled={disabled} data-testid="delivery-material-search" placeholder={cw("按文件名或相对路径搜索")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="collaboration-workspace-delivery-meta">{cw("仅显示本次任务工作目录中的文件，会话附件排在最前。任务产出已包含，无需重复选择。")}</p>
      <ul className="collaboration-workspace-delivery-picker-files" data-testid="delivery-material-options">
        {visible.map((file) => <li key={file.id}>
          <label className="collaboration-workspace-delivery-picker-option">
            <input type={requiredOutput ? 'radio' : 'checkbox'} name={requiredOutput ? titleId : undefined} data-testid="delivery-material-checkbox" aria-label={cw("选择 {{value0}}（{{value1}}）", { value0: file.name, value1: deliverySourceLabel(file.source) })} checked={selected.has(file.id)} disabled={disabled || (!requiredOutput && Boolean(limitError) && !selected.has(file.id))} onChange={(event) => setSelected((current) => {
              const next = new Set(requiredOutput ? [] : current)
              if (event.target.checked) next.add(file.id)
              else next.delete(file.id)
              return next
            })} />
            <DeliveryFileInfo file={file} />
          </label>
        </li>)}
      </ul>
      {loading ? <p role="status" data-testid="delivery-material-loading">{cw("正在读取任务文件…")}</p> : null}
      {listError ? <p role="alert" data-testid="delivery-material-list-error">{listError}<button type="button" className="collaboration-workspace-button-ghost" disabled={disabled} onClick={() => { void load() }}>{cw("重新读取")}</button></p> : null}
      {cursor ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-material-more" disabled={disabled || loading} onClick={() => { void load(cursor) }}>{cw("显示更多文件")}</button> : null}
      {truncated ? <p className="collaboration-workspace-delivery-meta" role="status">{cw("目录较大，请输入更具体的文件名查找。")}</p> : null}
      {!visible.length && !loading ? <p className="collaboration-workspace-delivery-empty" data-testid="delivery-material-search-empty">{query.trim() ? cw("没有找到匹配的任务文件。") : cw("暂无可添加的任务文件，可以从本机上传。")}</p> : null}
    </div> : <div id={uploadPanelId} role="tabpanel" aria-labelledby={`${uploadPanelId}-tab`} className="collaboration-workspace-delivery-picker-panel">
      <input ref={fileInput} type="file" disabled={disabled} multiple={!requiredOutput} hidden accept={requiredOutput ? DELIVERY_MATERIAL_ACCEPT : DELIVERY_ADDITIONAL_MATERIAL_ACCEPT} data-testid="delivery-material-file-input" onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length) void upload(files)
      }} />
      <p>{cw("选择本机文件后，文件会复制到本次任务工作目录，并自动勾选。")}</p>
      <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-material-upload" disabled={disabled || !selection.onUpload || uploading || Boolean(limitError)} onClick={() => fileInput.current?.click()}>{uploading ? cw("正在上传…") : cw("选择本机文件")}</button>
      {uploading ? <div className="collaboration-workspace-delivery-upload-progress" data-testid="delivery-material-upload-progress" role="status"><progress aria-label={cw("正在将资料复制到任务工作目录")} /><span>{cw("正在将资料复制到任务工作目录…")}</span></div> : null}
      {uploadedCount ? <p className="collaboration-workspace-delivery-meta" data-testid="delivery-material-upload-complete" role="status">{cw("已上传并勾选")}{' '}{uploadedCount}{' '}{cw("项资料。")}</p> : null}
      {uploadError ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-material-upload-error" role="alert">{uploadError}</p> : null}
      {uploaded.length ? <ul className="collaboration-workspace-delivery-uploaded-files">{uploaded.map((file) => <li key={file.id}>{file.name}{' '}{cw("· 已勾选")}</li>)}</ul> : null}
    </div>}
    <div className="collaboration-workspace-delivery-picker-footer">
      <DeliveryTotal files={allFiles} />
      {limitError ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-material-limit-error" role="alert">{limitError}</p> : null}
      <div className="collaboration-workspace-dialog-actions">
        <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-material-cancel" disabled={uploading || disabled} onClick={onClose}>{cw("取消")}</button>
        <button type="button" className="collaboration-workspace-button-primary" data-testid="delivery-material-confirm" disabled={disabled || uploading || Boolean(limitError) || Boolean(requiredOutput && selectedFiles.length !== 1)} onClick={() => onConfirm(selectedFiles)}>{requiredOutput ? '用作必交文件' : cw("添加所选资料（{{value0}}）", { value0: selectedFiles.length })}</button>
      </div>
    </div>
  </DeliveryDialog>
}
