import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { focusModeForRightPaneTab } from './rightPaneTabController';
import { focusResultPaneRouteForObjectReference } from './resultPaneContract';

test('right pane tab controller owns ResultsRenderer tab wiring extraction', () => {
  const controllerSource = readFileSync(new URL('./rightPaneTabController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneTabController/);
  assert.match(controllerSource, /loadStoredRightPaneState/);
  assert.match(controllerSource, /saveStoredRightPaneState/);
  assert.match(controllerSource, /addRightPaneTabLifecycleState/);
  assert.match(controllerSource, /closeRightPaneTabLifecycleState/);
  assert.match(controllerSource, /focusResultPaneRouteForObjectReference/);
  assert.match(rendererSource, /from '.\/results\/rightPaneTabController'/);
  assert.doesNotMatch(rendererSource, /function activateResultTabKind/);
  assert.doesNotMatch(rendererSource, /function handleResultTabChange/);
  assert.doesNotMatch(rendererSource, /function handleNewResultTab/);
  assert.doesNotMatch(rendererSource, /function handleFocusModeChange/);
  assert.doesNotMatch(rendererSource, /loadStoredRightPaneState/);
  assert.doesNotMatch(rendererSource, /saveStoredRightPaneState/);
});

test('right pane tab controller derives focus mode from active tab kind', () => {
  assert.equal(focusModeForRightPaneTab('evidence', 'all'), 'evidence');
  assert.equal(focusModeForRightPaneTab('terminal', 'all'), 'execution');
  assert.equal(focusModeForRightPaneTab('image', 'all'), 'visual');
  assert.equal(focusModeForRightPaneTab('screen', 'all'), 'visual');
  assert.equal(focusModeForRightPaneTab('primary', 'evidence'), 'all');
  assert.equal(focusModeForRightPaneTab('browser', 'execution'), 'all');
  assert.equal(focusModeForRightPaneTab('files', 'visual'), 'visual');
  assert.equal(focusModeForRightPaneTab(undefined, 'evidence'), 'all');
});

test('right pane tab controller focus dispatch follows object ref routes without composer insertion', () => {
  const source = readFileSync(new URL('./rightPaneTabController.ts', import.meta.url), 'utf8');

  assert.match(source, /focusResultPaneRouteForObjectReference/);
  assert.doesNotMatch(source, /composer/i);

  for (const [ref, pane] of [
    ['trace:audit-1', 'evidence'],
    ['browser:session-1', 'browser'],
    ['crop:figure-1', 'image'],
    ['terminal:session-1', 'terminal'],
    ['file:PROJECT_workbench.md', 'files'],
  ] as const) {
    const route = focusResultPaneRouteForObjectReference({ kind: 'artifact', ref });
    assert.equal(route.pane, pane, ref);
    assert.equal(route.purpose, 'focus', ref);
    assert.equal(route.composerInsertion, false, ref);
  }
});
