import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SciForgeSession } from '../../domain';
import {
  compactVisibleFailureText,
  requestOpenDebugAuditThroughUserActionApi,
  requestRecoverCommandTextAction,
} from './primaryAuditAdapter';

function sessionFixture(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-audit-adapter',
    scenarioId: 'research' as never,
    title: 'Audit adapter fixture',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-audit',
      scenarioId: 'research' as never,
      status: 'failed',
      prompt: 'repair',
      response: '',
      createdAt: '2026-06-01T00:01:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
  };
}

test('primary audit adapter owns audit rendering and action bridge extraction', () => {
  const adapterSource = readFileSync(new URL('./primaryAuditAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function RunAuditDetails/);
  assert.match(adapterSource, /export async function requestRecoverCommandTextAction/);
  assert.match(rendererSource, /from '.\/results\/primaryAuditAdapter'/);
  assert.doesNotMatch(rendererSource, /function RunAuditDetails\(/);
});

test('audit recovery stays a terminal-equivalent command action', async () => {
  const session = sessionFixture();
  const action = await requestRecoverCommandTextAction({
    session,
    activeRun: session.runs[0],
    recoverAction: 'repair missing evidence',
  });

  assert.equal(action?.type, 'command-text');
  assert.equal(action?.source, 'recover');
  assert.equal(action?.runId, 'run-audit');
  assert.match(action?.commandText ?? '', /repair missing evidence/);
});

test('debug audit expansion stays behind the typed user action API', async () => {
  const session = sessionFixture();
  const action = await requestOpenDebugAuditThroughUserActionApi({
    session,
    activeRun: session.runs[0],
    userActionApi: {
      async openDebugAudit(input) {
        return {
          accepted: true,
          action: {
            kind: 'UIAction',
            id: 'open-debug-audit-test',
            type: 'open-debug-audit',
            sessionId: input.session.sessionId,
            scenarioId: input.session.scenarioId,
            createdAt: '2026-06-01T00:02:00.000Z',
            runId: input.runId,
            auditRefs: ['trace:bounded-audit'],
          },
        };
      },
    },
  });

  assert.equal(action?.type, 'open-debug-audit');
  assert.equal(action?.runId, 'run-audit');
  assert.deepEqual(action?.auditRefs, ['trace:bounded-audit']);
});

test('compact failure summaries keep typed cause without raw payload dumps', () => {
  assert.equal(
    compactVisibleFailureText(
      'ContractValidationFailure payload-schema. Previous failure: Provider returned invalid shape. reason=missing artifact; raw={"large":"payload"}',
      'en-US',
    ),
    'Validation failed · Result format · Provider returned invalid shape · missing artifact',
  );
});
