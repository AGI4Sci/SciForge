import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  SCIFORGE_CANVAS_ARTIFACT_KINDS,
  type SciforgeCanvasImportRecentArtifactsRequest,
  type SciforgeCanvasInsertArtifactRequest,
  type SciforgeCanvasReviewPacketRequest
} from './types'
import {
  exportSciforgeCanvasReviewPacket,
  getSciforgeCanvasStatus,
  importRecentSciforgeCanvasArtifacts,
  insertSciforgeCanvasArtifact,
  openOrCreateSciforgeCanvas
} from './sciforge-canvas-engine'
import { SCIFORGE_CANVAS_MCP_FLAG } from './contract'

type McpLaunchOptions = {
  workspaceRoot?: string
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const CONTROLLED_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}

function parseLaunchOptions(argv: string[]): McpLaunchOptions | null {
  if (!argv.includes(SCIFORGE_CANVAS_MCP_FLAG)) return null
  const workspaceRoot = parseArgValue(argv, '--workspace-root')?.trim()
  return {
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}

function jsonSummary(title: string, value: unknown): string {
  return `${title}\n\n${JSON.stringify(value, null, 2)}`
}

function workspaceRootFor(inputWorkspaceRoot: string | undefined, options: McpLaunchOptions): string {
  const workspaceRoot = inputWorkspaceRoot?.trim() || options.workspaceRoot?.trim()
  if (!workspaceRoot) throw new Error('workspaceRoot is required. Launch this MCP with --workspace-root or pass workspaceRoot to the tool.')
  return workspaceRoot
}

const artifactKindSchema = z.enum(SCIFORGE_CANVAS_ARTIFACT_KINDS)
const placementSchema = z.enum(['right', 'left', 'below'])
const scoreSchema = z.object({
  overall: z.number(),
  palette: z.number(),
  background: z.number(),
  axes: z.number(),
  grid: z.number(),
  layout: z.number(),
  marks: z.number(),
  typography: z.number().optional(),
  warnings: z.array(z.string())
}).passthrough()

export async function runSciforgeCanvasMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false

  const server = new McpServer(
    { name: 'sciforge-canvas', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('sciforge_canvas_status', {
    title: 'SciForge Canvas Status',
    description: 'Report the first-party SciForge Canvas MCP status, Cowart-compatible metadata, and artifact guardrails.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ workspaceRoot }) => {
    try {
      const status = await getSciforgeCanvasStatus(workspaceRoot?.trim() || options.workspaceRoot)
      return textResult('SciForge Canvas MCP is available.', { status })
    } catch (error) {
      return errorResult(`Failed to inspect SciForge Canvas status: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('sciforge_canvas_open_or_create', {
    title: 'Open Or Create SciForge Canvas',
    description: 'Create or read a workspace-local SciForge Canvas draw.io XML document, with legacy tldraw snapshot compatibility.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      canvasId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async ({ workspaceRoot, canvasId }) => {
    try {
      const result = await openOrCreateSciforgeCanvas({
        workspaceRoot: workspaceRootFor(workspaceRoot, options),
        ...(canvasId ? { canvasId } : {})
      })
      return textResult(jsonSummary(`SciForge canvas ${result.ok ? result.status : 'failed'}.`, result), { result })
    } catch (error) {
      return errorResult(`Failed to open SciForge Canvas: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('sciforge_canvas_insert_artifact', {
    title: 'Insert SciForge Canvas Artifact',
    description: 'Copy a local scientific plot, PPT slide SVG, PPTX placeholder, or image artifact into the workspace canvas without overwriting originals.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      canvasId: z.string().trim().max(120).optional(),
      artifactKind: artifactKindSchema,
      sourcePath: z.string().trim().max(4096).optional(),
      outputPath: z.string().trim().max(4096).optional(),
      previewPath: z.string().trim().max(4096).optional(),
      renderedPagePath: z.string().trim().max(4096).optional(),
      renderedFromPptxPath: z.string().trim().max(4096).optional(),
      renderedSlideIndex: z.number().int().nonnegative().optional(),
      manifestPath: z.string().trim().max(4096).optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      diagramSpecPath: z.string().trim().max(4096).optional(),
      frameworkDesignPlanPath: z.string().trim().max(4096).optional(),
      diagramLayerManifestPath: z.string().trim().max(4096).optional(),
      referencePath: z.string().trim().max(4096).optional(),
      projectPath: z.string().trim().max(4096).optional(),
      svgPath: z.string().trim().max(4096).optional(),
      pptxPath: z.string().trim().max(4096).optional(),
      slideIndex: z.number().int().nonnegative().optional(),
      title: z.string().trim().max(300).optional(),
      caption: z.string().trim().max(2000).optional(),
      sourceTool: z.string().trim().max(120).optional(),
      reviewScore: scoreSchema.optional(),
      reviewPacketPath: z.string().trim().max(4096).optional(),
      anchorShapeId: z.string().trim().max(200).optional(),
      placement: placementSchema.optional(),
      margin: z.number().min(0).max(500).optional(),
      matchAnchor: z.boolean().optional(),
      displayWidth: z.number().positive().max(5000).optional(),
      displayHeight: z.number().positive().max(5000).optional(),
      altText: z.string().trim().max(500).optional(),
      fileName: z.string().trim().max(255).optional(),
      annotationScreenshot: z.string().trim().max(255).optional(),
      shapeMeta: z.record(z.string(), z.unknown()).optional(),
      assetMeta: z.record(z.string(), z.unknown()).optional(),
      dryRun: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: SciforgeCanvasInsertArtifactRequest = {
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }
      const result = await insertSciforgeCanvasArtifact(request)
      return textResult(jsonSummary(`SciForge canvas artifact ${result.ok ? result.status : 'failed'}.`, result), { result })
    } catch (error) {
      return errorResult(`Failed to insert SciForge Canvas artifact: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('sciforge_canvas_get_selection', {
    title: 'Get SciForge Canvas Selection',
    description: 'Return the current persisted SciForge Canvas selection state.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      canvasId: z.string().trim().max(120).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ workspaceRoot, canvasId }) => {
    try {
      const result = await openOrCreateSciforgeCanvas({
        workspaceRoot: workspaceRootFor(workspaceRoot, options),
        ...(canvasId ? { canvasId } : {})
      })
      const selection = result.ok ? result.selection : { selectedShapes: [], updatedAt: null }
      return textResult(
        selection.selectedShapes.length === 0
          ? 'No SciForge Canvas shapes are currently selected.'
          : selection.selectedShapes.map((shape) => `${shape.id} [${shape.type ?? 'unknown'}]`).join('\n'),
        { selection, result }
      )
    } catch (error) {
      return errorResult(`Failed to read SciForge Canvas selection: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('sciforge_canvas_import_recent_artifacts', {
    title: 'Import Recent SciForge Canvas Artifacts',
    description: 'Import recent SciForge artifact-bus or workspace artifacts into the canvas for review. Use current_canvas scope for the active conversation.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      canvasId: z.string().trim().max(120).optional(),
      scope: z.enum(['current_canvas', 'workspace_recent']).optional(),
      maxAgeMs: z.number().min(0).max(30 * 24 * 60 * 60 * 1000).optional(),
      limit: z.number().int().positive().max(20).optional(),
      includeExisting: z.boolean().optional(),
      dryRun: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: SciforgeCanvasImportRecentArtifactsRequest = {
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }
      const result = await importRecentSciforgeCanvasArtifacts(request)
      return textResult(jsonSummary(`SciForge canvas recent artifact import ${result.ok ? result.status : 'failed'}.`, result), { result })
    } catch (error) {
      return errorResult(`Failed to import recent SciForge Canvas artifacts: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('sciforge_canvas_export_review_packet', {
    title: 'Export SciForge Canvas Review Packet',
    description: 'Export a review packet with artifact metadata, annotations, selection, and controlled next-tool recommendations.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      canvasId: z.string().trim().max(120).optional(),
      packetId: z.string().trim().max(120).optional(),
      title: z.string().trim().max(300).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: SciforgeCanvasReviewPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        ...(input.packetId ? { packetId: input.packetId } : {}),
        ...(input.title ? { title: input.title } : {})
      }
      const result = await exportSciforgeCanvasReviewPacket(request)
      return textResult(jsonSummary(`SciForge canvas review packet ${result.ok ? result.status : 'failed'}.`, result), { result })
    } catch (error) {
      return errorResult(`Failed to export SciForge Canvas review packet: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
