import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicPredictionReviewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'prediction-reviewer',
    props: { statusFilter: 'all', confidenceThreshold: 0.7, showEvidence: true },
  },
  artifact: {
    id: 'prediction-review-celltype-mini',
    type: 'prediction-set',
    producerScenario: 'celltype-prediction-review',
    schemaVersion: '0.1.0',
    data: {
      predictionSetId: 'celltype-review-demo',
      model: { name: 'celltype-xgb', version: '2026.05', task: 'classification' },
      predictions: [
        { id: 'cell-001', inputRef: 'workspace://cells/cell-001.json', label: 'T cell', confidence: 0.94, status: 'accepted', reviewer: 'analyst-a' },
        { id: 'cell-002', inputRef: 'workspace://cells/cell-002.json', label: 'monocyte', confidence: 0.62, status: 'needs-review', evidenceRef: 'workspace://evidence/cell-002-markers.json' },
        { id: 'cell-003', inputRef: 'workspace://cells/cell-003.json', label: 'B cell', confidence: 0.41, status: 'rejected', correctedLabel: 'plasma cell' },
      ],
      reviewSummary: { accepted: 1, rejected: 1, needsReview: 1 },
    },
  },
};
