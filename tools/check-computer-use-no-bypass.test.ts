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

test('Computer Use no-bypass guard blocks non-primitive public Computer Use intents', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/mcp.ts', [
    "export function computerUseMcpTools() {",
    "  return [{ name: 'computer_use.bind' }, { name: 'computer_use.plan' }, { name: 'computer_use.finalAnswer' }];",
    "}",
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/index.ts', [
    "export const COMPUTER_USE_PRIMITIVE_INTENTS = { bind: 'computer_use.bind', locate: 'computer_use.locate', verify: 'computer_use.verify' } as const;",
    "export const COMPUTER_USE_PRIMITIVE_NAMES = ['bind', 'observe', 'act', 'run_procedure', 'control', 'complete'] as const;",
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/action-provider.manifest.json', JSON.stringify({
    actionSchema: {
      inputShape: {
        properties: {
          schemaVersion: {
            enum: [
              'sciforge.computer-use.bind-input.v1',
              'sciforge.computer-use.plan-input.v1',
            ],
          },
          locate: {
            type: 'object',
          },
        },
      },
    },
    hostPortsContract: {
      requiredPorts: ['bind', 'observe', 'act', 'control', 'verify'],
    },
    mcpTools: [
      { name: 'computer_use.finalAnswer' },
    ],
  }));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-computer-use-public-primitive-surface/);
});

test('Computer Use no-bypass guard blocks MCP adapters returning primitive moduleResult directly', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/mcp.ts', [
    "import { moduleResult } from '@sciforge-ui/runtime-contract/modules';",
    "export function createComputerUseMcpAdapter(service: { bind(input: unknown): Promise<unknown> }) {",
    "  return {",
    "    tools: () => [{ name: 'computer_use.bind' }],",
    "    callTool: async (request: { arguments?: Record<string, unknown> }) => {",
    "      const primitiveOutput = await service.bind(request.arguments ?? {});",
    "      const moduleResultForPrimitive = moduleResult({ moduleId: 'computer_use', ok: true, value: primitiveOutput });",
    "      return moduleResultForPrimitive;",
    "    },",
    "  };",
    "}",
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-computer-use-mcp-direct-module-result|missing-computer-use-mcp-service-invoke/);
});

test('Computer Use no-bypass guard blocks product-ready shared-system-input claims', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/shared-system-capability.ts', [
    'export const SHARED_SYSTEM_INPUT_CAPABILITY = {',
    "  sharedSystemInputUsed: true,",
    "  maturity: 'product-ready',",
    "  productReady: true,",
    '};',
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/shared-system-capability.manifest.json', JSON.stringify({
    capability: {
      sharedSystemInput: true,
      maturity: 'product-ready',
      productReady: true,
    },
  }));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-shared-system-input-product-ready/);
});

test('Computer Use no-bypass guard allows diagnostic-only shared-system-input claims', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/shared-system-diagnostic.ts', [
    'export const SHARED_SYSTEM_INPUT_DIAGNOSTIC = {',
    "  sharedSystemInputUsed: true,",
    "  maturity: 'live-diagnostic',",
    "  productReady: false,",
    '};',
  ].join('\n'));
  writeFixtureFile(root, 'packages/actions/computer-use/shared-system-diagnostic.manifest.json', JSON.stringify({
    capability: {
      sharedSystemInput: true,
      maturity: 'live-diagnostic',
      productReady: false,
    },
  }));

  const result = runGuard(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
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

test('Computer Use no-bypass guard blocks VSCode operation inference from ordinary text fields', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    "type VSCodeOperation = 'read-visible-text' | 'focus-editor';",
    'function lowRiskVSCodeCoWorkOperationFromText(text: string): VSCodeOperation | undefined {',
    "  if (/read visible text/i.test(text)) return 'read-visible-text';",
    "  if (/focus editor/i.test(text)) return 'focus-editor';",
    '  return undefined;',
    '}',
    'export function route(input: { request: { commandText: string; prompt?: string; message?: string }; intentText?: string }) {',
    "  const text = input.request.commandText || input.request.prompt || input.request.message || input.intentText || '';",
    '  const operation = lowRiskVSCodeCoWorkOperationFromText(text);',
    '  return { vscodeCoWork: { operation } };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-vscode-operation-text-inference/);
});

test('Computer Use no-bypass guard blocks direct VSCode operation selection from commandText', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    "type VSCodeOperation = 'editor-scope';",
    'export function route(input: { request: { commandText: string } }) {',
    "  const operation: VSCodeOperation | undefined = input.request.commandText.includes('current selection') ? 'editor-scope' : undefined;",
    '  return { vscodeCoWork: { operation } };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-vscode-operation-text-inference/);
});

test('Computer Use no-bypass guard blocks command palette operation inference from labels or commandText', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    "type VSCodeOperation = 'select-command-palette-item';",
    'function paletteOperationFromCommandText(commandText: string, paletteLabel: string): VSCodeOperation | undefined {',
    "  if (/Save File/i.test(paletteLabel) || /save/i.test(commandText)) return 'select-command-palette-item';",
    '  return undefined;',
    '}',
    'export function route(input: { request: { commandText: string }; paletteLabel: string }) {',
    '  const operation = paletteOperationFromCommandText(input.request.commandText, input.paletteLabel);',
    '  return { vscodeCoWork: { operation } };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-vscode-operation-text-inference/);
});

test('Computer Use no-bypass guard blocks palette live diagnostic operation inference from text fields', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/agent-host-vscode-cowork-current-live-diagnostic.ts', [
    "type VSCodeOperation = 'open-command-palette' | 'select-command-palette-item';",
    'export function runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic(input: { commandText: string; paletteLabel: string }) {',
    "  const operation: VSCodeOperation = /Save File/i.test(input.paletteLabel) || /save/i.test(input.commandText)",
    "    ? 'select-command-palette-item'",
    "    : 'open-command-palette';",
    '  return { operation };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-vscode-operation-text-inference/);
});

test('Computer Use no-bypass guard allows structured Host VSCode operation refs', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    'function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {',
    "  const item = value?.[key];",
    "  return typeof item === 'string' ? item : undefined;",
    '}',
    'export function route(agentHostInput: { target?: { vscodeCoWork?: Record<string, unknown> } }) {',
    '  const hostBinding = agentHostInput.target?.vscodeCoWork;',
    "  const operation = stringField(hostBinding, 'operation');",
    "  const operationRef = stringField(hostBinding, 'operationRef');",
    '  return { vscodeCoWork: { operation, operationRef } };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Computer Use no-bypass guard blocks VSCode app module direct desktop or executor access', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/vscode-app-module.ts', [
    "import { createComputerUsePrimitiveService } from '../../packages/actions/computer-use/index.js';",
    "import { createComputerUseMcpAdapter } from '../../packages/actions/computer-use/mcp.js';",
    "import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';",
    'export function createVSCodeAppModule() {',
    '  return {',
    "    moduleId: 'vscode',",
    '    canHandle: () => true,',
    '    normalizeObservation: ({ refs }: { refs: string[] }) => ({ refs }),',
    '    getCapabilities: () => [],',
    '    checkReadiness: () => {',
    "      createComputerUsePrimitiveService({} as never);",
    "      createComputerUseMcpAdapter({} as never);",
    "      createDefaultComputerUseActMaterializer();",
    "      return { status: 'blocked', reasonRef: 'blocked:vscode', evidenceRefs: [] };",
    '    },',
    '  };',
    '}',
  ].join('\n'));
  writeFixtureFile(root, 'src/runtime/codex/vscode-app-module-direct-desktop.ts', [
    'export async function directDesktop() {',
    "  await service.invoke({ primitive: 'act' });",
    "  await desktopController.click({ x: 10, y: 20 });",
    "  await systemInput.typeText('hello');",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-vscode-app-module-direct-desktop-access/);
});

test('Computer Use no-bypass guard blocks UI native final-answer synthesis bypasses', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts', [
    'function runtimeDoneNativeMessage(done: Record<string, unknown>) {',
    "  return String(done.finalText ?? done.message ?? '');",
    '}',
    'export function projectNative(done: Record<string, unknown>) {',
    "  return { nativeCodexMessage: runtimeDoneNativeMessage(done), finalAnswerEnvelope: true };",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-ui-native-final-answer-bypass/);
});

test('Computer Use no-bypass guard blocks raw public event payload literals', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/codex-runtime-gateway.ts', [
    'export function emitLeakyPublicEvent(callbacks: { onEvent?: (event: unknown) => void }) {',
    '  emitWorkspaceRuntimeEvent(callbacks, {',
    "    type: 'codex-runtime-progress',",
    "    rawScreenshotPath: '/tmp/private/screenshot.png',",
    "    screenshotBase64: 'data:image/png;base64,SECRET_IMAGE',",
    "    providerPayload: { requestBody: 'SECRET_PROVIDER_PAYLOAD' },",
    "    rawCommand: 'rm -rf /tmp/private',",
    "    rawPath: '/Users/example/private.txt',",
    '  });',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing-public-event-sanitizer|forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks raw app module readiness public payload literals', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/agent-host-computer-use-app-module-materializer.ts', [
    'export function readinessArtifact() {',
    '  return {',
    "    type: 'computer-use-app-module-readiness',",
    "    data: { rawCommand: 'npm test', providerPayload: { requestBody: 'SECRET_PROVIDER_PAYLOAD' } },",
    '  };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks raw diff and URL alias public payload literals', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/agent-host-computer-use-app-module-materializer.ts', [
    "import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';",
    'export function readinessArtifact() {',
    '  return sanitizePublicEvent({',
    "    type: 'computer-use-app-module-readiness',",
    "    data: { rawDiff: '@@ SECRET_DIFF', requestedUrl: 'https://example.invalid/private', href: 'https://example.invalid/link' },",
    '  });',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks raw diff and URL aliases on sanitizer lines', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/codex-runtime-gateway.ts', [
    "import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';",
    'export function emitPreview(callbacks: { onEvent?: (event: unknown) => void }) {',
    "  emitWorkspaceRuntimeEvent(callbacks, sanitizePublicEvent({ type: 'codex-runtime-progress', preview: { rawDiff: '@@ SECRET_DIFF', url: 'https://example.invalid/url', href: 'https://example.invalid/href', rawUrl: 'https://example.invalid/raw', requestedUrl: 'https://example.invalid/requested', currentUrl: 'https://example.invalid/current', finalUrl: 'https://example.invalid/final', providerPayload: { requestBody: 'SECRET_PROVIDER' } } }));",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks scope selected and visible text projection aliases', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/agent-host-computer-use-app-module-materializer.ts', [
    "import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';",
    'export function readinessArtifact() {',
    "  return sanitizePublicEvent({ type: 'computer-use-app-module-readiness', data: { selectedText: 'SECRET_SELECTED', visibleText: 'SECRET_VISIBLE' } });",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard allows unsafe pattern definitions while blocking raw payload emission', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/codex/computer-use-native-route.ts', [
    "import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';",
    "const UNSAFE_APPROVAL_REF_STRING_PATTERN = /(?:providerPayload|data:[^,\\s]+;base64,|https?:\\/\\/)/i;",
    'export function approvalRequestFromResult() {',
    "  return sanitizePublicEvent({ type: 'computer-use.approval', refs: ['approval-ref:local:1'] });",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Computer Use no-bypass guard blocks raw package bridge presentation payload literals', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/runtime/computer-use/package-bridge-presentation.ts', [
    'export function attachPackageResultHostActions(payload: { objectReferences?: unknown[]; logs?: unknown[] }) {',
    "  payload.objectReferences = [{ data: { actions: [{ payload: { rawPath: '/Users/example/private.txt' } }] } }];",
    "  payload.logs = [{ kind: 'computer-use-tui-host-actions', providerPayload: { token: 'SECRET_PROVIDER_TOKEN' } }];",
    "  emitWorkspaceRuntimeEvent({}, { type: 'computer-use.tui-host-actions', detail: JSON.stringify({ screenshotBase64: 'data:image/png;base64,SECRET' }) });",
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks raw primitive package result payload literals', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'packages/actions/computer-use/index.ts', [
    'export function primitiveModuleResult() {',
    '  return moduleResult({',
    "    value: { output: { stdout: 'SECRET_STDOUT', commandText: 'npm test', workspacePath: '/Applications/workspace/private' } },",
    "    diagnostics: [{ requestBody: 'SECRET_REQUEST_BODY' }],",
    '  });',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-public-event-raw-payload/);
});

test('Computer Use no-bypass guard blocks structured runtime done visible answer text', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/ui/src/api/sciforgeToolsClient/runtimeEvents.ts', [
    'function withStructuredRuntimeDoneProjection(result: Record<string, unknown>) {',
    "  const message = String(result.message ?? 'Runtime Codex materialized structured artifacts.');",
    '  return {',
    '    displayIntent: { conversationProjection: { visibleAnswer: { status: "partial-ready", text: message } } },',
    '    output: { message },',
    '  };',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-structured-runtime-visible-answer-text/);
});

test('Computer Use no-bypass guard blocks GUI projection live acceptance eligibility', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/ui/src/api/sciforgeToolsClient/runtimeGuiPresentation.ts', [
    'export function attachRuntimeGuiPresentationToResponse(response: unknown, result: { guiPresentation?: { source?: string } }) {',
    '  const source = result.guiPresentation?.source;',
    "  if (source?.startsWith('gui.present:')) {",
    '    return { message: { provenance: { liveAcceptanceEligible: true } } };',
    '  }',
    '  return response;',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /forbidden-gui-projection-live-acceptance/);
});

test('Computer Use no-bypass guard requires legacy GUI projection fail-closed in response normalization', () => {
  const root = minimalRepoFixture();
  writeFixtureFile(root, 'src/ui/src/api/agentClient/responseNormalization.ts', [
    'function projectionVisibleAnswer(value: { displayIntent?: { conversationProjection?: { visibleAnswer?: { text?: string } } } }) {',
    '  const visibleAnswer = value.displayIntent?.conversationProjection?.visibleAnswer;',
    '  return visibleAnswer?.text ? { text: visibleAnswer.text } : undefined;',
    '}',
  ].join('\n'));

  const result = runGuard(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing-legacy-gui-projection-fail-closed/);
});
