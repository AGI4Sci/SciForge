import { describe, expect, it, vi } from 'vitest'

import { createCollaborationServerRuntime } from './bootstrap.js'
import type { SqlPool } from './postgres.js'

describe('Cloud-owned Task offer expiry runtime', () => {
  it('reconciles expired durable offers before accepting traffic', async () => {
    const pool: SqlPool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn(async () => { throw new Error('Unexpected database transaction') }),
      end: vi.fn(async () => undefined)
    }
    const runtime = createCollaborationServerRuntime({
      pool,
      host: '127.0.0.1',
      port: 0,
      taskOfferExpiryIntervalMs: 300_000
    })
    const expireTaskOffers = vi.spyOn(runtime.service, 'expireTaskOffers').mockResolvedValue(0)
    try {
      await runtime.start()
      expect(expireTaskOffers).toHaveBeenCalledTimes(1)
    } finally {
      await runtime.stop()
    }
  })
})
