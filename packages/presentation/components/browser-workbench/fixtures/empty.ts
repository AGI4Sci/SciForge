import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyBrowserWorkbenchFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'browser-workbench',
    title: 'Browser workbench',
  },
  artifact: {
    id: 'browser-runtime-empty',
    type: 'browser-runtime-projection',
    producerScenario: 'browser-runtime',
    schemaVersion: '0.1.0',
    data: {},
  },
};
