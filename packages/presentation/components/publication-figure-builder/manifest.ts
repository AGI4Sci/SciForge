import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/publication-figure-builder',
  moduleId: 'publication-figure-builder',
  version: '0.1.0',
  title: 'Publication figure builder',
  description: 'Skeleton multi-panel publication figure component for Plotly-compatible panels and export profiles.',
  componentId: 'publication-figure-builder',
  lifecycle: 'draft',
  outputArtifactTypes: ['figure-spec', 'plot-spec', 'export-artifact'],
  acceptsArtifactTypes: ['figure-spec', 'plot-spec', 'publication-figure', 'plot-export-bundle', 'visual-annotation'],
  viewParams: ['journalProfile', 'selectedPanelId', 'showPanelLabels', 'exportFormat', 'dpi', 'colorPalette'],
  interactionEvents: ['select-panel', 'edit-panel-label', 'update-export-profile', 'export-figure'],
  roleDefaults: ['bioinformatician', 'experimental-biologist', 'pi'],
  fallbackModuleIds: ['scientific-plot-viewer', 'report-viewer', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 20,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'document',
    identityFields: ['figureId', 'figure_id', 'plotId', 'plotSpecRef', 'exportRef', 'revision'],
  },
  docs: {
    readmePath: 'packages/presentation/components/publication-figure-builder/README.md',
    agentSummary: 'Use for multi-panel figure specs with Plotly-compatible panels, typography/export profile, and reproducible export refs.',
  },
  workbenchDemo: {
    artifactType: 'figure-spec',
    artifactData: {
      primitive: 'figure-spec',
      figureId: 'ifnb-response-figure',
      layout: { widthMm: 180, heightMm: 120, columns: 2 },
      panels: [
        { id: 'A', label: 'A', plotSpec: { data: [{ type: 'bar', x: ['control', 'IFNB'], y: [1, 3.2] }] } },
        { id: 'B', label: 'B', plotSpec: { data: [{ type: 'scatter', mode: 'markers', x: [0.2, 1.1], y: [0.4, 2.8] }] } },
      ],
      exportProfile: { format: 'pdf', dpi: 300, fontFamily: 'Arial', colorSpace: 'RGB' },
    },
  },
};
