import { Download, Eye, MessageSquare, Trash2 } from 'lucide-react';
import type { RuntimeArtifact } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';

export function ArtifactCardControls({
  artifact,
  presentationId,
  exportLabel = 'Export JSON',
  locale,
  onExportArtifact,
  onFocusArtifact,
  onInspectArtifact,
  onDismissResultSlotPresentation,
}: {
  artifact?: RuntimeArtifact;
  presentationId: string;
  exportLabel?: string;
  locale?: ResultLocale;
  onExportArtifact?: (artifact: RuntimeArtifact) => void;
  onFocusArtifact?: (artifact: RuntimeArtifact) => void;
  onInspectArtifact?: (artifact: RuntimeArtifact) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  if (!artifact && !onDismissResultSlotPresentation) return null;
  return (
    <div className="artifact-card-actions">
      {artifact && onFocusArtifact ? (
        <button type="button" onClick={() => onFocusArtifact(artifact)} title={resultText(locale, { 'zh-CN': '将此结果作为聊天上下文', 'en-US': 'Use this result as chat context' })}>
          <MessageSquare size={13} />
          {resultText(locale, { 'zh-CN': '提问', 'en-US': 'Ask' })}
        </button>
      ) : null}
      {artifact && onInspectArtifact ? (
        <button type="button" onClick={() => onInspectArtifact(artifact)}>
          <Eye size={13} />
          {resultText(locale, { 'zh-CN': '查看', 'en-US': 'Inspect' })}
        </button>
      ) : null}
      {artifact && onExportArtifact ? (
        <button type="button" onClick={() => onExportArtifact(artifact)}>
          <Download size={13} />
          {exportLabel === 'Export JSON' ? resultText(locale, { 'zh-CN': '导出 JSON', 'en-US': 'Export JSON' }) : exportLabel}
        </button>
      ) : null}
      {onDismissResultSlotPresentation ? (
        <button
          type="button"
          className="registry-slot-dismiss"
          onClick={() => onDismissResultSlotPresentation(presentationId)}
          title={resultText(locale, { 'zh-CN': '从结果面板隐藏此卡片，不删除生成的文件', 'en-US': 'Hide this card from the result pane without deleting generated files' })}
        >
          <Trash2 size={13} />
          {resultText(locale, { 'zh-CN': '隐藏', 'en-US': 'Hide' })}
        </button>
      ) : null}
    </div>
  );
}
