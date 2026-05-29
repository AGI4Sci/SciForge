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
  return (
    <>
      {workspaceNeedsOnboarding(workspacePath, workspaceError, workspaceStatus) ? (
        <div className="workspace-onboarding">
          <strong>{workspacePath.trim() ? '初始化 SciForge 项目' : '设置项目路径'}</strong>
          <p>{conciseWorkspaceOnboardingReason(workspacePath, workspaceError, workspaceStatus)}</p>
          <button type="button" onClick={() => void onInitializeWorkspacePath()}>
            创建项目工作区
          </button>
        </div>
      ) : null}
      {workspaceNotice ? <p className="workspace-status explorer-muted-line" role="status">{workspaceNotice}</p> : null}
      {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
    </>
  );
}

export function conciseWorkspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return '还没有项目。选择项目路径后会显示文件。';
  const diagnostic = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(diagnostic)) return '无法读取当前项目；请检查权限。';
  if (/ENOENT|not found|未找到/i.test(diagnostic)) return '未找到项目工作区。';
  return '项目尚未初始化。';
}
