import type { ReactElement } from 'react'
import {
  RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
  type DomainRendererWorkbenchGlobalOverlayContract,
  type DomainRendererWorkbenchGlobalOverlayRenderContext,
  type DomainRendererWorkbenchGlobalOverlayValue
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_GLOBAL_OVERLAY_SLOT = 'workbench.global-overlay' as const
export { RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND }

export type WorkbenchGlobalOverlayContribution =
  DomainRendererWorkbenchGlobalOverlayContract &
  DomainRendererWorkbenchGlobalOverlayValue<ReactElement> &
  Readonly<{ id: string }>

type WorkbenchGlobalOverlaySlots = {
  [WORKBENCH_GLOBAL_OVERLAY_SLOT]: WorkbenchGlobalOverlayContribution
}

export type RegisteredWorkbenchGlobalOverlayContribution =
  RegisteredRendererSlotContribution<
    WorkbenchGlobalOverlaySlots,
    typeof WORKBENCH_GLOBAL_OVERLAY_SLOT
  >

export class WorkbenchGlobalOverlayContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchGlobalOverlaySlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchGlobalOverlayContract
    value: DomainRendererWorkbenchGlobalOverlayValue<ReactElement>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_GLOBAL_OVERLAY_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        render: (context: DomainRendererWorkbenchGlobalOverlayRenderContext) =>
          input.value.render(context)
      })
    })
  }

  list(): readonly RegisteredWorkbenchGlobalOverlayContribution[] {
    return this.slots.list(WORKBENCH_GLOBAL_OVERLAY_SLOT)
  }

  resolve(
    contributionId: string | null | undefined
  ): RegisteredWorkbenchGlobalOverlayContribution | null {
    const normalized = contributionId?.trim()
    return normalized
      ? this.slots.get(WORKBENCH_GLOBAL_OVERLAY_SLOT, normalized)
      : null
  }

  dispose(): void {
    this.slots.dispose()
  }
}
