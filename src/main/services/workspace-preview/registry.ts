import {
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_AGENT_ACCESS,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  isDeferredNonLifeScienceExtension,
  normalizePreviewManifest,
  resolveLifeSciencePreviewRoute,
  resolveWorkspacePreviewPlugin,
  type WorkspacePreviewPluginManifest
} from '../../../shared/workspace-preview'

export const LEGACY_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-markdown',
    displayName: 'Markdown Preview',
    version: '0.1.0',
    modality: 'text',
    lifecycle: 'renderer',
    priority: 500,
    extensions: ['.md', '.mdx', '.markdown'],
    mimeTypes: ['text/markdown'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['markdown', 'html'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-html',
    displayName: 'HTML Preview',
    version: '0.1.0',
    modality: 'text',
    lifecycle: 'hybrid',
    priority: 480,
    extensions: ['.html', '.htm'],
    mimeTypes: ['text/html'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['html'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-pdf',
    displayName: 'PDF Preview',
    version: '0.1.0',
    modality: 'document',
    lifecycle: 'renderer',
    priority: 520,
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      annotations: true,
      export: ['pdf', 'sidecar'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-docx',
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
      export: ['docx', 'sidecar'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-image',
    displayName: 'Image Preview',
    version: '0.1.0',
    modality: 'image',
    lifecycle: 'renderer',
    priority: 450,
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/x-icon'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['png', 'jpeg', 'webp'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'legacy-text',
    displayName: 'Text Preview',
    version: '0.1.0',
    modality: 'text',
    lifecycle: 'renderer',
    priority: 100,
    extensions: ['.txt', '.log', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.tex', '.bib', '.py', '.js', '.ts', '.tsx'],
    mimeTypes: ['text/plain', 'application/json', 'application/x-yaml'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['text'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  }
] as const

export const PLANNED_WORKSPACE_PREVIEW_MANIFESTS: readonly WorkspacePreviewPluginManifest[] = [
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'text',
    displayName: 'Text Preview',
    version: '0.1.0',
    modality: 'text',
    lifecycle: 'main',
    priority: 150,
    extensions: [
      '.txt',
      '.text',
      '.log',
      '.json',
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
      '.sql',
      '.tex',
      '.bib'
    ],
    mimeTypes: ['text/plain', 'application/json', 'application/xml', 'text/xml', 'application/yaml', 'text/yaml'],
    capabilities: {
      preview: true,
      edit: true,
      inspect: true,
      structuredSelection: true,
      export: ['txt'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    }
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'tabular',
    displayName: 'Tabular Data Preview',
    version: '0.1.0',
    modality: 'tabular',
    lifecycle: 'worker',
    priority: 620,
    extensions: ['.csv', '.tsv', '.xlsx', '.xls', '.jsonl', '.ndjson', '.parquet', '.feather', '.arrow'],
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
      export: ['csv', 'tsv'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-tabular'
  },
  {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'deck',
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
      export: ['pptx'],
      agent: WORKSPACE_PREVIEW_AGENT_ACCESS
    },
    workerPackage: '@sciforge/workspace-deck'
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
      const text = this.get('legacy-text')
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
    ...LEGACY_WORKSPACE_PREVIEW_MANIFESTS,
    ...PLANNED_WORKSPACE_PREVIEW_MANIFESTS,
    ...LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS
  ].map(normalizePreviewManifest)
}

export function createWorkspacePreviewRegistry(
  manifests?: readonly WorkspacePreviewPluginManifest[]
): WorkspacePreviewRegistry {
  return new WorkspacePreviewRegistry(manifests)
}
