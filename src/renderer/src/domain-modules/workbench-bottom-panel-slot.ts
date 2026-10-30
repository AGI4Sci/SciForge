import type { ReactElement } from 'react'
import {
  RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
  type DomainRendererWorkbenchBottomPanelContract,
  type DomainRendererWorkbenchBottomPanelRenderContext,
  type DomainRendererWorkbenchBottomPanelValue
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_BOTTOM_PANEL_SLOT = 'workbench.bottom-panel' as const
export { RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND }

export type WorkbenchBottomPanelContribution =
  DomainRendererWorkbenchBottomPanelContract &
  DomainRendererWorkbenchBottomPanelValue<ReactElement> &
  Readonly<{ id: string }>

type WorkbenchBottomPanelSlots = {
  [WORKBENCH_BOTTOM_PANEL_SLOT]: WorkbenchBottomPanelContribution
}

export type RegisteredWorkbenchBottomPanelContribution =
  RegisteredRendererSlotContribution<
    WorkbenchBottomPanelSlots,
    typeof WORKBENCH_BOTTOM_PANEL_SLOT
  >

export class WorkbenchBottomPanelContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchBottomPanelSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchBottomPanelContract
    value: DomainRendererWorkbenchBottomPanelValue<ReactElement>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_BOTTOM_PANEL_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        render: (context: DomainRendererWorkbenchBottomPanelRenderContext) =>
          input.value.render(context)
      })
    })
  }

  list(): readonly RegisteredWorkbenchBottomPanelContribution[] {
    return this.slots.list(WORKBENCH_BOTTOM_PANEL_SLOT)
  }

  resolve(
    contributionId: string | null | undefined
  ): RegisteredWorkbenchBottomPanelContribution | null {
    const normalized = contributionId?.trim()
    return normalized
      ? this.slots.get(WORKBENCH_BOTTOM_PANEL_SLOT, normalized)
      : null
  }

  dispose(): void {
    this.slots.dispose()
  }
}
