import { useState } from 'react';
import { X } from 'lucide-react';
import type { ObjectReference, SciForgeReference } from '../../domain';
import { Badge, cx } from '../uiPrimitives';
import {
  objectReferenceChipModel,
  objectReferenceIcon,
  objectReferenceKindLabel,
  referenceComposerMarker,
  referenceForObjectReference,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';

export function ObjectReferenceChips({
  references,
  activeRunId,
  onFocus,
}: {
  references: ObjectReference[];
  activeRunId?: string;
  onFocus: (reference: ObjectReference) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const chipModel = objectReferenceChipModel(references, expanded);
  return (
    <div className="object-reference-strip" aria-label="回答中引用的对象">
      {chipModel.visible.map((reference) => (
        <button
          type="button"
          key={reference.id}
          className={cx('object-reference-chip', activeRunId && reference.runId === activeRunId && 'active')}
          onClick={() => onFocus(reference)}
          title={reference.summary || reference.ref}
          data-tooltip={`${objectReferenceKindLabel(reference.kind)} · ${reference.ref}`}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}
        >
          <span>{objectReferenceIcon(reference.kind)}</span>
          <strong>{reference.title}</strong>
          {chipModel.pending.some((item) => item.id === reference.id) ? <Badge variant="warning">点击验证</Badge> : null}
          {reference.status && reference.status !== 'available' ? <Badge variant={reference.status === 'blocked' ? 'danger' : 'warning'}>{reference.status}</Badge> : null}
        </button>
      ))}
      {chipModel.hasOverflow ? (
        <button
          type="button"
          className="object-reference-more"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title={expanded ? '收起对象列表' : `展开剩余 ${chipModel.hiddenCount} 个对象`}
        >
          {expanded ? '收起对象' : `+${chipModel.hiddenCount} objects`}
        </button>
      ) : null}
    </div>
  );
}

export function SciForgeReferenceChips({
  references,
  onRemove,
  onFocus,
}: {
  references: SciForgeReference[];
  onRemove?: (referenceId: string) => void;
  onFocus?: (reference: SciForgeReference) => void;
}) {
  return (
    <div className="sciforge-reference-strip" aria-label="用户引用的上下文">
      {references.slice(0, 8).map((reference) => (
        <span
          role="button"
          tabIndex={0}
          key={reference.id}
          className={cx('sciforge-reference-chip', `kind-${reference.kind}`)}
          title={reference.summary || reference.ref}
          onClick={() => onFocus?.(reference)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onFocus?.(reference);
          }}
        >
          <span>{referenceComposerMarker(reference)}</span>
          <strong>{reference.title}</strong>
          {onRemove ? (
            <i
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(reference.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onRemove(reference.id);
              }}
              aria-label={`移除引用 ${reference.title}`}
            >
              <X size={12} />
            </i>
          ) : null}
        </span>
      ))}
    </div>
  );
}
