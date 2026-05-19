import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { RUNTIME_KEY_ENV, RUNTIME_PROFILE } from '../../../packages/backend/src/runtime-home.js';
import { CodexExecJsonAdapter, type SpawnCodexProcess } from './codex-exec-json-adapter.js';
import { GUI_EXTENSION_STATE_ENV, GUI_MCP_SERVER_NAME } from './gui-extension-manifest.js';

test('adapter spawns codex exec --json with isolated CODEX_HOME and plain text command', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'OK' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const guiStatePath = join(workspace, 'gui-state.json');
  const turn = await adapter.startTurn({
    commandText: 'Summarize the workspace',
    workspacePath: workspace,
    guiExtension: { statePath: guiStatePath },
  });
  const events = await collect(turn.events);

  assert.equal(spawnCall?.[0], 'codex');
  const argv = spawnCall?.[1] ?? [];
  assert.deepEqual(argv.slice(0, 2), ['exec', '--json']);
  assert.ok(argv.includes('--skip-git-repo-check'));
  assert.ok(argv.includes('--ignore-rules'));
  await assert.rejects(access(join(workspace, '.git')));
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.command="node"`));
  assert.ok(argv.some((arg) => arg.startsWith(`mcp_servers.${GUI_MCP_SERVER_NAME}.args=`) && arg.includes('gui-mcp-server.ts')));
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.env.${GUI_EXTENSION_STATE_ENV}="${guiStatePath}"`));
  assert.deepEqual(argv.slice(-5), [
    '--profile',
    RUNTIME_PROFILE,
    '--cd',
    workspace,
    'Summarize the workspace',
  ]);
  assert.equal(argv.filter((arg) => arg === 'Summarize the workspace').length, 1);
  assert.match(spawnCall?.[2].env.CODEX_HOME ?? '', /packages\/backend\/\.codex-runtime\/codex-home$/);
  assert.equal(events.find((event) => event.type === 'message')?.text, 'OK');
  assert.equal(events.at(-1)?.type, 'done');
});

test('adapter converts stderr to audit events and nonzero exit to failed', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stderr.write('diagnostic only');
        child.close(7);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'fail please', workspacePath: workspace, guiExtension: { enabled: false } });
  const events = await collect(turn.events);

  assert.equal(events.find((event) => event.status === 'stderr')?.type, 'audit');
  assert.equal(events.at(-1)?.type, 'failed');
  assert.equal(events.at(-1)?.exitCode, 7);
});

test('adapter fails closed before spawn when runtime API key is missing', async () => {
  let spawnCalled = false;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: {},
    spawnProcess() {
      spawnCalled = true;
      return fakeChild().process;
    },
  });

  await assert.rejects(
    () => adapter.startTurn({ commandText: 'should not fall back', workspacePath: workspace, guiExtension: { enabled: false } }),
    new RegExp(`Missing ${RUNTIME_KEY_ENV}`),
  );
  assert.equal(spawnCalled, false);
});

test('adapter rejects Developer profile instead of falling back from runtime profile', async () => {
  let spawnCalled = false;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      spawnCalled = true;
      return fakeChild().process;
    },
  });

  await assert.rejects(
    () => adapter.startTurn({
      commandText: 'should not use developer profile',
      workspacePath: workspace,
      profile: 'default',
      guiExtension: { enabled: false },
    }),
    /Unsupported Runtime Codex profile: default/,
  );
  assert.equal(spawnCalled, false);
});

test('adapter resumes native Codex session when codexSessionId is provided', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'remembered' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'What did I ask you to remember?',
    workspacePath: workspace,
    codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
  });
  await collect(turn.events);

  assert.equal(turn.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(spawnCall?.[0], 'codex');
  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.command="node"`));
  await assert.rejects(access(join(workspace, '.git')));
  assert.deepEqual(argv.slice(-11), [
    '--profile',
    RUNTIME_PROFILE,
    '--cd',
    workspace,
    'exec',
    'resume',
    '--json',
    '--skip-git-repo-check',
    '--ignore-rules',
    '019e3e82-164d-79b2-a5d4-b16241620b10',
    'What did I ask you to remember?',
  ]);
  assert.equal(argv.filter((arg) => arg === 'What did I ask you to remember?').length, 1);
  assert.equal(argv.at(-2), '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(argv.at(-1), 'What did I ask you to remember?');
});

test('adapter surfaces native Codex session id from session_meta events', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'session_meta',
          payload: { id: '019e3e82-164d-79b2-a5d4-b16241620b10' },
        })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'OK' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'remember this', workspacePath: workspace });
  const events = await collect(turn.events);

  assert.equal(events.find((event) => event.type === 'message')?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(events.at(-1)?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('adapter cancel sends SIGTERM and emits cancelled on signal close', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'long run', workspacePath: workspace, guiExtension: { enabled: false } });
  const eventsPromise = collect(turn.events);
  await adapter.cancel(turn.turnId);
  child.close(null, 'SIGTERM');
  const events = await eventsPromise;

  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(events.at(-1)?.type, 'cancelled');
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of iterable) result.push(event);
  return result;
}

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-codex-adapter-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function fakeChild() {
  const emitter = new EventEmitter() as ChildProcessByStdio<null, Readable, Readable>;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const killSignals: string[] = [];
  Object.defineProperties(emitter, {
    stdout: { value: stdout },
    stderr: { value: stderr },
    stdin: { value: new PassThrough() },
    killed: { value: false, writable: true },
    kill: {
      value(signal?: NodeJS.Signals | number) {
        killSignals.push(String(signal ?? 'SIGTERM'));
        return true;
      },
    },
  });
  return {
    process: emitter,
    stdout,
    stderr,
    killSignals,
    close(code: number | null, signal: NodeJS.Signals | null = null) {
      stdout.end();
      stderr.end();
      emitter.emit('close', code, signal);
    },
  };
}
