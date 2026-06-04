import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import { createFileBackedGuiProtocolController, loadGuiExtensionSnapshot, saveGuiExtensionSnapshot } from './gui-extension-state.js';
import { GUI_EXTENSION_STATE_ENV, GUI_NATIVE_RESOURCE_URIS, GUI_NATIVE_TOOL_NAMES, prepareRuntimeGuiExtensionInjection, runtimeGuiExtensionManifest } from './gui-extension-manifest.js';
import { callGuiMcpTool } from './gui-mcp-tools.js';

test('Runtime GUI extension manifest exposes native MCP resources and gui tools only', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  const injection = await prepareRuntimeGuiExtensionInjection({ statePath });
  assert.ok(injection);
  const manifest = runtimeGuiExtensionManifest(injection);

  assert.deepEqual(injection.toolNames, [
    'gui.present',
    'gui.ask_user',
    'gui.notify',
    'gui.set_status',
    'gui.apply_batch',
    'gui.get_context',
    'gui.list',
    'gui.read',
    'gui.search',
    'gui.stat',
    'gui.watch',
  ]);
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/shell.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/hot-region.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/intent-log.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/regions/sidebar/summary.md'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/regions/sidebar/refs.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/regions/sidebar/actions.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/capabilities/presentation.json'));
  assert.ok(injection.resourceUris.includes('sciforge-gui:/gui/renderers/report-viewer.json'));
  assert.ok(injection.resourceUris.every((uri) => uri.startsWith('sciforge-gui:/gui/')));
  assert.equal(JSON.stringify(manifest).includes('task capability'), false);
  assert.equal(JSON.stringify(manifest).includes('provider route'), false);
  assert.equal(JSON.stringify(manifest).includes('React'), false);
  assert.deepEqual(GUI_NATIVE_TOOL_NAMES, injection.toolNames);
  assert.deepEqual(GUI_NATIVE_RESOURCE_URIS, injection.resourceUris);
});

test('Runtime GUI MCP resources expose presentation catalog without task rankings or workspace mutation', () => {
  const controller = createGuiProtocolController({ revision: 6, updatedAt: '2026-05-21T00:00:00.000Z' });

  const list = callGuiMcpTool(controller, 'gui.list', { path: '/gui/capabilities' }).structuredContent as { value: Array<{ path: string }> };
  const catalogRead = callGuiMcpTool(controller, 'gui.read', { path: '/gui/capabilities/presentation.json' }).structuredContent as { content: string; truncated: boolean };
  const rendererRead = callGuiMcpTool(controller, 'gui.read', { path: '/gui/renderers/report-viewer.json' }).structuredContent as { content: string };
  const search = callGuiMcpTool(controller, 'gui.search', {
    scope: '/gui/capabilities',
    query: 'markdown report',
    kinds: ['renderer', 'artifact-type', 'preview-kind', 'visible-text'],
  }).structuredContent as { value: Array<{ path: string; kind: string; text: string }> };
  const stat = callGuiMcpTool(controller, 'gui.stat', { path: '/gui/capabilities/presentation.json' }).structuredContent as { readonly: boolean; kind: string };

  const catalog = JSON.parse(catalogRead.content) as { schemaVersion: string; source: string; components: Array<{ componentId: string; lifecycleLayer: string; safety: { writesWorkspace: boolean } }> };
  const renderer = JSON.parse(rendererRead.content) as { componentId: string; boundary: Record<string, boolean>; previewKinds: string[] };
  const combined = [catalogRead.content, rendererRead.content, JSON.stringify(search)].join('\n');

  assert.deepEqual(list.value.map((entry) => entry.path), ['/gui/capabilities/presentation.json']);
  assert.equal(catalogRead.truncated, false);
  assert.equal(catalog.schemaVersion, 'sciforge.gui-presentation-catalog.v1');
  assert.equal(catalog.source, 'packages/presentation/components');
  assert.ok(catalog.components.every((component) => component.lifecycleLayer === 'presentation' && component.safety.writesWorkspace === false));
  assert.equal(renderer.componentId, 'report-viewer');
  assert.ok(renderer.previewKinds.includes('markdown'));
  assert.equal(renderer.boundary.taskCapability, false);
  assert.equal(renderer.boundary.providerRoute, false);
  assert.equal(renderer.boundary.importsReactComponent, false);
  assert.ok(search.value.some((item) => item.path === '/gui/renderers/report-viewer.json'));
  assert.equal(stat.readonly, true);
  assert.equal(stat.kind, 'file');
  assert.doesNotMatch(combined, /"providerRoute"\s*:\s*true|"algorithmRecommendation"\s*:\s*true|"importsReactComponent"\s*:\s*true|task ranking/i);
});

test('Runtime GUI extension also exposes gui present wrapper for shell-style probes', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  const injection = await prepareRuntimeGuiExtensionInjection({ statePath });
  assert.ok(injection);

  const wrapperOutput = await execFileText(
    join(injection.binDir, 'gui'),
    [
      'present',
      '--intent',
      'show-result',
      '--title',
      'Wrapper result',
      '--ref',
      'artifact:wrapper-result',
      '--content',
      'WRAPPER_RESULT_READY',
    ],
    { [GUI_EXTENSION_STATE_ENV]: statePath },
  );
  const snapshot = await loadGuiExtensionSnapshot(statePath);
  const intentLog = snapshot.intentLog ?? [];
  const regions = snapshot.regions ?? [];

  assert.match(wrapperOutput, /"tool":"gui\.present"/);
  assert.equal(intentLog.at(-1)?.tool, 'gui.present');
  assert.equal(intentLog.at(-1)?.applied, true);
  assert.equal(regions.at(-1)?.visibleRefs?.at(-1), 'artifact:wrapper-result');
});

test('Runtime GUI extension prefers compiled JS entrypoints without tsx loader', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  const runtimeDir = join(workspace, 'dist-desktop', 'src', 'runtime', 'codex');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(join(runtimeDir, 'gui-mcp-server.js'), 'export {};\n', 'utf8');
  await writeFile(join(runtimeDir, 'gui-mcp-server.ts'), 'export {};\n', 'utf8');
  await writeFile(join(runtimeDir, 'gui-present-cli.js'), 'export {};\n', 'utf8');
  await writeFile(join(runtimeDir, 'gui-present-cli.ts'), 'export {};\n', 'utf8');

  const injection = await prepareRuntimeGuiExtensionInjection({ statePath, runtimeDir });
  assert.ok(injection);

  const argsConfig = injection.configArgs.find((arg) => arg.startsWith('mcp_servers.sciforge_gui.args='));
  assert.ok(argsConfig);
  assert.match(argsConfig, /gui-mcp-server\.js/);
  assert.doesNotMatch(argsConfig, /--import|tsx|gui-mcp-server\.ts/);

  const shim = await readFile(injection.shimPath, 'utf8');
  assert.match(shim, /exec node .*gui-present-cli\.js/);
  assert.doesNotMatch(shim, /--import|tsx|gui-present-cli\.ts/);
});

test('Runtime GUI extension resolves bundled codex entrypoints from a parent runtime directory', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  const runtimeDir = join(workspace, 'dist-desktop', 'src', 'runtime');
  const codexDir = join(runtimeDir, 'codex');
  await mkdir(codexDir, { recursive: true });
  await writeFile(join(codexDir, 'gui-mcp-server.js'), 'export {};\n', 'utf8');
  await writeFile(join(codexDir, 'gui-present-cli.js'), 'export {};\n', 'utf8');

  const injection = await prepareRuntimeGuiExtensionInjection({ statePath, runtimeDir });
  assert.ok(injection);

  const argsConfig = injection.configArgs.find((arg) => arg.startsWith('mcp_servers.sciforge_gui.args='));
  assert.ok(argsConfig);
  assert.match(argsConfig, /codex.*gui-mcp-server\.js/);
  assert.doesNotMatch(argsConfig, /gui-mcp-server\.ts|tsx/);

  const shim = await readFile(injection.shimPath, 'utf8');
  assert.match(shim, /codex.*gui-present-cli\.js/);
  assert.doesNotMatch(shim, /gui-present-cli\.ts|tsx/);
});

test('Runtime GUI MCP tools read semantic resources and negotiate presentation preconditions', () => {
  const controller = createGuiProtocolController({
    revision: 5,
    focusedPanel: 'composer',
    hotRegion: {
      panel: 'composer',
      selectedRefs: ['artifact:draft'],
      interactionMode: 'editing',
      lastChangeOrigin: 'user',
      lastChangeAt: new Date().toISOString(),
    },
  });

  const context = callGuiMcpTool(controller, 'gui.get_context', { level: 'hot-region' }).structuredContent as { hotRegion: { interactionMode: string } };
  const stat = callGuiMcpTool(controller, 'gui.stat', { path: '/gui/hot-region.json' }).structuredContent as { readonly: boolean };
  const watch = callGuiMcpTool(controller, 'gui.watch', { path: '/gui/hot-region.json', sinceRevision: 4 }).structuredContent as { semanticOnly: boolean; includesRawDom: boolean; events: Array<{ kind: string }> };
  const deferred = callGuiMcpTool(controller, 'gui.present', {
    intent: 'show-diff',
    content: { kind: 'diff', value: 'diff --git a/report.md b/report.md' },
    precondition: { expectedRevision: 5, avoidIfUserEditing: true },
  }).structuredContent as { ok: boolean; deferred: boolean; reason: string; suggestions: Array<Record<string, unknown>> };
  const logRead = callGuiMcpTool(controller, 'gui.read', { path: '/gui/intent-log.json' }).structuredContent as { content: string };
  const log = JSON.parse(logRead.content) as { entries: Array<{ tool: string; reason: string }> };

  assert.equal(context.hotRegion.interactionMode, 'editing');
  assert.equal(stat.readonly, true);
  assert.equal(watch.semanticOnly, true);
  assert.equal(watch.includesRawDom, false);
  assert.deepEqual(watch.events.map((event) => event.kind), ['changed']);
  assert.equal(deferred.ok, false);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.reason, 'user-editing');
  assert.deepEqual(deferred.suggestions, [{ action: 'defer', until: 'editing-complete' }, { action: 'notify-only' }]);
  assert.deepEqual(log.entries.map((entry) => [entry.tool, entry.reason]), [['gui.present', 'user-editing']]);
});

test('Runtime GUI MCP ask_user and apply_batch persist GUI intent state', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  await saveGuiExtensionSnapshot(statePath, {
    revision: 3,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
  });
  const { controller, flush } = await createFileBackedGuiProtocolController(statePath);

  const ask = callGuiMcpTool(controller, 'gui.ask_user', {
    kind: 'choice',
    title: 'Choose next step',
    choices: [
      { label: 'Explain report', commandText: 'ask --ref artifact:report "Explain the report"' },
      { label: 'Cancel', commandText: '/reject approval-789' },
      { label: 'Unsafe', commandText: 'triggerRecover({ runId: "run-1" })' },
    ],
  }).structuredContent as { ok: boolean; placement: { panel: string } };
  const batch = callGuiMcpTool(controller, 'gui.apply_batch', {
    atomicity: 'best-effort',
    ops: [
      { tool: 'set_status', args: { text: 'Waiting for user choice', tone: 'running' } },
      { tool: 'notify', args: { level: 'info', message: 'Choice requested.' } },
    ],
  }).structuredContent as { ok: boolean; operationResults: Array<{ ok: boolean }> };
  await flush();

  const uiReader = createGuiProtocolController(await loadGuiExtensionSnapshot(statePath));
  const shell = JSON.parse(uiReader.read({ path: '/gui/shell.json' }).content) as { pendingModal: { kind: string } };
  const actions = JSON.parse(uiReader.read({ path: '/gui/regions/modal/actions.json' }).content) as { actions: Array<{ commandText: string }> };
  const intentLog = JSON.parse(uiReader.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<{ tool: string; applied: boolean }> };

  assert.equal(ask.ok, true);
  assert.equal(ask.placement.panel, 'modal');
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.operationResults.map((result) => result.ok), [true, true]);
  assert.equal(shell.pendingModal.kind, 'choice');
  assert.deepEqual(actions.actions.map((action) => action.commandText), ['ask --ref artifact:report "Explain the report"', '/reject approval-789']);
  assert.deepEqual(intentLog.entries.map((entry) => [entry.tool, entry.applied]), [
    ['gui.ask_user', true],
    ['gui.apply_batch', true],
  ]);
});

test('TUI gui.present writes intent state that the UI resource reader can load', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  await saveGuiExtensionSnapshot(statePath, {
    revision: 9,
    focusedPanel: 'chat',
    hotRegion: {
      panel: 'chat',
      selectedRefs: [],
      interactionMode: 'idle',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
  });
  const { controller, flush } = await createFileBackedGuiProtocolController(statePath);

  const result = callGuiMcpTool(controller, 'gui.present', {
    intent: 'show-result',
    ref: 'artifact:runtime-answer',
    title: 'Runtime answer',
    content: { kind: 'markdown', value: 'Runtime Codex produced a visible answer.' },
    precondition: { expectedRevision: 9 },
  }).structuredContent as { ok: boolean; appliedRevision: number; placement: { panel: string } };
  await flush();

  const uiReader = createGuiProtocolController(await loadGuiExtensionSnapshot(statePath));
  const intentLog = JSON.parse(uiReader.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<{ tool: string; applied: boolean; summary: string }> };
  const hotRegion = JSON.parse(uiReader.read({ path: '/gui/hot-region.json' }).content) as { hotRegion: { primaryRef: string; lastChangeOrigin: string } };

  assert.equal(result.ok, true);
  assert.equal(result.appliedRevision, 10);
  assert.equal(result.placement.panel, 'chat');
  assert.equal(hotRegion.hotRegion.primaryRef, 'artifact:runtime-answer');
  assert.equal(hotRegion.hotRegion.lastChangeOrigin, 'agent');
  assert.deepEqual(intentLog.entries.map((entry) => [entry.tool, entry.applied, entry.summary]), [
    ['gui.present', true, 'show-result artifact:runtime-answer Runtime answer'],
  ]);
});

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-gui-extension-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function execFileText(command: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout.toString());
    });
  });
}
