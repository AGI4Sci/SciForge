import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const tsxLoader = require.resolve('tsx');

function writeFixtureFile(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function minimalRepoFixture(): string {
  const root = join(tmpdir(), `sciforge-cu-no-bypass-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFixtureFile(root, 'package.json', JSON.stringify({ scripts: {} }));
  writeFixtureFile(root, 'packages/actions/computer-use/index.ts', [
    "export const COMPUTER_USE_PRIMITIVE_INTENTS = { bind: 'computer_use.bind', observe: 'computer_use.observe', act: 'computer_use.act', runProcedure: 'computer_use.run_procedure', control: 'computer_use.control' } as const;",
    "export const COMPUTER_USE_PRIMITIVE_NAMES = ['bind', 'observe', 'act', 'run_procedure', 'control'] as const;",
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/mcp.ts', [
    "export function computerUseMcpTools() {",
    "  return [{ name: 'computer_use.bind' }, { name: 'computer_use.observe' }, { name: 'computer_use.act' }, { name: 'computer_use.run_procedure' }, { name: 'computer_use.control' }];",
    "}",
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/action-provider.manifest.json', JSON.stringify({
    actionSchema: {
      inputShape: {
        properties: {
          schemaVersion: {
            enum: [
              'sciforge.computer-use.bind-input.v1',
              'sciforge.computer-use.observe-input.v1',
              'sciforge.computer-use.act-input.v1',
              'sciforge.computer-use.run-procedure-input.v1',
              'sciforge.computer-use.control-input.v1',
            ],
          },
        },
      },
    },
    hostPortsContract: {
      requiredPorts: ['bind', 'observe', 'act', 'control'],
      forbiddenPorts: ['requestApproval', 'gui.present', 'gui.ask_user'],
    },
  }));
  return root;
}

function runGuard(root: string) {
  return spawnSync(process.execPath, [
    '--import',
    tsxLoader,
    join(process.cwd(), 'tools/check-computer-use-no-bypass.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('Computer Use no-bypass guard blocks runtime GUI completion surface registration', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(
    root,
    'src/runtime/codex/gui-completion-bypass.ts',
    "registerTool({ moduleId: 'gui', name: 'gui.present', description: 'complete the task' });\n",
  );

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-gui-completion-surface/);
});

test('Computer Use no-bypass guard ignores documentation and tests that mention forbidden GUI surfaces', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'docs/Architecture.md', 'Do not register gui.present or gui.ask_user as completion tools.\n');
  writeFixtureFile(root, 'src/runtime/codex/gui-completion-bypass.test.ts', "assert.match('gui.present', /gui\\.present/);\n");

  const result = runGuard(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Computer Use no-bypass guard blocks legacy Computer Use public surface', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/mcp.ts', [
    "export function computerUseMcpTools() {",
    "  return [{ name: 'computer_use.runTask' }, { name: 'computer_use.executeBoundedOperation' }, { name: 'computer_use.bind' }];",
    "}",
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-legacy-computer-use-public-surface/);
});

test('Computer Use no-bypass guard blocks retired runtime gui module surfaces', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/modules/dispatcher.ts', [
    "export const RUNTIME_MODULE_IDS = [",
    "  'gui',",
    "  'computer_use',",
    '] as const;',
    "if (moduleId === 'gui') throw new Error('retired');",
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-runtime-gui-module-surface/);
});

test('Computer Use no-bypass guard blocks ordinary route direct app module or materializer imports', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    "import { createVSCodeAppModule } from './vscode-app-module.js';",
    "import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';",
    'export const bypass = [createVSCodeAppModule, createDefaultComputerUseActMaterializer];',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-ordinary-chat-direct-computer-use-import/);
});

test('Computer Use no-bypass guard blocks runtime gateway direct app module or materializer imports', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/codex-runtime-gateway.ts', [
    "import { createVSCodeAppModule } from './vscode-app-module.js';",
    'export const bypass = createVSCodeAppModule;',
  ].join('\n'));
  writeFixtureFile(root, 'src/runtime/generation-gateway.ts', [
    "import { createDefaultComputerUseActMaterializer } from './codex/agent-host-computer-use-act-materializer.js';",
    'export const materializer = createDefaultComputerUseActMaterializer;',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-ordinary-chat-direct-computer-use-import/);
});

test('Computer Use no-bypass guard blocks bare ordinary VSCode native-route shortcuts', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    'function shouldRunNarrowCurrentVSCodeOrdinaryLiveDiagnostic(input: unknown) {',
    '  return /vscode/i.test(String(input));',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-bare-ordinary-vscode-native-shortcut/);
});
