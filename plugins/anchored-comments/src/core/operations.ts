/**
 * Plugin-owned wiring for the Anchored Comments capabilities.
 *
 * There is exactly one capability construction path: the plugin-owned
 * factory (`createAnchoredCommentsCapabilityFactory`). The workspace binding
 * supplies its environment ports without duplicating business handlers.
 *
 * Environment seams (see `src/ports`):
 * - file port: workspace-local store (`<workspaceRoot>/.sciforge/anchored-comments/`);
 * - network port: product-feedback gateway transport (fixture in DSH tests);
 * - visual-capture port: the Host-authorized registered-view proxy, injected by
 *   the DSH adapter; missing service or authorization fails closed.
 */
import { isAbsolute, join, resolve } from 'node:path'
import type { z } from 'zod'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from './contract.js'
import { createAnchoredCommentsCapabilityFactory } from './main/index.js'
import { AnchoredCommentService } from './main/comment-service.js'
import { AnchoredCommentFeedbackService } from './main/feedback-service.js'
import {
  configuredFeedbackGatewayToken,
  configuredFeedbackGatewayUrl,
  FeedbackGatewayClient
} from './main/feedback-gateway-client.js'
import { createNodeFilePort, type AnchoredCommentFilePort } from '../ports/files.js'
import type { FeedbackNetworkPort } from '../ports/network.js'
import type { VisualCapturePort } from '../ports/visual-capture.js'

export const ANCHORED_COMMENTS_DATA_DIRECTORY = '.sciforge'

export type AnchoredCapabilityDefinition = Readonly<{
  id: string
  effect: 'read' | 'workspace-write' | 'external-write'
  approval: 'none' | 'confirmation'
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: unknown) => Promise<Readonly<{ output: unknown }>>
}>

export type AnchoredCommentsOperationsOptions = Readonly<{
  /** Transport used by `anchored-comments.feedback.submit`. */
  network?: FeedbackNetworkPort
  /** Per-workspace binding of the store seam; defaults to the node port. */
  files?: (rootDir: string) => AnchoredCommentFilePort
  env?: NodeJS.ProcessEnv
  now?: () => Date
  visualCapture?: VisualCapturePort
}>

export type AnchoredCommentsOperations = Readonly<{
  /** Capability ids in their declared order (matches the plugin factory). */
  capabilityIds: readonly string[]
  /** Absolute data root the plugin writes for one caller workspace. */
  dataRoot(workspaceRoot: string): string
  /** Strict-input capability call: the forged-workspace guard lives here. */
  invoke(capabilityId: string, input: unknown, workspaceRoot: string): Promise<unknown>
  dispose(): void
}>

type WorkspaceContext = Readonly<{
  workspaceRoot: string
  dataRoot: string
  definitions: readonly AnchoredCapabilityDefinition[]
}>

/**
 * `workspaceRoot` is the caller's workspace, not the app user-data directory:
 * threads, assets and the store live under `<workspaceRoot>/.sciforge/
 * anchored-comments/`. Relative or NUL-bearing paths are rejected instead of
 * being resolved against the plugin's own cwd.
 */
export function anchoredCommentsDataRoot(workspaceRoot: string): string {
  if (typeof workspaceRoot !== 'string') throw new Error('workspaceRoot must be a string.')
  const value = workspaceRoot.trim()
  if (!value) throw new Error('workspaceRoot is required.')
  if (value.length > 4_096) throw new Error('workspaceRoot is too long.')
  if (value.includes('\0')) throw new Error('workspaceRoot must not contain NUL bytes.')
  if (!isAbsolute(value)) throw new Error('workspaceRoot must be an absolute path.')
  return join(resolve(value), ANCHORED_COMMENTS_DATA_DIRECTORY)
}

export function createAnchoredCommentsOperations(
  options: AnchoredCommentsOperationsOptions = {}
): AnchoredCommentsOperations {
  const network = options.network
  const filesFor = options.files ?? createNodeFilePort
  const env = options.env ?? process.env
  const now = options.now
  const visualCapture = options.visualCapture
  const contexts = new Map<string, WorkspaceContext>()

  const contextFor = (workspaceRoot: string): WorkspaceContext => {
    const dataRoot = anchoredCommentsDataRoot(workspaceRoot)
    const cached = contexts.get(dataRoot)
    if (cached) return cached
    const comments = new AnchoredCommentService(dataRoot, filesFor(dataRoot))
    let feedback: AnchoredCommentFeedbackService | undefined
    // Construct feedback lazily: a broken gateway URL must not break list/get/upsert.
    const getFeedback = (): AnchoredCommentFeedbackService => {
      if (feedback) return feedback
      const url = configuredFeedbackGatewayUrl(env)
      const gateway = url
        ? new FeedbackGatewayClient({
            baseUrl: url,
            authToken: configuredFeedbackGatewayToken(env) ?? undefined,
            ...(network ? { fetchImpl: network.fetch } : {})
          })
        : null
      feedback = new AnchoredCommentFeedbackService({
        comments,
        gateway,
        ...(now ? { now } : {})
      })
      return feedback
    }
    const factory = createAnchoredCommentsCapabilityFactory<AnchoredCapabilityDefinition>({
      defineCapability: (definition) => definition as unknown as AnchoredCapabilityDefinition,
      getComments: () => comments,
      getFeedback,
      ...(visualCapture ? { visualCapture } : {})
    })
    const context: WorkspaceContext = Object.freeze({
      workspaceRoot,
      dataRoot,
      definitions: factory.createDefinitions()
    })
    contexts.set(dataRoot, context)
    return context
  }

  return Object.freeze({
    capabilityIds: Object.freeze(Object.values(ANCHORED_COMMENT_CAPABILITY_IDS)),
    dataRoot: anchoredCommentsDataRoot,
    async invoke(capabilityId: string, input: unknown, workspaceRoot: string): Promise<unknown> {
      const context = contextFor(workspaceRoot)
      const definition = context.definitions.find((candidate) => candidate.id === capabilityId)
      if (!definition) throw new Error(`Unknown Anchored Comments capability: ${capabilityId}`)
      // Strict zod parse at the capability boundary. Every contract schema is
      // `.strict()`, so a payload that carries its own `workspaceRoot` is
      // rejected here instead of silently winning over the caller's value.
      const parsed = definition.inputSchema.parse(input)
      const result = await definition.handler(parsed)
      return definition.outputSchema.parse(result.output)
    },
    dispose(): void {
      contexts.clear()
    }
  })
}