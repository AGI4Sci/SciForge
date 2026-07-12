import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { IMAGE_DRAWING_INTENTS, IMAGE_EDIT_MODES, IMAGE_GENERATION_MCP_FLAG, IMAGE_GENERATION_MODES, IMAGE_OUTPUT_FORMATS } from './contract'
import type {
  FrameworkLocalizedEditRequest,
  ImageGenerationEditFromVisualReviewPacketRequest,
  ImageGenerationPlanRequest,
  ImageGenerationRecipe,
  ImageGenerationRenderRequest,
  ImageGenerationSegmentComponentsRequest,
  VisualArtifactReviewRequest
} from './types'
import {
  editFrameworkComponentsWithImage2,
  editImageFromVisualReviewPacket,
  getImageGenerationStatus,
  planImageGeneration,
  renderImageGeneration,
  reviewVisualArtifact,
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

const IMAGE_GENERATION_EXECUTION_DESCRIPTION = 'Prepare and render generative image artifacts after route selection. Scientific visual routing is owned exclusively by scientific_visual_plan; this worker never switches to deterministic plotting or treats a fallback renderer as success.'

const scientificVisualPlanSchema = z.object({
  route: z.enum(['generative_visual', 'hybrid_composite']),
  routeLocked: z.literal(true),
  rationale: z.string().trim().min(1).max(2000),
  reproducibleInputs: z.array(z.string().trim().min(1).max(4096)).max(64),
  truthLockedElements: z.array(z.string().trim().min(1).max(1000)).max(128),
  fallbackPolicy: z.literal('fail_closed')
}).strict()

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
  prompt: z.string().trim().min(1).max(16000).describe(IMAGE_GENERATION_EXECUTION_DESCRIPTION),
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
  controlledSubfigureManifests: z.array(z.string().trim().min(1).max(4096)).max(24).optional(),
  scientificVisualPlan: scientificVisualPlanSchema.optional(),
  creativeDirect: z.literal(true).optional()
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
    description: `Report the controlled SciForge image generation provider status and artifact policy. ${IMAGE_GENERATION_EXECUTION_DESCRIPTION}`,
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

  server.registerTool('image_generation_prepare', {
    title: 'Prepare Generative Image',
    description: `Convert an already-routed visual request into a controlled image_generation_render recipe. ${IMAGE_GENERATION_EXECUTION_DESCRIPTION} Does not write files. Supply either the locked plan returned by scientific_visual_plan or creativeDirect=true for a clearly non-scientific creative image; the two classifications are mutually exclusive.`,
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
      scientificVisualPlan: scientificVisualPlanSchema.optional(),
      creativeDirect: z.literal(true).optional()
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
        ...(input.scientificVisualPlan ? { scientificVisualPlan: input.scientificVisualPlan } : {}),
        ...(input.creativeDirect ? { creativeDirect: true as const } : {})
      }
      const plan = await planImageGeneration(request)
      return textResult(
        jsonSummary(plan.ok ? 'Generative image preparation.' : 'Generative image preparation blocked.', plan),
        { plan }
      )
    } catch (error) {
      return errorResult('Failed to plan image generation: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('image_generation_render', {
    title: 'Render Image Generation Artifact',
    description: `Render a controlled generative image artifact and write a SciForge artifact manifest for VisualDocument review. ${IMAGE_GENERATION_EXECUTION_DESCRIPTION} For scientific figures, generated pixels are visual composition/base layers only; publication labels, axes, numeric data, citations, scale bars, molecular annotations, and other locked claims require deterministic overlays.`,
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      recipe: recipeSchema,
      imageId: z.string().trim().max(120).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      visualDocumentId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
      stageForVisualReview: z.boolean().optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationRenderRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        recipe: input.recipe as ImageGenerationRecipe,
        ...(input.imageId ? { imageId: input.imageId } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.stageForVisualReview !== undefined ? { stageForVisualReview: input.stageForVisualReview } : {})
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
      visualDocumentId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional(),
      padding: z.number().min(0).max(256).optional(),
      editCanvasSize: z.number().int().min(128).max(2048).optional(),
      stageForVisualReview: z.boolean().optional()
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
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.padding !== undefined ? { padding: input.padding } : {}),
        ...(input.editCanvasSize !== undefined ? { editCanvasSize: input.editCanvasSize } : {}),
        ...(input.stageForVisualReview !== undefined ? { stageForVisualReview: input.stageForVisualReview } : {})
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

  server.registerTool('image_generation_edit_from_visual_review_packet', {
    title: 'Edit Image From Visual Review Packet',
    description: 'Convert VisualDocument annotations into non-destructive image edit candidates. Does not overwrite the original image.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      reviewPacketPath: z.string().trim().max(4096).optional(),
      reviewPacket: z.unknown().optional(),
      outputDir: z.string().trim().max(4096).optional(),
      imageId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationEditFromVisualReviewPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        ...(input.reviewPacketPath ? { reviewPacketPath: input.reviewPacketPath } : {}),
        ...(input.reviewPacket ? { reviewPacket: input.reviewPacket } : {}),
        ...(input.outputDir ? { outputDir: input.outputDir } : {}),
        ...(input.imageId ? { imageId: input.imageId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {})
      }
      const result = await editImageFromVisualReviewPacket(request)
      return textResult(
        result.ok
          ? jsonSummary('Edited image candidates from visual-review packet: ' + result.status + '.', result)
          : jsonSummary('Visual-review image edit failed: ' + result.status + '.', result),
        { result }
      )
    } catch (error) {
      return errorResult('Failed to edit image from visual-review packet: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  server.registerTool('visual_artifact_review', {
    title: 'Review Visual Artifact',
    description: 'Use Model Router vision understanding to semantically review any route-produced visual against its task and truth locks. File existence, dimensions, and non-empty pixels are only supporting checks and cannot pass a visibly broken artifact.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      outputPath: z.string().trim().min(1).max(4096),
      task: z.string().trim().min(1).max(16000),
      truthLockedElements: z.array(z.string().trim().min(1).max(1000)).max(64),
      referencePath: z.string().trim().max(4096).optional(),
      minOverall: z.number().min(0.5).max(0.98).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: VisualArtifactReviewRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        outputPath: input.outputPath,
        task: input.task,
        truthLockedElements: input.truthLockedElements,
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.minOverall ? { minOverall: input.minOverall } : {})
      }
      const review = await reviewVisualArtifact(request)
      return textResult(jsonSummary('Semantic visual artifact review.', review), { review })
    } catch (error) {
      return errorResult('Failed to review image: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
