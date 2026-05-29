import type { GuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import { callGuiAliasThroughModule } from '../modules/gui-module-handler.js';

// Legacy host-specific shim. New GUI behavior belongs in the GUI module handler.
export type GuiMcpToolName =
  | 'gui.get_context'
  | 'gui.list'
  | 'gui.read'
  | 'gui.search'
  | 'gui.stat'
  | 'gui.watch'
  | 'gui.present'
  | 'gui.ask_user'
  | 'gui.notify'
  | 'gui.set_status'
  | 'gui.apply_batch';

export interface GuiMcpToolCallResult extends Record<string, unknown> {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
}

export function callGuiMcpTool(controller: GuiProtocolController, name: GuiMcpToolName, args: Record<string, unknown>): GuiMcpToolCallResult {
  const structuredContent = structuredContentObject(callGuiToolAlias(controller, name, args));
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function structuredContentObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function callGuiToolAlias(controller: GuiProtocolController, name: GuiMcpToolName, args: Record<string, unknown>): unknown {
  const result = callGuiAliasThroughModule(controller, name, args);
  if (!result.ok) throw new Error(result.error ?? `GUI module alias failed: ${name}`);
  if (name === 'gui.list' && isRecord(result.value) && Array.isArray(result.value.entries)) return result.value.entries;
  if (name === 'gui.search' && isRecord(result.value) && Array.isArray(result.value.matches)) return result.value.matches;
  if (isRecord(result.value) && 'ref' in result.value && 'path' in result.value) {
    const { ref: _ref, meta: _meta, ...legacyRead } = result.value;
    return legacyRead;
  }
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
