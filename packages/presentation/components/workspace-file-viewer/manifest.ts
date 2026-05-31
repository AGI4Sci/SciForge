import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/workspace-file-viewer',
  moduleId: 'workspace-file-viewer',
  version: '1.0.0',
  title: 'Workspace file viewer',
  description: 'Right-pane workspace file tree and editable draft surface for resolved workspace file refs.',
  componentId: 'workspace-file-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['workspace-file-view'],
  acceptsArtifactTypes: ['workspace-file', 'workspace-file-view', 'workspace-tree'],
  consumes: [
    {
      kinds: ['text', 'markdown'],
      mediaTypes: ['text/plain', 'text/markdown', 'application/json'],
      extensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'json', 'css', 'txt'],
      previewPolicies: ['inline'],
    },
  ],
  viewParams: ['rootPath', 'selectedPath', 'expandedFolderPaths'],
  interactionEvents: ['open-file-request', 'save-draft-request', 'refresh-tree-request', 'toggle-folder', 'draft-change', 'close-file', 'copy-path-request', 'copy-contents-request', 'load-more-folder-request'],
  roleDefaults: ['software-engineer', 'research-engineer'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 9,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['rootPath', 'selectedPath', 'path', 'file.path'],
  },
  docs: {
    readmePath: 'packages/presentation/components/workspace-file-viewer/README.md',
    agentSummary: 'Use when a resolved workspace file should open in the right pane with a project tree and editable draft. Emits view-local open/save/copy/edit intents; host helpers own list/read/write.',
  },
  workbenchDemo: {
    artifactType: 'workspace-file-view',
    artifactData: {
      rootPath: '/workspace/SciForge',
      rootLabel: 'SciForge',
      expandedFolderPaths: ['/workspace/SciForge', '/workspace/SciForge/src'],
      selectedPath: '/workspace/SciForge/PROJECT.md',
      entriesByFolder: {
        '/workspace/SciForge': [
          { kind: 'folder', name: 'src', path: '/workspace/SciForge/src' },
          { kind: 'file', name: 'PROJECT.md', path: '/workspace/SciForge/PROJECT.md', size: 1024 },
        ],
        '/workspace/SciForge/src': [
          { kind: 'file', name: 'index.ts', path: '/workspace/SciForge/src/index.ts', size: 256 },
        ],
      },
      file: {
        path: '/workspace/SciForge/PROJECT.md',
        name: 'PROJECT.md',
        content: '# SciForge\n\nWorkspace file viewer demo.',
        size: 40,
        language: 'markdown',
      },
      draft: '# SciForge\n\nWorkspace file viewer demo.',
      dirty: false,
    },
  },
};
