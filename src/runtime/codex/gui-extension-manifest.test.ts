import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import { createFileBackedGuiProtocolController, loadGuiExtensionSnapshot, saveGuiExtensionSnapshot } from './gui-extension-state.js';
import { GUI_NATIVE_RESOURCE_URIS, GUI_NATIVE_TOOL_NAMES, prepareRuntimeGuiExtensionInjection, runtimeGuiExtensionManifest } from './gui-extension-manifest.js';
import { callGuiMcpTool } from './gui-mcp-tools.js';

test('Runtime GUI extension manifest exposes native MCP resources and gui tools only', async () => {
  const workspace = await tempWorkspace();
  const statePath = join(workspace, 'gui-state.json');
  const injection = await prepareRuntimeGuiExtensionInjection({ statePath });
  assert.ok(injection);
  const manifest = runtimeGuiExtensionManifest(injection);

  assert.deepEqual(injection.toolNames, [
    'gui.get_context',
    'gui.list',
    'gui.read',
    'gui.search',
    'gui.stat',
    'gui.present',
    'gui.notify',
    'gui.set_status',
  ]);
  assert.deepEqual(injection.resourceUris, [
    'sciforge-gui:/gui/shell.json',
    'sciforge-gui:/gui/hot-region.json',
    'sciforge-gui:/gui/intent-log.json',
  ]);
  assert.equal(JSON.stringify(manifest).includes('capability'), false);
  assert.equal(JSON.stringify(manifest).includes('provider route'), false);
  assert.deepEqual(GUI_NATIVE_TOOL_NAMES, injection.toolNames);
  assert.deepEqual(GUI_NATIVE_RESOURCE_URIS, injection.resourceUris);
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
  const deferred = callGuiMcpTool(controller, 'gui.present', {
    intent: 'show-diff',
    content: { kind: 'diff', value: 'diff --git a/report.md b/report.md' },
    precondition: { expectedRevision: 5, avoidIfUserEditing: true },
  }).structuredContent as { ok: boolean; deferred: boolean; reason: string; suggestions: Array<Record<string, unknown>> };
  const logRead = callGuiMcpTool(controller, 'gui.read', { path: '/gui/intent-log.json' }).structuredContent as { content: string };
  const log = JSON.parse(logRead.content) as { entries: Array<{ tool: string; reason: string }> };

  assert.equal(context.hotRegion.interactionMode, 'editing');
  assert.equal(stat.readonly, true);
  assert.equal(deferred.ok, false);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.reason, 'user-editing');
  assert.deepEqual(deferred.suggestions, [{ action: 'defer', until: 'editing-complete' }, { action: 'notify-only' }]);
  assert.deepEqual(log.entries.map((entry) => [entry.tool, entry.reason]), [['gui.present', 'user-editing']]);
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
