import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const selectedClaim = {
  id: 'claim-ifit1-marker',
  text: 'IFIT1 is a reliable marker of type I interferon response in stimulated human cells.',
  type: 'hypothesis',
  confidence: 0.82,
  evidenceLevel: 'review',
  supportingRefs: ['paper:ifn-signaling-review', 'artifact:de-table-mini'],
  opposingRefs: [],
  dependencyRefs: ['assumption:matched-timepoint'],
  updateReason: 'selected for source inspection',
  updatedAt: '2026-05-03T00:00:00.000Z',
};

export const selectionEvidenceMatrixFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'evidence-matrix',
    title: 'Selected evidence claim',
    props: {
      selectedClaimId: selectedClaim.id,
      selectionEvent: { type: 'select-claim', claimId: selectedClaim.id },
    },
  },
  artifact: {
    id: 'evidence-matrix-selection',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'Selected IFIT1 claim' },
    data: { claimSetId: 'ifnb-mini-claims', rows: [selectedClaim] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-evidence-selection',
    scenarioId: 'literature-evidence-review',
    title: 'Evidence selection fixture',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [selectedClaim],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
  },
};

export default selectionEvidenceMatrixFixture;
