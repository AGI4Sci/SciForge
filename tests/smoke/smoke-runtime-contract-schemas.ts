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
  preferredView: 'structure-viewer',
  actions: ['focus-right-pane', 'inspect', 'pin'],
};

assert.deepEqual(validateRuntimeContract('objectReference', objectReference), []);
assert.ok(validateRuntimeContract('objectReference', { id: 'bad', title: 'bad', kind: 'script', ref: 'file:run.sh' }).some((error) => error.includes('kind')));

const previewDescriptor = {
  kind: 'pdf',
  source: 'path',
  ref: '.sciforge/uploads/paper.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 31_000_000,
  rawUrl: 'http://127.0.0.1:5174/api/sciforge/preview/raw?ref=paper.pdf',
  inlinePolicy: 'stream',
  derivatives: [
    { kind: 'text', ref: '.sciforge/uploads/paper.pdf#text', status: 'lazy' },
    { kind: 'pages', ref: '.sciforge/uploads/paper.pdf#pages', status: 'lazy' },
  ],
  actions: ['open-inline', 'extract-text', 'select-page', 'select-region', 'system-open', 'copy-ref'],
  locatorHints: ['page', 'region'],
};

assert.deepEqual(validateRuntimeContract('previewDescriptor', previewDescriptor), []);
assert.ok(validateRuntimeContract('previewDescriptor', { ...previewDescriptor, inlinePolicy: 'base64' }).some((error) => error.includes('inlinePolicy')));
assert.ok(validateRuntimeContract('previewDescriptor', { ...previewDescriptor, derivatives: [{ kind: 'oops' }] }).some((error) => error.includes('derivatives.0.kind')));

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

const backgroundCompletionEvent = {
  contract: 'sciforge.background-completion.v1',
  type: 'background-stage-update',
  runId: 'run-1',
  stageId: 'stage-artifact',
  ref: 'run:run-1#stage-artifact',
  status: 'running',
  message: 'Artifact materialized; verification is still running.',
  artifacts: [{ id: 'artifact-1', type: 'research-report' }],
  verificationResults: [{ id: 'verify-1', verdict: 'pass' }],
  workEvidence: [{ id: 'we-1', ref: 'artifact:artifact-1' }],
  objectReferences: [objectReference],
};

assert.deepEqual(validateRuntimeContract('backgroundCompletionEvent', backgroundCompletionEvent), []);
assert.ok(validateRuntimeContract('backgroundCompletionEvent', {
  ...backgroundCompletionEvent,
  type: 'scenario-special-state',
}).some((error) => error.includes('type')));

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
    componentId: 'structure-viewer',
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

console.log('[ok] runtime UI contracts validate DisplayIntent, PreviewDescriptor, ResolvedViewPlan, UI module package, ObjectReference, UserGoalSnapshot, TurnAcceptance, and BackgroundCompletionEvent');
