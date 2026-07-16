import {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID as SHARED_TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS,
  WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES,
  isDeferredNonLifeScienceExtension,
  normalizePreviewManifest,
  resolveWorkspacePreviewPlugin,
  type WorkspacePreviewCapability,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginManifest
} from '@shared/workspace-preview'

export type RendererWorkspacePreviewPluginKind =
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'tabular'
  | 'deck'
  | 'life-science'

export type RendererWorkspacePreviewPluginSource = 'renderer-core' | 'shared-life-science'

export type RendererWorkspacePreviewEntrypoint =
  | {
      kind: 'renderer-module'
      moduleId: string
    }
  | {
      kind: 'worker-backed'
      workerPackage?: string
    }

export type RendererWorkspacePreviewPluginDescriptor = {
  manifest: WorkspacePreviewPluginManifest
  kind: RendererWorkspacePreviewPluginKind
  source: RendererWorkspacePreviewPluginSource
  renderer: RendererWorkspacePreviewEntrypoint
  fallback?: boolean
}

export type RendererWorkspacePreviewResolveInput = {
  path: string
  mimeType?: string
  includeFallback?: boolean
}

export type RendererWorkspacePreviewRegistry = {
  register: (descriptor: RendererWorkspacePreviewPluginDescriptor) => RendererWorkspacePreviewPluginDescriptor
  list: () => readonly RendererWorkspacePreviewPluginDescriptor[]
  manifests: () => readonly WorkspacePreviewPluginManifest[]
  get: (pluginId: string) => RendererWorkspacePreviewPluginDescriptor | null
  resolve: (input: RendererWorkspacePreviewResolveInput) => RendererWorkspacePreviewPluginDescriptor | null
}

export const TEXT_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_TEXT_WORKSPACE_PREVIEW_PLUGIN_ID
export const MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID
export const HTML_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_HTML_WORKSPACE_PREVIEW_PLUGIN_ID
export const IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID
export const PDF_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_PDF_WORKSPACE_PREVIEW_PLUGIN_ID
export const DOCX_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_DOCX_WORKSPACE_PREVIEW_PLUGIN_ID
export const TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID
export const DECK_WORKSPACE_PREVIEW_PLUGIN_ID = SHARED_DECK_WORKSPACE_PREVIEW_PLUGIN_ID

const CORE_PREVIEW_VERSION = '0.1.0'

function capabilities(overrides: Partial<WorkspacePreviewCapability> = {}): WorkspacePreviewCapability {
  return {
    preview: true,
    edit: false,
    inspect: true,
    structuredSelection: false,
    ...overrides
  }
}

function manifest(input: {
  id: string
  displayName: string
  modality: WorkspacePreviewModality
  priority: number
  extensions: string[]
  mimeTypes: string[]
  capabilities: WorkspacePreviewCapability
  notes?: string
}): WorkspacePreviewPluginManifest {
  return {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    version: CORE_PREVIEW_VERSION,
    lifecycle: 'renderer',
    ...input
  }
}

export function normalizeWorkspacePreviewPluginDescriptor(
  descriptor: RendererWorkspacePreviewPluginDescriptor
): RendererWorkspacePreviewPluginDescriptor {
  return {
    ...descriptor,
    manifest: normalizePreviewManifest(descriptor.manifest)
  }
}

function sortDescriptors(
  descriptors: Iterable<RendererWorkspacePreviewPluginDescriptor>
): RendererWorkspacePreviewPluginDescriptor[] {
  return [...descriptors].sort((left, right) =>
    right.manifest.priority - left.manifest.priority ||
    left.manifest.id.localeCompare(right.manifest.id)
  )
}

const CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTOR_INPUTS: RendererWorkspacePreviewPluginDescriptor[] = [
  {
    kind: 'text',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/text'
    },
    fallback: true,
    manifest: manifest({
      id: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Text Preview',
      modality: 'text',
      priority: 100,
      extensions: [...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS],
      mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        export: ['txt']
      })
    })
  },
  {
    kind: 'markdown',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/markdown'
    },
    manifest: manifest({
      id: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Markdown Preview',
      modality: 'document',
      priority: 300,
      extensions: ['.md', '.mdx', '.markdown'],
      mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        export: ['markdown']
      })
    })
  },
  {
    kind: 'html',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/html'
    },
    manifest: manifest({
      id: HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'HTML Preview',
      modality: 'document',
      priority: 280,
      extensions: ['.html', '.htm'],
      mimeTypes: ['text/html'],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        export: ['html']
      })
    })
  },
  {
    kind: 'image',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/image'
    },
    manifest: manifest({
      id: IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Image Preview',
      modality: 'image',
      priority: 400,
      extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico'],
      mimeTypes: [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/avif',
        'image/x-icon'
      ],
      capabilities: capabilities({
        export: [...WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS]
      })
    })
  },
  {
    kind: 'pdf',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/pdf'
    },
    manifest: manifest({
      id: PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'PDF Preview',
      modality: 'document',
      priority: 500,
      extensions: ['.pdf'],
      mimeTypes: [...WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES],
      capabilities: capabilities({
        structuredSelection: true,
        annotations: true,
        export: ['pdf', 'sidecar', 'annotated-pdf']
      })
    })
  },
  {
    kind: 'docx',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/docx'
    },
    manifest: manifest({
      id: DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'DOCX Preview',
      modality: 'document',
      priority: 480,
      extensions: ['.docx'],
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      capabilities: capabilities({
        structuredSelection: true,
        annotations: true,
        export: ['docx', 'sidecar']
      })
    })
  },
  {
    kind: 'tabular',
    source: 'renderer-core',
    renderer: {
      kind: 'worker-backed',
      workerPackage: '@sciforge/workspace-tabular'
    },
    manifest: manifest({
      id: TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Tabular Data Preview',
      modality: 'tabular',
      priority: 620,
      extensions: [...WORKSPACE_PREVIEW_FIRST_PARTY_TABULAR_SHELL_EXTENSIONS],
      mimeTypes: [
        'text/csv',
        'text/tab-separated-values',
        'application/x-ndjson',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        export: ['csv', 'tsv']
      })
    })
  },
  {
    kind: 'deck',
    source: 'renderer-core',
    renderer: {
      kind: 'worker-backed',
      workerPackage: '@sciforge/workspace-deck'
    },
    manifest: manifest({
      id: DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Deck Preview',
      modality: 'deck',
      priority: 610,
      extensions: ['.pptx'],
      mimeTypes: [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        annotations: true,
        export: ['pptx']
      })
    })
  }
]

export const CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS: readonly RendererWorkspacePreviewPluginDescriptor[] =
  CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTOR_INPUTS.map(normalizeWorkspacePreviewPluginDescriptor)

export const LIFE_SCIENCE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS: readonly RendererWorkspacePreviewPluginDescriptor[] =
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS.map((lifeScienceManifest) =>
    normalizeWorkspacePreviewPluginDescriptor({
      kind: 'life-science',
      source: 'shared-life-science',
      renderer: {
        kind: 'worker-backed',
        workerPackage: lifeScienceManifest.workerPackage
      },
      manifest: lifeScienceManifest
    })
  )

export const DEFAULT_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS: readonly RendererWorkspacePreviewPluginDescriptor[] = [
  ...CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS,
  ...LIFE_SCIENCE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS
]

export function createRendererWorkspacePreviewRegistry(
  initialDescriptors: readonly RendererWorkspacePreviewPluginDescriptor[] =
    DEFAULT_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS
): RendererWorkspacePreviewRegistry {
  const descriptorsById = new Map<string, RendererWorkspacePreviewPluginDescriptor>()

  const registry: RendererWorkspacePreviewRegistry = {
    register(descriptor) {
      const normalized = normalizeWorkspacePreviewPluginDescriptor(descriptor)
      descriptorsById.set(normalized.manifest.id, normalized)
      return normalized
    },

    list() {
      return sortDescriptors(descriptorsById.values())
    },

    manifests() {
      return registry.list().map((descriptor) => descriptor.manifest)
    },

    get(pluginId) {
      return descriptorsById.get(pluginId) ?? null
    },

    resolve(input) {
      if (isDeferredNonLifeScienceExtension(input.path)) return null
      const manifestMatch = resolveWorkspacePreviewPlugin({
        path: input.path,
        mimeType: input.mimeType,
        manifests: registry.manifests()
      })
      if (manifestMatch) return registry.get(manifestMatch.id)
      if (!input.includeFallback) return null
      return registry.list().find((descriptor) => descriptor.fallback) ?? null
    }
  }

  for (const descriptor of initialDescriptors) {
    registry.register(descriptor)
  }

  return registry
}

export const rendererWorkspacePreviewRegistry = createRendererWorkspacePreviewRegistry()
