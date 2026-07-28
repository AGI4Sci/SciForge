import type { LucideIcon } from 'lucide-react'
import type { RightPanelMode } from '../components/chat/WorkbenchTopBar'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'
import {
  type WorkbenchRightPanelContributionRegistry
} from './workbench-right-panel-slot'

export const WORKBENCH_TOOLBAR_SLOT = 'workbench.topbar' as const
export const RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND =
  'renderer.workbench-toolbar-action' as const

export type WorkbenchToolbarContext = Readonly<{
  activeRightPanelMode: RightPanelMode
  workspaceRoot: string
}>

export type WorkbenchToolbarActionContract = Readonly<{
  location: typeof WORKBENCH_TOOLBAR_SLOT
  commandId: string
  label: string
  target: Readonly<{
    kind: 'workbench.right-panel'
    contributionId: string
  }>
}>

export type WorkbenchToolbarActionValue = Readonly<{
  icon: LucideIcon
  isAvailable: (context: WorkbenchToolbarContext) => boolean
}>

export type WorkbenchToolbarActionContribution =
  WorkbenchToolbarActionContract &
  WorkbenchToolbarActionValue &
  Readonly<{
    id: string
    isActive: (context: WorkbenchToolbarContext) => boolean
  }>

type WorkbenchRendererToolbarSlots = {
  [WORKBENCH_TOOLBAR_SLOT]: WorkbenchToolbarActionContribution
}

export type RegisteredWorkbenchToolbarActionContribution =
  RegisteredRendererSlotContribution<
    WorkbenchRendererToolbarSlots,
    typeof WORKBENCH_TOOLBAR_SLOT
  >

/**
 * Registry for package-owned Workbench actions. Targets are resolved at
 * registration time so an invalid package batch cannot leave a dead button in
 * the toolbar.
 */
export class WorkbenchToolbarActionContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchRendererToolbarSlots>()

  constructor(
    private readonly rightPanels: WorkbenchRightPanelContributionRegistry
  ) {}

  register(input: {
    id: string
    ownerId: string
    order?: number
    contract: WorkbenchToolbarActionContract
    value: WorkbenchToolbarActionValue
  }): RendererSlotRegistrationDisposable {
    const panel = this.rightPanels.resolveById(input.contract.target.contributionId)
    if (!panel) {
      throw new Error(
        `Workbench toolbar command "${input.contract.commandId}" targets unknown right-panel ` +
        `contribution "${input.contract.target.contributionId}".`
      )
    }
    if (panel.ownerId !== input.ownerId) {
      throw new Error(
        `Workbench toolbar command "${input.contract.commandId}" from "${input.ownerId}" cannot ` +
        `target right-panel contribution owned by "${panel.ownerId}".`
      )
    }
    const duplicateCommand = this.resolveCommand(input.contract.commandId)
    if (duplicateCommand) {
      throw new Error(
        `Duplicate Workbench toolbar command "${input.contract.commandId}" from ` +
        `"${input.ownerId}"; already registered by "${duplicateCommand.ownerId}".`
      )
    }

    const contribution = Object.freeze({
      id: input.id,
      ...input.contract,
      icon: input.value.icon,
      isAvailable: (context: WorkbenchToolbarContext) =>
        isSafelyAvailable(input.value, context),
      isActive: (context: WorkbenchToolbarContext) =>
        context.activeRightPanelMode === panel.contribution.mode
    })
    return this.slots.register({
      slot: WORKBENCH_TOOLBAR_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution
    })
  }

  list(): readonly RegisteredWorkbenchToolbarActionContribution[] {
    return this.slots.list(WORKBENCH_TOOLBAR_SLOT)
  }

  available(context: WorkbenchToolbarContext):
  readonly RegisteredWorkbenchToolbarActionContribution[] {
    return this.list().filter(({ contribution }) => contribution.isAvailable(context))
  }

  resolveCommand(commandId: string): RegisteredWorkbenchToolbarActionContribution | null {
    const normalized = commandId.trim()
    if (!normalized) return null
    return this.list().find(({ contribution }) =>
      contribution.commandId === normalized
    ) ?? null
  }

  execute(
    commandId: string,
    context: WorkbenchToolbarContext,
    toggleRightPanel: (mode: Exclude<RightPanelMode, null>) => void
  ): boolean {
    const action = this.resolveCommand(commandId)
    if (!action || !action.contribution.isAvailable(context)) return false
    const panel = this.rightPanels.resolveById(action.contribution.target.contributionId)
    if (!panel || panel.ownerId !== action.ownerId) return false
    toggleRightPanel(panel.contribution.mode)
    return true
  }

  dispose(): void {
    this.slots.dispose()
  }
}

function isSafelyAvailable(
  contribution: WorkbenchToolbarActionValue,
  context: WorkbenchToolbarContext
): boolean {
  try {
    return contribution.isAvailable(context) === true
  } catch {
    return false
  }
}
