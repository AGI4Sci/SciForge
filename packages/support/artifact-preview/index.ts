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
export const PREVIEW_FILE_EXTENSIONS_BY_KIND = {
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  markdown: ['md', 'markdown'],
  json: ['json', 'jsonl'],
  table: ['csv', 'tsv', 'xlsx', 'xls'],
  html: ['html', 'htm'],
  structure: ['pdb', 'cif', 'mmcif'],
  office: ['doc', 'docx', 'ppt', 'pptx'],
  text: ['txt', 'log', 'ts', 'tsx', 'js', 'jsx', 'py', 'r', 'sh', 'css'],
} as const satisfies Partial<Record<PreviewDescriptor['kind'], readonly string[]>>;

const STABLE_PREVIEW_DELIVERABLE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'txt',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'html',
  'htm',
]);

const PREVIEW_KIND_BY_EXTENSION = new Map<string, PreviewDescriptor['kind']>(
  Object.entries(PREVIEW_FILE_EXTENSIONS_BY_KIND)
    .flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind as PreviewDescriptor['kind']] as const)),
);

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
  return previewDescriptorKindForExtension(previewFileExtensionForPath(path));
}

export function previewDescriptorKindForExtension(extension: string): PreviewDescriptor['kind'] {
  return PREVIEW_KIND_BY_EXTENSION.get(normalizePreviewExtension(extension)) ?? 'binary';
}

export function previewPathHasRecognizedFileExtension(path: string) {
  return PREVIEW_KIND_BY_EXTENSION.has(previewFileExtensionForPath(path));
}

export function previewPathHasStableDeliverableExtension(path: string) {
  return STABLE_PREVIEW_DELIVERABLE_EXTENSIONS.has(previewFileExtensionForPath(path));
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

export interface PreviewNoticeReferenceInput {
  ref: string;
  artifactType?: string;
}

export interface UnsupportedPreviewNoticeInput {
  reference: PreviewNoticeReferenceInput;
  path?: string;
  descriptor?: PreviewDescriptor;
}

export interface UnsupportedPreviewNoticeModel {
  kindLabel: string;
  message: string;
  requestLabel: string;
  codeLabels: string[];
}

export function lightweightPreviewNoticeForDescriptor(descriptor: PreviewDescriptor) {
  return `${descriptor.title || descriptor.ref} 已作为轻量 artifact 聚焦。当前类型使用 ${stablePreviewActionSummary(descriptor)} 作为稳定预览动作，派生内容按需生成。`;
}

export function unsupportedPreviewNoticeModel(input: UnsupportedPreviewNoticeInput): UnsupportedPreviewNoticeModel {
  const kindLabel = input.descriptor?.kind || input.reference.artifactType || 'unknown';
  const codeLabels = [
    input.path || input.descriptor?.ref || input.reference.ref,
    input.descriptor?.mimeType,
    input.descriptor?.inlinePolicy ? `inlinePolicy: ${input.descriptor.inlinePolicy}` : undefined,
  ].filter((label): label is string => Boolean(label));
  return {
    kindLabel,
    message: `这个文件仍然可以作为对象引用传给 Agent，但右侧暂不支持内联预览${kindLabel ? `（${kindLabel}）` : ''}。需要设计一个匹配该文件类型的 preview package 插件后，才能在这里稳定渲染。`,
    requestLabel: '让 Agent 设计 preview package 并重试',
    codeLabels,
  };
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
  if (kind === 'thumb' && previewKind === 'image') return previewFileExtensionForPath(path) || 'bin';
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

export function previewFileExtensionForPath(path: string) {
  const name = path.toLowerCase().split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '';
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? normalizePreviewExtension(name.slice(dotIndex + 1)) : '';
}

function normalizePreviewExtension(extension: string) {
  return extension.toLowerCase().replace(/^\./, '');
}

function stablePreviewActionSummary(descriptor: PreviewDescriptor) {
  const stableActions = descriptor.actions.filter((action) => action === 'inspect-metadata' || action === 'system-open' || action === 'copy-ref');
  return (stableActions.length ? stableActions : previewActionsForPreviewKind(descriptor.kind).filter((action) => action === 'inspect-metadata' || action === 'system-open' || action === 'copy-ref'))
    .map(previewActionLabel)
    .join('/');
}

function previewActionLabel(action: PreviewDescriptor['actions'][number]) {
  if (action === 'inspect-metadata') return 'metadata';
  return action;
}

function mergePreviewDerivatives(left: PreviewDescriptor['derivatives'], right: PreviewDescriptor['derivatives']) {
  const byKey = new Map<string, NonNullable<PreviewDescriptor['derivatives']>[number]>();
  for (const derivative of [...(left ?? []), ...(right ?? [])]) {
    byKey.set(`${derivative.kind}:${derivative.ref}`, { ...byKey.get(`${derivative.kind}:${derivative.ref}`), ...derivative });
  }
  return byKey.size ? Array.from(byKey.values()) : undefined;
}
