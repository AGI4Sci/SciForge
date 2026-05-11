import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  type ScientificEvidenceRef,
  type ScientificReproductionArtifactType,
} from '../../packages/contracts/runtime/scientific-reproduction.js';
import {
  createScientificReproductionVerifierProvider,
  verifyScientificReproduction,
} from '../../packages/verifiers/scientific-reproduction/index.js';
import { capabilityManifest } from '../../packages/verifiers/scientific-reproduction/manifest.js';

const provider = createScientificReproductionVerifierProvider();
const ref = (value: string, role = 'source'): ScientificEvidenceRef => ({ ref: value, role, summary: `bounded summary for ${value}` });
const artifact = (
  id: string,
  artifactType: ScientificReproductionArtifactType,
  data: Record<string, unknown>,
) => ({
  id,
  type: artifactType,
  data: {
    schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
    artifactType,
    sourceRefs: [ref(`artifact:${id}:source`)],
    ...data,
  },
});

const passingResult = await provider.verify({
  goal: 'Verify a generic scientific reproduction package.',
  artifactRefs: ['artifact:claim-verdict-1', 'artifact:figure-reproduction-1', 'artifact:dataset-inventory-1'],
  traceRefs: ['trace:run-001'],
  artifacts: [
    artifact('claim-verdict-1', 'claim-verdict', {
      claimId: 'claim-a',
      verdict: 'partially-reproduced',
      rationale: 'The tested perturbation changes the measured signal, while a secondary claim remains missing evidence.',
      supportingEvidenceRefs: [ref('artifact:evidence-matrix-1#claim-a'), ref('trace:run-001')],
      missingEvidence: [{
        summary: 'Required raw input is not available from the listed repository.',
        refs: [ref('artifact:dataset-inventory-1#missing-raw')],
      }],
    }),
    artifact('figure-reproduction-1', 'figure-reproduction-report', {
      verdict: 'partially-reproduced',
      figureId: 'figure-1',
      claimIds: ['claim-a'],
      codeRefs: [ref('artifact:notebook-1', 'code')],
      inputRefs: [ref('artifact:dataset-table-1', 'data')],
      outputFigureRefs: [ref('artifact:plot-1', 'figure')],
      parameters: { threshold: 0.05, normalization: 'median-ratio' },
      stdoutRefs: [ref('trace:run-001/stdout', 'stdout')],
      stderrRefs: [ref('trace:run-001/stderr', 'stderr')],
      statisticsRefs: [ref('artifact:stats-1', 'table')],
      evidenceRefs: [ref('artifact:plot-1'), ref('artifact:stats-1')],
    }),
    artifact('dataset-inventory-1', 'dataset-inventory', {
      identifierVerifications: [
        {
          id: 'paper-id',
          kind: 'bibliographic',
          doi: '10.1000/example',
          pmid: '12345678',
          title: 'Reusable paper identity fixture',
          year: 2024,
          journal: 'Example Journal',
          verified: true,
          status: 'verified',
          checkedAt: '2026-05-11',
          evidenceRefs: [ref('artifact:paper-metadata-1')],
        },
        {
          id: 'dataset-id',
          kind: 'accession',
          database: 'GEO',
          accession: 'GSE000000',
          verified: true,
          status: 'verified',
          checkedAt: '2026-05-11',
          evidenceRefs: [ref('artifact:accession-check-1')],
        },
      ],
      datasets: [{
        id: 'dataset-a',
        title: 'Reusable dataset fixture',
        sourceRefs: [ref('artifact:accession-check-1')],
        availability: 'available',
      }],
    }),
  ],
  providerHints: {
    requireAccessionVerification: true,
    requireFigureReproduction: true,
  },
});

assert.equal(passingResult.schemaVersion, 'sciforge.scientific-reproduction-verifier.v1');
assert.equal(passingResult.verdict, 'pass');
assert.equal(passingResult.repairHints.length, 0);
assert.equal(passingResult.diagnostics.claimCount, 1);
assert.equal(passingResult.diagnostics.figureReproductionCount, 1);
assert.equal(passingResult.diagnostics.identifierVerificationCount, 2);
assert.ok(passingResult.evidenceRefs.includes('artifact:notebook-1'));
assert.ok(passingResult.criterionResults.every((criterion) => criterion.passed));

const mapOnlyFigureResult = verifyScientificReproduction(mapOnlyFigureResultRequest());
assert.equal(mapOnlyFigureResult.verdict, 'pass');
assert.equal(mapOnlyFigureResult.diagnostics.figureReproductionCount, 0);
assert.ok(mapOnlyFigureResult.diagnostics.scientificVerdicts.includes('insufficient-evidence'));
assert.ok(mapOnlyFigureResult.criterionResults.find((criterion) => criterion.id === 'figure-reproduction-evidence' && criterion.passed));
assert.ok(mapOnlyFigureResult.criterionResults.find((criterion) => criterion.id === 'scientific-verdict-vocabulary' && criterion.passed));

const requiredFigureResult = verifyScientificReproduction({
  ...mapOnlyFigureResultRequest(),
  providerHints: { requireFigureReproduction: true },
});
assert.equal(requiredFigureResult.verdict, 'fail');
assert.equal(requiredFigureResult.diagnostics.figureReproductionCount, 0);
assert.ok(requiredFigureResult.criterionResults.find((criterion) => criterion.id === 'figure-reproduction-evidence' && !criterion.passed && criterion.message === 'No figure reproduction records were found.'));

const negativeResult = verifyScientificReproduction({
  artifacts: [
    artifact('claim-verdict-negative', 'claim-verdict', {
      claimId: 'claim-a',
      verdict: 'not-reproduced',
      rationale: 'A bounded check produced output opposite to the claim direction.',
      supportingEvidenceRefs: [ref('artifact:negative-report#check-1')],
    }),
    artifact('negative-report', 'negative-result-report', {
      claimIds: ['claim-a'],
      motivation: 'Check whether a reproduced statistic contradicts the claim.',
      checks: [{
        id: 'check-1',
        question: 'Does the reproduced statistic match the claim direction?',
        inputRefs: [ref('artifact:dataset-a', 'data')],
        codeRefs: [ref('file:analysis.py', 'code')],
        statisticsRefs: [ref('artifact:stats-negative', 'table')],
        outputRefs: [ref('artifact:negative-output')],
        result: 'not-reproduced',
        interpretation: 'The statistic does not match the claim direction.',
      }],
      conclusionImpact: 'The claim should be marked not-reproduced for this bounded check.',
    }),
    artifact('dataset-inventory-negative', 'dataset-inventory', {
      identifierVerifications: [{
        id: 'paper-id',
        kind: 'bibliographic',
        doi: '10.1000/example',
        title: 'Reusable paper identity fixture',
        year: 2024,
        journal: 'Example Journal',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:paper-metadata-1')],
      }],
      datasets: [{ id: 'dataset-a', title: 'Reusable dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
    }),
  ],
});
assert.equal(negativeResult.verdict, 'pass');
assert.ok(negativeResult.criterionResults.find((criterion) => criterion.id === 'negative-result-semantics' && criterion.passed));

const blockedReadinessResult = verifyScientificReproduction({
  artifacts: [
    artifact('claim-verdict-readiness', 'claim-verdict', {
      claimId: 'claim-a',
      verdict: 'insufficient-evidence',
      rationale: 'Raw-data execution has not passed readiness gates.',
      supportingEvidenceRefs: [ref('artifact:raw-readiness')],
      missingEvidence: [{ summary: 'Raw FASTQ/BAM execution requires approval and budget.', refs: [ref('artifact:raw-readiness')] }],
    }),
    artifact('raw-readiness', 'raw-data-readiness-dossier', {
      claimIds: ['claim-a'],
      rawExecutionStatus: 'blocked',
      approvalStatus: 'needs-human',
      datasets: [{
        id: 'raw-dataset-a',
        accession: 'GSE000000',
        database: 'GEO',
        sourceRefs: [ref('artifact:accession-check-1')],
        dataLevel: 'raw',
        availability: 'available',
        licenseStatus: 'needs-human',
        estimatedDownloadBytes: 10_000_000_000,
      }],
      computeBudget: {
        maxDownloadBytes: 0,
        maxStorageBytes: 0,
        maxCpuHours: 0,
        maxMemoryGb: 0,
        maxWallHours: 0,
        budgetRef: ref('artifact:budget-policy'),
      },
      environment: {
        toolVersionRefs: [ref('artifact:tool-lock')],
        environmentLockRefs: [ref('artifact:environment-lock')],
        genomeCacheRefs: [ref('artifact:genome-cache')],
      },
      readinessChecks: [{
        id: 'approval',
        status: 'needs-human',
        reason: 'A human must approve raw-data download and compute.',
        evidenceRefs: [ref('artifact:budget-policy')],
      }],
      degradationStrategy: 'Use processed tables or emit insufficient-evidence until the raw-data gates pass.',
      rawExecutionGate: {
        allowed: false,
        reason: 'Approval and budget are missing.',
        requiredBeforeExecution: ['approval', 'budget'],
        refs: [ref('artifact:budget-policy')],
      },
    }),
    artifact('dataset-inventory-readiness', 'dataset-inventory', {
      identifierVerifications: [{
        id: 'paper-id',
        kind: 'bibliographic',
        doi: '10.1000/example',
        title: 'Reusable paper identity fixture',
        year: 2024,
        journal: 'Example Journal',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:paper-metadata-1')],
      }],
      datasets: [{ id: 'dataset-a', title: 'Dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
    }),
  ],
  providerHints: { requireRawDataReadiness: true },
});
assert.equal(blockedReadinessResult.verdict, 'pass');
assert.equal(blockedReadinessResult.diagnostics.rawDataReadinessCount, 1);
assert.ok(blockedReadinessResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && criterion.passed));

const unsafeRawExecutionResult = verifyScientificReproduction({
  artifacts: [
    artifact('claim-verdict-unsafe-readiness', 'claim-verdict', {
      claimId: 'claim-a',
      verdict: 'insufficient-evidence',
      rationale: 'The raw-data gate incorrectly allowed execution before checks passed.',
      supportingEvidenceRefs: [ref('artifact:unsafe-readiness')],
    }),
    artifact('unsafe-readiness', 'raw-data-readiness-dossier', {
      claimIds: ['claim-a'],
      rawExecutionStatus: 'blocked',
      approvalStatus: 'needs-human',
      datasets: [{
        id: 'raw-dataset-a',
        accession: 'GSE000000',
        database: 'GEO',
        sourceRefs: [ref('artifact:accession-check-1')],
        dataLevel: 'raw',
        availability: 'available',
        licenseStatus: 'needs-human',
        estimatedDownloadBytes: 10_000_000_000,
      }],
      computeBudget: {
        maxDownloadBytes: 0,
        maxStorageBytes: 0,
        maxCpuHours: 0,
        maxMemoryGb: 0,
        maxWallHours: 0,
        budgetRef: ref('artifact:budget-policy'),
      },
      environment: {
        toolVersionRefs: [ref('artifact:tool-lock')],
        environmentLockRefs: [ref('artifact:environment-lock')],
        genomeCacheRefs: [ref('artifact:genome-cache')],
      },
      readinessChecks: [{
        id: 'approval',
        status: 'needs-human',
        reason: 'A human must approve raw-data download and compute.',
        evidenceRefs: [ref('artifact:budget-policy')],
      }],
      degradationStrategy: 'Stop before raw execution.',
      rawExecutionGate: {
        allowed: true,
        reason: 'Unsafe test fixture.',
        requiredBeforeExecution: ['approval', 'budget'],
        refs: [ref('artifact:budget-policy')],
      },
    }),
    artifact('dataset-inventory-unsafe-readiness', 'dataset-inventory', {
      identifierVerifications: [{
        id: 'paper-id',
        kind: 'bibliographic',
        doi: '10.1000/example',
        title: 'Reusable paper identity fixture',
        year: 2024,
        journal: 'Example Journal',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:paper-metadata-1')],
      }],
      datasets: [{ id: 'dataset-a', title: 'Dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
    }),
  ],
  providerHints: { allowRawDataExecution: true, requireRawDataReadiness: true },
});
assert.equal(unsafeRawExecutionResult.verdict, 'fail');
assert.ok(unsafeRawExecutionResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && !criterion.passed));
assert.ok(unsafeRawExecutionResult.repairHints.some((hint) => hint.includes('raw-data-readiness-dossier')));

const readyRawExecutionResult = verifyScientificReproduction(rawDataReadinessRequest());
assert.equal(readyRawExecutionResult.verdict, 'pass');
assert.ok(readyRawExecutionResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && criterion.passed));
assert.ok(readyRawExecutionResult.criterionResults.find((criterion) => criterion.id === 'raw-execution-attestation' && criterion.passed));

const rawSuccessWithoutAttestationResult = verifyScientificReproduction(rawDataReadinessRequest({
  claimVerdict: 'partially-reproduced',
  supportingEvidenceRefs: [ref('artifact:raw-success-output')],
}));
assert.equal(rawSuccessWithoutAttestationResult.verdict, 'fail');
assert.ok(rawSuccessWithoutAttestationResult.criterionResults.find((criterion) => criterion.id === 'raw-execution-attestation' && !criterion.passed));

const executionAttestation = {
  id: 'raw-success-attestation',
  status: 'completed',
  planRefs: [ref('artifact:raw-analysis-plan')],
  executionUnitRefs: [ref('trace:raw-run-001')],
  codeRefs: [ref('file:raw-runner.ts', 'code')],
  stdoutRefs: [ref('trace:raw-run-001/stdout', 'stdout')],
  stderrRefs: [ref('trace:raw-run-001/stderr', 'stderr')],
  outputRefs: [ref('artifact:raw-success-output')],
  observedDownloadBytes: 1_000_000,
  observedStorageBytes: 2_000_000,
  checksumVerificationRefs: [ref('artifact:raw-checksum-verification', 'checksum')],
  environmentVerificationRefs: [ref('artifact:raw-environment-verification', 'environment')],
  budgetDebitRefs: [ref('artifact:raw-budget-debit', 'approval')],
};

const rawSuccessWithAttestationResult = verifyScientificReproduction(rawDataReadinessRequest({
  claimVerdict: 'partially-reproduced',
  supportingEvidenceRefs: [ref('artifact:raw-success-output')],
  dossier: { executionAttestations: [executionAttestation] },
}));
assert.equal(rawSuccessWithAttestationResult.verdict, 'pass');
assert.ok(rawSuccessWithAttestationResult.criterionResults.find((criterion) => criterion.id === 'raw-execution-attestation' && criterion.passed));

const overObservedBudgetAttestationResult = verifyScientificReproduction(rawDataReadinessRequest({
  claimVerdict: 'partially-reproduced',
  supportingEvidenceRefs: [ref('artifact:raw-success-output')],
  dossier: {
    executionAttestations: [{
      ...executionAttestation,
      id: 'raw-over-budget-attestation',
      observedDownloadBytes: 10_000_000,
    }],
  },
}));
assert.equal(overObservedBudgetAttestationResult.verdict, 'fail');
assert.ok(overObservedBudgetAttestationResult.criterionResults.find((criterion) => criterion.id === 'raw-execution-attestation' && !criterion.passed));

const overBudgetRawExecutionResult = verifyScientificReproduction(rawDataReadinessRequest({
  dataset: { estimatedDownloadBytes: 2_000_000 },
  computeBudget: { maxDownloadBytes: 1_000_000 },
}));
assert.equal(overBudgetRawExecutionResult.verdict, 'fail');
assert.ok(overBudgetRawExecutionResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && !criterion.passed));

const missingChecksumRawExecutionResult = verifyScientificReproduction(rawDataReadinessRequest({
  dataset: { checksumRefs: [] },
}));
assert.equal(missingChecksumRawExecutionResult.verdict, 'fail');
assert.ok(missingChecksumRawExecutionResult.criterionResults.find((criterion) => criterion.id === 'raw-data-readiness-gate' && !criterion.passed));

const realFixtureRoot = join(process.cwd(), 'tests/fixtures/scientific-reproduction/real-paper-reproduction');
const realArtifacts = await Promise.all([
  '2020-prdm9-dsb-fate.claim-verdict.json',
  '2020-prdm9-dsb-fate.figure-reproduction-report.json',
  '2025-setd1b-broad-h3k4me3.fig3.figure-reproduction-report.json',
  '2025-setd1b-broad-h3k4me3.fig5.figure-reproduction-report.json',
  '2025-setd1b-broad-h3k4me3.fig7.figure-reproduction-report.json',
].map(async (file) => ({
  id: file.replace(/\.json$/, ''),
  data: JSON.parse(await readFile(join(realFixtureRoot, file), 'utf8')),
})));
const realDatasetInventory = {
  id: 'dataset-inventory-draft',
  data: JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/scientific-reproduction/real-paper-evidence/dataset-inventory-draft.json'), 'utf8')),
};
const realFixtureResult = verifyScientificReproduction({
  goal: 'Verify real data-root scientific reproduction fixtures.',
  artifacts: [...realArtifacts, realDatasetInventory],
  providerHints: {
    requireAccessionVerification: true,
    requireFigureReproduction: true,
  },
});
assert.notEqual(realFixtureResult.diagnostics.figureReproductionCount, 0);
assert.notEqual(realFixtureResult.diagnostics.identifierVerificationCount, 0);
assert.ok(realFixtureResult.criterionResults.find((criterion) => criterion.id === 'scientific-reproduction-contract-compliance' && criterion.passed));

const failingResult = verifyScientificReproduction({
  artifacts: [
    {
      id: 'prose-only-report',
      type: 'claim-verdict',
      data: {
        schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
        artifactType: 'claim-verdict',
        sourceRefs: [ref('artifact:source')],
        claimId: 'claim-without-evidence',
        verdict: 'supported',
        rationale: 'A claim presented without evidence.',
        supportingEvidenceRefs: [],
        claims: [{ id: 'claim-without-evidence', text: 'A claim presented without evidence.' }],
        evidence: {
          sourceText: 'x'.repeat(5000),
        },
      },
    },
    {
      id: 'bad-negative',
      type: 'negative-result-report',
      data: {
        schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
        artifactType: 'negative-result-report',
        sourceRefs: [ref('artifact:source')],
        claimIds: ['claim-without-evidence'],
        motivation: 'Tool timeout is not a scientific negative result.',
        checks: [{
          id: 'bad-check',
          question: 'Did the tool time out?',
          inputRefs: [ref('artifact:dataset')],
          outputRefs: [ref('artifact:timeout-log')],
          result: 'not-reproduced',
          interpretation: 'Tool failed with timeout.',
        }],
        conclusionImpact: 'Operational failure only.',
      },
    },
    artifact('bad-identifier', 'dataset-inventory', {
      identifierVerifications: [{
        id: 'paper-id',
        kind: 'bibliographic',
        title: 'Title only is not a verified paper identity',
        verified: true,
        status: 'verified',
        checkedAt: '2026-05-11',
        evidenceRefs: [ref('artifact:title-only')],
      }],
      datasets: [{ id: 'dataset-a', title: 'Dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
    }),
  ],
}, 'verifier.scientific-reproduction.generic');

assert.equal(failingResult.verdict, 'fail');
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'scientific-reproduction-contract-compliance' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'claim-evidence-coverage' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'scientific-verdict-vocabulary' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'refs-first-evidence' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'negative-result-semantics' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'citation-accession-verification' && !criterion.passed));
assert.ok(failingResult.repairHints.some((hint) => hint.includes('negative-result-report')));

assert.equal(capabilityManifest.id, 'verifier.scientific-reproduction');
assert.equal(capabilityManifest.kind, 'verifier');
assert.ok(capabilityManifest.routingTags.includes('negative-result-report'));
assert.ok(capabilityManifest.providers.some((manifestProvider) => manifestProvider.id === provider.id));

console.log('[ok] scientific reproduction verifier checks generic evidence and negative-result contracts');

function mapOnlyFigureResultRequest() {
  return {
    artifacts: [
      artifact('claim-graph-1', 'paper-claim-graph', {
        paperRefs: [ref('artifact:paper')],
        claims: [
          {
            id: 'claim-a',
            text: 'A mapped claim has source evidence.',
            locatorRefs: [ref('artifact:paper#page-1')],
            evidenceRefs: [ref('artifact:paper#page-1')],
          },
        ],
      }),
      artifact('figure-map-1', 'figure-to-claim-map', {
        figures: [
          {
            id: 'figure-1',
            label: 'Figure 1',
            locatorRefs: [ref('artifact:paper#figure-1')],
            claimIds: ['claim-a'],
          },
        ],
      }),
      artifact('claim-verdict-2', 'claim-verdict', {
        claimId: 'claim-a',
        verdict: 'insufficient-evidence',
        rationale: 'The figure is mapped to a claim, but no reproduction report has been produced yet.',
        supportingEvidenceRefs: [ref('artifact:paper#figure-1')],
        missingEvidence: [{ summary: 'No executable reproduction artifact yet.' }],
      }),
      artifact('identifier-verification-1', 'dataset-inventory', {
        identifierVerifications: [
          {
            id: 'paper-id',
            kind: 'bibliographic',
            doi: '10.1000/example',
            title: 'Reusable paper identity fixture',
            year: 2024,
            journal: 'Example Journal',
            verified: true,
            status: 'verified',
            checkedAt: '2026-05-11',
            evidenceRefs: [ref('artifact:paper-metadata-1')],
          },
        ],
        datasets: [{ id: 'dataset-a', title: 'Dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
      }),
    ],
  };
}

function rawDataReadinessRequest(overrides: {
  dataset?: Record<string, unknown>;
  computeBudget?: Record<string, unknown>;
  dossier?: Record<string, unknown>;
  claimVerdict?: string;
  supportingEvidenceRefs?: ScientificEvidenceRef[];
} = {}) {
  const dataset = {
    id: 'raw-dataset-a',
    accession: 'GSE000000',
    database: 'GEO',
    sourceRefs: [ref('artifact:accession-check-1')],
    dataLevel: 'raw',
    availability: 'available',
    licenseStatus: 'verified',
    estimatedDownloadBytes: 1_000_000,
    estimatedStorageBytes: 2_000_000,
    checksumRefs: [ref('artifact:raw-dataset-a-checksums')],
    ...overrides.dataset,
  };
  const computeBudget = {
    maxDownloadBytes: 5_000_000,
    maxStorageBytes: 10_000_000,
    maxCpuHours: 4,
    maxMemoryGb: 16,
    maxWallHours: 2,
    budgetRef: ref('artifact:budget-policy'),
    ...overrides.computeBudget,
  };
  return {
    artifacts: [
      artifact('claim-verdict-ready-readiness', 'claim-verdict', {
        claimId: 'claim-a',
        verdict: overrides.claimVerdict ?? 'insufficient-evidence',
        rationale: 'Raw-data execution is gated by an explicit readiness dossier.',
        supportingEvidenceRefs: overrides.supportingEvidenceRefs ?? [ref('artifact:ready-readiness')],
      }),
      artifact('ready-readiness', 'raw-data-readiness-dossier', {
        claimIds: ['claim-a'],
        rawExecutionStatus: 'ready',
        approvalStatus: 'approved',
        datasets: [dataset],
        computeBudget,
        environment: {
          toolVersionRefs: [ref('artifact:tool-lock')],
          environmentLockRefs: [ref('artifact:environment-lock')],
          genomeCacheRefs: [ref('artifact:genome-cache')],
        },
        readinessChecks: [{
          id: 'approval',
          status: 'pass',
          reason: 'Approval, budget, checksums, and execution environment are ready.',
          evidenceRefs: [ref('artifact:budget-policy')],
        }],
        degradationStrategy: 'Use processed tables if raw execution becomes unavailable.',
        rawExecutionGate: {
          allowed: true,
          reason: 'All raw-data readiness checks passed.',
          requiredBeforeExecution: ['approval', 'budget', 'checksums', 'environment'],
          refs: [ref('artifact:budget-policy')],
        },
        ...overrides.dossier,
      }),
      artifact('dataset-inventory-ready-readiness', 'dataset-inventory', {
        identifierVerifications: [{
          id: 'paper-id',
          kind: 'bibliographic',
          doi: '10.1000/example',
          title: 'Reusable paper identity fixture',
          year: 2024,
          journal: 'Example Journal',
          verified: true,
          status: 'verified',
          checkedAt: '2026-05-11',
          evidenceRefs: [ref('artifact:paper-metadata-1')],
        }],
        datasets: [{ id: 'dataset-a', title: 'Dataset fixture', sourceRefs: [ref('artifact:dataset-a')], availability: 'available' }],
      }),
    ],
    providerHints: { allowRawDataExecution: true, requireRawDataReadiness: true },
  };
}
