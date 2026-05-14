import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/model-eval-viewer',
  moduleId: 'model-eval-viewer',
  version: '0.1.0',
  title: 'Model evaluation viewer',
  description: 'Skeleton viewer for model metrics, ROC/PR curves, confusion matrices, and evaluation summaries.',
  componentId: 'model-eval-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['model-artifact', 'statistical-result', 'plot-spec'],
  acceptsArtifactTypes: ['model-artifact', 'model-evaluation', 'classification-metrics', 'regression-metrics', 'model-report'],
  viewParams: ['metricSet', 'threshold', 'curve', 'split', 'showConfidenceIntervals', 'compareToBaseline'],
  interactionEvents: ['select-threshold', 'select-class', 'hover-curve-point', 'open-model-ref'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: ['scientific-plot-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 22,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['modelId', 'model_id', 'evaluationId', 'evaluation_id', 'checkpointRef', 'resultRef', 'datasetId'],
  },
  docs: {
    readmePath: 'packages/presentation/components/model-eval-viewer/README.md',
    agentSummary: 'Use for model evaluation artifacts with metrics, ROC/PR curves, confusion matrices, or checkpoint/config refs. It is a viewer contract, not a model runner.',
  },
  workbenchDemo: {
    artifactType: 'model-artifact',
    artifactData: {
      primitive: 'model-artifact',
      id: 'celltype-xgb-eval',
      title: 'Cell type classifier evaluation',
      model: { name: 'celltype-xgb', version: '2026.05', task: 'classification', framework: 'xgboost' },
      metrics: { auroc: 0.94, auprc: 0.89, accuracy: 0.91, macroF1: 0.88 },
      roc: [{ fpr: 0, tpr: 0 }, { fpr: 0.08, tpr: 0.72 }, { fpr: 1, tpr: 1 }],
      pr: [{ recall: 0, precision: 1 }, { recall: 0.72, precision: 0.84 }, { recall: 1, precision: 0.42 }],
    },
  },
};
