import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionPublicationFigureBuilderFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'publication-figure-builder',
    props: { selectedPanelId: 'B', showPanelLabels: true, exportFormat: 'svg' },
  },
  artifact: {
    id: 'figure-ifnb-response-selection',
    type: 'figure-spec',
    producerScenario: 'publication-figure-draft',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'figure-spec',
      schemaVersion: '0.1.0',
      figureId: 'ifnb-response-figure-selection',
      layout: { widthMm: 180, heightMm: 120, columns: 2 },
      panels: [
        {
          id: 'B',
          label: 'B',
          selected: true,
          plotSpec: { data: [{ type: 'scatter', mode: 'markers', x: [0.2, 1.1], y: [0.4, 2.8] }] },
        },
      ],
      exportProfile: { format: 'svg', dpi: 300, fontFamily: 'Arial' },
      pendingPatch: { op: 'replace', path: '/panels/B/label', value: 'C' },
    },
  },
};
