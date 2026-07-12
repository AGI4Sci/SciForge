import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  type ScientificPlottingDataMappingRequest,
  type ScientificPlottingPrepareReferenceRequest,
  type ScientificPlottingRenderRequest,
  type ScientificPlottingResearchBriefRequest,
  type ScientificPlottingReviewPacketRequest,
  type ScientificPlottingStyleProfilesRequest,
} from './types'
import {
  createScientificPlottingResearchBrief,
  createScientificPlottingReviewPacket,
  getScientificPlottingStatus,
  listScientificPlottingStyleProfiles,
  mapScientificPlottingData,
  prepareScientificPlottingReference,
  renderScientificPlot
} from './scientific-plotting-engine'
import { planScientificVisual } from './scientific-visual-planner'
import { SCIENTIFIC_PLOTTING_MCP_FLAG } from './contract'

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

const controlledPlottingPlanSchema = z.object({
  route: z.enum(['deterministic_plot', 'hybrid_composite']),
  routeLocked: z.literal(true),
  rationale: z.string().trim().min(1).max(2000),
  reproducibleInputs: z.array(z.string().trim().min(1).max(1000)).min(1).max(64),
  truthLockedElements: z.array(z.string().trim().min(1).max(1000)).min(1).max(64),
  fallbackPolicy: z.literal('fail_closed')
}).strict()

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

const TEMPLATE_SELECTION_DESCRIPTION = 'Template selection guide: use scientific_plotting for structured numeric/table/matrix data and paper-figure draft/spec planning. Use image_generation for final flowcharts, model architecture diagrams, mechanisms, infographics, covers, posters, or illustrative diagrams where the image model should choose layout/icons/composition. Within scientific_plotting: flowchart/schematic-grid are draft structures only and scientific_plotting_render will return a draft handoff instead of a final PNG; use bar/errorbar-bar for categorical summaries; use line/scatter for measured x-y data; use heatmap/attention-map for matrices; use box-violin or histogram-density for distributions; use multi-panel only when combining controlled numeric/statistical panels.'

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

  server.registerTool('scientific_plotting_status', {
    title: 'Scientific Plotting MCP Status',
    description: 'Report the controlled SciForge scientific plotting renderer status, supported templates, model-facing template selection guide, and artifact policy.',
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

  server.registerTool('scientific_plotting_research_brief', {
    title: 'Build Scientific Figure Research Brief',
    description: 'Create a read-only CNS/domain-aware paper-figure brief before rendering: figure need classification, reference-paper strategy, figure conclusion, evidence logic, archetype, data requirements, and next controlled tool. Does not search the web, execute scripts, or write files.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1),
      domain: z.string().trim().max(120).optional(),
      targetVenue: z.string().trim().max(120).optional(),
      dataSummary: z.string().trim().max(4000).optional(),
      referenceFigureNotes: z.string().trim().max(4000).optional(),
      candidatePapers: z.array(z.object({
        title: z.string().trim().min(1).max(500),
        venue: z.string().trim().max(120).optional(),
        year: z.number().int().min(1800).max(2200).optional(),
        source: z.string().trim().max(160).optional(),
        url: z.string().trim().max(2048).optional(),
        doi: z.string().trim().max(240).optional(),
        figureHints: z.array(z.string().trim().max(300)).max(12).optional(),
        notes: z.string().trim().max(1200).optional()
      }).strict()).max(8).optional(),
      maxPapers: z.number().int().min(0).max(8).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ScientificPlottingResearchBriefRequest = {
        ...(input.workspaceRoot || options.workspaceRoot ? { workspaceRoot: input.workspaceRoot ?? options.workspaceRoot } : {}),
        task: input.task,
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.targetVenue ? { targetVenue: input.targetVenue } : {}),
        ...(input.dataSummary ? { dataSummary: input.dataSummary } : {}),
        ...(input.referenceFigureNotes ? { referenceFigureNotes: input.referenceFigureNotes } : {}),
        ...(input.candidatePapers ? { candidatePapers: input.candidatePapers } : {}),
        ...(input.maxPapers !== undefined ? { maxPapers: input.maxPapers } : {})
      }
      const brief = await createScientificPlottingResearchBrief(request)
      return textResult(
        brief.ok
          ? jsonSummary('Scientific plotting research brief.', brief)
          : jsonSummary('Scientific plotting research brief failed.', brief),
        { brief }
      )
    } catch (error) {
      return errorResult(`Failed to build scientific plotting research brief: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_visual_plan', {
    title: 'Plan Scientific Visual',
    description: 'Lock one general scientific-visual production route before rendering. The calling model must inspect the task and submit a structured decision. Choose deterministic_plot when exact data, axes, statistics, coordinates, or reproducibility dominate; choose generative_visual for conceptual or illustrative composition without data-bearing marks; choose hybrid_composite when deterministic truth layers and generated conceptual composition are both required. The returned route is fail-closed and cannot silently fall back to another route.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1).max(16000),
      action: z.enum(['create', 'revision']).optional(),
      visualDocumentId: z.string().trim().min(1).max(160).optional(),
      reviewPacketPath: z.string().trim().min(1).max(4096).optional(),
      sourceArtifacts: z.array(z.string().trim().min(1).max(4096)).max(64).optional(),
      decision: z.object({
        route: z.enum(['deterministic_plot', 'generative_visual', 'hybrid_composite']),
        rationale: z.string().trim().min(1).max(2000),
        reproducibleInputs: z.array(z.string().trim().min(1).max(1000)).max(64),
        truthLockedElements: z.array(z.string().trim().min(1).max(1000)).min(1).max(64)
      }).strict()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ workspaceRoot, task, action, visualDocumentId, reviewPacketPath, sourceArtifacts, decision }) => {
    try {
      const plan = planScientificVisual({
        workspaceRoot: workspaceRoot?.trim() || options.workspaceRoot,
        task,
        ...(action ? { action } : {}),
        ...(visualDocumentId ? { visualDocumentId } : {}),
        ...(reviewPacketPath ? { reviewPacketPath } : {}),
        ...(sourceArtifacts ? { sourceArtifacts } : {}),
        decision
      })
      return textResult(jsonSummary('Scientific visual plan.', plan), { plan })
    } catch (error) {
      return errorResult(`Failed to plan scientific visual: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.registerTool('scientific_plotting_map_data', {
    title: 'Map Data To Scientific Plot',
    description: `Map structured data or tabular records into a controlled scientific_plotting_render request after choosing a template. ${TEMPLATE_SELECTION_DESCRIPTION} Does not render or write files.`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      scientificVisualPlan: controlledPlottingPlanSchema,
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
      outputScale: z.number().min(1).max(4).optional(),
      visualDocumentId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
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
        scientificVisualPlan: input.scientificVisualPlan,
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
        ...(input.outputScale ? { outputScale: input.outputScale } : {}),
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
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
    description: `Render a PNG artifact from structured JSON data with optional FigureStyleSpec and bounded style auto-repair. ${TEMPLATE_SELECTION_DESCRIPTION} Call scientific_visual_plan before choosing a rendering route; use this renderer only when its locked execution stages select it.`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      scientificVisualPlan: controlledPlottingPlanSchema,
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
      outputScale: z.number().min(1).max(4).optional(),
      visualDocumentId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
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
        scientificVisualPlan: input.scientificVisualPlan,
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
        ...(input.outputScale ? { outputScale: input.outputScale } : {}),
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
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
