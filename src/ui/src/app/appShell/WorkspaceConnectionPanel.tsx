import type { RefObject } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../../i18nContext';

export function WorkspaceConnectionPanel({
  folderPickerRef,
  pathEditDraft,
  workspaceStatus,
  onPathEditDraftChange,
  onChooseWorkspaceRootPath,
  onWorkspacePathChange,
}: {
  folderPickerRef: RefObject<HTMLDetailsElement | null>;
  pathEditDraft: string;
  workspaceStatus: string;
  onPathEditDraftChange: (value: string) => void;
  onChooseWorkspaceRootPath: () => void | Promise<void>;
  onWorkspacePathChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const trimmedPath = pathEditDraft.trim();
  const rootPathLabel = t({ 'zh-CN': '工作区根路径', 'en-US': 'Workspace root path' });
  return (
    <>
      <button
        type="button"
        className="explorer-folder-picker-trigger"
        onClick={() => void onChooseWorkspaceRootPath()}
        aria-label={t({ 'zh-CN': '打开工作区', 'en-US': 'Open Workspace' })}
      >
        {t({ 'zh-CN': '打开工作区...', 'en-US': 'Open Workspace...' })}
      </button>
      <details ref={folderPickerRef} className="explorer-folder-picker explorer-folder-picker-advanced">
        <summary>{t({ 'zh-CN': '手动设置路径', 'en-US': 'Set path manually' })}</summary>
        <div className="explorer-folder-picker-body">
          <input
            className="workspace-path-editor explorer-path-input"
            value={pathEditDraft}
            onChange={(event) => onPathEditDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmedPath) onWorkspacePathChange(trimmedPath);
            }}
            spellCheck={false}
            title={workspaceStatus || rootPathLabel}
            aria-label={rootPathLabel}
          />
          <div className="explorer-folder-picker-actions">
            <button
              type="button"
              className="explorer-cta-btn"
              disabled={!trimmedPath}
              onClick={() => {
                if (trimmedPath) onWorkspacePathChange(trimmedPath);
              }}
            >
              <Check size={14} />
              {t({ 'zh-CN': '设为当前工作区', 'en-US': 'Set as Current Workspace' })}
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
