import assert from 'node:assert/strict';
import test from 'node:test';
import { workspacePasteTargetPath } from './workspaceClipboardModel';

test('workspacePasteTargetPath resolves folder, file parent, and blank targets', () => {
  assert.equal(
    workspacePasteTargetPath({
      workspaceRoot: '/tmp/workspace',
      entry: { path: '/tmp/workspace/docs', name: 'docs', kind: 'folder' },
    }),
    '/tmp/workspace/docs',
  );
  assert.equal(
    workspacePasteTargetPath({
      workspaceRoot: '/tmp/workspace',
      entry: { path: '/tmp/workspace/docs/readme.md', name: 'readme.md', kind: 'file' },
    }),
    '/tmp/workspace/docs',
  );
  assert.equal(
    workspacePasteTargetPath({ workspaceRoot: '/tmp/workspace' }),
    '/tmp/workspace',
  );
});
