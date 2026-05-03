import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/unknown-artifact-inspector',
  moduleId: 'generic-artifact-inspector',
  version: '1.0.0',
  title: 'Artifact inspector',
  description: 'Safe fallback for any artifact, ref, file, log, or JSON payload.',
  componentId: 'unknown-artifact-inspector',
  lifecycle: 'published',
  acceptsArtifactTypes: ['*'],
  viewParams: ['filter', 'sort', 'limit'],
  interactionEvents: ['open-ref'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: [],
  defaultSection: 'raw',
  priority: 100,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: { dedupeScope: 'none' },
  docs: {
    readmePath: 'packages/ui-components/unknown-artifact-inspector/README.md',
    agentSummary: 'Use as the safe fallback for unsupported artifact, file, log, JSON, or ref objects. Does not execute code.',
  },
  workbenchDemo: {
    artifactType: 'runtime-artifact',
    artifactData: {
      note: 'Workbench demo payload',
      rows: [
        { key: 'alpha', value: 1 },
        { key: 'beta', value: 2 },
      ],
    },
  },
};
