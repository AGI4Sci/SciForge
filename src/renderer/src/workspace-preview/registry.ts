import {
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_AGENT_ACCESS,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  isDeferredNonLifeScienceExtension,
  normalizePreviewManifest,
  resolveWorkspacePreviewPlugin,
  type WorkspacePreviewCapability,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginManifest
} from '@shared/workspace-preview'

export type RendererWorkspacePreviewPluginKind =
  | 'legacy'
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
      kind: 'legacy-panel'
      panelId: 'WorkspaceFilePreviewPanel'
    }
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

export const LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID = 'legacy'
export const TEXT_WORKSPACE_PREVIEW_PLUGIN_ID = 'text'
export const MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID = 'markdown'
export const HTML_WORKSPACE_PREVIEW_PLUGIN_ID = 'html'
export const IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID = 'image'
export const PDF_WORKSPACE_PREVIEW_PLUGIN_ID = 'pdf'
export const DOCX_WORKSPACE_PREVIEW_PLUGIN_ID = 'docx'
export const TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID = 'tabular'
export const DECK_WORKSPACE_PREVIEW_PLUGIN_ID = 'deck'

const CORE_PREVIEW_VERSION = '0.1.0'

function capabilities(
  overrides: Partial<Omit<WorkspacePreviewCapability, 'agent'>> = {}
): WorkspacePreviewCapability {
  return {
    preview: true,
    edit: false,
    inspect: true,
    structuredSelection: false,
    ...overrides,
    agent: WORKSPACE_PREVIEW_AGENT_ACCESS
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
    kind: 'legacy',
    source: 'renderer-core',
    renderer: {
      kind: 'legacy-panel',
      panelId: 'WorkspaceFilePreviewPanel'
    },
    fallback: true,
    manifest: manifest({
      id: LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Legacy Workspace File Preview',
      modality: 'unknown',
      priority: 0,
      extensions: [],
      mimeTypes: [],
      capabilities: capabilities({ inspect: false }),
      notes: 'Compatibility descriptor for the existing WorkspaceFilePreviewPanel while the renderer registry is introduced.'
    })
  },
  {
    kind: 'text',
    source: 'renderer-core',
    renderer: {
      kind: 'renderer-module',
      moduleId: 'workspace-preview/text'
    },
    manifest: manifest({
      id: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
      displayName: 'Text Preview',
      modality: 'text',
      priority: 100,
      extensions: [
        '.txt',
        '.text',
        '.log',
        '.json',
        '.jsonl',
        '.xml',
        '.yaml',
        '.yml',
        '.toml',
        '.ini',
        '.env',
        '.sh',
        '.py',
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.css',
        '.scss',
        '.sql'
      ],
      mimeTypes: [
        'text/plain',
        'application/json',
        'application/x-ndjson',
        'text/csv',
        'text/tab-separated-values',
        'application/xml',
        'text/xml',
        'application/yaml',
        'text/yaml'
      ],
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
      mimeTypes: ['text/markdown', 'text/x-markdown'],
      capabilities: capabilities({
        edit: true,
        structuredSelection: true,
        export: ['markdown', 'html']
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
        export: ['png']
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
      mimeTypes: ['application/pdf'],
      capabilities: capabilities({
        structuredSelection: true,
        annotations: true,
        export: ['pdf', 'annotations']
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
        export: ['docx', 'annotations']
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
      extensions: ['.csv', '.tsv', '.xlsx', '.xls', '.jsonl', '.ndjson', '.parquet', '.feather', '.arrow'],
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
