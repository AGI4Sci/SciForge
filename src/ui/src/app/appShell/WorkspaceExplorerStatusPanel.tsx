import { localeText, type SupportedLocale } from '../../i18n';
import { useI18n } from '../../i18nContext';
import { workspaceNeedsOnboarding } from './explorerModels';

export function WorkspaceExplorerStatusPanel({
  workspacePath,
  workspaceError,
  workspaceStatus,
  workspaceNotice,
  onInitializeWorkspacePath,
}: {
  workspacePath: string;
  workspaceError: string;
  workspaceStatus: string;
  workspaceNotice: string;
  onInitializeWorkspacePath: () => void | Promise<void>;
}) {
  const { locale, t } = useI18n();
  return (
    <>
      {workspaceNeedsOnboarding(workspacePath, workspaceError, workspaceStatus) ? (
        <div className="workspace-onboarding">
          <strong>{workspacePath.trim()
            ? t({ 'zh-CN': '初始化工作区', 'en-US': 'Initialize workspace' })
            : t({ 'zh-CN': '设置项目文件夹', 'en-US': 'Set project folder' })}</strong>
          <p>{conciseWorkspaceOnboardingReason(workspacePath, workspaceError, workspaceStatus, locale)}</p>
          <button type="button" onClick={() => void onInitializeWorkspacePath()}>
            {t({ 'zh-CN': '创建工作区', 'en-US': 'Create workspace' })}
          </button>
        </div>
      ) : null}
      {workspaceNotice ? <p className="workspace-status explorer-muted-line" role="status">{workspaceNotice}</p> : null}
      {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
    </>
  );
}

export function conciseWorkspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string, locale?: SupportedLocale) {
  const copyLocale = locale ?? 'en-US';
  if (!path.trim()) return localeText(copyLocale, {
    'zh-CN': '选择一个项目文件夹后，这里会显示文件。',
    'en-US': 'Choose a project folder to show files here.',
  });
  const diagnostic = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(diagnostic)) return localeText(copyLocale, {
    'zh-CN': 'SciForge 无法读取这个文件夹。请检查权限。',
    'en-US': 'SciForge cannot read this folder. Check permissions.',
  });
  if (/ENOENT|not found|未找到/i.test(diagnostic)) return localeText(copyLocale, {
    'zh-CN': '未找到项目文件夹。',
    'en-US': 'Project folder was not found.',
  });
  return localeText(copyLocale, {
    'zh-CN': '工作区尚未初始化。',
    'en-US': 'Workspace is not initialized yet.',
  });
}
