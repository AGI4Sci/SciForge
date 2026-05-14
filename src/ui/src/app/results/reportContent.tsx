import type { ObjectReference } from '../../domain';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { coerceArtifactReportPayload } from '@sciforge-ui/artifact-preview';

export { coerceArtifactReportPayload as coerceReportPayload } from '@sciforge-ui/artifact-preview';

export function MarkdownBlock({ markdown, onObjectReferenceFocus }: { markdown?: string; onObjectReferenceFocus?: (reference: ObjectReference) => void }) {
  void onObjectReferenceFocus;
  return <MarkdownRenderer markdown={markdown} className="markdown-block" />;
}
