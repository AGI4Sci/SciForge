import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/prediction-reviewer',
  moduleId: 'prediction-reviewer',
  version: '0.1.0',
  title: 'Prediction reviewer',
  description: 'Skeleton human-in-the-loop review component for AI prediction rows and feedback artifacts.',
  componentId: 'prediction-reviewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['prediction-review', 'record-set', 'claim-evidence'],
  acceptsArtifactTypes: ['prediction-set', 'prediction-review', 'model-artifact', 'ai-predictions', 'record-set'],
  requiredAnyFields: [['predictions', 'rows', 'reviews', 'model', 'predictionRef', 'dataRef']],
  viewParams: ['statusFilter', 'confidenceThreshold', 'labelField', 'showEvidence', 'selectedPredictionId'],
  interactionEvents: ['accept-prediction', 'reject-prediction', 'request-review', 'edit-label', 'open-evidence-ref'],
  roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
  fallbackModuleIds: ['model-eval-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 28,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'collection',
    identityFields: ['predictionSetId', 'prediction_set_id', 'modelId', 'datasetId', 'reviewBatchId', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/prediction-reviewer/README.md',
    agentSummary: 'Use for human review of prediction rows with accept/reject/review status and feedback output. It must not run inference.',
  },
  workbenchDemo: {
    artifactType: 'prediction-set',
    artifactData: {
      predictionSetId: 'celltype-review-demo',
      model: { name: 'celltype-xgb', version: '2026.05' },
      predictions: [
        { id: 'cell-001', inputRef: 'workspace://cells/cell-001.json', label: 'T cell', confidence: 0.94, status: 'accepted' },
        { id: 'cell-002', inputRef: 'workspace://cells/cell-002.json', label: 'monocyte', confidence: 0.62, status: 'needs-review' },
      ],
    },
  },
};
