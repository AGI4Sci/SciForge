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

test('workspace task payload coercion normalizes loose generated artifact refs', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Research package generated successfully.',
    confidence: 0.95,
    claimType: 'research-package',
    evidenceLevel: 'generated',
    reasoningTrace: 'Generated markdown files beside outputPath.',
    claims: [],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: '/tmp/research-package/README.md' },
      { componentId: 'notebook-timeline', artifactRef: '/tmp/research-package/timeline_budget.md' },
    ],
    executionUnits: [{ id: 'generate-package', status: 'done', tool: 'workspace-task' }],
    artifacts: [
      { ref: '/tmp/research-package/README.md', kind: 'artifact' },
      { ref: '/tmp/research-package/timeline_budget.md', kind: 'artifact' },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.artifacts[0]?.id, 'README');
  assert.equal(payload.artifacts[0]?.type, 'research-report');
  assert.equal(payload.artifacts[1]?.id, 'timeline_budget');
  assert.equal(payload.artifacts[1]?.type, 'notebook-timeline');
  assert.equal(payload.uiManifest[0]?.artifactRef, 'README');
  assert.equal(payload.uiManifest[1]?.artifactRef, 'timeline_budget');
  assert.deepEqual(schemaErrors(payload), []);
});

test('structured direct answers without displayIntent default to satisfied Projection outcome', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'ConversationProjection is the single source of truth for user-visible output.',
    confidence: 0.77,
    claimType: 'direct-answer',
    evidenceLevel: 'agentserver',
    reasoningTrace: 'Answered without execution.',
    claims: ['ConversationProjection is authoritative.'],
    uiManifest: [{ componentId: 'report-viewer' }],
    executionUnits: [{ id: 'direct-answer', status: 'done', tool: 'agentserver.direct-text' }],
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.deepEqual(schemaErrors(payload), []);
});

test('structured direct answers with nonblocking displayIntent merge satisfied defaults', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'ConversationProjection is the single source of truth for user-visible output.',
    confidence: 0.77,
    claimType: 'direct-answer',
    evidenceLevel: 'agentserver',
    reasoningTrace: 'Answered without execution.',
    claims: ['ConversationProjection is authoritative.'],
    displayIntent: { primaryView: 'answer' },
    uiManifest: [{ componentId: 'report-viewer' }],
    executionUnits: [{ id: 'direct-answer', status: 'done', tool: 'agentserver.direct-text' }],
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.equal(payload.displayIntent?.primaryView, 'answer');
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer ToolPayload JSON normalizes loose artifact refs instead of triggering direct-text guard', () => {
  const text = JSON.stringify({
    message: 'Generated a compact mini grant research package.',
    confidence: 0.91,
    claimType: 'research-package',
    evidenceLevel: 'generated',
    reasoningTrace: 'AgentServer returned structured ToolPayload JSON.',
    claims: [
      { id: 'claim-brief', text: 'Project brief, risk register, and timeline were produced.', evidenceLevel: 'generated' },
    ],
    displayIntent: 'research-package',
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: 'project-brief.md', title: 'Project brief' },
      { componentId: 'evidence-matrix', artifactRef: 'risk-register.md', title: 'Risks' },
      { componentId: 'notebook-timeline', artifactRef: 'timeline-budget.md', title: 'Timeline' },
    ],
    executionUnits: [
      { id: 'generate-package', status: 'completed', tool: 'agentserver' },
    ],
    artifacts: [
      { ref: 'project-brief.md', kind: 'markdown', content: '# Brief\nGoals and scope.' },
      { ref: 'risk-register.md', kind: 'markdown', content: '# Risks\n| Risk | Mitigation |' },
      { ref: 'timeline-budget.md', kind: 'markdown', content: '# Timeline\nMonth 1.' },
    ],
  });

  const payload = toolPayloadFromPlainAgentOutput(text, {
    skillDomain: 'literature',
    prompt: 'Generate a mini grant research package.',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'research-package');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.equal(payload.executionUnits[0]?.status, 'completed');
  assert.notEqual(payload.artifacts[0]?.type, 'runtime-diagnostic');
  assert.equal(payload.uiManifest[0]?.artifactRef, 'project-brief');
  assert.equal(payload.uiManifest[1]?.artifactRef, 'risk-register');
  assert.deepEqual(schemaErrors(payload), []);
});

test('structured blocking answers without displayIntent do not default to satisfied', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'The provider route is blocked.',
    confidence: 0.77,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'agentserver',
    reasoningTrace: 'Provider unavailable.',
    claims: ['Provider unavailable.'],
    uiManifest: [{ componentId: 'report-viewer' }],
    executionUnits: [{ id: 'blocked', status: 'needs-human', tool: 'agentserver.direct-text' }],
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal(payload.displayIntent, undefined);
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

test('plain AgentServer text wraps human-facing prose in an audited ToolPayload', () => {
  const payload = toolPayloadFromPlainAgentOutput('The report is ready. I found two evidence gaps and listed the next steps.', {
    skillDomain: 'knowledge',
    prompt: 'Summarize the result.',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'agentserver-direct-answer');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.equal(payload.artifacts[0]?.type, 'research-report');
  assert.match(payload.reasoningTrace, /wrapped it in a strict ToolPayload/i);
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer text exposes mentioned workspace files as artifacts', () => {
  const payload = toolPayloadFromPlainAgentOutput([
    'The task is complete. All outputs have been generated:',
    '- CSV: `output/experiment_data.csv`',
    '- Charts: `output/chart_treatment_timepoint.png`, `output/chart_batch.png`',
    '- Report: `output/report.md`',
    '- Evidence matrix: `output/evidence_matrix.json`',
    '- Timeline: `output/notebook_timeline.json`',
    '- Rerun command: `python drugA_batch_analysis.py /dev/null output`',
  ].join('\n'), {
    skillDomain: 'literature',
    prompt: 'Create a reproducible data-analysis mini project with a CSV and chart artifacts.',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'agentserver-direct-answer');
  assert.ok(payload.artifacts.some((artifact) => artifact.id === 'experiment_data' && artifact.type === 'csv' && artifact.path === 'output/experiment_data.csv'));
  assert.ok(payload.artifacts.some((artifact) => artifact.id === 'chart_treatment_timepoint' && artifact.type === 'image'));
  assert.ok(payload.artifacts.some((artifact) => artifact.id === 'evidence_matrix' && artifact.type === 'evidence-matrix'));
  assert.ok(payload.uiManifest.some((slot) => slot.artifactRef === 'experiment_data'));
  assert.ok(payload.uiManifest.some((slot) => slot.artifactRef === 'chart_treatment_timepoint'));
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer text cannot claim reproduction execution without durable evidence', () => {
  const payload = toolPayloadFromPlainAgentOutput(
    'I ran the logistic ODE reproduction successfully. It fitted r=64.9299 versus true r=0.8, RMSE=28.6483, and recovered the method.',
    {
      skillDomain: 'knowledge',
      prompt: 'Create Python code, run it, self-check RMSE and parameter errors, and say whether the reproduction succeeded.',
      artifacts: [],
    },
  );

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.match(payload.reasoningTrace, /structured patch\/test refs|durable workspace execution evidence/i);
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer text cannot claim coding repair success without patch or test evidence', () => {
  const payload = toolPayloadFromPlainAgentOutput(
    'I fixed the gateway bug, updated the tests, and everything passes. This is ready for PR.',
    {
      skillDomain: 'knowledge',
      prompt: 'Inspect this repository, implement a bug fix, update tests, and produce a PR-ready summary.',
      artifacts: [],
    },
  );

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.match(payload.reasoningTrace, /claims coding or repair completion/i);
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer text can summarize coding completion when file paths and verification commands are cited', () => {
  const payload = toolPayloadFromPlainAgentOutput(
    [
      'Implemented the patch in `src/runtime/gateway/direct-answer-payload.ts` and updated `src/runtime/gateway/direct-answer-payload.test.ts`.',
      'Verification: `npx tsx src/runtime/gateway/direct-answer-payload.test.ts` passed.',
    ].join('\n'),
    {
      skillDomain: 'knowledge',
      prompt: 'Inspect this repository, implement a bug fix, update tests, and produce a PR-ready summary.',
      artifacts: [],
    },
  );

  assert.equal(payload.claimType, 'agentserver-direct-answer');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.deepEqual(schemaErrors(payload), []);
});

test('plain AgentServer text wraps markdown stage results even when they mention ToolPayload output refs', () => {
  const text = [
    '## Stage Result: implement — RCG-003 ODE Parameter-Fitting Repair',
    '',
    '### Diagnosis',
    'The prior optimizer diverged: fitted r=64.93 vs true r=0.8 (8016% error), RMSE=28.65.',
    '',
    '### Execution & Validation',
    '- Script path: `.sciforge/sessions/.../tasks/generated-knowledge-c63d1a35f6e9/ode_fit_demo_repaired.py`',
    '- Run command: `python3 ode_fit_demo_repaired.py /dev/null /tmp/ode_fit_repaired_output.json`',
    '- Exit code: 0',
    '',
    '### Results',
    '| Metric | Prior (failed) | Repaired |',
    '|---|---|---|',
    '| Fitted r | 64.9299 | **0.8000** |',
    '| Fitted K | 73.6002 | **100.0000** |',
    '| RMSE | 28.6483 | **1.2865** |',
    '',
    '### Repair Verdict',
    '**Repair SUCCEEDED.** The ToolPayload JSON at `/tmp/ode_fit_repaired_output.json` contains code, output, and report artifacts.',
  ].join('\n');

  const classification = classifyPlainAgentText(text);
  assert.equal(classification.kind, 'human-answer');

  const payload = toolPayloadFromPlainAgentOutput(text, {
    skillDomain: 'knowledge',
    prompt: 'Repair the ODE demo and explicitly say whether the repair succeeded.',
    artifacts: [],
  });

  assert.equal(payload.claimType, 'agentserver-direct-answer');
  assert.equal(payload.displayIntent?.status, 'completed');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.match(payload.message, /Repair SUCCEEDED/);
  assert.deepEqual(schemaErrors(payload), []);
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

  assert.equal(payload.claimType, 'agentserver-direct-answer');
  assert.equal(payload.executionUnits[0]?.status, 'done');
  assert.deepEqual(schemaErrors(payload), []);
});
