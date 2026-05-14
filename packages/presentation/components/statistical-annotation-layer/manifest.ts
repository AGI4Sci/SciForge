import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/statistical-annotation-layer',
  moduleId: 'statistical-annotation-layer',
  version: '0.1.0',
  title: 'Statistical annotation layer',
  description: 'Skeleton overlay component for p values, confidence intervals, effect sizes, and significance brackets.',
  componentId: 'statistical-annotation-layer',
  lifecycle: 'draft',
  outputArtifactTypes: ['statistical-result', 'visual-annotation'],
  acceptsArtifactTypes: ['statistical-result', 'visual-annotation', 'plot-spec', 'figure-spec', 'comparison-summary'],
  viewParams: ['targetPanelId', 'showPValues', 'showEffectSizes', 'multipleTesting', 'selectedAnnotationId', 'format'],
  interactionEvents: ['select-annotation', 'edit-label', 'toggle-annotation', 'open-stat-result-ref'],
  roleDefaults: ['bioinformatician', 'experimental-biologist', 'pi'],
  fallbackModuleIds: ['scientific-plot-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 31,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['annotationSetId', 'annotation_set_id', 'resultId', 'resultRef', 'targetPanelId', 'plotId'],
  },
  docs: {
    readmePath: 'packages/presentation/components/statistical-annotation-layer/README.md',
    agentSummary: 'Use for visual statistical overlays linked to plot or figure targets. It displays declared results and must not run statistical tests.',
  },
  workbenchDemo: {
    artifactType: 'statistical-result',
    artifactData: {
      primitive: 'statistical-result',
      annotationSetId: 'ifnb-bars-stats',
      target: { plotId: 'ifnb-response-bar', panelId: 'A' },
      annotations: [
        { id: 'ifnb-vs-control', kind: 'bracket', groups: ['control', 'IFNB'], pValue: 0.0032, adjustedPValue: 0.0064, effectSize: { name: 'log2FC', value: 1.68 }, confidenceInterval: [1.1, 2.2] },
      ],
    },
  },
};
