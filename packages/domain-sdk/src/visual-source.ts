import { z } from 'zod'

import {
  domainPackageContributionIdSchema,
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'

export const VISUAL_SOURCE_CONTRACT_VERSION = 1
export const MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND = 'main.visual-source' as const
export const VISUAL_SOURCE_MAX_DIMENSION = 32_768
export const VISUAL_SOURCE_MAX_FRAME_BYTES = 128 * 1024 * 1024
export const VISUAL_SOURCE_MAX_REDACTIONS = 1_024

const resourceKindSchema = z.string().trim().min(1).max(128)
const resourceIdSchema = z.string().trim().min(1).max(512)
const revisionSchema = z.string().trim().min(1).max(256)
const workspaceIdSchema = z.string().trim().min(1).max(4_096)
const opaqueTargetRefSchema = z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/)
const opaqueAnchorRefSchema = z.string().regex(/^anchor_[A-Za-z0-9_-]{20,}$/)

export const normalizedVisualRegionSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1)
}).strict().superRefine((region, context) => {
  if (region.x + region.width > 1) {
    context.addIssue({
      code: 'custom',
      path: ['width'],
      message: 'Normalized visual region must fit within the horizontal source bounds.'
    })
  }
  if (region.y + region.height > 1) {
    context.addIssue({
      code: 'custom',
      path: ['height'],
      message: 'Normalized visual region must fit within the vertical source bounds.'
    })
  }
})

export type NormalizedVisualRegion = z.infer<typeof normalizedVisualRegionSchema>

export const visualSourceContributionContractSchema = z.object({
  contractVersion: z.literal(VISUAL_SOURCE_CONTRACT_VERSION),
  id: domainPackageContributionIdSchema,
  resourceKinds: z.array(resourceKindSchema).min(1).max(64)
}).strict().superRefine((contract, context) => {
  const seen = new Set<string>()
  for (const [index, resourceKind] of contract.resourceKinds.entries()) {
    if (!seen.has(resourceKind)) {
      seen.add(resourceKind)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: ['resourceKinds', index],
      message: `Visual source resource kind ${resourceKind} is duplicated.`
    })
  }
})

export type VisualSourceContributionContract = Readonly<{
  contractVersion: typeof VISUAL_SOURCE_CONTRACT_VERSION
  id: string
  resourceKinds: readonly string[]
}>

export type VisualSourceContributionContractInput = Readonly<{
  contractVersion: typeof VISUAL_SOURCE_CONTRACT_VERSION
  id: string
  resourceKinds: readonly string[]
}>

export const visualSourceResourceSchema = z.object({
  resourceId: resourceIdSchema,
  resourceKind: resourceKindSchema,
  workspaceId: workspaceIdSchema.optional(),
  semanticRevision: revisionSchema,
  layoutRevision: revisionSchema.optional()
}).strict()

export type VisualSourceResource = z.infer<typeof visualSourceResourceSchema>

export const visualSourceTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('target-ref'),
    targetRef: opaqueTargetRefSchema
  }).strict(),
  z.object({
    kind: z.literal('anchor-ref'),
    anchorRef: opaqueAnchorRefSchema
  }).strict(),
  z.object({
    kind: z.literal('region'),
    region: normalizedVisualRegionSchema
  }).strict()
])

export type VisualSourceTarget = z.infer<typeof visualSourceTargetSchema>

export const visualSourceRenderRequestSchema = z.object({
  resource: visualSourceResourceSchema,
  target: visualSourceTargetSchema.optional(),
  frameIndex: z.number().int().positive().max(1_000_000).optional(),
  pixelRatio: z.number().finite().positive().max(8).optional(),
  maxDimension: z.number().int().positive().max(VISUAL_SOURCE_MAX_DIMENSION).optional()
}).strict()

export type VisualSourceRenderRequest = z.infer<typeof visualSourceRenderRequestSchema>

export const visualFrameMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp'
])

export type VisualFrameMimeType = z.infer<typeof visualFrameMimeTypeSchema>

export const visualFrameSchema = z.object({
  bytes: z.instanceof(Uint8Array).superRefine((bytes, context) => {
    if (bytes.byteLength < 1) {
      context.addIssue({
        code: 'custom',
        message: 'Visual frame bytes must not be empty.'
      })
    }
    if (bytes.byteLength > VISUAL_SOURCE_MAX_FRAME_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Visual frame exceeds the ${VISUAL_SOURCE_MAX_FRAME_BYTES} byte limit.`
      })
    }
  }),
  mimeType: visualFrameMimeTypeSchema,
  width: z.number().int().positive().max(VISUAL_SOURCE_MAX_DIMENSION),
  height: z.number().int().positive().max(VISUAL_SOURCE_MAX_DIMENSION),
  sourceRevision: revisionSchema,
  anchor: z.object({
    kind: z.string().trim().min(1).max(128),
    metadata: domainPackageJsonValueSchema.optional()
  }).strict(),
  redactions: z.array(normalizedVisualRegionSchema)
    .max(VISUAL_SOURCE_MAX_REDACTIONS)
    .optional()
}).strict()

export type VisualFrame = z.infer<typeof visualFrameSchema>

export type VisualSourceRenderContext = Readonly<{
  signal?: AbortSignal
}>

export type VisualSourceProvider = Readonly<{
  contract: VisualSourceContributionContract
  render(
    request: VisualSourceRenderRequest,
    context: VisualSourceRenderContext
  ): Promise<unknown>
}>

export type VisualSourceProviderInput = Readonly<{
  contract: VisualSourceContributionContractInput
  render(
    request: VisualSourceRenderRequest,
    context: VisualSourceRenderContext
  ): Promise<unknown>
}>

export type VisualSourceRegistrationInput = Readonly<{
  ownerId: string
  provider: VisualSourceProviderInput | VisualSourceProvider
}>

export type VisualSourceRegistration = Readonly<{
  ownerId: string
  provider: VisualSourceProvider
}>

export type VisualSourceRegistrationDisposable = Readonly<{
  dispose(): void
}>

export function defineVisualSourceContributionContract(
  input: VisualSourceContributionContractInput
): VisualSourceContributionContract {
  const parsed = visualSourceContributionContractSchema.parse(input)
  return Object.freeze({
    ...parsed,
    resourceKinds: Object.freeze([...parsed.resourceKinds])
  })
}

export function defineVisualSourceProvider(
  input: VisualSourceProviderInput
): VisualSourceProvider {
  if (!input || typeof input !== 'object' || typeof input.render !== 'function') {
    throw new TypeError('Visual source providers require exactly one render function.')
  }
  return Object.freeze({
    contract: defineVisualSourceContributionContract(input.contract),
    render: input.render
  })
}

export async function renderVisualSource(
  providerInput: VisualSourceProviderInput | VisualSourceProvider,
  requestInput: unknown,
  context: VisualSourceRenderContext = {}
): Promise<VisualFrame> {
  const provider = defineVisualSourceProvider(providerInput)
  const request = visualSourceRenderRequestSchema.parse(requestInput)
  if (!provider.contract.resourceKinds.includes(request.resource.resourceKind)) {
    throw new Error(
      `Visual source ${provider.contract.id} does not support resource kind ${request.resource.resourceKind}.`
    )
  }
  const frame = visualFrameSchema.parse(await provider.render(request, context))
  if (frame.sourceRevision !== request.resource.semanticRevision) {
    throw new Error(
      `Visual source ${provider.contract.id} rendered revision ${frame.sourceRevision}, ` +
      `but the requested resource revision is ${request.resource.semanticRevision}.`
    )
  }
  return frame
}

export function visualSourceContractsEqual(
  left: VisualSourceContributionContractInput,
  right: VisualSourceContributionContractInput
): boolean {
  return canonicalJson(domainPackageJsonValueSchema.parse(
    defineVisualSourceContributionContract(left)
  )) === canonicalJson(domainPackageJsonValueSchema.parse(
    defineVisualSourceContributionContract(right)
  ))
}

function canonicalJson(value: DomainPackageJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`
  ).join(',')}}`
}
