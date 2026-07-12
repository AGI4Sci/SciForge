import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

import {
  GIT_BRANCHES_RESOURCE_URI,
  GIT_CHECKPOINTS_RESOURCE_URI,
  GIT_CHECKPOINT_RESOURCE_URI_TEMPLATE,
  GIT_DIFF_RESOURCE_URI,
  GIT_DIFF_RESOURCE_URI_TEMPLATE,
  GIT_STATUS_RESOURCE_URI,
  GitBranchesInputSchema,
  GitCheckpointListInputSchema,
  GitCheckpointPreviewInputSchema,
  GitDiffPreviewInputSchema,
  GitStatusInputSchema,
  LSP_STATUS_RESOURCE_URI,
  LspQueryInputSchema,
  LspStatusInputSchema,
  RUNTIME_DEPENDENCIES_RESOURCE_URI,
  RUNTIME_HEALTH_RESOURCE_URI,
  RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI,
  RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  RUNTIME_INSPECTOR_MCP_SERVER_VERSION,
  RUNTIME_LOCAL_RESOURCE_URI,
  RUNTIME_MODEL_ROUTER_RESOURCE_URI,
  RUNTIME_PORTS_RESOURCE_URI,
  RuntimeDependencyReportInputSchema,
  RuntimeHealthInputSchema,
  RuntimeLocalStatusInputSchema,
  RuntimeModelRouterStatusInputSchema,
  RuntimePortsInputSchema,
  gitCheckpointResourceUri,
  type RuntimeInspectorAnyResult,
  type RuntimeInspectorFailure
} from './contract.js'
import {
  createRuntimeInspectorService,
  type RuntimeInspectorService
} from './service.js'
import { CompletionChecksInputSchema } from './completion-checks.js'

type RuntimeInspectorToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartRuntimeInspectorMcpServerOptions = {
  transport?: Transport
}

export function createRuntimeInspectorMcpServer(
  service: RuntimeInspectorService = createRuntimeInspectorService()
): McpServer {
  const server = new McpServer(
    { name: RUNTIME_INSPECTOR_MCP_SERVER_NAME, version: RUNTIME_INSPECTOR_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_git_status', {
    description: 'Read Git status for a workspace with pagination. This is read-only and uses optional-lock-free Git commands.',
    inputSchema: GitStatusInputSchema,
    annotations: readOnlyAnnotations('Read Git status')
  }, async (args) => resultToToolResult(await service.gitStatus(args), 'git status'))

  server.registerTool('gui_git_branches', {
    description: 'List local or local plus remote Git branches with pagination. This is read-only.',
    inputSchema: GitBranchesInputSchema,
    annotations: readOnlyAnnotations('List Git branches')
  }, async (args) => resultToToolResult(await service.gitBranches(args), 'git branches'))

  server.registerTool('gui_git_diff_preview', {
    description: 'Preview a bounded Git diff chunk for unstaged, staged, or HEAD changes. Use cursor for additional chunks and resources for configured-workspace summaries.',
    inputSchema: GitDiffPreviewInputSchema,
    annotations: readOnlyAnnotations('Preview Git diff')
  }, async (args) => resultToToolResult(await service.gitDiffPreview(args), 'git diff preview'))

  server.registerTool('gui_git_checkpoint_list', {
    description: 'List saved Git turn checkpoints from the configured app data directory. This never creates, restores, or mutates checkpoints.',
    inputSchema: GitCheckpointListInputSchema,
    annotations: readOnlyAnnotations('List Git checkpoints')
  }, async (args) => resultToToolResult(await service.gitCheckpointList(args), 'git checkpoint list'))

  server.registerTool('gui_git_checkpoint_preview', {
    description: 'Preview saved Git checkpoint metadata and bounded staged/unstaged patch chunks. Restore is intentionally not exposed.',
    inputSchema: GitCheckpointPreviewInputSchema,
    annotations: readOnlyAnnotations('Preview Git checkpoint')
  }, async (args) => resultToToolResult(await service.gitCheckpointPreview(args), 'git checkpoint preview'))

  server.registerTool('gui_runtime_ports', {
    description: 'Report configured Model Router and local runtime ports, optionally checking local TCP reachability.',
    inputSchema: RuntimePortsInputSchema,
    annotations: readOnlyAnnotations('Inspect runtime ports')
  }, async (args) => resultToToolResult(await service.runtimePorts(args), 'runtime ports'))

  server.registerTool('gui_runtime_health', {
    description: 'Read combined Model Router and local runtime health without starting, stopping, or controlling runtime processes.',
    inputSchema: RuntimeHealthInputSchema,
    annotations: readOnlyAnnotations('Inspect runtime health')
  }, async (args) => resultToToolResult(await service.runtimeHealth(args), 'runtime health'))

  server.registerTool('gui_runtime_dependency_report', {
    description: 'Build a read-only dependency report for Git, Node, checkpoint data, LSP binary availability, and optional runtime HTTP reachability.',
    inputSchema: RuntimeDependencyReportInputSchema,
    annotations: readOnlyAnnotations('Inspect runtime dependencies')
  }, async (args) => resultToToolResult(await service.runtimeDependencyReport(args), 'runtime dependency report'))

  server.registerTool('gui_runtime_model_router_status', {
    description: 'Read Model Router base URL, port, and healthz status. Provider secrets are never returned.',
    inputSchema: RuntimeModelRouterStatusInputSchema,
    annotations: readOnlyAnnotations('Inspect Model Router status')
  }, async (args) => resultToToolResult(await service.runtimeModelRouterStatus(args), 'model router status'))

  server.registerTool('gui_runtime_status', {
    description: 'Read local runtime health and optional authenticated diagnostics. This worker does not expose process control.',
    inputSchema: RuntimeLocalStatusInputSchema,
    annotations: readOnlyAnnotations('Inspect local runtime status')
  }, async (args) => resultToToolResult(await service.runtimeLocalStatus(args), 'local runtime status'))

  server.registerTool('gui_lsp_status', {
    description: 'Inspect TypeScript/JavaScript LSP availability and per-workspace session lifecycle state.',
    inputSchema: LspStatusInputSchema,
    annotations: readOnlyAnnotations('Inspect LSP status')
  }, async (args) => resultToToolResult(await service.lspStatus(args), 'lsp status'))

  server.registerTool('gui_lsp_query', {
    description: 'Run TypeScript/JavaScript LSP navigation against saved files using a long-lived per-workspace language server session.',
    inputSchema: LspQueryInputSchema,
    annotations: readOnlyAnnotations('Run LSP query')
  }, async (args, extra) => resultToToolResult(await service.lspQuery(args, { signal: extra.signal }), 'lsp query'))

  server.registerTool('gui_completion_check', {
    description: 'Run configurable, read-only completion checks against bounded saved workspace files: required/forbidden text or regex, capture equality, file existence, and LaTeX log thresholds. This tool never runs shell commands or modifies documents.',
    inputSchema: CompletionChecksInputSchema,
    annotations: readOnlyAnnotations('Check task completion')
  }, async (args) => resultToToolResult(await service.completionChecks(args), 'completion checks'))

  registerRuntimeInspectorResources(server, service)
  return server
}

export async function startRuntimeInspectorMcpServer(
  service: RuntimeInspectorService = createRuntimeInspectorService(),
  options: StartRuntimeInspectorMcpServerOptions = {}
): Promise<void> {
  const server = createRuntimeInspectorMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function registerRuntimeInspectorResources(server: McpServer, service: RuntimeInspectorService): void {
  server.registerResource('runtime_inspector_diagnostics', RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI, {
    title: 'SciForge runtime inspector diagnostics',
    description: 'Worker version, transport, capabilities, configured endpoints, and resource inventory.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI, service.diagnostics()))

  server.registerResource('git_status', GIT_STATUS_RESOURCE_URI, {
    title: 'Git status',
    description: 'Bounded Git status for the configured workspace root.',
    mimeType: 'application/json'
  }, async () => jsonResource(GIT_STATUS_RESOURCE_URI, await service.gitStatus({})))

  server.registerResource('git_branches', GIT_BRANCHES_RESOURCE_URI, {
    title: 'Git branches',
    description: 'Bounded Git branch list for the configured workspace root.',
    mimeType: 'application/json'
  }, async () => jsonResource(GIT_BRANCHES_RESOURCE_URI, await service.gitBranches({})))

  server.registerResource('git_diff', GIT_DIFF_RESOURCE_URI, {
    title: 'Git diff',
    description: 'Bounded Git diff preview for the configured workspace root.',
    mimeType: 'application/json'
  }, async () => jsonResource(GIT_DIFF_RESOURCE_URI, await service.gitDiffPreview({})))

  server.registerResource('git_diff_path', new ResourceTemplate(GIT_DIFF_RESOURCE_URI_TEMPLATE, {
    list: undefined
  }), {
    title: 'Git path diff',
    description: 'Bounded Git diff preview for one repository-relative path.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const path = decodeUriVariable(firstVariable(variables.path))
    return jsonResource(uri.toString(), await service.gitDiffPreview({ path }))
  })

  server.registerResource('git_checkpoints', GIT_CHECKPOINTS_RESOURCE_URI, {
    title: 'Git checkpoints',
    description: 'Saved Git turn checkpoints from the configured checkpoint data directory.',
    mimeType: 'application/json'
  }, async () => jsonResource(GIT_CHECKPOINTS_RESOURCE_URI, await service.gitCheckpointList({})))

  server.registerResource('git_checkpoint', new ResourceTemplate(GIT_CHECKPOINT_RESOURCE_URI_TEMPLATE, {
    list: async () => {
      const result = await service.gitCheckpointList({})
      return {
        resources: result.ok
          ? result.checkpoints.map((checkpoint) => ({
              uri: gitCheckpointResourceUri(checkpoint.checkpointId),
              name: `git_checkpoint_${checkpoint.checkpointId}`,
              title: checkpoint.checkpointId,
              description: `Git checkpoint for ${checkpoint.threadId}`,
              mimeType: 'application/json'
            }))
          : []
      }
    },
    complete: {
      checkpointId: async (value) => {
        const result = await service.gitCheckpointList({})
        return result.ok
          ? result.checkpoints
              .map((checkpoint) => checkpoint.checkpointId)
              .filter((id) => id.startsWith(value))
              .slice(0, 50)
          : []
      }
    }
  }), {
    title: 'Git checkpoint preview',
    description: 'Read-only saved checkpoint metadata and bounded patch chunks.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const checkpointId = decodeUriVariable(firstVariable(variables.checkpointId))
    return jsonResource(uri.toString(), await service.gitCheckpointPreview({ checkpoint_id: checkpointId }))
  })

  server.registerResource('runtime_ports', RUNTIME_PORTS_RESOURCE_URI, {
    title: 'Runtime ports',
    description: 'Configured Model Router and local runtime ports.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_PORTS_RESOURCE_URI, await service.runtimePorts({ include_reachability: true })))

  server.registerResource('runtime_health', RUNTIME_HEALTH_RESOURCE_URI, {
    title: 'Runtime health',
    description: 'Combined Model Router and local runtime health.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_HEALTH_RESOURCE_URI, await service.runtimeHealth({})))

  server.registerResource('runtime_dependencies', RUNTIME_DEPENDENCIES_RESOURCE_URI, {
    title: 'Runtime dependencies',
    description: 'Read-only runtime inspector dependency report.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_DEPENDENCIES_RESOURCE_URI, await service.runtimeDependencyReport({})))

  server.registerResource('runtime_model_router', RUNTIME_MODEL_ROUTER_RESOURCE_URI, {
    title: 'Model Router status',
    description: 'Model Router endpoint and health status.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_MODEL_ROUTER_RESOURCE_URI, await service.runtimeModelRouterStatus({})))

  server.registerResource('runtime_local', RUNTIME_LOCAL_RESOURCE_URI, {
    title: 'Local runtime status',
    description: 'Local runtime endpoint, health, and process-control boundary.',
    mimeType: 'application/json'
  }, async () => jsonResource(RUNTIME_LOCAL_RESOURCE_URI, await service.runtimeLocalStatus({})))

  server.registerResource('lsp_status', LSP_STATUS_RESOURCE_URI, {
    title: 'LSP status',
    description: 'TypeScript/JavaScript LSP availability and per-workspace session lifecycle state.',
    mimeType: 'application/json'
  }, async () => jsonResource(LSP_STATUS_RESOURCE_URI, await service.lspStatus({ include_dependency_probe: true })))
}

function resultToToolResult(result: RuntimeInspectorAnyResult, label: string): RuntimeInspectorToolResult {
  if (!result.ok) return errorToolResult(result, label)
  return {
    content: [{ type: 'text', text: renderSuccessSummary(result, label) }],
    structuredContent: result as unknown as Record<string, unknown>
  }
}

function errorToolResult(result: RuntimeInspectorFailure, label: string): RuntimeInspectorToolResult {
  const { error } = result
  return {
    content: [{ type: 'text', text: `${label} failed (${error.code}): ${error.reason} Suggestion: ${error.suggestion}` }],
    structuredContent: result,
    isError: true
  }
}

function renderSuccessSummary(result: Exclude<RuntimeInspectorAnyResult, RuntimeInspectorFailure>, label: string): string {
  if ('entries' in result) return `Git status has ${result.dirtyCount} changed path(s); returned ${result.entries.length}.`
  if ('branches' in result) return `Found ${result.total} Git branch(es); returned ${result.branches.length}.`
  if ('patch' in result) return `Git diff preview returned ${result.patch.bytesRead} byte(s)${result.patch.truncated ? '; more is available.' : '.'}`
  if ('checkpoints' in result) return `Found ${result.total} Git checkpoint(s); returned ${result.checkpoints.length}.`
  if ('checkpoint' in result) return `Git checkpoint preview loaded for ${result.checkpoint.checkpointId}.`
  if ('ports' in result) return `Runtime port report contains ${result.ports.length} endpoint(s).`
  if ('modelRouter' in result && 'localRuntime' in result) return `Runtime health is ${result.status}.`
  if ('dependencies' in result) return `Runtime dependency report contains ${result.dependencies.length} item(s).`
  if ('managementUrl' in result) return `Model Router status is ${result.health.status}.`
  if ('lifecycleBoundary' in result) return `Local runtime status is ${result.health.status}; process control is not exposed.`
  if ('lifecycle' in result) return `LSP status is ${result.status}; ${result.lifecycle.activeSessionCount} session(s) active.`
  if ('operation' in result && 'unsavedBufferPolicy' in result) return `LSP ${result.operation} completed.`
  if ('findings' in result && 'passed' in result) {
    return `Completion checks ${result.passed ? 'passed' : 'failed'}: ${result.summary.blockingFindings} blocking and ${result.summary.nonBlockingFindings} non-blocking finding(s).`
  }
  if ('transport' in result) return `Runtime inspector ${result.version} is available over ${result.transport}.`
  return `${label} completed.`
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2)
    }]
  }
}

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
}

function firstVariable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('/') : value ?? ''
}

function decodeUriVariable(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
