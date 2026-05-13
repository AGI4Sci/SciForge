import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backendRepairStates,
  contractValidationFailures,
  failedExecutionUnits,
  rawAuditItems,
  runAuditBlockers,
  runAuditRefs,
  runPresentationState,
  runRecoverActions,
  shouldOpenRunAuditDetails,
} from './results-renderer-execution-model';
import type { SciForgeSession } from '../domain';

test('results renderer execution model projects failure audit data without React rendering', () => {
  const session = executionFailureSession();
  const activeRun = session.runs[0];
  const failures = contractValidationFailures(session, activeRun);
  const repairStates = backendRepairStates(session, activeRun);

  assert.equal(shouldOpenRunAuditDetails(session, activeRun), true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.failureKind, 'artifact-schema');
  assert.deepEqual(runRecoverActions(session, activeRun), [
    'regenerate report artifact',
    'rerun validator',
  ]);
  assert.ok(runAuditRefs(session, activeRun).includes('artifact:bad-report'));
  assert.ok(runAuditBlockers(session, activeRun).some((line) => line.includes('ContractValidationFailure(artifact-schema)')));
  assert.equal(repairStates[0]?.label, 'backendRepair');
  assert.ok(repairStates[0]?.refs.includes('log:repair-stderr'));
  assert.equal(rawAuditItems(session, activeRun, { allItems: [] } as never).some((item) => item.id === 'execution-units'), true);
});

test('results renderer execution model normalizes response JSON failures and refs', () => {
  const session = responseFailureSession();
  const activeRun = session.runs[0];
  const failures = contractValidationFailures(session, activeRun);

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.failureKind, 'unknown');
  assert.equal(failures[0]?.failureReason, 'citation URI is unavailable');
  assert.deepEqual(failures[0]?.relatedRefs, [
    'artifact:evidence-matrix',
    'artifact:missing-citation',
    'agentserver://run/citation-404',
  ]);
  assert.deepEqual(runRecoverActions(session, activeRun), ['repair citations']);
  assert.deepEqual(runAuditRefs(session, activeRun), [
    'artifact:evidence-matrix',
    'artifact:missing-citation',
    'agentserver://run/citation-404',
  ]);
});

test('results renderer execution model scopes failure units through active run artifact refs', () => {
  const session = executionFailureSession();
  session.runs.push({
    id: 'run-other',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'other report',
    response: '',
    createdAt: '2026-05-10T00:02:00.000Z',
      objectReferences: [{ kind: 'artifact', ref: 'artifact:other-report', title: 'other report', runId: 'run-other' }],
  } as never);
  session.runs[0]!.objectReferences = [{ kind: 'artifact', ref: 'artifact:bad-report', title: 'bad report', runId: 'run-execution-model' }] as never;
  session.executionUnits.push({
    id: 'EU-other',
    tool: 'report.validate',
    params: '{}',
    status: 'repair-needed',
    hash: 'hash-other',
    outputRef: 'artifact:other-report',
    recoverActions: ['wrong run action'],
  });

  const failures = runAuditBlockers(session, session.runs[0]);
  const refs = runAuditRefs(session, session.runs[0]);
  const recoverActions = runRecoverActions(session, session.runs[0]);

  assert.ok(failures.some((line) => line.includes('EU-report')));
  assert.ok(refs.includes('artifact:bad-report'));
  assert.equal(refs.includes('artifact:other-report'), false);
  assert.equal(recoverActions.includes('wrong run action'), false);
});

test('results renderer execution model does not call completed empty runs ready', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-empty-result',
    scenarioId: 'literature-evidence-review',
    title: 'empty result',
    createdAt: '2026-05-10T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-empty-result',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'search papers',
      response: 'completed',
      createdAt: '2026-05-10T00:00:00.000Z',
      completedAt: '2026-05-10T00:01:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-10T00:01:00.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'empty');
  assert.equal(state.title, '本轮没有生成可展示 artifact');
  assert.match(state.reason, /没有写入可供右侧结果区渲染的 artifact/);
});

test('results renderer execution model treats cited historical execution units as context refs, not current blockers', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-direct-context-history',
    scenarioId: 'literature-evidence-review',
    title: 'direct context history',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-direct-context',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'summarize refs without rerun',
      response: 'direct context summary',
      createdAt: '2026-05-13T00:00:00.000Z',
      completedAt: '2026-05-13T00:00:10.000Z',
      objectReferences: [
        { id: 'obj-summary', kind: 'artifact', title: 'summary', ref: 'artifact:direct-context-summary' },
        { id: 'obj-old-eu', kind: 'execution-unit', title: 'old failed unit', ref: 'execution-unit:EU-old-failed' },
      ] as never,
      raw: {
        payload: {
          message: 'Context cites artifact:old-runtime-diagnostic and execution-unit:EU-old-failed for audit only.',
          executionUnits: [{
            id: 'EU-direct-context',
            tool: 'sciforge.direct-context-fast-path',
            params: '{}',
            status: 'done',
            hash: 'direct-context',
            outputRef: 'artifact:direct-context-summary',
          }],
          artifacts: [{
            id: 'direct-context-summary',
            type: 'research-report',
            data: { markdown: 'Existing refs summarized.' },
          }],
          refs: ['artifact:old-runtime-diagnostic', 'execution-unit:EU-old-failed'],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-old-failed',
      tool: 'agentserver.generate',
      params: '{}',
      status: 'repair-needed',
      hash: 'old-failed',
      outputRef: 'artifact:old-runtime-diagnostic',
      failureReason: 'Historical AgentServer convergence guard.',
      recoverActions: ['inspect old diagnostic'],
    }],
    artifacts: [
      {
        id: 'direct-context-summary',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        data: { markdown: 'Existing refs summarized.' },
      },
      {
        id: 'old-runtime-diagnostic',
        type: 'runtime-diagnostic',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        data: { markdown: 'Old failed run.' },
      },
    ],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-old-failed'), false);
  assert.equal(state.kind, 'ready');
  assert.ok(state.availableArtifacts.some((artifact) => artifact.id === 'direct-context-summary'));

  const compactedSession = structuredClone(session);
  compactedSession.runs[0]!.raw = {
    refs: ['artifact:old-runtime-diagnostic', 'execution-unit:EU-old-failed'],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'direct-context-summary' }],
  };
  compactedSession.runs[0]!.objectReferences = [
    { id: 'obj-old-artifact', kind: 'artifact', title: 'old diagnostic', ref: 'artifact:old-runtime-diagnostic' },
  ] as never;

  assert.equal(failedExecutionUnits(compactedSession, compactedSession.runs[0]).some((unit) => unit.id === 'EU-old-failed'), false);
  const compactedState = runPresentationState(compactedSession, compactedSession.runs[0]);
  assert.equal(compactedState.kind, 'ready');
  assert.equal(compactedState.availableArtifacts.some((artifact) => artifact.id === 'direct-context-summary'), true);
  assert.equal(compactedState.availableArtifacts.some((artifact) => artifact.id === 'old-runtime-diagnostic'), false);
  assert.deepEqual(runRecoverActions(compactedSession, compactedSession.runs[0]), []);
  assert.equal(shouldOpenRunAuditDetails(compactedSession, compactedSession.runs[0]), false);
});

test('results renderer execution model ignores historical repair state on completed context-only runs', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-direct-context-old-repair',
    scenarioId: 'literature-evidence-review',
    title: 'direct context old repair',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-direct-context',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'summarize refs without rerun',
      response: 'direct context summary',
      createdAt: '2026-05-13T00:00:00.000Z',
      completedAt: '2026-05-13T00:00:10.000Z',
      objectReferences: [
        { id: 'obj-direct-eu', kind: 'execution-unit', title: 'direct context', ref: 'runtime://direct-context-fast-path' },
      ] as never,
      raw: {
        refs: ['artifact:old-runtime-diagnostic'],
        backendRepair: {
          sourceRunId: 'run-old',
          status: 'failed-with-reason',
          failureReason: 'Old AgentServer convergence guard.',
          recoverActions: ['inspect old repair stderr'],
          refs: [{ ref: 'log:old-repair-stderr' }],
        },
        backgroundCompletion: {
          runId: 'run-old',
          status: 'failed',
          stages: [{ stageId: 'old', status: 'failed', failureReason: 'old failed stage' }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'old-runtime-diagnostic',
      type: 'runtime-diagnostic',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: 'Old failed run.' },
    }],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'empty');
  assert.equal(state.availableArtifacts.some((artifact) => artifact.id === 'old-runtime-diagnostic'), false);
  assert.deepEqual(backendRepairStates(session, session.runs[0]), []);
  assert.deepEqual(runRecoverActions(session, session.runs[0]), []);
  assert.equal(runAuditBlockers(session, session.runs[0]).some((line) => line.includes('Old AgentServer')), false);
  assert.equal(shouldOpenRunAuditDetails(session, session.runs[0]), false);
});

test('results renderer execution model scopes failed direct-context runs by structured payload ownership', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-direct-context-failed-scoped',
    scenarioId: 'literature-evidence-review',
    title: 'direct context failed scoped',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-direct-context-failed',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'answer from refs only',
      response: 'missing expected artifacts',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        refs: ['artifact:old-runtime-diagnostic', 'execution-unit:EU-old-failed'],
        resultPresentation: {
          failureReason: 'Historical AgentServer convergence guard from compacted raw.',
          nextActions: [{ label: 'inspect old raw stderr' }],
        },
        executionUnits: [{
          id: 'EU-old-embedded',
          tool: 'agentserver.generate',
          params: '{}',
          status: 'repair-needed',
          hash: 'old-embedded',
          outputRef: 'artifact:old-runtime-diagnostic',
          failureReason: 'Historical embedded convergence guard.',
          recoverActions: ['inspect old embedded diagnostic'],
        }],
        payload: {
          executionUnits: [{
            id: 'EU-direct-context-missing',
            tool: 'sciforge.direct-context-fast-path',
            params: '{}',
            status: 'repair-needed',
            hash: 'direct-context-missing',
            outputRef: 'runtime://direct-context-fast-path',
            failureReason: 'Missing expected artifacts: evidence-matrix',
          }],
          artifacts: [{
            id: 'direct-context-summary',
            type: 'runtime-diagnostic',
            metadata: { source: 'direct-context-fast-path' },
            data: { markdown: 'Missing expected artifacts: evidence-matrix' },
          }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-old-failed',
      tool: 'agentserver.generate',
      params: '{}',
      status: 'repair-needed',
      hash: 'old-failed',
      outputRef: 'artifact:old-runtime-diagnostic',
      failureReason: 'Historical AgentServer convergence guard.',
      recoverActions: ['inspect old diagnostic'],
    }],
    artifacts: [
      {
        id: 'direct-context-summary',
        type: 'runtime-diagnostic',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        data: { markdown: 'Missing expected artifacts: evidence-matrix' },
      },
      {
        id: 'old-runtime-diagnostic',
        type: 'runtime-diagnostic',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        data: { markdown: 'Old failed run.' },
      },
    ],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const blockers = runAuditBlockers(session, session.runs[0]);
  const state = runPresentationState(session, session.runs[0]);

  assert.equal(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-old-failed'), false);
  assert.equal(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-old-embedded'), false);
  assert.ok(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-direct-context-missing'));
  assert.equal(blockers.some((line) => line.includes('Historical AgentServer')), false);
  assert.equal(blockers.some((line) => line.includes('Historical embedded')), false);
  assert.equal(state.kind, 'recoverable');
  assert.equal(state.reason, 'Missing expected artifacts: evidence-matrix');
  assert.equal(state.nextSteps.includes('inspect old raw stderr'), false);
  assert.equal(runRecoverActions(session, session.runs[0]).includes('inspect old embedded diagnostic'), false);
  assert.equal(state.availableArtifacts.some((artifact) => artifact.id === 'old-runtime-diagnostic'), false);
});

test('results renderer execution model keeps current-run repair state scoped to the active run', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-current-repair',
    scenarioId: 'literature-evidence-review',
    title: 'current repair',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-current',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'repair current run',
      response: 'repair needed',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        backendRepair: {
          sourceRunId: 'run-current',
          status: 'failed-with-reason',
          failureReason: 'Current artifact contract failed.',
          recoverActions: ['regenerate current artifact'],
          refs: [{ ref: 'log:current-repair' }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'recoverable');
  assert.deepEqual(runRecoverActions(session, session.runs[0]), ['regenerate current artifact']);
  assert.ok(runAuditBlockers(session, session.runs[0]).some((line) => line.includes('Current artifact contract failed')));
});

test('results renderer execution model surfaces partial-first progress for running runs', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-running-partial',
    scenarioId: 'literature-evidence-review',
    title: 'running partial',
    createdAt: '2026-05-10T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-running-partial',
      scenarioId: 'literature-evidence-review',
      status: 'running',
      prompt: 'long task',
      response: 'partial response is available',
      createdAt: '2026-05-10T00:00:00.000Z',
      raw: {
        backgroundCompletion: {
          contract: 'sciforge.background-completion.v1',
          runId: 'run-running-partial',
          status: 'running',
          stages: [
            { stageId: 'metadata', status: 'completed', ref: 'run:run-running-partial#metadata', artifactRefs: ['artifact:partial-report'] },
            { stageId: 'fulltext', status: 'running', ref: 'run:run-running-partial#fulltext' },
          ],
        },
        resultPresentation: {
          processSummary: { status: 'running', currentStage: 'fulltext', summary: 'Partial report is available while full text is still downloading.' },
          nextActions: [{ kind: 'continue', label: 'Use completed metadata refs only', ref: 'artifact:partial-report' }],
        },
      },
      objectReferences: [{ kind: 'artifact', id: 'obj-partial-report', ref: 'artifact:partial-report', title: 'Partial report' }] as never,
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [
      { id: 'EU-metadata', tool: 'metadata.fetch', params: '{}', status: 'done', hash: 'hash-metadata', outputRef: 'artifact:partial-report' },
      { id: 'EU-fulltext', tool: 'fulltext.download', params: '{}', status: 'running', hash: 'hash-fulltext', stdoutRef: 'run:run-running-partial/fulltext.log' },
    ],
    artifacts: [{
      id: 'partial-report',
      type: 'report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Partial report', runId: 'run-running-partial' },
    }],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-10T00:01:00.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'partial');
  assert.match(state.title, /已有部分结果/);
  assert.ok(state.availableArtifacts.some((artifact) => artifact.id === 'partial-report'));
  assert.ok(state.progress?.completedParts.some((part) => part.ref === 'artifact:partial-report'));
  assert.equal(state.progress?.currentStage?.id, 'fulltext');
  assert.equal(state.progress?.backgroundStatus, 'running');
  assert.ok(state.progress?.safeActions.some((action) => action.kind === 'cancel' && action.safe));
  assert.ok(state.progress?.safeActions.some((action) => action.kind === 'continue' && action.ref === 'artifact:partial-report'));
});

test('results renderer execution model separates needs-human from empty artifacts', () => {
  const session = responseFailureSession();
  session.runs[0]!.status = 'completed';
  session.runs[0]!.response = 'needs-human: choose one provider credential before retry';
  session.runs[0]!.raw = {
    displayIntent: {
      resultPresentation: {
        status: 'needs-human',
        processSummary: { status: 'needs-human', summary: 'Provider credentials are missing.' },
        nextActions: [{ label: 'Add provider credential', kind: 'ask-user' }],
        artifactActions: [],
      },
    },
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'needs-human');
  assert.match(state.title, /人工/);
  assert.match(state.reason, /Provider credentials are missing/);
  assert.ok(state.nextSteps.includes('Add provider credential'));
});

test('results renderer execution model rejects unowned embedded payload units and artifacts', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-unowned-payload',
    scenarioId: 'literature-evidence-review',
    title: 'unowned payload',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-current',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'summarize current result',
      response: 'done',
      createdAt: '2026-05-13T00:00:00.000Z',
      raw: {
        payload: {
          executionUnits: [{
            id: 'EU-old-embedded',
            tool: 'old.tool',
            params: '{}',
            status: 'repair-needed',
            hash: 'old',
            outputRef: 'artifact:old-report',
            failureReason: 'old embedded failure',
          }],
          message: JSON.stringify({
            artifacts: [{ id: 'old-message-artifact', type: 'runtime-diagnostic', data: { markdown: 'old body' } }],
          }),
          artifacts: [{ id: 'old-report', type: 'runtime-diagnostic', data: { markdown: 'old body' } }],
        },
      },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'old-report',
      type: 'runtime-diagnostic',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: 'old body' },
    }],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-old-embedded'), false);
  assert.equal(state.availableArtifacts.some((artifact) => artifact.id === 'old-report'), false);
  assert.equal(state.availableArtifacts.some((artifact) => artifact.id === 'old-message-artifact'), false);
});

test('results renderer execution model uses strict run ref boundaries', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-run-ref-collision',
    scenarioId: 'literature-evidence-review',
    title: 'run ref collision',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [
      { id: 'run-1', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'current', response: 'done', createdAt: '2026-05-13T00:00:00.000Z' },
      { id: 'run-10', scenarioId: 'literature-evidence-review', status: 'failed', prompt: 'other', response: 'failed', createdAt: '2026-05-13T00:01:00.000Z' },
    ],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-run-10',
      tool: 'other.tool',
      params: '{}',
      status: 'repair-needed',
      hash: 'other',
      outputRef: 'run:run-10#artifact',
      failureReason: 'other run failed',
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:01:00.000Z',
  };

  assert.equal(failedExecutionUnits(session, session.runs[0]).some((unit) => unit.id === 'EU-run-10'), false);
});

test('raw audit items are scoped and body-sanitized', () => {
  const session = executionFailureSession();
  session.artifacts = [
    {
      id: 'current-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { runId: 'run-execution-model' },
      data: { markdown: 'current report body' },
    },
    {
      id: 'other-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { runId: 'run-other' },
      data: { markdown: 'other report body' },
    },
  ];
  session.runs[0]!.raw = {
    status: 'failed',
    rawProviderPayload: { body: 'SECRET RAW BODY', refs: ['artifact:current-report'] },
  };

  const items = rawAuditItems(session, session.runs[0], { allItems: [] } as never);
  const artifactItem = items.find((item) => item.id === 'artifacts');
  const runItem = items.find((item) => item.id === `run-${session.runs[0]!.id}`);

  assert.match(artifactItem?.value ?? '', /current-report/);
  assert.doesNotMatch(artifactItem?.value ?? '', /other-report/);
  assert.doesNotMatch(artifactItem?.value ?? '', /current report body/);
  assert.doesNotMatch(runItem?.value ?? '', /SECRET RAW BODY/);
  assert.match(runItem?.value ?? '', /body-carrier/);
});

test('presentation state ignores natural-language partial and needs-human words without structured status', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-text-only-status',
    scenarioId: 'literature-evidence-review',
    title: 'text only',
    createdAt: '2026-05-13T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-text-only',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'write report',
      response: 'The report mentions missing follow-up inputs and human review as discussion topics.',
      createdAt: '2026-05-13T00:00:00.000Z',
      objectReferences: [{ id: 'obj-report', kind: 'artifact', title: 'report', ref: 'artifact:report', runId: 'run-text-only' }] as never,
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { runId: 'run-text-only' },
      data: { markdown: 'missing and human input are merely report content.' },
    }],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-13T00:00:10.000Z',
  };

  const state = runPresentationState(session, session.runs[0]);

  assert.equal(state.kind, 'ready');
});

function executionFailureSession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-execution-model',
    scenarioId: 'literature-evidence-review',
    title: 'execution model',
    createdAt: '2026-05-10T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-execution-model',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'render report',
      response: '',
      createdAt: '2026-05-10T00:00:00.000Z',
      completedAt: '2026-05-10T00:01:00.000Z',
      raw: {
        contractValidationFailure: {
          contract: 'sciforge.contract-validation-failure.v1',
          schemaPath: '/artifacts/0/data',
          contractId: 'research-report.v1',
          capabilityId: 'report-viewer',
          failureKind: 'artifact-schema',
          failureReason: 'report markdown is missing',
          recoverActions: ['regenerate report artifact'],
          relatedRefs: ['artifact:bad-report'],
          issues: [{ path: '/data/markdown', message: 'required' }],
        },
        backendRepair: {
          status: 'failed-with-reason',
          repairRunId: 'repair-1',
          recoverActions: ['rerun validator'],
          refs: [{ ref: 'log:repair-stderr' }],
          stages: [{ status: 'failed', stageId: 'validate', failureReason: 'schema mismatch' }],
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
      outputRef: 'artifact:bad-report',
    }],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-10T00:01:00.000Z',
  };
}

function responseFailureSession(): SciForgeSession {
  const responseFailure = {
    contract: 'sciforge.contract-validation-failure.v1',
    schemaPath: '/citations/1',
    contractId: 'citation-check.v1',
    capabilityId: 'citation-verifier',
    failureKind: 'provider-outage',
    message: 'citation URI is unavailable',
    recoverActions: ['repair citations'],
    relatedRefs: ['artifact:evidence-matrix'],
    invalidRefs: ['artifact:missing-citation'],
    unresolvedUris: ['agentserver://run/citation-404'],
    issues: [{ invalidRef: 'artifact:missing-citation', detail: 'not found' }],
  };
  return {
    schemaVersion: 2,
    sessionId: 'session-response-failure',
    scenarioId: 'literature-evidence-review',
    title: 'response failure',
    createdAt: '2026-05-10T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-response-failure',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'verify citations',
      response: JSON.stringify({ contractValidationFailures: [responseFailure] }),
      createdAt: '2026-05-10T00:00:00.000Z',
      raw: { contractValidationFailure: responseFailure },
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-10T00:01:00.000Z',
  };
}
