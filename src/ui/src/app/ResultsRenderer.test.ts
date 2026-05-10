import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { backendRepairStates, coerceReportPayload, contractValidationFailures, renderRegisteredWorkbenchSlot, ResultsRenderer, runAuditRefs, runRecoverActions, shouldOpenRunAuditDetails } from './ResultsRenderer';
import { createResultsRendererViewModel } from './results-renderer-view-model';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import type { RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../domain';

test('coerceReportPayload extracts report refs from backend ToolPayload text instead of rendering raw JSON', () => {
  const payloadText = [
    'Let me inspect the prior attempts before returning the result.',
    '',
    'Returning the existing result as a ToolPayload.',
    '',
    '```json',
    '{',
    '  "message": "成功检索 10 篇论文，生成详细 Markdown 阅读报告。",',
    '  "uiManifest": [{"componentId": "paper-card-list"}],',
    '  "artifacts": [{',
    '    "id": "research-report",',
    '    "type": "research-report",',
    '    "data": {',
    '      "markdownRef": ".sciforge/tasks/generated-literature/report/arxiv-agent-reading-report.md"',
    '    }',
    '  }]',
    '}',
    '```',
  ].join('\n');
  const artifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: payloadText },
  };

  const report = coerceReportPayload({ markdown: payloadText }, artifact);

  assert.equal(report.reportRef, '.sciforge/tasks/generated-literature/report/arxiv-agent-reading-report.md');
  assert.match(report.markdown ?? '', /Markdown report/);
  assert.doesNotMatch(report.markdown ?? '', /"uiManifest"/);
});

test('coerceReportPayload keeps normal markdown report bodies unchanged', () => {
  const markdown = '# Real Report\n\nThis is the user-facing paper reading report.';
  const report = coerceReportPayload({ markdown });

  assert.equal(report.markdown, markdown);
  assert.equal(report.reportRef, undefined);
});

test('coerceReportPayload prefers markdown refs over JSON data refs', () => {
  const artifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/task-results/run-output.json',
    metadata: {
      markdownRef: '.sciforge/artifacts/run/research-report.md',
      outputRef: '.sciforge/task-results/run-output.json',
    },
    data: { summary: 'fallback summary' },
  };

  const report = coerceReportPayload({ dataRef: artifact.dataRef }, artifact);

  assert.equal(report.reportRef, '.sciforge/artifacts/run/research-report.md');
  assert.notEqual(report.reportRef, '.sciforge/task-results/run-output.json');
});

test('coerceReportPayload synthesizes readable report sections from related artifacts', () => {
  const reportArtifact: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { reportRef: 'agentserver://run/output' },
  };
  const paperList: RuntimeArtifact = {
    id: 'paper-list',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      papers: [{
        title: 'Agentic Retrieval for Scientific Discovery',
        authors: ['A. Researcher', 'B. Scientist'],
        year: 2026,
        url: 'https://arxiv.org/abs/2601.00001',
        summary: 'Introduces an agent workflow for literature triage.',
      }],
    },
  };
  const evidenceMatrix: RuntimeArtifact = {
    id: 'evidence-matrix',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      rows: [{ claim: 'Agents improve triage', evidence: 'benchmark', confidence: 0.72 }],
    },
  };

  const report = coerceReportPayload({ reportRef: 'agentserver://run/output' }, reportArtifact, [paperList, evidenceMatrix]);

  assert.match(report.markdown ?? '', /Agentic Retrieval for Scientific Discovery/);
  assert.match(report.markdown ?? '', /Agents improve triage/);
  assert.doesNotMatch(report.markdown ?? '', /ENOENT/);
});

test('completed runs with partial retrieval notes do not open failure audit by default', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-partial-retrieval',
    scenarioId: 'literature-evidence-review',
    title: 'partial retrieval',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'project-literature-evidence-review-run',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'fetch papers',
      response: 'completed with partial PDF retrieval',
      createdAt: '2026-05-09T00:00:00.000Z',
      completedAt: '2026-05-09T00:01:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'fetch-full-text',
      tool: 'arxiv.fetch',
      params: '{}',
      status: 'partial' as never,
      hash: 'hash-partial',
      failureReason: 'Some papers could not be fully retrieved',
      outputRef: '.sciforge/task-results/project-literature-evidence-review-run.json',
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:01:00.000Z',
  };

  assert.equal(shouldOpenRunAuditDetails(session, session.runs[0]), false);
});

test('failure audit extracts ContractValidationFailure recover actions, related refs, and backend repair state', () => {
  const session = contractFailureSession();

  assert.equal(shouldOpenRunAuditDetails(session, session.runs[0]), true);
  assert.equal(contractValidationFailures(session, session.runs[0]).length, 1);
  assert.deepEqual(runRecoverActions(session, session.runs[0]), [
    'regenerate report artifact with markdownRef',
    'inspect repair stderr and rerun bounded validator',
    'rerun validator after artifact repair',
  ]);
  assert.ok(runAuditRefs(session, session.runs[0]).includes('execution-unit:EU-report'));
  assert.ok(runAuditRefs(session, session.runs[0]).includes('agentserver://repair/stderr'));
  assert.equal(backendRepairStates(session, session.runs[0])[0]?.failureReason, 'backend artifact repair timed out');
});

test('ResultsRenderer renders ContractValidationFailure diagnostics without synthesizing a successful answer', () => {
  const session = contractFailureSession();
  const html = renderToStaticMarkup(createElement(ResultsRenderer, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    defaultSlots: [],
    onArtifactHandoff: () => undefined,
    collapsed: false,
    onToggleCollapse: () => undefined,
    activeRunId: 'run-contract-failure',
    onActiveRunChange: () => undefined,
    onFocusedObjectChange: () => undefined,
    workspaceFileEditor: null,
    onWorkspaceFileEditorChange: () => undefined,
  }));

  assert.match(html, /ContractValidationFailure/);
  assert.match(html, /artifact-schema/);
  assert.match(html, /relatedRef: execution-unit:EU-report/);
  assert.match(html, /Backend repair state/);
  assert.match(html, /backend artifact repair timed out/);
  assert.match(html, /regenerate report artifact with markdownRef/);
  assert.match(html, /未合成成功答案/);
  assert.doesNotMatch(html, /已完成报告|ready result/);
});

test('paper-card-list workbench slot is rendered by package policy', () => {
  const artifact: RuntimeArtifact = {
    id: 'papers',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      papers: [
        { title: 'Package-owned paper renderer', journal: 'SciForge Journal', year: 2026, evidenceLevel: 'review' },
      ],
    },
  };
  const session = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const html = renderToStaticMarkup(createElement(() => renderRegisteredWorkbenchSlot({
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    slot: { componentId: 'paper-card-list', artifactRef: 'papers' } as never,
    artifact,
  })));

  assert.match(html, /Package-owned paper renderer/);
  assert.match(html, /SciForge Journal/);
  assert.doesNotMatch(html, /缺少 papers\/rows 数组/);
});

test('results renderer view model projects hidden result empty state and manifest diagnostics', () => {
  const artifact: RuntimeArtifact = {
    id: 'papers',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      papers: [{ title: 'View model paper', year: 2026 }],
    },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const initial = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [],
    focusMode: 'all',
  });
  assert.ok(initial.visibleItems.length > 0);
  assert.equal(initial.emptyState, undefined);
  assert.ok(initial.manifestDiagnostics.some((item) => item.artifactType === 'paper-list'));

  const hiddenSession: SciForgeSession = {
    ...session,
    hiddenResultSlotIds: initial.viewPlan.allItems.map((item) => item.id),
  };
  const hidden = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session: hiddenSession,
    defaultSlots: [],
    focusMode: 'all',
  });

  assert.equal(hidden.visibleItems.length, 0);
  assert.equal(hidden.emptyState?.dismissedAllInFilter, true);
  assert.equal(hidden.emptyState?.title, '当前筛选下的视图已全部从界面移除');
});

function contractFailureSession(): SciForgeSession {
  const failure: ContractValidationFailure = {
    contract: 'sciforge.contract-validation-failure.v1',
    schemaPath: '/artifacts/0/data',
    contractId: 'research-report.v1',
    capabilityId: 'report-viewer',
    failureKind: 'artifact-schema',
    expected: { required: ['markdown'] },
    actual: { summary: 'only summary' },
    missingFields: ['data.markdown'],
    invalidRefs: ['artifact:research-report'],
    unresolvedUris: ['file::.sciforge/missing/report.md'],
    failureReason: 'research-report artifact is missing markdown content.',
    recoverActions: ['regenerate report artifact with markdownRef'],
    nextStep: 'Repair the artifact payload before showing the report.',
    relatedRefs: ['execution-unit:EU-report', 'artifact:research-report'],
    issues: [{ path: '/data/markdown', message: 'required field missing', missingField: 'data.markdown' }],
    createdAt: '2026-05-09T00:00:00.000Z',
  };
  return {
    schemaVersion: 2,
    sessionId: 'session-contract-failure',
    scenarioId: 'literature-evidence-review',
    title: 'contract failure',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-contract-failure',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'generate report',
      response: `failed-with-reason: ${failure.failureReason}`,
      createdAt: '2026-05-09T00:00:00.000Z',
      completedAt: '2026-05-09T00:01:00.000Z',
      raw: {
        contractValidationFailure: failure,
        acceptanceRepair: {
          sourceRunId: 'run-original',
          repairRunId: 'run-repair-1',
          failureReason: 'backend artifact repair timed out',
          recoverActions: ['inspect repair stderr and rerun bounded validator'],
          refs: [{ ref: 'agentserver://repair/stderr' }],
          repairHistory: [{
            attempt: 1,
            action: 'artifact-contract-repair',
            status: 'failed-with-reason',
            startedAt: '2026-05-09T00:00:10.000Z',
            completedAt: '2026-05-09T00:00:40.000Z',
            sourceRunId: 'run-original',
            repairRunId: 'run-repair-1',
            reason: 'backend artifact repair timed out',
          }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-report',
      tool: 'report.validate',
      params: '{}',
      status: 'repair-needed',
      hash: 'hash-report',
      failureReason: 'data.markdown is missing',
      outputRef: 'artifact:research-report',
      recoverActions: ['rerun validator after artifact repair'],
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:01:00.000Z',
  };
}

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-05-09T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:5174',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5175',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'openai',
    modelBaseUrl: '',
    modelName: 'test-model',
    apiKey: '',
    requestTimeoutMs: 30000,
    maxContextWindowTokens: 128000,
    visionAllowSharedSystemInput: false,
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}
