import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import { FileText, ArrowRight } from 'lucide-react'
import { deliverySourceLabel } from '../task-drawer/DeliveryContent.js'
import { formatWorkspaceTime } from '../format-time.js'
import { formatBytes } from './format-bytes.js'
import type { DeliveryFileEntry, DeliveryFileGroup } from './delivery-files.js'

function FileRows({ files, onPreview }: Readonly<{ files: readonly DeliveryFileEntry[]; onPreview(file: DeliveryFileEntry): void }>): ReactElement {
  useWorkspaceTranslation()
  return <ul className="collaboration-workspace-personal-list">{files.map((file) => {
    const path = file.source !== 'attachment' && file.relativePath && !file.relativePath.startsWith('.sciforge/uploads/') && file.relativePath !== file.name ? file.relativePath : null
    return <li key={file.key} className="collaboration-workspace-file-row" data-testid="delivery-drive-file">
      <FileText aria-hidden="true" />
      <span><strong>{file.name}{file.source ? <span className="collaboration-workspace-delivery-required" data-testid="delivery-file-source">{file.role === 'declared' ? cw("必交 · {{v0}}", { v0: deliverySourceLabel(file.source) }) : deliverySourceLabel(file.source)}</span> : null}</strong><small title={file.descriptor ? `SHA256 ${file.descriptor.sha256}` : undefined}>{path ? `${path} · ` : ''}{file.mediaType} · {formatBytes(file.byteCount)} · {cw("第 {{revision}} 版", { revision: file.revision })}{file.descriptor ? ` · SHA256 ${file.descriptor.sha256.slice(0, 12)}…` : ''}{file.projectVersion ? ` · ${cw('项目成果 v{{version}} · 已采纳', { version: file.projectVersion })}` : ''}{file.adoptedAt ? ` · ${formatWorkspaceTime(file.adoptedAt)}` : ''}</small></span>
      <button type="button" className="collaboration-workspace-button-ghost" aria-label={cw("预览 {{v0}}", { v0: file.name })} onClick={() => onPreview(file)}>{cw("预览")}</button>
    </li>
  })}</ul>
}

/**
 * The 共享文件 page lists what the Drive project exposes. The Collaboration
 * contract has one read capability here (`collaboration.delivery.drive.list`)
 * and no capability that stages a Project file. The action opens the existing
 * task delivery flow, where files can be submitted and sealed.
 */
export function FilesView({ groups, loading, onPreview, onOpenTaskDeliveries }: Readonly<{ groups: readonly DeliveryFileGroup[]; loading: boolean; onPreview(file: DeliveryFileEntry): void; onOpenTaskDeliveries?(): void }>): ReactElement {
  useWorkspaceTranslation()
  return <section className="collaboration-workspace-page-panel collaboration-workspace-files-page">
    <header className="collaboration-workspace-page-header">
      <div><h2>{cw("共享文件")}</h2><p>{cw("共享资料、任务交付与项目成果。")}</p></div>
      <div className="collaboration-workspace-files-actions">
        {onOpenTaskDeliveries ? <button type="button" className="collaboration-workspace-button-secondary" data-testid="files-task-deliveries" onClick={onOpenTaskDeliveries}>
          {cw('前往任务交付')}<ArrowRight aria-hidden="true" /></button> : null}
      </div>
    </header>
    <p className="collaboration-workspace-files-upload-note">{cw('共享文件来自任务交付。在任务中选择本机文件并提交，封存后会同步到这里；采纳后会出现在项目成果中。')}</p>
    {loading ? <div className="collaboration-workspace-personal-list" aria-busy="true"><div className="collaboration-workspace-personal-row is-skeleton"><span className="collaboration-workspace-skeleton-line" /></div></div> : groups.map((group) => {
      const versions = new Map<string, DeliveryFileEntry[]>()
      for (const file of group.files) {
        const key = file.descriptor?.deliveryManifestId ?? file.key
        versions.set(key, [...versions.get(key) ?? [], file])
      }
      return <section key={group.id} className="collaboration-workspace-file-group">
        <h3 className="collaboration-workspace-group-title">{cw(group.title)}{group.files.length ? <span className="collaboration-workspace-count">{group.files.length}</span> : null}</h3>
        {!group.files.length ? <p className="collaboration-workspace-section-empty">{cw(group.empty)}</p> : group.id !== 'delivery' ? <FileRows files={group.files} onPreview={onPreview} /> : [...versions.entries()].map(([id, entries]) => <article key={id} data-testid="delivery-file-version">
          <h4 className="collaboration-workspace-group-title">{cw("第 {{revision}} 版", { revision: entries[0]!.revision })}{entries[0]!.submitter ? ` · ${entries[0]!.submitter}` : ''}{entries[0]!.submittedAt ? ` · ${formatWorkspaceTime(entries[0]!.submittedAt!)}` : ''}</h4>
          <FileRows files={entries} onPreview={onPreview} />
        </article>)}
      </section>
    })}
  </section>
}
