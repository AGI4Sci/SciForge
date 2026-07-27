export type RendererSlotMap = Record<string, unknown>

export type RendererSlotRegistration<
  TSlots extends RendererSlotMap,
  TSlot extends Extract<keyof TSlots, string>
> = {
  slot: TSlot
  id: string
  ownerId: string
  order?: number
  contribution: TSlots[TSlot]
}

export type RegisteredRendererSlotContribution<
  TSlots extends RendererSlotMap,
  TSlot extends Extract<keyof TSlots, string>
> = Readonly<{
  slot: TSlot
  id: string
  ownerId: string
  order: number
  contribution: TSlots[TSlot]
}>

export type RendererSlotRegistrationDisposable = {
  dispose: () => void
}

type AnyRegisteredContribution<TSlots extends RendererSlotMap> =
  RegisteredRendererSlotContribution<TSlots, Extract<keyof TSlots, string>>

type StoredContribution<TSlots extends RendererSlotMap> = {
  value: AnyRegisteredContribution<TSlots>
  token: object
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

/**
 * Registry for trusted renderer contributions shipped with the application.
 * IDs are unique within a slot; registrations retain their module owner and can
 * be disposed independently without affecting a later replacement.
 */
export class RendererSlotRegistry<TSlots extends RendererSlotMap> {
  private readonly entries = new Map<string, StoredContribution<TSlots>>()

  register<TSlot extends Extract<keyof TSlots, string>>(
    registration: RendererSlotRegistration<TSlots, TSlot>
  ): RendererSlotRegistrationDisposable {
    const slot = requiredIdentifier(registration.slot, 'Renderer slot') as TSlot
    const id = requiredIdentifier(registration.id, 'Renderer contribution ID')
    const ownerId = requiredIdentifier(registration.ownerId, 'Renderer contribution owner')
    const key = this.entryKey(slot, id)
    if (this.entries.has(key)) {
      throw new Error(`Duplicate renderer contribution "${id}" in slot "${slot}".`)
    }

    const token = {}
    const value = Object.freeze({
      slot,
      id,
      ownerId,
      order: registration.order ?? 0,
      contribution: registration.contribution
    }) as AnyRegisteredContribution<TSlots>
    this.entries.set(key, { value, token })

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.entries.get(key)?.token === token) this.entries.delete(key)
      }
    }
  }

  list<TSlot extends Extract<keyof TSlots, string>>(
    slot: TSlot
  ): readonly RegisteredRendererSlotContribution<TSlots, TSlot>[] {
    return [...this.entries.values()]
      .filter((entry) => entry.value.slot === slot)
      .sort((left, right) =>
        left.value.order - right.value.order ||
        left.value.ownerId.localeCompare(right.value.ownerId) ||
        left.value.id.localeCompare(right.value.id)
      )
      .map((entry) => entry.value as RegisteredRendererSlotContribution<TSlots, TSlot>)
  }

  get<TSlot extends Extract<keyof TSlots, string>>(
    slot: TSlot,
    id: string
  ): RegisteredRendererSlotContribution<TSlots, TSlot> | null {
    const entry = this.entries.get(this.entryKey(slot, id.trim()))
    return (entry?.value as RegisteredRendererSlotContribution<TSlots, TSlot> | undefined) ?? null
  }

  dispose(): void {
    this.entries.clear()
  }

  private entryKey(slot: string, id: string): string {
    return `${slot}\u0000${id}`
  }
}
