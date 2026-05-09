import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyProtocolEditorFixture: UIComponentRendererProps = {
  slot: { componentId: 'protocol-editor', props: { mode: 'edit' } },
  artifact: {
    id: 'protocol-empty',
    type: 'protocol',
    producerScenario: 'protocol-draft-editor',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'empty-protocol',
      title: 'No protocol steps available',
      designType: 'protocol',
      materials: [],
      parameters: {},
      steps: [],
      metadata: { reason: 'Protocol generation has not started' },
    },
  },
};
