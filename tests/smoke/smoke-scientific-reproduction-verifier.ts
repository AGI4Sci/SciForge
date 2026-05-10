import assert from 'node:assert/strict';

import {
  createScientificReproductionVerifierProvider,
  verifyScientificReproduction,
} from '../../packages/verifiers/scientific-reproduction/index.js';
import { capabilityManifest } from '../../packages/verifiers/scientific-reproduction/manifest.js';

const provider = createScientificReproductionVerifierProvider();

const passingResult = await provider.verify({
  goal: 'Verify a generic scientific reproduction package.',
  artifactRefs: ['artifact:claim-verdict-1', 'artifact:figure-reproduction-1', 'artifact:dataset-inventory-1'],
  traceRefs: ['trace:run-001'],
  artifacts: [
    {
      id: 'claim-verdict-1',
      type: 'claim-verdict',
      data: {
        verdict: 'partially-reproduced',
        claims: [
          {
            id: 'claim-a',
            text: 'The tested perturbation changes the measured signal.',
            evidenceRefs: ['artifact:evidence-matrix-1#claim-a', 'trace:run-001'],
          },
          {
            id: 'claim-b',
            text: 'A secondary claim could not be checked from public data.',
            missingEvidence: {
              reason: 'Required raw input is not available from the listed repository.',
              sourceRef: 'artifact:dataset-inventory-1#missing-raw',
            },
          },
        ],
      },
    },
    {
      id: 'figure-reproduction-1',
      type: 'figure-reproduction-report',
      data: {
        verdict: 'partially-reproduced',
        figureId: 'figure-1',
        claimIds: ['claim-a'],
        codeRefs: ['artifact:notebook-1'],
        inputRefs: ['artifact:dataset-table-1'],
        outputFigureRefs: ['artifact:plot-1'],
        parameters: { threshold: 0.05, normalization: 'median-ratio' },
        stdoutRefs: ['trace:run-001/stdout'],
        stderrRefs: ['trace:run-001/stderr'],
        statisticsRefs: ['artifact:stats-1'],
        evidenceRefs: ['artifact:plot-1', 'artifact:stats-1'],
      },
    },
    {
      id: 'dataset-inventory-1',
      type: 'dataset-inventory',
      data: {
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
            evidenceRefs: ['artifact:paper-metadata-1'],
          },
          {
            id: 'dataset-id',
            kind: 'accession',
            accession: 'GSE000000',
            verified: true,
            evidenceRefs: ['artifact:accession-check-1'],
          },
        ],
      },
    },
  ],
  providerHints: {
    requireAccessionVerification: true,
    requireFigureReproduction: true,
  },
});

assert.equal(passingResult.schemaVersion, 'sciforge.scientific-reproduction-verifier.v1');
assert.equal(passingResult.verdict, 'pass');
assert.equal(passingResult.repairHints.length, 0);
assert.equal(passingResult.diagnostics.claimCount, 2);
assert.equal(passingResult.diagnostics.figureReproductionCount, 1);
assert.equal(passingResult.diagnostics.identifierVerificationCount, 2);
assert.ok(passingResult.evidenceRefs.includes('artifact:notebook-1'));
assert.ok(passingResult.criterionResults.every((criterion) => criterion.passed));

const mapOnlyFigureResult = verifyScientificReproduction({
  artifacts: [
    {
      id: 'claim-graph-1',
      type: 'paper-claim-graph',
      data: {
        claims: [
          {
            id: 'claim-a',
            text: 'A mapped claim has source evidence.',
            locatorRefs: ['artifact:paper#page-1'],
            evidenceRefs: ['artifact:paper#page-1'],
          },
        ],
      },
    },
    {
      id: 'figure-map-1',
      type: 'figure-to-claim-map',
      data: {
        figures: [
          {
            id: 'figure-1',
            label: 'Figure 1',
            locatorRefs: ['artifact:paper#figure-1'],
            claimIds: ['claim-a'],
          },
        ],
      },
    },
    {
      id: 'claim-verdict-2',
      type: 'claim-verdict',
      data: {
        claimId: 'claim-a',
        verdict: 'insufficient-evidence',
        rationale: 'The figure is mapped to a claim, but no reproduction report has been produced yet.',
        supportingEvidenceRefs: ['artifact:paper#figure-1'],
        missingEvidence: [{ reason: 'No executable reproduction artifact yet.' }],
      },
    },
    {
      id: 'identifier-verification-1',
      type: 'dataset-inventory',
      data: {
        identifierVerifications: [
          {
            id: 'paper-id',
            kind: 'bibliographic',
            doi: '10.1000/example',
            title: 'Reusable paper identity fixture',
            year: 2024,
            journal: 'Example Journal',
            verified: true,
            evidenceRefs: ['artifact:paper-metadata-1'],
          },
        ],
      },
    },
  ],
});
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

const failingResult = verifyScientificReproduction({
  artifacts: [
    {
      id: 'prose-only-report',
      type: 'claim-verdict',
      data: {
        verdict: 'supported',
        claims: [{ id: 'claim-without-evidence', text: 'A claim presented without evidence.' }],
        evidence: {
          sourceText: 'x'.repeat(900),
        },
      },
    },
    {
      id: 'bad-negative',
      type: 'negative-result-report',
      data: {
        verdict: 'not-reproduced',
        message: 'Tool failed with timeout.',
      },
    },
  ],
}, 'verifier.scientific-reproduction.generic');

assert.equal(failingResult.verdict, 'fail');
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'claim-evidence-coverage' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'scientific-verdict-vocabulary' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'refs-first-evidence' && !criterion.passed));
assert.ok(failingResult.criterionResults.find((criterion) => criterion.id === 'negative-result-semantics' && !criterion.passed));
assert.ok(failingResult.repairHints.some((hint) => hint.includes('negative-result-report')));

assert.equal(capabilityManifest.id, 'verifier.scientific-reproduction');
assert.equal(capabilityManifest.kind, 'verifier');
assert.ok(capabilityManifest.routingTags.includes('negative-result-report'));
assert.ok(capabilityManifest.providers.some((manifestProvider) => manifestProvider.id === provider.id));

console.log('[ok] scientific reproduction verifier checks generic evidence and negative-result contracts');

function mapOnlyFigureResultRequest() {
  return {
    artifacts: [
      {
        id: 'claim-graph-1',
        type: 'paper-claim-graph',
        data: {
          claims: [
            {
              id: 'claim-a',
              text: 'A mapped claim has source evidence.',
              locatorRefs: ['artifact:paper#page-1'],
              evidenceRefs: ['artifact:paper#page-1'],
            },
          ],
        },
      },
      {
        id: 'figure-map-1',
        type: 'figure-to-claim-map',
        data: {
          figures: [
            {
              id: 'figure-1',
              label: 'Figure 1',
              locatorRefs: ['artifact:paper#figure-1'],
              claimIds: ['claim-a'],
            },
          ],
        },
      },
      {
        id: 'claim-verdict-2',
        type: 'claim-verdict',
        data: {
          claimId: 'claim-a',
          verdict: 'insufficient-evidence',
          rationale: 'The figure is mapped to a claim, but no reproduction report has been produced yet.',
          supportingEvidenceRefs: ['artifact:paper#figure-1'],
          missingEvidence: [{ reason: 'No executable reproduction artifact yet.' }],
        },
      },
      {
        id: 'identifier-verification-1',
        type: 'dataset-inventory',
        data: {
          identifierVerifications: [
            {
              id: 'paper-id',
              kind: 'bibliographic',
              doi: '10.1000/example',
              title: 'Reusable paper identity fixture',
              year: 2024,
              journal: 'Example Journal',
              verified: true,
              evidenceRefs: ['artifact:paper-metadata-1'],
            },
          ],
        },
      },
    ],
  };
}
