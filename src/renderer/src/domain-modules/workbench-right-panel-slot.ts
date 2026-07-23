import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { RightPanelMode } from '../components/chat/WorkbenchTopBar'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_RIGHT_PANEL_SLOT = 'workbench.right-panel' as const
export const RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND =
  'renderer.workbench-right-panel' as const

export type WorkbenchRightPanelContribution = {
  id: string
  mode: Exclude<RightPanelMode, null>
  label: string
  icon: LucideIcon
  title: string
  resourceKind: string
  isAvailable: () => boolean
  render: (props: {
    className: string
    onCollapse: () => void
    workspaceRoot: string
  }) => ReactElement
}

type WorkbenchRendererSlots = {
  [WORKBENCH_RIGHT_PANEL_SLOT]: WorkbenchRightPanelContribution
}

export type RegisteredWorkbenchRightPanelContribution = RegisteredRendererSlotContribution<
  WorkbenchRendererSlots,
  typeof WORKBENCH_RIGHT_PANEL_SLOT
>

export class WorkbenchRightPanelContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchRendererSlots>()

  register(input: {
    ownerId: string
    order?: number
    contribution: WorkbenchRightPanelContribution
  }): RendererSlotRegistrationDisposable {
    const duplicateMode = this.list().find(
      ({ contribution }) => contribution.mode === input.contribution.mode
    )
    if (duplicateMode) {
      throw new Error(
        `Duplicate Workbench right-panel mode "${input.contribution.mode}" from ` +
        `"${input.ownerId}"; already registered by "${duplicateMode.ownerId}".`
      )
    }
    return this.slots.register({
      slot: WORKBENCH_RIGHT_PANEL_SLOT,
      id: input.contribution.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: input.contribution
    })
  }

  list(): readonly RegisteredWorkbenchRightPanelContribution[] {
    return this.slots.list(WORKBENCH_RIGHT_PANEL_SLOT)
  }

  resolve(mode: RightPanelMode): RegisteredWorkbenchRightPanelContribution | null {
    if (!mode) return null
    return this.list().find(({ contribution }) => contribution.mode === mode) ?? null
  }

  dispose(): void {
    this.slots.dispose()
  }
}
