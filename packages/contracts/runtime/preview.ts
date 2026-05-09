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

export type PreviewDescriptorSource = 'path' | 'dataRef' | 'artifact' | 'url';
export type PreviewInlinePolicy = 'inline' | 'stream' | 'thumbnail' | 'extract' | 'external' | 'unsupported';
export type PreviewDerivativeKind = 'text' | 'thumb' | 'pages' | 'schema' | 'html' | 'structure-bundle' | 'metadata';
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
