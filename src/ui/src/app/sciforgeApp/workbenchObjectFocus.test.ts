import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, SciForgeSession } from '../../domain';
import { createWorkbenchObjectFocusUIAction, publicObjectFocusAuditRef } from './workbenchObjectFocus';

const session: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-object-focus',
  scenarioId: 'literature-evidence-review',
  title: 'Object focus',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
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

test('workbench object focus records an inspect UI action for right-pane focus', () => {
  const reference: ObjectReference = {
    id: 'report',
    title: 'Report',
    kind: 'artifact',
    ref: 'artifact:report',
  };

  const action = createWorkbenchObjectFocusUIAction({
    session,
    reference,
    id: 'ui-action-focus-report',
    createdAt: '2026-06-01T00:00:01.000Z',
  });

  assert.equal(action.type, 'select-object');
  assert.equal(action.intent, 'inspect');
  assert.equal(action.objectRef, 'artifact:report');
  assert.equal(action.sessionId, session.sessionId);
});

test('workbench object focus audit refs redact local paths and secret values', () => {
  const reference: ObjectReference = {
    id: 'private-config',
    title: 'Private config',
    kind: 'file',
    ref: 'file:/Users/alice/project/.env?api_key=sk-local&Authorization=Bearer local-token',
  };

  const auditRef = publicObjectFocusAuditRef(reference);

  assert.doesNotMatch(auditRef, /\/Users\/alice/);
  assert.doesNotMatch(auditRef, /sk-local|local-token/);
  assert.match(auditRef, /\[local-path\]/);
  assert.match(auditRef, /api_key=\[redacted\]/);
  assert.match(auditRef, /Authorization=\[redacted\]/i);
});
