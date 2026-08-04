import type { ReactElement } from 'react'
import {
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  type DomainRendererWorkbenchRightPanelContract,
  type DomainRendererWorkbenchRightPanelRenderContext,
  type DomainRendererWorkbenchRightPanelValue
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_RIGHT_PANEL_SLOT = 'workbench.right-panel' as const
export { RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND }

export type WorkbenchRightPanelContribution =
  DomainRendererWorkbenchRightPanelContract &
  DomainRendererWorkbenchRightPanelValue<ReactElement> &
  Readonly<{ id: string }>

type WorkbenchRightPanelSlots = {
  [WORKBENCH_RIGHT_PANEL_SLOT]: WorkbenchRightPanelContribution
}

export type RegisteredWorkbenchRightPanelContribution = RegisteredRendererSlotContribution<
  WorkbenchRightPanelSlots,
  typeof WORKBENCH_RIGHT_PANEL_SLOT
>

export class WorkbenchRightPanelContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchRightPanelSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchRightPanelContract
    value: DomainRendererWorkbenchRightPanelValue<ReactElement>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_RIGHT_PANEL_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        render: (context: DomainRendererWorkbenchRightPanelRenderContext) =>
          input.value.render(context)
      })
    })
  }

  list(): readonly RegisteredWorkbenchRightPanelContribution[] {
    return this.slots.list(WORKBENCH_RIGHT_PANEL_SLOT)
  }

  resolve(
    contributionId: string | null | undefined
  ): RegisteredWorkbenchRightPanelContribution | null {
    const normalized = contributionId?.trim()
    return normalized
      ? this.slots.get(WORKBENCH_RIGHT_PANEL_SLOT, normalized)
      : null
  }

  dispose(): void {
    this.slots.dispose()
  }
}
