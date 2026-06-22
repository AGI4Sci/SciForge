import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  type ScientificPlottingDataMappingRequest,
  type ScientificPlottingPrepareReferenceRequest,
  type ScientificPlottingRenderRequest,
  type ScientificPlottingReviewPacketRequest,
  type ScientificPlottingReviewRequest,
  type ScientificPlottingStyleProfilesRequest,
  type ScientificPlottingStyleTransferRequest
} from '../shared/scientific-plotting'
import {
  createScientificPlottingReviewPacket,
  getScientificPlottingStatus,
  listScientificPlottingStyleProfiles,
  mapScientificPlottingData,
  planScientificPlotting,
  prepareScientificPlottingReference,
  renderScientificPlot,
  reviewScientificPlottingOutput,
  runScientificPlottingStyleTransfer
} from './scientific-plotting-engine'
import { SCIENTIFIC_PLOTTING_MCP_FLAG } from './scientific-plotting-mcp-config'

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

  const templateSchema = z.enum(SCIENTIFIC_PLOTTING_TEMPLATES)
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

  server.registerTool('scientific_plotting_status', {
    title: 'Scientific Plotting MCP Status',
    description: 'Report the controlled SciForge scientific plotting renderer status, supported templates, and artifact policy.',
    annotations: READ_ONLY_ANNOTATIONS
  }, async () => {
    try {
      const status = await getScientificPlottingStatus()
      return textResult(
        status.ok && status.degraded
          ? 'Scientific plotting MCP is available but renderer is degraded.'
          : 'Scientific plotting MCP is available.',
        { status }
      )
    } catch (error) {
      return errorResult(`Failed to inspect scientific plotting status: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

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

  server.registerTool('scientific_plotting_plan', {
    title: 'Plan Scientific Plot',
    description: 'Plan a controlled scientific plot from user intent. Does not emit executable shell or Python commands.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1),
      templateHint: templateSchema.optional(),
      styleSpec: z.unknown().optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      styleProfileId: z.string().trim().max(160).optional(),
      referencePath: z.string().trim().max(4096).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ workspaceRoot, task, templateHint, styleSpec, styleSpecPath, styleProfileId, referencePath }) => {
    try {
      const plan = await planScientificPlotting({
        workspaceRoot: workspaceRoot?.trim() || options.workspaceRoot,
        task,
        templateHint,
        ...(styleSpec ? { styleSpec: styleSpec as never } : {}),
        ...(styleSpecPath ? { styleSpecPath } : {}),
        ...(styleProfileId ? { styleProfileId } : {}),
        ...(referencePath ? { referencePath } : {})
      })
      return textResult(jsonSummary('Scientific plotting plan.', plan), { plan })
    } catch (error) {
      return errorResult(`Failed to plan scientific plot: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_map_data', {
    title: 'Map Data To Scientific Plot',
    description: 'Map structured data or tabular records into a controlled scientific_plotting_render request. Does not render or write files.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1),
      data: z.unknown(),
      labels: z.object({
        title: z.string().trim().max(300).optional(),
        x: z.string().trim().max(200).optional(),
        y: z.string().trim().max(200).optional(),
        legend: z.boolean().optional(),
        panel: z.string().trim().max(16).optional()
      }).strict().optional(),
      templateHint: templateSchema.optional(),
      styleSpec: z.unknown().optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      styleProfileId: z.string().trim().max(160).optional(),
      referencePath: z.string().trim().max(4096).optional(),
      reviewReferencePath: z.string().trim().max(4096).optional(),
      figureId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      autoRepair: z.object({
        enabled: z.boolean().optional(),
        maxAttempts: z.union([z.literal(0), z.literal(1)]).optional(),
        minOverall: z.number().min(0.5).max(0.98).optional()
      }).strict().optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingDataMappingRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        task: input.task,
        data: input.data,
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.templateHint ? { templateHint: input.templateHint } : {}),
        ...(input.styleSpec ? { styleSpec: input.styleSpec as never } : {}),
        ...(input.styleSpecPath ? { styleSpecPath: input.styleSpecPath } : {}),
        ...(input.styleProfileId ? { styleProfileId: input.styleProfileId } : {}),
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.reviewReferencePath ? { reviewReferencePath: input.reviewReferencePath } : {}),
        ...(input.figureId ? { figureId: input.figureId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.autoRepair ? { autoRepair: input.autoRepair } : {})
      }
      const mapping = await mapScientificPlottingData(request)
      return textResult(
        mapping.ok
          ? jsonSummary(`Mapped data to template: ${mapping.selectedTemplate}.`, mapping)
          : jsonSummary(`Scientific plotting data mapping needs input: ${mapping.status}.`, mapping),
        { mapping }
      )
    } catch (error) {
      return errorResult(`Failed to map data for scientific plotting: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_render', {
    title: 'Render Scientific Plot',
    description: 'Render a PNG artifact from structured JSON data with optional FigureStyleSpec and bounded style auto-repair.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      template: templateSchema,
      data: z.unknown(),
      labels: z.object({
        title: z.string().trim().max(300).optional(),
        x: z.string().trim().max(200).optional(),
        y: z.string().trim().max(200).optional(),
        legend: z.boolean().optional(),
        panel: z.string().trim().max(16).optional()
      }).strict().optional(),
      figureId: z.string().trim().max(120).optional(),
      styleSpec: z.unknown().optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      styleProfileId: z.string().trim().max(160).optional(),
      referencePath: z.string().trim().max(4096).optional(),
      reviewReferencePath: z.string().trim().max(4096).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      autoRepair: z.object({
        enabled: z.boolean().optional(),
        maxAttempts: z.union([z.literal(0), z.literal(1)]).optional(),
        minOverall: z.number().min(0.5).max(0.98).optional()
      }).strict().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingRenderRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        template: input.template,
        data: input.data,
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.figureId ? { figureId: input.figureId } : {}),
        ...(input.styleSpec ? { styleSpec: input.styleSpec as never } : {}),
        ...(input.styleSpecPath ? { styleSpecPath: input.styleSpecPath } : {}),
        ...(input.styleProfileId ? { styleProfileId: input.styleProfileId } : {}),
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.reviewReferencePath ? { reviewReferencePath: input.reviewReferencePath } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.autoRepair ? { autoRepair: input.autoRepair } : {})
      }
      const result = await renderScientificPlot(request)
      return textResult(
        result.ok
          ? jsonSummary(`Rendered scientific plot: ${result.status}.`, result)
          : jsonSummary(`Scientific plot render failed: ${result.status}.`, result),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to render scientific plot: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_style_transfer', {
    title: 'Run Scientific Plotting Style Transfer',
    description: 'Run the v2 controlled paper-figure style-transfer workflow: prepare/reference-match, plan, map data, render, review, and write a review packet.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1),
      data: z.unknown(),
      labels: z.object({
        title: z.string().trim().max(300).optional(),
        x: z.string().trim().max(200).optional(),
        y: z.string().trim().max(200).optional(),
        legend: z.boolean().optional(),
        panel: z.string().trim().max(16).optional()
      }).strict().optional(),
      templateHint: templateSchema.optional(),
      reference: z.object({
        sourcePath: z.string().trim().max(4096).optional(),
        referencePath: z.string().trim().max(4096).optional(),
        sourceType: z.enum(['image', 'pdf']).optional(),
        page: z.number().int().min(1).max(5000).optional(),
        cropBox: cropBoxSchema.optional(),
        figureId: z.string().trim().max(120).optional(),
        dpi: z.number().min(72).max(360).optional()
      }).strict().optional(),
      styleSpec: z.unknown().optional(),
      styleSpecPath: z.string().trim().max(4096).optional(),
      styleProfileId: z.string().trim().max(160).optional(),
      figureId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      autoRepair: z.object({
        enabled: z.boolean().optional(),
        maxAttempts: z.union([z.literal(0), z.literal(1)]).optional(),
        minOverall: z.number().min(0.5).max(0.98).optional()
      }).strict().optional(),
      createReviewPacket: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingStyleTransferRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        task: input.task,
        data: input.data,
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.templateHint ? { templateHint: input.templateHint } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.styleSpec ? { styleSpec: input.styleSpec as never } : {}),
        ...(input.styleSpecPath ? { styleSpecPath: input.styleSpecPath } : {}),
        ...(input.styleProfileId ? { styleProfileId: input.styleProfileId } : {}),
        ...(input.figureId ? { figureId: input.figureId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.autoRepair ? { autoRepair: input.autoRepair } : {}),
        ...(input.createReviewPacket !== undefined ? { createReviewPacket: input.createReviewPacket } : {})
      }
      const result = await runScientificPlottingStyleTransfer(request)
      return textResult(
        result.ok
          ? jsonSummary(`Scientific plotting style transfer: ${result.status}.`, result)
          : jsonSummary(`Scientific plotting style transfer failed: ${result.status}.`, result),
        { result }
      )
    } catch (error) {
      return errorResult(`Failed to run scientific plotting style transfer: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_prepare_reference', {
    title: 'Prepare Scientific Plot Reference',
    description: 'Crop a workspace image or PDF page into a PNG reference, then optionally extract FigureStyleSpec and template profile.',
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

  server.registerTool('scientific_plotting_review', {
    title: 'Review Scientific Plot Style',
    description: 'Compare a rendered output figure with a reference image and return interpretable style scores and repair suggestions.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      referencePath: z.string().trim().min(1).max(4096),
      outputPath: z.string().trim().min(1).max(4096),
      template: templateSchema.optional(),
      minOverall: z.number().min(0.5).max(0.98).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingReviewRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        referencePath: input.referencePath,
        outputPath: input.outputPath,
        ...(input.template ? { template: input.template } : {}),
        ...(input.minOverall ? { minOverall: input.minOverall } : {})
      }
      const review = await reviewScientificPlottingOutput(request)
      return textResult(jsonSummary('Scientific plotting style review.', review), { review })
    } catch (error) {
      return errorResult(`Failed to review scientific plot: ${error instanceof Error ? error.message : String(error)}`)
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
