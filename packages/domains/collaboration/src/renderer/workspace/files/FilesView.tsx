import React, { type ReactElement } from 'react'
import { FileText } from 'lucide-react'
import { deliverySourceLabel } from '../task-drawer/DeliveryContent.js'
import { formatWorkspaceTime } from '../format-time.js'
import { formatBytes } from './format-bytes.js'
import type { DeliveryFileEntry, DeliveryFileGroup } from './delivery-files.js'

function FileRows({ files, onPreview }: Readonly<{ files: readonly DeliveryFileEntry[]; onPreview(file: DeliveryFileEntry): void }>): ReactElement {
  return <ul className="collaboration-workspace-personal-list">{files.map((file) => {
    const path = file.source !== 'attachment' && file.relativePath && !file.relativePath.startsWith('.sciforge/uploads/') && file.relativePath !== file.name ? file.relativePath : null
    return <li key={file.key} className="collaboration-workspace-file-row" data-testid="delivery-drive-file">
      <FileText aria-hidden="true" />
      <span><strong>{file.name}{file.source ? <span className="collaboration-workspace-delivery-required" data-testid="delivery-file-source">{file.role === 'declared' ? '必交 · AI 产出' : deliverySourceLabel(file.source)}</span> : null}</strong><small>{path ? `${path} · ` : ''}{file.mediaType} · {formatBytes(file.byteCount)} · 第 {file.revision} 版</small></span>
      <button type="button" className="collaboration-workspace-button-ghost" aria-label={`预览 ${file.name}`} onClick={() => onPreview(file)}>预览</button>
    </li>
  })}</ul>
}

export function FilesView({ groups, loading, onPreview }: Readonly<{ groups: readonly DeliveryFileGroup[]; loading: boolean; onPreview(file: DeliveryFileEntry): void }>): ReactElement {
  return <section className="collaboration-workspace-page-panel collaboration-workspace-files-page">
    <header className="collaboration-workspace-page-header"><div><h2>文件</h2><p>共享资料、任务交付与项目成果。</p></div></header>
    {loading ? <div className="collaboration-workspace-personal-list" aria-busy="true"><div className="collaboration-workspace-personal-row is-skeleton"><span className="collaboration-workspace-skeleton-line" /></div></div> : groups.map((group) => {
      const versions = new Map<string, DeliveryFileEntry[]>()
      for (const file of group.files) {
        const key = file.descriptor?.deliveryManifestId ?? file.key
        versions.set(key, [...versions.get(key) ?? [], file])
      }
      return <section key={group.id} className="collaboration-workspace-file-group">
        <h3 className="collaboration-workspace-group-title">{group.title}{group.files.length ? <span className="collaboration-workspace-count">{group.files.length}</span> : null}</h3>
        {!group.files.length ? <p className="collaboration-workspace-section-empty">{group.empty}</p> : group.id !== 'delivery' ? <FileRows files={group.files} onPreview={onPreview} /> : [...versions.entries()].map(([id, entries]) => <article key={id} data-testid="delivery-file-version">
          <h4 className="collaboration-workspace-group-title">第 {entries[0]!.revision} 版{entries[0]!.submitter ? ` · ${entries[0]!.submitter}` : ''}{entries[0]!.submittedAt ? ` · ${formatWorkspaceTime(entries[0]!.submittedAt!)}` : ''}</h4>
          <FileRows files={entries} onPreview={onPreview} />
        </article>)}
      </section>
    })}
  </section>
}
