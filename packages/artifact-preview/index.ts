import type { ArtifactPreviewAction, PreviewDescriptor, RuntimeArtifact } from '../../src/ui/src/domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function uniqueStrings<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const fallbackPreviewActionsByKind: Record<PreviewDescriptor['kind'], ArtifactPreviewAction[]> = {
  pdf: ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', 'system-open', 'copy-ref', 'inspect-metadata'],
  image: ['open-inline', 'make-thumbnail', 'select-region', 'system-open', 'copy-ref', 'inspect-metadata'],
  markdown: ['open-inline', 'extract-text', 'system-open', 'copy-ref', 'inspect-metadata'],
  text: ['open-inline', 'extract-text', 'system-open', 'copy-ref', 'inspect-metadata'],
  json: ['open-inline', 'extract-text', 'system-open', 'copy-ref', 'inspect-metadata'],
  table: ['open-inline', 'select-rows', 'system-open', 'copy-ref', 'inspect-metadata'],
  html: ['open-inline', 'extract-text', 'system-open', 'copy-ref', 'inspect-metadata'],
  structure: ['system-open', 'copy-ref', 'inspect-metadata'],
  office: ['system-open', 'copy-ref', 'inspect-metadata'],
  folder: ['system-open', 'copy-ref', 'inspect-metadata'],
  binary: ['system-open', 'copy-ref', 'inspect-metadata'],
};

export function shouldHydratePreviewDescriptor(descriptor: PreviewDescriptor, path: string) {
  if (!path || /^agentserver:\/\//i.test(path) || /^data:/i.test(path) || /^https?:\/\//i.test(path)) return false;
  if (!descriptor.rawUrl && (descriptor.kind === 'pdf' || descriptor.kind === 'image' || descriptor.inlinePolicy === 'stream')) return true;
  if (!descriptor.derivatives?.length && descriptor.actions.some((action) => action === 'extract-text' || action === 'make-thumbnail' || action === 'select-rows')) return true;
  return false;
}

export function mergePreviewDescriptors(local: PreviewDescriptor, hydrated: PreviewDescriptor): PreviewDescriptor {
  return {
    ...local,
    ...hydrated,
    title: local.title || hydrated.title,
    diagnostics: uniqueStrings([...(local.diagnostics ?? []), ...(hydrated.diagnostics ?? [])]),
    derivatives: mergePreviewDerivatives(local.derivatives, hydrated.derivatives),
    actions: uniqueStrings([...(local.actions ?? []), ...(hydrated.actions ?? [])]) as PreviewDescriptor['actions'],
    locatorHints: uniqueStrings([...(local.locatorHints ?? []), ...(hydrated.locatorHints ?? [])]) as PreviewDescriptor['locatorHints'],
  };
}

export function descriptorWithDiagnostic(descriptor: PreviewDescriptor, error: unknown): PreviewDescriptor {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...descriptor,
    diagnostics: uniqueStrings([...(descriptor.diagnostics ?? []), `Workspace Writer descriptor hydration failed: ${message}`]),
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
    actions: fallbackPreviewActionsByKind[kind],
    diagnostics: asStringList(nested?.diagnostics),
  };
}

export function normalizePreviewDerivative(value: unknown): NonNullable<PreviewDescriptor['derivatives']>[number] | undefined {
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

export function previewKindFromArtifact(kind: string | undefined, artifact: RuntimeArtifact): PreviewDescriptor['kind'] | undefined {
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

export function defaultInlinePolicyForKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['inlinePolicy'] {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

function mergePreviewDerivatives(left: PreviewDescriptor['derivatives'], right: PreviewDescriptor['derivatives']) {
  const byKey = new Map<string, NonNullable<PreviewDescriptor['derivatives']>[number]>();
  for (const derivative of [...(left ?? []), ...(right ?? [])]) {
    byKey.set(`${derivative.kind}:${derivative.ref}`, { ...byKey.get(`${derivative.kind}:${derivative.ref}`), ...derivative });
  }
  return byKey.size ? Array.from(byKey.values()) : undefined;
}

function fileKindForPath(path: string, language = '') {
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
