import type { WorkspaceFileContent } from '../../api/workspaceClient';
import type { ObjectReference, SciForgeReference } from '../../domain';
import { MarkdownBlock } from './reportContent';
import { fileKindForPath } from './previewDescriptor';
import { boundedRightPaneText, formatRightPanePreviewJson, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import { WorkspaceFileMediaReferenceNotice } from './workspaceObjectPreviewMedia';
import {
  referenceForWorkspaceFileLike,
  referenceKindForWorkspaceFileLike,
} from '../../../../../packages/support/object-references';

export function WorkspaceFileInlineViewer({
  file,
  objectReferences = [],
  locale,
  onObjectReferenceFocus,
}: {
  file: WorkspaceFileContent;
  objectReferences?: ObjectReference[];
  locale?: ResultLocale;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const kind = fileKindForPath(file.path, file.language);
  const safeContent = boundedRightPaneText(file.content);
  if (kind === 'diff') {
    return (
      <div className="workspace-object-diff-preview">
        <pre className="workspace-object-code workspace-object-diff">{safeContent}</pre>
      </div>
    );
  }
  if (kind === 'markdown') {
    return (
      <MarkdownBlock
        markdown={safeContent}
        objectReferences={objectReferences}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    );
  }
  if (kind === 'json') return <pre className="workspace-object-code">{formatJsonLike(file.content)}</pre>;
  if (kind === 'csv' || kind === 'tsv') return <DelimitedTextPreview content={safeContent} delimiter={kind === 'tsv' ? '\t' : ','} locale={locale} />;
  if (kind === 'image') {
    return (
      <WorkspaceFileMediaReferenceNotice
        kind="image"
        file={file}
        reference={referenceForWorkspaceFile(file)}
        locale={locale}
      />
    );
  }
  if (kind === 'pdf') {
    return (
      <WorkspaceFileMediaReferenceNotice
        kind="pdf"
        file={file}
        reference={referenceForWorkspaceFile(file)}
        locale={locale}
      />
    );
  }
  if (kind === 'document' || kind === 'spreadsheet' || kind === 'presentation') {
    return (
      <div className="workspace-object-media-note">
        <p>{resultText(locale, {
          'zh-CN': `${officePreviewLabel(kind, locale)}已作为可点击文件引用附加。请在外部打开完整文件，或继续作为上下文保留。`,
          'en-US': `${officePreviewLabel(kind, locale)} is attached as a clickable file reference. Open it externally for the full file, or keep it attached as context.`,
        })}</p>
        <div className="source-list">
          <code>{rightPaneInlineLabel(file.path)}</code>
          <code>{rightPaneInlineLabel(file.mimeType || 'application/octet-stream')}</code>
        </div>
      </div>
    );
  }
  if (kind === 'html') return <pre className="workspace-object-code">{safeContent}</pre>;
  return <pre className="workspace-object-code">{safeContent}</pre>;
}

function officePreviewLabel(kind: string, locale?: ResultLocale) {
  if (kind === 'spreadsheet') return resultText(locale, { 'zh-CN': '表格文件', 'en-US': 'Spreadsheet file' });
  if (kind === 'presentation') return resultText(locale, { 'zh-CN': '演示文稿', 'en-US': 'Presentation file' });
  return resultText(locale, { 'zh-CN': '文档文件', 'en-US': 'Document file' });
}

function referenceForWorkspaceFile(file: WorkspaceFileContent): SciForgeReference {
  return referenceForWorkspaceFileLike(file, referenceKindForWorkspaceFileLike(file));
}

function DelimitedTextPreview({ content, delimiter, locale }: { content: string; delimiter: ',' | '\t'; locale?: ResultLocale }) {
  const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 12).map((line) => line.split(delimiter).slice(0, 8));
  if (!rows.length) return <p className="empty-state">{resultText(locale, { 'zh-CN': '表格文件为空。', 'en-US': 'The table file is empty.' })}</p>;
  return (
    <div className="data-table-wrap compact">
      <table className="data-preview-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('|')}`}>
              {row.map((cell, cellIndex) => rowIndex === 0 ? (
                <th key={`${cellIndex}-${cell}`}>{cell}</th>
              ) : (
                <td key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatJsonLike(content: string) {
  try {
    return formatRightPanePreviewJson(JSON.parse(content));
  } catch {
    return boundedRightPaneText(content);
  }
}
