import type { AddressInfo } from 'node:net'

import type { HumanEndpointProviderContract } from '@sciforge/collaboration-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import { createCollaborationHttpServer } from './api.js'
import { AuthenticationService } from './auth.js'
import { CollaborationService } from './service.js'

const now = () => new Date('2026-08-15T02:00:00.000Z')
const servers: ReturnType<typeof createCollaborationHttpServer>[] = []

const providerContract: HumanEndpointProviderContract = {
  protocolVersion: '1.0',
  type: 'human_endpoint_provider_contract',
  provider: 'fake-im',
  displayName: 'Fake IM',
  capabilities: {
    textMessages: true,
    stableLocators: true,
    eventCursor: true,
    locatorRename: true,
    locatorMove: true,
    locatorDiscovery: true,
    identityChallenge: true,
    directMessages: true
  },
  onboarding: { realmLabel: 'Realm', accountLabel: 'Account', containerLabel: 'Stream', topicLabel: 'Topic' },
  limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('production HTTP anonymous bootstrap boundary', () => {
  it('exposes only catalog and pairing begin/redeem without a bearer while keeping bounds and route limits', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const server = createCollaborationHttpServer({
      service,
      authentication,
      readiness: async () => true,
      maxBodyBytes: 1_024,
      now,
      providers: {
        contracts: () => [providerContract],
        listLocators: async () => ({ locators: [] })
      }
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    const catalog = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_BootstrapCatalog01', type: 'endpoint.catalog.get'
    })
    expect(catalog.status).toBe(200)
    await expect(catalog.json()).resolves.toMatchObject({
      type: 'endpoint.catalog', providers: [{ provider: 'fake-im' }]
    })

    const firstBeginBody = pairingBegin(1)
    const firstBegin = await postCommand(baseUrl, firstBeginBody)
    expect(firstBegin.status).toBe(200)
    const begun = await firstBegin.json() as { pollSecret: string }
    expect(typeof begun.pollSecret).toBe('string')

    for (let index = 2; index <= 10; index += 1) {
      expect((await postCommand(baseUrl, pairingBegin(index))).status).toBe(200)
    }
    const limited = await postCommand(baseUrl, pairingBegin(11))
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ error: { code: 'rate_limited' } })

    const redeemBody = {
      protocolVersion: '1.0', requestId: 'req_BootstrapRedeem01', type: 'pairing.redeem',
      idempotencyKey: 'idem_bootstrap_redeem_01', pollSecret: begun.pollSecret
    }
    const redeem = await postCommand(baseUrl, redeemBody)
    expect(redeem.status).toBe(200)
    await expect(redeem.json()).resolves.toMatchObject({ type: 'pairing.pending' })

    const catalogAfterPairingLimit = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_BootstrapCatalog02', type: 'endpoint.catalog.get'
    })
    expect(catalogAfterPairingLimit.status).toBe(200)

    const protectedResponse = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_BootstrapProtected1', type: 'user.get',
      userId: 'usr_123456789012'
    })
    expect(protectedResponse.status).toBe(401)

    const oversized = await fetch(`${baseUrl}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: '1.0', requestId: 'req_BootstrapOversize1',
        type: 'endpoint.catalog.get', padding: 'x'.repeat(2_000) })
    })
    expect(oversized.status).toBe(413)
    const oversizedText = await oversized.text()
    expect(oversizedText).not.toContain('x'.repeat(64))
  })
})

function pairingBegin(index: number) {
  return {
    protocolVersion: '1.0',
    requestId: `req_BootstrapBegin${String(index).padStart(2, '0')}`,
    type: 'pairing.begin',
    idempotencyKey: `idem_bootstrap_begin_${String(index).padStart(2, '0')}`,
    provider: 'fake-im',
    realmId: 'fake-realm',
    requestedDisplayName: `Bootstrap User ${index}`
  }
}

function postCommand(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
  return fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    body: JSON.stringify(body)
  })
}
