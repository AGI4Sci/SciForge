import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/schema-form-editor',
  moduleId: 'schema-form-editor',
  version: '0.1.0',
  title: 'Schema form editor',
  description: 'Skeleton JSON Schema-backed form editor for agent-editable scientific designs and parameters.',
  componentId: 'schema-form-editor',
  lifecycle: 'draft',
  outputArtifactTypes: ['editable-design', 'schema-form', 'record-set'],
  acceptsArtifactTypes: ['editable-design', 'schema-form', 'json-schema', 'form-artifact', 'parameter-set'],
  requiredAnyFields: [['schema', 'jsonSchema', 'uiSchema', 'formData', 'body', 'designType']],
  viewParams: ['mode', 'validateOnChange', 'showRawJson', 'section', 'readonly', 'diffAgainstRevision'],
  interactionEvents: ['change-field', 'validate-form', 'submit-form', 'open-schema-ref'],
  roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector', 'generic-data-table'],
  defaultSection: 'supporting',
  priority: 30,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['formId', 'form_id', 'designId', 'design_id', 'schemaId', 'schema_id', 'revision', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/schema-form-editor/README.md',
    agentSummary: 'Use for JSON Schema-backed editable design or parameter artifacts. This skeleton declares edit events but does not execute validation code or plugins.',
  },
  workbenchDemo: {
    artifactType: 'editable-design',
    artifactData: {
      primitive: 'editable-design',
      id: 'crispr-screen-form',
      title: 'CRISPR screen design parameters',
      designType: 'experiment',
      format: 'json',
      editable: true,
      schema: {
        type: 'object',
        required: ['library', 'replicates'],
        properties: {
          library: { type: 'string', enum: ['Brunello', 'GeCKO v2'] },
          replicates: { type: 'integer', minimum: 1, maximum: 6 },
        },
      },
      formData: { library: 'Brunello', replicates: 3 },
    },
  },
};
