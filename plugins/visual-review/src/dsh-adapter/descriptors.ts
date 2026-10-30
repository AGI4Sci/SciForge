import { z } from 'zod'
import { VISUAL_REVIEW_CAPABILITY_IDS } from '../core/contract.js'
import {
  visualReviewAcceptCandidateWireSchema,
  visualReviewApplyStyleReferenceWireSchema,
  visualReviewCreateCandidateWireSchema,
  visualReviewExportReviewPacketWireSchema,
  visualReviewOpenWireSchema,
  visualReviewReadDocumentWireSchema,
  visualReviewReadImageWireSchema,
  visualReviewRejectCandidateWireSchema,
  visualReviewSaveAnnotationsWireSchema,
  visualReviewUpdateContextWireSchema
} from './wire.js'

/**
 * Capability descriptors for the named-runner contract entry. Fields mirror
 * the static adapter (packages/domains/visual-review/src/main.ts) one by one.
 *
 * Deliberate pre-bridge deviations from the static descriptors, all forced by
 * the runtime-plugin contract surface and recorded in the README:
 * - scope is 'workspace' for all ten capabilities: the named-runner entry has
 *   not been verified for host-issued resource handles, and the host rejects
 *   resourceKinds on non-resource scopes anyway;
 * - concurrency.revision is 'none' everywhere: optimistic revision requires
 *   resource scope; concurrency stays enforced by service-level hash checks;
 * - acceptCandidate declares effect 'workspace-write' + approval 'none'
 *   instead of the static 'destructive' + 'confirmation': the 2026-10-15
 *   de-risk spike proved the host rejects destructive+approval:none and the
 *   confirmation approval is not wired into the plugin invocation path. The
 *   acceptance receipt write is workspace-write semantics; candidate artifact
 *   retirement/versioning stays with the orchestration layer (host ports
 *   bridge). Destructive semantics return once the SDK wires confirmation
 *   approval into plugin invocations;
 * - artifact-bound capabilities (exportReviewPacket/createCandidate/
 *   acceptCandidate) fail closed until the host injects VisualReviewPorts
 *   through setVisualReviewPorts().
 */

export interface PluginCapabilityDescriptor {
  contractVersion: 3
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'workspace'
  resourceKinds: readonly string[]
  effect: 'read' | 'workspace-write'
  approval: 'none'
  concurrency: Readonly<{ revision: 'none' | 'optimistic'; idempotency: 'none' | 'required' }>
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  tags: readonly string[]
}

const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { reused: 'ref' }) as Record<string, unknown>

// Matches the static adapter's z.json() output contract: any JSON value,
// including the arrays and nested documents returned by visual-review.
const outputSchema = {} as const

const BASE_TAGS = ['visual-review', 'image', 'annotation'] as const

export const PLUGIN_CAPABILITY_DESCRIPTORS: readonly PluginCapabilityDescriptor[] = Object.freeze([
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.open,
    version: '1.0.0',
    title: 'Open Visual Review document',
    description: 'Opens or creates the canonical Visual Review document and optionally stages one source artifact.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewOpenWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
    version: '1.0.0',
    title: 'Read Visual Review document',
    description: 'Reads one existing canonical Visual Review document without creating it.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(visualReviewReadDocumentWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.readImage,
    version: '1.0.0',
    title: 'Read Visual Review image',
    description: 'Reads one bounded workspace image for the package-owned review surface.',
    audiences: ['ui'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'read' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const },
    inputSchema: jsonSchemaOf(visualReviewReadImageWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
    version: '1.0.0',
    title: 'Update Visual Review context',
    description: 'Updates the canonical visual nodes, truth locks, or style reference.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewUpdateContextWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
    version: '1.0.0',
    title: 'Apply Visual Review style reference',
    description: 'Extracts a manuscript visual style from one reference image and applies it to the current Visual Review document.',
    audiences: ['ui'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewApplyStyleReferenceWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
    version: '1.0.0',
    title: 'Save Visual Review annotations',
    description: 'Replaces the structured annotation set for one Visual Review document.',
    audiences: ['ui'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewSaveAnnotationsWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
    version: '1.0.0',
    title: 'Export Visual Review packet',
    description: 'Exports the current open annotations and immutable source context for revision, then commits the packet as an artifact version through the host ports bridge.',
    audiences: ['ui', 'agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewExportReviewPacketWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
    version: '1.0.0',
    title: 'Create Visual Review candidate',
    description: 'Stages one non-destructive candidate after validated image-generation QA and a current base-artifact verification through the host ports bridge.',
    audiences: ['agent', 'system'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewCreateCandidateWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
    version: '1.0.0',
    title: 'Accept Visual Review candidate',
    description: 'Atomically accepts the active candidate, commits the reviewed bytes as an artifact version through the host ports bridge, and preserves the previous image as a backup.',
    audiences: ['ui'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewAcceptCandidateWireSchema),
    outputSchema,
    tags: BASE_TAGS
  }),
  Object.freeze({
    contractVersion: 3 as const,
    id: VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate,
    version: '1.0.0',
    title: 'Reject Visual Review candidate',
    description: 'Rejects the active candidate without replacing the source image.',
    audiences: ['ui'] as const,
    scope: 'workspace' as const,
    resourceKinds: [] as const,
    effect: 'workspace-write' as const,
    approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'required' as const },
    inputSchema: jsonSchemaOf(visualReviewRejectCandidateWireSchema),
    outputSchema,
    tags: BASE_TAGS
  })
])
