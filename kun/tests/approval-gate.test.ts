import { describe, expect, it } from 'vitest'
import { InMemoryApprovalGate } from '../src/adapters/in-memory-approval-gate.js'
import { createApprovalRequest } from '../src/domain/approval.js'

describe('InMemoryApprovalGate', () => {
  it('accepts only the first decision for an approval', async () => {
    const gate = new InMemoryApprovalGate()
    const pending = gate.request(createApprovalRequest({
      id: 'approval_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'write',
      summary: 'Write a file.'
    }))

    expect(gate.decide('approval_1', 'allow')).toBe(true)
    expect(gate.decide('approval_1', 'deny', 'late abort')).toBe(false)
    await expect(pending).resolves.toBe('allow')
    expect(gate.get('approval_1')?.status).toBe('allowed')
  })
})
