import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { ZulipProviderError } from './errors.js'
import { ZulipProviderRateLimiter } from './rate-limit.js'
import { redactZulipDiagnostic, redactZulipText } from './redaction.js'
import {
  zulipEventsResponseSchema,
  zulipRawEventSchema,
  zulipRegisterResponseSchema,
  zulipSubscriptionsResponseSchema,
  zulipUserResponseSchema
} from './schemas.js'

describe('Zulip provider security boundaries', () => {
  it('rejects unknown provider event fields', () => {
    const parsed = zulipRawEventSchema.safeParse({
      id: 1,
      type: 'heartbeat',
      credential: 'must-not-be-accepted'
    })
    assert.equal(parsed.success, false)
  })

  it('accepts bounded message envelope flags and remains strict', () => {
    const event = {
      id: 2,
      type: 'message',
      flags: ['read', 'mentioned'],
      message: {
        id: 500,
        type: 'stream',
        stream_id: 12,
        display_recipient: '研究协作',
        subject: '蛋白质结构',
        content: '继续同一个 Session',
        sender_id: 42,
        sender_email: 'human@example.invalid',
        sender_full_name: '研究员甲'
      }
    }
    assert.equal(zulipRawEventSchema.safeParse(event).success, true)
    assert.equal(zulipRawEventSchema.safeParse({ ...event, unexpected: true }).success, false)
    assert.equal(zulipRawEventSchema.safeParse({ ...event, flags: ['x'.repeat(129)] }).success, false)
  })

  it('keeps register and events response envelopes strict', () => {
    const register = {
      result: 'success',
      msg: '',
      queue_id: 'queue-zulip-12-2',
      last_event_id: -1,
      idle_queue_timeout_secs: 600,
      zulip_version: '12.2',
      zulip_feature_level: 481,
      zulip_merge_base: '12.2'
    }
    const events = {
      result: 'success',
      msg: '',
      queue_id: 'queue-zulip-12-2',
      events: [{ id: 0, type: 'heartbeat' }]
    }
    assert.equal(zulipRegisterResponseSchema.safeParse(register).success, true)
    assert.equal(zulipRegisterResponseSchema.safeParse({ ...register, unexpected: true }).success, false)
    assert.equal(zulipEventsResponseSchema.safeParse(events).success, true)
    assert.equal(zulipEventsResponseSchema.safeParse({ ...events, unexpected: true }).success, false)
  })

  it('accepts the bounded Zulip 12.2 own-bot shape and rejects unknown fields', () => {
    const ownBot = {
      result: 'success',
      msg: '',
      user_id: 99,
      email: 'service-bot@example.invalid',
      full_name: 'Service Bot',
      is_bot: true,
      is_imported_stub: false,
      bot_type: 1,
      bot_owner_id: 7,
      max_message_id: 500
    }
    assert.equal(zulipUserResponseSchema.safeParse(ownBot).success, true)
    assert.equal(zulipUserResponseSchema.safeParse({ ...ownBot, unexpected: true }).success, false)
    assert.equal(zulipUserResponseSchema.safeParse({ ...ownBot, bot_owner_id: null }).success, true)
    assert.equal(zulipUserResponseSchema.safeParse({ ...ownBot, bot_type: 5 }).success, false)
    assert.equal(zulipUserResponseSchema.safeParse({ ...ownBot, max_message_id: null }).success, false)
  })

  it('accepts the strict Zulip 12.2 subscription shape and bounds permission groups', () => {
    const subscription = {
      stream_id: 12,
      name: '研究协作',
      description: '用于研究协作',
      rendered_description: '<p>用于研究协作</p>',
      creator_id: 7,
      date_created: 1_786_752_000,
      folder_id: null,
      is_recently_active: true,
      in_home_view: true,
      is_muted: false,
      stream_weekly_traffic: null,
      subscriber_count: 2,
      topics_policy: 'inherit',
      can_add_subscribers_group: 1,
      can_administer_channel_group: {
        direct_members: [7],
        direct_subgroups: [3]
      },
      can_create_topic_group: 1,
      can_delete_any_message_group: 2,
      can_delete_own_message_group: 1,
      can_move_messages_out_of_channel_group: 2,
      can_move_messages_within_channel_group: 1,
      can_send_message_group: 1,
      can_remove_subscribers_group: 2,
      can_resolve_topics_group: 1,
      can_subscribe_group: 1
    }
    const response = { result: 'success', msg: '', subscriptions: [subscription] }
    assert.equal(zulipSubscriptionsResponseSchema.safeParse(response).success, true)
    assert.equal(zulipSubscriptionsResponseSchema.safeParse({
      ...response,
      subscriptions: [{ ...subscription, unexpected: true }]
    }).success, false)
    assert.equal(zulipSubscriptionsResponseSchema.safeParse({
      ...response,
      subscriptions: [{
        ...subscription,
        can_administer_channel_group: {
          direct_members: [7],
          direct_subgroups: [3],
          unexpected: true
        }
      }]
    }).success, false)
    assert.equal(zulipSubscriptionsResponseSchema.safeParse({
      ...response,
      subscriptions: [{ ...subscription, topics_policy: 'unknown' }]
    }).success, false)
  })

  it('strictly bounds update_message event fields and moved-message fanout', () => {
    const base = {
      id: 2,
      type: 'update_message',
      user_id: 42,
      rendering_only: false,
      message_id: 600,
      message_ids: [600],
      flags: [],
      edit_timestamp: 1_786_752_000,
      stream_name: '研究协作',
      stream_id: 12,
      propagate_mode: 'change_all',
      orig_subject: '旧主题',
      subject: '新主题'
    }
    assert.equal(zulipRawEventSchema.safeParse({ ...base, unexpected: true }).success, false)
    assert.equal(zulipRawEventSchema.safeParse({
      ...base,
      message_ids: Array.from({ length: 10_001 }, (_, index) => index + 1)
    }).success, false)
  })

  it('redacts credentials and bounds cyclic diagnostics', () => {
    const authorizationSentinel = Buffer.from(randomUUID()).toString('base64')
    const keySentinel = randomUUID()
    const bearerSentinel = randomUUID()
    const tokenSentinel = randomUUID()
    const cyclic: Record<string, unknown> = {
      authorization: `Basic ${authorizationSentinel}`,
      apiKey: keySentinel,
      message: `Bearer ${bearerSentinel} token=${tokenSentinel}`
    }
    cyclic.self = cyclic
    const redacted = JSON.stringify(redactZulipDiagnostic(cyclic))
    for (const sentinel of [authorizationSentinel, keySentinel, bearerSentinel, tokenSentinel]) {
      assert.equal(redacted.includes(sentinel), false)
    }
    assert.match(redacted, /REDACTED/)
    assert.match(redacted, /CIRCULAR/)
    assert.equal(redactZulipText(`password=${randomUUID()}`), 'password=[REDACTED]')
  })

  it('enforces a bounded per-sender rate limit', () => {
    let now = 100
    const limiter = new ZulipProviderRateLimiter({
      maxEvents: 2,
      windowMs: 1_000,
      now: () => now
    })
    limiter.consume('realm\u0000user')
    limiter.consume('realm\u0000user')
    assert.throws(
      () => limiter.consume('realm\u0000user'),
      (error) => error instanceof ZulipProviderError && error.code === 'rate_limited'
    )
    now = 1_101
    assert.doesNotThrow(() => limiter.consume('realm\u0000user'))
  })
})
