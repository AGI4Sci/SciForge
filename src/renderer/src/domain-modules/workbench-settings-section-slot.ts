import type { ReactElement } from 'react'
import {
  WORKBENCH_SETTINGS_SECTION_LOCATION,
  type DomainRendererWorkbenchSettingsSectionContract,
  type DomainRendererWorkbenchSettingsSectionValue
} from '@sciforge/domain-sdk/renderer'
import { RendererSlotRegistry, type RendererSlotRegistrationDisposable } from './renderer-slot-registry'

type SettingsSectionSlots = {
  [WORKBENCH_SETTINGS_SECTION_LOCATION]: DomainRendererWorkbenchSettingsSectionContract &
    DomainRendererWorkbenchSettingsSectionValue<ReactElement | null>
}

export class WorkbenchSettingsSectionContributionRegistry {
  private readonly slots = new RendererSlotRegistry<SettingsSectionSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchSettingsSectionContract
    value: DomainRendererWorkbenchSettingsSectionValue<ReactElement | null>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_SETTINGS_SECTION_LOCATION,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({ ...input.contract, render: () => input.value.render() })
    })
  }

  list() {
    return this.slots.list(WORKBENCH_SETTINGS_SECTION_LOCATION)
  }

  dispose(): void {
    this.slots.dispose()
  }
}
