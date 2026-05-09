import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptySchemaFormEditorFixture: UIComponentRendererProps = {
  slot: { componentId: 'schema-form-editor', props: { mode: 'edit', showRawJson: true } },
  artifact: {
    id: 'schema-form-empty',
    type: 'editable-design',
    producerScenario: 'experiment-design-form',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'empty-schema-form',
      title: 'No schema available',
      designType: 'experiment',
      format: 'json',
      editable: true,
      formData: {},
      metadata: { reason: 'Schema generation has not completed' },
    },
  },
};
