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
import { planVisualProduction } from './visual-production-planner'
import type { VisualGenerateRequest } from './visual-production-planner'

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

const IMAGE_GENERATION_EXECUTION_DESCRIPTION = 'Prepare and render model-owned visual layers after visual_generate has locked one code, model, or hybrid production route. Execution tools never reclassify prompts or switch routes.'

const visualPlanSchema = z.object({
  planId: z.string().trim().min(1).max(128),
  route: z.enum(['code', 'model', 'hybrid']),
  routeLocked: z.literal(true),
  rationale: z.string().trim().min(1).max(2000),
  sourceArtifacts: z.array(z.string().trim().min(1).max(4096)).max(64),
  reproducibleInputs: z.array(z.string().trim().min(1).max(4096)).max(64),
  lockedElements: z.array(z.string().trim().min(1).max(1000)).max(128),
  modelOwnedElements: z.array(z.string().trim().min(1).max(1000)).max(128),
  contextStatus: z.enum(['ready', 'budget_exhausted']),
  contextStopReason: z.enum(['sufficient', 'policy_closed', 'round_limit', 'cost_limit', 'token_limit', 'elapsed_time_limit', 'no_information_gain']),
  contextEvidenceIds: z.array(z.string().trim().min(1).max(512)).max(256),
  unresolvedContext: z.array(z.string().trim().min(1).max(2000)).max(128),
  releaseCeiling: z.enum(['publication_ready', 'draft_ready']),
  fallbackPolicy: z.literal('fail_closed')
}).strict()

const contextQuestionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(2000),
  priority: z.enum(['required', 'optional']),
  status: z.enum(['open', 'resolved'])
}).strict()

const contextEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(512),
  source: z.string().trim().min(1).max(4096),
  summary: z.string().trim().min(1).max(4000),
  questionIds: z.array(z.string().trim().min(1).max(160)).max(128)
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
  visualPlan: visualPlanSchema
}).strict()

export function createImageGenerationMcpServer(options: McpLaunchOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'sciforge-image-generation', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('visual_generate', {
    title: 'Plan Visual Generation',
    description: 'Use the single visual-production control path: audit context, request targeted research while required questions remain and budget is available, then lock code, model, or hybrid execution. Budget exhaustion still produces a draft-only route that must pass through visual_artifact_review.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1).max(16000),
      action: z.enum(['create', 'revision']).optional(),
      visualDocumentId: z.string().trim().min(1).max(160).optional(),
      reviewPacketPath: z.string().trim().min(1).max(4096).optional(),
      sourceArtifacts: z.array(z.string().trim().min(1).max(4096)).max(64).optional(),
      requirements: z.object({
        lockedElements: z.array(z.string().trim().min(1).max(1000)).max(128),
        modelOwnedElements: z.array(z.string().trim().min(1).max(1000)).max(128),
        reproducibleInputs: z.array(z.string().trim().min(1).max(4096)).max(64)
      }).strict(),
      context: z.object({
        policy: z.enum(['auto', 'closed']).optional(),
        questions: z.array(contextQuestionSchema).max(128).optional(),
        evidence: z.array(contextEvidenceSchema).max(256).optional(),
        usage: z.object({
          rounds: z.number().nonnegative().optional(),
          costUnits: z.number().nonnegative().optional(),
          tokens: z.number().nonnegative().optional(),
          elapsedMs: z.number().nonnegative().optional(),
          consecutiveNoProgressRounds: z.number().nonnegative().optional()
        }).strict().optional()
      }).strict().optional(),
      budget: z.object({
        maxRounds: z.number().positive().optional(),
        maxCostUnits: z.number().positive().optional(),
        maxTokens: z.number().positive().optional(),
        maxElapsedMs: z.number().positive().optional()
      }).strict().optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: VisualGenerateRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        task: input.task,
        ...(input.action ? { action: input.action } : {}),
        ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
        ...(input.reviewPacketPath ? { reviewPacketPath: input.reviewPacketPath } : {}),
        ...(input.sourceArtifacts ? { sourceArtifacts: input.sourceArtifacts } : {}),
        requirements: input.requirements,
        ...(input.context ? { context: input.context } : {}),
        ...(input.budget ? { budget: input.budget } : {})
      }
      const plan = planVisualProduction(request)
      return textResult(jsonSummary('Visual production plan: ' + plan.status + '.', plan), { plan })
    } catch (error) {
      return errorResult('Failed to plan visual production: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

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
    description: `Convert a model or hybrid handoff returned by visual_generate into a controlled image_generation_render recipe. ${IMAGE_GENERATION_EXECUTION_DESCRIPTION} Does not write files.`,
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
      visualPlan: visualPlanSchema
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
        visualPlan: input.visualPlan
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
    description: `Render a controlled model-owned visual layer and write a SciForge artifact manifest for mandatory visual review. ${IMAGE_GENERATION_EXECUTION_DESCRIPTION} On hybrid routes, locked elements remain owned by deterministic composition.`,
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
      visualPlan: visualPlanSchema,
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
        visualPlan: input.visualPlan,
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
      visualPlan: visualPlanSchema,
      reviewPacketPath: z.string().trim().max(4096).optional(),
      reviewPacket: z.unknown().optional(),
      maskPath: z.string().trim().max(4096).optional(),
      outputDir: z.string().trim().max(4096).optional(),
      imageId: z.string().trim().max(120).optional(),
      threadId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE_ANNOTATIONS
  }, async (input) => {
    try {
      const request: ImageGenerationEditFromVisualReviewPacketRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        visualPlan: input.visualPlan,
        ...(input.reviewPacketPath ? { reviewPacketPath: input.reviewPacketPath } : {}),
        ...(input.reviewPacket ? { reviewPacket: input.reviewPacket } : {}),
        ...(input.maskPath ? { maskPath: input.maskPath } : {}),
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
      manifestPath: z.string().trim().min(1).max(4096),
      task: z.string().trim().min(1).max(16000),
      referencePath: z.string().trim().max(4096).optional(),
      minOverall: z.number().min(0.5).max(0.98).optional()
    },
    annotations: READ_ONLY_ANNOTATIONS
  }, async (input) => {
    try {
      const request: VisualArtifactReviewRequest = {
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options),
        outputPath: input.outputPath,
        manifestPath: input.manifestPath,
        task: input.task,
        ...(input.referencePath ? { referencePath: input.referencePath } : {}),
        ...(input.minOverall ? { minOverall: input.minOverall } : {})
      }
      const review = await reviewVisualArtifact(request)
      return textResult(jsonSummary('Semantic visual artifact review.', review), { review })
    } catch (error) {
      return errorResult('Failed to review image: ' + (error instanceof Error ? error.message : String(error)))
    }
  })

  return server
}

export async function runImageGenerationMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false
  const server = createImageGenerationMcpServer(options)
  await server.connect(new StdioServerTransport())
  return true
}
