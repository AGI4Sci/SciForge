import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/plate-layout-viewer',
  moduleId: 'plate-layout-viewer',
  version: '0.1.0',
  title: 'Plate layout viewer',
  description: 'Skeleton plate map component for 96/384-well sample, condition, and replicate layouts.',
  componentId: 'plate-layout-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['editable-design', 'plate-layout', 'record-set'],
  acceptsArtifactTypes: ['plate-layout', 'editable-design', 'assay-layout', 'well-map', 'screen-design'],
  viewParams: ['colorBy', 'labelBy', 'selectedWell', 'showControls', 'showReplicates', 'editMode'],
  interactionEvents: ['select-well', 'edit-well', 'assign-condition', 'export-layout'],
  roleDefaults: ['experimental-biologist', 'bioinformatician'],
  fallbackModuleIds: ['schema-form-editor', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 27,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['plateId', 'plate_id', 'layoutId', 'layout_id', 'assayId', 'revision'],
  },
  docs: {
    readmePath: 'packages/presentation/components/plate-layout-viewer/README.md',
    agentSummary: 'Use for 96/384-well plate layouts with sample, condition, dose, and replicate metadata.',
  },
  workbenchDemo: {
    artifactType: 'plate-layout',
    artifactData: {
      plate: { id: 'plate-001', format: '96-well', rows: 8, columns: 12 },
      wells: [
        { well: 'A1', sample: 'DMSO-1', condition: 'vehicle', replicate: 1 },
        { well: 'A2', sample: 'Drug-1', condition: 'vemurafenib 1 uM', replicate: 1 },
      ],
    },
  },
};
