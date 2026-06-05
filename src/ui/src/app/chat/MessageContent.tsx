import type { ObjectReference, SciForgeConfig, SciForgeMessage, SciForgeSession } from '../../domain';
import {
  artifactForObjectReference,
  artifactHasUserFacingDelivery,
  artifactTypeForPath,
  hasExplicitUserFacingObjectReferenceRole,
  mergeObjectReferences,
  objectReferenceMentionedInText,
  objectReferencePresentationRole,
  objectReferenceForArtifactSummary,
  referenceForObjectReference,
  sciForgeReferenceAttribute,
  workspacePathBasename,
} from '../../../../../packages/support/object-references';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { InlineObjectReferences } from './InlineObjectReferences';
import { currentObjectReferenceFromComposerReference, withInferredCurrentObjectReference } from './composerReferences';

export interface InlineObjectReferenceOptions {
  workspaceObjectReferences?: ObjectReference[];
}

export type WorkspacePreviewConfig = Pick<SciForgeConfig, 'workspaceWriterBaseUrl' | 'workspacePath'>;

export function MessageContent({
  content,
  references,
  onObjectFocus,
  className,
  previewConfig,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
  className?: string;
  previewConfig?: WorkspacePreviewConfig;
}) {
  const imageReferences = references.filter(isImageObjectReferenceWithWorkspacePreview);
  const nonImageReferences = references.filter((reference) => !imageReferences.includes(reference));
  return (
    <div className={['message-content', className].filter(Boolean).join(' ')}>
      <MarkdownRenderer
        markdown={content}
        className="message-markdown"
        objectReferences={references}
        onObjectReferenceFocus={onObjectFocus}
      />
      <MessageImageAttachments
        references={imageReferences.filter((reference) => !objectReferenceMentionedInText(content, reference))}
        previewConfig={previewConfig}
        onObjectFocus={onObjectFocus}
      />
      <InlineObjectReferences references={nonImageReferences.filter((reference) => !objectReferenceMentionedInText(content, reference))} onObjectFocus={onObjectFocus} />
    </div>
  );
}

function MessageImageAttachments({
  references,
  previewConfig,
  onObjectFocus,
}: {
  references: ObjectReference[];
  previewConfig?: WorkspacePreviewConfig;
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  if (!references.length) return null;
  return (
    <div className="message-image-attachments" aria-label="Image attachments">
      {references.map((reference) => {
        const previewRef = workspacePreviewRefForImageReference(reference);
        if (!previewRef) return null;
        return (
          <button
            key={`${reference.id}:${previewRef}`}
            type="button"
            className="message-image-attachment"
            onClick={() => onObjectFocus(reference)}
            title={reference.summary || reference.title || previewRef}
            data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}
          >
            <img src={workspacePreviewRawUrl(previewRef, previewConfig)} alt={reference.title || 'Uploaded image'} loading="lazy" />
            <span>{reference.title || workspacePathBasename(previewRef)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function inlineObjectReferencesForMessage(
  message: SciForgeMessage,
  session: SciForgeSession,
  runId?: string,
  options: InlineObjectReferenceOptions = {},
) {
  const userSelectedReferences = selectedMessageObjectReferences(message, session);
  if (message.role === 'user') {
    return mergeObjectReferences(userSelectedReferences, [], 40);
  }
  if (message.role === 'system' && userSelectedReferences.length) {
    return mergeObjectReferences(userSelectedReferences, [], 40);
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

function selectedMessageObjectReferences(message: SciForgeMessage, session: SciForgeSession) {
  return (message.references ?? [])
    .map((reference) => currentObjectReferenceFromComposerReference(withInferredCurrentObjectReference(reference)))
    .filter((reference): reference is ObjectReference => Boolean(reference))
    .filter((reference) => isVisibleMessageObjectReference(reference, session, { userSelected: true }));
}

function isVisibleMessageObjectReference(reference: ObjectReference, session: SciForgeSession, options: { userSelected?: boolean } = {}) {
  const hasExplicitUserFacingRole = hasExplicitUserFacingObjectReferenceRole(reference);
  const role = objectReferencePresentationRole(reference);
  if (options.userSelected && isImageObjectReferenceWithWorkspacePreview(reference)) return true;
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

function isImageObjectReferenceWithWorkspacePreview(reference: ObjectReference) {
  return Boolean(workspacePreviewRefForImageReference(reference));
}

function workspacePreviewRefForImageReference(reference: ObjectReference) {
  if (!isImageObjectReference(reference)) return undefined;
  const ref = reference.provenance?.path ?? reference.provenance?.dataRef ?? workspacePathFromRef(reference.ref);
  if (!ref || !isSafeWorkspacePreviewRef(ref)) return undefined;
  return ref;
}

function isImageObjectReference(reference: ObjectReference) {
  const type = `${reference.artifactType ?? ''} ${reference.preferredView ?? ''} ${reference.title ?? ''} ${reference.ref ?? ''}`;
  return /(?:^|\b)(?:uploaded-image|image)(?:\b|$)|\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(type)
    || /\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(reference.provenance?.path ?? reference.provenance?.dataRef ?? '');
}

function workspacePathFromRef(ref: string) {
  if (/^file::?/i.test(ref)) return ref.replace(/^file::?/i, '');
  return undefined;
}

function isSafeWorkspacePreviewRef(ref: string) {
  const trimmed = ref.trim();
  return Boolean(trimmed)
    && !/^(?:data|javascript|https?):/i.test(trimmed)
    && !trimmed.startsWith('//')
    && !trimmed.includes('\0')
    && !trimmed.startsWith('/')
    && !trimmed.includes('..');
}

function workspacePreviewRawUrl(ref: string, config?: WorkspacePreviewConfig) {
  const params = new URLSearchParams();
  params.set('ref', ref);
  const workspacePath = config?.workspacePath?.trim();
  if (workspacePath) params.set('workspacePath', workspacePath);
  const workspaceWriterBaseUrl = config?.workspaceWriterBaseUrl?.trim().replace(/\/+$/, '');
  const path = `/api/sciforge/preview/raw?${params.toString()}`;
  return workspaceWriterBaseUrl ? `${workspaceWriterBaseUrl}${path}` : path;
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
