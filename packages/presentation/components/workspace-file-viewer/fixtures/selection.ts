import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionWorkspaceFileViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'workspace-file-viewer',
    props: { selectedPath: '/workspace/SciForge/src/index.ts' },
  },
  artifact: {
    id: 'workspace-file-view-selection',
    type: 'workspace-file-view',
    producerScenario: 'workspace-file-preview',
    schemaVersion: '1.0.0',
    data: {
      rootPath: '/workspace/SciForge',
      rootLabel: 'SciForge',
      expandedFolderPaths: ['/workspace/SciForge', '/workspace/SciForge/src'],
      selectedPath: '/workspace/SciForge/src/index.ts',
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
        path: '/workspace/SciForge/src/index.ts',
        name: 'index.ts',
        content: 'export const ok = true;\n',
        size: 24,
        language: 'typescript',
      },
      draft: 'export const ok = true;\n',
      dirty: false,
    },
  },
};
