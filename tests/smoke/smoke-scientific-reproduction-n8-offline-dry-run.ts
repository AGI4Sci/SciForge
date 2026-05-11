import assert from 'node:assert/strict';

import {
  SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
} from '@sciforge-ui/runtime-contract';
import { verifyScientificReproduction } from '../../packages/verifiers/scientific-reproduction/index.js';

const ref = (value: string, role = 'source') => ({ ref: value, role, summary: `bounded summary for ${value}` });
const artifact = (id: string, artifactType: string, data: Record<string, unknown>) => ({
  id,
  type: artifactType,
  data: {
    schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
    artifactType,
    sourceRefs: [ref(`artifact:${id}:source`)],
    ...data,
  },
});

const readinessDossier = artifact('n8-readiness-dossier', 'raw-data-readiness-dossier', {
  claimIds: ['claim-n8'],
  rawExecutionStatus: 'blocked',
  approvalStatus: 'needs-human',
  datasets: [{
    id: 'n8-raw-dataset',
    accession: 'GSE000000',
    database: 'GEO',
    sourceRefs: [ref('artifact:n8-accession-check', 'data')],
    dataLevel: 'raw',
    availability: 'available',
    licenseStatus: 'needs-human',
    estimatedDownloadBytes: 50_000_000,
    estimatedStorageBytes: 200_000_000,
    checksumRefs: [ref('artifact:n8-checksum-plan', 'checksum')],
  }],
  computeBudget: {
    maxDownloadBytes: 0,
    maxStorageBytes: 0,
    maxCpuHours: 0,
    maxMemoryGb: 0,
    maxWallHours: 0,
    budgetRef: ref('artifact:n8-budget-policy', 'approval'),
  },
  environment: {
    toolVersionRefs: [ref('artifact:n8-tool-lock', 'code')],
    environmentLockRefs: [ref('artifact:n8-env-lock', 'environment')],
    genomeCacheRefs: [ref('artifact:n8-genome-cache-plan', 'genome')],
  },
  readinessChecks: [{
    id: 'offline-dry-run-only',
    status: 'needs-human',
    reason: 'Live raw execution remains blocked; only tiny fixture command wiring is exercised.',
    evidenceRefs: [ref('artifact:n8-budget-policy', 'approval')],
  }],
  degradationStrategy: 'Keep scientific claims insufficient-evidence until live raw execution is approved and attested.',
  rawExecutionGate: {
    allowed: false,
    reason: 'Offline dry-run is not approval for live raw-data download or compute.',
    requiredBeforeExecution: ['approval', 'download-budget', 'storage-budget', 'environment', 'checksum', 'execution-attestation'],
    refs: [ref('artifact:n8-budget-policy', 'approval')],
  },
  n6Escalation: {
    requestedFileClasses: ['FASTQ', 'BAM', 'CRAM'],
    reanalysisIntent: 'figure-reproduction',
    minimalRunnablePlanRefs: [ref('artifact:n8-command-plan')],
    downsampleOrRegionFixtureRefs: [ref('fixture:n8-tiny-fastq'), ref('fixture:n8-region-bam')],
    stopBeforeExecutionUnlessReady: true,
  },
  n8ExecutionReadiness: {
    readinessMode: 'offline-fixture-dry-run',
    scope: ['command-wiring', 'schema-validation', 'environment-probe', 'output-contract-check'],
    networkPolicy: 'disabled',
    downloadedBytes: 0,
    fixtureExecutionGate: {
      allowed: true,
      reason: 'Tiny fixture dry-run may run without live raw-data transfer.',
      requiredBeforeExecution: ['fixture-inputs', 'command-plan', 'environment-probe', 'output-contracts'],
      refs: [ref('artifact:n8-fixture-approval', 'approval')],
    },
    fixtureInputRefs: [ref('fixture:n8-tiny-fastq', 'data'), ref('fixture:n8-region-bam', 'data')],
    commandPlanRefs: [ref('artifact:n8-command-plan', 'code')],
    environmentProbeRefs: [ref('artifact:n8-env-probe', 'environment')],
    expectedOutputContracts: [{
      artifactType: 'analysis-notebook',
      requiredRefFields: ['notebookRefs', 'outputRefs'],
      requiredScalarFields: ['status'],
    }],
    dryRunEvidenceRefs: {
      codeRefs: [ref('file:dry-run-command-plan.sh', 'code')],
      stdoutRefs: [ref('trace:n8-dry-run/stdout', 'stdout')],
      stderrRefs: [ref('trace:n8-dry-run/stderr', 'stderr')],
      outputRefs: [ref('artifact:n8-dry-run-output')],
      statisticsRefs: [ref('artifact:n8-dry-run-contract-checks', 'table')],
    },
    promotionBlockedUntil: ['live-download-approval', 'positive-budget', 'approved-scope-binding', 'completed-execution-attestation'],
    stopBeforeLiveDownload: true,
  },
});

const dryRunArtifacts = [
  readinessDossier,
  artifact('n8-analysis-notebook', 'analysis-notebook', {
    notebookRefs: [ref('artifact:n8-dry-run-notebook', 'code')],
    environmentRefs: [ref('artifact:n8-env-probe', 'environment')],
    cells: [{
      id: 'dry-run-cell-1',
      purpose: 'Exercise command wiring and output schema on tiny offline fixtures.',
      codeRef: ref('file:dry-run-command-plan.sh', 'code'),
      outputRefs: [ref('artifact:n8-dry-run-output')],
      status: 'success',
      diagnostics: ['network disabled', 'downloadedBytes=0', 'output contracts satisfied'],
    }],
  }),
  artifact('n8-dataset-inventory', 'dataset-inventory', {
    identifierVerifications: [
      {
        id: 'paper-id',
        kind: 'bibliographic',
        doi: '10.1000/n8',
        title: 'N8 generic offline dry-run fixture',
        year: 2026,
        journal: 'SciForge Fixtures',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:n8-paper-metadata')],
      },
      {
        id: 'accession-id',
        kind: 'accession',
        database: 'GEO',
        accession: 'GSE000000',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:n8-accession-check')],
      },
    ],
    datasets: [{
      id: 'n8-raw-dataset',
      title: 'N8 raw dataset candidate',
      sourceRefs: [ref('artifact:n8-accession-check')],
      availability: 'available',
    }],
  }),
  artifact('n8-claim-verdict', 'claim-verdict', {
    claimId: 'claim-n8',
    verdict: 'insufficient-evidence',
    rationale: 'Offline dry-run proves command wiring and output contracts only, not live raw-data scientific reproduction.',
    supportingEvidenceRefs: [ref('artifact:n8-command-plan'), ref('artifact:n8-dry-run-output')],
    missingEvidence: [{
      summary: 'No live raw-data download, alignment, peak calling, statistics, or completed execution attestation exists.',
      refs: [ref('artifact:n8-readiness-dossier')],
    }],
  }),
];

for (const entry of dryRunArtifacts) {
  assert.equal(validateScientificReproductionArtifact(entry.data).ok, true, `${entry.id} validates`);
  assert.equal(validateScientificReproductionRefsFirst(entry.data).ok, true, `${entry.id} is refs-first`);
}

const dryRunResult = verifyScientificReproduction({
  goal: 'Verify N8 offline fixture dry-run readiness.',
  artifacts: dryRunArtifacts,
  providerHints: {
    requireAccessionVerification: true,
    requireRawDataReadiness: true,
    allowRawDataExecution: false,
  },
});

assert.equal(dryRunResult.verdict, 'pass');
assert.ok(dryRunResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && criterion.passed));
assert.ok(dryRunResult.criterionResults.find((criterion) => criterion.id === 'offline-dry-run-boundary' && criterion.passed));
assert.ok(dryRunResult.diagnostics.scientificVerdicts.every((verdict) => ['insufficient-evidence', 'not-tested'].includes(verdict)));
assert.ok(!dryRunResult.evidenceRefs.some((entry) => /^https?:\/\//.test(entry)));

const prematureSuccess = verifyScientificReproduction({
  goal: 'Reject N8 dry-run as scientific success.',
  artifacts: [
    ...dryRunArtifacts.filter((entry) => entry.id !== 'n8-claim-verdict'),
    artifact('n8-premature-success', 'claim-verdict', {
      claimId: 'claim-n8',
      verdict: 'partially-reproduced',
      rationale: 'Incorrectly claims scientific success from offline dry-run readiness.',
      supportingEvidenceRefs: [ref('artifact:n8-dry-run-output')],
    }),
  ],
  providerHints: {
    requireAccessionVerification: true,
    requireRawDataReadiness: true,
    allowRawDataExecution: false,
  },
});

assert.equal(prematureSuccess.verdict, 'fail');
assert.ok(prematureSuccess.criterionResults.find((criterion) => criterion.id === 'offline-dry-run-boundary' && !criterion.passed));

console.log('[ok] N8 offline fixture dry-run proves execution readiness only and cannot promote scientific success verdicts');
