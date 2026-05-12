import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backendRepairStates,
  contractValidationFailures,
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
    objectReferences: [{ kind: 'artifact', ref: 'artifact:other-report', title: 'other report' }],
  } as never);
  session.runs[0]!.objectReferences = [{ kind: 'artifact', ref: 'artifact:bad-report', title: 'bad report' }] as never;
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
