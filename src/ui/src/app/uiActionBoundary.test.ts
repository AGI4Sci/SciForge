import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession } from '../domain';
import {
  appendUIActionAuditLog,
  compactUIActionPromptPreview,
  createUIAction,
  uiActionReferenceRefs,
} from './uiActionBoundary';

const session: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-ui-action',
  scenarioId: 'literature-evidence-review',
  title: 'ui action boundary',
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
  hiddenResultSlotIds: [],
};

test('UIAction normalizes submit-turn write boundary metadata', () => {
  const action = createUIAction({
    id: 'ui-action-submit',
    session,
    createdAt: '2026-05-16T00:00:01.000Z',
    type: 'submit-turn',
    promptPreview: compactUIActionPromptPreview(`make report ${'with refs '.repeat(40)}`),
    referenceRefs: uiActionReferenceRefs([
      { id: 'ref-1', kind: 'task-result', ref: 'artifact:report', title: 'report' },
      { id: 'ref-2', kind: 'task-result', ref: 'artifact:report', title: 'report duplicate' },
    ]),
  });

  assert.equal(action.kind, 'UIAction');
  assert.equal(action.type, 'submit-turn');
  assert.equal(action.sessionId, 'session-ui-action');
  assert.deepEqual(action.referenceRefs, ['artifact:report']);
  assert.ok(action.promptPreview.endsWith('...'));
});

test('UIAction audit log is append-only and bounded', () => {
  const actions = Array.from({ length: 4 }, (_, index) => createUIAction({
    id: `ui-action-${index}`,
    session,
    createdAt: `2026-05-16T00:00:0${index}.000Z`,
    type: 'cancel-run',
    runId: `run-${index}`,
    rejectedGuidanceIds: [],
  }));

  const log = actions.reduce((current, action) => appendUIActionAuditLog(current, action, 2), [] as typeof actions);

  assert.deepEqual(log.map((action) => action.id), ['ui-action-2', 'ui-action-3']);
});
