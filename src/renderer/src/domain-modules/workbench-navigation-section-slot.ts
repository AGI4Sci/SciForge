import type { ReactElement } from 'react'
import {
  WORKBENCH_NAVIGATION_SECTION_LOCATION,
  type DomainRendererWorkbenchNavigationSectionContract,
  type DomainRendererWorkbenchNavigationSectionRenderContext,
  type DomainRendererWorkbenchNavigationSectionValue
} from '@sciforge/domain-sdk/renderer'

import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_NAVIGATION_SECTION_SLOT =
  WORKBENCH_NAVIGATION_SECTION_LOCATION

export type WorkbenchNavigationSectionContribution =
  DomainRendererWorkbenchNavigationSectionContract &
  DomainRendererWorkbenchNavigationSectionValue<ReactElement | null> &
  Readonly<{ id: string }>

type WorkbenchNavigationSectionSlots = {
  [WORKBENCH_NAVIGATION_SECTION_SLOT]: WorkbenchNavigationSectionContribution
}

export type RegisteredWorkbenchNavigationSectionContribution =
  RegisteredRendererSlotContribution<
    WorkbenchNavigationSectionSlots,
    typeof WORKBENCH_NAVIGATION_SECTION_SLOT
  >

export class WorkbenchNavigationSectionContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchNavigationSectionSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchNavigationSectionContract
    value: DomainRendererWorkbenchNavigationSectionValue<ReactElement | null>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_NAVIGATION_SECTION_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        render: (context: DomainRendererWorkbenchNavigationSectionRenderContext) =>
          input.value.render(context)
      })
    })
  }

  list(): readonly RegisteredWorkbenchNavigationSectionContribution[] {
    return this.slots.list(WORKBENCH_NAVIGATION_SECTION_SLOT)
  }

  dispose(): void {
    this.slots.dispose()
  }
}
