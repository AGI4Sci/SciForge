import {
  RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION_KIND,
  domainWorkbenchOpenResourceInputSchema,
  type DomainRendererResourceNavigationContract,
  type DomainRendererResourceNavigationValue
} from '@sciforge/domain-sdk/renderer'
import type {
  DomainWorkbenchOpenResourceInput,
  DomainWorkbenchOpenRightPanelInput
} from '@sciforge/domain-sdk/host'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'
import { WorkbenchRightPanelContributionRegistry } from './workbench-right-panel-slot'

export const RESOURCE_NAVIGATION_SLOT = 'renderer.resource-navigation' as const
export { RENDERER_RESOURCE_NAVIGATION_CONTRIBUTION_KIND }

export type ResourceNavigationContribution =
  DomainRendererResourceNavigationContract &
  DomainRendererResourceNavigationValue &
  Readonly<{ id: string }>

type ResourceNavigationSlots = {
  [RESOURCE_NAVIGATION_SLOT]: ResourceNavigationContribution
}

export type RegisteredResourceNavigationContribution =
  RegisteredRendererSlotContribution<
    ResourceNavigationSlots,
    typeof RESOURCE_NAVIGATION_SLOT
  >

export class ResourceNavigationContributionRegistry {
  private readonly slots = new RendererSlotRegistry<ResourceNavigationSlots>()

  constructor(
    private readonly rightPanels: WorkbenchRightPanelContributionRegistry
  ) {}

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererResourceNavigationContract
    value: DomainRendererResourceNavigationValue
  }>): RendererSlotRegistrationDisposable {
    const target = this.rightPanels.resolve(input.contract.target.contributionId)
    if (!target) {
      throw new Error(
        `Resource navigation ${input.ownerId}/${input.id} targets missing right panel ` +
        `"${input.contract.target.contributionId}".`
      )
    }
    if (target.ownerId !== input.ownerId) {
      throw new Error(
        `Resource navigation ${input.ownerId}/${input.id} cannot target right panel ` +
        `${target.ownerId}/${target.id}.`
      )
    }
    for (const resourceKind of input.contract.resourceKinds) {
      const existing = this.resolve(resourceKind)
      if (existing) {
        throw new Error(
          `Duplicate resource navigation owner for "${resourceKind}": ` +
          `${existing.ownerId}/${existing.id} and ${input.ownerId}/${input.id}.`
        )
      }
    }
    return this.slots.register({
      slot: RESOURCE_NAVIGATION_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        resolve: input.value.resolve
      })
    })
  }

  list(): readonly RegisteredResourceNavigationContribution[] {
    return this.slots.list(RESOURCE_NAVIGATION_SLOT)
  }

  resolve(resourceKind: string | null | undefined): RegisteredResourceNavigationContribution | null {
    const normalized = resourceKind?.trim()
    if (!normalized) return null
    return this.list().find(({ contribution }) =>
      contribution.resourceKinds.includes(normalized)
    ) ?? null
  }

  dispose(): void {
    this.slots.dispose()
  }
}

export function resolveResourceNavigation(
  registry: ResourceNavigationContributionRegistry,
  input: DomainWorkbenchOpenResourceInput
): DomainWorkbenchOpenRightPanelInput | null {
  const parsed = domainWorkbenchOpenResourceInputSchema.safeParse(input)
  if (!parsed.success) return null
  const registered = registry.resolve(parsed.data.resource.resourceKind)
  if (!registered) return null
  try {
    const target = registered.contribution.resolve(parsed.data)
    if (!target) return null
    const contributionId = registered.contribution.target.contributionId
    const rightPanelTarget = 'surfaceId' in parsed.data
      ? { surfaceId: parsed.data.surfaceId }
      : parsed.data.placement
        ? { placement: parsed.data.placement }
        : {}
    return Object.freeze({
      contributionId,
      sessionId: parsed.data.sessionId,
      ...rightPanelTarget,
      ...(target.activation
        ? {
            activation: Object.freeze({
              contributionId,
              ...target.activation
            })
          }
        : {})
    })
  } catch {
    return null
  }
}
