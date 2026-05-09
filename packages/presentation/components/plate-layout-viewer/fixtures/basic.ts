import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicPlateLayoutViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'plate-layout-viewer',
    props: { colorBy: 'condition', labelBy: 'sample', showControls: true },
  },
  artifact: {
    id: 'plate-layout-braf-screen',
    type: 'plate-layout',
    producerScenario: 'drug-screen-design',
    schemaVersion: '0.1.0',
    data: {
      plate: { id: 'plate-001', format: '96-well', rows: 8, columns: 12 },
      wells: [
        { well: 'A1', sample: 'A375-DMSO-r1', condition: 'vehicle', dose: 0, replicate: 1, role: 'negative-control' },
        { well: 'A2', sample: 'A375-VEM-r1', condition: 'vemurafenib', dose: 1, doseUnit: 'uM', replicate: 1 },
        { well: 'A3', sample: 'A375-VEM-r2', condition: 'vemurafenib', dose: 1, doseUnit: 'uM', replicate: 2 },
        { well: 'H12', sample: 'media-only', condition: 'blank', replicate: 1, role: 'blank' },
      ],
      metadata: { assay: 'CellTiter-Glo viability', cellLine: 'A375' },
    },
  },
};
