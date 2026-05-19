import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeHomePaths } from '../../../packages/backend/src/runtime-home.js';
import { ensureGuiExtensionState } from './gui-extension-state.js';

export const GUI_MCP_SERVER_NAME = 'sciforge_gui';
export const GUI_EXTENSION_STATE_ENV = 'SCIFORGE_GUI_EXTENSION_STATE';

export type RuntimeGuiExtensionMode = 'mcp-stdio';

export interface RuntimeGuiExtensionOptions {
  enabled?: boolean;
  statePath?: string;
}

export interface RuntimeGuiExtensionInjection {
  mode: RuntimeGuiExtensionMode;
  serverName: typeof GUI_MCP_SERVER_NAME;
  statePath: string;
  configArgs: string[];
  toolNames: string[];
  resourceUris: string[];
}

export const GUI_NATIVE_TOOL_NAMES = [
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
] as const;

export const GUI_NATIVE_RESOURCE_URIS = [
  'sciforge-gui:/gui/shell.json',
  'sciforge-gui:/gui/hot-region.json',
  'sciforge-gui:/gui/intent-log.json',
] as const;

export async function prepareRuntimeGuiExtensionInjection(options: RuntimeGuiExtensionOptions = {}): Promise<RuntimeGuiExtensionInjection | undefined> {
  if (options.enabled === false) return undefined;
  const statePath = resolve(options.statePath ?? defaultGuiExtensionStatePath());
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(sourceDir, '../../..');
  const serverPath = resolve(sourceDir, 'gui-mcp-server.ts');
  const tsxLoaderPath = resolve(projectRoot, 'node_modules/tsx/dist/loader.mjs');
  const missing = await missingFiles([serverPath, tsxLoaderPath]);
  if (missing.length) {
    throw new Error(`Runtime GUI extension injection unavailable; missing ${missing.join(', ')}`);
  }
  await ensureGuiExtensionState(statePath);
  const command = 'node';
  const args = ['--import', tsxLoaderPath, serverPath];
  return {
    mode: 'mcp-stdio',
    serverName: GUI_MCP_SERVER_NAME,
    statePath,
    configArgs: [
      '-c',
      `mcp_servers.${GUI_MCP_SERVER_NAME}.command=${tomlString(command)}`,
      '-c',
      `mcp_servers.${GUI_MCP_SERVER_NAME}.args=${tomlStringArray(args)}`,
      '-c',
      `mcp_servers.${GUI_MCP_SERVER_NAME}.env.${GUI_EXTENSION_STATE_ENV}=${tomlString(statePath)}`,
    ],
    toolNames: [...GUI_NATIVE_TOOL_NAMES],
    resourceUris: [...GUI_NATIVE_RESOURCE_URIS],
  };
}

export function runtimeGuiExtensionManifest(injection: RuntimeGuiExtensionInjection): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.runtime-gui-extension.v1',
    mode: injection.mode,
    serverName: injection.serverName,
    statePath: injection.statePath,
    tools: injection.toolNames.map((name) => ({
      name,
      boundary: name.startsWith('gui.present')
        || name.startsWith('gui.ask_user')
        || name.startsWith('gui.notify')
        || name.startsWith('gui.set_status')
        || name.startsWith('gui.apply_batch')
        ? 'presentation-intent'
        : 'read-only-gui-state',
    })),
    resources: injection.resourceUris.map((uri) => ({ uri, readonly: true })),
  };
}

export function defaultGuiExtensionStatePath(): string {
  return join(getRuntimeHomePaths().runtimeRoot, 'gui-extension', 'state.json');
}

async function missingFiles(paths: string[]): Promise<string[]> {
  const results = await Promise.all(paths.map(async (path) => {
    return await access(path).then(() => undefined, () => path);
  }));
  return results.filter((path): path is string => Boolean(path));
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}
