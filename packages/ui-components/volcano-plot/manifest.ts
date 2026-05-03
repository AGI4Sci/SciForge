import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/volcano-plot',
  moduleId: 'omics-volcano-plot',
  version: '1.0.0',
  title: 'Volcano plot',
  description: 'Differential-expression volcano plot renderer.',
  componentId: 'volcano-plot',
  lifecycle: 'published',
  outputArtifactTypes: ['omics-differential-expression'],
  acceptsArtifactTypes: ['omics-differential-expression'],
  requiredFields: ['points'],
  viewParams: ['colorBy', 'filter', 'x', 'y', 'label'],
  interactionEvents: ['select-gene'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-data-table'],
  defaultSection: 'primary',
  priority: 26,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/ui-components/volcano-plot/README.md',
    agentSummary: 'Use for omics differential-expression artifacts with points. Emits select-gene.',
  },
  workbenchDemo: {
    artifactType: 'omics-differential-expression',
    artifactData: {
      points: [
        { gene: 'GENE1', logFC: 2.1, negLogP: 8.2, significant: true },
        { gene: 'GENE2', logFC: -1.8, negLogP: 5.4, significant: true },
        { gene: 'GENE3', logFC: 0.2, negLogP: 0.8, significant: false },
      ],
    },
  },
};
