import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionUnknownArtifactInspectorFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'unknown-artifact-inspector',
    title: 'Open artifact reference',
    props: {
      selectedRef: 'workspace://artifacts/af2-confidence-summary.json',
      selectionEvent: { type: 'open-ref', ref: 'workspace://artifacts/af2-confidence-summary.json' },
    },
  },
  artifact: {
    id: 'runtime-artifact-ref-selection',
    type: 'runtime-artifact',
    producerScenario: 'structure-exploration',
    schemaVersion: '1',
    metadata: { title: 'Selected confidence summary reference' },
    dataRef: 'workspace://artifacts/af2-confidence-summary.json',
    data: {
      refs: [
        { kind: 'dataRef', ref: 'workspace://artifacts/af2-confidence-summary.json', mimeType: 'application/json' },
        { kind: 'source', ref: 'workspace://runs/eu-af2-summary/stdout.txt', mimeType: 'text/plain' },
      ],
    },
  },
};

export default selectionUnknownArtifactInspectorFixture;
