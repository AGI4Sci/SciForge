import type { PreviewDerivative, PreviewDescriptor, RuntimeArtifact } from '../../domain';
import { asNumber, asString, asStringList, isRecord } from './artifactData';

export function descriptorCanUseWorkspacePreview(descriptor: PreviewDescriptor) {
  return descriptor.kind === 'markdown'
    || descriptor.kind === 'text'
    || descriptor.kind === 'json'
    || descriptor.kind === 'table'
    || descriptor.kind === 'html';
}

export function descriptorDerivativeKind(descriptor: PreviewDescriptor): PreviewDerivative['kind'] {
  if (descriptor.kind === 'json' || descriptor.kind === 'table') return 'schema';
  if (descriptor.kind === 'html') return 'html';
  return 'text';
}

export function previewNeedsPackage(descriptor: PreviewDescriptor) {
  if (descriptor.inlinePolicy === 'unsupported') return true;
  if (descriptor.kind === 'binary' || descriptor.kind === 'office') return true;
  return false;
}

export function uploadedArtifactPreview(artifact?: RuntimeArtifact) {
  if (!artifact || !isRecord(artifact.data)) return undefined;
  const dataUrl = asString(artifact.data.dataUrl);
  const kind = asString(artifact.data.previewKind);
  if (!dataUrl || (kind !== 'pdf' && kind !== 'image')) return undefined;
  return {
    kind: kind as 'pdf' | 'image',
    dataUrl,
    title: asString(artifact.metadata?.title) || asString(artifact.data.title) || artifact.id,
    mimeType: asString(artifact.metadata?.mimeType) || asString(artifact.data.mimeType),
    size: asNumber(artifact.metadata?.size) || asNumber(artifact.data.size),
  };
}

export function normalizeArtifactPreviewDescriptor(artifact: RuntimeArtifact | undefined, fallbackRef?: string): PreviewDescriptor | undefined {
  if (!artifact) return undefined;
  if (artifact.previewDescriptor) return artifact.previewDescriptor;
  const metadata = artifact.metadata ?? {};
  const nested = isRecord(metadata.previewDescriptor) ? metadata.previewDescriptor : undefined;
  const rawKind = asString(nested?.kind) || asString(metadata.previewKind) || fileKindForPath(fallbackRef || artifact.path || artifact.dataRef || artifact.id, asString(metadata.language) || '');
  const kind = previewKindFromArtifact(rawKind, artifact);
  if (!kind) return undefined;
  const rawUrl = asString(nested?.rawUrl) || asString(metadata.rawUrl);
  return {
    kind,
    source: 'artifact',
    ref: fallbackRef || artifact.path || artifact.dataRef || `artifact:${artifact.id}`,
    mimeType: asString(nested?.mimeType) || asString(metadata.mimeType),
    sizeBytes: asNumber(nested?.sizeBytes) || asNumber(metadata.size),
    hash: asString(nested?.hash) || asString(metadata.hash),
    title: asString(nested?.title) || asString(metadata.title) || artifact.id,
    rawUrl,
    inlinePolicy: rawUrl ? 'stream' : defaultInlinePolicyForKind(kind),
    derivatives: Array.isArray(nested?.derivatives) ? nested.derivatives.map(normalizePreviewDerivative).filter((item): item is NonNullable<PreviewDescriptor['derivatives']>[number] => Boolean(item)) : undefined,
    actions: previewActionsForDescriptorKind(kind),
    diagnostics: asStringList(nested?.diagnostics),
  };
}

function normalizePreviewDerivative(value: unknown): NonNullable<PreviewDescriptor['derivatives']>[number] | undefined {
  if (!isRecord(value)) return undefined;
  const kind = asString(value.kind);
  const ref = asString(value.ref);
  if (!kind || !ref) return undefined;
  return {
    kind: kind as NonNullable<PreviewDescriptor['derivatives']>[number]['kind'],
    ref,
    mimeType: asString(value.mimeType),
    sizeBytes: asNumber(value.sizeBytes),
    hash: asString(value.hash),
    generatedAt: asString(value.generatedAt),
    status: value.status === 'available' || value.status === 'lazy' || value.status === 'failed' || value.status === 'unsupported' ? value.status : undefined,
    diagnostics: asStringList(value.diagnostics),
  };
}

function previewKindFromArtifact(kind: string | undefined, artifact: RuntimeArtifact): PreviewDescriptor['kind'] | undefined {
  const value = `${kind || ''} ${artifact.type} ${artifact.path || ''} ${artifact.dataRef || ''}`.toLowerCase();
  if (/pdf/.test(value)) return 'pdf';
  if (/image|png|jpe?g|gif|webp|svg/.test(value)) return 'image';
  if (/markdown|\.md\b/.test(value)) return 'markdown';
  if (/json/.test(value)) return 'json';
  if (/csv|tsv|xlsx?|table|matrix/.test(value)) return 'table';
  if (/html?/.test(value)) return 'html';
  if (/pdb|cif|mmcif|structure|molecule/.test(value)) return 'structure';
  if (/docx?|pptx?|office|presentation|document/.test(value)) return 'office';
  if (/text|log|txt/.test(value)) return 'text';
  if (artifact.path || artifact.dataRef) return 'binary';
  return undefined;
}

function defaultInlinePolicyForKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['inlinePolicy'] {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

function previewActionsForDescriptorKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['actions'] {
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

export function fileKindForPath(path: string, language = '') {
  const value = `${path} ${language}`.toLowerCase();
  if (/markdown|\.md\b|\.markdown\b/.test(value)) return 'markdown';
  if (/json|\.json\b/.test(value)) return 'json';
  if (/\.csv\b/.test(value)) return 'csv';
  if (/\.tsv\b/.test(value)) return 'tsv';
  if (/\.pdf\b/.test(value)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg)\b/.test(value)) return 'image';
  if (/html|\.html?\b/.test(value)) return 'html';
  if (/document|\.(docx?|rtf)\b/.test(value)) return 'document';
  if (/spreadsheet|\.(xlsx?|ods)\b/.test(value)) return 'spreadsheet';
  if (/presentation|\.(pptx?|odp)\b/.test(value)) return 'presentation';
  return language || 'text';
}
