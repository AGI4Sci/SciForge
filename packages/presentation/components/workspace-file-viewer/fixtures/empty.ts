import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyWorkspaceFileViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'workspace-file-viewer' },
  artifact: {
    id: 'workspace-file-view-empty',
    type: 'workspace-file-view',
    producerScenario: 'workspace-file-preview',
    schemaVersion: '1.0.0',
    data: {
      rootPath: '/workspace/empty',
      rootLabel: 'empty',
      expandedFolderPaths: ['/workspace/empty'],
      entriesByFolder: {
        '/workspace/empty': [],
      },
      file: null,
      draft: '',
      dirty: false,
    },
  },
};
