import type {
  PresentationInput,
  PresentationInputKind,
  RuntimeArtifact,
  UIComponentConsumes,
  UIComponentManifest,
} from '@sciforge-ui/runtime-contract';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const TEXT_EXTENSIONS = new Set(['txt', 'log']);
const TABLE_EXTENSIONS = new Set(['csv', 'tsv', 'json']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const BINARY_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function resolvePresentationInputForArtifact(artifact?: RuntimeArtifact): PresentationInput | undefined {
  if (!artifact) return undefined;
  const delivery = artifact.delivery;
  if (!delivery) {
    return {
      kind: 'unsupported',
      ref: artifact.path ?? artifact.dataRef,
      title: artifactTitle(artifact),
      artifactRef: `artifact:${artifact.id}`,
      reason: 'artifact missing ArtifactDelivery contract',
    };
  }
  if (delivery.role === 'audit' || delivery.role === 'internal' || delivery.previewPolicy === 'audit-only') return undefined;
  const ref = delivery.readableRef ?? artifact.path ?? artifact.dataRef;
  const base = {
    ref,
    title: artifactTitle(artifact),
    rawRef: delivery.rawRef,
    artifactRef: delivery.ref || `artifact:${artifact.id}`,
    mediaType: normalizeMediaType(delivery.declaredMediaType),
    extension: normalizeExtension(delivery.declaredExtension),
    previewPolicy: delivery.previewPolicy,
    role: delivery.role,
  };
  if (delivery.previewPolicy === 'unsupported') {
    return { ...base, kind: 'unsupported', reason: 'delivery previewPolicy is unsupported' };
  }
  if (!ref) {
    return { ...base, kind: 'unsupported', reason: 'delivery has no readable ref' };
  }
  if (delivery.previewPolicy === 'open-system') return { ...base, kind: 'binary', ref, openMode: 'system' };
  const kind = presentationKindForDeclaredFormat(base.mediaType, base.extension);
  if (kind === 'markdown') return { ...base, kind, ref };
  if (kind === 'text') return { ...base, kind, ref };
  if (kind === 'html') return { ...base, kind, ref };
  if (kind === 'table') return { ...base, kind, ref, format: tableFormatForExtension(base.extension, base.mediaType) };
  if (kind === 'binary') return { ...base, kind, ref, openMode: 'system' };
  return { ...base, kind: 'unsupported', reason: `unsupported delivery format ${base.mediaType || base.extension || 'unknown'}` };
}

export function componentConsumesPresentationInput(module: UIComponentManifest, input?: PresentationInput): boolean {
  if (!input) return false;
  return (module.consumes ?? []).some((contract) => presentationInputMatchesConsumption(contract, input));
}

export function validatePresentationInputBinding(
  module: UIComponentManifest,
  input?: PresentationInput,
): { status: 'bound' | 'missing-artifact' | 'missing-fields' | 'fallback'; reason?: string; missingFields?: string[] } {
  if (!input) return { status: 'missing-artifact', reason: '等待 ArtifactDelivery presentation input' };
  if (componentConsumesPresentationInput(module, input)) return { status: 'bound' };
  return {
    status: 'fallback',
    reason: `${module.moduleId} 不声明消费 ${presentationInputLabel(input)}`,
    missingFields: ['manifest.consumes'],
  };
}

export function presentationInputLabel(input: PresentationInput) {
  return [
    input.kind,
    input.mediaType,
    input.extension ? `.${input.extension}` : undefined,
    input.previewPolicy,
  ].filter(Boolean).join(' ');
}

function presentationInputMatchesConsumption(contract: UIComponentConsumes, input: PresentationInput) {
  if (!contract.kinds.includes(input.kind)) return false;
  if (contract.mediaTypes?.length && !contract.mediaTypes.map(normalizeMediaType).includes(normalizeMediaType(input.mediaType))) return false;
  if (contract.extensions?.length && !contract.extensions.map(normalizeExtension).includes(normalizeExtension(input.extension))) return false;
  if (contract.previewPolicies?.length && (!input.previewPolicy || !contract.previewPolicies.includes(input.previewPolicy))) return false;
  return true;
}

function presentationKindForDeclaredFormat(mediaType = '', extension = ''): PresentationInputKind | undefined {
  if (MARKDOWN_EXTENSIONS.has(extension) || /markdown/i.test(mediaType)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension) || /html/i.test(mediaType)) return 'html';
  if (TABLE_EXTENSIONS.has(extension) || /csv|tsv|json/i.test(mediaType)) return 'table';
  if (TEXT_EXTENSIONS.has(extension) || /^text\//i.test(mediaType)) return 'text';
  if (BINARY_EXTENSIONS.has(extension) || /pdf|image|officedocument|spreadsheet|presentation|wordprocessing/i.test(mediaType)) return 'binary';
  return undefined;
}

function tableFormatForExtension(extension = '', mediaType = '') {
  if (extension === 'csv' || /csv/i.test(mediaType)) return 'csv' as const;
  if (extension === 'tsv' || /tab-separated/i.test(mediaType)) return 'tsv' as const;
  return 'json' as const;
}

function artifactTitle(artifact: RuntimeArtifact) {
  const metadata = artifact.metadata ?? {};
  return stringValue(metadata.title) ?? stringValue(metadata.name) ?? artifact.id;
}

function normalizeMediaType(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeExtension(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/^\./, '').toLowerCase() : '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
