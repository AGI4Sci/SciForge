import assert from 'node:assert/strict';
import test from 'node:test';
import { pickWorkspaceDirectoryPath } from './workspace-directory-picker.js';

test('pickWorkspaceDirectoryPath returns null when macOS picker is cancelled', async () => {
  const picked = await pickWorkspaceDirectoryPath({
    platform: 'darwin',
    execFileImpl: ((_command, _args, _options, callback) => {
      const done = callback as ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
      done?.(Object.assign(new Error('User canceled'), { code: 1 }), '', '');
    }) as typeof import('node:child_process').execFile,
  });
  assert.equal(picked, null);
});

test('pickWorkspaceDirectoryPath ignores missing defaultPath and still opens the picker script', async () => {
  let script = '';
  const picked = await pickWorkspaceDirectoryPath({
    platform: 'darwin',
    defaultPath: '/path/that/does/not/exist',
    accessImpl: async () => {
      throw new Error('missing');
    },
    execFileImpl: ((_command, args, _options, callback) => {
      const execArgs = Array.isArray(args) ? args : [];
      script = String(execArgs[1] ?? '');
      const done = callback as ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
      done?.(null, '/tmp/sciforge-project/\n', '');
    }) as typeof import('node:child_process').execFile,
  });
  assert.equal(picked, '/tmp/sciforge-project');
  assert.doesNotMatch(script, /default location/);
});
