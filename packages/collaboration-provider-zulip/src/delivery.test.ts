import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ZulipDeliveryCoordinator,
  type ZulipDeliveryLedger,
  type ZulipDeliveryRecord
} from './delivery.js'
import { ZulipProviderError } from './errors.js'
import { createZulipLocator } from './locator.js'

class MemoryLedger implements ZulipDeliveryLedger {
  readonly records = new Map<string, ZulipDeliveryRecord>()

  async get(idempotencyKey: string): Promise<ZulipDeliveryRecord | null> {
    return this.records.get(idempotencyKey) ?? null
  }

  async begin(record: ZulipDeliveryRecord): Promise<ZulipDeliveryRecord> {
    const previous = this.records.get(record.idempotencyKey)
    if (previous) return previous
    this.records.set(record.idempotencyKey, record)
    return record
  }

  async update(record: ZulipDeliveryRecord): Promise<void> {
    this.records.set(record.idempotencyKey, record)
  }
}

const locator = createZulipLocator({
  realmId: 'https://chat.example.cn',
  streamId: '12',
  streamName: 'science',
  topicName: '测试',
  topicId: 'topic-stable'
})

describe('ZulipDeliveryCoordinator', () => {
  it('reconciles an uncertain result before retrying', async () => {
    const ledger = new MemoryLedger()
    let sendAttempts = 0
    let reconciliations = 0
    const coordinator = new ZulipDeliveryCoordinator({
      ledger,
      reconcile: async () => {
        reconciliations += 1
        return { status: 'sent', remoteMessageId: 'remote-42' }
      },
      now: () => new Date('2026-08-15T00:00:00.000Z')
    })
    const result = await coordinator.deliver({
      idempotencyKey: 'delivery-1',
      locator,
      content: '最终回复',
      send: async () => {
        sendAttempts += 1
        throw new ZulipProviderError('provider_unavailable', 'connection reset', { retryable: true })
      }
    })
    assert.deepEqual(result, {
      remoteMessageId: 'remote-42',
      duplicate: false,
      reconciled: true,
      attempts: 1
    })
    assert.equal(sendAttempts, 1)
    assert.equal(reconciliations, 1)
  })

  it('retries a provider-confirmed rate limit and returns the same durable receipt', async () => {
    const ledger = new MemoryLedger()
    const delays: number[] = []
    let attempts = 0
    const coordinator = new ZulipDeliveryCoordinator({
      ledger,
      reconcile: async () => ({ status: 'not_sent' }),
      sleep: async (milliseconds) => { delays.push(milliseconds) },
      now: () => new Date('2026-08-15T00:00:00.000Z')
    })
    const deliver = () => coordinator.deliver({
      idempotencyKey: 'delivery-2',
      locator,
      content: '桌面消息',
      send: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new ZulipProviderError('rate_limited', 'try later', {
            retryable: true,
            retryAfterMs: 25
          })
        }
        return { remoteMessageId: 'remote-43' }
      }
    })
    assert.deepEqual(await deliver(), {
      remoteMessageId: 'remote-43',
      duplicate: false,
      reconciled: false,
      attempts: 2
    })
    assert.deepEqual(delays, [25])
    assert.deepEqual(await deliver(), {
      remoteMessageId: 'remote-43',
      duplicate: true,
      reconciled: false,
      attempts: 2
    })
    assert.equal(attempts, 2)
  })
})
