import type { ObjectReference } from '../../domain';
import { displayTitleForObjectReference, mergeObjectReferences, sciForgeReferenceAttribute } from '../../../../../packages/support/object-references';
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
      {visible.map((reference, index) => {
        const title = displayTitleForObjectReference(reference);
        return (
          <button
            key={`${reference.id}:${reference.kind}:${reference.ref}:${index}`}
            type="button"
            className="markdown-object-ref message-object-link"
            onClick={() => onObjectFocus(reference)}
            title={safeObjectReferenceTitle(reference)}
            data-sciforge-reference={sciForgeReferenceAttribute(composerReferenceForObjectReference(reference))}
          >
            {title}
          </button>
        );
      })}
    </span>
  );
}

function safeObjectReferenceTitle(reference: ObjectReference) {
  const summary = reference.summary?.trim();
  if (summary && !isPrivateRefText(summary)) return summary;
  return displayTitleForObjectReference(reference);
}

function isPrivateRefText(value: string) {
  return /\.sciforge\/sessions\//i.test(value)
    || /^agentserver:\/\//i.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef)\b/i.test(value);
}
