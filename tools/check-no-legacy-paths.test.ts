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
      legacyPythonImplementation: {
        legacyObsolete: true,
        diagnosticOnly: true,
        productDefaultAcceptanceAllowed: false,
      },
      virtualAppScreenRuntimeProductFallbackAllowed: false,
    }),
  );
  writeFixtureFile(
    root,
    'packages/actions/computer-use/README.md',
    'Python files are legacy-obsolete and cannot be referenced by product/default acceptance',
  );
  writeFixtureFile(
    root,
    'packages/actions/computer-use/sciforge_computer_use/__main__.py',
    'from .cli import main\nraise SystemExit(main())\n',
  );
  writeFixtureFile(
    root,
    'packages/actions/computer-use/sciforge_computer_use/cli.py',
    [
      'import argparse',
      'import os',
      "LEGACY_PYTHON_DIAGNOSTIC_ENV = 'SCIFORGE_COMPUTER_USE_LEGACY_PYTHON_DIAGNOSTIC'",
      'LEGACY_PYTHON_DIAGNOSTIC_FAILURE_STAGE = "legacy-python-diagnostic-gate"',
      'def _legacy_python_diagnostic_enabled():',
      "    return os.environ.get(LEGACY_PYTHON_DIAGNOSTIC_ENV) == '1'",
      'def _emit_protocol_final(*, failed_stage):',
      '    return failed_stage',
      'def main():',
      '    if not _legacy_python_diagnostic_enabled():',
      '        _emit_protocol_final(failed_stage=LEGACY_PYTHON_DIAGNOSTIC_FAILURE_STAGE)',
      '        return 2',
      '    parser = argparse.ArgumentParser()',
      "    parser.add_argument('--host-port-stdio')",
      "    if '--host-port-stdio':",
      '        _emit_protocol_final(failed_stage=LEGACY_PYTHON_DIAGNOSTIC_FAILURE_STAGE)',
      '    return 0',
    ].join('\n'),
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

test('no-legacy guard requires semantic verifier direct-provider probes to stay diagnostic-only', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'packages/actions/computer-use/sciforge_computer_use/semantic_verifier_probe.py',
    [
      'import urllib.request',
      'def run_semantic_verifier_probe(config):',
      '    url = config["visionLLM"]["baseUrl"] + "/chat/completions"',
      '    token = config["visionLLM"]["apiKey"]',
      '    model = config["visionLLM"]["model"]',
      '    return urllib.request.Request(url, headers={"Authorization": "Bearer " + token}, data=model.encode())',
    ].join('\n'),
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
    /semantic verifier direct-provider probe must remain explicit legacy diagnostic-only/,
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
