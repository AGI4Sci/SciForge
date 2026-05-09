export type {
  ArtifactPreviewAction,
  PreviewDerivative,
  PreviewDerivativeKind,
  PreviewDescriptor,
  PreviewDescriptorKind,
  PreviewDescriptorSource,
  PreviewInlinePolicy,
} from '@sciforge-ui/runtime-contract/preview';
export {
  artifactProvenanceSource,
  artifactProvenanceSourceVariant,
  coerceArtifactReportPayload,
  hasInlineObjectReferenceText,
  inlineObjectReferenceFromMarkdownRef,
  isGeneratedReportShell,
  isReportPolicyRecord,
  looksLikeBackendPayloadText,
  markdownShellForReportRef,
  relatedArtifactsForReportPolicy,
  reportPolicyRecordList,
  reportPolicyString,
  reportRecordToReadableText,
  reportRefFromText,
  reportSectionsToMarkdown,
  splitInlineObjectReferenceText,
  type ArtifactProvenanceSource,
  type ArtifactProvenanceSourceVariant,
  type ReportPolicyRuntimeArtifactLike,
} from './report-policy';

import type { PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';
import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';

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

export type ArtifactPreviewRuntimeArtifactLike =
  Pick<RuntimeArtifact, 'id' | 'type' | 'metadata' | 'data' | 'dataRef' | 'path' | 'previewDescriptor'>
  & Partial<Pick<RuntimeArtifact, 'producerScenario' | 'schemaVersion'>>;

export type UploadedArtifactPreview = {
  kind: 'pdf' | 'image';
  dataUrl: string;
  title: string;
  mimeType?: string;
  size?: number;
};

export function descriptorCanUseWorkspacePreview(descriptor: PreviewDescriptor) {
  return canReadPreviewAsText(descriptor.kind);
}

export function descriptorDerivativeKind(descriptor: PreviewDescriptor): NonNullable<PreviewDescriptor['derivatives']>[number]['kind'] {
  if (descriptor.kind === 'json' || descriptor.kind === 'table') return 'schema';
  if (descriptor.kind === 'html') return 'html';
  return 'text';
}

export function previewNeedsPackage(descriptor: PreviewDescriptor) {
  if (descriptor.inlinePolicy === 'unsupported') return true;
  if (descriptor.kind === 'binary' || descriptor.kind === 'office') return true;
  return false;
}

export function shouldHydratePreviewDescriptor(descriptor: PreviewDescriptor, path: string) {
  if (!path || /^agentserver:\/\//i.test(path) || /^data:/i.test(path) || /^https?:\/\//i.test(path)) return false;
  if (!descriptor.rawUrl && (descriptor.kind === 'pdf' || descriptor.kind === 'image' || descriptor.inlinePolicy === 'stream')) return true;
  if (!descriptor.derivatives?.length && descriptor.actions.some((action) => action === 'extract-text' || action === 'make-thumbnail' || action === 'select-rows')) return true;
  return false;
}

export function uploadedArtifactPreview(artifact?: ArtifactPreviewRuntimeArtifactLike): UploadedArtifactPreview | undefined {
  if (!artifact || !isRecord(artifact.data)) return undefined;
  const dataUrl = asString(artifact.data.dataUrl);
  const kind = asString(artifact.data.previewKind);
  if (!dataUrl || (kind !== 'pdf' && kind !== 'image')) return undefined;
  return {
    kind,
    dataUrl,
    title: asString(artifact.metadata?.title) || asString(artifact.data.title) || artifact.id,
    mimeType: asString(artifact.metadata?.mimeType) || asString(artifact.data.mimeType),
    size: asNumber(artifact.metadata?.size) || asNumber(artifact.data.size),
  };
}

export function normalizeArtifactPreviewDescriptor(artifact: ArtifactPreviewRuntimeArtifactLike | undefined, fallbackRef?: string): PreviewDescriptor | undefined {
  if (!artifact) return undefined;
  if (artifact.previewDescriptor) return artifact.previewDescriptor;
  const metadata = artifact.metadata ?? {};
  const nested = isRecord(metadata.previewDescriptor) ? metadata.previewDescriptor : undefined;
  const kind = previewDescriptorKindForArtifact(artifact, fallbackRef, nested);
  if (!kind) return undefined;
  const ref = fallbackRef || artifact.path || artifact.dataRef || `artifact:${artifact.id}`;
  const rawUrl = asString(nested?.rawUrl) || asString(metadata.rawUrl);
  const sizeBytes = asNumber(nested?.sizeBytes) || asNumber(metadata.size);
  const derivatives: PreviewDescriptor['derivatives'] = Array.isArray(nested?.derivatives)
    ? nested.derivatives.map(normalizePreviewDerivative).filter((item): item is NonNullable<PreviewDescriptor['derivatives']>[number] => Boolean(item))
    : derivativeDescriptorsForPreviewTarget(ref, kind, sizeBytes ?? 0, asString(nested?.mimeType) || asString(metadata.mimeType) || 'image/*');
  return {
    kind,
    source: 'artifact',
    ref,
    mimeType: asString(nested?.mimeType) || asString(metadata.mimeType),
    sizeBytes,
    hash: asString(nested?.hash) || asString(metadata.hash),
    title: asString(nested?.title) || asString(metadata.title) || artifact.id,
    rawUrl,
    inlinePolicy: rawUrl ? 'stream' : inlinePolicyForPreviewKind(kind, sizeBytes ?? 0),
    derivatives: derivatives?.length ? derivatives : undefined,
    actions: previewActionsForPreviewKind(kind),
    diagnostics: asStringList(nested?.diagnostics),
    locatorHints: locatorHintsForPreviewKind(kind),
  };
}

export function previewDescriptorKindForArtifact(
  artifact: ArtifactPreviewRuntimeArtifactLike,
  fallbackRef = '',
  nestedPreviewDescriptor?: Record<string, unknown>,
): PreviewDescriptor['kind'] | undefined {
  const explicitKind = previewDescriptorKindFromLooseValue(asString(nestedPreviewDescriptor?.kind) || asString(artifact.metadata?.previewKind));
  if (explicitKind) return explicitKind;
  const languageKind = previewDescriptorKindFromLooseValue(asString(artifact.metadata?.language));
  if (languageKind && languageKind !== 'text') return languageKind;
  const pathKind = previewDescriptorKindFromArtifactPath(fallbackRef || artifact.path || artifact.dataRef || artifact.id);
  if (pathKind !== 'binary') return pathKind;
  const typeKind = previewDescriptorKindFromLooseValue(`${artifact.type} ${artifact.id}`);
  if (typeKind && typeKind !== 'text') return typeKind;
  const payloadKind = previewDescriptorKindFromPayloadShape(artifact.data);
  if (payloadKind) return payloadKind;
  if (artifact.path || artifact.dataRef) return 'binary';
  return undefined;
}

export function previewDescriptorKindFromArtifactPath(path: string, language = ''): PreviewDescriptor['kind'] {
  const pathKind = previewDescriptorKindForPath(path);
  if (pathKind !== 'binary') return pathKind;
  return previewDescriptorKindFromLooseValue(language) ?? 'binary';
}

export function fileKindForPath(path: string, language = '') {
  const kind = previewDescriptorKindFromArtifactPath(path, language);
  if (kind === 'table') {
    const extension = previewFileExtensionForPath(path);
    if (extension === 'csv' || extension === 'tsv') return extension;
  }
  if (kind === 'office') {
    const extension = previewFileExtensionForPath(path);
    if (extension === 'xls' || extension === 'xlsx') return 'spreadsheet';
    if (extension === 'ppt' || extension === 'pptx') return 'presentation';
    return 'document';
  }
  return kind === 'binary' && language ? language : kind;
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

function previewDescriptorKindFromPayloadShape(payload: unknown): PreviewDescriptor['kind'] | undefined {
  if (Array.isArray(payload)) return payload.length && payload.every(isRecord) ? 'table' : 'json';
  if (!isRecord(payload)) {
    return typeof payload === 'string' && payload.trim() ? 'text' : undefined;
  }
  if (firstString(payload.markdown, payload.report, payload.summary, payload.content)) return 'markdown';
  if (Array.isArray(payload.sections)) return 'markdown';
  if (Array.isArray(payload.rows) || Array.isArray(payload.columns) || Array.isArray(payload.records)) return 'table';
  if (isRecord(payload.table) || isRecord(payload.dataFrame)) return 'table';
  if (firstString(payload.pdb, payload.cif, payload.mmcif, payload.structureRef) || isRecord(payload.structure)) return 'structure';
  return undefined;
}

function previewDescriptorKindFromLooseValue(value: string | undefined): PreviewDescriptor['kind'] | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  if (/\b(pdf|application\/pdf)\b|\.pdf\b/.test(text)) return 'pdf';
  if (/\b(image|png|jpg|jpeg|gif|webp|svg)\b|\.(png|jpe?g|gif|webp|svg)\b/.test(text)) return 'image';
  if (/\b(markdown|md|report|summary)\b|\.m(?:d|arkdown)\b/.test(text)) return 'markdown';
  if (/\b(json|jsonl|application\/json)\b|\.jsonl?\b/.test(text)) return 'json';
  if (/\b(csv|tsv|xlsx?|table|matrix|spreadsheet)\b|\.(csv|tsv|xlsx?)\b/.test(text)) return 'table';
  if (/\b(html?)\b|\.html?\b/.test(text)) return 'html';
  if (/\b(pdb|cif|mmcif|structure|molecule)\b|\.(pdb|cif|mmcif)\b/.test(text)) return 'structure';
  if (/\b(docx?|pptx?|office|presentation|document)\b|\.(docx?|pptx?|rtf|odp|ods)\b/.test(text)) return 'office';
  if (/\b(text|log|txt)\b|\.(txt|log)\b/.test(text)) return 'text';
  return undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
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
