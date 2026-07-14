import { describe, expect, it, vi } from 'vitest'
import type { SciForgeApi } from '@shared/sciforge-api'
import { subscribeBioGymRunEvents } from './biogym-api'

describe('BioGym renderer subscription', () => {
  it('subscribes before requesting replay and preserves unsubscribe', async () => {
    const order: string[] = []
    const unsubscribe = vi.fn()
    const onRunEvent = vi.fn(() => {
      order.push('subscribe')
      return unsubscribe
    })
    const replay = vi.fn(async () => {
      order.push('replay')
    })
    const stop = subscribeBioGymRunEvents({
      biogym: { onRunEvent, replay }
    } as unknown as SciForgeApi, vi.fn())

    expect(order).toEqual(['subscribe', 'replay'])
    await replay.mock.results[0]?.value
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps older bridges without replay usable and reports replay failures', async () => {
    const error = new Error('replay unavailable')
    const onReplayError = vi.fn()
    const stopLegacy = subscribeBioGymRunEvents({
      biogym: { onRunEvent: () => () => undefined }
    } as unknown as SciForgeApi, vi.fn(), onReplayError)
    stopLegacy()
    expect(onReplayError).not.toHaveBeenCalled()

    subscribeBioGymRunEvents({
      biogym: {
        onRunEvent: () => () => undefined,
        replay: () => Promise.reject(error)
      }
    } as unknown as SciForgeApi, vi.fn(), onReplayError)
    await vi.waitFor(() => expect(onReplayError).toHaveBeenCalledWith(error))
  })
})
