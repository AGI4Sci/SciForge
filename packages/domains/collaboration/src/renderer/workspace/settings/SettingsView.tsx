import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { statusLabel } from '../project-header/ProjectHeader.js'

/**
 * The read-only Project facts table. It is the descriptive half of the former
 * 项目设置 page; the 项目信息 page composes it, and member management is its own
 * 成员 page.
 */
export function ProjectFacts({ model }: Readonly<{ model: WorkspaceViewModel }>): ReactElement {
  const cw = useWorkspaceTranslation()
  return (
    <dl className="collaboration-workspace-settings-info">
      <div><dt>{cw('项目名称')}</dt><dd>{model.currentProject.name}</dd></div>
      <div><dt>{cw('项目状态')}</dt><dd>{statusLabel(model.currentProject.status)}</dd></div>
      <div><dt>{cw('项目标识')}</dt><dd><code>{model.projectId ?? '—'}</code></dd></div>
      <div><dt>{cw('项目说明')}</dt><dd>{model.currentProject.description || '—'}</dd></div>
    </dl>
  )
}
