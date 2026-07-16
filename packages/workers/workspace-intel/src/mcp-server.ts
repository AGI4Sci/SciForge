import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { readFile } from 'node:fs/promises'

import {
  VISIBLE_CONTEXT_RESOURCE_URI,
  VisualCaptureInputSchema,
  WorkspaceImageInspectInputSchema,
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  VisibleContextInputSchema,
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
import type { VisualInspectionEvidence } from './visual-inspection.js'

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

  server.registerTool('gui_visible_context', {
    description: 'Inspect the current GUI surface registry. The returned snapshotToken is required by gui_visual_capture and binds capture to this exact window, thread, and revision.',
    inputSchema: VisibleContextInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.visibleContext(args)
    return toolResult(result, result.ok
      ? `Visible context has ${result.componentCount} component${result.componentCount === 1 ? '' : 's'}.`
      : result.error.message)
  })

  server.registerTool('gui_visual_capture', {
    description: 'Capture and visually understand the exact SciForge surface identified by a fresh gui_visible_context snapshotToken. Accepts a general task, normalized regions, truth locks, and output intent. Target identifiers must come from the same snapshot; arbitrary coordinates and cross-surface fallback are forbidden.',
    inputSchema: VisualCaptureInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.visualCapture(args)
    if (!result.ok) return toolResult(result, result.error.message)
    const bytes = await readFile(result.resource.path)
    return {
      content: [
        {
          type: 'text',
          text: `Captured ${result.resource.role} visual context to ${result.resource.path}.\n${visualEvidenceText(result.evidence)}`
        },
        { type: 'image', data: bytes.toString('base64'), mimeType: result.resource.mimeType }
      ],
      structuredContent: result
    }
  })

  server.registerTool('gui_workspace_image_inspect', {
    description: 'Run a general visual-understanding task over one or more workspace-confined PNG, JPEG, or WebP artifacts. Supports normalized regions, truth locks, comparison and structured output intent; all model inference goes through the SciForge Model Router.',
    inputSchema: WorkspaceImageInspectInputSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS
  }, async (args) => {
    const result = await service.inspectWorkspaceImages(args)
    if (!result.ok) return toolResult(result, result.error.message)
    const images = await Promise.all(result.artifacts.map(async (artifact) => ({
      artifact,
      bytes: await readFile(artifact.path)
    })))
    return {
      content: [
        { type: 'text', text: visualEvidenceText(result.evidence) },
        ...images.map(({ artifact, bytes }) => ({
          type: 'image' as const,
          data: bytes.toString('base64'),
          mimeType: artifact.mimeType
        }))
      ],
      structuredContent: result
    }
  })

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

  server.registerResource('visible-context', VISIBLE_CONTEXT_RESOURCE_URI, {
    title: 'Visible Context',
    description: 'Current bounded GUI visible-context snapshot for agent on-demand inspection.',
    mimeType: 'application/json'
  }, async () => {
    const result = await service.visibleContext({ includeHidden: true })
    return jsonResource(VISIBLE_CONTEXT_RESOURCE_URI, result)
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

function visualEvidenceText(evidence: VisualInspectionEvidence): string {
  const lines = [
    `Visual understanding completed through Model Router. Attestation: ${evidence.attestation}`,
    `Summary: ${evidence.summary}`
  ]
  if (evidence.claims.length) {
    lines.push(`Claims: ${evidence.claims.map((claim) => `[${claim.kind}; ${claim.artifactId}; ${claim.confidence}] ${claim.text}`).join(' | ')}`)
  }
  if (evidence.uncertainties.length) lines.push(`Uncertainties: ${evidence.uncertainties.join(' | ')}`)
  return lines.join('\n')
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
