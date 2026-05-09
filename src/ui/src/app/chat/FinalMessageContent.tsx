import type { ObjectReference } from '../../domain';
import { MessageContent } from './MessageContent';
import { splitFinalMessagePresentation } from './finalMessagePresentation';

export function FinalMessageContent({
  content,
  references,
  onObjectFocus,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  const presentation = splitFinalMessagePresentation(content);
  return (
    <>
      <MessageContent content={presentation.primaryContent || content} references={references} onObjectFocus={onObjectFocus} />
      {presentation.auditSections.length ? (
        <details className="message-fold depth-2 final-message-audit-fold" key={finalAuditFoldKey(content, presentation.summary)}>
          <summary>执行明细与原始证据 · {presentation.summary}</summary>
          <div className="execution-process-body">
            {presentation.auditSections.map((section, index) => (
              <div className="final-message-audit-section" key={`${section.evidenceType}-${index}`}>
                <div className="final-message-audit-label">
                  <strong>{section.label}</strong>
                  <span>{section.evidenceType} · {section.importance}</span>
                </div>
                <MessageContent content={section.text} references={references} onObjectFocus={onObjectFocus} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function finalAuditFoldKey(content: string, summary: string) {
  let hash = 0;
  const value = `${summary}\n${content}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return `final-audit-${Math.abs(hash).toString(36)}`;
}
