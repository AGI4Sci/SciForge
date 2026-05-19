#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { createFileBackedGuiProtocolController } from './gui-extension-state.js';
import { GUI_EXTENSION_STATE_ENV, GUI_NATIVE_RESOURCE_URIS, GUI_NATIVE_TOOL_NAMES } from './gui-extension-manifest.js';
import { callGuiMcpTool, type GuiMcpToolName } from './gui-mcp-tools.js';

const statePath = process.env[GUI_EXTENSION_STATE_ENV];
if (!statePath) throw new Error(`${GUI_EXTENSION_STATE_ENV} is required for the SciForge GUI MCP server.`);

const { controller, flush } = await createFileBackedGuiProtocolController(statePath);
const server = new McpServer({ name: 'sciforge-gui', version: '0.1.0' });

for (const uri of GUI_NATIVE_RESOURCE_URIS) {
  server.registerResource(uriToName(uri), uri, {
    title: uri,
    description: 'Read-only SciForge GUI semantic resource.',
    mimeType: uri.endsWith('.json') ? 'application/json' : 'text/markdown',
  }, async (resourceUri) => {
    const path = resourceUri.pathname;
    const result = controller.read({ path });
    return {
      contents: [{
        uri,
        mimeType: result.mimeType,
        text: result.content,
      }],
    };
  });
}

for (const toolName of GUI_NATIVE_TOOL_NAMES) {
  const handler = async (args: unknown) => {
    const result = callGuiMcpTool(controller, toolName, args as Record<string, unknown>);
    if (isIntentTool(toolName)) {
      await flush();
    }
    return result;
  };
  server.registerTool(toolName, toolConfig(toolName) as Parameters<typeof server.registerTool>[1], handler as never);
}

await server.connect(new StdioServerTransport());

function toolConfig(name: GuiMcpToolName) {
  const annotations = {
    readOnlyHint: !isIntentTool(name),
    destructiveHint: false,
    idempotentHint: !['gui.present', 'gui.ask_user', 'gui.apply_batch'].includes(name),
    openWorldHint: false,
  };
  const description = toolDescription(name);
  if (name === 'gui.get_context') return { description, inputSchema: { level: z.string().optional(), regionId: z.string().optional() }, annotations };
  if (name === 'gui.list') return { description, inputSchema: { path: z.string() }, annotations };
  if (name === 'gui.read') return { description, inputSchema: { path: z.string(), maxBytes: z.number().optional() }, annotations };
  if (name === 'gui.search') return { description, inputSchema: { query: z.string(), scope: z.string().optional(), kinds: z.array(z.string()).optional() }, annotations };
  if (name === 'gui.stat') return { description, inputSchema: { path: z.string() }, annotations };
  if (name === 'gui.watch') return { description, inputSchema: { path: z.string(), events: z.array(z.enum(['changed', 'removed', 'permission-changed'])).optional(), sinceRevision: z.number().optional() }, annotations };
  if (name === 'gui.ask_user') {
    return {
      description,
      inputSchema: {
        kind: z.enum(['confirmation', 'input', 'choice']),
        title: z.string(),
        message: z.string().optional(),
        precondition: z.record(z.string(), z.unknown()).optional(),
        submitCommandTemplate: z.string().optional(),
        choices: z.array(z.object({ label: z.string(), commandText: z.string(), style: z.enum(['primary', 'secondary', 'danger']).optional() })).optional(),
      },
      annotations,
    };
  }
  if (name === 'gui.notify') return { description, inputSchema: { level: z.enum(['info', 'success', 'warning', 'error']), message: z.string(), precondition: z.record(z.string(), z.unknown()).optional() }, annotations };
  if (name === 'gui.set_status') return { description, inputSchema: { text: z.string(), tone: z.enum(['neutral', 'running', 'success', 'warning', 'error']).optional(), precondition: z.record(z.string(), z.unknown()).optional() }, annotations };
  if (name === 'gui.apply_batch') {
    return {
      description,
      inputSchema: {
        atomicity: z.enum(['all-or-nothing', 'best-effort']),
        precondition: z.record(z.string(), z.unknown()).optional(),
        ops: z.array(z.object({
          tool: z.enum(['present', 'notify', 'set_status']),
          args: z.record(z.string(), z.unknown()),
        })),
      },
      annotations,
    };
  }
  return {
    description,
    inputSchema: {
      intent: z.enum(['show-result', 'show-artifact', 'show-diff', 'show-debug', 'show-progress-detail', 'focus-existing']),
      ref: z.string().optional(),
      content: z.object({ kind: z.enum(['markdown', 'table', 'diff', 'image', 'json']), value: z.unknown() }).optional(),
      title: z.string().optional(),
      hint: z.enum(['markdown', 'table', 'diff', 'image', 'notebook', 'auto']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      target: z.object({ panel: z.string().optional(), viewId: z.string().optional() }).optional(),
      precondition: z.record(z.string(), z.unknown()).optional(),
      actions: z.array(z.object({ label: z.string(), commandText: z.string(), style: z.enum(['primary', 'secondary', 'danger']).optional() })).optional(),
    },
    annotations,
  };
}

function toolDescription(name: GuiMcpToolName): string {
  if (name === 'gui.get_context') return 'Read compact SciForge GUI shell, hot-region, region detail, or debug context.';
  if (name === 'gui.list') return 'List children in the read-only SciForge GUI resource tree.';
  if (name === 'gui.read') return 'Read a semantic read-only SciForge GUI resource.';
  if (name === 'gui.search') return 'Search semantic GUI refs, visible text, action labels, and status.';
  if (name === 'gui.stat') return 'Stat a read-only SciForge GUI resource.';
  if (name === 'gui.watch') return 'Subscribe to semantic GUI resource revision changes without exposing raw DOM events.';
  if (name === 'gui.present') return 'Express a presentation intent for the SciForge GUI to negotiate and render.';
  if (name === 'gui.ask_user') return 'Ask the user for confirmation, input, or a choice using terminal-equivalent command affordances.';
  if (name === 'gui.notify') return 'Express a notification intent for the SciForge GUI.';
  if (name === 'gui.set_status') return 'Set presentation-only SciForge GUI status text.';
  return 'Apply a GUI-local presentation transaction without mutating workspace state.';
}

function uriToName(uri: string): string {
  return uri.replace(/^sciforge-gui:\/gui\//, 'gui.').replace(/\.json$/, '').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function isIntentTool(name: GuiMcpToolName): boolean {
  return ['gui.present', 'gui.ask_user', 'gui.notify', 'gui.set_status', 'gui.apply_batch'].includes(name);
}
