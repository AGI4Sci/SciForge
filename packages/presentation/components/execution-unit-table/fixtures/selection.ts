import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const selectedUnit = {
  id: 'eu-deseq2-002',
  tool: 'deseq2-differential-expression',
  params: '{"design":"~ condition","contrast":["condition","IFNB_6h","control_0h"]}',
  status: 'record-only',
  hash: 'sha256:0b2c7c1d9a8e-mini',
  language: 'r',
  codeRef: 'workspace://analysis/deseq2_ifnb.R',
  stdoutRef: 'workspace://runs/eu-deseq2-002/stdout.txt',
  outputRef: 'workspace://artifacts/de-table-mini.json',
  environment: 'R=4.3; DESeq2=1.42',
  dataFingerprint: 'md5:ifnb-mini-count-matrix',
  time: '2026-05-03T00:03:00.000Z',
};

export const selectionExecutionUnitTableFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'execution-unit-table',
    title: 'Selected execution references',
    props: {
      selectedExecutionUnitId: selectedUnit.id,
      selectionEvent: { type: 'open-code-ref', executionUnitId: selectedUnit.id, ref: selectedUnit.codeRef },
    },
  },
  artifact: {
    id: 'workflow-provenance-selection',
    type: 'workflow-provenance',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    metadata: { title: 'Selected DESeq2 execution unit' },
    data: { executionUnits: [selectedUnit] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-execution-selection',
    scenarioId: 'omics-differential-expression',
    title: 'Execution selection fixture',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:03:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [selectedUnit],
    artifacts: [],
    notebook: [],
    versions: [],
  },
};

export default selectionExecutionUnitTableFixture;
