import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import { DELIVERY_MAX_FILE_COUNT, DEFAULT_DELIVERY_ADMISSION_MAX_TOTAL_BYTES, DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES } from '@sciforge/collaboration-contracts'
import { deliveryOutputMaxBytes } from '../../../delivery-material-policy.js'
import { formatBytes } from '../files/format-bytes.js'
import type { DeliveryDraftFile } from './delivery-draft-types.js'


export function deliverySourceLabel(source: DeliveryDraftFile['source']): string {
  return source === 'unknown' ? cw("历史文件") : source === 'member' ? cw("成员添加") : source === 'attachment' ? cw("会话附件") : cw("AI 产出")
}

export function deliveryTotalBytes(files: readonly DeliveryDraftFile[]): number {
  return files.reduce((total, file) => total + file.byteCount, 0)
}

export function deliveryLimitError(files: readonly DeliveryDraftFile[]): string | null {
  let bytes = 0
  for (const [index, file] of files.entries()) {
    if (index >= DELIVERY_MAX_FILE_COUNT) return cw("“{{value0}}”是第 {{value1}} 项，超过 {{value2}} 项上限。请移除附加资料后再提交。", { value0: file.name, value1: index + 1, value2: DELIVERY_MAX_FILE_COUNT })
    if (file.maxBytes === undefined && file.byteCount > DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES) return cw("“{{name}}”超过单文件上限 {{bytes}} 字节。", { name: file.name, bytes: DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES })
    if (file.maxBytes !== undefined && file.byteCount === 0 && !file.unavailable) return cw("必交文件“{{name}}”不能为空。", { name: file.name })
    if (file.maxBytes !== undefined && file.byteCount > deliveryOutputMaxBytes(file.maxBytes)) return cw("“{{value0}}”超过必交文件的有效上限 {{value1}} 字节。", { value0: file.name, value1: deliveryOutputMaxBytes(file.maxBytes) })
    bytes += file.byteCount
    if (bytes > DEFAULT_DELIVERY_ADMISSION_MAX_TOTAL_BYTES) return cw("“{{value0}}”（{{value1}}）使总大小超过 {{value2}} MiB。请移除或更换该文件。", { value0: file.name, value1: formatBytes(file.byteCount), value2: DEFAULT_DELIVERY_ADMISSION_MAX_TOTAL_BYTES / 1024 / 1024 })
  }
  return null
}

export function DeliveryTotal({ files, showLimit = true }: Readonly<{ files: readonly DeliveryDraftFile[]; showLimit?: boolean }>): ReactElement {
  useWorkspaceTranslation()
  return <p className="collaboration-workspace-delivery-meta" data-testid="delivery-total">{cw("共")}{' '}{files.length}{' '}{cw("项 ·")}{' '}{formatBytes(deliveryTotalBytes(files))}{showLimit ? ` / ${DEFAULT_DELIVERY_ADMISSION_MAX_TOTAL_BYTES / 1024 / 1024} MiB` : ''}{showLimit ? <small>{cw("单文件最多 {{size}} MiB；最多 {{count}} 项（包含必交文件）。", { size: DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES / 1024 / 1024, count: DELIVERY_MAX_FILE_COUNT })}{cw("为兼容未升级客户端，本机按 200 MiB 提交；服务端大容量尚未确认启用。任务、类型和网关可能有更小限制。")}</small> : null}</p>
}

/** Attachment storage paths are private implementation details, including in labels and tooltips. */
export function DeliveryFileInfo({ file, required = false }: Readonly<{ file: DeliveryDraftFile; required?: boolean }>): ReactElement {
  useWorkspaceTranslation()
  const path = file.source !== 'attachment' && !file.relativePath.startsWith('.sciforge/uploads/') && file.relativePath !== file.name ? file.relativePath : null
  const details = [path, file.unavailable ? cw("文件不可用") : file.mediaType, file.unavailable ? null : formatBytes(file.byteCount), file.maxBytes === undefined ? null : cw("本地有效上限 {{value0}}", { value0: formatBytes(deliveryOutputMaxBytes(file.maxBytes)) })].filter(Boolean).join(' · ')
  return <span className="collaboration-workspace-delivery-file-info">
    <strong><span className="collaboration-workspace-delivery-file-name" title={file.name}>{file.name}</span><span className="collaboration-workspace-delivery-required" data-testid={required ? 'delivery-file-required' : 'delivery-file-source'}>{required ? cw("必交 · {{value0}}", { value0: file.unavailable ? cw("待提供") : deliverySourceLabel(file.source) }) : deliverySourceLabel(file.source)}</span></strong>
    <small className="collaboration-workspace-delivery-file-details" title={details}>{details}</small>
  </span>
}

export function DeliveryFileList({ files, required = false, onPreview, onRemove, onReplace, busy = false }: Readonly<{
  files: readonly DeliveryDraftFile[]
  required?: boolean
  busy?: boolean
  onPreview?(file: DeliveryDraftFile): void
  onReplace?(file: DeliveryDraftFile): void
  onRemove?(file: DeliveryDraftFile): void
}>): ReactElement {
  useWorkspaceTranslation()
  return <ul className="collaboration-workspace-delivery-files collaboration-workspace-delivery-content-list">
    {files.map((file) => <li key={file.id} data-testid="delivery-file-row">
      <DeliveryFileInfo file={file} required={required} />
      <div className="collaboration-workspace-delivery-file-actions">
        {onReplace && required ? <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-declared-replace" disabled={busy} onClick={() => onReplace(file)}>{file.unavailable ? cw("选择必交文件") : cw("替换必交文件")}</button> : null}
        {onPreview ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-preview" aria-label={cw("预览 {{value0}}", { value0: file.name })} disabled={busy || file.unavailable} onClick={() => onPreview(file)}>{cw("预览")}</button> : null}
        {onRemove && !required ? <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-file-remove" aria-label={cw("移除 {{value0}}", { value0: file.name })} disabled={busy} onClick={() => onRemove(file)}>{cw("移除")}</button> : null}
      </div>
    </li>)}
  </ul>
}

export function DeliveryContent({ declaredFiles, additionalFiles = [], showAdditional = false, readOnly = false, busy = false, onPreview, onRemove, onAdd, onReplaceDeclared }: Readonly<{
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles?: readonly DeliveryDraftFile[]
  showAdditional?: boolean
  readOnly?: boolean
  busy?: boolean
  onPreview?(file: DeliveryDraftFile): void
  onRemove?(file: DeliveryDraftFile): void
  onReplaceDeclared?(file: DeliveryDraftFile): void
  onAdd?(): void
}>): ReactElement {
  useWorkspaceTranslation()
  const files = [...declaredFiles, ...(showAdditional ? additionalFiles : [])]
  const error = showAdditional && !readOnly ? deliveryLimitError(files) : null
  return <section className="collaboration-workspace-delivery-file-section" aria-label={cw("提交内容")} data-testid="delivery-files">
    <h4>{cw("提交内容")}</h4>
    <section className="collaboration-workspace-delivery-file-group" aria-label={cw("任务产出")} data-testid="delivery-declared-files">
      <h5>{cw("任务产出")}</h5>
      {declaredFiles.length ? <DeliveryFileList files={declaredFiles} required busy={busy} onPreview={onPreview} onReplace={onReplaceDeclared} /> : <p className="collaboration-workspace-delivery-meta">{cw("本任务没有声明的输出文件。")}</p>}
    </section>
    {showAdditional ? <section className="collaboration-workspace-delivery-file-group" aria-label={cw("附加资料")} data-testid="delivery-additional-files">
      <div className="collaboration-workspace-delivery-group-header">
        <h5>{cw("附加资料")}</h5>
        {onAdd ? <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-add-materials" disabled={busy || Boolean(error)} onClick={onAdd}>{cw("添加资料")}</button> : null}
      </div>
      {additionalFiles.length ? <DeliveryFileList files={additionalFiles} busy={busy} onPreview={onPreview} onRemove={onRemove} /> : <p className="collaboration-workspace-delivery-empty" data-testid="delivery-materials-empty">{readOnly ? cw("未包含附加资料") : cw("还没有附加资料。你可以把数据、图表或其他文件作为本次交付的一部分。")}</p>}
    </section> : null}
    <DeliveryTotal files={files} showLimit={showAdditional} />
    {error ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-limit-error" role="alert">{error}</p> : null}
  </section>
}
