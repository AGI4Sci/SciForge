import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityRegistry, defineCapability, type CapabilityDefinition } from '../capabilities/registry'
import { ContributionHost } from '../../../packages/plugin-sdk/src/contribution-host'
import { publishCapabilitySnapshot } from './capability-ownership'
function definition(id: string, version = '1.0.0') {
  return defineCapability({ id, version, title: id, description: id, audiences: ['ui'], scope: 'global', resourceKinds: [], effect: 'compute', approval: 'none', concurrency: { revision: 'none', idempotency: 'required' }, tags: [], inputSchema: z.object({}), outputSchema: z.object({}), handler: async () => ({ output: {} }) })
}
describe('atomic capability snapshots with identity-bound cleanup', () => {
  it('keeps the previous generation entirely intact when the second new definition is invalid', () => {
    const registry = new CapabilityRegistry()
    const old = publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])
    const before = [...old.definitions]
    const invalid = { ...definition('fixture.b', '2.0.0'), descriptor: { ...definition('fixture.b').descriptor, title: '' } } as CapabilityDefinition
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0'), invalid], old.definitions)).toThrow()
    expect(registry.require('fixture.a')).toBe(before[0])
    expect(registry.require('fixture.b')).toBe(before[1])
  })
  it('restores the entire prior generation when a second registration throws after mutating', () => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])
    const register = registry.register.bind(registry)
    let writes = 0
    const fault = vi.spyOn(registry, 'register').mockImplementation((candidate) => {
      const result = register(candidate)
      if (++writes === 2) throw new Error('second publication failed after mutation')
      return result
    })
    try {
      expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0'), definition('fixture.b', '2.0.0')], previous.definitions)).toThrow('second publication failed')
      expect(registry.require('fixture.a')).toBe(previous.definitions[0])
      expect(registry.require('fixture.b')).toBe(previous.definitions[1])
    } finally { fault.mockRestore() }
  })
  it('Host register policy reads the complete old snapshot before and after each staged write', () => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])
    const observations: unknown[] = []
    const register = registry.register.bind(registry)
    vi.spyOn(registry, 'register').mockImplementation((candidate) => {
      for (const phase of ['before', 'after']) {
        if (phase === 'after') register(candidate)
        observations.push(registry.list().map(d => `${d.id}:${d.version}`))
        expect(registry.get('fixture.a')).toBe(previous.definitions[0])
        expect(registry.require('fixture.b')).toBe(previous.definitions[1])
        expect(registry.has('fixture.a')).toBe(true)
      }
      return registry
    })
    const next = publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0'), definition('fixture.b', '2.0.0')], previous.definitions)
    expect(observations).toEqual(Array.from({ length: 4 }, () => ['fixture.a:1.0.0', 'fixture.b:1.0.0']))
    expect(registry.require('fixture.a')).toBe(next.definitions[0])
  })
  it.each(['replaceOwned', 'register', 'registerAll', 'unregister'] as const)('rejects reentrant %s without touching exact old or independent owners', (operation) => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])
    registry.register(definition('fixture.independent'))
    const independent = registry.require('fixture.independent')
    const register = registry.register.bind(registry)
    const rejected: unknown[] = []
    let completedNestedOwner: CapabilityDefinition | undefined
    const fault = vi.spyOn(registry, 'register').mockImplementation((candidate) => {
      // The nested candidate is deliberately not faulted: the independent review
      // probe completed its nested operation before the outer policy threw.
      if (candidate.descriptor.id === 'fixture.nested') return register(candidate)
      register(candidate)
      // Use the captured base register to model a Host policy calling super.register.
      const mutate = () => {
        if (operation === 'replaceOwned') completedNestedOwner = registry.replaceOwned([], [definition('fixture.nested')])[0]
        if (operation === 'register') { register(definition('fixture.nested')); completedNestedOwner = registry.get('fixture.nested') }
        if (operation === 'registerAll') { registry.registerAll([definition('fixture.nested')]); completedNestedOwner = registry.get('fixture.nested') }
        if (operation === 'unregister') registry.unregister('fixture.independent')
      }
      try { mutate() } catch (error) { rejected.push(error) }
      throw new Error('outer policy failed')
    })
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0')], previous.definitions)).toThrow('outer policy failed')
    // A transaction may reject nested writes, but must never acknowledge one and
    // then silently erase its independent owner while handling an outer failure.
    if (completedNestedOwner) expect(registry.get('fixture.nested')).toBe(completedNestedOwner)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ code: 'reentrant_mutation' })
    expect(registry.require('fixture.a')).toBe(previous.definitions[0])
    expect(registry.require('fixture.b')).toBe(previous.definitions[1])
    expect(registry.require('fixture.independent')).toBe(independent)
    expect(registry.has('fixture.nested')).toBe(false)
    fault.mockRestore()
    registry.replaceOwned([], [definition('fixture.nested')])
    expect(registry.has('fixture.nested')).toBe(true)
  })
  it('a caught nested-mutation rejection permits the outer publication without revoking independent owners', () => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a')])
    const independent = publishCapabilitySnapshot(registry, [definition('fixture.independent')])
    const register = registry.register.bind(registry)
    const fault = vi.spyOn(registry, 'register').mockImplementation((candidate) => {
      register(candidate)
      expect(() => registry.replaceOwned([], [definition('fixture.nested')])).toThrow(/mutation/)
      expect(registry.require('fixture.a')).toBe(previous.definitions[0])
      return registry
    })
    let next: ReturnType<typeof publishCapabilitySnapshot>
    try { next = publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0')], previous.definitions) }
    finally { fault.mockRestore() }
    expect(registry.require('fixture.a')).toBe(next!.definitions[0])
    expect(registry.require('fixture.independent')).toBe(independent.definitions[0])
    expect(registry.has('fixture.nested')).toBe(false)
    previous.dispose()
    expect(registry.require('fixture.a')).toBe(next!.definitions[0])
  })
  it('failed contribution transfer revokes every provisional lease without retiring old cleanup or affecting retry', () => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])
    let aborted: ReturnType<typeof publishCapabilitySnapshot> | undefined
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0'), definition('fixture.c')], previous.definitions, publication => {
      aborted = publication
      expect(registry.require('fixture.a')).toBe(previous.definitions[0])
      expect(registry.require('fixture.b')).toBe(previous.definitions[1])
      expect(registry.has('fixture.c')).toBe(false)
      throw new Error('owner transfer failed')
    })).toThrow('owner transfer failed')
    aborted!.dispose()
    expect(registry.require('fixture.a')).toBe(previous.definitions[0])
    expect(registry.require('fixture.b')).toBe(previous.definitions[1])
    // Old cleanup must remain live, not be silently consumed by a failed transfer.
    previous.release('fixture.b')
    expect(registry.has('fixture.b')).toBe(false)
    const retry = publishCapabilitySnapshot(registry, [definition('fixture.a', '3.0.0'), definition('fixture.c')], [previous.definitions[0]])
    aborted!.dispose()
    previous.dispose()
    expect(registry.require('fixture.a')).toBe(retry.definitions[0])
    expect(registry.require('fixture.c')).toBe(retry.definitions[1])
    retry.dispose()
    expect(registry.list()).toEqual([])
  })
  it('rejects a forged lease with the same ID and descriptor but a different object identity', () => {
    const registry = new CapabilityRegistry()
    const previous = publishCapabilitySnapshot(registry, [definition('fixture.a')])
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0')], [{ ...previous.definitions[0] }])).toThrow(/ownership changed/)
    expect(registry.require('fixture.a')).toBe(previous.definitions[0])
  })
  it('does not partially publish if a later registration conflicts with another owner', () => {
    const registry = new CapabilityRegistry([definition('fixture.b')])
    const owner = registry.require('fixture.b')
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.b')])).toThrow()
    expect(registry.has('fixture.a')).toBe(false)
    expect(registry.require('fixture.b')).toBe(owner)
  })
  it('rejects duplicates before any registration', () => {
    const registry = new CapabilityRegistry()
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a'), definition('fixture.a')])).toThrow()
    expect(registry.has('fixture.a')).toBe(false)
  })
  it('old generation dispose cannot remove new generation; disabling new does not resurrect old', () => {
    const registry = new CapabilityRegistry()
    const first = publishCapabilitySnapshot(registry, [definition('fixture.a')])
    const second = publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0')], first.definitions)
    first.dispose()
    expect(registry.require('fixture.a')).toBe(second.definitions[0])
    second.dispose()
    expect(registry.has('fixture.a')).toBe(false)
  })
  it('stale generation cannot replace or delete another current owner', () => {
    const registry = new CapabilityRegistry()
    const first = publishCapabilitySnapshot(registry, [definition('fixture.a')])
    registry.unregister('fixture.a')
    registry.register(definition('fixture.a', '3.0.0'))
    const other = registry.require('fixture.a')
    expect(() => publishCapabilitySnapshot(registry, [definition('fixture.a', '2.0.0')], first.definitions)).toThrow()
    first.dispose()
    expect(registry.require('fixture.a')).toBe(other)
  })
  it('stages contribution ownership so a post-transfer prepare failure cannot split the tables', async () => {
    const registry = new CapabilityRegistry()
    const contributions = new ContributionHost()
    const first = publishCapabilitySnapshot(registry, [definition('fixture.a')])
    const oldContribution = contributions.register({ pluginId: 'fixture', generation: 1, kind: 'capability', id: 'fixture.a', value: first.definitions[0] })
    const next = definition('fixture.a', '2.0.0')

    expect(() => publishCapabilitySnapshot(registry, [next], first.definitions, publication => {
      contributions.prepareOwned([oldContribution], [{ pluginId: 'fixture', generation: 2, kind: 'capability', id: 'fixture.a', value: publication.definitions[0] }])
      throw new Error('prepare failed after contribution staging')
    })).toThrow('prepare failed after contribution staging')

    expect(registry.require('fixture.a')).toBe(first.definitions[0])
    expect(contributions.list()).toEqual([oldContribution])

    const commit = publishCapabilitySnapshot(registry, [next], first.definitions, publication =>
      contributions.prepareOwned([oldContribution], [{ pluginId: 'fixture', generation: 2, kind: 'capability', id: 'fixture.a', value: publication.definitions[0] }]))
    expect(registry.require('fixture.a')).toBe(commit.definitions[0])
    expect(contributions.list()[0].generation).toBe(2)
    commit.dispose()
    expect(registry.list()).toEqual([])
    await contributions.unregisterContribution('fixture', 'capability', 'fixture.a', 2)
    expect(contributions.list()).toEqual([])
  })
})
