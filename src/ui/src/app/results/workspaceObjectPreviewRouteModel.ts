import type { PresentationInput } from '@sciforge-ui/runtime-contract';
import type { UploadedArtifactPreview } from '../../../../../packages/support/artifact-preview';
import type { ObjectReference, PreviewDescriptor, SciForgeReference } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import {
  referenceForObjectReference,
  referenceKindForWorkspaceFileLike,
  referenceKindForWorkspacePreviewKind,
} from '../../../../../packages/support/object-references';
import { previewNeedsPackage } from './previewDescriptor';
import {
  canHydrateWorkspaceObjectPath,
  safeExternalPreviewHref,
  type SubagentArtifactPreviewModel,
} from './workspaceObjectPreviewModel';

export type WorkspaceObjectPreviewRoute =
  | { kind: 'url'; title: string; url: string; href?: string }
  | { kind: 'folder'; label: string }
  | { kind: 'unsupported-reference' }
  | { kind: 'inline-preview'; preview: UploadedArtifactPreview; reference: SciForgeReference }
  | { kind: 'presentation-input'; input: PresentationInput; path?: string }
  | { kind: 'subagent-preview'; preview: SubagentArtifactPreviewModel }
  | { kind: 'unsafe-path'; reference: ObjectReference }
  | { kind: 'missing-path' }
  | { kind: 'loading'; label: string; source: 'hydration' | 'pending-file' }
  | { kind: 'error'; path: string; diagnostic: string }
  | { kind: 'descriptor'; descriptor: PreviewDescriptor; reference: SciForgeReference; needsPackage: boolean }
  | { kind: 'file'; file: WorkspaceFileContent; reference: SciForgeReference };

export interface WorkspaceObjectPreviewRouteInput {
  reference: ObjectReference;
  path?: string;
  inlinePreview?: UploadedArtifactPreview;
  presentationInput?: PresentationInput;
  subagentPreview?: SubagentArtifactPreviewModel;
  loadingPath?: string;
  error?: string;
  descriptor?: PreviewDescriptor;
  file?: WorkspaceFileContent;
}

export function workspaceObjectPreviewRoute(input: WorkspaceObjectPreviewRouteInput): WorkspaceObjectPreviewRoute {
  const { reference, path } = input;
  if (reference.kind === 'url') {
    const url = reference.ref.replace(/^url:/i, '');
    return {
      kind: 'url',
      title: reference.title,
      url,
      href: safeExternalPreviewHref(url),
    };
  }
  if (reference.kind === 'folder') {
    return { kind: 'folder', label: path || reference.ref };
  }
  if (reference.kind !== 'file' && reference.kind !== 'artifact') return { kind: 'unsupported-reference' };
  if (input.inlinePreview) {
    return {
      kind: 'inline-preview',
      preview: input.inlinePreview,
      reference: referenceForObjectReference(reference, referenceKindForWorkspacePreviewKind(input.inlinePreview.kind)),
    };
  }
  if (input.presentationInput?.kind === 'binary' || input.presentationInput?.kind === 'unsupported') {
    return { kind: 'presentation-input', input: input.presentationInput, path };
  }
  if (input.subagentPreview) return { kind: 'subagent-preview', preview: input.subagentPreview };
  if (path && !canHydrateWorkspaceObjectPath(path)) {
    return { kind: 'unsafe-path', reference: redactedUnsafeWorkspacePreviewReference(reference) };
  }
  if (!path) return { kind: 'missing-path' };
  if (input.loadingPath) return { kind: 'loading', label: input.loadingPath, source: 'hydration' };
  if (input.error) return { kind: 'error', path, diagnostic: input.error };
  if (input.descriptor) {
    return {
      kind: 'descriptor',
      descriptor: input.descriptor,
      reference: referenceForObjectReference(reference, referenceKindForWorkspacePreviewKind(input.descriptor.kind)),
      needsPackage: previewNeedsPackage(input.descriptor),
    };
  }
  if (!input.file) return { kind: 'loading', label: path, source: 'pending-file' };
  return {
    kind: 'file',
    file: input.file,
    reference: referenceForObjectReference(reference, referenceKindForWorkspaceFileLike(input.file)),
  };
}

export function redactedUnsafeWorkspacePreviewReference(reference: ObjectReference): ObjectReference {
  const label = reference.kind === 'file' ? 'file:[redacted-unsafe-preview-ref]' : 'artifact:[redacted-unsafe-preview-ref]';
  return {
    ...reference,
    title: label,
    ref: label,
    summary: 'Preview ref is outside the trusted workspace preview boundary.',
    provenance: undefined,
  };
}
