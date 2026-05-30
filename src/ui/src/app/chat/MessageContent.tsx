import type { ObjectReference, SciForgeMessage, SciForgeSession } from '../../domain';
import {
  artifactForObjectReference,
  artifactHasUserFacingDelivery,
  artifactTypeForPath,
  hasExplicitUserFacingObjectReferenceRole,
  mergeObjectReferences,
  objectReferenceMentionedInText,
  objectReferencePresentationRole,
  objectReferenceForArtifactSummary,
  workspacePathBasename,
} from '../../../../../packages/support/object-references';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { InlineObjectReferences } from './InlineObjectReferences';
import { currentObjectReferenceFromComposerReference, withInferredCurrentObjectReference } from './composerReferences';

export interface InlineObjectReferenceOptions {
  workspaceObjectReferences?: ObjectReference[];
}

export function MessageContent({
  content,
  references,
  onObjectFocus,
  className,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
  className?: string;
}) {
  return (
    <div className={['message-content', className].filter(Boolean).join(' ')}>
      <MarkdownRenderer
        markdown={content}
        className="message-markdown"
        objectReferences={references}
        onObjectReferenceFocus={onObjectFocus}
      />
      <InlineObjectReferences references={references.filter((reference) => !objectReferenceMentionedInText(content, reference))} onObjectFocus={onObjectFocus} />
    </div>
  );
}

export function inlineObjectReferencesForMessage(
  message: SciForgeMessage,
  session: SciForgeSession,
  runId?: string,
  options: InlineObjectReferenceOptions = {},
) {
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
  const runArtifacts = runId
    ? session.artifacts
      .filter((artifact) => (runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId) && artifactHasUserFacingDelivery(artifact))
      .map((artifact) => objectReferenceForArtifactSummary(artifact, runId))
    : [];
  const mentionedFileReferences = fileReferencesForMentionedObjects(
    message.content,
    session,
    runId,
    runArtifactRefs,
    options.workspaceObjectReferences ?? [],
  );
  const structuredReferences = mergeObjectReferences(
    mergeObjectReferences(message.objectReferences ?? [], mentionedFileReferences, 32),
    mergeObjectReferences(run?.objectReferences ?? [], runArtifacts),
    32,
  )
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
    return !isPrivateRefText(path);
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

function fileReferencesForMentionedObjects(
  content: string,
  session: SciForgeSession,
  runId: string | undefined,
  runArtifactRefs: Set<string>,
  workspaceObjectReferences: ObjectReference[],
) {
  const mentionedTokens = inlineFileMentionTokens(content);
  if (!mentionedTokens.length) return [];
  const artifactCandidates = runId ? session.artifacts
    .filter((artifact) => (!runId || runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId) && artifactHasUserFacingDelivery(artifact))
    .map((artifact) => {
      const artifactReference = objectReferenceForArtifactSummary(artifact, runId);
      const path = artifactReference.provenance?.path ?? artifactReference.provenance?.dataRef;
      if (!path || isPrivateRefText(path)) return undefined;
      return {
        reference: fileReferenceForArtifactMention(artifactReference, path, runId),
        path,
      };
    })
    .filter((item): item is FileMentionCandidate => Boolean(item)) : [];
  const workspaceCandidates = workspaceObjectReferences
    .map((reference) => workspaceFileMentionCandidate(reference, runId))
    .filter((item): item is FileMentionCandidate => Boolean(item));
  const candidates = [...artifactCandidates, ...workspaceCandidates];

  const mentionedReferences: ObjectReference[] = [];
  for (const mention of mentionedTokens) {
    const token = mention.token;
    const matches = candidates.filter(({ path }) => fileMentionMatchesPath(token, path));
    const uniqueMatches = uniqueArtifactPathMatches(matches);
    if (uniqueMatches.length !== 1) continue;
    mentionedReferences.push(uniqueMatches[0].reference);
  }
  return mergeObjectReferences(mentionedReferences, [], 24);
}

interface FileMentionCandidate {
  reference: ObjectReference;
  path: string;
}

function fileReferenceForArtifactMention(artifactReference: ObjectReference, path: string, runId: string | undefined): ObjectReference {
  return {
    id: `inline-file-${artifactReference.id}`,
    kind: 'file',
    title: workspacePathBasename(path) || artifactReference.title,
    ref: `file:${path}`,
    artifactType: artifactTypeForPath(path, 'file'),
    preferredView: artifactReference.preferredView,
    presentationRole: artifactReference.presentationRole === 'primary-deliverable'
      ? 'primary-deliverable'
      : 'supporting-evidence',
    runId,
    actions: ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
    status: 'available',
    summary: artifactReference.summary ?? artifactReference.title,
    provenance: {
      ...artifactReference.provenance,
      path,
    },
  };
}

function workspaceFileMentionCandidate(reference: ObjectReference, runId: string | undefined): FileMentionCandidate | undefined {
  if (reference.kind !== 'file' || reference.status === 'missing' || reference.status === 'blocked' || reference.status === 'expired') return undefined;
  const path = reference.provenance?.path ?? reference.ref.replace(/^file::?/i, '');
  if (!path || isPrivateRefText(path)) return undefined;
  return {
    reference: {
      ...reference,
      runId: reference.runId ?? runId,
      artifactType: reference.artifactType ?? artifactTypeForPath(path, 'file'),
      presentationRole: reference.presentationRole ?? 'supporting-evidence',
      actions: reference.actions ?? ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
      status: reference.status ?? 'available',
      provenance: {
        ...reference.provenance,
        path,
      },
    },
    path,
  };
}

function inlineFileMentionTokens(content: string) {
  const mentions: Array<{ token: string; index: number }> = [];
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const token = normalizeInlineFileMention(match[1]);
    if (token && looksLikeWorkspaceFileMention(token)) mentions.push({ token, index: match.index ?? 0 });
  }
  for (const match of content.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:md|markdown|txt|log|jsonl?|csv|tsv|html?|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|pdb|cif|mmcif)(?![A-Za-z0-9_./-])/gi)) {
    const token = normalizeInlineFileMention(match[0]);
    if (token && looksLikeWorkspaceFileMention(token)) mentions.push({ token, index: match.index ?? 0 });
  }
  const tokens = new Map<string, { token: string }>();
  for (const mention of mentions.sort((left, right) => left.index - right.index)) {
    const key = mention.token.toLowerCase();
    if (!tokens.has(key)) tokens.set(key, { token: mention.token });
  }
  return [...tokens.values()];
}

function normalizeInlineFileMention(value: string | undefined) {
  return value?.trim().replace(/[.,;，。；、]+$/, '').replace(/^file::?/i, '').replace(/\\/g, '/') ?? '';
}

function looksLikeWorkspaceFileMention(token: string) {
  return /^[^:/?#]+(?:\/[^:/?#]+)*\.[A-Za-z0-9]{1,12}$/.test(token);
}

function fileMentionMatchesPath(token: string, path: string) {
  const normalizedPath = path.replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const normalizedToken = token.replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return normalizedPath === normalizedToken || workspacePathBasename(normalizedPath).toLowerCase() === normalizedToken;
}

function uniqueArtifactPathMatches<T extends { path: string }>(matches: T[]) {
  const byPath = new Map<string, T>();
  for (const match of matches) {
    const key = match.path.replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (!byPath.has(key)) byPath.set(key, match);
  }
  return [...byPath.values()];
}
