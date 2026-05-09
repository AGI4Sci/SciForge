import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/execution-unit-table',
  moduleId: 'execution-provenance-table',
  version: '1.0.0',
  title: 'Execution provenance',
  description: 'Reproducible execution refs, code/log/output refs, and statuses.',
  componentId: 'execution-unit-table',
  lifecycle: 'published',
  acceptsArtifactTypes: ['*'],
  viewParams: ['filter', 'sort', 'limit'],
  interactionEvents: ['open-code-ref', 'open-log-ref'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'provenance',
  priority: 80,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/presentation/components/execution-unit-table/README.md',
    agentSummary: 'Use for reproducibility/provenance views. Accepts any artifact and focuses on execution refs, logs, and code refs.',
  },
};
