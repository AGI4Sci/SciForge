import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { ProjectFacts } from '../settings/SettingsView.js'

/**
 * The 项目信息 page: the read-only Project facts. It is the half of the old
 * 项目设置 page that describes the Project; member management is its own
 * 成员 page.
 */
export function ProjectInfoView({ model, onRename }: Readonly<{ model: WorkspaceViewModel; onRename?(): void }>): ReactElement {
  useWorkspaceTranslation()
  return (
    <section className="collaboration-workspace-page-panel collaboration-workspace-info-page">
      <header className="collaboration-workspace-page-header">
        <div><h2>{cw("项目信息")}</h2><p>{cw("项目的名称、状态与说明。")}</p></div>
      </header>
      {onRename ? <button type="button" className="collaboration-workspace-button-secondary" onClick={onRename}>{cw("重命名项目")}</button> : null}
      <ProjectFacts model={model} />
    </section>
  )
}
