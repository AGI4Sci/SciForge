import assert from 'node:assert/strict';

import {
  SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES,
  SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  isScientificReproductionArtifact,
  scientificReproductionArtifactSchemas,
  validateScientificReproductionArtifact,
  validateScientificReproductionRefsFirst,
  type ScientificEvidenceRef,
  type ScientificReproductionArtifactData,
  type ScientificReproductionArtifactType,
} from '@sciforge-ui/runtime-contract';
import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract';

const src = (ref: string, role = 'source'): ScientificEvidenceRef => ({ ref, role, summary: `bounded summary for ${ref}` });

const base = (artifactType: ScientificReproductionArtifactType, extra: Record<string, unknown>): ScientificReproductionArtifactData => ({
  schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  artifactType,
  sourceRefs: [src(`artifact:${artifactType}:source`)],
  ...extra,
} as ScientificReproductionArtifactData);

const fixtures: ScientificReproductionArtifactData[] = [
  base('paper-claim-graph', {
    paperRefs: [src('file:paper.pdf#page=3')],
    claims: [{
      id: 'claim-1',
      text: 'A testable claim with explicit source locators.',
      kind: 'main',
      figureIds: ['figure-1'],
      locatorRefs: [src('file:paper.pdf#page=3&section=results')],
      risks: [{ risk: 'data-missing', summary: 'Original data may be unavailable.', refs: [src('file:paper.pdf#data-availability')] }],
    }],
    edges: [],
  }),
  base('figure-to-claim-map', {
    figures: [{
      id: 'figure-1',
      label: 'Figure 1',
      locatorRefs: [src('file:paper.pdf#figure=1')],
      claimIds: ['claim-1'],
      requiredDatasetIds: ['dataset-1'],
      requiredAnalysisStepIds: ['step-1'],
    }],
  }),
  base('dataset-inventory', {
    datasets: [{
      id: 'dataset-1',
      title: 'Primary dataset described by the source paper',
      sourceRefs: [src('file:paper.pdf#methods=data')],
      availability: 'available',
      dataTypes: ['table'],
      samples: [{ id: 'sample-1', refs: [src('artifact:sample-metadata')] }],
    }],
    missingDatasets: [{
      id: 'dataset-missing-1',
      title: 'Unavailable supporting dataset',
      reason: 'The source did not publish durable access details.',
      sourceRefs: [src('file:paper.pdf#supplement')],
    }],
  }),
  base('analysis-plan', {
    objective: 'Reproduce the claim using available referenced data.',
    claimIds: ['claim-1'],
    steps: [{
      id: 'step-1',
      title: 'Load referenced inputs',
      purpose: 'Materialize bounded data summaries and durable refs.',
      inputRefs: [src('artifact:dataset-inventory')],
      methodRefs: [src('artifact:analysis-method')],
      expectedArtifacts: ['analysis-notebook', 'evidence-matrix'],
    }],
    fallbackPolicy: [{ condition: 'input unavailable', action: 'emit negative-result-report', refs: [src('artifact:dataset-inventory')] }],
  }),
  base('analysis-notebook', {
    notebookRefs: [src('file:notebook.ipynb')],
    environmentRefs: [src('artifact:environment-lock')],
    cells: [{
      id: 'cell-1',
      purpose: 'Run a referenced analysis step.',
      codeRef: src('file:notebook.ipynb#cell=1', 'code'),
      outputRefs: [src('artifact:notebook-output-cell-1')],
      status: 'success',
    }],
  }),
  base('figure-reproduction-report', {
    figureId: 'figure-1',
    claimIds: ['claim-1'],
    inputRefs: [src('artifact:dataset-1')],
    codeRefs: [src('file:notebook.ipynb#cell=1', 'code')],
    outputFigureRefs: [src('artifact:reproduced-figure-1', 'figure')],
    statisticsRefs: [src('artifact:stats-1')],
    stdoutRefs: [src('artifact:stdout-1', 'stdout')],
    stderrRefs: [src('artifact:stderr-1', 'stderr')],
    verdict: 'partially-reproduced',
    limitations: ['A bounded fixture stands in for live data.'],
  }),
  base('evidence-matrix', {
    rows: [{
      id: 'row-1',
      claimId: 'claim-1',
      evidenceRefs: [src('artifact:reproduced-figure-1')],
      methodRefs: [src('file:notebook.ipynb#cell=1')],
      dataRefs: [src('artifact:dataset-1')],
      codeRefs: [src('file:notebook.ipynb#cell=1')],
      verifierRefs: [src('artifact:verification-result-1')],
      verdict: 'partially-reproduced',
      rationale: 'The fixture verifies traceable evidence shape without asserting a real scientific result.',
    }],
  }),
  base('claim-verdict', {
    claimId: 'claim-1',
    verdict: 'partially-reproduced',
    rationale: 'Available evidence supports part of the claim and records missing evidence explicitly.',
    supportingEvidenceRefs: [src('artifact:evidence-matrix#row-1')],
    contradictingEvidenceRefs: [],
    missingEvidence: [{ summary: 'Independent validation data unavailable.', refs: [src('artifact:dataset-inventory#missing')] }],
  }),
  base('negative-result-report', {
    claimIds: ['claim-1'],
    motivation: 'Check whether available evidence contradicts or fails to support the claim.',
    checks: [{
      id: 'check-1',
      question: 'Does the reproduced output match the claim direction?',
      inputRefs: [src('artifact:dataset-1')],
      codeRefs: [src('file:notebook.ipynb#cell=2')],
      outputRefs: [src('artifact:negative-check-output')],
      result: 'not-reproduced',
      interpretation: 'The available fixture output does not reproduce the full claim.',
    }],
    conclusionImpact: 'The claim should be marked partial or not reproduced until stronger evidence is available.',
  }),
  base('trajectory-training-record', {
    attemptRef: src('run:attempt-1', 'trace'),
    events: [{
      id: 'event-1',
      phase: 'planning',
      action: 'select referenced artifacts for reproduction',
      observationRefs: [src('artifact:paper-claim-graph')],
      promptRef: src('message:turn-1'),
      toolCallRefs: [src('artifact:tool-call-1')],
      artifactRefs: [src('artifact:analysis-plan')],
      decisionRationale: 'Plan from refs before reading large source objects into context.',
      outcome: 'success',
    }],
    repairHistoryRefs: [src('artifact:repair-ledger')],
    finalArtifactRefs: [src('artifact:claim-verdict')],
  }),
];

assert.deepEqual(
  SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES,
  fixtures.map((fixture) => fixture.artifactType),
);

for (const fixture of fixtures) {
  const validation = validateScientificReproductionArtifact(fixture);
  assert.equal(validation.ok, true, `${fixture.artifactType} should validate: ${JSON.stringify(validation.issues)}`);
  const schemaArtifactType = scientificReproductionArtifactSchemas[fixture.artifactType].properties.artifactType as { const: string };
  assert.equal(schemaArtifactType.const, fixture.artifactType);
}

const runtimeArtifact: RuntimeArtifact = {
  id: 'artifact-claim-graph',
  type: 'paper-claim-graph',
  producerScenario: 'scenario-1',
  schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  data: fixtures[0],
};
assert.equal(isScientificReproductionArtifact(runtimeArtifact), true);

const missingLocator = {
  ...fixtures[0],
  claims: [{ id: 'claim-1', text: 'A claim without source locators.', locatorRefs: [] }],
};
assert.equal(validateScientificReproductionArtifact(missingLocator).ok, false);
assert.ok(validateScientificReproductionArtifact(missingLocator).issues.some((issue) => issue.path === 'claims[0].locatorRefs'));

const inlineLargePayload = {
  ...fixtures[3],
  rawData: 'large payload should be referenced externally',
};
assert.equal(validateScientificReproductionRefsFirst(inlineLargePayload).ok, false);
assert.ok(validateScientificReproductionRefsFirst(inlineLargePayload).repairHints.some((hint) => hint.includes('workspace artifact/file refs')));

const missingEvidenceVerdict = {
  ...fixtures[7],
  supportingEvidenceRefs: [],
};
assert.equal(validateScientificReproductionArtifact(missingEvidenceVerdict).ok, false);
assert.ok(validateScientificReproductionArtifact(missingEvidenceVerdict).issues.some((issue) => issue.path === 'supportingEvidenceRefs'));

console.log('[ok] scientific reproduction contracts validate refs-first artifact shapes and reject missing locators/evidence or inline large content');
