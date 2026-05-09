import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyPlateLayoutViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'plate-layout-viewer', props: { colorBy: 'condition' } },
  artifact: {
    id: 'plate-layout-empty',
    type: 'plate-layout',
    producerScenario: 'drug-screen-design',
    schemaVersion: '0.1.0',
    data: {
      plate: { id: 'plate-empty', format: '96-well', rows: 8, columns: 12 },
      wells: [],
      metadata: { reason: 'Plate design has no assigned wells yet' },
    },
  },
};
