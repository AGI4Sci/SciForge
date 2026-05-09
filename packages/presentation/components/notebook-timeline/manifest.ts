import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/notebook-timeline',
  moduleId: 'notebook-research-timeline',
  version: '1.0.0',
  title: 'Research notebook timeline',
  description: 'Structured research notebook and decision timeline.',
  componentId: 'notebook-timeline',
  lifecycle: 'published',
  outputArtifactTypes: ['notebook-timeline'],
  acceptsArtifactTypes: ['*'],
  viewParams: ['filter', 'sort', 'limit'],
  interactionEvents: ['select-timeline-event'],
  roleDefaults: ['experimental-biologist', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'provenance',
  priority: 85,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/presentation/components/notebook-timeline/README.md',
    agentSummary: 'Use only when the user asks for a research log, timeline, decision notebook, or provenance narrative.',
  },
};
