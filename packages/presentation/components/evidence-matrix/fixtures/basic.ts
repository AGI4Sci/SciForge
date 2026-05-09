import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const session = {
  schemaVersion: 2,
  sessionId: 'fixture-evidence-basic',
  scenarioId: 'literature-evidence-review',
  title: 'Evidence matrix fixture',
  createdAt: '2026-05-03T00:00:00.000Z',
  updatedAt: '2026-05-03T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [
    {
      id: 'claim-ifit1-marker',
      text: 'IFIT1 is a reliable marker of type I interferon response in stimulated human cells.',
      type: 'hypothesis',
      confidence: 0.82,
      evidenceLevel: 'review',
      supportingRefs: ['paper:ifn-signaling-review', 'artifact:de-table-mini'],
      opposingRefs: [],
      dependencyRefs: ['assumption:matched-timepoint'],
      updateReason: 'curated mini literature synthesis',
      updatedAt: '2026-05-03T00:00:00.000Z',
    },
    {
      id: 'claim-batch-effect',
      text: 'Batch effects remain a plausible alternative explanation for weaker OAS1 induction.',
      type: 'inference',
      confidence: 0.46,
      evidenceLevel: 'computational',
      supportingRefs: ['artifact:qc-summary-mini'],
      opposingRefs: ['artifact:replicate-correlation-mini'],
      updatedAt: '2026-05-03T00:00:00.000Z',
    },
  ],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
};

export const basicEvidenceMatrixFixture: UIComponentRendererProps = {
  slot: { componentId: 'evidence-matrix', title: 'Claim evidence matrix' },
  artifact: {
    id: 'evidence-matrix-mini',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'IFN beta evidence matrix' },
    data: { claimSetId: 'ifnb-mini-claims', rows: session.claims },
  },
  session,
};

export default basicEvidenceMatrixFixture;
