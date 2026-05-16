import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import type {
  ObjectReference,
  ObjectReferencePresentationRole,
} from '@sciforge-ui/runtime-contract/references';
import {
  asString,
  preferredArtifactPath,
} from './helpers';

const presentationRoles = new Set<ObjectReferencePresentationRole>([
  'primary-deliverable',
  'supporting-evidence',
  'audit',
  'diagnostic',
  'internal',
]);

export function normalizeObjectReferencePresentationRole(value: unknown): ObjectReferencePresentationRole | undefined {
  return typeof value === 'string' && presentationRoles.has(value as ObjectReferencePresentationRole)
    ? value as ObjectReferencePresentationRole
    : undefined;
}

export function artifactPresentationRole(artifact: RuntimeArtifact): ObjectReferencePresentationRole {
  const deliveryRole = normalizeObjectReferencePresentationRole(artifact.delivery?.role);
  if (deliveryRole) return deliveryRole;
  const metadataRole = normalizeObjectReferencePresentationRole(artifact.metadata?.presentationRole)
    ?? normalizeObjectReferencePresentationRole(artifact.metadata?.artifactRole);
  if (metadataRole) return metadataRole;

  const path = preferredArtifactPath(artifact) ?? asString(artifact.dataRef) ?? asString(artifact.path) ?? '';
  const text = [
    artifact.id,
    artifact.type,
    path,
    asString(artifact.metadata?.title),
    asString(artifact.metadata?.name),
    asString(artifact.metadata?.kind),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(?:stdout|stderr|log|logs|diagnostic|diagnostics|failure|error|exception)\b/.test(text) || /\.(?:log|stderr|stdout|trace)$/i.test(path)) {
    return 'diagnostic';
  }
  if (artifact.type !== 'research-report' && /\b(?:runtime|execution-unit|execution_unit|trace|audit|checkpoint|payload|raw|context-summary|context_summary)\b/.test(text)) {
    return 'audit';
  }
  if (/\.json$/i.test(path) && artifact.type !== 'research-report') {
    return 'internal';
  }
  if (artifact.type === 'research-report' || /\.m(?:d|arkdown)$/i.test(path) || /\b(?:report|proposal|brief|memo|writeup|deliverable)\b/.test(text)) {
    return 'primary-deliverable';
  }
  if (/\b(?:evidence|matrix|table|dataset|paper-list|papers|citation|bibliography|pdf|document|figure|chart|plot|image|csv|tsv)\b/.test(text)) {
    return 'supporting-evidence';
  }
  if (/\.json$/i.test(path) || /\b(?:json|schema|manifest|toolpayload)\b/.test(text)) {
    return 'internal';
  }
  return 'supporting-evidence';
}

export function objectReferencePresentationRole(reference: ObjectReference): ObjectReferencePresentationRole {
  const explicit = normalizeObjectReferencePresentationRole(reference.presentationRole);
  if (explicit) return explicit;
  if (reference.kind === 'run' || reference.kind === 'execution-unit' || reference.kind === 'scenario-package') return 'audit';

  const path = reference.provenance?.path ?? reference.provenance?.dataRef ?? reference.ref;
  const text = [
    reference.ref,
    reference.title,
    reference.artifactType,
    reference.summary,
    path,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(?:stdout|stderr|log|logs|diagnostic|diagnostics|failure|error|exception)\b/.test(text) || /\.(?:log|stderr|stdout|trace)$/i.test(path)) {
    return 'diagnostic';
  }
  if (reference.artifactType !== 'research-report' && /\b(?:runtime|execution-unit|execution_unit|trace|audit|checkpoint|payload|raw|context-summary|context_summary)\b/.test(text)) {
    return 'audit';
  }
  if (/\.json$/i.test(path) && reference.artifactType !== 'research-report') {
    return 'internal';
  }
  if (reference.artifactType === 'research-report' || /\.m(?:d|arkdown)$/i.test(path) || /\b(?:report|proposal|brief|memo|writeup|deliverable)\b/.test(text)) {
    return 'primary-deliverable';
  }
  if (/\b(?:evidence|matrix|table|dataset|paper-list|papers|citation|bibliography|pdf|document|figure|chart|plot|image|csv|tsv|url)\b/.test(text) || reference.kind === 'url') {
    return 'supporting-evidence';
  }
  if (/\.json$/i.test(path) || /\b(?:json|schema|manifest|toolpayload)\b/.test(text)) {
    return 'internal';
  }
  return reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder'
    ? 'supporting-evidence'
    : 'audit';
}

export function isUserFacingObjectReference(reference: ObjectReference) {
  const role = objectReferencePresentationRole(reference);
  return role === 'primary-deliverable' || role === 'supporting-evidence';
}

export function hasExplicitUserFacingObjectReferenceRole(reference: ObjectReference) {
  const role = normalizeObjectReferencePresentationRole(reference.presentationRole);
  return role === 'primary-deliverable' || role === 'supporting-evidence';
}

export function displayTitleForObjectReference(reference: ObjectReference) {
  const title = cleanReferenceTitle(reference.title, reference.ref);
  if (title) return title;
  const path = reference.provenance?.path ?? reference.provenance?.dataRef ?? reference.ref.replace(/^[a-z-]+:{1,2}/i, '');
  const basename = cleanReferenceTitle(pathBasename(path), reference.ref);
  if (basename) return basename;
  if (reference.kind === 'execution-unit') return '执行单元';
  if (reference.kind === 'run') return '运行记录';
  if (reference.kind === 'artifact') return reference.artifactType ?? '产物';
  if (reference.kind === 'file') return '文件';
  if (reference.kind === 'folder') return '文件夹';
  return titleForReferenceKind(reference.kind);
}

function cleanReferenceTitle(value: string | undefined, ref: string) {
  const title = value?.trim();
  if (!title || title === ref) return undefined;
  if (/^(?:artifact|file|folder|run|execution-unit)::?/i.test(title)) return undefined;
  if (/^\.sciforge\//i.test(title)) return undefined;
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function titleForReferenceKind(kind: ObjectReference['kind']) {
  if (kind === 'url') return '链接';
  if (kind === 'scenario-package') return '场景包';
  return '引用';
}

function pathBasename(path: string) {
  const clean = path.replace(/\/+$/, '');
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(index + 1) : clean;
}
