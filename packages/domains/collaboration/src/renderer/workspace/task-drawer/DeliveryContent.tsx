import React, { type ReactElement } from 'react'
import { DELIVERY_MAX_FILE_COUNT, DELIVERY_MAX_TOTAL_BYTES } from '@sciforge/collaboration-contracts'
import { formatBytes } from '../files/format-bytes.js'
import type { DeliveryDraftFile } from './delivery-draft-types.js'


export function deliverySourceLabel(source: DeliveryDraftFile['source']): string {
  return source === 'unknown' ? '历史文件' : source === 'member' ? '我添加的' : source === 'attachment' ? '会话附件' : 'AI 产出'
}

export function deliveryTotalBytes(files: readonly DeliveryDraftFile[]): number {
  return files.reduce((total, file) => total + file.byteCount, 0)
}

export function deliveryLimitError(files: readonly DeliveryDraftFile[]): string | null {
  let bytes = 0
  for (const [index, file] of files.entries()) {
    if (index >= DELIVERY_MAX_FILE_COUNT) return `“${file.name}”是第 ${index + 1} 项，超过 ${DELIVERY_MAX_FILE_COUNT} 项上限。请移除附加资料后再提交。`
    bytes += file.byteCount
    if (bytes > DELIVERY_MAX_TOTAL_BYTES) return `“${file.name}”（${formatBytes(file.byteCount)}）使总大小超过 200 MB。请移除或更换该文件。`
  }
  return null
}

export function DeliveryTotal({ files, showLimit = true }: Readonly<{ files: readonly DeliveryDraftFile[]; showLimit?: boolean }>): ReactElement {
  return <p className="collaboration-workspace-delivery-meta" data-testid="delivery-total">共 {files.length} 项 · {formatBytes(deliveryTotalBytes(files))}{showLimit ? ' / 200 MB' : ''}</p>
}

/** Attachment storage paths are private implementation details, including in labels and tooltips. */
export function DeliveryFileInfo({ file, required = false }: Readonly<{ file: DeliveryDraftFile; required?: boolean }>): ReactElement {
  const path = file.source !== 'attachment' && !file.relativePath.startsWith('.sciforge/uploads/') && file.relativePath !== file.name ? file.relativePath : null
  const details = [path, file.unavailable ? '文件不可用' : file.mediaType, file.unavailable ? null : formatBytes(file.byteCount)].filter(Boolean).join(' · ')
  return <span className="collaboration-workspace-delivery-file-info">
    <strong><span className="collaboration-workspace-delivery-file-name" title={file.name}>{file.name}</span><span className="collaboration-workspace-delivery-required" data-testid={required ? 'delivery-file-required' : 'delivery-file-source'}>{required && file.source !== 'unknown' ? '必交 · AI 产出' : deliverySourceLabel(file.source)}</span></strong>
    <small className="collaboration-workspace-delivery-file-details" title={details}>{details}</small>
  </span>
}

export function DeliveryFileList({ files, required = false, onPreview, onRemove, busy = false }: Readonly<{
  files: readonly DeliveryDraftFile[]
  required?: boolean
  busy?: boolean
  onPreview?(file: DeliveryDraftFile): void
  onRemove?(file: DeliveryDraftFile): void
}>): ReactElement {
  return <ul className="collaboration-workspace-delivery-files collaboration-workspace-delivery-content-list">
    {files.map((file) => <li key={file.id} data-testid="delivery-file-row">
      <DeliveryFileInfo file={file} required={required} />
      <div className="collaboration-workspace-delivery-file-actions">
        {onPreview ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-preview" aria-label={`预览 ${file.name}`} disabled={busy || file.unavailable} onClick={() => onPreview(file)}>预览</button> : null}
        {onRemove && !required ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-remove" aria-label={`移除 ${file.name}`} disabled={busy} onClick={() => onRemove(file)}>移除</button> : null}
      </div>
    </li>)}
  </ul>
}

export function DeliveryContent({ declaredFiles, additionalFiles = [], showAdditional = false, readOnly = false, busy = false, onPreview, onRemove, onAdd }: Readonly<{
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles?: readonly DeliveryDraftFile[]
  showAdditional?: boolean
  readOnly?: boolean
  busy?: boolean
  onPreview?(file: DeliveryDraftFile): void
  onRemove?(file: DeliveryDraftFile): void
  onAdd?(): void
}>): ReactElement {
  const files = [...declaredFiles, ...(showAdditional ? additionalFiles : [])]
  const error = showAdditional ? deliveryLimitError(files) : null
  return <section className="collaboration-workspace-delivery-file-section" aria-label="提交内容" data-testid="delivery-files">
    <h4>提交内容</h4>
    <section className="collaboration-workspace-delivery-file-group" aria-label="任务产出" data-testid="delivery-declared-files">
      <h5>任务产出</h5>
      {declaredFiles.length ? <DeliveryFileList files={declaredFiles} required busy={busy} onPreview={onPreview} /> : <p className="collaboration-workspace-delivery-meta">本任务没有声明的输出文件。</p>}
    </section>
    {showAdditional ? <section className="collaboration-workspace-delivery-file-group" aria-label="附加资料" data-testid="delivery-additional-files">
      <div className="collaboration-workspace-delivery-group-header">
        <h5>附加资料</h5>
        {onAdd ? <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-add-materials" disabled={busy || Boolean(error)} onClick={onAdd}>添加资料</button> : null}
      </div>
      {additionalFiles.length ? <DeliveryFileList files={additionalFiles} busy={busy} onPreview={onPreview} onRemove={onRemove} /> : <p className="collaboration-workspace-delivery-empty" data-testid="delivery-materials-empty">{readOnly ? '未包含附加资料' : '还没有附加资料。你可以把数据、图表或其他文件作为本次交付的一部分。'}</p>}
    </section> : null}
    <DeliveryTotal files={files} showLimit={showAdditional} />
    {error ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-limit-error" role="alert">{error}</p> : null}
  </section>
}
