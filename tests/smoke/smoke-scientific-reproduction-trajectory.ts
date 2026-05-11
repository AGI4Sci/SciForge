import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  buildSampleScientificReproductionTrajectory,
  evaluateSelfPromptAutoSubmitGate,
  sanitizeTrajectoryForExport,
  type ScientificReproductionTrajectory,
  validateScientificReproductionTrajectory,
} from '../../packages/skills/pipeline_skills/scientific-reproduction-loop/index';

const runbookPath = 'docs/runbooks/sciforge-web-reproduction.md';
const skillPath = 'packages/skills/pipeline_skills/scientific-reproduction-loop/SKILL.md';

await access(runbookPath);
await access(skillPath);

const [runbook, skill] = await Promise.all([readFile(runbookPath, 'utf8'), readFile(skillPath, 'utf8')]);

for (const required of [
  'state/action/observation',
  'Computer Use',
  'repairHistory',
  'selfPromptRecommendations',
  'sciforge.scientific-reproduction-trajectory.v1',
]) {
  assert.match(runbook + skill, new RegExp(required.replaceAll('/', '\\/')), `${required} should be documented`);
}

const sample = buildSampleScientificReproductionTrajectory();
const validation = validateScientificReproductionTrajectory(sample);
assert.equal(validation.ok, true, validation.errors.join('\n'));

assert.ok(sample.steps.some((step) => step.prompt?.role === 'human-researcher'), 'sample should include human-like prompt');
assert.ok(
  sample.steps.some((step) => (step.action?.screenBeforeRefs.length ?? 0) > 0),
  'sample should include screen state refs',
);
assert.ok(
  sample.steps.some((step) => step.observation.artifactRefs.length > 0),
  'sample should include artifact lineage refs',
);
assert.ok(sample.repairHistory.length > 0, 'sample should include repair history');
assert.ok(sample.selfPromptRecommendations.length > 0, 'sample should include self-prompt recommendations');
assert.equal(sample.selfPromptRecommendations[0]?.budget?.maxAutoSubmitRounds, 0);
assert.equal(sample.selfPromptRecommendations[0]?.budget?.reviewRequiredBeforeSubmit, true);
assert.ok(sample.selfPromptRecommendations[0]?.humanConfirmationPoint);

const baseRecommendation = sample.selfPromptRecommendations[0];
assert.ok(baseRecommendation, 'sample should include a first self-prompt recommendation');
const shadowGate = evaluateSelfPromptAutoSubmitGate(baseRecommendation, {
  schemaRef: { ref: 'artifact:self-prompt-schema:v1', kind: 'artifact' },
  verifierRef: { ref: 'artifact:self-prompt-verifier:auto-submit-v1', kind: 'artifact' },
  verifierPassed: true,
  resolvedRefs: baseRecommendation.requiredRefs,
  approvedByHuman: false,
});
assert.equal(shadowGate.status, 'needs-human');
assert.ok(shadowGate.blockers.includes('human-confirmation-required'), 'shadow mode should require human review');

const autoSubmitCandidate = structuredClone(baseRecommendation);
autoSubmitCandidate.mode = 'auto-submit-eligible';
autoSubmitCandidate.requiredRefs = [
  { ref: 'artifact:analysis-plan:sample', kind: 'artifact' },
  { ref: 'trace:self-prompt-gate:sample', kind: 'trace' },
  { ref: 'workspace:reproduction/session.json', kind: 'workspace-file' },
];
autoSubmitCandidate.budget = {
  maxShadowRounds: 1,
  maxAutoSubmitRounds: 1,
  maxToolCalls: 4,
  maxRuntimeMinutes: 10,
  stopOnRepeatedFailure: true,
  reviewRequiredBeforeSubmit: false,
};
autoSubmitCandidate.humanConfirmationPoint = 'Auto-submit may proceed only when schema, verifier, refs, budget, and stop condition pass.';
autoSubmitCandidate.reviewChecklist = [
  'schema ref resolves',
  'verifier ref resolves',
  'budget and stop condition are bounded',
  'human confirmation point is recorded',
];
autoSubmitCandidate.autoSubmitGate = evaluateSelfPromptAutoSubmitGate(autoSubmitCandidate, {
  schemaRef: { ref: 'artifact:self-prompt-schema:v1', kind: 'artifact' },
  verifierRef: { ref: 'artifact:self-prompt-verifier:auto-submit-v1', kind: 'artifact' },
  verifierPassed: true,
  resolvedRefs: autoSubmitCandidate.requiredRefs,
  approvedByHuman: true,
  checkedAt: '2026-05-11T00:04:00.000Z',
});
assert.equal(autoSubmitCandidate.autoSubmitGate.status, 'auto-submit');
assert.equal(autoSubmitCandidate.autoSubmitGate.blockers.length, 0);

const autoSubmitEligible = structuredClone(sample);
autoSubmitEligible.selfPromptRecommendations = [autoSubmitCandidate];
let autoSubmitValidation = validateScientificReproductionTrajectory(autoSubmitEligible);
assert.equal(autoSubmitValidation.ok, true, autoSubmitValidation.errors.join('\n'));

const missingRefGate = evaluateSelfPromptAutoSubmitGate(autoSubmitCandidate, {
  schemaRef: { ref: 'artifact:self-prompt-schema:v1', kind: 'artifact' },
  verifierRef: { ref: 'artifact:self-prompt-verifier:auto-submit-v1', kind: 'artifact' },
  verifierPassed: true,
  resolvedRefs: autoSubmitCandidate.requiredRefs.slice(1),
  approvedByHuman: true,
});
assert.equal(missingRefGate.status, 'needs-human');
assert.ok(missingRefGate.blockers.includes('unresolved-required-ref'), 'missing required ref should block auto-submit');

const repeatedFailureGate = evaluateSelfPromptAutoSubmitGate(autoSubmitCandidate, {
  schemaRef: { ref: 'artifact:self-prompt-schema:v1', kind: 'artifact' },
  verifierRef: { ref: 'artifact:self-prompt-verifier:auto-submit-v1', kind: 'artifact' },
  verifierPassed: true,
  resolvedRefs: autoSubmitCandidate.requiredRefs,
  approvedByHuman: true,
  repeatedFailure: true,
});
assert.equal(repeatedFailureGate.status, 'failed-with-reason');
assert.ok(repeatedFailureGate.blockers.includes('repeated-failure'), 'repeated failure should fail closed');

const badRequiredRef = structuredClone(autoSubmitEligible);
badRequiredRef.selfPromptRecommendations[0].requiredRefs = [
  { ref: '/Applications/workspace/raw-downloads/private.fastq', kind: 'workspace-file' },
];
autoSubmitValidation = validateScientificReproductionTrajectory(badRequiredRef);
assert.equal(autoSubmitValidation.ok, false);
assert.ok(
  autoSubmitValidation.errors.some((error) => error.includes('requiredRefs[0].ref must use')),
  'auto-submit gate should reject local paths and non-workspace refs',
);

const incompleteAutoGate = structuredClone(autoSubmitEligible);
(incompleteAutoGate.selfPromptRecommendations[0].autoSubmitGate as unknown as Record<string, unknown>).schemaRef = undefined;
(incompleteAutoGate.selfPromptRecommendations[0].autoSubmitGate as unknown as Record<string, unknown>).verifierRef = undefined;
incompleteAutoGate.selfPromptRecommendations[0].budget!.reviewRequiredBeforeSubmit = true;
incompleteAutoGate.selfPromptRecommendations[0].stopCondition = '';
incompleteAutoGate.selfPromptRecommendations[0].humanConfirmationPoint = '';
autoSubmitValidation = validateScientificReproductionTrajectory(incompleteAutoGate);
assert.equal(autoSubmitValidation.ok, false);
for (const required of ['stopCondition', 'reviewRequiredBeforeSubmit', 'humanConfirmationPoint', 'schemaRef.ref', 'verifierRef.ref']) {
  assert.ok(
    autoSubmitValidation.errors.some((error) => error.includes(required)),
    `auto-submit gate should report missing/incomplete ${required}`,
  );
}

const blockedAutoGate = structuredClone(autoSubmitEligible);
blockedAutoGate.selfPromptRecommendations[0].autoSubmitGate = {
  status: 'needs-human',
  reason: 'Auto-submit is blocked because raw inputs require manual download and the license must be reviewed.',
  blockers: ['missing-evidence', 'raw-download-required', 'license-restriction', 'compute-budget-exceeded', 'repeated-failure'],
  schemaRef: { ref: 'artifact:self-prompt-schema:v1', kind: 'artifact' },
  verifierRef: { ref: 'artifact:self-prompt-verifier:auto-submit-v1', kind: 'artifact' },
  blockerRefs: [
    { ref: 'artifact:missing-data-report:sample', kind: 'artifact' },
    { ref: 'trace:self-prompt-gate:blockers', kind: 'trace' },
  ],
};
autoSubmitValidation = validateScientificReproductionTrajectory(blockedAutoGate);
assert.equal(autoSubmitValidation.ok, true, autoSubmitValidation.errors.join('\n'));

const unsafeAllowedAutoGate = structuredClone(blockedAutoGate);
unsafeAllowedAutoGate.selfPromptRecommendations[0].autoSubmitGate!.status = 'allowed';
autoSubmitValidation = validateScientificReproductionTrajectory(unsafeAllowedAutoGate);
assert.equal(autoSubmitValidation.ok, false);
assert.ok(
  autoSubmitValidation.errors.some((error) => error.includes('missing evidence blocks auto-submit')),
  'missing evidence/raw download/license/compute/repeated failure blockers must prevent allowed auto-submit',
);

const unsafe = structuredClone(sample);
unsafe.steps[0].observation.summary =
  'Opened /Applications/workspace/ailab/research/app/SciForge with api_key=secret-token-value and token=abc.def.ghi';

const sanitized = sanitizeTrajectoryForExport(unsafe);
const serialized = JSON.stringify(sanitized);
assert.doesNotMatch(serialized, /\/Applications\/workspace/);
assert.doesNotMatch(serialized, /secret-token-value/);
assert.match(serialized, /\[workspace-ref\]/);
assert.match(serialized, /\[redacted-secret\]/);

const invalid = structuredClone(sample);
invalid.steps = [];
const invalidResult = validateScientificReproductionTrajectory(invalid);
assert.equal(invalidResult.ok, false);
assert.ok(invalidResult.errors.some((error) => error.includes('steps must contain at least one replayable step')));

const shadowFixture = JSON.parse(await readFile(
  new URL('../fixtures/scientific-reproduction/self-prompt-shadow/refs-first-2025-setd1b-next-round.json', import.meta.url),
  'utf8',
)) as ScientificReproductionTrajectory;
const shadowValidation = validateScientificReproductionTrajectory(shadowFixture);
assert.equal(shadowValidation.ok, true, shadowValidation.errors.join('\n'));
assert.equal(shadowFixture.subject.paperRefs.length > 0, true, 'shadow fixture should identify the new paper by ref');
assert.ok(
  shadowFixture.steps.some((step) => step.prompt?.role === 'self-prompt-shadow'),
  'shadow fixture should preserve a self-prompt prompt record',
);
const shadowRecommendation = shadowFixture.selfPromptRecommendations[0];
assert.ok(shadowRecommendation, 'shadow fixture should include a next-round recommendation');
assert.match(shadowRecommendation.nextPrompt, /claim 2025-setd1b-c2|Figure 3/i, 'next-round question should be concrete');
assert.ok(shadowRecommendation.requiredRefs.length >= 5, 'next-round recommendation should require refs');
assert.ok(shadowRecommendation.requiredRefs.every((ref) => /^(artifact|workspace-file|trace|screen|execution-unit|audit|ledger):/.test(ref.ref)));
assert.match(shadowRecommendation.stopCondition, /Stop|stop|budget|failure|unavailable/, 'stop condition should be explicit');
assert.match(shadowRecommendation.qualityGate, /refs|artifact|evidence|failure|negative/i, 'quality gate should be evidence-aware');
assert.equal(shadowRecommendation.budget?.maxShadowRounds, 1);
assert.equal(shadowRecommendation.budget?.maxAutoSubmitRounds, 0, 'shadow record must not allow automatic chained submits');
assert.equal(shadowRecommendation.budget?.stopOnRepeatedFailure, true);
assert.equal(shadowRecommendation.budget?.reviewRequiredBeforeSubmit, true);
assert.ok(shadowRecommendation.humanConfirmationPoint, 'shadow record should name the human confirmation point');
assert.notEqual(shadowRecommendation.mode, 'auto-submit-eligible', 'shadow acceptance fixture must remain human-reviewed');

const shadowSerialized = JSON.stringify(shadowFixture);
assert.doesNotMatch(shadowSerialized, /\/Applications\/workspace/);
assert.doesNotMatch(shadowSerialized, /api[_-]?key|secret-token-value|RAW_/i);

console.log('[ok] scientific reproduction trajectory and self-prompt shadow fixtures are replay/audit-shaped');
