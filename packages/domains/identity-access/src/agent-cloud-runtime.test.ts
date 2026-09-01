import { describe, expect, it, vi } from 'vitest'

import {
  agentCloudExecuteInputSchema,
  defineAgentCloudRuntime
} from './agent-cloud-runtime.js'
import { agentNodeFixture } from '@sciforge/collaboration-contracts/testing'

const AGENT_ID = agentNodeFixture.agentId

describe('Agent Cloud runtime contract', () => {
  it('routes lifecycle and inbox operations through bounded methods', () => {
    expect(agentCloudExecuteInputSchema.safeParse({
      agentId: AGENT_ID,
      request: {
        protocolVersion: '1.0',
        requestId: 'req_000000000000000000000000',
        type: 'inbox.pull',
        recipientType: 'agent',
        afterSequence: 0,
        limit: 100
      }
    }).success).toBe(false)
    expect(agentCloudExecuteInputSchema.safeParse({
      agentId: AGENT_ID,
      request: {
        protocolVersion: '1.0',
        requestId: 'req_000000000000000000000001',
        type: 'agent.ensure',
        idempotencyKey: 'idem_agent.ensure.contract_01',
        deviceId: agentNodeFixture.deviceId,
        capabilities: [],
        credentialBootstrapPublicKey: {
          kty: 'OKP',
          crv: 'X25519',
          x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        }
      }
    }).success).toBe(false)
  })

  it('validates both sides without returning authority material', async () => {
    const ensureAgent = vi.fn(async () => agentNodeFixture)
    const runtime = defineAgentCloudRuntime({
      authorityStatus: async () => ({
        state: 'ready',
        agentId: AGENT_ID,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      ensureAgent,
      rotateAgent: async () => agentNodeFixture,
      revokeAgent: async () => ({ ...agentNodeFixture, lifecycleStatus: 'revoked', revokedAt: new Date().toISOString() }),
      fenceAgent: async () => undefined,
      execute: async () => { throw new Error('not used') },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 }),
      observeAgentInbox: async function* () {}
    })
    const result = await runtime.ensureAgent()
    expect(result).toEqual(agentNodeFixture)
    expect(ensureAgent).toHaveBeenCalledWith()
    expect(result).not.toHaveProperty('sealedCredential')
    expect(result).not.toHaveProperty('authority')
  })
})
