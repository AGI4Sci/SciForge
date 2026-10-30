import type { ReactElement } from 'react'
import { z } from 'zod'

import type { DomainRendererContributionHost } from '@sciforge/domain-sdk/host'
import { providerKindSchema } from '@sciforge/domain-sdk/provider-composition'
import { RENDERER_EXTENSION_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/renderer-contributions'

export const CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION =
  'content-space.provider-enrollment-view' as const
export const CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION = '1.0.0' as const

export const contentSpaceProviderEnrollmentViewContractSchema = z.object({
  location: z.literal(CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION),
  contractVersion: z.literal(CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION),
  providerKind: providerKindSchema
}).strict().readonly()

export const contentSpaceProviderAccessStateSchema = z.object({
  status: z.enum([
    'checking',
    'ready',
    'human_action_required',
    'unavailable'
  ]),
  viewState: z.unknown().optional()
}).strict().readonly()

/**
 * Provider-neutral access decision plus optional Provider-owned renderer state.
 *
 * `viewState` is an opaque, non-secret value for the current render pass only.
 * Content Space must not inspect it, persist it, log it, move it across a
 * Principal boundary, or use it as authorization evidence. The owning
 * enrollment view validates it when rendering; `status` remains the only
 * Provider-neutral readiness decision.
 */
export type ContentSpaceProviderAccessState = z.infer<
  typeof contentSpaceProviderAccessStateSchema
>

export type ContentSpaceProviderAccessReadContext = Readonly<{
  providerInstanceRef: string
  signal: AbortSignal
}>

export type ContentSpaceProviderEnrollmentRenderContext = Readonly<{
  providerInstanceRef: string
  accessState: ContentSpaceProviderAccessState
  /** Re-checks access through the owning Provider after bind, unbind, or reauthentication. */
  onAccessChanged: () => void
}>

export type ContentSpaceProviderEnrollmentView = Readonly<{
  contractVersion: typeof CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION
  providerKind: string
  readAccessState: (
    context: ContentSpaceProviderAccessReadContext
  ) => Promise<ContentSpaceProviderAccessState>
  render: (context: ContentSpaceProviderEnrollmentRenderContext) => ReactElement
}>

export function isContentSpaceProviderEnrollmentView(
  value: unknown
): value is ContentSpaceProviderEnrollmentView {
  if (!hasExactKeys(value, [
    'contractVersion',
    'providerKind',
    'readAccessState',
    'render'
  ])) return false
  return value.contractVersion === CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_CONTRACT_VERSION &&
    providerKindSchema.safeParse(value.providerKind).success &&
    typeof value.readAccessState === 'function' &&
    typeof value.render === 'function'
}

/**
 * Projects renderer enrollment views as a closed, unique Provider-Kind catalog.
 * A malformed or duplicate claim can never win by installation order.
 */
export function collectContentSpaceProviderEnrollmentViews(
  host: Readonly<{ contributions?: DomainRendererContributionHost }>
): readonly ContentSpaceProviderEnrollmentView[] {
  const byProviderKind = new Map<string, ContentSpaceProviderEnrollmentView>()
  for (const contribution of host.contributions?.list(
    RENDERER_EXTENSION_CONTRIBUTION_KIND
  ) ?? []) {
    if (contribution.kind !== RENDERER_EXTENSION_CONTRIBUTION_KIND ||
      !isRecord(contribution.contract) ||
      contribution.contract.location !== CONTENT_SPACE_PROVIDER_ENROLLMENT_VIEW_LOCATION) {
      continue
    }
    const contract = contentSpaceProviderEnrollmentViewContractSchema.safeParse(
      contribution.contract
    )
    if (!contract.success) {
      throw new TypeError(
        `Content Space enrollment view ${contribution.id} has an invalid contract.`
      )
    }
    if (!isContentSpaceProviderEnrollmentView(contribution.value) ||
      contribution.value.providerKind !== contract.data.providerKind ||
      contribution.value.contractVersion !== contract.data.contractVersion) {
      throw new TypeError(
        `Content Space enrollment view ${contribution.id} does not match its contract.`
      )
    }
    if (byProviderKind.has(contract.data.providerKind)) {
      throw new TypeError(
        `Content Space enrollment view ${contract.data.providerKind} is duplicated.`
      )
    }
    byProviderKind.set(contract.data.providerKind, contribution.value)
  }

  return Object.freeze([...byProviderKind.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, view]) => view))
}

export function parseContentSpaceProviderAccessState(
  value: unknown
): ContentSpaceProviderAccessState {
  return contentSpaceProviderAccessStateSchema.parse(value)
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
