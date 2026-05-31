import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import { VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE, VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION } from '../manifest';

export const emptyVirtualScreenViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'virtual-screen-viewer', title: 'Virtual Screen' },
  artifact: {
    id: 'virtual-screen-empty',
    type: VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
    data: {},
  },
};
