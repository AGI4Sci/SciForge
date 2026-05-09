export type PreviewDescriptorKind =
  | 'pdf'
  | 'image'
  | 'markdown'
  | 'text'
  | 'json'
  | 'table'
  | 'html'
  | 'structure'
  | 'office'
  | 'folder'
  | 'binary';

export const previewDescriptorKinds = [
  'pdf',
  'image',
  'markdown',
  'text',
  'json',
  'table',
  'html',
  'structure',
  'office',
  'folder',
  'binary',
] as const satisfies readonly PreviewDescriptorKind[];

export type PreviewDescriptorSource = 'path' | 'dataRef' | 'artifact' | 'url';

export const previewDescriptorSources = [
  'path',
  'dataRef',
  'artifact',
  'url',
] as const satisfies readonly PreviewDescriptorSource[];

export type PreviewInlinePolicy = 'inline' | 'stream' | 'thumbnail' | 'extract' | 'external' | 'unsupported';

export const previewInlinePolicies = [
  'inline',
  'stream',
  'thumbnail',
  'extract',
  'external',
  'unsupported',
] as const satisfies readonly PreviewInlinePolicy[];

export type PreviewDerivativeKind = 'text' | 'thumb' | 'pages' | 'schema' | 'html' | 'structure-bundle' | 'metadata';

export const previewDerivativeKinds = [
  'text',
  'thumb',
  'pages',
  'schema',
  'html',
  'structure-bundle',
  'metadata',
] as const satisfies readonly PreviewDerivativeKind[];

export type ArtifactPreviewAction =
  | 'open-inline'
  | 'system-open'
  | 'copy-ref'
  | 'extract-text'
  | 'make-thumbnail'
  | 'select-region'
  | 'select-page'
  | 'select-rows'
  | 'inspect-metadata';

export const artifactPreviewActions = [
  'open-inline',
  'system-open',
  'copy-ref',
  'extract-text',
  'make-thumbnail',
  'select-region',
  'select-page',
  'select-rows',
  'inspect-metadata',
] as const satisfies readonly ArtifactPreviewAction[];

export interface PreviewDerivative {
  kind: PreviewDerivativeKind;
  ref: string;
  mimeType?: string;
  sizeBytes?: number;
  hash?: string;
  generatedAt?: string;
  status?: 'available' | 'lazy' | 'failed' | 'unsupported';
  diagnostics?: string[];
}

export interface PreviewDescriptor {
  kind: PreviewDescriptorKind;
  source: PreviewDescriptorSource;
  ref: string;
  mimeType?: string;
  sizeBytes?: number;
  hash?: string;
  title?: string;
  rawUrl?: string;
  inlinePolicy: PreviewInlinePolicy;
  derivatives?: PreviewDerivative[];
  actions: ArtifactPreviewAction[];
  diagnostics?: string[];
  locatorHints?: Array<'page' | 'region' | 'row-range' | 'column-range' | 'structure-selection' | 'text-range'>;
}
