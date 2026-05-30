import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicWorkspaceFileViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'workspace-file-viewer' },
  artifact: {
    id: 'workspace-file-view-basic',
    type: 'workspace-file-view',
    producerScenario: 'workspace-file-preview',
    schemaVersion: '1.0.0',
    data: {
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
