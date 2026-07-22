import {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS,
  WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES,
  normalizePreviewManifest,
  type WorkspacePreviewPluginManifest
} from '@sciforge/domain-sdk/workspace-preview'

function canonicalManifest(manifest: WorkspacePreviewPluginManifest): WorkspacePreviewPluginManifest {
  return normalizePreviewManifest(manifest)
}

export const FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'Markdown Preview',
    version: '0.1.0',
    modality: 'document',
    lifecycle: 'renderer',
    priority: 500,
    extensions: ['.md', '.mdx', '.markdown'],
    mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      annotations: true,
      export: ['markdown', 'sidecar']
    }
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'HTML Preview',
    version: '0.1.0',
    modality: 'document',
    lifecycle: 'hybrid',
    priority: 480,
    extensions: ['.html', '.htm'],
    mimeTypes: ['text/html'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['html']
    }
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'PDF Preview',
    version: '0.1.0',
    modality: 'document',
    lifecycle: 'renderer',
    priority: 520,
    extensions: ['.pdf'],
    mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      annotations: true,
      export: ['pdf', 'sidecar', 'annotated-pdf']
    }
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'DOCX Preview',
    version: '0.1.0',
    modality: 'document',
    lifecycle: 'hybrid',
    priority: 510,
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      annotations: true,
      export: ['docx', 'sidecar']
    }
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'Image Preview',
    version: '0.1.0',
    modality: 'image',
    lifecycle: 'renderer',
    priority: 450,
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/x-icon'],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: false,
      export: [...WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS]
    }
  })
]

export const FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'Text Preview',
    version: '0.1.0',
    modality: 'text',
    lifecycle: 'main',
    priority: 150,
    extensions: [...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS],
    mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['txt']
    }
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'Tabular Data Preview',
    version: '0.1.0',
    modality: 'tabular',
    lifecycle: 'worker',
    priority: 620,
    extensions: [...WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS],
    mimeTypes: [
      'text/csv',
      'text/tab-separated-values',
      'application/x-ndjson',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['csv', 'tsv']
    },
    workerPackage: '@sciforge/workspace-tabular'
  }),
  canonicalManifest({
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
    displayName: 'Deck Preview',
    version: '0.1.0',
    modality: 'deck',
    lifecycle: 'worker',
    priority: 610,
    extensions: ['.pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      annotations: true,
      export: ['pptx']
    },
    workerPackage: '@sciforge/workspace-deck'
  })
]

export const DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  ...FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS,
  ...FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS
]
