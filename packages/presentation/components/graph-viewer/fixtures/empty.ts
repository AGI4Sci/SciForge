import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
export const emptyGraphViewerFixture: UIComponentRendererProps = { slot: { componentId: 'graph-viewer' }, artifact: { id: 'graph-empty', type: 'graph', producerScenario: 'graph-preview', schemaVersion: '0.1.0', data: { nodes: [], edges: [] } } };
