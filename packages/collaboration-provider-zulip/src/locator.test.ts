import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZulipProviderError } from './errors.js'
import { createZulipLocator, ZulipLocatorIndex } from './locator.js'

describe('ZulipLocatorIndex', () => {
  it('keeps distinct stable identities for Chinese topics and preserves identity across relocation', () => {
    const first = createZulipLocator({
      realmId: 'https://chat.example.cn/zulip',
      streamId: '12',
      streamName: '研究协作',
      topicName: '蛋白质结构分析',
      topicId: 'zulip-topic-first'
    })
    const second = createZulipLocator({
      realmId: 'https://chat.example.cn/zulip',
      streamId: '12',
      streamName: '研究协作',
      topicName: '蛋白质结构验证',
      topicId: 'zulip-topic-second'
    })
    assert.notEqual(first.topicId, second.topicId)

    const index = new ZulipLocatorIndex()
    index.upsert({ bindingId: 'projection-a', revision: 1, locator: first })
    index.upsert({ bindingId: 'projection-b', revision: 1, locator: second })
    assert.equal(index.resolve({
      realmId: first.realmId,
      containerId: first.containerId,
      topicDisplayName: '蛋白质结构分析'
    }).bindingId, 'projection-a')

    const renamed = index.relocate({
      bindingId: 'projection-a',
      expectedRevision: 1,
      topicName: '蛋白质结构分析（二期）'
    })
    assert.equal(renamed.locator.topicId, first.topicId)
    assert.equal(renamed.revision, 2)
    assert.equal(index.resolve({
      realmId: first.realmId,
      containerId: first.containerId,
      topicDisplayName: '蛋白质结构分析（二期）'
    }, 2).bindingId, 'projection-a')
  })

  it('fails closed for missing, ambiguous, and stale locator revisions', () => {
    const locator = createZulipLocator({
      realmId: 'https://chat.example.cn',
      streamId: '12',
      streamName: 'science',
      topicName: 'same topic',
      topicId: 'topic-a'
    })
    const index = new ZulipLocatorIndex()
    assert.throws(() => index.resolve({
      realmId: locator.realmId,
      containerId: locator.containerId,
      topicDisplayName: locator.topicDisplayName
    }), (error) => error instanceof ZulipProviderError && error.code === 'locator_missing')

    index.upsert({ bindingId: 'a', revision: 3, locator })
    assert.throws(() => index.resolve({
      realmId: locator.realmId,
      containerId: locator.containerId,
      topicDisplayName: locator.topicDisplayName
    }, 2), (error) => error instanceof ZulipProviderError && error.code === 'locator_revision_mismatch')

    index.upsert({ bindingId: 'b', revision: 1, locator: { ...locator, topicId: 'topic-b' } })
    assert.throws(() => index.resolve({
      realmId: locator.realmId,
      containerId: locator.containerId,
      topicDisplayName: locator.topicDisplayName
    }), (error) => error instanceof ZulipProviderError && error.code === 'locator_ambiguous')
  })
})
