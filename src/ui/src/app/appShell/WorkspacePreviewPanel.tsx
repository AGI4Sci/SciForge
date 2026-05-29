import type { KeyboardEvent } from 'react';
import { Copy, FileText, Save } from 'lucide-react';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
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
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void onSave();
    }
  }

  return (
    <div className="workspace-preview" aria-label="文件预览">
      <div className="workspace-preview-head">
        <span>
          <FileText size={13} />
          <strong>{file.name}</strong>
          {dirty ? <Badge variant="warning">未保存</Badge> : <Badge variant="success">已保存</Badge>}
        </span>
        <div>
          <button type="button" onClick={() => void onCopyText(file.path)} title="复制路径" aria-label="复制路径"><Copy size={13} /></button>
          <button type="button" onClick={() => void onCopyText(draft)} title="复制内容" aria-label="复制内容"><Copy size={13} /></button>
          <button type="button" onClick={() => void onSave()} disabled={!dirty} title="保存文件" aria-label="保存文件"><Save size={13} /></button>
        </div>
      </div>
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={`${file.name} 文件内容`}
      />
      <div className="workspace-preview-meta">
        <code>{file.language}</code>
        <span>{formatBytes(file.size)}</span>
        {file.modifiedAt ? <span>{new Date(file.modifiedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
      </div>
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  await navigator.clipboard?.writeText(text);
}
