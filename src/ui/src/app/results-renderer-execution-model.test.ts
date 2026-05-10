import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backendRepairStates,
  contractValidationFailures,
  rawAuditItems,
  runAuditBlockers,
  runAuditRefs,
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
