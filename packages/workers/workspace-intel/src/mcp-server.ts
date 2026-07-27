import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  WorkspaceListInputSchema,
  WorkspaceReadInputSchema,
  WorkspaceReferenceListInputSchema,
  WorkspaceReferencePreviewInputSchema,
  WorkspaceSkillListInputSchema,
  WorkspaceSkillReadInputSchema,
  WorkspaceTreeInputSchema,
  type WorkspaceIntelFailure
} from './contract.js'
import {
  createWorkspaceIntelService,
  type WorkspaceIntelService
} from './service.js'

type McpToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  structuredContent?: Record<string, unknown>
  isError?: true
}

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
} as const

export type StartWorkspaceIntelMcpServerOptions = {
  transport?: Transport
}

export function createWorkspaceIntelMcpServer(
  service: WorkspaceIntelService = createWorkspaceIntelService()
): McpServer {
  const server = new McpServer(
    { name: 'sciforge-workspace-intel', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_workspace_list', {
    description: 'List read-only workspace directory entries with workspace root guard, pagination, and optional bounded recursion.',
    inputSchema: WorkspaceListInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.listWorkspace(args)
    return toolResult(result, result.ok
      ? `Listed ${result.entries.length} workspace entr${result.entries.length === 1 ? 'y' : 'ies'}.`
      : result.error.message)
  })

  server.registerTool('gui_workspace_tree', {
    description: 'Return a bounded read-only workspace tree with depth and entry limits.',
    inputSchema: WorkspaceTreeInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.tree(args)
    return toolResult(result, result.ok
      ? `Built workspace tree with ${result.entryCount} entr${result.entryCount === 1 ? 'y' : 'ies'}.`
      : result.error.message)
  })

  server.registerTool('gui_workspace_read', {
    description: 'Read a bounded UTF-8 text chunk from a file inside the configured workspace. Binary files and workspace escapes are rejected.',
    inputSchema: WorkspaceReadInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.readFile(args)
    return toolResult(result, result.ok
      ? `Read ${result.bytesRead} byte(s) from ${result.relativePath}${result.truncated ? '; more bytes are available.' : '.'}`
      : result.error.message)
  })

  server.registerTool('gui_workspace_reference_list', {
    description: 'Build a read-only, bounded list of model-friendly workspace file references.',
    inputSchema: WorkspaceReferenceListInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.referenceList(args)
    return toolResult(result, result.ok
      ? `Built ${result.references.length} workspace reference(s).`
      : result.error.message)
  })

  server.registerTool('gui_workspace_reference_preview', {
    description: 'Preview one workspace reference with text content truncated and binary content summarized.',
    inputSchema: WorkspaceReferencePreviewInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.referencePreview(args)
    return toolResult(result, result.ok ? result.preview.contentSummary : result.error.message)
  })

  server.registerTool('gui_workspace_skill_list', {
    description: 'List read-only project/configured skills discoverable for the workspace.',
    inputSchema: WorkspaceSkillListInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.listSkills(args)
    return toolResult(result, result.ok
      ? `Found ${result.skills.length} workspace skill(s).`
      : result.error.message)
  })

  server.registerTool('gui_workspace_skill_read', {
    description: 'Read a bounded chunk from a discovered skill entry by id.',
    inputSchema: WorkspaceSkillReadInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.readSkill(args)
    return toolResult(result, result.ok
      ? `Read skill ${result.skill.id}${result.truncated ? '; more bytes are available.' : '.'}`
      : result.error.message)
  })

  server.registerResource('workspace-tree', WORKSPACE_TREE_RESOURCE_URI, {
    title: 'Workspace Tree',
    description: 'Bounded JSON tree for the configured workspace root.',
    mimeType: 'application/json'
  }, async () => {
    const result = await service.tree({})
    return jsonResource(WORKSPACE_TREE_RESOURCE_URI, result)
  })

  server.registerResource('workspace-file', new ResourceTemplate(WORKSPACE_FILE_RESOURCE_URI_TEMPLATE, {
    list: undefined
  }), {
    title: 'Workspace File',
    description: 'Bounded JSON file read result for a path inside the configured workspace.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const rawPath = Array.isArray(variables.path) ? variables.path.join('/') : variables.path
    const path = decodeWorkspaceResourcePath(rawPath ?? '')
    const result = await service.readFile({ path })
    return jsonResource(uri.toString(), result)
  })

  return server
}

export async function startWorkspaceIntelMcpServer(
  service: WorkspaceIntelService = createWorkspaceIntelService(),
  options: StartWorkspaceIntelMcpServerOptions = {}
): Promise<void> {
  const server = createWorkspaceIntelMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function toolResult(result: Record<string, unknown>, text: string): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: result,
    ...(isFailure(result) ? { isError: true as const } : {})
  }
}

function isFailure(result: Record<string, unknown>): result is WorkspaceIntelFailure {
  return result.ok === false
}

function jsonResource(uri: string, value: unknown): { contents: Array<{ uri: string; text: string; mimeType: string }> } {
  return {
    contents: [{
      uri,
      text: JSON.stringify(value, null, 2),
      mimeType: 'application/json'
    }]
  }
}

function decodeWorkspaceResourcePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
