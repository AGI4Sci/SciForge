import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionModelEvalViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'model-eval-viewer',
    props: { metricSet: 'classification', threshold: 0.5, curve: 'roc', selectedClass: 'T cell' },
  },
  artifact: {
    id: 'model-eval-celltype-selection',
    type: 'model-artifact',
    producerScenario: 'single-cell-classifier-eval',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'model-artifact',
      schemaVersion: '0.1.0',
      id: 'celltype-xgb-threshold-selection',
      title: 'Selected threshold evaluation',
      model: {
        name: 'celltype-xgb',
        version: '2026.05',
        task: 'classification',
        framework: 'xgboost',
        checkpointRef: 'workspace://models/celltype-xgb.json',
      },
      metrics: { auroc: 0.94, auprc: 0.89, selectedThreshold: 0.5 },
      roc: [
        { fpr: 0.04, tpr: 0.58, threshold: 0.72 },
        { fpr: 0.11, tpr: 0.83, threshold: 0.5, selected: true },
      ],
      confusionMatrix: {
        labels: ['B cell', 'T cell', 'monocyte'],
        matrix: [
          [48, 2, 1],
          [3, 61, 4],
          [2, 5, 44],
        ],
        selectedClass: 'T cell',
      },
      metadata: { selectedThreshold: 0.5, selectedClass: 'T cell' },
    },
  },
};
