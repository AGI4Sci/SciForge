import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/protocol-editor',
  moduleId: 'protocol-editor',
  version: '0.1.0',
  title: 'Protocol editor',
  description: 'Skeleton editable protocol component for stepwise methods, materials, and parameter patches.',
  componentId: 'protocol-editor',
  lifecycle: 'draft',
  outputArtifactTypes: ['editable-design', 'document', 'workflow-provenance'],
  acceptsArtifactTypes: ['protocol', 'editable-design', 'experimental-protocol', 'method-document', 'workflow-protocol'],
  requiredAnyFields: [['steps', 'materials', 'parameters', 'body', 'protocolId', 'designType']],
  viewParams: ['mode', 'selectedStepId', 'showMaterials', 'showParameters', 'showExecutionStatus', 'diffAgainstRevision'],
  interactionEvents: ['select-step', 'edit-step', 'edit-parameter', 'insert-step', 'export-protocol'],
  roleDefaults: ['experimental-biologist', 'pi'],
  fallbackModuleIds: ['schema-form-editor', 'report-viewer', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 26,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['protocolId', 'protocol_id', 'designId', 'revision', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/protocol-editor/README.md',
    agentSummary: 'Use for editable stepwise scientific protocols with parameters and materials. It is not a notebook or execution runner.',
  },
  workbenchDemo: {
    artifactType: 'protocol',
    artifactData: {
      primitive: 'editable-design',
      id: 'if-staining-protocol',
      designType: 'protocol',
      steps: [
        { id: 'fix', title: 'Fix cells', duration: '10 min', params: { reagent: '4% PFA' } },
        { id: 'stain', title: 'Primary antibody incubation', duration: '60 min', params: { antibody: 'anti-Ki67', dilution: '1:500' } },
      ],
    },
  },
};
