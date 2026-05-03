import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicGraphViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'graph-viewer', encoding: { colorBy: 'type' } },
  artifact: { id: 'graph-basic', type: 'graph', producerScenario: 'graph-preview', schemaVersion: '0.1.0', data: { nodes: [{ id: 'BRAF', label: 'BRAF', type: 'gene' }, { id: 'vemurafenib', label: 'Vemurafenib', type: 'drug' }], edges: [{ source: 'vemurafenib', target: 'BRAF', relation: 'targets', confidence: 0.92 }] } },
};
