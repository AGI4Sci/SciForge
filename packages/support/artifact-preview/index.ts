export type {
  ArtifactPreviewAction,
  PreviewDerivative,
  PreviewDerivativeKind,
  PreviewDescriptor,
  PreviewDescriptorKind,
  PreviewDescriptorSource,
  PreviewInlinePolicy,
} from '@sciforge-ui/runtime-contract/preview';

import type { PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';

export const STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND = 'structure-bundle' as const;
const PREVIEW_TEXT_INLINE_SIZE_LIMIT = 1024 * 1024;

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

export function uniquePreviewStrings<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function mergePreviewDescriptors(local: PreviewDescriptor, hydrated: PreviewDescriptor): PreviewDescriptor {
  return {
    ...local,
    ...hydrated,
    title: local.title || hydrated.title,
    diagnostics: uniquePreviewStrings([...(local.diagnostics ?? []), ...(hydrated.diagnostics ?? [])]),
    derivatives: mergePreviewDerivatives(local.derivatives, hydrated.derivatives),
    actions: uniquePreviewStrings([...(local.actions ?? []), ...(hydrated.actions ?? [])]) as PreviewDescriptor['actions'],
    locatorHints: uniquePreviewStrings([...(local.locatorHints ?? []), ...(hydrated.locatorHints ?? [])]) as PreviewDescriptor['locatorHints'],
  };
}

export function descriptorWithDiagnostic(descriptor: PreviewDescriptor, error: unknown): PreviewDescriptor {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...descriptor,
    diagnostics: uniquePreviewStrings([...(descriptor.diagnostics ?? []), `Workspace Writer descriptor hydration failed: ${message}`]),
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

export function previewDescriptorKindForPath(path: string, isDirectory = false): PreviewDescriptor['kind'] {
  if (isDirectory) return 'folder';
  const extension = previewExtension(path);
  if (extension === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return 'image';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'json' || extension === 'jsonl') return 'json';
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(extension)) return 'table';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'pdb' || extension === 'cif' || extension === 'mmcif') return 'structure';
  if (['doc', 'docx', 'ppt', 'pptx'].includes(extension)) return 'office';
  if (['txt', 'log', 'ts', 'tsx', 'js', 'jsx', 'py', 'r', 'sh', 'css'].includes(extension)) return 'text';
  return 'binary';
}

export function inlinePolicyForPreviewKind(kind: PreviewDescriptor['kind'], sizeBytes: number): PreviewDescriptor['inlinePolicy'] {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (canReadPreviewAsText(kind)) return sizeBytes <= PREVIEW_TEXT_INLINE_SIZE_LIMIT ? 'inline' : 'extract';
  if (kind === 'folder') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return 'unsupported';
}

export function derivativeDescriptorsForPreviewTarget(
  ref: string,
  kind: PreviewDescriptor['kind'],
  sizeBytes: number,
  imageMimeType = 'image/*',
): PreviewDescriptor['derivatives'] {
  const lazy = (derivativeKind: NonNullable<PreviewDescriptor['derivatives']>[number]['kind'], mimeType: string) => ({
    kind: derivativeKind,
    ref: `${ref}#${derivativeKind}`,
    mimeType,
    status: 'lazy' as const,
  });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', imageMimeType)];
  if (kind === 'json') return [lazy('schema', 'application/json'), ...(sizeBytes > PREVIEW_TEXT_INLINE_SIZE_LIMIT ? [lazy('text', 'text/plain')] : [])];
  if (kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'markdown' || kind === 'text' || kind === 'html') return sizeBytes > PREVIEW_TEXT_INLINE_SIZE_LIMIT ? [lazy('text', 'text/plain')] : [];
  if (kind === 'structure') return [lazy('metadata', 'application/json'), lazy(STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND, 'application/json')];
  if (kind === 'office' || kind === 'folder' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

export function previewActionsForPreviewKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['actions'] {
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

export function locatorHintsForPreviewKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['locatorHints'] {
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
}

export function previewDerivativeExtensionForKind(kind: string, previewKind: PreviewDescriptor['kind'], path: string) {
  if (kind === 'thumb' && previewKind === 'image') return previewExtension(path) || 'bin';
  if (kind === 'thumb') return 'svg';
  if (kind === 'html') return 'html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND) return 'json';
  return 'txt';
}

export function previewDerivativeMimeTypeForKind(kind: string, previewKind: PreviewDescriptor['kind'], imageMimeType: string) {
  if (kind === 'thumb' && previewKind === 'image') return imageMimeType;
  if (kind === 'thumb') return 'image/svg+xml';
  if (kind === 'html') return 'text/html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND) return 'application/json';
  return 'text/plain';
}

export function canReadPreviewAsText(kind: PreviewDescriptor['kind']) {
  return kind === 'text' || kind === 'markdown' || kind === 'html' || kind === 'json' || kind === 'table';
}

export function previewKindHasJsonSchema(kind: PreviewDescriptor['kind']) {
  return kind === 'json';
}

export function previewKindHasTableSchema(kind: PreviewDescriptor['kind']) {
  return kind === 'table';
}

export function previewKindSupportsStructureBundle(kind: PreviewDescriptor['kind']) {
  return kind === 'structure';
}

export function previewStructureBundleStatus(kind: PreviewDescriptor['kind']) {
  return previewKindSupportsStructureBundle(kind) ? 'metadata-only-bundle' : 'unsupported';
}

function previewExtension(path: string) {
  const name = path.toLowerCase().split(/[\\/]/).pop() ?? '';
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex + 1) : '';
}

function mergePreviewDerivatives(left: PreviewDescriptor['derivatives'], right: PreviewDescriptor['derivatives']) {
  const byKey = new Map<string, NonNullable<PreviewDescriptor['derivatives']>[number]>();
  for (const derivative of [...(left ?? []), ...(right ?? [])]) {
    byKey.set(`${derivative.kind}:${derivative.ref}`, { ...byKey.get(`${derivative.kind}:${derivative.ref}`), ...derivative });
  }
  return byKey.size ? Array.from(byKey.values()) : undefined;
}
