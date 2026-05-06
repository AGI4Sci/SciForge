import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedbackRuntimeSnapshot,
  compactSelectedText,
  referenceForFeedbackTarget,
} from './captureModel';
import type { FeedbackTargetSnapshot, SciForgeSession } from '../domain';

const session: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-generic',
  scenarioId: 'scenario-any',
  title: 'Generic scenario',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Run a task.',
      createdAt: '2026-05-07T00:00:00.000Z',
    },
  ],
  runs: [
    {
      id: 'run-1',
      scenarioId: 'scenario-any',
      status: 'completed',
      prompt: 'Run a task.',
      response: 'Done.',
      createdAt: '2026-05-07T00:01:00.000Z',
      completedAt: '2026-05-07T00:02:00.000Z',
    },
  ],
  artifacts: [
    {
      id: 'artifact-1',
      type: 'markdown',
      producerScenario: 'scenario-any',
      schemaVersion: '1',
      data: '# Report',
      metadata: { title: 'Report' },
    },
  ],
  executionUnits: [
    {
      id: 'unit-1',
      tool: 'local-runner',
      status: 'done',
      params: 'input',
      hash: 'hash-1',
    },
  ],
  uiManifest: [
    {
      componentId: 'result-panel',
      title: 'Results',
    },
  ],
  claims: [],
  notebook: [],
  versions: [],
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:02:00.000Z',
};

const target: FeedbackTargetSnapshot = {
  selector: 'main.generic-panel > button.primary',
  path: 'html > body > main > button',
  text: '提交',
  tagName: 'button',
  ariaLabel: 'Submit generic action',
  rect: { x: 10, y: 20, width: 120, height: 36 },
};

test('builds runtime snapshots from explicit session inputs', () => {
  const snapshot = buildFeedbackRuntimeSnapshot({
    page: 'workbench',
    scenarioId: 'scenario-any',
    session,
    url: 'http://localhost:5173/',
    appVersion: 'test-build',
  });

  assert.equal(snapshot.page, 'workbench');
  assert.equal(snapshot.sessionId, 'session-generic');
  assert.equal(snapshot.activeRunId, 'run-1');
  assert.equal(snapshot.messageCount, 1);
  assert.deepEqual(snapshot.artifactSummary, [{ id: 'artifact-1', type: 'markdown', title: 'Report' }]);
  assert.deepEqual(snapshot.executionSummary, [{ id: 'unit-1', tool: 'local-runner', status: 'done' }]);
  assert.deepEqual(snapshot.uiManifest, ['result-panel']);
});

test('compacts selected text without depending on the current page', () => {
  assert.equal(compactSelectedText('  one\n\n two\tthree  '), 'one two three');

  const longText = 'a'.repeat(2500);
  const compact = compactSelectedText(longText);
  assert.equal(compact.length, 2403);
  assert.match(compact, /\.\.\.$/);
});

test('builds stable UI object references for feedback targets', () => {
  const reference = referenceForFeedbackTarget(target, '', 'object');

  assert.equal(reference.kind, 'ui');
  assert.equal(reference.ref, 'ui:main.generic-panel > button.primary');
  assert.equal(reference.title, '提交');
  assert.deepEqual((reference.payload as { composerMarkerHint?: string }).composerMarkerHint, 'object');
});

test('builds stable selected-text references for feedback targets', () => {
  const reference = referenceForFeedbackTarget(target, '用户选择的一段通用文本', 'selection');

  assert.equal(reference.kind, 'ui');
  assert.match(reference.id, /^ref-context-text-/);
  assert.match(reference.ref, /^ui-text:ui:main\.generic-panel > button\.primary#/);
  assert.equal(reference.summary, '用户选择的一段通用文本');
  assert.deepEqual(reference.locator, {
    textRange: '用户选择的一段通用文本',
    region: 'ui:main.generic-panel > button.primary',
  });
});
