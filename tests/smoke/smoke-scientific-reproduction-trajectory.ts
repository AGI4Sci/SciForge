import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  buildSampleScientificReproductionTrajectory,
  sanitizeTrajectoryForExport,
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

console.log('[ok] scientific reproduction trajectory runbook and export contract are replay/audit-shaped');
