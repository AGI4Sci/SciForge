import { describe, expect, it } from 'vitest'
import { EphemeralThreadOwnershipRegistry } from './ephemeral-thread-ownership'

describe('EphemeralThreadOwnershipRegistry', () => {
  it('retains completed and nested children for child-first reclamation', async () => {
    const registry = new EphemeralThreadOwnershipRegistry()
    registry.registerRoot('root')
    const first = registry.beginChildCreation('root')
    first?.register('child')
    first?.settle()
    const nested = registry.beginChildCreation('child')
    nested?.register('grandchild')
    nested?.settle()

    const reclaim = await registry.beginReclaim('root')

    expect(reclaim.childThreadIds).toEqual(['grandchild', 'child'])
    expect(() => registry.beginChildCreation('root')).toThrow('is closing')
    registry.completeReclaim('root')
    expect(registry.snapshot()).toEqual({
      roots: 0,
      threads: 0,
      pendingCreations: 0,
      backgroundTasks: 0
    })
  })

  it('waits in-flight child creation and background work before exposing reclaim handles', async () => {
    const registry = new EphemeralThreadOwnershipRegistry()
    registry.registerRoot('root')
    const creation = registry.beginChildCreation('root')
    let settleTask!: () => void
    const task = new Promise<void>((resolve) => { settleTask = resolve })
    registry.trackBackgroundTask('root', task)
    let reclaimed = false
    const reclaiming = registry.beginReclaim('root').then((value) => {
      reclaimed = true
      return value
    })
    await Promise.resolve()
    expect(reclaimed).toBe(false)
    creation?.register('child')
    creation?.settle()

    const reclaim = await reclaiming
    expect(reclaim.childThreadIds).toEqual(['child'])
    expect(reclaim.backgroundTasks).toHaveLength(1)
    settleTask()
    await Promise.all(reclaim.backgroundTasks)
  })

  it('rejects unauthorized roots and duplicate ownership', async () => {
    const registry = new EphemeralThreadOwnershipRegistry()
    registry.registerRoot('root')
    expect(() => registry.registerRoot('root')).toThrow('already owned')
    await expect(registry.beginReclaim('persistent')).rejects.toThrow(
      'not a runtime-owned ephemeral root'
    )
  })
})
