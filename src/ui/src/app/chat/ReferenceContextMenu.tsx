import { Quote } from 'lucide-react';
import type { SciForgeReference } from '../../domain';

export function ReferenceContextMenu({
  x,
  y,
  reference,
  onAdd,
}: {
  x: number;
  y: number;
  reference: SciForgeReference;
  onAdd: (reference: SciForgeReference) => void;
}) {
  return (
    <div
      className="reference-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onAdd(reference)}
      >
        <Quote size={14} />
        引用到对话栏
      </button>
    </div>
  );
}
