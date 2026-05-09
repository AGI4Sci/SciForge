import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionPredictionReviewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'prediction-reviewer',
    props: { selectedPredictionId: 'cell-002', statusFilter: 'needs-review', showEvidence: true },
  },
  artifact: {
    id: 'prediction-review-celltype-selection',
    type: 'prediction-set',
    producerScenario: 'celltype-prediction-review',
    schemaVersion: '0.1.0',
    data: {
      predictionSetId: 'celltype-review-selection',
      model: { name: 'celltype-xgb', version: '2026.05' },
      predictions: [
        { id: 'cell-002', inputRef: 'workspace://cells/cell-002.json', label: 'monocyte', confidence: 0.62, status: 'needs-review', selected: true, evidenceRef: 'workspace://evidence/cell-002-markers.json' },
      ],
      pendingAction: { type: 'request-review', predictionId: 'cell-002', reason: 'Low confidence with mixed marker evidence' },
    },
  },
};
