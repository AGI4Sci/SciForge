import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicModelEvalViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'model-eval-viewer',
    props: { metricSet: 'classification', threshold: 0.5, curve: 'roc' },
  },
  artifact: {
    id: 'model-eval-celltype-xgb',
    type: 'model-artifact',
    producerScenario: 'single-cell-classifier-eval',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'model-artifact',
      schemaVersion: '0.1.0',
      id: 'celltype-xgb-eval',
      title: 'Cell type classifier evaluation',
      model: {
        name: 'celltype-xgb',
        version: '2026.05',
        task: 'classification',
        framework: 'xgboost',
        checkpointRef: 'workspace://models/celltype-xgb.json',
        configRef: 'workspace://models/celltype-xgb.config.json',
      },
      metrics: { auroc: 0.94, auprc: 0.89, accuracy: 0.91, macroF1: 0.88, selectedThreshold: 0.5 },
      roc: [
        { fpr: 0, tpr: 0, threshold: 1 },
        { fpr: 0.04, tpr: 0.58, threshold: 0.72 },
        { fpr: 0.11, tpr: 0.83, threshold: 0.5 },
        { fpr: 1, tpr: 1, threshold: 0 },
      ],
      pr: [
        { recall: 0, precision: 1, threshold: 1 },
        { recall: 0.58, precision: 0.91, threshold: 0.72 },
        { recall: 0.83, precision: 0.79, threshold: 0.5 },
        { recall: 1, precision: 0.42, threshold: 0 },
      ],
      confusionMatrix: {
        labels: ['B cell', 'T cell', 'monocyte'],
        matrix: [
          [48, 2, 1],
          [3, 61, 4],
          [2, 5, 44],
        ],
      },
      inputs: ['normalized_gene_expression'],
      outputs: ['cell_type_label'],
      metadata: { datasetId: 'pbmc-heldout-2026-05', split: 'heldout' },
    },
  },
};
