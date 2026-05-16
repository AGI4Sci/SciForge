import type { ObjectReference, SciForgeMessage, SciForgeSession } from '../../domain';
import {
  artifactForObjectReference,
  artifactHasUserFacingDelivery,
  hasExplicitUserFacingObjectReferenceRole,
  mergeObjectReferences,
  objectReferencePresentationRole,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { InlineObjectReferences } from './InlineObjectReferences';
import { currentObjectReferenceFromComposerReference, withInferredCurrentObjectReference } from './composerReferences';

export function MessageContent({
  content,
  references,
  onObjectFocus,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  return (
    <div className="message-content">
      <MarkdownRenderer markdown={content} className="message-markdown" />
      <InlineObjectReferences references={references} onObjectFocus={onObjectFocus} />
    </div>
  );
}

export function inlineObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  if (message.role === 'user') {
    const userReferences = (message.references ?? [])
      .map((reference) => currentObjectReferenceFromComposerReference(withInferredCurrentObjectReference(reference)))
      .filter((reference): reference is ObjectReference => Boolean(reference))
      .filter((reference) => isVisibleMessageObjectReference(reference, session, { userSelected: true }));
    return mergeObjectReferences(userReferences, [], 40);
  }
  const run = runId ? session.runs.find((item) => item.id === runId) : undefined;
  const runArtifactRefs = new Set((run?.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => (runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId) && artifactHasUserFacingDelivery(artifact))
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  const structuredReferences = mergeObjectReferences(message.objectReferences ?? [], mergeObjectReferences(run?.objectReferences ?? [], runArtifacts), 32)
    .filter((reference) => isVisibleMessageObjectReference(reference, session));
  return mergeObjectReferences(structuredReferences, [], 40);
}

export function unmentionedObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  void message;
  return inlineObjectReferencesForMessage(message, session, runId);
}

function isVisibleMessageObjectReference(reference: ObjectReference, session: SciForgeSession, options: { userSelected?: boolean } = {}) {
  const hasExplicitUserFacingRole = hasExplicitUserFacingObjectReferenceRole(reference);
  const role = objectReferencePresentationRole(reference);
  if (reference.kind === 'artifact') {
    const artifact = artifactForObjectReference(reference, session);
    return artifactHasUserFacingDelivery(artifact)
      && role !== 'audit'
      && role !== 'diagnostic'
      && role !== 'internal';
  }
  if (!options.userSelected && !hasExplicitUserFacingRole) return false;
  if (!options.userSelected && isPrivateReference(reference)) return false;
  if (reference.kind === 'file') {
    const path = reference.provenance?.path ?? reference.ref;
    return !/\.json(?:$|[?#])/i.test(path) && !isPrivateRefText(path);
  }
  return reference.kind === 'url' || reference.kind === 'folder';
}

function isPrivateReference(reference: ObjectReference) {
  return isPrivateRefText(reference.ref)
    || isPrivateRefText(reference.title)
    || isPrivateRefText(reference.summary)
    || isPrivateRefText(reference.provenance?.path)
    || isPrivateRefText(reference.provenance?.dataRef);
}

function isPrivateRefText(value: string | undefined) {
  return typeof value === 'string' && (
    /\.sciforge\/sessions\//i.test(value)
    || /^agentserver:\/\//i.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef)\b/i.test(value)
  );
}
