import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyUnknownArtifactInspectorFixture: UIComponentRendererProps = {
  slot: { componentId: 'unknown-artifact-inspector', title: 'Empty artifact inspection', props: {} },
  artifact: {
    id: 'runtime-artifact-empty',
    type: 'runtime-artifact',
    producerScenario: 'structure-exploration',
    schemaVersion: '1',
    metadata: { title: 'Empty runtime artifact shell' },
    data: {},
  },
};

export default emptyUnknownArtifactInspectorFixture;
