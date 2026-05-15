import type { ObjectReference } from '../../domain';
import { mergeObjectReferences, sciForgeReferenceAttribute } from '../../../../../packages/support/object-references';
import { composerReferenceForObjectReference } from './composerReferences';

export function InlineObjectReferences({
  references,
  onObjectFocus,
  limit = 8,
}: {
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
  limit?: number;
}) {
  const visible = mergeObjectReferences(references, [], limit);
  if (!visible.length) return null;
  return (
    <span className="inline-object-references" aria-label="引用对象">
      {visible.map((reference, index) => (
        <button
          key={`${reference.id}:${reference.kind}:${reference.ref}:${index}`}
          type="button"
          className="markdown-object-ref message-object-link"
          onClick={() => onObjectFocus(reference)}
          title={reference.summary || reference.ref}
          data-sciforge-reference={sciForgeReferenceAttribute(composerReferenceForObjectReference(reference))}
        >
          {reference.title || reference.ref}
        </button>
      ))}
    </span>
  );
}
