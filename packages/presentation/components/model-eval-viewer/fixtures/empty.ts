import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyModelEvalViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'model-eval-viewer', props: { metricSet: 'classification' } },
  artifact: {
    id: 'model-eval-empty',
    type: 'model-artifact',
    producerScenario: 'single-cell-classifier-eval',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'model-artifact',
      schemaVersion: '0.1.0',
      id: 'empty-model-eval',
      title: 'No evaluation metrics available',
      model: { name: 'celltype-xgb', task: 'classification' },
      metrics: {},
      metadata: { reason: 'Evaluation job has not produced metrics yet' },
    },
  },
};
