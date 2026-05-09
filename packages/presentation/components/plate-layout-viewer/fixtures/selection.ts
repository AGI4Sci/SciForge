import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionPlateLayoutViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'plate-layout-viewer',
    props: { selectedWell: 'A2', colorBy: 'condition', labelBy: 'sample' },
  },
  artifact: {
    id: 'plate-layout-braf-selection',
    type: 'plate-layout',
    producerScenario: 'drug-screen-design',
    schemaVersion: '0.1.0',
    data: {
      plate: { id: 'plate-001', format: '96-well', rows: 8, columns: 12 },
      wells: [
        { well: 'A2', sample: 'A375-VEM-r1', condition: 'vemurafenib', dose: 1, doseUnit: 'uM', replicate: 1, selected: true },
      ],
      metadata: { selectedWell: 'A2' },
    },
  },
};
