import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBytes,
  parentPath,
  pathBasename,
  sortWorkspaceEntries,
  toWorkspaceRelativePath,
  workspaceActionSuccessMessage,
  workspaceActions,
  workspaceNeedsOnboarding,
  workspaceOnboardingReason,
} from './explorerModels';

test('sorts workspace folders before files by name', () => {
  const entries = sortWorkspaceEntries([
    { kind: 'file', path: '/w/b.ts', name: 'b.ts', size: 2 },
    { kind: 'folder', path: '/w/z', name: 'z' },
    { kind: 'folder', path: '/w/a', name: 'a' },
  ]);

  assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.name}`), [
    'folder:a',
    'folder:z',
    'file:b.ts',
  ]);
});

test('projects explorer paths and display labels', () => {
  assert.equal(pathBasename('/tmp/workspace/'), 'workspace');
  assert.equal(parentPath('/tmp/workspace/file.md'), '/tmp/workspace');
  assert.equal(toWorkspaceRelativePath('/tmp/workspace', '/tmp/workspace/src/app.ts'), 'src/app.ts');
  assert.equal(toWorkspaceRelativePath('/tmp/workspace', '/tmp/workspace'), '.');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('exposes package-owned workspace action ids and messages', () => {
  assert.equal(workspaceActions.createFile, 'create-file');
  assert.equal(workspaceActions.delete, 'delete');
  assert.equal(workspaceActionSuccessMessage(workspaceActions.createFolder), '文件夹已创建。');
});

test('detects workspace onboarding states from path and status text', () => {
  assert.equal(workspaceNeedsOnboarding('', '', ''), true);
  assert.equal(workspaceNeedsOnboarding('/tmp/project', 'ENOENT workspace-state.json', ''), true);
  assert.match(workspaceOnboardingReason('/tmp/project', 'EACCES', ''), /权限不足/);
});
