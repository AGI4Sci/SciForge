import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const executionUnits = [
  {
    id: 'eu-rnaseq-qc-001',
    tool: 'fastqc-summary',
    params: '{"samples":["IFNB_0h_rep1","IFNB_6h_rep1"],"adapterCheck":true}',
    status: 'done',
    hash: 'sha256:4d9a0f4b8f7a-mini',
    language: 'python',
    codeRef: 'workspace://analysis/rnaseq_qc.py',
    stdoutRef: 'workspace://runs/eu-rnaseq-qc-001/stdout.txt',
    outputRef: 'workspace://artifacts/qc-summary-mini.json',
    environment: 'python=3.11; fastqc=0.12',
    dataFingerprint: 'md5:ifnb-mini-fastq-manifest',
    databaseVersions: ['GRCh38.p14 annotation release 44'],
    time: '2026-05-03T00:00:00.000Z',
  },
  {
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
  },
];

export const basicExecutionUnitTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'execution-unit-table', title: 'RNA-seq execution provenance' },
  artifact: {
    id: 'workflow-provenance-mini',
    type: 'workflow-provenance',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    metadata: { title: 'Mini IFN beta workflow provenance' },
    data: { executionUnits },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-execution-basic',
    scenarioId: 'omics-differential-expression',
    title: 'Execution unit fixture',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:03:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits,
    artifacts: [],
    notebook: [],
    versions: [],
  },
};

export default basicExecutionUnitTableFixture;
