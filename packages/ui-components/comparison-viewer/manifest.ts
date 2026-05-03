import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/comparison-viewer',
  moduleId: 'comparison-viewer',
  version: '0.1.0',
  title: 'Comparison viewer',
  description: 'Skeleton artifact comparison component for compact diffs between scientific artifacts.',
  componentId: 'comparison-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['artifact-diff', 'comparison-summary'],
  acceptsArtifactTypes: ['artifact-diff', 'comparison-summary', 'record-set-diff', 'schema-diff', 'text-diff', 'model-comparison'],
  requiredAnyFields: [['base', 'candidate', 'changes', 'diff', 'left', 'right', 'summary']],
  viewParams: ['mode', 'granularity', 'showUnchanged', 'highlightSeverity', 'leftLabel', 'rightLabel'],
  interactionEvents: ['select-change', 'open-left-ref', 'open-right-ref', 'accept-change'],
  roleDefaults: ['bioinformatician', 'experimental-biologist', 'pi'],
  fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 32,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['comparisonId', 'comparison_id', 'diffId', 'diff_id', 'leftRef', 'rightRef', 'baseRef', 'candidateRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/comparison-viewer/README.md',
    agentSummary: 'Use for compact artifact diffs with explicit left/right refs and structured changes. It is not a merge engine.',
  },
  workbenchDemo: {
    artifactType: 'artifact-diff',
    artifactData: {
      comparisonId: 'protocol-dose-update',
      left: { ref: 'workspace://protocols/screen-v1.json', label: 'Protocol v1' },
      right: { ref: 'workspace://protocols/screen-v2.json', label: 'Protocol v2' },
      summary: { added: 1, removed: 0, changed: 2 },
      changes: [
        { path: '/selectionDays', kind: 'changed', before: 10, after: 14, severity: 'medium' },
        { path: '/treatment', kind: 'changed', before: 'vehicle', after: 'vemurafenib 1 uM', severity: 'high' },
      ],
    },
  },
};
