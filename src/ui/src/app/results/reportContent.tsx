import type { ObjectReference } from '../../domain';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { coerceArtifactReportPayload } from '@sciforge-ui/artifact-preview';

export { coerceArtifactReportPayload as coerceReportPayload } from '@sciforge-ui/artifact-preview';

export function MarkdownBlock({
  markdown,
  objectReferences = [],
  onObjectReferenceFocus,
}: {
  markdown?: string;
  objectReferences?: ObjectReference[];
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  return (
    <MarkdownRenderer
      markdown={markdown}
      className="markdown-block"
      objectReferences={objectReferences}
      onObjectReferenceFocus={onObjectReferenceFocus}
    />
  );
}
