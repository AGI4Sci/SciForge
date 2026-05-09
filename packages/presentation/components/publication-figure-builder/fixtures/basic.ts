import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicPublicationFigureBuilderFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'publication-figure-builder',
    props: { journalProfile: 'two-column', showPanelLabels: true, exportFormat: 'pdf' },
  },
  artifact: {
    id: 'figure-ifnb-response',
    type: 'figure-spec',
    producerScenario: 'publication-figure-draft',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'figure-spec',
      schemaVersion: '0.1.0',
      figureId: 'ifnb-response-figure',
      title: 'Interferon response summary figure',
      layout: { widthMm: 180, heightMm: 120, columns: 2, rows: 1, gutterMm: 6 },
      panels: [
        {
          id: 'A',
          label: 'A',
          title: 'ISG expression',
          plotSpec: {
            data: [{ type: 'bar', x: ['control', 'IFNB'], y: [1, 3.2], marker: { color: ['#6B7280', '#2563EB'] } }],
            layout: { yaxis: { title: { text: 'Relative expression' } } },
          },
        },
        {
          id: 'B',
          label: 'B',
          title: 'Cell response score',
          plotSpec: {
            data: [{ type: 'scatter', mode: 'markers', x: [0.2, 1.1, 1.4], y: [0.4, 2.8, 3.1], name: 'cells' }],
            layout: { xaxis: { title: { text: 'Baseline score' } }, yaxis: { title: { text: 'IFNB score' } } },
          },
        },
      ],
      exportProfile: { format: 'pdf', dpi: 300, widthMm: 180, heightMm: 120, fontFamily: 'Arial', colorSpace: 'RGB', vectorPreferred: true },
    },
  },
};
