import type { ObjectReference } from '../../domain';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { coerceArtifactReportPayload } from '@sciforge-ui/artifact-preview';
import { splitFinalMessagePresentation } from '../chat/finalMessagePresentation';

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
  const presentation = splitFinalMessagePresentation(markdown ?? '');
  const primaryMarkdown = presentation.primaryContent || markdown;
  return (
    <>
      <MarkdownRenderer
        markdown={primaryMarkdown}
        className="markdown-block"
        objectReferences={objectReferences}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
      {presentation.auditSections.length ? (
        <details className="message-fold depth-2 final-message-audit-fold">
          <summary>Process · {presentation.summary}</summary>
          <div className="execution-process-body">
            {presentation.auditSections.map((section, index) => (
              <div className="final-message-audit-section" key={`${section.evidenceType}-${index}`}>
                <div className="final-message-audit-label">
                  <strong>{section.label}</strong>
                  <span>{section.importance === 'raw' ? 'Detail' : 'Supporting detail'}</span>
                </div>
                <MarkdownRenderer
                  markdown={section.text}
                  className="markdown-block"
                  objectReferences={objectReferences}
                  onObjectReferenceFocus={onObjectReferenceFocus}
                />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
