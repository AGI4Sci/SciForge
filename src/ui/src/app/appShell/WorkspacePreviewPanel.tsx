import type { KeyboardEvent } from 'react';
import { Copy, FileText, Save } from 'lucide-react';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import { useI18n } from '../../i18nContext';
import { Badge } from '../uiPrimitives';
import { formatBytes } from './explorerModels';

export function WorkspacePreviewPanel({
  file,
  draft,
  dirty,
  onDraftChange,
  onSave,
  onCopyText = copyTextToClipboard,
}: {
  file: WorkspaceFileContent;
  draft: string;
  dirty: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onCopyText?: (text: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const copyPathLabel = t({ 'zh-CN': '复制路径', 'en-US': 'Copy path' });
  const copyContentsLabel = t({ 'zh-CN': '复制内容', 'en-US': 'Copy contents' });
  const saveFileLabel = t({ 'zh-CN': '保存文件', 'en-US': 'Save file' });
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void onSave();
    }
  }

  return (
    <div className="workspace-preview" aria-label={t({ 'zh-CN': '文件预览', 'en-US': 'File preview' })}>
      <div className="workspace-preview-head">
        <span>
          <FileText size={13} />
          <strong>{file.name}</strong>
          {dirty
            ? <Badge variant="warning">{t({ 'zh-CN': '未保存', 'en-US': 'Unsaved' })}</Badge>
            : <Badge variant="success">{t({ 'zh-CN': '已保存', 'en-US': 'Saved' })}</Badge>}
        </span>
        <div>
          <button type="button" onClick={() => void onCopyText(file.path)} title={copyPathLabel} aria-label={copyPathLabel}><Copy size={13} /></button>
          <button type="button" onClick={() => void onCopyText(draft)} title={copyContentsLabel} aria-label={copyContentsLabel}><Copy size={13} /></button>
          <button type="button" onClick={() => void onSave()} disabled={!dirty} title={saveFileLabel} aria-label={saveFileLabel}><Save size={13} /></button>
        </div>
      </div>
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={t({ 'zh-CN': `${file.name} 内容`, 'en-US': `${file.name} contents` })}
      />
      <div className="workspace-preview-meta">
        <code>{file.language}</code>
        <span>{formatBytes(file.size)}</span>
        {file.modifiedAt ? <span>{new Date(file.modifiedAt).toLocaleString(undefined, { hour12: false })}</span> : null}
      </div>
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  await navigator.clipboard?.writeText(text);
}
