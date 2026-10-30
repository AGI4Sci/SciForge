import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  type ScientificPlottingCompositeRequest,
  type ScientificPlottingPrepareReferenceRequest,
  type ScientificPlottingReviewPacketRequest,
  type ScientificPlottingStyleProfilesRequest,
} from './types'
import {
  compositeScientificPlotLayers,
  createScientificPlottingReviewPacket,
  listScientificPlottingStyleProfiles,
  prepareScientificPlottingReference
} from './scientific-plotting-engine'
import {
  SCIENTIFIC_PLOTTING_MCP_FLAG,
  controlledPlottingPlanSchema
} from './contract'

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
  if (!argv.includes(SCIENTIFIC_PLOTTING_MCP_FLAG)) return null
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

const TEMPLATE_SELECTION_DESCRIPTION = 'Template selection guide: use scientific_plotting for code-owned structured plots and diagrams selected by the locked visual_generate plan. Use flowchart for compact node-edge processes, schematic-grid for explicit conceptual layouts, bar/errorbar-bar for categorical summaries, line/scatter for measured x-y data, heatmap/attention-map for matrices, box-violin or histogram-density for distributions, and multi-panel for controlled combinations.'

const templateSchema = z.enum(SCIENTIFIC_PLOTTING_TEMPLATES).describe(TEMPLATE_SELECTION_DESCRIPTION)
const cropBoxSchema = z.object({
  unit: z.enum(['ratio', 'pixel']).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
}).strict()

export async function runScientificPlottingMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false

  const server = new McpServer(
    { name: 'sciforge-scientific-plotting', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('scientific_plotting_style_profiles', {
    title: 'List Scientific Plotting Style Profiles',
    description: 'List or read first-party built-in scientific figure style profiles for journal/conference-inspired rendering.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      profileId: z.string().trim().max(160).optional(),
      query: z.string().trim().max(240).optional(),
      referencePath: z.string().trim().max(4096).optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      styleSpec: z.unknown().optional(),
      includeStyleSpec: z.boolean().optional(),
      topK: z.number().int().min(1).max(20).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingStyleProfilesRequest = {
        ...(input.workspaceRoot || options.workspaceRoot ? { workspaceRoot: input.workspaceRoot ?? options.workspaceRoot } : {}),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(input.query ? { query: input.query } : {}),
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.styleSpecPath ? { styleSpecPath: input.styleSpecPath } : {}),
        ...(input.styleSpec ? { styleSpec: input.styleSpec as never } : {}),
        ...(input.includeStyleSpec !== undefined ? { includeStyleSpec: input.includeStyleSpec } : {}),
        ...(input.topK ? { topK: input.topK } : {})
      }
      const profiles = await listScientificPlottingStyleProfiles(request)
      return textResult(
        profiles.ok
          ? jsonSummary(`Scientific plotting style profiles: ${profiles.status}.`, profiles)
          : jsonSummary(`Scientific plotting style profile lookup failed: ${profiles.status}.`, profiles),
        { profiles }
      )
    } catch (error) {
      return errorResult(`Failed to list scientific plotting style profiles: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_composite', {
    title: 'Composite Hybrid Visual Layers',
    description: 'Deterministically compose real model-owned and code-owned image files for a locked hybrid visual plan. Model layers are drawn first; code-owned truth layers are always drawn last at full opacity. The output and manifest record hashes for every consumed layer and must pass manifest-bound candidate release QA with image_generation_review_candidate.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      visualPlan: controlledPlottingPlanSchema.refine((plan) => plan.route === 'hybrid', {
        message: 'scientific_plotting_composite requires route=hybrid.'
      }),
      reviewTask: z.string().trim().min(1).max(16000),
      reviewReferencePath: z.string().trim().min(1).max(4096).optional(),
      layers: z.array(z.object({
        path: z.string().trim().min(1).max(4096),
        owner: z.enum(['model', 'code']),
        bounds: z.object({
          unit: z.enum(['ratio', 'pixel']).optional(),
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive()
        }).strict().optional(),
        fit: z.enum(['contain', 'cover', 'stretch']).optional(),
        opacity: z.number().min(0).max(1).optional()
      }).strict()).min(2).max(32),
      canvas: z.object({
        width: z.number().int().min(128).max(4096),
        height: z.number().int().min(128).max(4096),
        background: z.string().trim().min(1).max(120).optional()
      }).strict().optional(),
      figureId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      visualDocumentId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingCompositeRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        visualPlan: input.visualPlan,
        reviewTask: input.reviewTask,
        ...(input.reviewReferencePath ? { reviewReferencePath: input.reviewReferencePath } : {}),
        layers: input.layers,
        ...(input.canvas ? { canvas: input.canvas } : {}),
        ...(input.figureId ? { figureId: input.figureId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {})
      }
      const result = await compositeScientificPlotLayers(request)
      const nextCall = result.ok
        ? {
            tool: 'image_generation_review_candidate',
            arguments: {
              workspaceRoot: request.workspaceRoot,
              outputPath: result.outputPath,
              manifestPath: result.manifestPath,
              task: request.reviewTask,
              ...(request.reviewReferencePath ? { referencePath: request.reviewReferencePath } : {})
            }
          }
        : undefined
      return textResult(
        result.ok
          ? jsonSummary('Composed hybrid visual layers.', { result, nextCall })
          : jsonSummary(`Hybrid visual composition failed: ${result.status}.`, result),
        { result, ...(nextCall ? { nextCall } : {}) }
      )
    } catch (error) {
      return errorResult(`Failed to composite hybrid visual layers: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_prepare_reference', {
    title: 'Prepare Scientific Plot Reference',
    description: 'Crop a workspace image or PDF page into a PNG reference, then optionally extract a VisualStyleProfile and template profile.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      sourcePath: z.string().trim().min(1).max(4096),
      sourceType: z.enum(['image', 'pdf']).optional(),
      page: z.number().int().min(1).max(5000).optional(),
      cropBox: cropBoxSchema.optional(),
      figureId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      dpi: z.number().min(72).max(360).optional(),
      extractStyle: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingPrepareReferenceRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        sourcePath: input.sourcePath,
        ...(input.sourceType ? { sourceType: input.sourceType } : {}),
        ...(input.page ? { page: input.page } : {}),
        ...(input.cropBox ? { cropBox: input.cropBox } : {}),
        ...(input.figureId ? { figureId: input.figureId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.dpi ? { dpi: input.dpi } : {}),
        ...(input.extractStyle !== undefined ? { extractStyle: input.extractStyle } : {})
      }
      const result = await prepareScientificPlottingReference(request)
      return textResult(
        result.ok
          ? jsonSummary('Prepared scientific plotting reference.', result)
          : jsonSummary(`Scientific plotting reference preparation failed: ${result.status}.`, result),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to prepare scientific plotting reference: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_review_packet', {
    title: 'Create Scientific Plotting Review Packet',
    description: 'Create a Markdown and JSON review packet from existing SciForge scientific plotting render manifests.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      manifestPaths: z.array(z.string().trim().min(1).max(4096)).min(1).max(30),
      packetId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      title: z.string().trim().max(240).optional(),
      maxItems: z.number().int().min(1).max(30).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingReviewPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        manifestPaths: input.manifestPaths,
        ...(input.packetId ? { packetId: input.packetId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.maxItems ? { maxItems: input.maxItems } : {})
      }
      const packet = await createScientificPlottingReviewPacket(request)
      return textResult(
        packet.ok
          ? jsonSummary('Created scientific plotting review packet.', packet)
          : jsonSummary(`Scientific plotting review packet failed: ${packet.status}.`, packet),
        { packet }
      )
    } catch (error) {
      return errorResult(`Failed to create scientific plotting review packet: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
