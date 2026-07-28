import type { LucideIcon } from 'lucide-react'
import {
  RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
  WORKBENCH_TOPBAR_LOCATION,
  type DomainRendererCommandInvocation,
  type DomainRendererWorkbenchToolbarActionContract,
  type DomainRendererWorkbenchToolbarActionValue
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'
import {
  type WorkbenchCommandRegistry
} from './workbench-command-registry'

export const WORKBENCH_TOOLBAR_SLOT = WORKBENCH_TOPBAR_LOCATION
export { RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND }

export type WorkbenchToolbarActionContract =
  DomainRendererWorkbenchToolbarActionContract
export type WorkbenchToolbarActionValue =
  DomainRendererWorkbenchToolbarActionValue<LucideIcon>

export type WorkbenchToolbarActionContribution =
  WorkbenchToolbarActionContract &
  WorkbenchToolbarActionValue &
  Readonly<{
    id: string
    isAvailable: (context: DomainRendererCommandInvocation) => boolean
    isActive: (context: DomainRendererCommandInvocation) => boolean
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
 * Registry for package-owned Workbench toolbar presentation. Toolbar items
 * reference commands but never own command behavior.
 */
export class WorkbenchToolbarActionContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchRendererToolbarSlots>()

  constructor(
    private readonly commands: WorkbenchCommandRegistry
  ) {}

  register(input: {
    id: string
    ownerId: string
    order?: number
    contract: WorkbenchToolbarActionContract
    value: WorkbenchToolbarActionValue
  }): RendererSlotRegistrationDisposable {
    const command = this.commands.resolve(input.contract.commandId)
    if (!command) {
      throw new Error(
        `Workbench toolbar action "${input.id}" references unknown command ` +
        `"${input.contract.commandId}".`
      )
    }
    if (command.ownerId !== input.ownerId) {
      throw new Error(
        `Workbench toolbar action "${input.id}" from "${input.ownerId}" cannot reference ` +
        `command owned by "${command.ownerId}".`
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
      isAvailable: (context: DomainRendererCommandInvocation) =>
        this.commands.isAvailable(input.contract.commandId, context),
      isActive: (context: DomainRendererCommandInvocation) =>
        this.commands.isActive(input.contract.commandId, context)
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

  available(context: DomainRendererCommandInvocation):
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

  dispose(): void {
    this.slots.dispose()
  }
}
