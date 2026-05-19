import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductionRuntimeLauncher,
  type ManagedRuntimeServiceSpec,
  type SpawnManagedProcess,
} from './runtime-launcher.js';

test('production launcher exposes ready and health over dynamic loopback control port', async () => {
  const root = await tempRoot();
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    requestedUiPort: 5179,
    requestedWorkspacePort: 6179,
    requestedRuntimeCodexPort: 18086,
  });
  const started = await launcher.start();
  try {
    assert.match(started.controlUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const ready = await fetchJson(`${started.controlUrl}/ready`);
    assert.deepEqual(ready, { ok: true, ready: true });
    const health = await fetchJson(`${started.controlUrl}/health`) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.ready, true);
    assert.deepEqual(
      (health.ports as Array<{ name: string; actual: number }>).map((port) => [port.name, port.actual]),
      [
        ['control', new URL(started.controlUrl).port ? Number(new URL(started.controlUrl).port) : 0],
        ['ui', 5179],
        ['workspace-writer', 6179],
        ['runtime-codex', 18086],
      ],
    );
  } finally {
    await launcher.shutdown();
  }
});

test('production launcher moves control API to the next free loopback port on conflict', async () => {
  const root = await tempRoot();
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => occupied.once('listening', resolve));
  const address = occupied.address();
  assert.equal(typeof address, 'object');
  const requestedControlPort = address && typeof address === 'object' ? address.port : 0;
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort,
  });

  try {
    const started = await launcher.start();
    const binding = started.ports.find((port) => port.name === 'control');
    assert.equal(binding?.requested, requestedControlPort);
    assert.equal(binding?.conflict, true);
    assert.notEqual(binding?.actual, requestedControlPort);
    assert.equal((await fetchJson(`${started.controlUrl}/ready`) as { ok: boolean }).ok, true);
  } finally {
    await launcher.shutdown();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

test('production launcher records child stderr to folded audit and reports failed health on child exit', async () => {
  const root = await tempRoot();
  const child = new FakeChild(1201);
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    services: [service('workspace')],
    spawnProcess: (() => child) as SpawnManagedProcess,
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });
  const started = await launcher.start();
  try {
    child.stderr.write('RAW STDERR SHOULD STAY IN AUDIT\n');
    child.exit(2, null);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const healthResponse = await fetch(`${started.controlUrl}/health`);
    assert.equal(healthResponse.status, 503);
    const healthText = await healthResponse.text();
    assert.match(healthText, /"state":"failed"/);
    assert.doesNotMatch(healthText, /RAW STDERR SHOULD STAY IN AUDIT/);

    const audit = await readFile(started.auditLogPath, 'utf8');
    assert.match(audit, /RAW STDERR SHOULD STAY IN AUDIT/);
    assert.match(audit, /"stream":"stderr"/);
    assert.match(audit, /"stream":"lifecycle"/);
  } finally {
    await launcher.shutdown();
  }
});

test('production launcher shutdown terminates managed children and closes control server', async () => {
  const root = await tempRoot();
  const child = new FakeChild(1202);
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    services: [service('runtime-codex')],
    spawnProcess: (() => child) as SpawnManagedProcess,
  });
  const started = await launcher.start();
  await launcher.shutdown();

  assert.equal(child.killed, true);
  await assert.rejects(() => fetch(`${started.controlUrl}/ready`));
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null, 'SIGTERM');
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }
}

function service(id: string): ManagedRuntimeServiceSpec {
  return {
    id,
    role: id === 'runtime-codex' ? 'runtime-codex' : 'workspace-writer',
    command: 'node',
    args: ['service.js'],
  };
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-launcher-test-'));
  await mkdir(join(root, 'workspace'), { recursive: true });
  return root;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}
