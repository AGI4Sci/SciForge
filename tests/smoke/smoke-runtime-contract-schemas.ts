import assert from 'node:assert/strict';
import { validateRuntimeContract } from '../../src/ui/src/runtimeContracts';

const displayIntent = {
  primaryGoal: 'inspect protein structure',
  requiredArtifactTypes: ['structure-summary'],
  preferredModules: ['protein-structure-viewer'],
  fallbackAcceptable: ['generic-artifact-inspector'],
  acceptanceCriteria: ['primary result visible'],
  source: 'agentserver',
};

assert.deepEqual(validateRuntimeContract('displayIntent', displayIntent), []);
assert.ok(validateRuntimeContract('displayIntent', { requiredArtifactTypes: ['paper-list'] }).some((error) => error.includes('primaryGoal')));

const objectReference = {
  id: 'obj-7rpz',
  title: 'PDB 7RPZ',
  kind: 'artifact',
  ref: 'artifact:structure-summary',
  artifactType: 'structure-summary',
  runId: 'run-1',
  preferredView: 'molecule-viewer',
  actions: ['focus-right-pane', 'inspect', 'pin'],
};

assert.deepEqual(validateRuntimeContract('objectReference', objectReference), []);
assert.ok(validateRuntimeContract('objectReference', { id: 'bad', title: 'bad', kind: 'script', ref: 'file:run.sh' }).some((error) => error.includes('kind')));

const userGoalSnapshot = {
  turnId: 'turn-1',
  rawPrompt: '请生成 markdown 阅读报告',
  goalType: 'report',
  requiredFormats: ['markdown'],
  requiredArtifacts: ['research-report'],
  requiredReferences: [],
  uiExpectations: ['report-viewer'],
  acceptanceCriteria: ['final response is user-readable'],
};

assert.deepEqual(validateRuntimeContract('userGoalSnapshot', userGoalSnapshot), []);
assert.ok(validateRuntimeContract('userGoalSnapshot', { ...userGoalSnapshot, goalType: 'unknown' }).some((error) => error.includes('goalType')));

assert.deepEqual(validateRuntimeContract('turnAcceptance', {
  pass: true,
  severity: 'pass',
  checkedAt: '2026-05-01T00:00:00.000Z',
  failures: [],
  objectReferences: [objectReference],
}), []);
assert.ok(validateRuntimeContract('turnAcceptance', {
  pass: true,
  severity: 'oops',
  checkedAt: '2026-05-01T00:00:00.000Z',
  failures: [],
  objectReferences: [],
}).some((error) => error.includes('severity')));

assert.deepEqual(validateRuntimeContract('resolvedViewPlan', {
  displayIntent,
  sections: {
    primary: [],
    supporting: [],
    provenance: [],
    raw: [],
  },
  diagnostics: [],
}), []);

assert.deepEqual(validateRuntimeContract('uiModulePackage', {
  module: {
    moduleId: 'protein-structure-viewer',
    version: '1.0.0',
    componentId: 'molecule-viewer',
    lifecycle: 'published',
    acceptsArtifactTypes: ['structure-summary'],
  },
  artifactSchema: {},
  viewSchema: {},
  interactions: [],
  renderer: {},
  fixtures: [],
  tests: [],
  preview: 'Protein structure viewer',
}), []);

console.log('[ok] runtime UI contracts validate DisplayIntent, ResolvedViewPlan, UI module package, ObjectReference, UserGoalSnapshot, and TurnAcceptance');
