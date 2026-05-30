import type { ObjectReference } from '../../domain';
import { isUserFacingObjectReference, mergeObjectReferences, normalizeObjectReferencePresentationRole } from '../../../../../packages/support/object-references';
import { MessageContent } from './MessageContent';
import { splitFinalMessagePresentation } from './finalMessagePresentation';
import { sanitizeUserProjectionText } from '../conversation-projection-view-model';
import { hasRuntimeGuiSurface, RuntimeGuiPanel, type RuntimeGuiSurface } from './RuntimeGuiPanel';

export function FinalMessageContent({
  content,
  references,
  resultPresentation,
  runtimeGui,
  onGuiCommand,
  onObjectFocus,
}: {
  content: string;
  references: ObjectReference[];
  resultPresentation?: unknown;
  runtimeGui?: RuntimeGuiSurface;
  onGuiCommand?: (commandText: string) => void;
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  const presentation = splitFinalMessagePresentation(content, resultPresentation);
  const effectiveReferences = mergeResultPresentationReferences(references, resultPresentation);
  const fallbackContent = presentation.primaryContent || content;
  const showRuntimeGui = hasRuntimeGuiSurface(runtimeGui);
  const sanitizedContent = sanitizeUserProjectionText(fallbackContent) ?? fallbackContent;
  const primaryContent = showRuntimeGui && looksLikeRuntimeGuiPlaceholderAnswer(sanitizedContent) ? '' : sanitizedContent;
  return (
    <>
      {primaryContent.trim() ? (
        <MessageContent
          content={primaryContent}
          references={effectiveReferences}
          onObjectFocus={onObjectFocus}
          className="final-answer-prose"
        />
      ) : null}
      {showRuntimeGui ? (
        <RuntimeGuiPanel surface={runtimeGui} onCommand={onGuiCommand} />
      ) : null}
      {presentation.auditSections.length ? (
        <details className="message-fold depth-2 final-message-audit-fold" key={finalAuditFoldKey(content, presentation.summary)}>
          <summary>More activity · {presentation.summary}</summary>
          <div className="execution-process-body">
            {presentation.auditSections.map((section, index) => (
              <div className="final-message-audit-section" key={`${section.evidenceType}-${index}`}>
                <MessageContent content={sanitizeUserProjectionText(section.text) ?? section.text} references={effectiveReferences} onObjectFocus={onObjectFocus} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function mergeResultPresentationReferences(references: ObjectReference[], resultPresentation: unknown) {
  return mergeObjectReferences(references, resultPresentationReferences(resultPresentation), 24)
    .filter(isVisibleFinalMessageReference);
}

function isVisibleFinalMessageReference(reference: ObjectReference) {
  return isUserFacingObjectReference(reference)
    && !isInternalFinalMessageRefText(reference.ref)
    && !isInternalFinalMessageRefText(reference.title)
    && !isInternalFinalMessageRefText(reference.summary)
    && !isInternalFinalMessageRefText(reference.provenance?.path)
    && !isInternalFinalMessageRefText(reference.provenance?.dataRef);
}

function isInternalFinalMessageRefText(value: string | undefined) {
  return typeof value === 'string' && (
    /(?:^|[/#:])\.sciforge(?:[/#:]|$)/i.test(value)
    || /(?:^|[/#:])(?:stdout|stderr|raw|trace|diagnostic|diagnostics|audit|execution-unit|execution_unit)(?:[/#:]|$)/i.test(value)
    || /^run:/i.test(value)
  );
}

function resultPresentationReferences(resultPresentation: unknown): ObjectReference[] {
  if (!isRecord(resultPresentation)) return [];
  return [
    ...recordList(resultPresentation.inlineCitations).map((citation) => objectReferenceFromPresentationRef({
      id: stringField(citation.id),
      label: stringField(citation.label),
      ref: stringField(citation.ref),
      kind: stringField(citation.kind),
      summary: stringField(citation.summary),
      status: stringField(citation.status),
      presentationRole: stringField(citation.presentationRole),
    })),
    ...recordList(resultPresentation.artifactActions).map((action) => objectReferenceFromPresentationRef({
      id: stringField(action.id),
      label: stringField(action.label),
      ref: stringField(action.ref),
      kind: stringField(action.kind) ?? 'artifact',
      summary: stringField(action.artifactType),
      status: 'available',
      presentationRole: stringField(action.presentationRole),
    })),
  ].filter((reference): reference is ObjectReference => Boolean(reference));
}

function objectReferenceFromPresentationRef(input: {
  id?: string;
  label?: string;
  ref?: string;
  kind?: string;
  summary?: string;
  status?: string;
  presentationRole?: string;
}): ObjectReference | undefined {
  if (!input.ref) return undefined;
  const ref = displayObjectRef(input.ref, input.kind);
  const kind = objectReferenceKind(input.kind, ref);
  return {
    id: input.id ?? `presentation-${kind}-${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)}`,
    title: input.label ?? ref,
    kind,
    ref,
    presentationRole: normalizeObjectReferencePresentationRole(input.presentationRole),
    actions: kind === 'file' || kind === 'folder'
      ? ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin']
      : ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    status: input.status === 'failed' ? 'blocked' : input.status === 'external' ? 'external' : 'available',
    summary: input.summary ?? input.label,
    provenance: kind === 'file' || kind === 'folder'
      ? { path: ref.replace(/^(file|folder)::?/i, '') }
      : { dataRef: ref.replace(/^artifact::?/i, '') },
  };
}

function displayObjectRef(ref: string, kind?: string) {
  if (/^artifact::?/i.test(ref)) return ref.replace(/^artifact::?/i, 'artifact::');
  if (/^file::?/i.test(ref)) return ref.replace(/^file::?/i, 'file::');
  if (/^folder::?/i.test(ref)) return ref.replace(/^folder::?/i, 'folder::');
  if (/^https?:\/\//i.test(ref)) return ref;
  if (kind === 'artifact') return `artifact::${ref}`;
  if (kind === 'file' || /^\.[\w./-]+/.test(ref)) return `file::${ref}`;
  return ref;
}

function objectReferenceKind(kind: string | undefined, ref: string): ObjectReference['kind'] {
  if (/^artifact::/i.test(ref) || kind === 'artifact') return 'artifact';
  if (/^file::/i.test(ref) || kind === 'file') return 'file';
  if (/^folder::/i.test(ref) || kind === 'folder') return 'folder';
  if (/^https?:\/\//i.test(ref) || kind === 'url') return 'url';
  if (/^execution-unit::/i.test(ref) || kind === 'execution-unit') return 'execution-unit';
  return 'artifact';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finalAuditFoldKey(content: string, summary: string) {
  let hash = 0;
  const value = `${summary}\n${content}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return `final-audit-${Math.abs(hash).toString(36)}`;
}

function looksLikeRuntimeGuiPlaceholderAnswer(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return /^#{0,2}\s*(?:Computer Use )?(?:confirmation required|operation result)\b/i.test(compact)
    || /\/computer-use\s+(?:approve|reject)\b|Approval ref:|Action ref:|Evidence refs:|Choices:/i.test(compact);
}
