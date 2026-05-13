import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { backendRepairStates, coerceReportPayload, contractValidationFailures, renderRegisteredWorkbenchSlot, ResultsRenderer, runAuditRefs, runRecoverActions, shouldOpenRunAuditDetails } from './ResultsRenderer';
import { ArtifactInspectorDrawer } from './results-renderer-artifact-inspector';
import { nextPinnedObjectReferences, resolveObjectReferenceActionPlan } from './results-renderer-object-actions';
import { RegistrySlot } from './results-renderer-registry-slot';
import { createResultsRendererViewModel } from './results-renderer-view-model';
import { applyBackgroundCompletionEventToSession } from './chat/sessionTransforms';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../domain';

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
      runId: 'project-literature-evidence-review-run',
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
  assert.equal(contractValidationFailures(session, session.runs[0]).length, 0);
  assert.deepEqual(runRecoverActions(session, session.runs[0]), []);
  assert.ok(runAuditRefs(session, session.runs[0]).includes('execution-unit:EU-report'));
  assert.ok(runAuditRefs(session, session.runs[0]).includes('agentserver://repair/stderr'));
  assert.equal(backendRepairStates(session, session.runs[0]).length, 0);
});

test('ResultsRenderer keeps raw ContractValidationFailure audit-only without synthesizing a main failure state', () => {
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

  assert.match(html, /主结果等待 ConversationProjection/);
  assert.doesNotMatch(html, /运行需要处理/);
  assert.match(html, /sciforge\.contract-validation-failure\.v1/);
  assert.match(html, /artifact-schema/);
  assert.match(html, /EU-report/);
  assert.match(html, /backend artifact repair timed out/);
  assert.match(html, /regenerate report artifact with markdownRef/);
  assert.doesNotMatch(html, /已完成报告|ready result/);
});

test('ResultsRenderer keeps raw failure text out of the first-screen main summary while preserving audit details', () => {
  const session = contractFailureSession();
  const longReason = [
    'ContractValidationFailure work-evidence; contractId=sciforge.work-evidence.v1; schemaPath=packages/contracts/runtime/work-evidence-policy.ts#evaluateWorkEvidencePolicy;',
    'reason=Contract validation failed because generated work evidence did not include durable evidenceRefs and rawRef for a completed external retrieval.',
    'Previous failure: External retrieval returned zero results while the task marked itself completed.',
    'Treat this as repair-needed until the task records provider status, query/url, retry/fallback attempts, rate-limit diagnostics, and durable refs.',
  ].join(' ');
  session.executionUnits[0]!.failureReason = longReason;
  session.runs[0]!.raw = {
    ...session.runs[0]!.raw as Record<string, unknown>,
    blocker: longReason,
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-contract-failure' });
  const summaryStart = html.indexOf('主结果等待 ConversationProjection');
  const auditStart = html.indexOf('查看运行细节');
  const summaryHtml = html.slice(summaryStart, auditStart);

  assert.doesNotMatch(summaryHtml, /External retrieval returned zero results while the task marked itself completed/);
  assert.doesNotMatch(summaryHtml, /retry\/fallback attempts, rate-limit diagnostics, and durable refs/);
  assert.match(html, /retry\/fallback attempts, rate-limit diagnostics, and durable refs/);
});

test('ResultsRenderer empty completed run is presented as empty rather than ready', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [completedRun('run-empty-artifacts')],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-empty-artifacts' });

  assert.match(html, /本轮没有生成可展示 artifact/);
  assert.match(html, /没有 ConversationProjection 或可展示产物/);
  assert.doesNotMatch(html, /重新运行或要求生成可展示 artifact/);
  assert.doesNotMatch(html, /ready result/);
});

test('ResultsRenderer lets projection satisfied state suppress raw failed run and execution unit UI', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-projection-visible-ready'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        failureReason: 'LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER',
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-visible-ready',
            currentTurn: { id: 'turn-ready', prompt: 'summarize refs' },
            visibleAnswer: {
              status: 'satisfied',
              text: 'Projection-visible answer is authoritative.',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: ['run:projection-visible-ready'],
            diagnostics: [],
          },
        },
      },
    }],
    executionUnits: [{
      id: 'EU-legacy-failed',
      tool: 'legacy.raw',
      params: '{}',
      status: 'repair-needed',
      hash: 'legacy',
      failureReason: 'LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER',
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-projection-visible-ready' });

  assert.match(html, /Projection-visible answer is authoritative/);
  assert.doesNotMatch(html, /运行需要处理/);
  assert.doesNotMatch(html, /LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(html, /LEGACY_EXECUTION_UNIT_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(html, /查看运行细节/);
});

test('ResultsRenderer restores projection from ConversationEventLog before stale raw projection', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-event-log-authoritative'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        displayIntent: {
          conversationEventLog: {
            schemaVersion: 'sciforge.conversation-event-log.v1',
            conversationId: 'conversation-event-log-authoritative',
            events: [
              {
                id: 'turn-event-log',
                type: 'TurnReceived',
                storage: 'inline',
                actor: 'user',
                timestamp: '2026-05-13T00:00:00.000Z',
                turnId: 'turn-event-log',
                payload: { prompt: 'restore from event log' },
              },
              {
                id: 'blocked-event-log',
                type: 'ExternalBlocked',
                storage: 'ref',
                actor: 'runtime',
                timestamp: '2026-05-13T00:00:01.000Z',
                turnId: 'turn-event-log',
                runId: 'run-event-log-authoritative',
                payload: {
                  summary: 'provider transport failed',
                  reason: 'RECORDED_EVENT_LOG_FAILURE',
                  refs: [{ ref: 'log:event-log-provider-stderr', digest: 'sha256:event-log' }],
                },
              },
            ],
          },
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'stale-projection',
            visibleAnswer: {
              status: 'satisfied',
              text: 'STALE_RAW_PROJECTION_SHOULD_NOT_RENDER',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: [],
            diagnostics: [],
          },
        },
      },
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-event-log-authoritative' });
  const mainHtml = html.slice(0, html.indexOf('Raw JSON / stdout / stderr refs'));

  assert.match(html, /RECORDED_EVENT_LOG_FAILURE/);
  assert.doesNotMatch(mainHtml, /STALE_RAW_PROJECTION_SHOULD_NOT_RENDER/);
});

test('ResultsRenderer uses projection execution process instead of raw execution units in execution focus', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-projection-execution'),
      status: 'failed',
      response: 'legacy failed response',
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-projection-execution',
            currentTurn: { id: 'turn-projection-execution', prompt: 'summarize refs' },
            visibleAnswer: {
              status: 'satisfied',
              text: 'Projection-visible answer is authoritative.',
              artifactRefs: [],
            },
            artifacts: [],
            executionProcess: [{
              eventId: 'event-projection-output',
              type: 'OutputMaterialized',
              summary: 'Projection output was materialized from event log.',
              timestamp: '2026-05-13T00:00:01.000Z',
            }],
            recoverActions: [],
            verificationState: { status: 'not-required' },
            auditRefs: ['execution-unit:EU-legacy-raw'],
            diagnostics: [],
          },
        },
      },
    }],
    executionUnits: [{
      id: 'EU-legacy-raw',
      tool: 'legacy.raw.execution',
      params: '{}',
      status: 'repair-needed',
      hash: 'legacy',
      failureReason: 'LEGACY_RAW_EU_SHOULD_NOT_RENDER_IN_MAIN_EXECUTION_FOCUS',
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-projection-execution', initialFocusMode: 'execution' });
  const model = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [{ componentId: 'report-viewer', artifactRef: 'missing-report' }] as never,
    activeRun: session.runs[0],
    focusMode: 'all',
  });

  assert.match(html, /Projection 执行过程/);
  assert.match(html, /OutputMaterialized: Projection output was materialized from event log/);
  assert.doesNotMatch(html, /legacy\.raw\.execution/);
  assert.doesNotMatch(html, /LEGACY_RAW_EU_SHOULD_NOT_RENDER_IN_MAIN_EXECUTION_FOCUS/);
  assert.equal(model.viewPlan.allItems.some((item) => item.module.moduleId === 'execution-provenance-table'), false);
});

test('ResultsRenderer surfaces runtime compatibility drift without rerunning old sessions', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    messages: [{ id: 'msg-old-session', role: 'user', content: 'continue old work', createdAt: '2026-05-09T00:00:00.000Z' }],
    runtimeCompatibilityDiagnostics: [{
      schemaVersion: 1,
      id: 'runtime-drift-session-empty',
      kind: 'capability-version-drift',
      severity: 'warning',
      reason: 'Historical session contract differs from the current runtime.',
      current: {
        schemaVersion: 1,
        appStateSchemaVersion: 2,
        sessionSchemaVersion: 2,
        compatibilityVersion: 'current-runtime',
        capabilityFingerprints: ['objectReferenceKinds:abc'],
      },
      persisted: {
        schemaVersion: 1,
        appStateSchemaVersion: 2,
        sessionSchemaVersion: 2,
        compatibilityVersion: 'old-runtime',
        capabilityFingerprints: ['objectReferenceKinds:old'],
      },
      affectedSessionId: 'session-empty',
      affectedScenarioId: 'literature-evidence-review',
      recoverable: true,
      recoverableActions: ['Migrate the session payload', 'Start a new run when drift blocks safe recovery'],
      createdAt: '2026-05-09T00:00:00.000Z',
    }],
  };

  const html = renderResultsRenderer(session);

  assert.match(html, /历史 session 需要兼容性检查/);
  assert.match(html, /capability-version-drift/);
  assert.match(html, /Historical session contract differs/);
  assert.match(html, /persisted: old-runtime/);
  assert.match(html, /Migrate the session payload/);
  assert.doesNotMatch(html, /正在重新运行|auto.?resume/i);
});

test('ResultsRenderer does not let raw running progress drive the main summary without projection', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...completedRun('run-partial-first'),
      status: 'running',
      response: 'partial report is available',
      raw: {
        backgroundCompletion: {
          status: 'running',
          stages: [
            { stageId: 'metadata', status: 'completed', ref: 'run:run-partial-first#metadata' },
            { stageId: 'fulltext', status: 'running', ref: 'run:run-partial-first#fulltext' },
          ],
        },
        resultPresentation: {
          processSummary: { status: 'running', currentStage: 'fulltext', summary: 'Partial report is available.' },
          nextActions: [{ kind: 'continue', label: 'Use completed refs', ref: 'artifact:partial-report' }],
        },
      },
      objectReferences: [{ kind: 'artifact', id: 'obj-partial-report', ref: 'artifact:partial-report', title: 'Partial report' }] as never,
    }],
    executionUnits: [
      { id: 'EU-metadata', tool: 'metadata.fetch', params: '{}', status: 'done', hash: 'metadata', outputRef: 'artifact:partial-report' },
      { id: 'EU-fulltext', tool: 'fulltext.download', params: '{}', status: 'running', hash: 'fulltext', stdoutRef: 'run:run-partial-first/fulltext.log' },
    ],
    artifacts: [{
      id: 'partial-report',
      type: 'report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Partial report', runId: 'run-partial-first' },
    }],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-partial-first' });

  assert.match(html, /本轮没有生成可展示 artifact/);
  assert.doesNotMatch(html, /report: Partial report/);
  assert.doesNotMatch(html, /已有部分结果，后台仍在继续/);
  assert.doesNotMatch(html, /当前阶段：stage fulltext · running|当前阶段：fulltext · running/);
  assert.doesNotMatch(html, /safe · 安全中止当前后台任务/);
  assert.doesNotMatch(html, /safe · Use completed refs/);
});

test('ResultsRenderer execution focus renders only execution unit body', () => {
  const session = contractFailureSession();
  session.notebook = [{
    id: 'note-1',
    scenario: 'literature-evidence-review',
    time: '2026-05-09 00:01',
    title: 'Notebook note',
    desc: 'should be hidden in execution focus',
    claimType: 'fact',
    confidence: 0.4,
  }];

  const html = renderResultsRenderer(session, { activeRunId: 'run-contract-failure', initialFocusMode: 'execution' });

  assert.match(html, /可复现执行单元/);
  assert.match(html, /Repair needed/);
  assert.doesNotMatch(html, /<h2>结果视图<\/h2>/);
  assert.doesNotMatch(html, /运行需要处理/);
  assert.doesNotMatch(html, /Notebook note/);
  assert.doesNotMatch(html, /Raw JSON \/ stdout \/ stderr refs/);
  assert.doesNotMatch(html, /视图状态/);
});

test('ResultsRenderer execution focus shows background artifact stages as execution units', () => {
  const session = applyBackgroundCompletionEventToSession(emptySession(), {
    contract: 'sciforge.background-completion.v1',
    type: 'background-stage-update',
    runId: 'run-bg-render',
    stageId: 'stage-report',
    ref: 'run:run-bg-render#stage-report',
    status: 'running',
    message: '后台 report artifact 已写入。',
    artifacts: [{
      id: 'artifact-bg-render-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: '# Background report' },
    }],
    verificationResults: [{ id: 'verify-bg-render', verdict: 'pass' }],
    updatedAt: '2026-05-09T00:02:00.000Z',
  });

  const html = renderResultsRenderer(session, { activeRunId: 'run-bg-render', initialFocusMode: 'execution' });

  assert.match(html, /EU-run-bg-render-stage-report/);
  assert.match(html, /sciforge\.background-completion/);
  assert.match(html, /Running/);
  assert.match(html, /output=run:run-bg-render#stage-report/);
  assert.match(html, /verification:verify-bg-render/);
  assert.match(html, /verdict=pass/);
});

test('ResultsRenderer execution table separates verification states from completed status', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [completedRun('run-verification-states')],
    executionUnits: [
      { id: 'EU-ordinary', tool: 'report.emit', params: '{}', status: 'done', hash: 'ordinary', outputRef: 'run:run-verification-states#ordinary' },
      { id: 'EU-unverified', tool: 'report.emit', params: '{}', status: 'done', hash: 'unverified', outputRef: 'run:run-verification-states#unverified', verificationVerdict: 'unverified', verificationRef: 'verification:unverified' },
      { id: 'EU-verifying', tool: 'report.emit', params: '{}', status: 'running', hash: 'verifying', outputRef: 'run:run-verification-states#partial' },
      { id: 'EU-verification-failed', tool: 'verifier.run', params: '{}', status: 'done', hash: 'failed', outputRef: 'run:run-verification-states#failed', verificationVerdict: 'fail', verificationRef: 'verification:failed' },
      { id: 'EU-release-verified', tool: 'verifier.run', params: '{}', status: 'done', hash: 'passed', outputRef: 'run:run-verification-states#passed', verificationVerdict: 'pass', verificationRef: 'verification:passed' },
    ],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-verification-states', initialFocusMode: 'execution' });

  assert.match(html, /No verification requested/);
  assert.match(html, /Unverified/);
  assert.match(html, /Verifying/);
  assert.match(html, /Verification failed/);
  assert.match(html, /Verification passed/);
  assert.match(html, /verificationStatus=ordinary result; no runtime verification verdict was recorded/);
  assert.match(html, /verificationStatus=result is explicitly unverified ref=verification:unverified/);
  assert.match(html, /verificationStatus=background verification is still running/);
  assert.match(html, /verificationStatus=verification failed ref=verification:failed/);
  assert.match(html, /verificationStatus=release verification passed ref=verification:passed/);
});

test('ResultsRenderer execution focus scopes execution units to the active run', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [
      {
        ...completedRun('run-old'),
        objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report' }],
      },
      {
        ...completedRun('run-new'),
        objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
      },
    ] as never,
    executionUnits: [
      { id: 'EU-old', tool: 'old.tool', params: '{}', status: 'done', hash: 'old', outputRef: 'run:run-old#old-report' },
      { id: 'EU-new', tool: 'new.tool', params: '{}', status: 'done', hash: 'new', outputRef: 'run:run-new#new-report' },
    ],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-old', initialFocusMode: 'execution' });

  assert.match(html, /EU-old/);
  assert.match(html, /old\.tool/);
  assert.doesNotMatch(html, /EU-new/);
  assert.doesNotMatch(html, /new\.tool/);
});

test('ResultsRenderer failed run audit renders execution units from failed payload', () => {
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      id: 'run-failed-payload',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'probe page',
      response: 'failed-with-reason',
      createdAt: '2026-05-12T00:00:00.000Z',
      completedAt: '2026-05-12T00:01:00.000Z',
      raw: {
        payload: {
          executionUnits: [{
            id: 'EU-failed-payload',
            tool: 'web.probe',
            params: '{}',
            status: 'failed-with-reason',
            hash: 'failed-payload',
            outputRef: 'run:run-failed-payload#EU-failed-payload',
            failureReason: 'probe failed before rendering',
          }],
        },
      },
    }],
    executionUnits: [],
  };

  const html = renderResultsRenderer(session, { activeRunId: 'run-failed-payload' });

  assert.match(html, /主结果等待 ConversationProjection/);
  assert.doesNotMatch(html, /运行需要处理/);
  assert.match(html, /1 EU/);
  assert.match(html, /EU-failed-payload/);
  assert.match(html, /web\.probe/);
  assert.match(html, /probe failed before rendering/);
  assert.doesNotMatch(html, /等待真实 ExecutionUnit/);
  assert.doesNotMatch(html, /0 EU/);
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

test('registry slot renders unknown component fallback with artifact diagnostics', () => {
  const html = renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session: emptySession(),
    item: {
      id: 'slot-unknown',
      slot: {
        componentId: 'missing-widget',
        artifactRef: 'ghost-artifact',
        title: 'Custom fallback slot',
      },
      section: 'primary',
      status: 'missing-artifact',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }));

  assert.match(html, /Custom fallback slot/);
  assert.match(html, /missing-widget/);
  assert.match(html, /artifactRef 未找到：ghost-artifact/);
  assert.match(html, /no runtime artifact/);
});

test('registry slot uses unknown component artifact fallback without dropping artifact payload context', () => {
  const artifact: RuntimeArtifact = {
    id: 'fallback-table',
    type: 'runtime-artifact',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/fallback-table.json',
    data: {
      rows: [
        { gene: 'TP53', score: 0.91 },
        { gene: 'BRCA1', score: 0.77 },
      ],
      downloads: [{
        name: 'fallback-table.csv',
        contentType: 'text/csv',
        content: 'gene,score\nTP53,0.91',
        rowCount: 2,
      }],
    },
  };
  const session = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const html = renderToStaticMarkup(createElement(RegistrySlot, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    item: {
      id: 'slot-unknown-existing-artifact',
      slot: {
        componentId: 'lab-specific-widget',
        artifactRef: 'fallback-table',
        title: 'Lab-specific table',
      },
      artifact,
      section: 'primary',
      status: 'fallback',
      source: 'manifest',
      module: {},
    } as never,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
  }));

  assert.match(html, /Lab-specific table/);
  assert.match(html, /lab-specific-widget/);
  assert.match(html, /runtime-artifact/);
  assert.match(html, /dataRef: \.sciforge\/artifacts\/fallback-table\.json/);
  assert.match(html, /fallback-table\.csv · 2 rows/);
  assert.match(html, /TP53/);
  assert.doesNotMatch(html, /artifactRef 未找到/);
  assert.doesNotMatch(html, /no runtime artifact/);
});

test('ResultsRenderer explains missing artifact fields through the package empty-state fallback', () => {
  const artifact: RuntimeArtifact = {
    id: 'broken-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-broken-report' },
    data: { notes: 'contract drift: markdown was not produced' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
    runs: [completedRun('run-broken-report')],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'broken-report', title: 'Report' }],
  };
  const html = renderResultsRenderer(session, { activeRunId: 'run-broken-report' });

  assert.match(html, /Markdown report document/);
  assert.match(html, /research-report · broken-report/);
  assert.match(html, /Awaiting research-report/);
  assert.match(html, /当前 research-report 缺少 markdown\/report\/sections 字段/);
  assert.match(html, /artifact 缺少模块必需字段/);
  assert.doesNotMatch(html, /contract drift: markdown was not produced/);
});

test('ResultsRenderer falls back from mismatched manifest component to artifact-owned report renderer', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-owned-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-mismatch' },
    data: { markdown: '# Artifact-owned report\n\nThe report renderer should own this payload.' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
    runs: [completedRun('run-mismatch')],
    uiManifest: [{
      componentId: 'paper-card-list',
      artifactRef: 'report-owned-artifact',
      title: 'Backend requested paper cards',
    }],
  };
  const html = renderResultsRenderer(session, { activeRunId: 'run-mismatch' });
  const model = createResultsRendererViewModel({
    scenarioId: 'literature-evidence-review',
    session,
    defaultSlots: [],
    activeRun: session.runs[0],
    focusMode: 'all',
  });

  assert.match(html, /Artifact-owned report/);
  assert.match(html, /The report renderer should own this payload/);
  assert.doesNotMatch(html, /当前 paper-list artifact 缺少 papers\/rows 数组/);
  assert.ok(model.viewPlan.diagnostics.some((item) => item.includes('paper-card-list -> research-report 已改由 report-viewer 渲染')));
  assert.ok(model.viewPlan.allItems.some((item) => item.slot.componentId === 'report-viewer' && item.artifact?.id === 'report-owned-artifact'));
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

test('object reference action helper resolves pin and workspace path plans without UI state', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: '.sciforge/artifacts/report.md',
    data: { markdown: '# Report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
  };
  const reference: ObjectReference = {
    id: 'ref-report',
    title: 'Report artifact',
    kind: 'artifact',
    ref: 'artifact:report-artifact',
    artifactType: 'research-report',
    actions: ['pin', 'copy-path', 'open-external'],
  };
  const olderPins = ['a', 'b', 'c', 'd'].map((id): ObjectReference => ({
    id,
    title: id,
    kind: 'file',
    ref: `file:${id}.txt`,
  }));

  assert.deepEqual(nextPinnedObjectReferences(olderPins, reference).map((item) => item.id), ['b', 'c', 'd', 'ref-report']);
  assert.deepEqual(nextPinnedObjectReferences([reference], reference), []);

  const pinPlan = resolveObjectReferenceActionPlan({
    action: 'pin',
    pinnedObjectReferences: olderPins,
    reference,
    session,
  });
  if (pinPlan.kind !== 'pin') assert.fail(`Expected pin plan, got ${pinPlan.kind}`);
  assert.equal(pinPlan.pinnedObjectReferences.at(-1)?.id, 'ref-report');

  const copyPlan = resolveObjectReferenceActionPlan({
    action: 'copy-path',
    pinnedObjectReferences: [],
    reference,
    session,
  });
  if (copyPlan.kind !== 'copy-path') assert.fail(`Expected copy-path plan, got ${copyPlan.kind}`);
  assert.equal(copyPlan.path, '.sciforge/artifacts/report.md');
  assert.equal(copyPlan.notice, '已复制路径：.sciforge/artifacts/report.md');
});

test('artifact inspector drawer renders lineage, reproducible refs, preview, and handoff targets', () => {
  const artifact: RuntimeArtifact = {
    id: 'report-artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/report.json',
    metadata: {
      producerSkillId: 'report.writer',
      createdAt: '2026-05-09T00:00:00.000Z',
      handoffTargets: ['structure-exploration'],
      derivation: {
        schemaVersion: 'sciforge.artifact-derivation.v1',
        kind: 'summary',
        parentArtifactRef: 'artifact:source-report',
        sourceRefs: ['artifact:source-report', 'provider:openalex:openalex-w1'],
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        verificationStatus: 'unverified',
      },
    },
    data: { markdown: '# Inspector report' },
  };
  const session: SciForgeSession = {
    ...emptySession(),
    artifacts: [artifact],
    executionUnits: [{
      id: 'EU-inspector',
      tool: 'report.generate',
      params: '{}',
      status: 'done',
      hash: 'hash-inspector',
      artifacts: ['report-artifact'],
      codeRef: '.sciforge/runs/EU-inspector/code.ts',
      stdoutRef: '.sciforge/runs/EU-inspector/stdout.txt',
      outputRef: 'artifact:report-artifact',
    }],
  };
  const html = renderToStaticMarkup(createElement(ArtifactInspectorDrawer, {
    scenarioId: 'literature-evidence-review',
    session,
    artifact,
    onClose: () => undefined,
    onArtifactHandoff: () => undefined,
  }));

  assert.match(html, /Artifact Inspector/);
  assert.match(html, /report-artifact/);
  assert.match(html, /producer skill: report.writer/);
  assert.match(html, /execution unit: EU-inspector · report.generate · done/);
  assert.match(html, /derivation kind: summary/);
  assert.match(html, /derivation parent: artifact:source-report/);
  assert.match(html, /derivation sources: artifact:source-report, provider:openalex:openalex-w1/);
  assert.match(html, /dataRef: \.sciforge\/artifacts\/report\.json/);
  assert.match(html, /stdoutRef: \.sciforge\/runs\/EU-inspector\/stdout\.txt/);
  assert.match(html, /Inspector report/);
  assert.match(html, /结构探索/);
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
          sourceRunId: 'run-contract-failure',
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
            sourceRunId: 'run-contract-failure',
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

function completedRun(id: string): SciForgeRun {
  return {
    id,
    scenarioId: 'literature-evidence-review',
    status: 'completed' as const,
    prompt: 'render result',
    response: 'completed',
    createdAt: '2026-05-09T00:00:00.000Z',
    completedAt: '2026-05-09T00:01:00.000Z',
  };
}

function renderResultsRenderer(session: SciForgeSession, options: { activeRunId?: string; initialFocusMode?: 'all' | 'visual' | 'evidence' | 'execution' } = {}) {
  return renderToStaticMarkup(createElement(ResultsRenderer, {
    scenarioId: 'literature-evidence-review',
    config: testConfig(),
    session,
    defaultSlots: [],
    onArtifactHandoff: () => undefined,
    collapsed: false,
    onToggleCollapse: () => undefined,
    activeRunId: options.activeRunId,
    onActiveRunChange: () => undefined,
    onFocusedObjectChange: () => undefined,
    workspaceFileEditor: null,
    onWorkspaceFileEditorChange: () => undefined,
    initialFocusMode: options.initialFocusMode,
  }));
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
