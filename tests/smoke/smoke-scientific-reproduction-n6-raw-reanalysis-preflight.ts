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

const preflightArtifacts = [
  artifact('n6-raw-reanalysis-plan', 'analysis-plan', {
    objective: 'Plan raw reanalysis without executing downloads or computation.',
    claimIds: ['claim-n6'],
    steps: [{
      id: 'n6-step-01',
      title: 'Preflight raw accession and budget',
      purpose: 'Check accession, license, download/storage estimates, environment refs, and stop before execution.',
      inputRefs: [ref('artifact:n6-dataset-inventory#GSE000000', 'data')],
      outputRefs: [ref('artifact:n6-readiness-dossier', 'verifier')],
      methodRefs: [ref('artifact:n6-method-lock', 'code')],
      expectedArtifacts: ['raw-data-readiness-dossier', 'claim-verdict'],
    }],
    fallbackPolicy: [{
      condition: 'Raw execution evidence is absent.',
      action: 'Keep claims insufficient-evidence or not-tested; do not infer success from plan/readiness.',
      refs: [ref('artifact:n6-readiness-dossier')],
    }],
  }),
  artifact('n6-readiness-dossier', 'raw-data-readiness-dossier', {
    claimIds: ['claim-n6'],
    rawExecutionStatus: 'blocked',
    approvalStatus: 'needs-human',
    datasets: [{
      id: 'n6-raw-dataset',
      accession: 'GSE000000',
      database: 'GEO',
      sourceRefs: [ref('artifact:n6-accession-check', 'data')],
      dataLevel: 'raw',
      availability: 'available',
      licenseStatus: 'needs-human',
      estimatedDownloadBytes: 25_000_000,
      estimatedStorageBytes: 100_000_000,
      checksumRefs: [ref('artifact:n6-checksum-plan', 'checksum')],
    }],
    computeBudget: {
      maxDownloadBytes: 0,
      maxStorageBytes: 0,
      maxCpuHours: 0,
      maxMemoryGb: 0,
      maxWallHours: 0,
      budgetRef: ref('artifact:n6-budget-policy', 'approval'),
    },
    environment: {
      toolVersionRefs: [ref('artifact:n6-tool-lock', 'code')],
      environmentLockRefs: [ref('artifact:n6-env-lock', 'environment')],
      genomeCacheRefs: [ref('artifact:n6-genome-cache-plan', 'genome')],
    },
    readinessChecks: [{
      id: 'budget-approval',
      status: 'needs-human',
      reason: 'No raw execution approval or positive compute budget is attached.',
      evidenceRefs: [ref('artifact:n6-budget-policy', 'approval')],
    }],
    degradationStrategy: 'Emit preflight-only insufficient-evidence until execution is approved and materialized.',
    rawExecutionGate: {
      allowed: false,
      reason: 'Raw reanalysis is blocked before approval and positive budget.',
      requiredBeforeExecution: ['approval', 'download-budget', 'storage-budget', 'environment', 'checksum'],
      refs: [ref('artifact:n6-budget-policy', 'approval')],
    },
    n6Escalation: {
      requestedFileClasses: ['FASTQ', 'BAM', 'CRAM'],
      reanalysisIntent: 'figure-reproduction',
      minimalRunnablePlanRefs: [ref('artifact:n6-raw-reanalysis-plan')],
      downsampleOrRegionFixtureRefs: [ref('fixture:n6-region-slice-plan')],
      stopBeforeExecutionUnlessReady: true,
    },
  }),
  artifact('n6-dataset-inventory', 'dataset-inventory', {
    identifierVerifications: [
      {
        id: 'paper-id',
        kind: 'bibliographic',
        doi: '10.1000/n6',
        title: 'N6 generic raw reanalysis fixture',
        year: 2026,
        journal: 'SciForge Fixtures',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:n6-paper-metadata')],
      },
      {
        id: 'accession-id',
        kind: 'accession',
        database: 'GEO',
        accession: 'GSE000000',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:n6-accession-check')],
      },
    ],
    datasets: [{
      id: 'n6-raw-dataset',
      title: 'N6 raw dataset candidate',
      sourceRefs: [ref('artifact:n6-accession-check')],
      availability: 'available',
    }],
  }),
  artifact('n6-claim-verdict', 'claim-verdict', {
    claimId: 'claim-n6',
    verdict: 'insufficient-evidence',
    rationale: 'This package contains only refs-first raw reanalysis plan/preflight artifacts; no execution evidence exists.',
    supportingEvidenceRefs: [ref('artifact:n6-raw-reanalysis-plan'), ref('artifact:n6-readiness-dossier')],
    missingEvidence: [{
      summary: 'No executed code, stdout/stderr, statistics, or output figure refs are present.',
      refs: [ref('artifact:n6-readiness-dossier')],
    }],
  }),
];

for (const entry of preflightArtifacts) {
  assert.equal(validateScientificReproductionArtifact(entry.data).ok, true, `${entry.id} validates`);
  assert.equal(validateScientificReproductionRefsFirst(entry.data).ok, true, `${entry.id} is refs-first`);
}

const preflightResult = verifyScientificReproduction({
  goal: 'Verify N6 generic raw reanalysis preflight.',
  artifacts: preflightArtifacts,
  providerHints: {
    requireAccessionVerification: true,
    requireRawDataReadiness: true,
    allowRawDataExecution: false,
  },
});

assert.equal(preflightResult.verdict, 'pass');
assert.ok(preflightResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && criterion.passed));
assert.ok(preflightResult.diagnostics.scientificVerdicts.every((verdict) => ['insufficient-evidence', 'not-tested'].includes(verdict)));

const prematureSuccess = verifyScientificReproduction({
  goal: 'Reject N6 success without execution evidence.',
  artifacts: [
    ...preflightArtifacts.filter((entry) => entry.id !== 'n6-claim-verdict'),
    artifact('n6-premature-success', 'claim-verdict', {
      claimId: 'claim-n6',
      verdict: 'reproduced',
      rationale: 'Incorrectly claims raw reanalysis success from preflight only.',
      supportingEvidenceRefs: [ref('artifact:n6-raw-reanalysis-plan'), ref('artifact:n6-readiness-dossier')],
    }),
  ],
  providerHints: {
    requireAccessionVerification: true,
    requireFigureReproduction: true,
    requireRawDataReadiness: true,
    allowRawDataExecution: false,
  },
});

assert.equal(prematureSuccess.verdict, 'fail');
assert.ok(prematureSuccess.criterionResults.find((criterion) => criterion.id === 'figure-reproduction-evidence' && !criterion.passed));
assert.ok(!prematureSuccess.evidenceRefs.some((entry) => /stdout|stderr|stats|figure-output|trace:run/.test(entry)));

console.log('[ok] N6 raw reanalysis preflight is refs-first and budget-gated, but cannot claim scientific success without execution evidence');
