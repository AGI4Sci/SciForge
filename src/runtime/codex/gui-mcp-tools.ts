import type { GuiProtocolController } from '../../ui/src/app/guiProtocol.js';

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
  const structuredContent = structuredContentObject(callGuiTool(controller, name, args));
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function structuredContentObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function callGuiTool(controller: GuiProtocolController, name: GuiMcpToolName, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'gui.get_context':
      return controller.getContext({
        level: stringField(args.level) as never,
        regionId: stringField(args.regionId),
      });
    case 'gui.list':
      return controller.list({ path: requiredString(args.path, 'path') });
    case 'gui.read':
      return controller.read({ path: requiredString(args.path, 'path'), maxBytes: numberField(args.maxBytes) });
    case 'gui.search':
      return controller.search({
        query: requiredString(args.query, 'query'),
        scope: stringField(args.scope),
        kinds: Array.isArray(args.kinds) ? args.kinds.filter((item): item is never => typeof item === 'string') : undefined,
      });
    case 'gui.stat':
      return controller.stat({ path: requiredString(args.path, 'path') });
    case 'gui.watch':
      return controller.watch({
        path: requiredString(args.path, 'path'),
        events: Array.isArray(args.events) ? args.events.filter((item): item is never => typeof item === 'string') : undefined,
        sinceRevision: numberField(args.sinceRevision),
      });
    case 'gui.present':
      return controller.present(args as never);
    case 'gui.ask_user':
      return controller.askUser(args as never);
    case 'gui.notify':
      return controller.notify(args as never);
    case 'gui.set_status':
      return controller.setStatus(args as never);
    case 'gui.apply_batch':
      return controller.applyBatch(args as never);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`gui.${name} must be a non-empty string`);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
