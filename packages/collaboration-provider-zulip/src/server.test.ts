import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import type {
  HumanEndpointProviderFactoryContext,
  ProviderDiagnostic,
  ProviderSendResult
} from '@sciforge/collaboration-contracts'
import { createZulipLocator } from './locator.js'
import { createHumanEndpointProvider } from './server.js'

describe('createHumanEndpointProvider', () => {
  it('uses only provider-neutral services and reuses durable send receipts', async () => {
    const credentialSentinel = randomUUID()
    const deliveries = new Map<string, ProviderSendResult>()
    const diagnostics: ProviderDiagnostic[] = []
    let sendCalls = 0
    let secretReads = 0
    const realmId = 'https://chat.example.invalid/zulip'
    const locator = createZulipLocator({
      realmId,
      streamId: '12',
      streamName: '研究协作',
      topicName: '同一 Session',
      topicId: 'stable-server-topic'
    })
    const context: HumanEndpointProviderFactoryContext = {
      provider: 'zulip',
      configuration: {
        realmUrl: realmId,
        botEmail: 'service-bot@example.invalid',
        credentialSecretReference: 'zulip-provider-credential'
      },
      secretReader: {
        readSecret: async () => {
          secretReads += 1
          return credentialSentinel
        }
      },
      services: {
        resolveLocator: async () => locator,
        claimEvent: async () => 'claimed',
        readDelivery: async (clientMessageId) => deliveries.get(clientMessageId),
        reconcileDelivery: async () => undefined,
        recordDelivery: async (clientMessageId, result) => {
          deliveries.set(clientMessageId, result)
        },
        verifyChallenge: async () => ({
          protocolVersion: '1.0',
          type: 'provider.identity.rejected',
          reason: 'invalid'
        }),
        http: async (request) => {
          const url = new URL(request.url)
          assert.ok(request.headers.authorization?.startsWith('Basic '))
          if (url.pathname === '/zulip/api/v1/users/me') {
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                result: 'success',
                msg: '',
                user_id: 99,
                email: 'service-bot@example.invalid',
                full_name: 'Service Bot',
                is_bot: true
              })
            }
          }
          if (url.pathname === '/zulip/api/v1/messages') {
            sendCalls += 1
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ result: 'success', msg: '', id: 700 })
            }
          }
          throw new Error(`Unexpected fake route: ${url.pathname}`)
        },
        reportDiagnostic: (diagnostic) => { diagnostics.push(diagnostic) }
      },
      now: () => '2026-08-15T00:00:00.000Z'
    }
    const provider = await createHumanEndpointProvider(context)
    assert.equal(provider.contract.provider, 'zulip')
    assert.equal((await provider.diagnose()).status, 'healthy')
    const request = {
      protocolVersion: '1.0' as const,
      type: 'provider.send.message' as const,
      locator,
      clientMessageId: 'client-message-1',
      text: '最终回复'
    }
    const first = await provider.send(request)
    const second = await provider.send(request)
    assert.equal(first.type, 'provider.send.succeeded')
    assert.deepEqual(second, first)
    assert.equal(sendCalls, 1)
    assert.equal(secretReads, 2)
    assert.equal(JSON.stringify([diagnostics, first]).includes(credentialSentinel), false)
  })
})
