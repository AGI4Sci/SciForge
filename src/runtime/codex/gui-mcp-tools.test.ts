import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import { GUI_NATIVE_TOOL_NAMES } from './gui-extension-manifest.js';
import { callGuiMcpTool } from './gui-mcp-tools.js';

test('GUI MCP tool dispatcher supports the complete protocol surface', () => {
  const controller = createGuiProtocolController({
    revision: 30,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
      availableActions: [{ label: 'Ask about report', commandText: 'ask --ref artifact:report "Summarize it"' }],
    },
    regions: [{
      regionId: 'results',
      title: 'Results',
      summary: 'Report is visible.',
      visibleRefs: ['artifact:report'],
      affordances: [{ label: 'Ask about report', commandText: 'ask --ref artifact:report "Summarize it"' }],
    }],
  });

  const calls: Array<[typeof GUI_NATIVE_TOOL_NAMES[number], Record<string, unknown>]> = [
    ['gui.present', { intent: 'show-artifact', ref: 'artifact:report', title: 'Report' }],
    ['gui.ask_user', { kind: 'confirmation', title: 'Continue?', choices: [{ label: 'Continue', commandText: '/approve approval-1' }] }],
    ['gui.notify', { level: 'info', message: 'Heads up.' }],
    ['gui.set_status', { text: 'Idle', tone: 'neutral' }],
    ['gui.apply_batch', { atomicity: 'best-effort', ops: [{ tool: 'set_status', args: { text: 'Batch idle', tone: 'neutral' } }] }],
    ['gui.get_context', { level: 'hot-region' }],
    ['gui.list', { path: '/gui' }],
    ['gui.read', { path: '/gui/hot-region.json' }],
    ['gui.search', { query: 'artifact:report', kinds: ['ref'] }],
    ['gui.stat', { path: '/gui/shell.json' }],
    ['gui.watch', { path: '/gui/hot-region.json', sinceRevision: 0 }],
  ];

  assert.deepEqual(calls.map(([name]) => name), [...GUI_NATIVE_TOOL_NAMES]);
  for (const [name, args] of calls) {
    const result = callGuiMcpTool(controller, name, args);
    assert.equal(result.content[0].type, 'text');
    assert.equal(typeof result.content[0].text, 'string');
    assert.equal(typeof result.structuredContent, 'object');
  }
});
