import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ObjectReference, RuntimeArtifact, SciForgeSession } from '../../domain';
import {
  applyRightPaneObjectActionResult,
  createRightPaneCommandTextAction,
  rightPaneActionId,
} from './rightPaneActionController';

const session = {
  sessionId: 'session-right-pane-actions',
  scenarioId: 'literature-evidence-review',
} as SciForgeSession;

test('right pane action controller owns ResultsRenderer object action and command wiring', () => {
  const controllerSource = readFileSync(new URL('./rightPaneActionController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneActionController/);
  assert.match(controllerSource, /performObjectReferenceAction/);
  assert.match(controllerSource, /createCommandTextUIAction/);
  assert.match(controllerSource, /applyRightPaneObjectActionResult/);
  assert.match(rendererSource, /from '.\/results\/rightPaneActionController'/);
  assert.doesNotMatch(rendererSource, /performObjectReferenceAction/);
  assert.doesNotMatch(rendererSource, /createCommandTextUIAction/);
  assert.doesNotMatch(rendererSource, /function actionId/);
  assert.doesNotMatch(rendererSource, /function requestCommandText/);
  assert.doesNotMatch(rendererSource, /const handleObjectAction/);
  assert.doesNotMatch(rendererSource, /setPinnedObjectReferences/);
  assert.doesNotMatch(rendererSource, /setObjectActionNotice/);
});

test('right pane command action helper creates terminal-equivalent open actions only for non-empty text', () => {
  assert.equal(rightPaneActionId('command-right-pane', 'fixed-id'), 'command-right-pane-fixed-id');

  const action = createRightPaneCommandTextAction({
    session,
    commandText: '  /browser reload   ',
    label: 'Reload browser',
    targetRef: 'url:https://example.org',
    id: rightPaneActionId('command-right-pane', 'reload'),
    createdAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(action?.type, 'command-text');
  assert.equal(action?.id, 'command-right-pane-reload');
  assert.equal(action?.sessionId, 'session-right-pane-actions');
  assert.equal(action?.scenarioId, 'literature-evidence-review');
  assert.equal(action?.source, 'open');
  assert.equal(action?.commandText, '/browser reload');
  assert.equal(action?.label, 'Reload browser');
  assert.equal(action?.targetRef, 'url:https://example.org');
  assert.deepEqual(action?.auditRefs, []);

  assert.equal(createRightPaneCommandTextAction({ session, commandText: '   ' }), undefined);
});

test('right pane object action result adapter applies presentation state without execution side effects', () => {
  const reference: ObjectReference = {
    id: 'url-ref',
    title: 'URL',
    kind: 'url',
    ref: 'url:https://example.org',
  };
  const artifact = {
    id: 'artifact-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Report' },
  } as RuntimeArtifact;
  const commandTextAction = createRightPaneCommandTextAction({
    session,
    commandText: '/browser open-external "https://example.org" --approval required',
    id: 'command-browser-open-external-test',
    createdAt: '2026-06-01T00:00:00.000Z',
  });
  if (!commandTextAction) assert.fail('Expected command action');

  const focusedRefs: Array<ObjectReference | undefined> = [];
  const activeRuns: Array<string | undefined> = [];
  const tabs: string[] = [];
  const inspectedArtifacts: RuntimeArtifact[] = [];
  const pinnedSets: ObjectReference[][] = [[reference]];
  const commands: string[] = [];
  const notices: string[] = [];
  const errors: string[] = [];

  applyRightPaneObjectActionResult({
    focusReference: reference,
    activeRunId: 'run-1',
    resultTab: 'browser',
    inspectedArtifact: artifact,
    pinnedObjectReferences: [],
    commandTextAction,
    notice: 'ready',
    error: 'diagnostic',
  }, {
    onFocusedObjectChange: (next) => focusedRefs.push(next),
    onActiveRunChange: (next) => activeRuns.push(next),
    onResultTabActivate: (next) => tabs.push(next),
    setInspectedArtifact: (next) => inspectedArtifacts.push(next),
    setPinnedObjectReferences: (next) => pinnedSets.push(next),
    onCommandTextAction: (next) => commands.push(next.commandText),
    setObjectActionNotice: (next) => notices.push(next),
    setObjectActionError: (next) => errors.push(next),
  });

  assert.deepEqual(focusedRefs.map((item) => item?.ref), ['url:https://example.org']);
  assert.deepEqual(activeRuns, ['run-1']);
  assert.deepEqual(tabs, ['browser']);
  assert.deepEqual(inspectedArtifacts.map((item) => item.id), ['artifact-report']);
  assert.deepEqual(pinnedSets.at(-1), []);
  assert.deepEqual(commands, ['/browser open-external "https://example.org" --approval required']);
  assert.deepEqual(notices, ['ready']);
  assert.deepEqual(errors, ['diagnostic']);
});
