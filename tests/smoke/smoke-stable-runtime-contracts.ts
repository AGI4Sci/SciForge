import assert from 'node:assert/strict';

import { compileScenarioIRFromSelection } from '../../src/ui/src/scenarioCompiler/scenarioElementCompiler';
import { runScenarioRuntimeSmoke } from '../../src/ui/src/scenarioCompiler/runtimeSmoke';

const stableSeed = compileScenarioIRFromSelection({
  id: 'stable-literature-offline',
  title: 'Stable literature offline',
  description: 'Use the validated packaged biomedical search skill contract without requiring AgentServer.',
  skillDomain: 'literature',
  selectedSkillIds: ['scp.biomedical-web-search'],
  selectedArtifactTypes: ['paper-list'],
  selectedComponentIds: ['paper-card-list', 'unknown-artifact-inspector'],
  selectedFailurePolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
});

const smoke = await runScenarioRuntimeSmoke({ package: stableSeed.package, mode: 'dry-run' });
assert.equal(smoke.ok, true);
assert.equal(smoke.packageRef.source, 'workspace');
assert.ok(smoke.selectedSkillIds.includes('scp.biomedical-web-search'));
assert.ok(smoke.expectedArtifactTypes.includes('paper-list'));

const noProducer = compileScenarioIRFromSelection({
  id: 'unsupported-sequence-no-producer',
  title: 'Unsupported sequence no producer',
  description: 'Request sequence alignment without selecting the sequence-producing package skill.',
  skillDomain: 'knowledge',
  selectedSkillIds: ['knowledge.uniprot_chembl_lookup'],
  selectedArtifactTypes: ['sequence-alignment'],
  selectedComponentIds: ['data-table', 'unknown-artifact-inspector'],
  selectedFailurePolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
});

assert.equal(noProducer.validationReport.ok, false);
assert.ok(noProducer.issues.some((issue) => issue.code === 'missing-producer' || issue.code === 'ambiguous-skill'));
assert.ok(noProducer.validationReport.issues.some((issue) => issue.code === 'missing-selected-producer' || issue.code === 'missing-producer'));

console.log('[ok] stable runtime contracts dry-run without AgentServer and reject no-producer scenario');
