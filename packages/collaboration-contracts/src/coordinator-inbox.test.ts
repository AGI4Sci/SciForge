import { describe, expect, it } from 'vitest'

import {
  agentInboxMessageSchema,
  projectPlanConfirmedPayloadSchema,
  taskResultSubmittedPayloadSchema
} from './protocol.js'

const envelope = {
  protocolVersion: '1.0' as const,
  projectId: 'prj_Coordinator001'
}

describe('Coordinator durable Inbox payloads', () => {
  it('round-trips the exact confirmed Plan wake-up', () => {
    const payload = projectPlanConfirmedPayloadSchema.parse({
      ...envelope,
      type: 'project.plan.confirmed',
      projectPlanId: 'pln_Coordinator001',
      planDigest: 'a'.repeat(64),
      revision: 2
    })
    expect(agentInboxMessageSchema.parse({
      schemaVersion: 1,
      type: 'inbox_message',
      inboxMessageId: 'ibx_Coordinator001',
      recipientType: 'agent',
      recipientAgentId: 'agt_Coordinator001',
      sequence: 1,
      status: 'pending',
      payload,
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-29T00:00:00.000Z'
    }).payload).toEqual(payload)
  })

  it('round-trips the exact immutable result submission wake-up', () => {
    const payload = taskResultSubmittedPayloadSchema.parse({
      ...envelope,
      type: 'task.result.submitted',
      taskId: 'tsk_Coordinator001',
      executionId: 'exe_Coordinator001',
      resultSubmissionId: 'rsu_Coordinator001',
      revision: 1
    })
    expect(agentInboxMessageSchema.parse({
      schemaVersion: 1,
      type: 'inbox_message',
      inboxMessageId: 'ibx_Coordinator002',
      recipientType: 'agent',
      recipientAgentId: 'agt_Coordinator001',
      sequence: 2,
      status: 'pending',
      payload,
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-29T00:00:00.000Z'
    }).payload).toEqual(payload)
  })
})
