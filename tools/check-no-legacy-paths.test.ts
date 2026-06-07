import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const tsxLoader = require.resolve('tsx');

function writeFixtureFile(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function minimalRepoFixture(): string {
  const root = join(tmpdir(), `sciforge-no-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFixtureFile(root, 'package.json', JSON.stringify({ scripts: {} }));
  writeFixtureFile(root, '.mcp.json', JSON.stringify({ mcpServers: {} }));
  writeFixtureFile(
    root,
    'src/runtime/generation-gateway.ts',
    [
      'agentServerDispatchQuarantinedPayload(context.request);',
      'agentServerGenerationDispatchQuarantineDecision();',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    'src/runtime/gateway/agent-backend-config.ts',
    "export const config = { requestBackendSupported: runtimeAgentBackendSupported(requestBackend) && requestBackend !== 'codex' };",
  );
  writeFixtureFile(
    root,
    'src/runtime/computer-use/executor.ts',
    "if (targetResolution.captureKind !== 'window') { throw new Error('no target window is resolved'); }",
  );
  writeFixtureFile(
    root,
    'packages/actions/computer-use/action-provider.manifest.json',
    JSON.stringify({
      entrypoint: { type: 'typescript-package', package: '@sciforge/computer-use' },
    }),
  );
  writeFixtureFile(
    root,
    'packages/actions/computer-use/README.md',
    'Computer Use is TS-only.\n',
  );
  return root;
}

test('no-legacy guard blocks package boundary imports from tools/computer-use-next', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'src/runtime/computer-use/package-bridge-request.ts',
    "import { validate } from '../../../tools/computer-use-next/live-acceptance-validator';\nexport const request = validate;\n",
  );

  const result = spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-no-legacy-paths.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /package action loop schema must stay TypeScript-owned and must not import tools\/computer-use-next/,
  );
});

test('no-legacy guard blocks retired Computer Use Python package files', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'packages/actions/computer-use/sciforge_computer_use/__main__.py',
    'print("retired")\n',
  );

  const result = spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-no-legacy-paths.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /packages\/actions\/computer-use\/sciforge_computer_use must stay deleted/,
  );
});

test('no-legacy guard blocks retired direct grounding provider paths in source code', () => {
  const root = minimalRepoFixture();
  const retiredProviderToken = ['kv', '-', 'ground'].join('');
  writeFixtureFile(
    root,
    'src/runtime/computer-use/package-bridge.ts',
    `export const activeProvider = '${retiredProviderToken}';\n`,
  );

  const result = spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-no-legacy-paths.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /retired direct grounding code paths must not remain active; use Model Router grounding translator/,
  );
});
