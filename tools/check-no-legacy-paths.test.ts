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

test('no-legacy guard blocks stale generated GUI/proxy artifacts and runtime shim dirs', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'dist-desktop/src/runtime/codex/gui-extension-manifest.js',
    "export const serverName = 'sciforge_gui';\n",
  );
  writeFixtureFile(
    root,
    'dist-desktop/src/runtime/codex/codex-exec-json-adapter.js',
    "process.env.SCIFORGE_GUI_EXTENSION_STATE = '/tmp/state';\n",
  );
  writeFixtureFile(
    root,
    'dist-desktop/packages/backend/src/proxy.js',
    "export function createCodexResponsesProxyServer() { return 'sciforge.codex-responses-proxy'; }\n",
  );
  writeFixtureFile(
    root,
    'dist-desktop/bundles/relocated-runtime.js',
    "export const legacyServer = 'codex-responses-proxy';\n",
  );
  writeFixtureFile(
    root,
    'packages/backend/.codex-runtime/gui-extension/bin/gui.present',
    '#!/bin/sh\nexec gui-present-cli\n',
  );

  const result = spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-no-legacy-paths.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /dist-desktop\/src\/runtime\/codex\/gui-extension-manifest\.js must stay deleted/);
  assert.match(output, /compiled Codex exec adapter must not inject the retired GUI MCP\/shim extension/);
  assert.match(output, /dist-desktop\/bundles\/relocated-runtime\.js:1 generated desktop artifacts must not retain the retired Codex Responses proxy server/);
  assert.match(output, /dist-desktop\/packages\/backend\/src\/proxy\.js must stay deleted/);
  assert.match(output, /packages\/backend\/\.codex-runtime\/gui-extension must stay deleted/);
});

test('no-legacy guard blocks retired OpenAI runtime opt-in env in active paths', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'src/runtime/codex/openai-runtime-opt-in.ts',
    "export const envKey = 'SCIFORGE_ALLOW_OPENAI_RUNTIME';\n",
  );
  writeFixtureFile(
    root,
    'package.json',
    JSON.stringify({ scripts: { start: 'SCIFORGE_COMPUTER_USE_PLANNER_ALLOW_OPENAI_RUNTIME=1 node app.js' } }),
  );

  const result = spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-no-legacy-paths.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /retired OpenAI runtime opt-in env must not appear in active source/);
  assert.match(output, /package\.json script "start" must not set retired OpenAI runtime opt-in env/);
});
