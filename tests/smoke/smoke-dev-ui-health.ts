import assert from 'node:assert/strict';
import { formatUiDevServerHealth, readUiDevServerHealth, uiDevServerProbePaths } from '../../tools/dev-health';
import { isOwnedSciForgeViteDevProcess, isSciForgeViteDevProcess, parseListeningPids } from '../../tools/dev-process';

const probes = uiDevServerProbePaths('/tmp/sciforge repo');
assert.deepEqual(probes.map((probe) => probe.label), ['sciforge-index', 'vite-client', 'runtime-contract-barrel']);
assert.ok(
  probes.some((probe) => probe.path.includes('/packages/contracts/runtime/index.ts')),
  'UI dev health must probe the shared runtime contract barrel used by the app shell',
);

const healthy = await readUiDevServerHealth(5173, '/tmp/sciforge', {
  fetchImpl: async (input) => {
    const url = String(input);
    return new Response(url.endsWith('/')
      ? '<title>SciForge</title><script type="module" src="/src/main.tsx"></script>'
      : 'ok', { status: 200 });
  },
});
assert.equal(healthy.ok, true);
assert.equal(formatUiDevServerHealth(healthy), 'UI dev server probes passed.');

const wrongIndex = await readUiDevServerHealth(5173, '/tmp/sciforge', {
  fetchImpl: async (input) => {
    const url = String(input);
    return new Response(url.endsWith('/') ? '<title>Other App</title>' : 'ok', { status: 200 });
  },
});
assert.equal(wrongIndex.ok, false);
assert.match(formatUiDevServerHealth(wrongIndex), /sciforge-index/);
assert.match(formatUiDevServerHealth(wrongIndex), /missing marker/);

const failed = await readUiDevServerHealth(5173, '/tmp/sciforge', {
  fetchImpl: async (input) => {
    const url = String(input);
    if (url.endsWith('/')) {
      return new Response('<title>SciForge</title><script type="module" src="/src/main.tsx"></script>', { status: 200 });
    }
    if (url.includes('packages/contracts/runtime/index.ts')) {
      return new Response('Failed to resolve import "./some-new-contract"', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  },
});

assert.equal(failed.ok, false);
assert.equal(failed.probes.find((probe) => probe.label === 'runtime-contract-barrel')?.status, 500);
assert.match(formatUiDevServerHealth(failed), /runtime-contract-barrel/);
assert.match(formatUiDevServerHealth(failed), /some-new-contract/);

assert.deepEqual(parseListeningPids('123\nnot-a-pid 456'), [123, 456]);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort',
  port: 5173,
}), true);
assert.equal(isOwnedSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort',
  port: 5173,
  envText: '',
}), false);
assert.equal(isOwnedSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort',
  port: 5173,
  envText: 'SCIFORGE_DEV_LAUNCHER_TOKEN=sciforge-ui-owned-token',
  record: {
    service: 'ui',
    repoRoot: '/tmp/sciforge',
    port: 5173,
    token: 'sciforge-ui-owned-token',
  },
}), true);
assert.equal(isOwnedSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort',
  port: 5173,
  envText: 'SCIFORGE_DEV_LAUNCHER_TOKEN=sciforge-ui-other-token',
  record: {
    service: 'ui',
    repoRoot: '/tmp/sciforge',
    port: 5173,
    token: 'sciforge-ui-owned-token',
  },
}), false);
assert.equal(isOwnedSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort',
  port: 5173,
  envText: 'SCIFORGE_DEV_LAUNCHER_TOKEN=sciforge-ui-owned-token',
  record: {
    service: 'ui',
    repoRoot: '/tmp/sciforge',
    port: 5174,
    token: 'sciforge-ui-owned-token',
  },
}), false);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5174 --strictPort',
  port: 5173,
}), false);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --host 0.0.0.0 --port 5173',
  port: 5173,
}), false);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/other',
  command: 'node /tmp/sciforge/node_modules/.bin/vite --port 5173 --strictPort',
  port: 5173,
}), false);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge',
  command: 'node /tmp/other/node_modules/.bin/vite --port 5173 --strictPort /tmp/sciforge',
  port: 5173,
}), false);
assert.equal(isSciForgeViteDevProcess({
  repoRoot: '/tmp/sciforge',
  cwd: '/tmp/sciforge-next',
  command: 'node /tmp/sciforge-next/node_modules/.bin/vite --port 5173 --strictPort',
  port: 5173,
}), false);

console.log('dev UI health smoke passed');
