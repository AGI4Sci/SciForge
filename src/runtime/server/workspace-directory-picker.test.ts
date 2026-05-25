import assert from 'node:assert/strict';
import type { execFile } from 'node:child_process';
import test from 'node:test';
import { pickWorkspaceDirectoryPath } from './workspace-directory-picker.js';

test('pickWorkspaceDirectoryPath returns null when macOS picker is cancelled', async () => {
  const picked = await pickWorkspaceDirectoryPath({
    platform: 'darwin',
    execFileImpl: ((_command: string, _args: readonly string[] | undefined, _options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback?.(Object.assign(new Error('User canceled'), { code: 1 }), '', '');
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile,
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
    execFileImpl: ((_command: string, args: readonly string[] | undefined, _options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      script = String(args?.[1] ?? '');
      callback?.(null, '/tmp/sciforge-project/\n', '');
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile,
  });
  assert.equal(picked, '/tmp/sciforge-project');
  assert.doesNotMatch(script, /default location/);
});
