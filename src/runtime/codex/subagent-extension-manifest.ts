import { access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RUNTIME_CODEX_SANDBOX,
  getRuntimeHomePaths,
  RUNTIME_PROFILE,
} from '../../../packages/backend/src/runtime-home.js';

export const SUBAGENT_MCP_SERVER_NAME = 'sciforge_subagents';
export const SUBAGENT_SPAWN_AGENT_TOOL_NAME = 'multi_agent_v1.spawn_agent';
export const SUBAGENT_EXTENSION_STATE_ENV = 'SCIFORGE_SUBAGENT_STATE';
export const SUBAGENT_EXTENSION_WORKSPACE_ENV = 'SCIFORGE_SUBAGENT_WORKSPACE';
export const SUBAGENT_NATIVE_TOOL_NAMES = [SUBAGENT_SPAWN_AGENT_TOOL_NAME] as const;

export const SUBAGENT_MCP_ENV = {
  workspace: 'SCIFORGE_SUBAGENT_WORKSPACE',
  profile: 'SCIFORGE_SUBAGENT_PROFILE',
  sandbox: 'SCIFORGE_SUBAGENT_SANDBOX',
  approvalPolicy: 'SCIFORGE_SUBAGENT_APPROVAL_POLICY',
  codexHome: 'SCIFORGE_SUBAGENT_CODEX_HOME',
  codexCommand: 'SCIFORGE_SUBAGENT_CODEX_COMMAND',
  transcriptRoot: 'SCIFORGE_SUBAGENT_TRANSCRIPT_ROOT',
  parentCommandId: 'SCIFORGE_SUBAGENT_PARENT_COMMAND_ID',
  parentAttemptId: 'SCIFORGE_SUBAGENT_PARENT_ATTEMPT_ID',
} as const;

export type RuntimeSubagentExtensionMode = 'mcp-stdio';

export interface RuntimeSubagentInjectionOptions {
  workspace: string;
  profile: string;
  sandbox: string;
  approvalPolicy?: string;
  codexHome: string;
  runtimeDir?: string;
  codexCommand?: string;
  parentCommandId?: string;
  parentAttemptId?: string;
  transcriptRoot?: string;
  statePath?: string;
}

export interface RuntimeSubagentInjection {
  mode: RuntimeSubagentExtensionMode;
  serverName: typeof SUBAGENT_MCP_SERVER_NAME;
  configArgs: string[];
  toolNames: Array<typeof SUBAGENT_SPAWN_AGENT_TOOL_NAME>;
  transcriptRoot: string;
}

export async function prepareRuntimeSubagentInjection(options: RuntimeSubagentInjectionOptions): Promise<RuntimeSubagentInjection> {
  const configuredSourceDir = resolve(options.runtimeDir ?? dirname(fileURLToPath(import.meta.url)));
  const sourceDir = await resolveRuntimeEntrypointSourceDir(configuredSourceDir);
  const projectRoot = resolve(sourceDir, '../../..');
  const tsxLoaderPath = resolve(projectRoot, 'node_modules/tsx/dist/loader.mjs');
  const serverEntry = await runtimeEntrypoint({
    sourceDir,
    basename: 'subagent-mcp-server',
    tsxLoaderPath,
  });
  const missing = serverEntry.missing;
  if (missing.length) {
    throw new Error(`Runtime sub-agent injection unavailable; missing ${missing.join(', ')}`);
  }

  const transcriptRoot = resolve(options.transcriptRoot ?? defaultSubagentTranscriptRoot());
  const command = 'node';
  const args = serverEntry.args;
  const envEntries = [
    [SUBAGENT_MCP_ENV.workspace, resolve(options.workspace)],
    [SUBAGENT_MCP_ENV.profile, options.profile],
    [SUBAGENT_MCP_ENV.sandbox, options.sandbox],
    [SUBAGENT_MCP_ENV.approvalPolicy, options.approvalPolicy],
    [SUBAGENT_MCP_ENV.codexHome, resolve(options.codexHome)],
    [SUBAGENT_MCP_ENV.codexCommand, options.codexCommand?.trim() || 'codex'],
    [SUBAGENT_MCP_ENV.transcriptRoot, transcriptRoot],
    [SUBAGENT_EXTENSION_STATE_ENV, options.statePath ? resolve(options.statePath) : undefined],
    [SUBAGENT_MCP_ENV.parentCommandId, options.parentCommandId],
    [SUBAGENT_MCP_ENV.parentAttemptId, options.parentAttemptId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  return {
    mode: 'mcp-stdio',
    serverName: SUBAGENT_MCP_SERVER_NAME,
    transcriptRoot,
    configArgs: [
      '-c',
      `mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command=${tomlString(command)}`,
      '-c',
      `mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.args=${tomlStringArray(args)}`,
      ...envEntries.flatMap(([key, value]) => [
        '-c',
        `mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${key}=${tomlString(value)}`,
      ]),
    ],
    toolNames: [...SUBAGENT_NATIVE_TOOL_NAMES],
  };
}

export async function prepareRuntimeSubagentExtensionInjection(options: {
  workspacePath: string;
  statePath?: string;
  profile?: string;
  sandbox?: string;
  approvalPolicy?: string;
  codexHome?: string;
  codexCommand?: string;
  commandId?: string;
  attemptId?: string;
}): Promise<RuntimeSubagentInjection> {
  const paths = getRuntimeHomePaths();
  const statePath = resolve(options.statePath ?? defaultSubagentExtensionStatePath({
    commandId: options.commandId,
    attemptId: options.attemptId,
  }));
  return prepareRuntimeSubagentInjection({
    workspace: options.workspacePath,
    profile: options.profile ?? RUNTIME_PROFILE,
    sandbox: options.sandbox ?? DEFAULT_RUNTIME_CODEX_SANDBOX,
    approvalPolicy: options.approvalPolicy,
    codexHome: options.codexHome ?? paths.codexHome,
    codexCommand: options.codexCommand,
    parentCommandId: options.commandId,
    parentAttemptId: options.attemptId,
    statePath,
  });
}

export function runtimeSubagentManifest(injection: RuntimeSubagentInjection): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.runtime-subagent-extension.v1',
    mode: injection.mode,
    serverName: injection.serverName,
    tools: injection.toolNames.map((name) => ({
      name,
      boundary: 'local-sub-agent',
      returns: [
        'agentId',
        'parentAgentId',
        'agentType',
        'status',
        'resultSummary',
        'resultRef',
        'transcriptRef',
        'refs',
        'durationMs',
        'background',
        'resume',
      ],
    })),
  };
}

export function runtimeSubagentExtensionManifest(injection: RuntimeSubagentInjection): Record<string, unknown> {
  return runtimeSubagentManifest(injection);
}

export function defaultSubagentTranscriptRoot(): string {
  return join(getRuntimeHomePaths().runtimeRoot, 'subagents', 'transcripts');
}

export function defaultSubagentExtensionStatePath(scope?: { commandId?: string; attemptId?: string }): string {
  const root = join(getRuntimeHomePaths().runtimeRoot, 'subagents', 'state');
  if (scope?.commandId || scope?.attemptId) {
    return join(root, scope.commandId ?? 'command', `${scope.attemptId ?? 'attempt'}.json`);
  }
  return join(root, 'state.json');
}

async function missingFiles(paths: string[]): Promise<string[]> {
  const results = await Promise.all(paths.map(async (path) => {
    return await access(path).then(() => undefined, () => path);
  }));
  return results.filter((path): path is string => Boolean(path));
}

async function resolveRuntimeEntrypointSourceDir(sourceDir: string): Promise<string> {
  if (await hasCompiledRuntimeEntrypoint(sourceDir)) return sourceDir;
  const codexDir = resolve(sourceDir, 'codex');
  if (await hasCompiledRuntimeEntrypoint(codexDir)) return codexDir;
  return sourceDir;
}

async function hasCompiledRuntimeEntrypoint(sourceDir: string): Promise<boolean> {
  const missing = await missingFiles([resolve(sourceDir, 'subagent-mcp-server.js')]);
  return missing.length === 0;
}

async function runtimeEntrypoint(input: {
  sourceDir: string;
  basename: string;
  tsxLoaderPath: string;
}): Promise<{ args: string[]; missing: string[] }> {
  const jsPath = resolve(input.sourceDir, `${input.basename}.js`);
  if ((await missingFiles([jsPath])).length === 0) {
    return { args: [jsPath], missing: [] };
  }

  const tsPath = resolve(input.sourceDir, `${input.basename}.ts`);
  return {
    args: ['--import', input.tsxLoaderPath, tsPath],
    missing: await missingFiles([tsPath, input.tsxLoaderPath]),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}
