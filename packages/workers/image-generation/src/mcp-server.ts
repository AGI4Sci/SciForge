import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { IMAGE_DRAWING_INTENTS, IMAGE_EDIT_MODES, IMAGE_GENERATION_MCP_FLAG, IMAGE_GENERATION_MODES, IMAGE_OUTPUT_FORMATS } from './contract'
import type {
  FrameworkLocalizedEditRequest,
  ImageGenerationEditFromCanvasPacketRequest,
  ImageGenerationPlanRequest,
  ImageGenerationRecipe,
  ImageGenerationRenderRequest,
  ImageGenerationReviewPacketRequest,
  ImageGenerationSegmentComponentsRequest,
  ImageGenerationReviewRequest
} from './types'
import {
  createImageGenerationReviewPacket,
  editFrameworkComponentsWithImage2,
  editImageFromCanvasPacket,
  getImageGenerationStatus,
  planImageGeneration,
  renderImageGeneration,
  reviewImageGenerationOutput,
  segmentImageGenerationComponents
} from './image-generation-engine'

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
  if (!argv.includes(IMAGE_GENERATION_MCP_FLAG)) return null
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
  return title + '\n\n' + JSON.stringify(value, null, 2)
}

function workspaceRootFor(inputWorkspaceRoot: string | undefined, options: McpLaunchOptions): string {
  const workspaceRoot = inputWorkspaceRoot?.trim() || options.workspaceRoot?.trim()
  if (!workspaceRoot) throw new Error('workspaceRoot is required. Launch this MCP with --workspace-root or pass workspaceRoot to the tool.')
  return workspaceRoot
}

const sizeSchema = z.object({
  width: z.number().int().min(128).max(4096),
  height: z.number().int().min(128).max(4096)
}).strict()

const IMAGE_GENERATION_ROUTING_DESCRIPTION = 'Use image_generation for semantic/creative visual generation: flowcharts or diagrams from long prose, infographics, covers, posters, and illustrative scientific visuals. Use scientific_plotting only for structured numeric charts or explicit compact node-edge diagrams.'

const scientificPolishDeltaPlanSchema = z.object({
  mode: z.literal('delta_only'),
  targetPanels: z.array(z.object({
    assetId: z.string().trim().min(1).max(160),
    reason: z.string().trim().max(800).optional(),
    allowedOperations: z.array(z.string().trim().min(1).max(80)).max(12).optional()
  }).strict()).max(24).optional(),
  allowedOperations: z.array(z.string().trim().min(1).max(80)).max(16),
  lockedFacts: z.array(z.string().trim().min(1).max(240)).max(32),
  handoffPrompt: z.string().trim().min(1).max(4000)
}).strict()

const recipeSchema = z.object({
  mode: z.enum(IMAGE_GENERATION_MODES),
  prompt: z.string().trim().min(1).max(16000).describe(IMAGE_GENERATION_ROUTING_DESCRIPTION),
  model: z.string().trim().max(160).optional(),
  negativePrompt: z.string().trim().max(4000).optional(),
  size: sizeSchema,
  stylePreset: z.string().trim().max(160).optional(),
  referencePath: z.string().trim().max(4096).optional(),
  outputFormat: z.enum(IMAGE_OUTPUT_FORMATS).optional(),
  intent: z.enum(IMAGE_DRAWING_INTENTS).optional(),
  drawingBrief: z.unknown().optional(),
  diagramSpec: z.unknown().optional(),
  frameworkDesignPlan: z.unknown().optional(),
  frameworkRegionAssetMode: z.enum(['disabled', 'generate']).optional(),
  confirmation: z.object({
    status: z.enum(['required', 'confirmed'])
  }).strict().optional(),
  promptProfile: z.enum(['default', 'flowchart-light-v1', 'framework-spec-v1', 'framework-layered-draft-v1']).optional(),
  scientificPolishDeltaPlan: scientificPolishDeltaPlanSchema.optional(),
  controlledSubfigureManifests: z.array(z.string().trim().min(1).max(4096)).max(24).optional()
}).strict()

export async function runImageGenerationMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false

  const server = new McpServer(
    { name: 'sciforge-image-generation', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('image_generation_status', {
    title: 'Image Generation MCP Status',
    description: `Report the controlled SciForge image generation provider status, visual routing guidance, and artifact policy. ${IMAGE_GENERATION_ROUTING_DESCRIPTION}`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async ({ workspaceRoot }) => {
    try {
      const status = await getImageGenerationStatus(workspaceRoot?.trim() || options.workspaceRoot)
      return textResult('Image generation MCP is available.', { status })
    } catch (error) {
      return errorResult('Failed to inspect image generation status: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_plan', {
    title: 'Plan Image Generation',
    description: `Convert a user image request into a controlled image_generation_render recipe. ${IMAGE_GENERATION_ROUTING_DESCRIPTION} Does not write files. For scientific figures, plan generated rasters as visual composition/base layers only; final labels, axes, numeric data, citations, scale bars, molecular annotations, and other scientific claims must be overlaid by deterministic scripts such as scientific_plotting.`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1).max(8000),
      drawingIntent: z.enum(IMAGE_DRAWING_INTENTS).optional(),
      modeHint: z.enum(IMAGE_GENERATION_MODES).optional(),
      size: z.object({
        width: z.number().int().min(128).max(4096).optional(),
        height: z.number().int().min(128).max(4096).optional()
      }).strict().optional(),
      stylePreset: z.string().trim().max(160).optional(),
      referencePath: z.string().trim().max(4096).optional(),
      canvasId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
      insertToCanvas: z.boolean().optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationPlanRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        task: input.task,
        ...(input.drawingIntent ? { drawingIntent: input.drawingIntent } : {}),
        ...(input.modeHint ? { modeHint: input.modeHint } : {}),
        ...(input.size ? { size: input.size } : {}),
        ...(input.stylePreset ? { stylePreset: input.stylePreset } : {}),
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.insertToCanvas !== undefined ? { insertToCanvas: input.insertToCanvas } : {})
      }
      const plan = await planImageGeneration(request)
      return textResult(jsonSummary('Image generation plan.', plan), { plan })
    } catch (error) {
      return errorResult('Failed to plan image generation: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_render', {
    title: 'Render Image Generation Artifact',
    description: `Render a controlled image artifact from a structured recipe and write a SciForge artifact manifest for Canvas import. ${IMAGE_GENERATION_ROUTING_DESCRIPTION} For scientific figures, gpt-image-style providers are visual composition/base-image tools only; publication labels, axes, numeric data, citations, scale bars, molecular annotations, and other scientific claims must be added by deterministic scripts such as scientific_plotting.`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      recipe: recipeSchema,
      imageId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      reviewReferencePath: z.string().trim().max(4096).optional(),
      canvasId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
      insertToCanvas: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationRenderRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        recipe: input.recipe as ImageGenerationRecipe,
        ...(input.imageId ? { imageId: input.imageId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.reviewReferencePath ? { reviewReferencePath: input.reviewReferencePath } : {}),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.insertToCanvas !== undefined ? { insertToCanvas: input.insertToCanvas } : {})
      }
      const result = await renderImageGeneration(request)
      return textResult(
        result.ok
          ? jsonSummary('Rendered image generation artifact: ' + result.status + '.', result)
          : jsonSummary('Image generation render failed: ' + result.status + '.', result),
        { result }
      )
    } catch (error) {
      return errorResult('Failed to render image: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_segment_components', {
    title: 'Segment Framework Image Components',
    description: 'Split an existing generated framework PNG into a component JSON manifest, component-base image, segmentation preview, and transparent component assets. Supports SciForge-compatible local segmentation runners such as FastSAM, SAM-style, or custom adapters.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      sourceImagePath: z.string().trim().min(1).max(4096),
      frameworkDesignPlanPath: z.string().trim().max(4096).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      imageId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationSegmentComponentsRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        sourceImagePath: input.sourceImagePath,
        ...(input.frameworkDesignPlanPath ? { frameworkDesignPlanPath: input.frameworkDesignPlanPath } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.imageId ? { imageId: input.imageId } : {})
      }
      const result = await segmentImageGenerationComponents(request)
      return textResult(
        result.ok
          ? jsonSummary('Segmented framework image components.', result)
          : jsonSummary('Framework component segmentation failed: ' + result.status + '.', result),
        { result }
      )
    } catch (error) {
      return errorResult('Failed to segment framework components: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_edit_components', {
    title: 'Edit Framework Components With Image2',
    description: 'Redraw selected framework component IDs from a component manifest, then recompose the edited patch into the original image without relying on manual bounding boxes.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      componentManifestPath: z.string().trim().min(1).max(4096),
      componentIds: z.array(z.string().trim().min(1).max(180)).max(500).optional(),
      blockIds: z.array(z.string().trim().min(1).max(180)).max(200).optional(),
      instruction: z.string().trim().min(1).max(4000),
      outputDir: z.string().trim().max(4096).optional(),
      imageId: z.string().trim().max(120).optional(),
      canvasId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
      padding: z.number().min(0).max(256).optional(),
      editCanvasSize: z.number().int().min(128).max(2048).optional(),
      insertToCanvas: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: FrameworkLocalizedEditRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        componentManifestPath: input.componentManifestPath,
        instruction: input.instruction,
        ...(input.componentIds?.length ? { componentIds: input.componentIds } : {}),
        ...(input.blockIds?.length ? { blockIds: input.blockIds } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.imageId ? { imageId: input.imageId } : {}),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.padding !== undefined ? { padding: input.padding } : {}),
        ...(input.editCanvasSize !== undefined ? { editCanvasSize: input.editCanvasSize } : {}),
        ...(input.insertToCanvas !== undefined ? { insertToCanvas: input.insertToCanvas } : {})
      }
      const result = await editFrameworkComponentsWithImage2(request)
      return textResult(
        result.ok
          ? jsonSummary('Edited framework component artifact: ' + result.status + '.', result)
          : jsonSummary('Framework component edit failed: ' + result.status + '.', result),
        { result }
      )
    } catch (error) {
      return errorResult('Failed to edit framework components: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_edit_from_canvas_packet', {
    title: 'Edit Image From Canvas Review Packet',
    description: 'Convert SciForge Canvas annotations into non-destructive image edit artifacts. Does not overwrite the original image.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      reviewPacketPath: z.string().trim().max(4096).optional(),
      reviewPacket: z.unknown().optional(),
      outputDir: z.string().trim().max(4096).optional(),
      imageId: z.string().trim().max(120).optional(),
      canvasId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationEditFromCanvasPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        ...(input.reviewPacketPath ? { reviewPacketPath: input.reviewPacketPath } : {}),
        ...(input.reviewPacket ? { reviewPacket: input.reviewPacket } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.imageId ? { imageId: input.imageId } : {}),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {})
      }
      const result = await editImageFromCanvasPacket(request)
      return textResult(
        result.ok
          ? jsonSummary('Edited image artifacts from Canvas packet: ' + result.status + '.', result)
          : jsonSummary('Canvas image edit failed: ' + result.status + '.', result),
        { result }
      )
    } catch (error) {
      return errorResult('Failed to edit image from Canvas packet: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_review', {
    title: 'Review Image Generation Output',
    description: 'Review a generated or edited image for basic quality and optional reference aspect similarity.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      outputPath: z.string().trim().min(1).max(4096),
      referencePath: z.string().trim().max(4096).optional(),
      minOverall: z.number().min(0.5).max(0.98).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationReviewRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        outputPath: input.outputPath,
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.minOverall ? { minOverall: input.minOverall } : {})
      }
      const review = await reviewImageGenerationOutput(request)
      return textResult(jsonSummary('Image generation review.', review), { review })
    } catch (error) {
      return errorResult('Failed to review image: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_review_packet', {
    title: 'Create Image Generation Review Packet',
    description: 'Create a JSON and Markdown review packet from existing image generation manifests.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      manifestPaths: z.array(z.string().trim().min(1).max(4096)).min(1).max(30),
      packetId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      title: z.string().trim().max(240).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationReviewPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        manifestPaths: input.manifestPaths,
        ...(input.packetId ? { packetId: input.packetId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.title ? { title: input.title } : {})
      }
      const packet = await createImageGenerationReviewPacket(request)
      return textResult(
        packet.ok
          ? jsonSummary('Created image generation review packet.', packet)
          : jsonSummary('Image generation review packet failed: ' + packet.status + '.', packet),
        { packet }
      )
    } catch (error) {
      return errorResult('Failed to create image generation review packet: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
