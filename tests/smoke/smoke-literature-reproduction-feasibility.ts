import assert from 'node:assert/strict';

import { validateScientificReproductionArtifact } from '@sciforge-ui/runtime-contract';
import {
  deriveLiteratureReproductionFeasibility,
  runOfflineLiteratureRetrieval,
  validateLiteratureReproductionFeasibilityArtifact,
  validateOfflineLiteratureRetrievalOutput,
  type LiteratureReproductionFeasibilityArtifact,
  type OfflineLiteratureRetrievalOutput,
} from '../../packages/skills/literature/index.js';

const retrievalOutput = checkedRetrieval(runOfflineLiteratureRetrieval({
  request: {
    query: 'reproducible paper ranking for offline scientific reproduction',
    databases: ['openalex', 'pubmed', 'arxiv'],
    includeAbstracts: true,
    fullTextPolicy: 'bounded-full-text',
  },
  providerFixtures: [
    {
      providerId: 'openalex',
      records: [{
        providerRecordId: 'openalex-code-data-low',
        title: 'Workflow containers with public benchmark data',
        year: 2026,
        journal: 'SciForge Reproduction Fixtures',
        doi: '10.5555/repro.ready',
        abstract: 'A fixture paper with public code, public benchmark data, and a bounded local workflow.',
        fullTextRef: 'artifact:fulltext:ready-paper',
      }],
    },
    {
      providerId: 'pubmed',
      records: [{
        providerRecordId: 'pmid-dataset-no-code',
        title: 'Public cohort without released analysis scripts',
        year: 2025,
        journal: 'SciForge Reproduction Fixtures',
        doi: '10.5555/repro.partial',
        pmid: '990001',
        abstract: 'A fixture paper with available data but unreleased analysis code.',
      }],
    },
    {
      providerId: 'arxiv',
      records: [{
        providerRecordId: '2605.70001',
        title: 'Large simulation with restricted inputs',
        year: 2026,
        arxivId: '2605.70001',
        abstract: 'A fixture paper that requires expensive simulation and restricted inputs.',
      }],
    },
  ],
}));

const evidenceByStableId = new Map(
  retrievalOutput.paperList.map((paper) => [paper.doi ?? paper.arxivId, paper.id] as const),
);
const readyPaperId = required(evidenceByStableId.get('10.5555/repro.ready'), 'ready paper should be addressable by DOI');
const partialPaperId = required(evidenceByStableId.get('10.5555/repro.partial'), 'partial paper should be addressable by DOI');
const costlyPaperId = required(evidenceByStableId.get('2605.70001'), 'costly paper should be addressable by arXiv id');

const feasibility = deriveLiteratureReproductionFeasibility({
  output: retrievalOutput,
  objective: 'Rank retrieved papers for a bounded first-pass reproduction attempt.',
  maxPlanSteps: 2,
  paperEvidence: [
    {
      paperId: costlyPaperId,
      codeAvailability: 'partial',
      datasetAvailability: 'unavailable',
      computeCost: 'high',
      reproductionRisk: 'high',
      codeRefs: ['artifact:code:simulation-driver'],
      datasetRefs: ['artifact:data-access:restricted-inputs'],
      computeRefs: ['artifact:compute-estimate:gpu-cluster'],
      riskRefs: ['artifact:risk:restricted-inputs', 'artifact:risk:compute-budget'],
      notes: ['Needs restricted inputs and substantial compute before a useful reproduction can start.'],
    },
    {
      paperId: readyPaperId,
      codeAvailability: 'available',
      datasetAvailability: 'available',
      computeCost: 'low',
      reproductionRisk: 'low',
      codeRefs: ['artifact:code:ready-container'],
      datasetRefs: ['artifact:dataset:public-benchmark'],
      computeRefs: ['artifact:compute-estimate:laptop'],
      riskRefs: ['artifact:risk:minor-version-drift'],
      notes: ['Public container and public benchmark make this the lowest-friction first reproduction target.'],
    },
    {
      paperId: partialPaperId,
      codeAvailability: 'unavailable',
      datasetAvailability: 'available',
      computeCost: 'medium',
      reproductionRisk: 'medium',
      datasetRefs: ['artifact:dataset:public-cohort'],
      computeRefs: ['artifact:compute-estimate:standard-workstation'],
      riskRefs: ['artifact:risk:missing-analysis-scripts'],
      notes: ['Data are present, but missing scripts make method reconstruction necessary.'],
    },
  ],
});

assertFeasibilityArtifact(feasibility, retrievalOutput);

const rankedIds = feasibility.rankedPapers.map((paper) => paper.paperId);
assert.deepEqual(rankedIds, [readyPaperId, partialPaperId, costlyPaperId]);
assert.deepEqual(
  feasibility.rankedPapers.map((paper) => paper.rank),
  [1, 2, 3],
);

const ready = required(feasibility.rankedPapers.find((paper) => paper.paperId === readyPaperId), 'ready paper should be ranked');
assert.equal(ready.recommendation, 'ready');
assert.equal(ready.codeAvailability, 'available');
assert.equal(ready.datasetAvailability, 'available');
assert.equal(ready.computeCost, 'low');
assert.equal(ready.reproductionRisk, 'low');
assert.ok(ready.score > required(feasibility.rankedPapers.find((paper) => paper.paperId === partialPaperId), 'partial paper should be ranked').score);
assert.ok(ready.evidenceRefs.includes('artifact:code:ready-container'));
assert.ok(ready.evidenceRefs.includes('artifact:dataset:public-benchmark'));
assert.ok(ready.evidenceRefs.includes('artifact:compute-estimate:laptop'));
assert.ok(ready.evidenceRefs.includes('artifact:risk:minor-version-drift'));
assert.equal(ready.missingEvidence.length, 0);

const partial = required(feasibility.rankedPapers.find((paper) => paper.paperId === partialPaperId), 'partial paper should be ranked');
assert.equal(partial.recommendation, 'needs-data-or-code');
assert.ok(partial.missingEvidence.includes('code availability'));
assert.ok(partial.evidenceRefs.includes('artifact:dataset:public-cohort'));
assert.ok(partial.riskNotes.some((note) => note.risk === 'medium'));

const costly = required(feasibility.rankedPapers.find((paper) => paper.paperId === costlyPaperId), 'costly paper should be ranked');
assert.equal(costly.recommendation, 'high-risk');
assert.ok(costly.score < partial.score);
assert.ok(costly.missingEvidence.includes('dataset availability'));
assert.ok(costly.riskNotes.some((note) => note.summary.includes('restricted inputs')));

assert.equal(feasibility.analysisPlan.artifactType, 'analysis-plan');
assert.equal(feasibility.analysisPlan.objective, 'Rank retrieved papers for a bounded first-pass reproduction attempt.');
assert.deepEqual(feasibility.analysisPlan.claimIds, [readyPaperId, partialPaperId]);
assert.equal(feasibility.analysisPlan.steps.length, 2);
assert.ok(feasibility.analysisPlan.steps.every((step) => step.inputRefs.length > 0));
assert.ok(feasibility.analysisPlan.steps.every((step) => step.expectedArtifacts?.includes('evidence-matrix')));
assert.ok(feasibility.analysisPlan.fallbackPolicy?.some((policy) => /missing|unavailable|high-risk/i.test(policy.condition)));
assert.equal(validateScientificReproductionArtifact(feasibility.analysisPlan).ok, true);
assert.deepEqual(validateLiteratureReproductionFeasibilityArtifact(feasibility), []);

assert.equal(feasibility.metadata.derivation.schemaVersion, 'sciforge.artifact-derivation.v1');
assert.equal(feasibility.metadata.derivation.kind, 'analysis-plan');
assert.equal(feasibility.metadata.role, 'reproduction-feasibility-ranking');
assert.equal(feasibility.metadata.derivation.parentArtifactRef, 'artifact:research-report');
assert.ok(feasibility.metadata.derivation.sourceRefs.includes('artifact:research-report'));
assert.ok(feasibility.metadata.derivation.sourceRefs.some((ref) => ref.startsWith('provider:')));
assert.equal(feasibility.noHardcodeReview.status, 'pass');
assert.equal(feasibility.noHardcodeReview.appliesGenerally, true);
assert.ok(feasibility.noHardcodeReview.forbiddenSpecialCases.some((item) => /title/i.test(item)));
assert.ok(feasibility.noHardcodeReview.forbiddenSpecialCases.some((item) => /array.index/i.test(item)));

const ignoredEvidence = deriveLiteratureReproductionFeasibility({
  output: retrievalOutput,
  paperEvidence: [{
    paperId: 'paper:missing-from-retrieval',
    codeAvailability: 'available',
    datasetAvailability: 'available',
    computeCost: 'low',
    reproductionRisk: 'low',
    codeRefs: ['artifact:code:orphan'],
  }],
});
assert.deepEqual(ignoredEvidence.ignoredEvidencePaperIds, ['paper:missing-from-retrieval']);
assert.equal(ignoredEvidence.rankedPapers.length, retrievalOutput.paperList.length);
assert.equal(ignoredEvidence.rankedPapers.some((paper) => paper.evidenceRefs.includes('artifact:code:orphan')), false);
assert.equal(ignoredEvidence.noHardcodeReview.status, 'pass');
assert.equal(ignoredEvidence.noHardcodeReview.appliesGenerally, true);
assert.deepEqual(validateLiteratureReproductionFeasibilityArtifact(ignoredEvidence), []);

console.log('[ok] literature retrieval output can be ranked into reproduction feasibility with refs-first analysis plan');

function checkedRetrieval(output: OfflineLiteratureRetrievalOutput): OfflineLiteratureRetrievalOutput {
  assert.deepEqual(validateOfflineLiteratureRetrievalOutput(output), []);
  assert.equal(output.paperList.length, 3);
  assert.equal(new Set(output.paperList.map((paper) => paper.id)).size, output.paperList.length);
  return output;
}

function assertFeasibilityArtifact(
  artifact: LiteratureReproductionFeasibilityArtifact,
  retrieval: OfflineLiteratureRetrievalOutput,
): void {
  assert.equal(artifact.artifactType, 'literature-reproduction-feasibility');
  assert.equal(artifact.ref, 'artifact:literature-reproduction-feasibility');
  assert.equal(artifact.parentArtifactRef, 'artifact:research-report');
  assert.deepEqual(artifact.sourceArtifactRefs, ['artifact:paper-list', 'artifact:evidence-matrix', 'artifact:research-report']);
  assert.deepEqual(new Set(artifact.paperIds), new Set(retrieval.paperList.map((paper) => paper.id)));
  assert.equal(artifact.ignoredEvidencePaperIds.length, 0);
  assert.ok(artifact.sourceRefs.includes('artifact:research-report'));
  assert.ok(artifact.sourceRefs.some((ref) => ref.startsWith('provider:')));
  assert.equal(artifact.rankedPapers.length, retrieval.paperList.length);
  assert.ok(artifact.rankedPapers.every((paper) => paper.sourceRefs.length > 0));
  assert.ok(artifact.rankedPapers.every((paper) => paper.evidenceRefs.length > 0));
}

function required<T>(value: T | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}
