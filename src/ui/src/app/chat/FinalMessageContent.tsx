import type { ObjectReference } from '../../domain';
import { isUserFacingObjectReference, mergeObjectReferences, normalizeObjectReferencePresentationRole } from '../../../../../packages/support/object-references';
import { MessageContent } from './MessageContent';
import { splitFinalMessagePresentation } from './finalMessagePresentation';
import { sanitizeUserProjectionText } from '../conversation-projection-view-model';
import { hasRuntimeGuiSurface, RuntimeGuiPanel, type RuntimeGuiSurface } from './RuntimeGuiPanel';
import { objectReferenceForCursorRef } from './cursorProcessObjectReferences';

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
        <RuntimeGuiPanel surface={runtimeGui} onCommand={onGuiCommand} onObjectFocus={onObjectFocus} />
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
  if (!isUserFacingObjectReference(reference)) return false;
  if (isFinalMessageProcessReference(reference)) return isSafeFinalMessageProcessReference(reference);
  return !isInternalFinalMessageRefText(reference.ref)
    && !isInternalFinalMessageRefText(reference.title)
    && !isInternalFinalMessageRefText(reference.summary)
    && !isInternalFinalMessageRefText(reference.provenance?.path)
    && !isInternalFinalMessageRefText(reference.provenance?.dataRef);
}

function isInternalFinalMessageRefText(value: string | undefined) {
  return containsPrivateFinalMessageText(value)
    || (typeof value === 'string' && (
      /(?:^|[/#:])(?:trace|diagnostic|diagnostics|audit|execution-unit|execution_unit)(?:[/#:]|$)/i.test(value)
      || /^run:/i.test(value)
    ));
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
  const processReference = processObjectReferenceFromPresentationRef(input, ref);
  if (processReference || isProcessPresentationRef(ref, input.kind)) return processReference;
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

function processObjectReferenceFromPresentationRef(input: {
  id?: string;
  label?: string;
  ref?: string;
  kind?: string;
  summary?: string;
  status?: string;
  presentationRole?: string;
}, ref: string): ObjectReference | undefined {
  if (!isProcessPresentationRef(ref, input.kind)) return undefined;
  const reference = objectReferenceForCursorRef(ref);
  if (!reference) return undefined;
  const role = normalizeObjectReferencePresentationRole(input.presentationRole) ?? reference.presentationRole;
  return {
    ...reference,
    id: input.id ?? `presentation-${reference.kind}-${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)}`,
    title: input.label ?? reference.title,
    presentationRole: role,
    status: input.status === 'failed' ? 'blocked' : input.status === 'external' ? 'external' : reference.status,
    summary: input.summary ?? reference.summary,
  };
}

function displayObjectRef(ref: string, kind?: string) {
  if (/^(?:subagent|agent-result|trace|run|agent-transcript|transcript)::?/i.test(ref)) {
    return ref.replace(/^([a-z][a-z0-9-]*)::?/i, '$1:');
  }
  if (/^artifact::?/i.test(ref)) return ref.replace(/^artifact::?/i, 'artifact::');
  if (/^file::?/i.test(ref)) return ref.replace(/^file::?/i, 'file::');
  if (/^folder::?/i.test(ref)) return ref.replace(/^folder::?/i, 'folder::');
  if (/^https?:\/\//i.test(ref)) return ref;
  if (kind === 'artifact') return `artifact::${ref}`;
  if (kind === 'file' || /^\.[\w./-]+/.test(ref)) return `file::${ref}`;
  return ref;
}

function objectReferenceKind(kind: string | undefined, ref: string): ObjectReference['kind'] {
  if (/^(?:subagent|agent-result|trace|run|agent-transcript|transcript):/i.test(ref) || kind === 'run') return 'run';
  if (/^artifact::/i.test(ref) || kind === 'artifact') return 'artifact';
  if (/^file::/i.test(ref) || kind === 'file') return 'file';
  if (/^folder::/i.test(ref) || kind === 'folder') return 'folder';
  if (/^https?:\/\//i.test(ref) || kind === 'url') return 'url';
  if (/^execution-unit::/i.test(ref) || kind === 'execution-unit') return 'execution-unit';
  return 'artifact';
}

function isFinalMessageProcessReference(reference: ObjectReference) {
  return reference.kind === 'run' && isProcessPresentationRef(reference.ref);
}

function isProcessPresentationRef(ref: string, kind?: string) {
  return kind === 'run' || /^(?:subagent|agent-result|trace|run|agent-transcript|transcript):/i.test(ref);
}

function isSafeFinalMessageProcessReference(reference: ObjectReference) {
  return isSafeFinalMessageProcessRef(reference.ref)
    && !containsPrivateFinalMessageText(reference.title)
    && !containsPrivateFinalMessageText(reference.summary)
    && !containsPrivateFinalMessageText(reference.provenance?.path)
    && !containsPrivateFinalMessageText(reference.provenance?.dataRef);
}

function isSafeFinalMessageProcessRef(ref: string) {
  const text = ref.trim();
  if (!/^(?:subagent|agent-result|trace|run|agent-transcript|transcript):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/i.test(text)) return false;
  if (text.includes('..') || text.startsWith('~')) return false;
  return !containsPrivateFinalMessageText(text);
}

function containsPrivateFinalMessageText(value: string | undefined) {
  return typeof value === 'string' && (
    /(?:^|[/#:])\.sciforge(?:[/#:]|$)/i.test(value)
    || /(?:^|[/#:])(?:stdout|stderr|raw|provider|debug|diagnostic|diagnostics|audit|execution-unit|execution_unit)(?:[/#:]|$)/i.test(value)
    || /(?:^|[_.:/#-])(?:stdout|stderr|raw|provider|secret|token|credential|password|private|Users|Applications|Volumes|var|tmp|\.sciforge)(?:$|[_.:/#-])/i.test(value)
    || /\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(value)
    || /https?:\/\/[^\s`"'<>),;]+/i.test(value)
    || /\/(?:Applications|Users|Volumes|private|var|tmp)\//i.test(value)
  );
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
