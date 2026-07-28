import {
  domainRendererCommandInvocationSchema,
  isDomainRendererCommandActive,
  isDomainRendererCommandAvailable,
  type DomainRendererCommandHandler,
  type DomainRendererCommandInvocation
} from '@sciforge/domain-sdk/renderer'
import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'

export const WORKBENCH_COMMAND_SLOT = 'workbench.command' as const

type WorkbenchCommandSlots = {
  [WORKBENCH_COMMAND_SLOT]: DomainRendererCommandHandler
}

export type RegisteredWorkbenchCommand = RegisteredRendererSlotContribution<
  WorkbenchCommandSlots,
  typeof WORKBENCH_COMMAND_SLOT
>

export class WorkbenchCommandRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchCommandSlots>()

  register(input: {
    id: string
    ownerId: string
    order?: number
    contribution: DomainRendererCommandHandler
  }): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_COMMAND_SLOT,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: input.contribution
    })
  }

  list(): readonly RegisteredWorkbenchCommand[] {
    return this.slots.list(WORKBENCH_COMMAND_SLOT)
  }

  resolve(commandId: string): RegisteredWorkbenchCommand | null {
    const normalized = commandId.trim()
    return normalized ? this.slots.get(WORKBENCH_COMMAND_SLOT, normalized) : null
  }

  isAvailable(commandId: string, context: DomainRendererCommandInvocation): boolean {
    const command = this.resolve(commandId)
    if (!command) return false
    return isDomainRendererCommandAvailable(command.contribution, context)
  }

  isActive(commandId: string, context: DomainRendererCommandInvocation): boolean {
    const command = this.resolve(commandId)
    if (!command) return false
    return isDomainRendererCommandActive(command.contribution, context)
  }

  async execute(
    commandId: string,
    invocation: DomainRendererCommandInvocation
  ): Promise<boolean> {
    const parsed = domainRendererCommandInvocationSchema.safeParse(invocation)
    if (!parsed.success || !this.isAvailable(commandId, parsed.data)) return false
    const command = this.resolve(commandId)
    if (!command) return false
    await command.contribution.execute(parsed.data)
    return true
  }

  dispose(): void {
    this.slots.dispose()
  }
}
