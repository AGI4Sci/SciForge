import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    const secretFileDirectory = await mkdtemp(join(tmpdir(), 'sciforge-zulip-secret-'))
    await writeFile(
      join(secretFileDirectory, 'zulip-provider-credential'),
      credentialSentinel,
      { encoding: 'utf8', mode: 0o600 }
    )
    const deliveries = new Map<string, ProviderSendResult>()
    const diagnostics: ProviderDiagnostic[] = []
    let sendCalls = 0
    let credentialUses = 0
    const httpServer = createServer((request, response) => {
      const authorization = request.headers.authorization
      assert.equal(typeof authorization, 'string')
      assert.equal(authorization?.startsWith('Basic '), true)
      assert.equal(
        Buffer.from(authorization?.slice('Basic '.length) ?? '', 'base64')
          .toString('utf8')
          .endsWith(`:${credentialSentinel}`),
        true
      )
      credentialUses += 1
      response.setHeader('content-type', 'application/json')
      if (request.url === '/zulip/api/v1/users/me') {
        response.end(JSON.stringify({
          result: 'success',
          msg: '',
          user_id: 99,
          email: 'service-bot@example.invalid',
          full_name: 'Service Bot',
          is_bot: true
        }))
        return
      }
      if (request.url === '/zulip/api/v1/messages') {
        sendCalls += 1
        response.end(JSON.stringify({ result: 'success', msg: '', id: 700 }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ result: 'error', msg: 'not found' }))
    })
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    const address = httpServer.address()
    assert.ok(address && typeof address !== 'string')
    const realmId = `http://127.0.0.1:${address.port}/zulip`
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
      secretFileDirectory,
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
        reportDiagnostic: (diagnostic) => { diagnostics.push(diagnostic) }
      },
      now: () => '2026-08-15T00:00:00.000Z'
    }
    try {
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
      assert.equal(credentialUses, 2)
      assert.equal(JSON.stringify([diagnostics, first]).includes(credentialSentinel), false)
    } finally {
      httpServer.close()
      await once(httpServer, 'close')
      await rm(secretFileDirectory, { recursive: true })
    }
  })
})
