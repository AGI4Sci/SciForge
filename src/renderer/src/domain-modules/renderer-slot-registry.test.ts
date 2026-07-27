import { describe, expect, it } from 'vitest'
import { RendererSlotRegistry } from './renderer-slot-registry'

type TestSlots = {
  panel: { label: string }
  toolbar: { command: string }
}

describe('RendererSlotRegistry', () => {
  it('returns deterministic owner-aware slot snapshots', () => {
    const registry = new RendererSlotRegistry<TestSlots>()
    registry.register({
      slot: 'panel',
      id: 'later',
      ownerId: 'module-z',
      order: 20,
      contribution: { label: 'Later' }
    })
    registry.register({
      slot: 'panel',
      id: 'second',
      ownerId: 'module-b',
      order: 10,
      contribution: { label: 'Second' }
    })
    registry.register({
      slot: 'panel',
      id: 'first',
      ownerId: 'module-a',
      order: 10,
      contribution: { label: 'First' }
    })

    expect(registry.list('panel').map(({ id, ownerId }) => ({ id, ownerId }))).toEqual([
      { id: 'first', ownerId: 'module-a' },
      { id: 'second', ownerId: 'module-b' },
      { id: 'later', ownerId: 'module-z' }
    ])
  })

  it('rejects duplicate IDs within the same slot', () => {
    const registry = new RendererSlotRegistry<TestSlots>()
    registry.register({
      slot: 'panel',
      id: 'paper',
      ownerId: 'paper-radar',
      contribution: { label: 'Paper Radar' }
    })

    expect(() => registry.register({
      slot: 'panel',
      id: 'paper',
      ownerId: 'other-module',
      contribution: { label: 'Other' }
    })).toThrow('Duplicate renderer contribution "paper" in slot "panel".')
  })

  it('disposes individual registrations and the whole registry', () => {
    const registry = new RendererSlotRegistry<TestSlots>()
    const panel = registry.register({
      slot: 'panel',
      id: 'paper',
      ownerId: 'paper-radar',
      contribution: { label: 'Paper Radar' }
    })
    registry.register({
      slot: 'toolbar',
      id: 'search',
      ownerId: 'paper-radar',
      contribution: { command: 'search' }
    })

    panel.dispose()
    panel.dispose()
    expect(registry.list('panel')).toEqual([])
    expect(registry.list('toolbar')).toHaveLength(1)

    registry.dispose()
    expect(registry.list('toolbar')).toEqual([])
  })

  it('allows an ID to be registered again after disposal', () => {
    const registry = new RendererSlotRegistry<TestSlots>()
    const first = registry.register({
      slot: 'panel',
      id: 'paper',
      ownerId: 'paper-radar',
      contribution: { label: 'First' }
    })
    first.dispose()
    registry.register({
      slot: 'panel',
      id: 'paper',
      ownerId: 'paper-radar',
      contribution: { label: 'Second' }
    })
    first.dispose()

    expect(registry.get('panel', 'paper')?.contribution.label).toBe('Second')
  })
})
