import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG } from './contract.js'
import {
  acceptVisualCandidateRevision,
  createVisualCandidateRevision,
  exportVisualReviewPacket,
  getVisualDocumentStatus,
  insertVisualDocumentArtifact,
  openOrCreateVisualDocument,
  rejectVisualCandidateRevision,
  saveVisualDocumentAnnotations,
  updateVisualDocumentContext
} from './visual-document-engine.js'
import { VISUAL_ARTIFACT_KINDS, type VisualDocumentSaveAnnotationsRequest } from './types.js'

export type VisualDocumentMcpServerOptions = { workspaceRoot?: string }

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const CONTROLLED_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const

function parseOptions(argv: string[]): VisualDocumentMcpServerOptions | null {
  if (!argv.includes(SCIFORGE_VISUAL_DOCUMENT_MCP_FLAG)) return null
  const index = argv.indexOf('--workspace-root')
  const workspaceRoot = index >= 0 ? argv[index + 1]?.trim() : undefined
  return workspaceRoot ? { workspaceRoot } : {}
}

function workspaceRootFor(input: string | undefined, options: VisualDocumentMcpServerOptions): string {
  const root = input?.trim() || options.workspaceRoot
  if (!root) throw new Error('workspaceRoot is required.')
  return root
}

function success(title: string, result: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${title}\n\n${JSON.stringify(result, null, 2)}` }],
    structuredContent: { result }
  }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()
const boundsSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1)
}).strict()
const geometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), bounds: boundsSchema }).strict(),
  z.object({ kind: z.literal('pin'), point: pointSchema }).strict(),
  z.object({ kind: z.literal('arrow'), from: pointSchema, to: pointSchema }).strict(),
  z.object({ kind: z.literal('freehand'), points: z.array(pointSchema).min(2).max(5000) }).strict()
])

export const visualDocumentCreateCandidateInputSchema = {
  workspaceRoot: z.string().trim().min(1).optional(),
  documentId: z.string().trim().max(120).optional(),
  candidatePath: z.string().trim().min(1).max(4096),
  summary: z.string().trim().min(1).max(4000),
  reviewEvidence: z.object({
    tool: z.literal('image_generation_review_candidate'),
    ok: z.literal(true),
    reviewedArtifactPath: z.string().trim().min(1).max(4096),
    reviewedArtifactHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
    reviewedAt: z.string().datetime(),
    score: z.object({
      overall: z.number().min(0).max(1),
      dimensions: z.number().min(0).max(1),
      nonEmpty: z.number().min(0).max(1),
      background: z.number().min(0).max(1),
      reference: z.number().min(0).max(1).optional(),
      semantic: z.number().min(0).max(1),
      warnings: z.array(z.string().max(2000)).max(100)
    }).strict(),
    semantic: z.object({
      pass: z.literal(true),
      summary: z.string().trim().min(1).max(4000),
      violations: z.array(z.string().max(2000)).max(0),
      repairInstructions: z.array(z.string().max(2000)).max(0)
    }).strict(),
    repairable: z.literal(false),
    warnings: z.array(z.string().max(2000)).max(100)
  }).strict(),
  expectedBaseHash: z.string().trim().length(64).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional()
}

export async function runVisualDocumentMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseOptions(argv)
  if (!options) return false
  const server = createVisualDocumentMcpServer(options)
  await server.connect(new StdioServerTransport())
  return true
}

export function createVisualDocumentMcpServer(
  options: VisualDocumentMcpServerOptions = {}
): McpServer {
  const server = new McpServer({ name: 'sciforge-visual-document', version: '1.0.0' })

  server.registerTool('sciforge_visual_document_status', {
    title: 'Visual Document Status',
    description: 'Report the unified VisualDocument storage and candidate acceptance policy.',
    inputSchema: { workspaceRoot: z.string().trim().min(1).optional() },
    annotations: READ_ONLY
  }, async ({ workspaceRoot }) => {
    try {
      return success('VisualDocument is available.', await getVisualDocumentStatus(workspaceRoot || options.workspaceRoot))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_open_or_create', {
    title: 'Open Or Create Visual Document',
    description: 'Open or create the workspace VisualDocument JSON used for human annotation and model revision.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      documentId: z.string().trim().max(120).optional(),
      canvas: z.object({
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        background: z.string().trim().min(1).max(100).optional()
      }).strict().optional(),
      styleProfileRef: z.string().trim().max(4096).nullable().optional()
    },
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      return success('VisualDocument opened.', await openOrCreateVisualDocument({
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_insert_artifact', {
    title: 'Insert Visual Artifact',
    description: 'Attach one source artifact to a VisualDocument and create a protected working copy.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      documentId: z.string().trim().max(120).optional(),
      kind: z.enum(VISUAL_ARTIFACT_KINDS),
      sourcePath: z.string().trim().min(1).max(4096),
      manifestPath: z.string().trim().max(4096).optional(),
      title: z.string().trim().max(300).optional(),
      caption: z.string().trim().max(4000).optional(),
      mimeType: z.string().trim().max(200).optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      styleProfileRef: z.string().trim().max(4096).nullable().optional(),
      truthLocks: z.array(z.object({
        id: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(2000),
        nodeIds: z.array(z.string().trim().min(1).max(200)).max(1000),
        sourceRef: z.string().trim().max(4096).optional()
      }).strict()).max(2000).optional()
    },
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      return success('Visual artifact inserted.', await insertVisualDocumentArtifact({
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_save_annotations', {
    title: 'Save Visual Review Annotations',
    description: 'Replace normalized region annotations and human modification instructions in the VisualDocument.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      documentId: z.string().trim().max(120).optional(),
      annotations: z.array(z.object({
        id: z.string().trim().max(120).optional(),
        geometry: geometrySchema,
        instruction: z.string().trim().min(1).max(4000),
        targetNodeIds: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
        status: z.enum(['open', 'resolved']).optional()
      }).strict()).max(2000)
    },
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      const request = {
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      } as VisualDocumentSaveAnnotationsRequest
      return success('Visual annotations saved.', await saveVisualDocumentAnnotations(request))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_update_context', {
    title: 'Update Visual Document Context',
    description: 'Set the shared semantic nodes, truth locks, and manuscript or artifact style profile used by review and generation.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      documentId: z.string().trim().max(120).optional(),
      styleProfileRef: z.string().trim().max(4096).nullable().optional(),
      truthLocks: z.array(z.object({
        id: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(2000),
        nodeIds: z.array(z.string().trim().min(1).max(200)).max(1000),
        sourceRef: z.string().trim().max(4096).optional()
      }).strict()).max(2000).optional()
    },
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      return success('Visual document context updated.', await updateVisualDocumentContext({
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_export_review_packet', {
    title: 'Export Visual Review Packet',
    description: 'Export open annotations, normalized regions, target nodes, style reference, and truth locks for the unified visual revision workflow.',
    inputSchema: {
      workspaceRoot: z.string().trim().min(1).optional(),
      documentId: z.string().trim().max(120).optional(),
      packetId: z.string().trim().max(120).optional()
    },
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      return success('Visual review packet exported.', await exportVisualReviewPacket({
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool('sciforge_visual_document_create_candidate', {
    title: 'Create Visual Candidate Revision',
    description: 'Stage a generated revision for human comparison without changing the source artifact. Requires hash-bound candidate QA from image_generation_review_candidate with no pending repairs. Raster dimensions are decoded from the candidate file; width and height hints apply only to non-raster artifacts.',
    inputSchema: visualDocumentCreateCandidateInputSchema,
    annotations: CONTROLLED_WRITE
  }, async (input) => {
    try {
      return success('Visual candidate staged.', await createVisualCandidateRevision({
        ...input,
        workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
      }))
    } catch (error) { return failure(error) }
  })

  for (const [toolName, title, description, handler] of [
    [
      'sciforge_visual_document_accept_candidate',
      'Accept Visual Candidate',
      'Atomically replace the source artifact only after explicit human acceptance, retaining a backup and revision history.',
      acceptVisualCandidateRevision
    ],
    [
      'sciforge_visual_document_reject_candidate',
      'Reject Visual Candidate',
      'Reject the active candidate without changing the source artifact.',
      rejectVisualCandidateRevision
    ]
  ] as const) {
    server.registerTool(toolName, {
      title,
      description,
      inputSchema: {
        workspaceRoot: z.string().trim().min(1).optional(),
        documentId: z.string().trim().max(120).optional(),
        revisionId: z.string().trim().min(1).max(120)
      },
      annotations: CONTROLLED_WRITE
    }, async (input) => {
      try {
        return success(title, await handler({
          ...input,
          workspaceRoot: workspaceRootFor(input.workspaceRoot, options)
        }))
      } catch (error) { return failure(error) }
    })
  }

  return server
}
