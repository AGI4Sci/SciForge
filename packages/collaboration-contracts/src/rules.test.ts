import { describe, expect, it } from 'vitest'
import {
  STATE_TRANSITIONS,
  canTransition,
  checkExpectedRevision,
  idempotencyRecordSchema,
  reconcileIdempotency,
  stateTransitionSchema
} from './rules.js'
import { TEST_HASH, TEST_IDS } from './testing.js'

describe('frozen state machines', () => {
  it('allows only explicit Project, Task, and projection transitions', () => {
    expect(canTransition('project', 'draft', 'active')).toBe(true)
    expect(canTransition('project', 'completed', 'active')).toBe(false)
    expect(canTransition('task', 'offered', 'in_progress')).toBe(true)
    expect(canTransition('task', 'offered', 'awaiting_review')).toBe(false)
    expect(canTransition('projection', 'closed', 'active')).toBe(false)
  })

  it('supports needs-human resume but never terminal Task overwrite', () => {
    expect(canTransition('task_execution', 'running', 'needs_human')).toBe(true)
    expect(canTransition('task_execution', 'needs_human', 'running')).toBe(true)
    expect(canTransition('task_execution', 'completed', 'running')).toBe(false)
    expect(canTransition('task', 'cancelled', 'completed')).toBe(false)
    expect(canTransition('project_content_binding', 'degraded', 'provisioning')).toBe(false)
  })

  it('makes revoked identities and acknowledged inbox entries terminal', () => {
    expect(STATE_TRANSITIONS.user.revoked).toEqual([])
    expect(STATE_TRANSITIONS.endpoint.revoked).toEqual([])
    expect(STATE_TRANSITIONS.agent.revoked).toEqual([])
    expect(STATE_TRANSITIONS.inbox.acknowledged).toEqual([])
  })

  it('validates transition values as a strict contract', () => {
    expect(stateTransitionSchema.safeParse({ machine: 'project', from: 'active', to: 'completed' }).success).toBe(true)
    expect(stateTransitionSchema.safeParse({ machine: 'project', from: 'active', to: 'draft' }).success).toBe(false)
    expect(stateTransitionSchema.safeParse({ machine: 'project', from: 'active', to: 'completed', force: true }).success).toBe(false)
  })
})

describe('optimistic concurrency and idempotency', () => {
  it('increments exactly one revision on a match', () => {
    expect(checkExpectedRevision(4, 4)).toEqual({
      outcome: 'match',
      currentRevision: 4,
      nextRevision: 5
    })
  })

  it('returns a typed conflict without inventing a new revision', () => {
    expect(checkExpectedRevision(3, 4)).toEqual({
      outcome: 'conflict',
      expectedRevision: 3,
      currentRevision: 4
    })
  })

  it('returns the existing receipt for the same actor, key, and request hash', () => {
    const existing = idempotencyRecordSchema.parse({
      actorKey: `agent:${TEST_IDS.agentId}`,
      idempotencyKey: 'idem_task_accept_000001',
      requestHash: TEST_HASH,
      receiptId: TEST_IDS.receiptId
    })
    expect(reconcileIdempotency(existing, {
      actorKey: existing.actorKey,
      idempotencyKey: existing.idempotencyKey,
      requestHash: existing.requestHash
    })).toEqual({ outcome: 'duplicate', receiptId: TEST_IDS.receiptId })
  })

  it('fails closed when a key is reused with different content', () => {
    const existing = idempotencyRecordSchema.parse({
      actorKey: `agent:${TEST_IDS.agentId}`,
      idempotencyKey: 'idem_task_accept_000001',
      requestHash: TEST_HASH,
      receiptId: TEST_IDS.receiptId
    })
    expect(reconcileIdempotency(existing, {
      actorKey: existing.actorKey,
      idempotencyKey: existing.idempotencyKey,
      requestHash: 'b'.repeat(64)
    })).toEqual({ outcome: 'conflict', receiptId: TEST_IDS.receiptId })
  })

  it('scopes the same idempotency key independently to another actor', () => {
    const existing = idempotencyRecordSchema.parse({
      actorKey: `agent:${TEST_IDS.agentId}`,
      idempotencyKey: 'idem_task_accept_000001',
      requestHash: TEST_HASH,
      receiptId: TEST_IDS.receiptId
    })
    expect(reconcileIdempotency(existing, {
      actorKey: `agent:${TEST_IDS.secondAgentId}`,
      idempotencyKey: existing.idempotencyKey,
      requestHash: TEST_HASH
    })).toEqual({ outcome: 'new' })
  })
})
