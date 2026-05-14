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
  consumes: [
    { kinds: ['unsupported'] },
    { kinds: ['binary'] },
  ],
  viewParams: ['filter', 'sort', 'limit', 'export', 'compare'],
  interactionEvents: ['open-ref', 'copy-ref', 'inspect-metadata', 'export-json', 'pin', 'compare', 'follow-up'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: [],
  defaultSection: 'raw',
  priority: 100,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: { dedupeScope: 'none' },
  docs: {
    readmePath: 'packages/presentation/components/unknown-artifact-inspector/README.md',
    agentSummary: 'Use as the safe fallback for unsupported artifact, partial result, validation failure, file, log, JSON, or ref objects. Exposes stable ref, compare, follow-up, metadata inspection, and JSON export actions without executing code.',
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
