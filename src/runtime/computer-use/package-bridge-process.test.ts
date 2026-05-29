import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  runComputerUsePackageProcess,
  type PackageBridgeProcessHandle,
  type SpawnPackageBridgeProcess,
} from './package-bridge-process.js';

test('package bridge process runner parses host port calls and finalResult JSONL', async () => {
  const child = new FakePackageProcess();
  const stdinLines: string[] = [];
  child.stdin.on('data', (chunk) => stdinLines.push(String(chunk)));
  const calls: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const resultPromise = runComputerUsePackageProcess({
    actionProviderRequest: { task: 'read screen' },
    callbacks: {},
    handleHostPortCall: async (call) => {
      assert.equal(call.id, 'capture-1');
      assert.equal(call.port, 'capture');
      return { ref: 'screen.png' };
    },
    packageDir: '/tmp/sciforge-package',
    python: '/usr/bin/python-test',
    processEnv: { PYTHONPATH: '/already/there' },
    spawnPackageProcess: captureSpawn(child, calls),
  });

  child.stdout.write(`${JSON.stringify({ type: 'hostPortCall', id: 'capture-1', port: 'capture' })}\n`);
  child.stdout.write(JSON.stringify({ type: 'finalResult', result: { status: 'succeeded', answer: 42 } }));
  child.close(0, null);

  assert.deepEqual(await resultPromise, { status: 'succeeded', answer: 42 });
  assert.equal(calls[0]?.command, '/usr/bin/python-test');
  assert.deepEqual(calls[0]?.args.slice(0, 2), ['-m', 'sciforge_computer_use']);
  assert.equal(calls[0]?.cwd, '/tmp/sciforge-package');
  assert.equal(calls[0]?.env.PYTHONPATH, '/tmp/sciforge-package:/already/there');
  const hostPortResult = JSON.parse(stdinLines.join('').trim()) as Record<string, unknown>;
  assert.equal(hostPortResult.type, 'hostPortResult');
  assert.equal(hostPortResult.id, 'capture-1');
  assert.equal(hostPortResult.ok, true);
  assert.deepEqual(hostPortResult.result, { ref: 'screen.png' });
});

test('package bridge process runner returns diagnostic failure when finalResult is missing', async () => {
  const child = new FakePackageProcess();
  const resultPromise = runComputerUsePackageProcess({
    actionProviderRequest: { task: 'no final result' },
    callbacks: {},
    handleHostPortCall: async () => ({ ok: true }),
    packageDir: '/tmp/sciforge-package',
    python: 'python-test',
    processEnv: {},
    spawnPackageProcess: captureSpawn(child),
  });

  child.stdout.write('plain progress line\n');
  child.stderr.write('python traceback');
  child.close(2, 'SIGTERM');

  const result = await resultPromise;
  assert.equal(result.schemaVersion, 'sciforge.computer-use.result.v1');
  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /exited without finalResult/);
  assert.match(String(result.reason), /exitCode=2/);
  assert.match(String(result.reason), /signal=SIGTERM/);
  assert.match(String(result.message), /python traceback/);
  const diagnostics = result.failureDiagnostics as Record<string, any>;
  assert.equal(diagnostics.failedStage, 'package-bridge');
  assert.match(String(diagnostics.stderr), /Non-JSON stdout from Computer Use package/);
  assert.match(String(diagnostics.stdout), /plain progress line/);
  assert.equal(diagnostics.process.code, 2);
});

test('package bridge process runner records abort reason and terminates package process', async () => {
  const child = new FakePackageProcess();
  const controller = new AbortController();
  const resultPromise = runComputerUsePackageProcess({
    actionProviderRequest: { task: 'abort me' },
    callbacks: { signal: controller.signal },
    handleHostPortCall: async () => ({ ok: true }),
    packageDir: '/tmp/sciforge-package',
    python: 'python-test',
    processEnv: {},
    spawnPackageProcess: captureSpawn(child),
    abortKillGraceMs: 5,
  });

  controller.abort(new Error('test timeout after first action'));

  const result = await resultPromise;
  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(result.status, 'failed-with-reason');
  assert.match(String(result.reason), /aborted by workspace runtime signal: test timeout after first action/);
  assert.match(String(result.reason), /exited without finalResult/);
  assert.match(String(result.reason), /signal=SIGTERM/);
});

class FakePackageProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number) {
    this.killed = true;
    this.killSignals.push(signal);
    this.close(null, typeof signal === 'string' ? signal : null);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null) {
    queueMicrotask(() => this.emit('close', code, signal));
  }
}

function captureSpawn(
  child: FakePackageProcess,
  calls: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [],
): SpawnPackageBridgeProcess {
  return (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    return child as unknown as PackageBridgeProcessHandle;
  };
}
