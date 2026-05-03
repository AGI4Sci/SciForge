import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/paper-card-list',
  moduleId: 'literature-paper-cards',
  version: '1.0.0',
  title: 'Evidence paper cards',
  description: 'Paper list renderer for literature evidence artifacts.',
  componentId: 'paper-card-list',
  lifecycle: 'published',
  outputArtifactTypes: ['paper-list'],
  acceptsArtifactTypes: ['paper-list'],
  requiredAnyFields: [['papers', 'rows']],
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
    readmePath: 'packages/ui-components/paper-card-list/README.md',
    agentSummary: 'Use only when the current user asks for a paper-list or literature search/list. Requires papers or rows.',
  },
};
