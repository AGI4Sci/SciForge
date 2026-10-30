import assert from 'node:assert/strict';
import test from 'node:test';
import { PPT_MASTER_MCP_FLAG } from './contract.js';
import { pptMasterMcpServerOptionsFromArgv, registerPptMasterTools } from './server.js';
import type { PptMasterService } from './service.js';

test('registers the staged ppt-master MCP tool surface with safety annotations', () => {
  const registered: Array<{ name: string; config: Record<string, unknown> }> = [];
  const service = {
    status: async () => ({}),
    projectStatus: async () => ({}),
    convertSource: async () => ({}),
    initProject: async () => ({}),
    sciforgeIntake: async () => ({}),
    splitNotes: async () => ({}),
    qualityCheck: async () => ({}),
    finalizeSvg: async () => ({}),
    exportPptx: async () => ({})
  } as unknown as PptMasterService;

  registerPptMasterTools({
    registerTool(name, config) {
      registered.push({ name, config });
    }
  }, service);

  assert.deepEqual(registered.map((tool) => tool.name), [
    'ppt_master_status',
    'ppt_master_project_status',
    'ppt_master_convert_source',
    'ppt_master_init_project',
    'ppt_master_sciforge_intake',
    'ppt_master_split_notes',
    'ppt_master_quality_check',
    'ppt_master_finalize_svg',
    'ppt_master_export_pptx'
  ]);
  assert.equal((registered.find((tool) => tool.name === 'ppt_master_status')?.config.annotations as { readOnlyHint?: boolean }).readOnlyHint, true);
  assert.equal((registered.find((tool) => tool.name === 'ppt_master_convert_source')?.config.annotations as { openWorldHint?: boolean }).openWorldHint, true);
  assert.equal((registered.find((tool) => tool.name === 'ppt_master_sciforge_intake')?.config.annotations as { readOnlyHint?: boolean }).readOnlyHint, false);
  const intakeSchema = registered.find((tool) => tool.name === 'ppt_master_sciforge_intake')?.config.inputSchema as Record<string, unknown>;
  assert.ok(intakeSchema.stylePreset);
  assert.ok(intakeSchema.figures);
});

test('parses workspace root from ppt-master MCP argv', () => {
  assert.deepEqual(
    pptMasterMcpServerOptionsFromArgv(['node', 'entry.js', PPT_MASTER_MCP_FLAG, '--workspace-root', '/tmp/workspace']),
    { workspaceRoot: '/tmp/workspace' }
  );
  assert.equal(pptMasterMcpServerOptionsFromArgv(['node', 'entry.js']), null);
});

test('passes launch workspace root to bounded write tool handlers', async () => {
  type RegisteredTool = {
    name: string;
    config: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  };
  const registered: RegisteredTool[] = [];
  const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const service = {
    status: async () => ({}),
    projectStatus: async () => ({}),
    convertSource: async () => ({}),
    initProject: async (input: Record<string, unknown>) => {
      calls.push({ tool: 'init', input });
      return {};
    },
    sciforgeIntake: async (input: Record<string, unknown>) => {
      calls.push({ tool: 'intake', input });
      return {};
    },
    splitNotes: async (input: Record<string, unknown>) => {
      calls.push({ tool: 'split', input });
      return {};
    },
    qualityCheck: async () => ({}),
    finalizeSvg: async (input: Record<string, unknown>) => {
      calls.push({ tool: 'finalize', input });
      return {};
    },
    exportPptx: async (input: Record<string, unknown>) => {
      calls.push({ tool: 'export', input });
      return {};
    }
  } as unknown as PptMasterService;

  registerPptMasterTools({
    registerTool(name, config, handler) {
      registered.push({ name, config, handler });
    }
  }, service, { workspaceRoot: '/tmp/workspace' });

  async function callTool(name: string, args: Record<string, unknown>) {
    const tool = registered.find((entry) => entry.name === name);
    assert.ok(tool);
    const result = await tool.handler(args);
    assert.equal((result as { isError?: boolean }).isError, undefined);
  }

  await callTool('ppt_master_init_project', { deckSlug: 'demo' });
  await callTool('ppt_master_sciforge_intake', { deckSlug: 'demo' });
  await callTool('ppt_master_split_notes', { projectPath: 'presentations/demo' });
  await callTool('ppt_master_finalize_svg', { projectPath: 'presentations/demo' });
  await callTool('ppt_master_export_pptx', { projectPath: 'presentations/demo' });

  assert.deepEqual(calls.map((call) => call.tool), ['init', 'intake', 'split', 'finalize', 'export']);
  assert.deepEqual(calls.map((call) => call.input.workspaceRoot), [
    '/tmp/workspace',
    '/tmp/workspace',
    '/tmp/workspace',
    '/tmp/workspace',
    '/tmp/workspace'
  ]);
});
