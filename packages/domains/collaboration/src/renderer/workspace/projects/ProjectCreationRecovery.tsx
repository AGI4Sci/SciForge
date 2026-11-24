import React, { type ReactElement } from 'react'
import type { ProjectCreationRecovery as Recovery } from './project-creation.js'
import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'

function preparationMessage(reason: Recovery['reason']): string {
  switch (reason) {
    case 'session_preparation_unavailable': return cw('本机暂不支持准备研究会话。请检查运行时设置后重试。')
    case 'runtime_not_found': return cw('未找到所选运行时。请在设置中安装或选择可用的运行时后重试。')
    case 'runtime_path_invalid': return cw('所选运行时路径无效。请在设置中修正路径后重试。')
    case 'runtime_not_executable': return cw('所选运行时无法执行。请检查运行时设置和文件权限后重试。')
    case 'runtime_version_unsupported': return cw('所选运行时版本不受支持。请更新为受支持版本后重试。')
    case 'runtime_architecture_incompatible': return cw('所选运行时与本机架构不兼容。请安装匹配的版本后重试。')
    case 'runtime_probe_failed': return cw('所选运行时验证失败。请检查运行时设置后重试。')
    case 'runtime_not_ready': return cw('所选运行时尚未就绪。请完成运行时配置后重试。')
  }
}

/** The same recovery controls serve the creation dialog and the opened draft. */
export function ProjectCreationRecovery({ recovery, busy, onRetry, onOpenDraft, onCreateOther }: Readonly<{
  recovery: Recovery
  busy: boolean
  onRetry?: () => void
  onOpenDraft?: () => void
  onCreateOther?: () => void
}>): ReactElement {
  useWorkspaceTranslation()
  return <section aria-label={cw('项目创建恢复')} data-project-id={recovery.createdProjectId}>
    <p role="status">{busy ? cw('正在为已有草稿准备研究会话…') : cw('云端草稿已创建，本地研究会话尚未就绪。')}</p>
    <p>{preparationMessage(recovery.reason)}</p>
    <p>{cw('可以先打开草稿填写需求和人工安排工作；研究会话恢复后才能使用研究对话。重试会继续同一项目。')}</p>
    <div className="collaboration-workspace-dialog-actions">
      {onOpenDraft ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onOpenDraft}>{cw('打开已有草稿')}</button> : null}
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !onRetry} onClick={onRetry}>{cw('重试准备会话')}</button>
      {onCreateOther ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onCreateOther}>{cw('创建其他项目')}</button> : null}
    </div>
  </section>
}
