import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  nextResultShellMenuIndexForKey,
  nextResultShellTabIndexForKey,
} from './ResultShell';

test('ResultShell tab roving keyboard order wraps across tabs', () => {
  assert.equal(nextResultShellTabIndexForKey('ArrowRight', 0, 4), 1);
  assert.equal(nextResultShellTabIndexForKey('ArrowRight', 3, 4), 0);
  assert.equal(nextResultShellTabIndexForKey('ArrowLeft', 0, 4), 3);
  assert.equal(nextResultShellTabIndexForKey('Home', 2, 4), 0);
  assert.equal(nextResultShellTabIndexForKey('End', 1, 4), 3);
  assert.equal(nextResultShellTabIndexForKey('PageDown', 1, 4), undefined);
});

test('ResultShell New menu keyboard order and Escape focus return are declared', () => {
  assert.equal(nextResultShellMenuIndexForKey('ArrowDown', 0, 6), 1);
  assert.equal(nextResultShellMenuIndexForKey('ArrowDown', 5, 6), 0);
  assert.equal(nextResultShellMenuIndexForKey('ArrowUp', 0, 6), 5);
  assert.equal(nextResultShellMenuIndexForKey('Home', 4, 6), 0);
  assert.equal(nextResultShellMenuIndexForKey('End', 1, 6), 5);
  assert.equal(nextResultShellMenuIndexForKey('Tab', 1, 6), undefined);

  const source = readFileSync(new URL('./ResultShell.tsx', import.meta.url), 'utf8');
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /aria-controls=\{newTabMenuId\}/);
  assert.match(source, /newTabButtonRef\.current\?\.focus\(\)/);
});

test('right pane shell and renderer stay out of adapter implementation details', () => {
  const shellSource = readFileSync(new URL('./ResultShell.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');

  assert.match(rendererSource, /from '.\/results\/rightPaneSurfaceAdapter'/);
  assert.match(rendererSource, /<RightPaneActiveSurface/);
  assert.doesNotMatch(rendererSource, /WorkspaceObjectPreview/);
  assert.doesNotMatch(rendererSource, /browserPaneHostAdapter|imagePaneHostAdapter|terminalPaneHostAdapter|filesPaneHostAdapter|referencesPaneHostAdapter/);
  assert.doesNotMatch(rendererSource, /RightPaneBrowserTool|RightPaneImageEvidenceTool|RightPaneTerminal(?:Live)?Tool|RightPaneFilesTool|RightPaneReferencesTool/);

  assert.doesNotMatch(shellSource, /WorkspaceObjectPreview/);
  assert.doesNotMatch(shellSource, /browserPaneHostAdapter|imagePaneHostAdapter|terminalPaneHostAdapter|filesPaneHostAdapter|referencesPaneHostAdapter/);
  assert.doesNotMatch(shellSource, /RightPaneBrowserTool|RightPaneImageEvidenceTool|RightPaneTerminal(?:Live)?Tool|RightPaneFilesTool|RightPaneReferencesTool/);

  assert.match(surfaceSource, /function renderRightPaneActiveTool/);
  for (const adapter of [
    'RightPaneBrowserTool',
    'RightPaneImageEvidenceTool',
    'RightPaneTerminalLiveTool',
    'RightPaneFilesTool',
    'RightPaneReferencesTool',
    'PrimaryResultAdapter',
  ]) {
    assert.match(surfaceSource, new RegExp(adapter));
  }
  assert.match(surfaceSource, /RightPaneEmptyWorkspace/);
});
