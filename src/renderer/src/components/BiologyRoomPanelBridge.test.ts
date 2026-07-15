import { describe, expect, it, vi } from 'vitest'
import {
  biologyRoomInitialTargetKey,
  createBiologyRoomInitialOpenCoordinator
} from './BiologyRoomPanelBridge'

describe('BiologyRoomPanelBridge direct opening', () => {
  it('uses a semantic target key instead of React object identity', () => {
    const first = biologyRoomInitialTargetKey('/workspace/lab/', {
      path: '/workspace/lab/protein.pdb',
      integrity: { algorithm: 'sha256', expectedDigest: `sha256:${'a'.repeat(64)}` },
      selection: { kind: 'molecular', chains: ['A'] }
    })
    const second = biologyRoomInitialTargetKey('/workspace/lab', {
      path: '/workspace/lab/protein.pdb',
      integrity: { algorithm: 'sha256', expectedDigest: `SHA256:${'a'.repeat(64)}` },
      selection: { kind: 'molecular', chains: ['A'] }
    })

    expect(second).toBe(first)
    expect(biologyRoomInitialTargetKey('/workspace/lab', {
      path: '/workspace/lab/protein.pdb',
      selection: { kind: 'molecular', chains: ['B'] }
    })).not.toBe(first)
  })

  it('coalesces StrictMode effect replay into one open task', async () => {
    const coordinator = createBiologyRoomInitialOpenCoordinator()
    const start = vi.fn(async () => undefined)

    const first = coordinator.run('target-a', start)
    const replay = coordinator.run('target-a', start)
    await Promise.all([first, replay])

    expect(replay).toBe(first)
    expect(start).toHaveBeenCalledOnce()
    await coordinator.run('target-b', start)
    expect(start).toHaveBeenCalledTimes(2)
  })
})
