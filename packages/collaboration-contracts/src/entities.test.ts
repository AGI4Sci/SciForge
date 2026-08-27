import { describe, expect, it } from 'vitest'
import {
  agentNodeSchema,
  humanAnswerSchema,
  humanEndpointBindingSchema,
  humanNeededSchema,
  participantProfileSchema,
  projectRecordSchema,
  projectSchema,
  remoteSessionProjectionSchema,
  taskSchema,
  userPrincipalSchema
} from './entities.js'
import { hasStableEntityIdentity, providerIdentityKey } from './rules.js'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  agentNodeFixture,
  chineseProviderLocatorFixture,
  collaborationFixtures,
  humanEndpointBindingFixture,
  humanAnswerFixture,
  humanNeededFixture,
  invalidTestOnlyValue,
  participantProfileFixture,
  projectFixture,
  projectRecordFixture,
  providerIdentityFixture,
  remoteSessionProjectionFixture,
  taskFixture,
  userPrincipalFixture
} from './testing.js'

describe('strict collaboration entities', () => {
  it('parses every shared entity fixture', () => {
    expect(collaborationFixtures.userPrincipal.userId).toBe(TEST_IDS.userId)
    expect(collaborationFixtures.humanEndpointBinding.humanEndpointId).toBe(TEST_IDS.humanEndpointId)
    expect(collaborationFixtures.agentNode.agentId).toBe(TEST_IDS.agentId)
    expect(collaborationFixtures.remoteSessionProjection.projectionId).toBe(TEST_IDS.projectionId)
    expect(collaborationFixtures.project.projectId).toBe(TEST_IDS.projectId)
    expect(collaborationFixtures.task.taskId).toBe(TEST_IDS.taskId)
  })

  it('rejects unknown fields at the entity root and nested provider identity', () => {
    expect(userPrincipalSchema.safeParse({ ...userPrincipalFixture, email: 'not-an-identity@example.invalid' }).success).toBe(false)
    expect(humanEndpointBindingSchema.safeParse({
      ...humanEndpointBindingFixture,
      identity: { ...humanEndpointBindingFixture.identity, providerToken: invalidTestOnlyValue('VALUE') }
    }).success).toBe(false)
  })

  it('allows display-name changes without changing stable identity', () => {
    const renamed = userPrincipalSchema.parse({
      ...userPrincipalFixture,
      displayName: '新的显示名称',
      revision: 2,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    expect(hasStableEntityIdentity(userPrincipalFixture, renamed)).toBe(true)
    expect(renamed.userId).toBe(userPrincipalFixture.userId)
  })

  it('keys provider identities by provider, realm, and provider user ID', () => {
    const key = providerIdentityKey(providerIdentityFixture)
    expect(key).not.toContain(providerIdentityFixture.displayName!)
    expect(providerIdentityKey({ ...providerIdentityFixture, displayName: '已改名' })).toBe(key)
    expect(providerIdentityKey({ ...providerIdentityFixture, realmId: 'another-realm' })).not.toBe(key)
  })
})

describe('identity and ownership invariants', () => {
  it('requires one authenticated Owner provenance for HumanAnswer and couples decisions to confirmations', () => {
    expect(humanAnswerSchema.safeParse({
      ...humanAnswerFixture,
      answeredFrom: { type: 'oidc_user', oidcIdentityId: 'oid_TargetIdentity01' }
    }).success).toBe(true)
    expect(humanAnswerSchema.safeParse({
      ...humanAnswerFixture,
      answeredFrom: { type: 'human_endpoint', humanEndpointId: TEST_IDS.humanEndpointId }
    }).success).toBe(true)
    expect(humanAnswerSchema.safeParse({
      ...humanAnswerFixture,
      answeredFrom: null
    }).success).toBe(false)
    expect(humanAnswerSchema.safeParse({
      ...humanAnswerFixture,
      decision: 'approve'
    }).success).toBe(false)
    expect(humanAnswerSchema.safeParse({
      ...humanAnswerFixture,
      decision: 'approve',
      confirmationId: 'cfm_Approval000001'
    }).success).toBe(true)
  })

  it('carries only a bounded digest-based confirmable action in HumanNeeded', () => {
    expect(humanNeededSchema.safeParse({
      ...humanNeededFixture,
      confirmableAction: {
        actionType: 'workspace.delete_file', safeSummary: 'Delete generated output.',
        effect: 'destructive', actionDigest: 'a'.repeat(64)
      }
    }).success).toBe(true)
    expect(humanNeededSchema.safeParse({
      ...humanNeededFixture,
      confirmableAction: {
        actionType: 'workspace.delete_file', safeSummary: 'Delete generated output.',
        effect: 'destructive', actionDigest: 'a'.repeat(64), command: 'rm -rf /'
      }
    }).success).toBe(false)
    expect(humanNeededSchema.safeParse({
      ...humanNeededFixture,
      context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: 2 }
    }).success).toBe(true)
    expect(humanNeededSchema.safeParse({
      ...humanNeededFixture,
      context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: 2, taskId: TEST_IDS.taskId }
    }).success).toBe(false)
  })

  it('requires revoked endpoint and Agent timestamps and forces revoked Agents offline', () => {
    expect(humanEndpointBindingSchema.safeParse({
      ...humanEndpointBindingFixture,
      status: 'revoked'
    }).success).toBe(false)
    expect(agentNodeSchema.safeParse({
      ...agentNodeFixture,
      lifecycleStatus: 'revoked',
      connectionStatus: 'online',
      revokedAt: TEST_LATER_TIMESTAMP
    }).success).toBe(false)
    expect(agentNodeSchema.safeParse({
      ...agentNodeFixture,
      lifecycleStatus: 'revoked',
      connectionStatus: 'offline',
      revokedAt: TEST_LATER_TIMESTAMP
    }).success).toBe(true)
  })

  it('requires a complete Participant to explicitly select both primary endpoints', () => {
    expect(participantProfileSchema.safeParse({
      ...participantProfileFixture,
      primaryAgentId: null,
      status: 'active'
    }).success).toBe(false)
    expect(participantProfileSchema.safeParse({
      ...participantProfileFixture,
      primaryAgentId: null,
      status: 'incomplete'
    }).success).toBe(true)
  })

  it('does not allow an implicit Agent fallback from another owner', () => {
    expect(participantProfileFixture.primaryAgentId).toBe(agentNodeFixture.agentId)
    expect(agentNodeFixture.ownerUserId).toBe(participantProfileFixture.userId)
    const reassigned = agentNodeSchema.parse({
      ...agentNodeFixture,
      agentId: TEST_IDS.secondAgentId,
      ownerUserId: TEST_IDS.secondUserId
    })
    expect(reassigned.ownerUserId).not.toBe(participantProfileFixture.userId)
  })
})

describe('projection, Project, Task, and Record invariants', () => {
  it('accepts Chinese locator display metadata without deriving projection identity from it', () => {
    expect(chineseProviderLocatorFixture.topicDisplayName).toContain('蛋白质')
    const renamed = remoteSessionProjectionSchema.parse({
      ...remoteSessionProjectionFixture,
      locator: { ...chineseProviderLocatorFixture, topicDisplayName: '完全不同的中文标题' },
      locatorRevision: 2,
      revision: 2,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    expect(renamed.projectionId).toBe(remoteSessionProjectionFixture.projectionId)
  })

  it('keeps local runtime/thread/workspace facts out of the cloud projection', () => {
    expect(remoteSessionProjectionSchema.safeParse({
      ...remoteSessionProjectionFixture,
      runtimeId: 'runtime-local',
      threadId: 'thread-local',
      workspaceRoot: '/private/local/path'
    }).success).toBe(false)
  })

  it('requires owner access and rejects duplicate projection allowlist entries', () => {
    expect(remoteSessionProjectionSchema.safeParse({
      ...remoteSessionProjectionFixture,
      allowedSenderUserIds: [TEST_IDS.secondUserId]
    }).success).toBe(false)
    expect(remoteSessionProjectionSchema.safeParse({
      ...remoteSessionProjectionFixture,
      allowedSenderUserIds: [TEST_IDS.userId, TEST_IDS.userId]
    }).success).toBe(false)
  })

  it('keeps Membership outside Project and requires a bounded budget', () => {
    expect(projectSchema.safeParse({ ...projectFixture, memberUserIds: [TEST_IDS.userId] }).success).toBe(false)
    expect(projectSchema.safeParse({
      ...projectFixture,
      budget: { ...projectFixture.budget, maxTasksPerRound: 21 }
    }).success).toBe(false)
  })

  it('rejects self-dependencies, retry overflow, and missing terminal timestamps', () => {
    expect(taskSchema.safeParse({ ...taskFixture, dependencyTaskIds: [taskFixture.taskId] }).success).toBe(false)
    expect(taskSchema.safeParse({ ...taskFixture, executionCount: 4, maxRetries: 2 }).success).toBe(false)
    expect(taskSchema.safeParse({ ...taskFixture, status: 'completed' }).success).toBe(false)
    expect(taskSchema.safeParse({
      ...taskFixture,
      status: 'completed',
      currentExecutionId: TEST_IDS.executionId,
      currentExecutionState: 'completed',
      executionCount: 1,
      completedAt: TEST_LATER_TIMESTAMP
    }).success).toBe(true)
  })

  it('admits only Coordinator-authored official ProjectRecord kinds with exact provenance', () => {
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      kind: 'proposal'
    }).success).toBe(false)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      kind: 'task_result'
    }).success).toBe(false)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      status: 'proposed'
    }).success).toBe(false)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      acceptedByAgentId: TEST_IDS.secondAgentId
    }).success).toBe(false)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      sourceResultSubmissionId: null
    }).success).toBe(false)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      kind: 'decision',
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: TEST_IDS.humanAnswerId
    }).success).toBe(true)
    expect(projectRecordSchema.safeParse({
      ...projectRecordFixture,
      kind: 'summary',
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: null
    }).success).toBe(true)
  })
})
