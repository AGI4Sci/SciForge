import {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
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
  isDeferredNonLifeScienceExtension,
  normalizePreviewManifest,
  resolveLifeSciencePreviewRoute,
  resolveWorkspacePreviewPlugin,
  type WorkspacePreviewPluginManifest
} from '../../../shared/workspace-preview'

export const FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  {
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
      export: ['markdown']
    }
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  }
] as const

export const FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'biology-index-transport',
    displayName: 'Biology Index Transport',
    version: '0.1.0',
    modality: 'unknown',
    lifecycle: 'main',
    priority: 805,
    extensions: ['.fai', '.gzi', '.tbi', '.csi'],
    mimeTypes: [],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: false,
      export: []
    },
    notes: 'Passive byte-range transport for validated Biology Room companion indexes.'
  }
] as const

export type WorkspacePreviewRoute =
  | {
      status: 'matched'
      manifest: WorkspacePreviewPluginManifest
    }
  | {
      status: 'fallback'
      manifest: WorkspacePreviewPluginManifest
      reason: 'text-compatible'
    }
  | {
      status: 'unsupported'
      path: string
      mimeType?: string
    }
  | {
      status: 'deferred'
      path: string
      extension: string
      reason: string
    }

export class WorkspacePreviewRegistry {
  private readonly manifestsById = new Map<string, WorkspacePreviewPluginManifest>()

  constructor(manifests: readonly WorkspacePreviewPluginManifest[] = defaultWorkspacePreviewManifests()) {
    for (const manifest of manifests) {
      this.register(manifest)
    }
  }

  register(manifest: WorkspacePreviewPluginManifest): void {
    const normalized = normalizePreviewManifest(manifest)
    this.manifestsById.set(normalized.id, normalized)
  }

  list(): WorkspacePreviewPluginManifest[] {
    return [...this.manifestsById.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  }

  get(id: string): WorkspacePreviewPluginManifest | undefined {
    return this.manifestsById.get(id)
  }

  resolve(input: { path: string; mimeType?: string; fallbackToText?: boolean }): WorkspacePreviewRoute {
    if (isDeferredNonLifeScienceExtension(input.path)) {
      const route = resolveLifeSciencePreviewRoute(input.path)
      if (route.scope === 'deferred-non-life-science') {
        return {
          status: 'deferred',
          path: input.path,
          extension: route.format.extension,
          reason: route.format.reason
        }
      }
    }

    const matched = resolveWorkspacePreviewPlugin({
      path: input.path,
      mimeType: input.mimeType,
      manifests: this.list()
    })
    if (matched) return { status: 'matched', manifest: matched }

    if (input.fallbackToText ?? true) {
      const text = this.get(TEXT_WORKSPACE_PREVIEW_PLUGIN_ID)
      if (text) {
        return {
          status: 'fallback',
          manifest: text,
          reason: 'text-compatible'
        }
      }
    }

    return {
      status: 'unsupported',
      path: input.path,
      ...(input.mimeType ? { mimeType: input.mimeType } : {})
    }
  }
}

export function defaultWorkspacePreviewManifests(): WorkspacePreviewPluginManifest[] {
  return [
    ...FIRST_PARTY_DOCUMENT_WORKSPACE_PREVIEW_MANIFESTS,
    ...FIRST_PARTY_WORKSPACE_PREVIEW_MANIFESTS,
    ...LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS
  ].map(normalizePreviewManifest)
}

export function createWorkspacePreviewRegistry(
  manifests?: readonly WorkspacePreviewPluginManifest[]
): WorkspacePreviewRegistry {
  return new WorkspacePreviewRegistry(manifests)
}
