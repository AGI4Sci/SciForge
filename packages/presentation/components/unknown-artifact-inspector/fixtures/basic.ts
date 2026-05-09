import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicUnknownArtifactInspectorFixture: UIComponentRendererProps = {
  slot: { componentId: 'unknown-artifact-inspector', title: 'Unsupported artifact inspection' },
  artifact: {
    id: 'runtime-artifact-mini',
    type: 'runtime-artifact',
    producerScenario: 'structure-exploration',
    schemaVersion: '1',
    metadata: {
      title: 'AlphaFold confidence summary ref',
      mimeType: 'application/json',
    },
    dataRef: 'workspace://artifacts/af2-confidence-summary.json',
    data: {
      modelId: 'AF-Q9Y261-F1',
      protein: 'FOXA2',
      metrics: [
        { name: 'mean_pLDDT', value: 86.4, unit: 'score' },
        { name: 'low_confidence_residues', value: 14, unit: 'count' },
      ],
      notes: 'Inspector fixture keeps unknown payload visible without executing or interpreting it.',
    },
  },
};

export default basicUnknownArtifactInspectorFixture;
