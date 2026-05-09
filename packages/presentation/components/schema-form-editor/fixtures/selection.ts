import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionSchemaFormEditorFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'schema-form-editor',
    props: { mode: 'edit', validateOnChange: true, selectedField: 'replicates' },
  },
  artifact: {
    id: 'schema-form-crispr-selection',
    type: 'editable-design',
    producerScenario: 'experiment-design-form',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'crispr-screen-form-selection',
      title: 'Selected CRISPR form field',
      designType: 'experiment',
      format: 'json',
      editable: true,
      revision: 'r1',
      schema: {
        type: 'object',
        required: ['library', 'replicates'],
        properties: {
          library: { type: 'string', enum: ['Brunello', 'GeCKO v2'] },
          replicates: { type: 'integer', minimum: 1, maximum: 6 },
        },
      },
      formData: { library: 'Brunello', replicates: 3 },
      metadata: { selectedField: 'replicates', validationState: 'valid' },
    },
  },
};
