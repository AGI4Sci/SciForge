import { describe, expect, it } from 'vitest'
import { StableResourceBindingRegistry } from './stable-resource-bindings'

describe('StableResourceBindingRegistry', () => {
  it('counts pending reservations and lets an existing canonical key reopen at capacity', () => {
    const registry = new StableResourceBindingRegistry<{ observer: string }>(1, 'Fixture')
    const first = registry.reserve('resource-a').commit('resource-a', () => ({ observer: 'a' }))

    const existing = registry.reserve('resource-a').commit('resource-a', () => ({ observer: 'forged' }))
    expect(existing).toMatchObject({ binding: first.binding, created: false })
    expect(() => registry.reserve('resource-b')).toThrow(/capacity was reached/)
  })

  it('releases a failed pending reservation before admitting another provider open', () => {
    const registry = new StableResourceBindingRegistry<{ observer: string }>(1, 'Fixture')
    const failed = registry.reserve()
    expect(() => registry.reserve()).toThrow(/capacity was reached/)

    failed.release()
    expect(registry.reserve()).toBeTruthy()
  })

  it('rechecks capacity when a previously existing binding disappears before commit', () => {
    const registry = new StableResourceBindingRegistry<{ observer: string }>(1, 'Fixture')
    const first = registry.reserve('resource-a').commit('resource-a', () => ({ observer: 'a' }))
    const reopen = registry.reserve('resource-a')
    expect(first.rollback()).toBe(true)
    registry.reserve('resource-b').commit('resource-b', () => ({ observer: 'b' }))

    expect(() => reopen.commit('resource-a', () => ({ observer: 'replacement-a' })))
      .toThrow(/capacity was reached/)
  })
})
