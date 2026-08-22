import assert from 'node:assert/strict'
import test from 'node:test'

import { authorize } from '../packages/collaboration-server/src/auth.ts'
import { CollaborationServiceError } from '../packages/collaboration-server/src/errors.ts'

const userA = {
  kind: 'user',
  actorKey: 'actor-user-a',
  userId: 'user-a',
  credentialId: 'credential-a',
  assurance: 'strong'
}
const endpointA = {
  kind: 'human_endpoint',
  actorKey: 'actor-endpoint-a',
  userId: 'user-a',
  humanEndpointId: 'endpoint-a',
  assurance: 'verified'
}
const endpointB = {
  kind: 'human_endpoint',
  actorKey: 'actor-endpoint-b',
  userId: 'user-b',
  humanEndpointId: 'endpoint-b',
  assurance: 'strong'
}
const coordinator = {
  kind: 'agent_device',
  actorKey: 'actor-agent-coordinator',
  userId: 'user-a',
  agentId: 'agent-coordinator',
  credentialId: 'credential-coordinator',
  assurance: 'device'
}
const worker = {
  kind: 'agent_device',
  actorKey: 'actor-agent-worker',
  userId: 'user-b',
  agentId: 'agent-worker',
  credentialId: 'credential-worker',
  assurance: 'device'
}

function assertDenied(facts, expectedCode = 'permission_denied') {
  assert.throws(() => authorize(facts), (error) => {
    assert.ok(error instanceof CollaborationServiceError)
    assert.equal(error.code, expectedCode)
    return true
  })
}

test('8.1 canonical permission matrix permits only explicit actor, target, role and assurance combinations', () => {
  const allowed = [
    { actor: endpointA, operation: 'personal_message', resourceOwnerUserId: 'user-a' },
    { actor: endpointA, operation: 'project_input', projectMember: true },
    { actor: coordinator, operation: 'task_create', coordinatorAgentId: 'agent-coordinator' },
    { actor: worker, operation: 'task_update', assigneeAgentId: 'agent-worker' },
    { actor: worker, operation: 'human_needed', assigneeAgentId: 'agent-worker', projectMember: true },
    { actor: endpointB, operation: 'human_answer', targetUserId: 'user-b', requiredAssurance: 'strong' },
    {
      actor: endpointB,
      operation: 'capability_approval',
      targetUserId: 'user-b',
      requiredAssurance: 'strong',
      remoteApprovalAllowed: true
    },
    { actor: userA, operation: 'project_admin', projectRole: 'owner' },
    { actor: coordinator, operation: 'record_accept', coordinatorAgentId: 'agent-coordinator' }
  ]
  for (const facts of allowed) assert.doesNotThrow(() => authorize(facts))

  const denied = [
    { actor: endpointA, operation: 'personal_message', resourceOwnerUserId: 'user-b' },
    { actor: endpointA, operation: 'project_input', projectMember: false },
    { actor: worker, operation: 'task_create', coordinatorAgentId: 'agent-coordinator' },
    { actor: coordinator, operation: 'task_update', assigneeAgentId: 'agent-worker' },
    { actor: coordinator, operation: 'human_needed', assigneeAgentId: 'agent-worker', projectMember: true },
    { actor: endpointA, operation: 'human_answer', targetUserId: 'user-b' },
    {
      actor: endpointB,
      operation: 'capability_approval',
      targetUserId: 'user-b',
      requiredAssurance: 'strong',
      remoteApprovalAllowed: false
    },
    { actor: endpointA, operation: 'project_admin', projectRole: 'owner' },
    { actor: worker, operation: 'record_accept', coordinatorAgentId: 'agent-coordinator' }
  ]
  for (const facts of denied) assertDenied(facts)

  assertDenied(
    {
      actor: endpointA,
      operation: 'human_answer',
      targetUserId: 'user-a',
      requiredAssurance: 'strong'
    },
    'assurance_insufficient'
  )
})

test('8.3 canonical matrix rejects A accessing B projection, proxy answer, non-member write and non-assignee completion', () => {
  assertDenied({ actor: endpointA, operation: 'personal_message', resourceOwnerUserId: 'user-b' })
  assertDenied({ actor: endpointA, operation: 'human_answer', targetUserId: 'user-b' })
  assertDenied({ actor: endpointA, operation: 'project_input', projectMember: false })
  assertDenied({ actor: coordinator, operation: 'task_update', assigneeAgentId: 'agent-worker' })
})

test('8.2 a verified remote endpoint cannot approve a pending capability unless policy allows it', () => {
  assertDenied({
    actor: endpointB,
    operation: 'capability_approval',
    targetUserId: 'user-b',
    requiredAssurance: 'strong',
    remoteApprovalAllowed: false
  })
  assert.doesNotThrow(() => authorize({
    actor: endpointA,
    operation: 'capability_approval',
    targetUserId: 'user-a',
    requiredAssurance: 'verified',
    remoteApprovalAllowed: true
  }))
  assertDenied({
    actor: endpointA,
    operation: 'capability_approval',
    targetUserId: 'user-a',
    requiredAssurance: 'strong',
    remoteApprovalAllowed: true
  }, 'assurance_insufficient')
  assert.doesNotThrow(() => authorize({
    actor: endpointB,
    operation: 'capability_approval',
    targetUserId: 'user-b',
    requiredAssurance: 'strong',
    remoteApprovalAllowed: true
  }))
})
