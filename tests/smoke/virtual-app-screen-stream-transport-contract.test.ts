import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES,
  runVirtualAppScreenStreamTransportContract,
} from '../../tools/check-virtual-app-screen-stream-transport-contract.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen stream transport evaluation covers all candidate transports and live-path gates', async () => {
  const summary = await runVirtualAppScreenStreamTransportContract();

  assert.equal(summary.status, 'passed', summary.issues.join('\n'));
  assert.deepEqual(summary.candidates, REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES);
  assert.deepEqual(summary.checks, [
    'section-present',
    'candidate-coverage',
    'platform-neutral-evaluation',
    'refs-first-live-path',
    'fail-closed-live-path',
    'mjpeg-png-delta-fallback',
  ]);
});

test('VirtualAppScreen stream transport contract CLI reports pass status', async () => {
  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-virtual-app-screen-stream-transport-contract.ts',
  ]);

  assert.match(stdout, /^\[passed\] VirtualAppScreen stream transport contract/);
  for (const candidate of REQUIRED_VIRTUAL_APP_SCREEN_STREAM_TRANSPORT_CANDIDATES) {
    assert.match(stdout, new RegExp(candidate));
  }
});
