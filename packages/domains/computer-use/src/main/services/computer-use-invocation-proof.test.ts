import { describe, expect, it } from 'vitest'
import {
  createComputerUseInvocationProof,
  verifyComputerUseInvocationProofSignature
} from './computer-use-invocation-proof'

describe('Computer Use invocation proof', () => {
  it('binds confirmed owner identity and arguments', () => {
    const proof = createComputerUseInvocationProof({
      secret: 'test-secret', tool: 'computer_use', arguments: { sessionId: 'one' },
      nowMs: 10_000, ttlMs: 1_000, proofId: 'proof-1', nonce: 'nonce-1',
      trusted: {
        requestId: 'host-request', runtimeId: 'codex', threadId: 'thread-1',
        turnId: 'turn-1', callId: 'call-1', actionId: 'action-1',
        invocationId: 'invocation-1', approval: 'confirmation'
      }
    })
    expect(verifyComputerUseInvocationProofSignature(proof, 'test-secret')).toBe(true)
    expect(verifyComputerUseInvocationProofSignature({ ...proof, tool: 'forged' }, 'test-secret')).toBe(false)
  })

  it('rejects unconfirmed trusted metadata', () => {
    expect(() => createComputerUseInvocationProof({
      secret: 'test-secret', tool: 'computer_use', arguments: {},
      trusted: { requestId: 'r', runtimeId: 'codex', threadId: 't', actionId: 'a', approval: 'none' }
    })).toThrow(/confirmed invocation/u)
  })
})
