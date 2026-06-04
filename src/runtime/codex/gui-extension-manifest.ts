import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeHomePaths } from '../../../packages/backend/src/runtime-home.js';
import { guiPresentationResourcePaths } from '../../ui/src/app/guiProtocol.js';
import { ensureGuiExtensionState } from './gui-extension-state.js';

export const GUI_MCP_SERVER_NAME = 'sciforge_gui';
export const GUI_EXTENSION_STATE_ENV = 'SCIFORGE_GUI_EXTENSION_STATE';

export type RuntimeGuiExtensionMode = 'mcp-stdio';

export interface RuntimeGuiExtensionOptions {
  enabled?: boolean;
  statePath?: string;
  runtimeDir?: string;
}

export interface RuntimeGuiExtensionInjection {
  mode: RuntimeGuiExtensionMode;
  serverName: typeof GUI_MCP_SERVER_NAME;
  statePath: string;
  binDir: string;
  shimPath: string;
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
  'sciforge-gui:/gui/regions/sidebar/summary.md',
  'sciforge-gui:/gui/regions/sidebar/refs.json',
  'sciforge-gui:/gui/regions/sidebar/actions.json',
  ...guiPresentationResourcePaths().map((path) => `sciforge-gui:${path}`),
] as const;

export async function prepareRuntimeGuiExtensionInjection(options: RuntimeGuiExtensionOptions = {}): Promise<RuntimeGuiExtensionInjection | undefined> {
  if (options.enabled === false) return undefined;
  const statePath = resolve(options.statePath ?? defaultGuiExtensionStatePath());
  const configuredSourceDir = resolve(options.runtimeDir ?? dirname(fileURLToPath(import.meta.url)));
  const sourceDir = await resolveRuntimeEntrypointSourceDir(configuredSourceDir);
  const projectRoot = resolve(sourceDir, '../../..');
  const tsxLoaderPath = resolve(projectRoot, 'node_modules/tsx/dist/loader.mjs');
  const serverEntry = await runtimeEntrypoint({
    sourceDir,
    basename: 'gui-mcp-server',
    tsxLoaderPath,
  });
  const shimEntry = await runtimeEntrypoint({
    sourceDir,
    basename: 'gui-present-cli',
    tsxLoaderPath,
  });
  const missing = [...serverEntry.missing, ...shimEntry.missing];
  if (missing.length) {
    throw new Error(`Runtime GUI extension injection unavailable; missing ${missing.join(', ')}`);
  }
  await ensureGuiExtensionState(statePath);
  const { binDir, shimPath } = await writeGuiPresentShim({ statePath, shimEntry });
  const command = 'node';
  const args = serverEntry.args;
  return {
    mode: 'mcp-stdio',
    serverName: GUI_MCP_SERVER_NAME,
    statePath,
    binDir,
    shimPath,
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

export function defaultGuiExtensionStatePath(scope?: { commandId?: string; attemptId?: string }): string {
  const root = join(getRuntimeHomePaths().runtimeRoot, 'gui-extension');
  if (scope?.commandId || scope?.attemptId) {
    return join(root, 'state', scope.commandId ?? 'command', `${scope.attemptId ?? 'attempt'}.json`);
  }
  return join(root, 'state.json');
}

async function writeGuiPresentShim(input: {
  statePath: string;
  shimEntry: RuntimeEntrypoint;
}): Promise<{ binDir: string; shimPath: string }> {
  const binDir = join(getRuntimeHomePaths().runtimeRoot, 'gui-extension', 'bin');
  const shimPath = join(binDir, 'gui.present');
  const commandShimPath = join(binDir, 'gui');
  await mkdir(binDir, { recursive: true });
  await writeFile(shimPath, [
    '#!/bin/sh',
    `if [ -z "\${${GUI_EXTENSION_STATE_ENV}:-}" ]; then`,
    `  ${GUI_EXTENSION_STATE_ENV}=${shellQuote(input.statePath)}`,
    'fi',
    `export ${GUI_EXTENSION_STATE_ENV}`,
    `exec node ${input.shimEntry.args.map(shellQuote).join(' ')} "$@"`,
    '',
  ].join('\n'), 'utf8');
  await writeFile(commandShimPath, [
    '#!/bin/sh',
    'case "$1" in',
    '  present|gui.present)',
    '    shift',
    '    exec "$(dirname "$0")/gui.present" "$@"',
    '    ;;',
    '  ""|--help|-h)',
    '    echo "Usage: gui present [gui.present args...]"',
    '    echo "The injected SciForge GUI executable is also available as gui.present."',
    '    exit 0',
    '    ;;',
    '  *)',
    '    echo "Unsupported gui subcommand: $1" >&2',
    '    echo "Use gui.present directly, or gui present ..." >&2',
    '    exit 2',
    '    ;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  await chmod(shimPath, 0o755);
  await chmod(commandShimPath, 0o755);
  return { binDir, shimPath };
}

async function missingFiles(paths: string[]): Promise<string[]> {
  const results = await Promise.all(paths.map(async (path) => {
    return await access(path).then(() => undefined, () => path);
  }));
  return results.filter((path): path is string => Boolean(path));
}

interface RuntimeEntrypoint {
  args: string[];
  missing: string[];
}

async function resolveRuntimeEntrypointSourceDir(sourceDir: string): Promise<string> {
  if (await hasCompiledRuntimeEntrypoints(sourceDir)) return sourceDir;
  const codexDir = resolve(sourceDir, 'codex');
  if (await hasCompiledRuntimeEntrypoints(codexDir)) return codexDir;
  return sourceDir;
}

async function hasCompiledRuntimeEntrypoints(sourceDir: string): Promise<boolean> {
  const missing = await missingFiles([
    resolve(sourceDir, 'gui-mcp-server.js'),
    resolve(sourceDir, 'gui-present-cli.js'),
  ]);
  return missing.length === 0;
}

async function runtimeEntrypoint(input: {
  sourceDir: string;
  basename: string;
  tsxLoaderPath: string;
}): Promise<RuntimeEntrypoint> {
  const jsPath = resolve(input.sourceDir, `${input.basename}.js`);
  if ((await missingFiles([jsPath])).length === 0) {
    return { args: [jsPath], missing: [] };
  }

  const tsPath = resolve(input.sourceDir, `${input.basename}.ts`);
  const missing = await missingFiles([tsPath, input.tsxLoaderPath]);
  return {
    args: ['--import', input.tsxLoaderPath, tsPath],
    missing,
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
