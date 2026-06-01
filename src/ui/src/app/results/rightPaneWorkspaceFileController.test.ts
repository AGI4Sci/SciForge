import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workspaceFileDiscardConfirmationMessage } from './rightPaneWorkspaceFileController';

test('right pane workspace file controller owns ResultsRenderer file side-effect wiring', () => {
  const controllerSource = readFileSync(new URL('./rightPaneWorkspaceFileController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneWorkspaceFileController/);
  assert.match(controllerSource, /planWorkspaceFileTabOpen/);
  assert.match(controllerSource, /workspaceFileOpenTabsForRightPaneTabs/);
  assert.match(controllerSource, /workspaceFileEditorMatchesPath/);
  assert.match(controllerSource, /workspaceFileEditorIsDirty/);
  assert.match(rendererSource, /from '.\/results\/rightPaneWorkspaceFileController'/);
  assert.doesNotMatch(rendererSource, /function confirmDiscardWorkspaceFileEditor/);
  assert.doesNotMatch(rendererSource, /function openWorkspaceFileEditorInRightPane/);
  assert.doesNotMatch(rendererSource, /function closeActiveWorkspaceFileView/);
  assert.doesNotMatch(rendererSource, /planWorkspaceFileTabOpen/);
  assert.doesNotMatch(rendererSource, /workspaceFileEditorMatchesPath/);
  assert.doesNotMatch(rendererSource, /workspaceFileEditorIsDirty/);
});

test('right pane workspace file controller keeps dirty-discard copy localized', () => {
  assert.equal(
    workspaceFileDiscardConfirmationMessage('en-US'),
    'This file has unsaved changes. Discard the draft and close it?',
  );
  assert.equal(
    workspaceFileDiscardConfirmationMessage('zh-CN'),
    '这个文件有未保存的更改。是否丢弃草稿并关闭？',
  );
});
