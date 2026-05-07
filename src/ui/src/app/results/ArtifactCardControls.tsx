import { Eye, Trash2 } from 'lucide-react';
import type { RuntimeArtifact } from '../../domain';

export function ArtifactCardControls({
  artifact,
  presentationId,
  onInspectArtifact,
  onDismissResultSlotPresentation,
}: {
  artifact?: RuntimeArtifact;
  presentationId: string;
  onInspectArtifact?: (artifact: RuntimeArtifact) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  if (!artifact && !onDismissResultSlotPresentation) return null;
  return (
    <div className="artifact-card-actions">
      {artifact && onInspectArtifact ? (
        <button type="button" onClick={() => onInspectArtifact(artifact)}>
          <Eye size={13} />
          查看数据
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
