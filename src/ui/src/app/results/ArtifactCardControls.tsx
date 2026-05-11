import { Download, Eye, MessageSquare, Trash2 } from 'lucide-react';
import type { RuntimeArtifact } from '../../domain';

export function ArtifactCardControls({
  artifact,
  presentationId,
  exportLabel = '导出 JSON',
  onExportArtifact,
  onFocusArtifact,
  onInspectArtifact,
  onDismissResultSlotPresentation,
}: {
  artifact?: RuntimeArtifact;
  presentationId: string;
  exportLabel?: string;
  onExportArtifact?: (artifact: RuntimeArtifact) => void;
  onFocusArtifact?: (artifact: RuntimeArtifact) => void;
  onInspectArtifact?: (artifact: RuntimeArtifact) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  if (!artifact && !onDismissResultSlotPresentation) return null;
  return (
    <div className="artifact-card-actions">
      {artifact && onFocusArtifact ? (
        <button type="button" onClick={() => onFocusArtifact(artifact)} title="聚焦这个 artifact，用于引用、追问、固定或对比">
          <MessageSquare size={13} />
          引用/追问
        </button>
      ) : null}
      {artifact && onInspectArtifact ? (
        <button type="button" onClick={() => onInspectArtifact(artifact)}>
          <Eye size={13} />
          查看数据
        </button>
      ) : null}
      {artifact && onExportArtifact ? (
        <button type="button" onClick={() => onExportArtifact(artifact)}>
          <Download size={13} />
          {exportLabel}
        </button>
      ) : null}
      {onDismissResultSlotPresentation ? (
        <button
          type="button"
          className="registry-slot-dismiss"
          onClick={() => onDismissResultSlotPresentation(presentationId)}
          title="从结果区移除本卡片（不删除 workspace 中的 artifact 或文件）"
        >
          <Trash2 size={13} />
          删除视图
        </button>
      ) : null}
    </div>
  );
}
