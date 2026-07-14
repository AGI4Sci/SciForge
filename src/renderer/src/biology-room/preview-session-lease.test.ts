import { describe, expect, it, vi } from 'vitest'
import { createBiologyPreviewSessionLease } from './preview-session-lease'

describe('Biology Room preview session lease', () => {
  it('releases sessions opened both before and after cleanup without duplicates', async () => {
    const releaseSession = vi.fn(async () => true)
    const lease = createBiologyPreviewSessionLease(releaseSession)

    lease.track('early')
    lease.releaseAll()
    lease.releaseAll()
    lease.track('late')
    await Promise.resolve()
    await Promise.resolve()

    expect(releaseSession).toHaveBeenCalledTimes(2)
    expect(releaseSession).toHaveBeenNthCalledWith(1, 'early')
    expect(releaseSession).toHaveBeenNthCalledWith(2, 'late')
  })
})
