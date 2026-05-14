import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPlainAgentText, coerceWorkspaceTaskPayload, normalizeWorkspaceTaskArtifacts, toolPayloadFromPlainAgentOutput } from './direct-answer-payload';
import { schemaErrors } from './tool-payload-contract';

test('workspace task payload coercion accepts common generated JSON shape drift', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: ['searched', 'downloaded', 'reported'],
    claims: [{ claim: '20 papers found', evidence: 'arXiv API' }],
    uiManifest: {
      components: [{ id: 'report-viewer', props: { content: '# Report' } }],
    },
    executionUnits: [{ id: 'search', status: 'completed' }],
    artifacts: [
      { id: 'research-report', type: 'research-report', content: '# Report' },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.reasoningTrace, 'searched\ndownloaded\nreported');
  assert.equal(Array.isArray(payload.uiManifest), true);
  assert.deepEqual(schemaErrors(payload), []);
});

test('workspace task payload coercion derives required envelope fields from useful artifacts', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: ['searched', 'downloaded', 'reported'],
    displayIntent: 'report',
    uiManifest: {
      components: [{ id: 'report-viewer', props: { content: '# Report' } }],
    },
    executionUnits: [{ id: 'search', status: 'success' }],
    artifacts: [
      { id: 'research-report', type: 'research-report', content: '# Report' },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.claims.length, 1);
  assert.equal(payload.uiManifest[0]?.componentId, 'report-viewer');
  assert.equal(typeof payload.displayIntent, 'object');
  assert.deepEqual(schemaErrors(payload), []);
});

test('workspace task payload coercion drops empty uiManifest artifact refs', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: 'done',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: '' }],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal('artifactRef' in (payload.uiManifest[0] ?? {}), false);
  assert.deepEqual(schemaErrors(payload), []);
});

test('workspace task artifact boundary derives identity from file refs', () => {
  const artifacts = normalizeWorkspaceTaskArtifacts([
    { ref: 'research-report.md', kind: 'file', mimeType: 'text/markdown', title: 'Report' },
    { path: 'paper-list.md', kind: 'file', mimeType: 'text/markdown' },
  ]);

  assert.equal(artifacts[0]?.id, 'research-report');
  assert.equal(artifacts[0]?.type, 'research-report');
  assert.equal(artifacts[0]?.path, 'research-report.md');
  assert.equal(artifacts[0]?.dataRef, 'research-report.md');
  assert.equal(artifacts[1]?.id, 'paper-list');
  assert.equal(artifacts[1]?.type, 'paper-list');
});

test('plain AgentServer text guard blocks raw task files and logs from final-answer wrapping', () => {
  const taskFilesText = '{"taskFiles":[{"path":"task.py","content":"print(1)"}],"stdoutRel":".sciforge/debug/stdout.log"}';
  const classification = classifyPlainAgentText(taskFilesText);
  assert.equal(classification.kind, 'task-files-json');

  const payload = toolPayloadFromPlainAgentOutput(taskFilesText, {
    skillDomain: 'knowledge',
    prompt: 'Fix the run and show me the result.',
    artifacts: [],
  });

  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.equal(payload.artifacts[0]?.type, 'runtime-diagnostic');
  assert.match(payload.reasoningTrace, /strict ToolPayload boundary/i);
});

test('plain AgentServer text guard blocks human-facing prose without structured ToolPayload', () => {
  const payload = toolPayloadFromPlainAgentOutput('The report is ready. I found two evidence gaps and listed the next steps.', {
    skillDomain: 'knowledge',
    prompt: 'Summarize the result.',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.match(payload.reasoningTrace, /strict ToolPayload boundary/i);
});

test('plain AgentServer text guard allows prose that references taskFiles without raw metadata', () => {
  const text = 'The generated files are available in the audit refs. I mention taskFiles only to explain where the code was archived.';
  const classification = classifyPlainAgentText(text);
  assert.equal(classification.kind, 'human-answer');

  const payload = toolPayloadFromPlainAgentOutput(text, {
    skillDomain: 'knowledge',
    prompt: 'Where did the generated files go?',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
});
