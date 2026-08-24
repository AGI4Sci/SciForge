import { describe, expect, it, vi } from 'vitest'

import {
  agentCloudExecuteInputSchema,
  agentCloudRegisterInputSchema,
  defineAgentCloudRuntime
} from './agent-cloud-runtime.js'
import { agentNodeFixture } from '@sciforge/collaboration-contracts/testing'

const AGENT_ID = agentNodeFixture.agentId

describe('Agent Cloud runtime contract', () => {
  it('keeps bootstrap keys and sealed machine authority out of registration calls', () => {
    expect(agentCloudRegisterInputSchema.safeParse({
      displayName: 'Worker',
      nodeType: 'desktop',
      capabilities: ['task.execute'],
      idempotencyKey: 'idem_agent-register_123456789012',
      credentialBootstrapPublicKey: { kty: 'OKP' }
    }).success).toBe(false)
  })

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
  })

  it('validates both sides without returning authority material', async () => {
    const registerAgent = vi.fn(async () => agentNodeFixture)
    const runtime = defineAgentCloudRuntime({
      authorityStatus: async () => ({
        state: 'ready',
        agentId: AGENT_ID,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion
      }),
      registerAgent,
      rotateAgent: async () => agentNodeFixture,
      revokeAgent: async () => ({ ...agentNodeFixture, lifecycleStatus: 'revoked', revokedAt: new Date().toISOString() }),
      fenceAgent: async () => undefined,
      execute: async () => { throw new Error('not used') },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 }),
      observeAgentInbox: async function* () {}
    })
    const result = await runtime.registerAgent({
      displayName: ' Worker ',
      nodeType: 'desktop',
      capabilities: ['task.execute', 'task.execute'],
      idempotencyKey: 'idem_agent-register_123456789012'
    })
    expect(result).toEqual(agentNodeFixture)
    expect(registerAgent).toHaveBeenCalledWith({
      displayName: 'Worker',
      nodeType: 'desktop',
      capabilities: ['task.execute'],
      idempotencyKey: 'idem_agent-register_123456789012'
    })
    expect(result).not.toHaveProperty('sealedCredential')
    expect(result).not.toHaveProperty('authority')
  })
})
