import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  buildSampleScientificReproductionTrajectory,
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
