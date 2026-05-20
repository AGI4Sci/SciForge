import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID,
  assertScientificReviewerVerifierLoopCase,
  buildScientificReviewerVerifierLoopCases,
  type ScientificReviewerVerifierLoopCase,
} from './scientific-reviewer-verifier-loop.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-scientific-reviewer-verifier-loop-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('scientific reviewer/verifier loop fixtures cover PROJECT R-METHOD-01, R-KG-01, R-BIO-01, and R-VERIFY-01', async () => {
  const cases = await buildScientificReviewerVerifierLoopCases({ baseDir });

  assert.deepEqual(cases.map((entry) => entry.requirementId), ['R-METHOD-01', 'R-KG-01', 'R-BIO-01', 'R-VERIFY-01']);
  for (const entry of cases) {
    assert.equal(entry.caseId, `${SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID}-${entry.requirementId}`);
    assertScientificReviewerVerifierLoopCase(entry);
  }
});

test('R-METHOD-01 fails if dependent v2 artifacts still point at protocol package v1', async () => {
  const entry = (await buildScientificReviewerVerifierLoopCases({ baseDir })).find((candidate) => candidate.requirementId === 'R-METHOD-01');
  assert.ok(entry);
  const polluted = cloneCase(entry);
  const protocolV1 = polluted.artifacts.find((artifact) => artifact.kind === 'protocol-package' && artifact.version === 'v1');
  const riskRegister = polluted.artifacts.find((artifact) => artifact.kind === 'risk-register');
  assert.ok(protocolV1);
  assert.ok(riskRegister);
  riskRegister.body.protocolPackageRef = protocolV1.ref;

  assert.throws(
    () => assertScientificReviewerVerifierLoopCase(polluted),
    /risk-register must point at protocol package v2/,
  );
});

test('R-KG-01 fails if contradiction evidence does not change confidence', async () => {
  const entry = (await buildScientificReviewerVerifierLoopCases({ baseDir })).find((candidate) => candidate.requirementId === 'R-KG-01');
  assert.ok(entry);
  const polluted = cloneCase(entry);
  const graph = polluted.artifacts.find((artifact) => artifact.kind === 'evidence-graph' && artifact.version === 'v2');
  assert.ok(graph);
  const edge = Array.isArray(graph.body.edges) && graph.body.edges[0] && typeof graph.body.edges[0] === 'object'
    ? graph.body.edges[0] as Record<string, unknown>
    : undefined;
  assert.ok(edge);
  edge.confidenceAfter = edge.confidenceBefore;

  assert.throws(
    () => assertScientificReviewerVerifierLoopCase(polluted),
    /contradictions must change confidence/,
  );
});

test('R-BIO-01 fails if evidence-free verification is marked as pass', async () => {
  const entry = (await buildScientificReviewerVerifierLoopCases({ baseDir })).find((candidate) => candidate.requirementId === 'R-BIO-01');
  assert.ok(entry);
  const polluted = cloneCase(entry);
  const checklist = polluted.artifacts.find((artifact) => artifact.kind === 'verification-checklist');
  assert.ok(checklist);
  checklist.body.pass = true;
  checklist.body.missingEvidence = [];

  assert.throws(
    () => assertScientificReviewerVerifierLoopCase(polluted),
    /verification without evidence cannot pass/,
  );
});

test('R-VERIFY-01 fails if verifier critique is treated as completion without artifact, UI, and audit alignment', async () => {
  const entry = (await buildScientificReviewerVerifierLoopCases({ baseDir })).find((candidate) => candidate.requirementId === 'R-VERIFY-01');
  assert.ok(entry);
  const polluted = cloneCase(entry);
  const analysisV2 = polluted.artifacts.find((artifact) => artifact.kind === 'analysis-artifact' && artifact.version === 'v2');
  assert.ok(analysisV2);
  polluted.audit.completionDeclaredByVerifierOnly = true;

  assert.throws(
    () => assertScientificReviewerVerifierLoopCase(polluted),
    /verifier critique alone must not declare completion/,
  );
});

function cloneCase(value: ScientificReviewerVerifierLoopCase): ScientificReviewerVerifierLoopCase {
  return structuredClone(value) as ScientificReviewerVerifierLoopCase;
}
