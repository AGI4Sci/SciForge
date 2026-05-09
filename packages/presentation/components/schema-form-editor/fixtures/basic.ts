import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicSchemaFormEditorFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'schema-form-editor',
    props: { mode: 'edit', validateOnChange: true, showRawJson: false },
  },
  artifact: {
    id: 'schema-form-crispr-screen',
    type: 'editable-design',
    producerScenario: 'experiment-design-form',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'editable-design',
      schemaVersion: '0.1.0',
      id: 'crispr-screen-form',
      title: 'CRISPR screen design parameters',
      designType: 'experiment',
      format: 'json',
      editable: true,
      revision: 'r1',
      schema: {
        type: 'object',
        required: ['library', 'cellLine', 'replicates', 'selectionDays'],
        properties: {
          library: { type: 'string', enum: ['Brunello', 'GeCKO v2'], title: 'sgRNA library' },
          cellLine: { type: 'string', title: 'Cell line' },
          replicates: { type: 'integer', minimum: 1, maximum: 6 },
          selectionDays: { type: 'integer', minimum: 3, maximum: 21 },
          treatment: { type: 'string' },
        },
      },
      uiSchema: { treatment: { widget: 'textarea' } },
      formData: {
        library: 'Brunello',
        cellLine: 'A375',
        replicates: 3,
        selectionDays: 14,
        treatment: 'vemurafenib 1 uM',
      },
      body: {
        objective: 'Identify modifiers of BRAF inhibitor resistance',
      },
      metadata: { selectedField: 'replicates' },
    },
  },
};
