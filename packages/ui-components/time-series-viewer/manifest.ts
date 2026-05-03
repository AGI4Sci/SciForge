import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/time-series-viewer',
  moduleId: 'time-series-viewer',
  version: '0.1.0',
  title: 'Time-series viewer',
  description: 'Skeleton viewer for ordered measurements such as growth curves, sensor traces, and assay readouts.',
  componentId: 'time-series-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['time-series', 'plot-spec'],
  acceptsArtifactTypes: ['time-series', 'growth-curve', 'sensor-trace', 'longitudinal-measurement', 'plot-spec'],
  requiredAnyFields: [['series', 'points', 'time', 'timestamps', 'rows', 'dataRef']],
  viewParams: ['xField', 'yField', 'timeUnit', 'normalize', 'showErrorBars', 'highlightWindow', 'syncViewport'],
  interactionEvents: ['select-time-window', 'hover-point', 'select-series', 'export-plot'],
  roleDefaults: ['bioinformatician', 'experimental-biologist', 'pi'],
  fallbackModuleIds: ['scientific-plot-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 21,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['seriesId', 'series_id', 'datasetId', 'dataset_id', 'assayId', 'assay_id', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/time-series-viewer/README.md',
    agentSummary: 'Use for ordered measurements with one or more named series and explicit time units.',
  },
  workbenchDemo: {
    artifactType: 'time-series',
    artifactData: {
      primitive: 'time-series',
      id: 'ecoli-growth-demo',
      title: 'E. coli OD600 growth curve',
      timeUnit: 'hour',
      series: [
        { name: 'control', unit: 'OD600', points: [{ t: 0, value: 0.06 }, { t: 2, value: 0.18 }, { t: 4, value: 0.55 }] },
        { name: 'ciprofloxacin', unit: 'OD600', points: [{ t: 0, value: 0.06 }, { t: 2, value: 0.09 }, { t: 4, value: 0.11 }] },
      ],
    },
  },
};
