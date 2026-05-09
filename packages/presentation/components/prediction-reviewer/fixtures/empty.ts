import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyPredictionReviewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'prediction-reviewer', props: { statusFilter: 'needs-review' } },
  artifact: {
    id: 'prediction-review-empty',
    type: 'prediction-set',
    producerScenario: 'celltype-prediction-review',
    schemaVersion: '0.1.0',
    data: {
      predictionSetId: 'empty-prediction-review',
      model: { name: 'celltype-xgb', task: 'classification' },
      predictions: [],
      reviewSummary: { accepted: 0, rejected: 0, needsReview: 0 },
      metadata: { reason: 'Prediction job has not produced rows' },
    },
  },
};
