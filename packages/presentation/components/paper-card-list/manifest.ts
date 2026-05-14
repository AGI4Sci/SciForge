import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/paper-card-list',
  moduleId: 'literature-paper-cards',
  version: '1.0.0',
  title: 'Evidence paper cards',
  description: 'Paper list renderer for literature evidence artifacts.',
  componentId: 'paper-card-list',
  lifecycle: 'published',
  outputArtifactTypes: ['paper-list'],
  acceptsArtifactTypes: ['paper-list'],
  viewParams: ['filter', 'sort', 'limit', 'colorBy'],
  interactionEvents: ['select-paper', 'select-target'],
  roleDefaults: ['experimental-biologist', 'pi'],
  fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 20,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'collection',
    identityFields: ['paperListId', 'paper_list_id', 'queryId', 'query_id', 'searchQuery', 'query', 'dataRef', 'outputRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/paper-card-list/README.md',
    agentSummary: 'Use only when the current user asks for a paper-list or literature search/list. Requires papers or rows.',
  },
  workbenchDemo: {
    artifactType: 'paper-list',
    artifactData: {
      papers: [
        { title: 'Demo paper: reproducible omics workflows', source: 'SciForge Journal', year: '2026', evidenceLevel: 'review', url: 'https://example.com/paper/demo' },
        { title: 'Companion methods note', source: 'Methods Primer', year: '2025', evidenceLevel: 'experimental' },
      ],
    },
  },
};
