import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_INVOCATION_META_KEY,
  computerUseArgumentDigest,
  createComputerUseInvocationProof,
  encodeComputerUseInvocationProof,
  parseTrustedComputerUseInvocation,
  verifyComputerUseInvocationProofSignature
} from './computer-use-invocation-proof'

const trusted = {
  requestId: 'runtime-request-1',
  runtimeId: 'codex',
  threadId: 'thread-1',
  turnId: 'turn-1',
  callId: 'call-1',
  actionId: 'managed-mcp.computer-use',
  invocationId: 'invocation-1',
  approval: 'confirmation' as const
}

describe('computer-use invocation proof', () => {
  it('creates a deterministic cross-language proof vector', () => {
    const proof = createComputerUseInvocationProof({
      secret: 'test-secret',
      trusted,
      tool: 'computer_use',
      arguments: { execute: true, instruction: 'type alpha', nested: { z: 1, a: false } },
      requestId: 'mcp-cua-request-1',
      nowMs: 1_800_000_000_000,
      ttlMs: 30_000,
      proofId: 'cua-proof-1',
      nonce: 'nonce-1'
    })

    expect(proof.argumentDigest).toBe('22dc2bacbc3487a0cad9a42d23aae241e0657122eba0d26f3ad50e3949edbd2e')
    expect(proof.signature).toBe('77f2117ed0dfad6c82c26af687c0f238487ddbc49b5b2281607229ce3f07476f')
    expect(verifyComputerUseInvocationProofSignature(proof, 'test-secret')).toBe(true)
    expect(verifyComputerUseInvocationProofSignature(proof, 'wrong-secret')).toBe(false)
    expect(encodeComputerUseInvocationProof(proof)).not.toContain('test-secret')
  })

  it('uses recursively sorted JSON for argument digests', () => {
    expect(computerUseArgumentDigest({ b: 2, a: { y: true, x: ['z'] } }))
      .toBe(computerUseArgumentDigest({ a: { x: ['z'], y: true }, b: 2 }))
    expect(computerUseArgumentDigest({ value: 1 }))
      .toBe(computerUseArgumentDigest({ value: 1.0 }))
  })

  it('reads trusted context only from the dedicated metadata key', () => {
    expect(parseTrustedComputerUseInvocation({
      [COMPUTER_USE_INVOCATION_META_KEY]: trusted
    })).toEqual(trusted)
    expect(parseTrustedComputerUseInvocation({ approval: trusted })).toBeNull()
  })
})
