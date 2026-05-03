import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/volcano-plot',
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
};
