import type { PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';

export function previewKindForUploadedFileLike(file: { name: string; type?: string }): PreviewDescriptor['kind'] {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'image';
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.(txt|log)$/i.test(name) || type.startsWith('text/')) return 'text';
  if (/\.(json|jsonl)$/i.test(name) || type.includes('json')) return 'json';
  if (/\.(csv|tsv|xlsx?)$/i.test(name)) return 'table';
  if (/\.(html?|xhtml)$/i.test(name)) return 'html';
  if (/\.(pdb|cif|mmcif)$/i.test(name)) return 'structure';
  if (/\.(docx?|pptx?)$/i.test(name)) return 'office';
  return 'binary';
}

export function artifactTypeForUploadedFileLike(file: { name: string; type?: string }) {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'uploaded-pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'uploaded-image';
  if (/\.(csv|tsv|xlsx?|json)$/i.test(name)) return 'uploaded-data-file';
  if (/\.(txt|md|rtf|docx?)$/i.test(name)) return 'uploaded-document';
  return 'uploaded-file';
}

export function uploadedInlinePolicyForFileLike(file: { name: string; type?: string; size?: number }): PreviewDescriptor['inlinePolicy'] {
  const kind = previewKindForUploadedFileLike(file);
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return (file.size ?? 0) <= 1024 * 1024 ? 'inline' : 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

export function uploadedDerivativeHintsForFileLike(file: { name: string; type?: string }, ref: string): PreviewDescriptor['derivatives'] {
  const kind = previewKindForUploadedFileLike(file);
  const lazy = (derivativeKind: NonNullable<PreviewDescriptor['derivatives']>[number]['kind'], mimeType: string) => ({
    kind: derivativeKind,
    ref: `${ref}#${derivativeKind}`,
    mimeType,
    status: 'lazy' as const,
  });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', file.type || 'image/*')];
  if (kind === 'json' || kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'office' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

export function uploadedPreviewActionsForFileLike(file: { name: string; type?: string }): PreviewDescriptor['actions'] {
  const kind = previewKindForUploadedFileLike(file);
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

export function uploadedLocatorHintsForFileLike(file: { name: string; type?: string }): PreviewDescriptor['locatorHints'] {
  const kind = previewKindForUploadedFileLike(file);
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
}
