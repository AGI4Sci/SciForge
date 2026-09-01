import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { createZulipHumanEndpointProvider, formatZulipOutboundContent } from './adapter.js'
import type { ZulipDeliveryLedger, ZulipDeliveryRecord } from './delivery.js'
import { ZulipProviderError } from './errors.js'
import type { ZulipProviderDiagnostic } from './http-client.js'
import { createZulipLocator } from './locator.js'

const resolveLocator = async (coordinates: {
  provider: 'zulip'
  realmId: string
  containerId: string
  topicDisplayName: string
}) => createZulipLocator({
  realmId: coordinates.realmId,
  streamId: coordinates.containerId,
  streamName: '研究协作',
  topicName: coordinates.topicDisplayName,
  topicId: `stable-${coordinates.containerId}-${coordinates.topicDisplayName}`
})

const rejectIdentity = async () => ({
  protocolVersion: '1.0' as const,
  type: 'provider.identity.rejected' as const,
  reason: 'invalid' as const
})

class MemoryLedger implements ZulipDeliveryLedger {
  private readonly records = new Map<string, ZulipDeliveryRecord>()

  async get(idempotencyKey: string): Promise<ZulipDeliveryRecord | null> {
    return this.records.get(idempotencyKey) ?? null
  }

  async begin(record: ZulipDeliveryRecord): Promise<ZulipDeliveryRecord> {
    const result = this.records.get(record.idempotencyKey) ?? record
    this.records.set(record.idempotencyKey, result)
    return result
  }

  async update(record: ZulipDeliveryRecord): Promise<void> {
    this.records.set(record.idempotencyKey, record)
  }
}

it('renders provider-neutral collapsible progress as a Zulip spoiler without breaking inner code fences', () => {
  assert.equal(
    formatZulipOutboundContent('处理中', { disposition: 'collapsible', summary: '中间进展' }),
    '```spoiler 中间进展\n处理中\n```'
  )
  assert.equal(
    formatZulipOutboundContent('```ts\nconst ready = true\n```', {
      disposition: 'collapsible',
      summary: '中间进展'
    }),
    '````spoiler 中间进展\n```ts\nconst ready = true\n```\n````'
  )
})

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  })
}

function rawMessage(input: {
  id: number
  senderId: number
  senderEmail: string
  senderName: string
  content: string
  isMe?: boolean
  streamId?: number
  streamName?: string
  topic?: string
  messageType?: 'stream' | 'private'
}): Record<string, unknown> {
  const messageType = input.messageType ?? 'stream'
  return {
    id: input.id,
    type: messageType,
    ...(messageType === 'stream'
      ? {
          stream_id: input.streamId ?? 12,
          display_recipient: input.streamName ?? '研究协作',
          subject: input.topic ?? '蛋白质结构'
        }
      : {
          display_recipient: [{ id: input.senderId, email: input.senderEmail, full_name: input.senderName }]
        }),
    content: input.content,
    sender_id: input.senderId,
    sender_email: input.senderEmail,
    sender_full_name: input.senderName,
    is_me_message: input.isMe ?? false,
    timestamp: 1_786_752_000
  }
}

describe('ZulipHumanEndpointProvider', () => {
  it('provisions a private protected Channel with a separate least-privilege identity and creates no Topic', async () => {
    const mutations: Array<{ path: string; method: string; body: URLSearchParams }> = []
    let userLookup = 0
    let archived = false
    const fetch = async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const method = init?.method ?? 'GET'
      const body = init?.body instanceof URLSearchParams
        ? init.body
        : new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
      if (method !== 'GET') mutations.push({ path: url.pathname, method, body })
      if (url.pathname.endsWith('/api/v1/users/me')) {
        userLookup += 1
        return userLookup % 2 === 1
          ? json({ result: 'success', user_id: 7, email: 'provisioner@example.invalid',
              full_name: 'Provisioner', is_bot: false })
          : json({ result: 'success', user_id: 99, email: 'service-bot@example.invalid',
              full_name: 'Service Bot', is_bot: true, bot_owner_id: 7 })
      }
      if (url.pathname.endsWith('/api/v1/user_groups')) return json({
        result: 'success',
        user_groups: [
          { id: 1, name: 'role:everyone', is_system_group: true },
          { id: 2, name: 'role:nobody', is_system_group: true }
        ]
      })
      if (url.pathname.endsWith('/api/v1/get_stream_id')) {
        return json({
          result: 'error',
          msg: 'Invalid channel name',
          code: 'BAD_REQUEST'
        }, { status: 400 })
      }
      if (url.pathname.endsWith('/api/v1/channels/create')) return json({ result: 'success', id: 123 })
      if (url.pathname.endsWith('/api/v1/users/me/subscriptions') && method === 'DELETE') {
        return json({ result: 'success' })
      }
      if (url.pathname.endsWith('/api/v1/streams/123/members')) {
        return json({ result: 'success', subscribers: [42, 99] })
      }
      if (url.pathname.endsWith('/api/v1/streams/123') && method === 'DELETE') {
        archived = true
        return json({ result: 'success' })
      }
      if (url.pathname.endsWith('/api/v1/streams/123')) return json({
        result: 'success',
        stream: {
          stream_id: 123,
          name: 'sciforge-user123',
          description: 'SciForge managed private Channel.',
          invite_only: true,
          history_public_to_subscribers: false,
          is_archived: archived,
          topics_policy: 'disable_empty_topic',
          can_add_subscribers_group: { direct_members: [7], direct_subgroups: [] },
          can_administer_channel_group: { direct_members: [7], direct_subgroups: [] },
          can_create_topic_group: 1,
          can_send_message_group: { direct_members: [7, 42], direct_subgroups: [] },
          can_remove_subscribers_group: { direct_members: [7], direct_subgroups: [] },
          can_subscribe_group: 2
        }
      })
      throw new Error(`unexpected route: ${method} ${url.pathname}`)
    }
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://example.invalid/team-chat/',
      botEmail: 'service-bot@example.invalid',
      provisioningEmail: 'provisioner@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      resolveProvisioningCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch,
      now: () => new Date('2026-08-15T00:00:00.000Z')
    })
    assert.equal(provider.contract.capabilities.managedContainers, true)
    const result = await provider.manageContainer({
      protocolVersion: '1.0',
      type: 'provider.managed_container.ensure',
      realmId: 'https://example.invalid/team-chat',
      ownerIdentity: { type: 'provider_identity', provider: 'zulip',
        realmId: 'https://example.invalid/team-chat', providerUserId: '42' },
      stableKey: 'managed-owner-realm',
      displayName: 'sciforge-user123',
      policy: { version: 1, visibility: 'private', history: 'protected',
        membership: 'owner_and_message_bot', memberManagement: 'provisioning_service_only',
        channelManagement: 'provisioning_service_only', ownerCanSend: true,
        ownerCanCreateTopics: true, messageBotCanSend: true, messageBotCreatesProjectTopics: false }
    })
    assert.equal(result.status, 'active')
    assert.deepEqual(result.safeIssueCodes, [])
    const create = mutations.find((entry) => entry.path.endsWith('/api/v1/channels/create'))
    assert.ok(create)
    assert.equal(create.body.get('invite_only'), 'true')
    assert.equal(create.body.get('history_public_to_subscribers'), 'false')
    assert.equal(create.body.has('topics_policy'), false)
    assert.deepEqual(JSON.parse(create.body.get('subscribers')!), [42, 99])
    assert.equal(mutations.some((entry) => entry.path.endsWith('/api/v1/messages')), false)
    const archivedResult = await provider.manageContainer!({
      protocolVersion: '1.0', type: 'provider.managed_container.archive',
      realmId: 'https://example.invalid/team-chat',
      ownerIdentity: { type: 'provider_identity', provider: 'zulip',
        realmId: 'https://example.invalid/team-chat', providerUserId: '42' },
      container: { type: 'provider_managed_container_ref', provider: 'zulip',
        realmId: 'https://example.invalid/team-chat', containerId: '123' },
      policy: { version: 1, visibility: 'private', history: 'protected',
        membership: 'owner_and_message_bot', memberManagement: 'provisioning_service_only',
        channelManagement: 'provisioning_service_only', ownerCanSend: true,
        ownerCanCreateTopics: true, messageBotCanSend: true, messageBotCreatesProjectTopics: false }
    })
    assert.equal(archivedResult.status, 'archived')
    const archiveIndex = mutations.findIndex((entry) => (
      entry.path.endsWith('/api/v1/streams/123') && entry.method === 'DELETE'
    ))
    const unsubscribeIndex = mutations.findIndex((entry) => (
      entry.path.endsWith('/api/v1/users/me/subscriptions') && entry.method === 'DELETE'
    ))
    assert.ok(archiveIndex >= 0)
    assert.ok(unsubscribeIndex > archiveIndex)
    assert.equal(mutations.some((entry) => entry.method === 'PATCH' && entry.body.has('is_archived')), false)
  })
  it('accepts Zulip 12.2 compatibility metadata while registering a replacement event queue', async () => {
    const seenPaths: string[] = []
    const diagnostics: ZulipProviderDiagnostic[] = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://example.invalid/team-chat/',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      logger: (diagnostic) => { diagnostics.push(diagnostic) },
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      fetch: async (input) => {
        const url = new URL(input)
        seenPaths.push(url.pathname)
        if (url.pathname === '/team-chat/api/v1/register') {
          return json({
            result: 'success',
            msg: '',
            queue_id: 'queue-zulip-12-2',
            last_event_id: -1,
            idle_queue_timeout_secs: 600,
            zulip_version: '12.2',
            zulip_feature_level: 481,
            zulip_merge_base: '12.2',
            ignored_parameters_unsupported: ['fetch_event_types']
          })
        }
        if (url.pathname === '/team-chat/api/v1/events') {
          return json({
            result: 'success',
            msg: '',
            queue_id: 'queue-zulip-12-2',
            ignored_parameters_unsupported: ['dont_block'],
            events: [{ id: 0, type: 'heartbeat' }]
          })
        }
        throw new Error(`unexpected route: ${url.pathname}`)
      }
    })

    const registered = await provider.registerEventQueue()
    assert.deepEqual(registered, {
      cursor: {
        queueId: 'queue-zulip-12-2',
        lastEventId: -1,
        registeredAt: '2026-08-15T00:00:00.000Z'
      },
      events: []
    })
    const polled = await provider.pollEvents(registered.cursor, { timeoutSeconds: 1 })
    assert.deepEqual(polled, {
      cursor: {
        queueId: 'queue-zulip-12-2',
        lastEventId: 0,
        registeredAt: '2026-08-15T00:00:00.000Z'
      },
      events: []
    })
    assert.deepEqual(seenPaths, [
      '/team-chat/api/v1/register',
      '/team-chat/api/v1/events'
    ])
    assert.deepEqual(diagnostics, [{
      level: 'info',
      code: 'zulip.events.queue_connected',
      message: 'Zulip event queue connected.'
    }])
  })

  it('authenticates through a realm subpath and maps strict inbound events while filtering self echoes', async () => {
    const urls: string[] = []
    let registerCount = 0
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://example.invalid/team-chat/',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      fetch: async (input, init) => {
        const url = new URL(input)
        urls.push(url.toString())
        if (url.pathname === '/team-chat/api/v1/users/me') {
          return json({
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
          })
        }
        if (url.pathname === '/team-chat/api/v1/register') {
          const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams()
          assert.deepEqual(JSON.parse(body.get('event_types') ?? '[]'), ['message', 'update_message', 'reaction'])
          registerCount += 1
          return json({
            result: 'success',
            msg: '',
            queue_id: `queue-${registerCount}`,
            last_event_id: 10,
            events: [
              {
                id: 11,
                type: 'message',
                flags: ['read'],
                message: rawMessage({
                  id: 500,
                  senderId: 42,
                  senderEmail: 'human@example.invalid',
                  senderName: '研究员甲',
                  content: '继续同一个 Session'
                })
              },
              { id: 12, type: 'message', message: rawMessage({
                id: 501,
                senderId: 99,
                senderEmail: 'service-bot@example.invalid',
                senderName: 'Service Bot',
                content: 'bot echo',
                isMe: true
              }) }
            ]
          })
        }
        throw new Error(`unexpected route: ${url.pathname}`)
      }
    })

    const identity = await provider.authenticate()
    assert.deepEqual(identity, {
      provider: 'zulip',
      realmId: 'https://example.invalid/team-chat',
      providerUserId: '99',
      botEmail: 'service-bot@example.invalid',
      displayName: 'Service Bot'
    })
    const first = await provider.registerEventQueue()
    assert.equal(first.events.length, 1)
    const realmHash = createHash('sha256')
      .update('https://example.invalid/team-chat', 'utf8')
      .digest('hex')
      .slice(0, 24)
    assert.deepEqual(first.events[0], {
      protocolVersion: '1.0',
      provider: 'zulip',
      type: 'provider.message.created',
      eventId: `zulip:${realmHash}:message:500`,
      eventCursor: Buffer.from(JSON.stringify({
        queueId: 'queue-1',
        lastEventId: 11,
        registeredAt: '2026-08-15T00:00:00.000Z'
      }), 'utf8').toString('base64url'),
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity',
        provider: 'zulip',
        realmId: 'https://example.invalid/team-chat',
        providerUserId: '42',
        displayName: '研究员甲'
      },
      locator: {
        type: 'provider_locator',
        provider: 'zulip',
        realmId: 'https://example.invalid/team-chat',
        containerId: '12',
        topicId: 'stable-12-蛋白质结构',
        containerDisplayName: '研究协作',
        topicDisplayName: '蛋白质结构'
      },
      providerMessageId: '500',
      text: '继续同一个 Session',
      isSelfEcho: false
    })
    const repeated = await provider.registerEventQueue()
    assert.equal(repeated.events.length, 1)
    assert.equal(repeated.events[0]?.eventId, first.events[0]?.eventId)
    assert.ok(urls.every((url) => url.startsWith('https://example.invalid/team-chat/api/')))
  })

  it('authenticates the event lifecycle before filtering self echoes by stable sender id', async () => {
    const paths: string[] = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async (input) => {
        const pathname = new URL(input).pathname
        paths.push(pathname)
        if (pathname === '/api/v1/users/me') {
          return json({
            result: 'success',
            msg: '',
            user_id: 99,
            email: 'service-bot@example.invalid',
            full_name: 'Service Bot',
            is_bot: true
          })
        }
        if (pathname === '/api/v1/register') {
          return json({
            result: 'success',
            msg: '',
            queue_id: 'queue-lifecycle',
            last_event_id: 10,
            events: [
              { id: 11, type: 'message', message: rawMessage({
                id: 510,
                senderId: 99,
                senderEmail: 'different-address@example.invalid',
                senderName: 'Service Bot',
                content: 'must be filtered by id'
              }) },
              { id: 12, type: 'message', message: rawMessage({
                id: 511,
                senderId: 42,
                senderEmail: 'human@example.invalid',
                senderName: '研究员甲',
                content: '人类消息'
              }) }
            ]
          })
        }
        throw new Error(`Unexpected fake Zulip path: ${pathname}`)
      }
    })
    const iterator = provider.events({
      protocolVersion: '1.0',
      type: 'provider.lifecycle.start'
    })[Symbol.asyncIterator]()

    const first = await iterator.next()
    assert.equal(first.value?.type, 'provider.message.created')
    assert.equal(first.value?.providerMessageId, '511')
    assert.deepEqual(paths.slice(0, 2), ['/api/v1/users/me', '/api/v1/register'])
    await provider.lifecycle({ protocolVersion: '1.0', type: 'provider.lifecycle.stop' })
    assert.equal((await iterator.next()).done, true)
  })

  it('sends, renames, and moves a Chinese topic without changing its stable topic identity', async () => {
    const requests: Array<{ path: string; method: string; body: URLSearchParams }> = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async (input, init) => {
        const url = new URL(input)
        const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams()
        requests.push({ path: url.pathname, method: init?.method ?? 'GET', body })
        if (url.pathname === '/api/v1/messages' && init?.method === 'POST') {
          return json({ result: 'success', msg: '', id: 700 })
        }
        if (url.pathname === '/api/v1/messages/600' && init?.method === 'PATCH') {
          return json({ result: 'success', msg: '' })
        }
        throw new Error(`unexpected route: ${url.pathname}`)
      }
    })
    const locator = createZulipLocator({
      realmId: provider.realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '原始主题',
      topicId: 'stable-topic-id'
    })

    const sent = await provider.sendMessage({
      locator,
      content: '桌面发出的消息',
      idempotencyKey: 'outbound-1'
    })
    assert.equal(sent.remoteMessageId, '700')
    const renamed = await provider.renameTopic({
      locator,
      anchorMessageId: '600',
      newTopicName: '重命名主题'
    })
    const moved = await provider.moveTopic({
      locator: renamed,
      anchorMessageId: '600',
      newStreamId: '13',
      newStreamName: '新协作流',
      newTopicName: '移动后主题'
    })
    assert.equal(renamed.topicId, locator.topicId)
    assert.equal(moved.topicId, locator.topicId)
    assert.equal(moved.containerId, '13')
    assert.equal(moved.topicDisplayName, '移动后主题')
    assert.equal(requests[0]?.body.get('topic'), '原始主题')
    assert.equal(requests[1]?.body.get('topic'), '重命名主题')
    assert.equal(requests[1]?.body.get('propagate_mode'), 'change_all')
    assert.equal(requests[2]?.body.get('stream_id'), '13')
    assert.equal(requests[2]?.body.get('topic'), '移动后主题')
  })

  it('keeps an unbound Chinese topic discovery locator stable as new messages arrive', async () => {
    let latestMessageId = 100
    const requestedPaths: string[] = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid/team',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async () => {
        throw new ZulipProviderError('locator_missing', 'not bound yet')
      },
      verifyIdentity: rejectIdentity,
      fetch: async (input) => {
        const pathname = new URL(input).pathname
        requestedPaths.push(pathname)
        if (pathname === '/team/api/v1/users/me/subscriptions') {
          return json({
            result: 'success',
            msg: '',
            subscriptions: [{
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
            }]
          })
        }
        if (pathname === '/team/api/v1/users/me/12/topics') {
          return json({
            result: 'success',
            msg: '',
            topics: [{ name: '蛋白质结构', max_id: latestMessageId }]
          })
        }
        throw new Error(`Unexpected fake Zulip path: ${pathname}`)
      }
    })
    const request = {
      protocolVersion: '1.0' as const,
      type: 'provider.locator.list' as const,
      realmId: provider.realmId,
      container: {
        type: 'provider_managed_container_ref' as const,
        provider: 'zulip',
        realmId: provider.realmId,
        containerId: '12'
      },
      containerDisplayName: '研究协作',
      limit: 50
    }

    const before = await provider.listLocators(request)
    latestMessageId = 200
    const after = await provider.listLocators(request)

    assert.equal(before.locators.length, 1)
    assert.equal(after.locators.length, 1)
    assert.equal(before.locators[0]?.topicId, after.locators[0]?.topicId)
    assert.equal(before.locators[0]?.topicDisplayName, '蛋白质结构')
    assert.equal(requestedPaths.includes('/team/api/v1/users/me/subscriptions'), false)
    assert.deepEqual(requestedPaths, [
      '/team/api/v1/users/me/12/topics',
      '/team/api/v1/users/me/12/topics'
    ])
  })

  it('discovers Topics only from native private Channels containing the verified user and Bot', async () => {
    const requested: string[] = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://example.invalid/team/',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async (input) => {
        const url = new URL(input)
        requested.push(`${url.pathname}?${url.searchParams.toString()}`)
        if (url.pathname.endsWith('/api/v1/users/me')) return json({
          result: 'success', user_id: 99, email: 'service-bot@example.invalid',
          full_name: 'Service Bot', is_bot: true
        })
        if (url.pathname.endsWith('/api/v1/users/me/subscriptions')) return json({
          result: 'success', subscriptions: [
            { stream_id: 12, name: '电脑 A', invite_only: true, is_web_public: false, subscribers: [42, 99] },
            { stream_id: 13, name: '公开 Channel', invite_only: false, is_web_public: true, subscribers: [42, 99] },
            { stream_id: 14, name: '缺少 Bot', invite_only: true, is_web_public: false, subscribers: [42] },
            { stream_id: 15, name: '成员未知', invite_only: true, is_web_public: false }
          ]
        })
        if (url.pathname.endsWith('/api/v1/users/me/12/topics')) return json({
          result: 'success', topics: [{ name: '实验 Topic', max_id: 100 }]
        })
        throw new Error(`unexpected route: ${url.pathname}`)
      }
    })

    const page = await provider.listLocators({
      protocolVersion: '1.0', type: 'provider.locator.list', realmId: provider.realmId,
      ownerIdentity: { type: 'provider_identity', provider: 'zulip', realmId: provider.realmId,
        providerUserId: '42' },
      limit: 50
    })

    assert.deepEqual(page.locators.map((locator) => ({
      containerId: locator.containerId,
      containerDisplayName: locator.containerDisplayName,
      topicDisplayName: locator.topicDisplayName
    })), [{ containerId: '12', containerDisplayName: '电脑 A', topicDisplayName: '实验 Topic' }])
    assert.equal(requested.some((path) => path.includes('include_subscribers=true')), true)
    assert.equal(requested.some((path) => path.includes('/13/topics')), false)
    assert.equal(requested.some((path) => path.includes('/14/topics')), false)
    assert.equal(requested.some((path) => path.includes('/15/topics')), false)
  })

  it('keeps one stable topic identity across a real-shape external rename, move, and following message', async () => {
    const original = createZulipLocator({
      realmId: 'https://chat.example.invalid',
      streamId: '12',
      streamName: '研究协作',
      topicName: '蛋白质结构',
      topicId: 'stable-projection-topic'
    })
    const otherTopic = createZulipLocator({
      realmId: original.realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '另一个中文主题',
      topicId: 'stable-other-topic'
    })
    const provider = createZulipHumanEndpointProvider({
      realmUrl: original.realmId,
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async (coordinates) => {
        if (coordinates.containerId === '12' && coordinates.topicDisplayName === '蛋白质结构') {
          return original
        }
        if (coordinates.containerId === '12' && coordinates.topicDisplayName === '另一个中文主题') {
          return otherTopic
        }
        throw new ZulipProviderError('locator_missing', 'not bound')
      },
      verifyIdentity: rejectIdentity,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      fetch: async (input) => {
        const pathname = new URL(input).pathname
        if (pathname === '/api/v1/users/me/subscriptions') {
          return json({
            result: 'success',
            msg: '',
            subscriptions: [
              { stream_id: 12, name: '研究协作' },
              { stream_id: 13, name: '第二协作流' }
            ]
          })
        }
        if (pathname === '/api/v1/register') {
          return json({
            result: 'success',
            msg: '',
            queue_id: 'queue-external-relocation',
            last_event_id: 20,
            events: [
              {
                id: 21,
                type: 'update_message',
                user_id: 42,
                rendering_only: false,
                message_id: 600,
                message_ids: [600, 601],
                flags: [],
                edit_timestamp: 1_786_752_001,
                stream_name: '研究协作',
                stream_id: 12,
                propagate_mode: 'change_all',
                orig_subject: '蛋白质结构',
                subject: '蛋白质结构-已重命名',
                topic_links: []
              },
              {
                id: 22,
                type: 'update_message',
                user_id: 42,
                rendering_only: false,
                message_id: 600,
                message_ids: [600, 601],
                flags: [],
                edit_timestamp: 1_786_752_002,
                stream_name: '研究协作',
                stream_id: 12,
                new_stream_id: 13,
                propagate_mode: 'change_all',
                orig_subject: '蛋白质结构-已重命名'
              },
              {
                id: 23,
                type: 'message',
                message: rawMessage({
                  id: 602,
                  senderId: 42,
                  senderEmail: 'human@example.invalid',
                  senderName: '研究员甲',
                  content: '移动后继续同一个 Session',
                  streamId: 13,
                  streamName: '第二协作流',
                  topic: '蛋白质结构-已重命名'
                })
              }
            ]
          })
        }
        throw new Error(`Unexpected fake Zulip path: ${pathname}`)
      }
    })

    const result = await provider.registerEventQueue()

    assert.equal(result.events.length, 3)
    const renamed = result.events[0]
    const moved = result.events[1]
    const followingMessage = result.events[2]
    assert.equal(renamed?.type, 'provider.locator.changed')
    assert.equal(moved?.type, 'provider.locator.changed')
    assert.equal(followingMessage?.type, 'provider.message.created')
    if (renamed?.type !== 'provider.locator.changed' || moved?.type !== 'provider.locator.changed' ||
      followingMessage?.type !== 'provider.message.created') assert.fail('unexpected canonical event types')
    assert.equal(renamed.previousLocator.topicId, original.topicId)
    assert.equal(renamed.currentLocator.topicId, original.topicId)
    assert.equal(renamed.currentLocator.topicDisplayName, '蛋白质结构-已重命名')
    assert.equal(moved.previousLocator.topicId, original.topicId)
    assert.equal(moved.currentLocator.topicId, original.topicId)
    assert.equal(moved.currentLocator.containerId, '13')
    assert.equal(moved.currentLocator.containerDisplayName, '第二协作流')
    assert.equal(followingMessage.locator.topicId, original.topicId)
    assert.notEqual(followingMessage.locator.topicId, otherTopic.topicId)
  })

  it('fails closed when an external rename would collide with a second Chinese topic binding', async () => {
    const realmId = 'https://chat.example.invalid'
    const first = createZulipLocator({
      realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '主题甲',
      topicId: 'stable-topic-a'
    })
    const second = createZulipLocator({
      realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '主题乙',
      topicId: 'stable-topic-b'
    })
    const provider = createZulipHumanEndpointProvider({
      realmUrl: realmId,
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async (coordinates) => {
        if (coordinates.topicDisplayName === '主题甲') return first
        if (coordinates.topicDisplayName === '主题乙') return second
        throw new ZulipProviderError('locator_missing', 'not bound')
      },
      verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-collision',
        last_event_id: 30,
        events: [{
          id: 31,
          type: 'update_message',
          user_id: 42,
          rendering_only: false,
          message_id: 700,
          message_ids: [700],
          flags: [],
          edit_timestamp: 1_786_752_003,
          stream_name: '研究协作',
          stream_id: 12,
          propagate_mode: 'change_all',
          orig_subject: '主题甲',
          subject: '主题乙'
        }]
      })
    })

    await assert.rejects(
      provider.registerEventQueue(),
      (error) => error instanceof ZulipProviderError && error.code === 'locator_ambiguous'
    )
  })

  it('reconstructs the same locator event after the durable binding already moved', async () => {
    const realmId = 'https://chat.example.invalid'
    const previous = createZulipLocator({
      realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '重启前主题',
      topicId: 'stable-restart-topic'
    })
    const current = { ...previous, topicDisplayName: '重启后主题' }
    let bindingMoved = false
    let registerCount = 0
    const provider = createZulipHumanEndpointProvider({
      realmUrl: realmId,
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async (coordinates) => {
        if (!bindingMoved && coordinates.topicDisplayName === previous.topicDisplayName) return previous
        if (bindingMoved && coordinates.topicDisplayName === current.topicDisplayName) return current
        throw new ZulipProviderError('locator_missing', 'not current')
      },
      verifyIdentity: rejectIdentity,
      fetch: async () => {
        registerCount += 1
        return json({
          result: 'success',
          msg: '',
          queue_id: `queue-replayed-relocation-${registerCount}`,
          last_event_id: 60,
          events: [{
            id: 61,
            type: 'update_message',
            user_id: 42,
            rendering_only: false,
            message_id: 1_000,
            message_ids: [1_000],
            flags: [],
            edit_timestamp: 1_786_752_007,
            stream_name: '研究协作',
            stream_id: 12,
            propagate_mode: 'change_all',
            orig_subject: previous.topicDisplayName,
            subject: current.topicDisplayName
          }]
        })
      }
    })

    const beforeCommit = await provider.registerEventQueue()
    bindingMoved = true
    const afterRestart = await provider.registerEventQueue()

    assert.equal(beforeCommit.events.length, 1)
    assert.equal(afterRestart.events.length, 1)
    assert.deepEqual(afterRestart.events[0], {
      ...beforeCommit.events[0],
      eventCursor: afterRestart.events[0]?.eventCursor
    })
  })

  it('ignores rendering, content-only, and partial update_message events without touching bindings', async () => {
    let resolverCalls = 0
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async () => {
        resolverCalls += 1
        throw new ZulipProviderError('locator_missing', 'must not be queried')
      },
      verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-ignored-updates',
        last_event_id: 40,
        events: [
          {
            id: 41,
            type: 'update_message',
            user_id: null,
            rendering_only: true,
            message_id: 800,
            message_ids: [800],
            flags: [],
            edit_timestamp: 1_786_752_004,
            stream_name: '研究协作',
            stream_id: 12,
            content: '渲染更新',
            rendered_content: '<p>渲染更新</p>'
          },
          {
            id: 42,
            type: 'update_message',
            user_id: 42,
            rendering_only: false,
            message_id: 801,
            message_ids: [801],
            flags: [],
            edit_timestamp: 1_786_752_004,
            stream_name: '研究协作',
            stream_id: 12,
            orig_content: '旧内容',
            content: '新内容'
          },
          {
            id: 43,
            type: 'update_message',
            user_id: 42,
            rendering_only: false,
            message_id: 802,
            message_ids: [802],
            flags: [],
            edit_timestamp: 1_786_752_005,
            stream_name: '研究协作',
            stream_id: 12,
            propagate_mode: 'change_later',
            orig_subject: '部分移动前',
            subject: '部分移动后'
          }
        ]
      })
    })

    const result = await provider.registerEventQueue()

    assert.equal(result.events.length, 0)
    assert.equal(result.cursor.lastEventId, 43)
    assert.equal(resolverCalls, 0)
  })

  it('fails closed when neither side of an external location update has a stable binding', async () => {
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async () => {
        throw new ZulipProviderError('locator_missing', 'not bound')
      },
      verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-unconfirmed-relocation',
        last_event_id: 50,
        events: [{
          id: 51,
          type: 'update_message',
          user_id: 42,
          rendering_only: false,
          message_id: 900,
          message_ids: [900],
          flags: [],
          edit_timestamp: 1_786_752_006,
          stream_name: '研究协作',
          stream_id: 12,
          propagate_mode: 'change_all',
          orig_subject: '未绑定旧主题',
          subject: '未绑定新主题'
        }]
      })
    })

    await assert.rejects(
      provider.registerEventQueue(),
      (error) => error instanceof ZulipProviderError && error.code === 'locator_missing'
    )
  })

  it('maps private /bind commands to the authenticated sender without locator resolution', async () => {
    let resolverCalls = 0
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async () => {
        resolverCalls += 1
        throw new ZulipProviderError('locator_missing', 'not paired yet')
      },
      verifyIdentity: rejectIdentity,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-private-bind',
        last_event_id: 1,
        events: [
          {
            id: 2,
            type: 'message',
            message: rawMessage({
              id: 810,
              senderId: 42,
              senderEmail: 'human@example.invalid',
              senderName: '研究员甲',
              content: '帮我做任务',
              messageType: 'private'
            })
          },
          {
            id: 3,
            type: 'message',
            message: rawMessage({
              id: 811,
              senderId: 42,
              senderEmail: 'human@example.invalid',
              senderName: '研究员甲',
              content: `/bind SF1.${'a'.repeat(32)}.Abc_123-xYz0`,
              messageType: 'private'
            })
          },
          {
            id: 4,
            type: 'message',
            message: rawMessage({
              id: 812,
              senderId: 42,
              senderEmail: 'human@example.invalid',
              senderName: '研究员甲',
              content: '/bind malformed-code',
              messageType: 'private'
            })
          }
        ]
      })
    })

    const result = await provider.registerEventQueue()

    assert.equal(resolverCalls, 0)
    assert.equal(result.events.length, 2)
    assert.deepEqual(result.events[0], {
      protocolVersion: '1.0',
      provider: 'zulip',
      type: 'provider.challenge.responded',
      eventId: result.events[0]?.eventId,
      eventCursor: result.events[0]?.eventCursor,
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity',
        provider: 'zulip',
        realmId: provider.realmId,
        providerUserId: '42',
        displayName: '研究员甲'
      },
      challengeId: `chl_${'a'.repeat(32)}`,
      challengeResponse: 'Abc_123-xYz0'
    })
    assert.deepEqual(result.events[1], {
      protocolVersion: '1.0',
      provider: 'zulip',
      type: 'provider.challenge.invalid',
      eventId: result.events[1]?.eventId,
      eventCursor: result.events[1]?.eventCursor,
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity',
        provider: 'zulip',
        realmId: provider.realmId,
        providerUserId: '42',
        displayName: '研究员甲'
      }
    })
  })

  it('sends a provider-neutral direct recipient as a Zulip private message', async () => {
    const requests: URLSearchParams[] = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async (_input, init) => {
        requests.push(init?.body instanceof URLSearchParams ? init.body : new URLSearchParams())
        return json({ result: 'success', msg: '', id: 701 })
      }
    })
    const request = {
      protocolVersion: '1.0' as const,
      type: 'provider.send.message' as const,
      recipient: {
        type: 'provider_direct_recipient' as const,
        provider: 'zulip',
        realmId: provider.realmId,
        providerUserId: '42'
      },
      clientMessageId: 'direct-message-1',
      text: '绑定成功'
    }

    const first = await provider.send(request)
    const duplicate = await provider.send(request)
    const wrongRealm = await provider.send({
      ...request,
      recipient: { ...request.recipient, realmId: 'another-realm' },
      clientMessageId: 'direct-message-wrong-realm'
    })

    assert.equal(first.type, 'provider.send.succeeded')
    assert.equal(duplicate.type, 'provider.send.succeeded')
    assert.equal(wrongRealm.type, 'provider.send.failed')
    if (wrongRealm.type !== 'provider.send.failed') throw new Error('Expected a failed direct send result.')
    assert.equal(wrongRealm.retryable, false)
    assert.equal(wrongRealm.providerErrorCode, 'invalid_locator')
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.get('type'), 'direct')
    assert.equal(requests[0]?.get('to'), '[42]')
    assert.equal(requests[0]?.get('topic'), null)
  })

  it('emits only a non-authoritative HumanAnswer candidate and keeps malformed text ordinary', async () => {
    const messages = [
      'sciforge-answer hrq_abcdefghijkl 3 继续执行\n优先处理样本甲',
      'SCIFORGE-ANSWER hrq_abcdefghijkl 1 不应识别',
      'sciforge-answer hrq_abcdefghijkl 0 修订号无效',
      'sciforge-answer hrq_short 1 请求 ID 无效'
    ]
    const ordinaryProvider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-ordinary-topic-messages',
        last_event_id: 80,
        events: messages.map((content, index) => ({
          id: 81 + index,
          type: 'message',
          message: rawMessage({
            id: 1_200 + index,
            senderId: 42,
            senderEmail: 'human@example.invalid',
            senderName: '研究员甲',
            content
          })
        }))
      })
    })
    const ordinary = await ordinaryProvider.registerEventQueue()
    assert.equal(ordinary.events.length, messages.length)
    const candidate = ordinary.events[0]
    assert.equal(candidate?.type, 'provider.human_answer.candidate')
    if (candidate?.type !== 'provider.human_answer.candidate') assert.fail('expected HumanAnswer candidate')
    assert.deepEqual({
      identity: candidate.identity,
      locator: candidate.locator,
      providerMessageId: candidate.providerMessageId,
      humanRequestId: candidate.humanRequestId,
      requestRevision: candidate.requestRevision,
      answer: candidate.answer
    }, {
      identity: { type: 'provider_identity', provider: 'zulip', realmId: ordinaryProvider.realmId,
        providerUserId: '42', displayName: '研究员甲' },
      locator: await resolveLocator({ provider: 'zulip', realmId: ordinaryProvider.realmId,
        containerId: '12', topicDisplayName: '蛋白质结构' }),
      providerMessageId: '1200', humanRequestId: 'hrq_abcdefghijkl', requestRevision: 3,
      answer: '继续执行\n优先处理样本甲'
    })
    assert.deepEqual(ordinary.events.slice(1).map((event) => (
      event.type === 'provider.message.created' ? event.text : undefined
    )), messages.slice(1))
  })

  it('updates only the referenced Zulip Bot message through the provider-neutral update contract', async () => {
    const requests: Array<{ path: string; method: string; body: URLSearchParams }> = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url).pathname,
          method: init?.method ?? 'GET',
          body: new URLSearchParams(String(init?.body ?? ''))
        })
        return json({ result: 'success', msg: '' })
      }
    })
    const result = await provider.updateMessage({
      protocolVersion: '1.0',
      type: 'provider.update.message',
      locator: {
        type: 'provider_locator',
        provider: 'zulip',
        realmId: provider.realmId,
        containerId: '12',
        topicId: 'stable-12-蛋白质结构',
        topicDisplayName: '蛋白质结构'
      },
      providerMessageId: '31415',
      clientMessageId: 'approval-card-update-fixture',
      text: '本次权限审批已处理。'
    })
    assert.equal(result.type, 'provider.send.succeeded')
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.path.endsWith('/api/v1/messages/31415'), true)
    assert.equal(requests[0]?.method, 'PATCH')
    assert.equal(requests[0]?.body.get('content'), '本次权限审批已处理。')
  })

  it('ensures both provider-neutral approval actions with stable Zulip unicode emoji codes', async () => {
    const requests: Array<{ path: string; method: string; body: URLSearchParams }> = []
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid', botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }), deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }), resolveLocator, verifyIdentity: rejectIdentity,
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url).pathname,
          method: init?.method ?? 'GET',
          body: new URLSearchParams(String(init?.body ?? ''))
        })
        return json({ result: 'success', msg: '' })
      }
    })
    const locator = {
      type: 'provider_locator' as const, provider: 'zulip' as const, realmId: provider.realmId,
      containerId: '12', topicId: 'topic-approval', topicDisplayName: '审批'
    }
    for (const action of ['allow_once', 'deny_once'] as const) {
      const result = await provider.send({
        protocolVersion: '1.0', type: 'provider.ensure.message_action', locator,
        providerMessageId: '31415', clientMessageId: `ensure-${action}`, action
      })
      assert.equal(result.type, 'provider.send.succeeded')
    }
    assert.deepEqual(requests.map((request) => request.path), [
      '/api/v1/messages/31415/reactions', '/api/v1/messages/31415/reactions'
    ])
    assert.ok(requests.every((request) => request.method === 'POST'))
    assert.deepEqual(requests.map((request) => request.body.get('emoji_code')), ['1f44d', '1f44e'])
    assert.deepEqual(requests.map((request) => request.body.get('emoji_name')), ['+1', '-1'])
    assert.ok(requests.every((request) => request.body.get('reaction_type') === 'unicode_emoji'))
  })

  it('treats REACTION_ALREADY_EXISTS as idempotent action success', async () => {
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid', botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }), deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }), resolveLocator, verifyIdentity: rejectIdentity,
      fetch: async () => json(
        { result: 'error', msg: 'Reaction already exists', code: 'REACTION_ALREADY_EXISTS' },
        { status: 400 }
      )
    })
    const result = await provider.send({
      protocolVersion: '1.0', type: 'provider.ensure.message_action',
      locator: {
        type: 'provider_locator', provider: 'zulip', realmId: provider.realmId,
        containerId: '12', topicId: 'topic-approval', topicDisplayName: '审批'
      },
      providerMessageId: '31415', clientMessageId: 'ensure-existing', action: 'allow_once'
    })
    assert.equal(result.type, 'provider.send.succeeded')
  })

  it('normalizes only owner-added stable unicode approval reactions', async () => {
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator,
      verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-remote-approval',
        last_event_id: 200,
        events: [
          { id: 201, type: 'reaction', op: 'add', message_id: 2_000, user_id: 42,
            emoji_name: '+1', emoji_code: '1f44d', reaction_type: 'unicode_emoji' },
          { id: 202, type: 'reaction', op: 'add', message_id: 2_001, user_id: 42,
            emoji_name: '-1', emoji_code: '1f44e', reaction_type: 'unicode_emoji' },
          { id: 203, type: 'reaction', op: 'remove', message_id: 2_000, user_id: 42,
            emoji_name: '+1', emoji_code: '1f44d', reaction_type: 'unicode_emoji' },
          { id: 204, type: 'reaction', op: 'add', message_id: 2_000, user_id: 42,
            emoji_name: 'wave', emoji_code: '1f44b', reaction_type: 'unicode_emoji' },
          { id: 205, type: 'reaction', op: 'add', message_id: 2_000, user_id: 42,
            emoji_name: '+1', emoji_code: '1f44d', reaction_type: 'realm_emoji' },
          { id: 9_999, type: 'reaction', op: 'add', message_id: 2_000, user_id: 42,
            emoji_name: '+1', emoji_code: '1f44d', reaction_type: 'unicode_emoji' }
        ]
      })
    })

    const result = await provider.registerEventQueue()
    assert.equal(result.events.length, 3)
    assert.equal(result.events[0]?.type, 'provider.message.action')
    assert.equal(result.events[1]?.type, 'provider.message.action')
    if (result.events[0]?.type !== 'provider.message.action') assert.fail('expected action')
    if (result.events[1]?.type !== 'provider.message.action') assert.fail('expected action')
    assert.equal(result.events[0].action, 'allow_once')
    assert.equal(result.events[1].action, 'deny_once')
    assert.equal(result.events[0].providerMessageId, '2000')
    assert.equal(result.events[0].identity.providerUserId, '42')
    assert.equal(result.events[2]?.eventId, result.events[0].eventId)
  })

  it('ignores the Generic Bot own pre-seeded reactions', async () => {
    let request = 0
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid', botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(), reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator, verifyIdentity: rejectIdentity,
      fetch: async () => {
        request += 1
        if (request === 1) return json({
          result: 'success', msg: '', user_id: 99, email: 'service-bot@example.invalid',
          full_name: 'SciForge Bot', is_bot: true
        })
        return json({
          result: 'success', msg: '', queue_id: 'queue-bot-reaction', last_event_id: 2,
          events: [{ id: 2, type: 'reaction', op: 'add', message_id: 2_000, user_id: 99,
            emoji_name: '+1', emoji_code: '1f44d', reaction_type: 'unicode_emoji' }]
        })
      }
    })
    await provider.authenticate()
    const result = await provider.registerEventQueue()
    assert.equal(result.events.length, 0)
  })

  it('treats legacy AP1-shaped stream text as ordinary content, never an approval', async () => {
    const fixtureReference = `AP1-${'B'.repeat(20)}`
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid', botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }), deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }), resolveLocator, verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success', msg: '', queue_id: 'queue-legacy-command', last_event_id: 300,
        events: [{ id: 301, type: 'message', message: rawMessage({
          id: 3_000, senderId: 42, senderEmail: 'human@example.invalid', senderName: '研究员甲',
          content: `1 ${fixtureReference}`
        }) }]
      })
    })
    const result = await provider.registerEventQueue()
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0]?.type, 'provider.message.created')
  })

  it('never treats an approval-shaped private message as a remote approval', async () => {
    const fixtureReference = `AP1-${'B'.repeat(20)}`
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid', botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(), reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator, verifyIdentity: rejectIdentity,
      fetch: async () => json({
        result: 'success', msg: '', queue_id: 'queue-private-approval', last_event_id: 300,
        events: [{ id: 301, type: 'message', message: rawMessage({
          id: 3_000, senderId: 42, senderEmail: 'human@example.invalid', senderName: '研究员甲',
          content: `1 ${fixtureReference}`, messageType: 'private'
        }) }]
      })
    })
    const result = await provider.registerEventQueue()
    assert.equal(result.events.length, 0)
  })

  it('fails closed when locator resolution is ambiguous', async () => {
    const provider = createZulipHumanEndpointProvider({
      realmUrl: 'https://chat.example.invalid',
      botEmail: 'service-bot@example.invalid'
    }, {
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      deliveryLedger: new MemoryLedger(),
      reconcileDelivery: async () => ({ status: 'not_sent' }),
      resolveLocator: async () => {
        throw new ZulipProviderError('locator_ambiguous', 'ambiguous')
      },
      verifyIdentity: rejectIdentity,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      fetch: async () => json({
        result: 'success',
        msg: '',
        queue_id: 'queue-ambiguous',
        last_event_id: 1,
        events: [{
          id: 2,
          type: 'message',
          message: rawMessage({
            id: 800,
            senderId: 42,
            senderEmail: 'human@example.invalid',
            senderName: '研究员甲',
            content: '必须拒绝路由'
          })
        }]
      })
    })
    await assert.rejects(
      provider.registerEventQueue(),
      (error) => error instanceof ZulipProviderError && error.code === 'locator_ambiguous'
    )
  })
})
