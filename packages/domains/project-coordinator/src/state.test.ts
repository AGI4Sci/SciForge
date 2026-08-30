import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { ProjectCoordinatorStateStore } from './state.js'

describe('ProjectCoordinatorStateStore schema boundary', () => {
  it('rejects schema v2 without rewriting package settings', async () => {
    const settings = memorySettings({
      schemaVersion: 2,
      planDrafts: [],
      coordinatorSessionBindings: [],
      coordinatorTransferFeedback: [],
      projectCreateIntents: [],
      pendingProjectActivations: []
    })
    const store = new ProjectCoordinatorStateStore(settings.host)

    await assert.rejects(
      store.readCoordinatorSessionBindings(),
      /not schema version 3; clear the obsolete local state before reconnecting to Cloud/u
    )
    assert.equal(settings.writes(), 0)
  })

  it('deletion clears only target-local state, preserves create intents, and fences later writes', async () => {
    const targetProjectId = 'prj_TargetDelete001'
    const otherProjectId = 'prj_OtherProject001'
    const settings = memorySettings({
      schemaVersion: 3,
      planDrafts: [planDraft(targetProjectId, 'Target'), planDraft(otherProjectId, 'Other')],
      coordinatorSessionBindings: [
        coordinatorBinding(targetProjectId, 'Target'),
        coordinatorBinding(otherProjectId, 'Other')
      ],
      coordinatorTransferFeedback: [
        transferFeedback(targetProjectId, 'Target'),
        transferFeedback(otherProjectId, 'Other')
      ],
      projectCreateIntents: [
        createIntent(targetProjectId, 'Target'),
        createIntent(otherProjectId, 'Other')
      ],
      pendingProjectActivations: [
        pendingActivation(targetProjectId, 'Target'),
        pendingActivation(otherProjectId, 'Other')
      ],
      projectDeleteIntents: [],
      deletedProjectIds: []
    })
    const store = new ProjectCoordinatorStateStore(settings.host)

    await store.clearProjectLocalState(targetProjectId)
    await store.clearProjectLocalState(targetProjectId)

    assert.equal(await store.readDraft(targetProjectId), null)
    assert.equal((await store.readDraft(otherProjectId))?.projectId, otherProjectId)
    assert.deepEqual(
      (await store.readCoordinatorSessionBindings()).map(({ projectId }) => projectId),
      [otherProjectId]
    )
    assert.deepEqual(
      (await store.readPendingProjectActivations()).map(({ projectId }) => projectId),
      [otherProjectId]
    )
    assert.equal(await store.readCoordinatorTransferFeedback(targetProjectId), null)
    assert.equal(
      (await store.readCoordinatorTransferFeedback(otherProjectId))?.projectId,
      otherProjectId
    )
    const persisted = settings.value() as {
      projectCreateIntents: Array<{ createdProjectId: string | null }>
      deletedProjectIds: string[]
    }
    assert.deepEqual(
      persisted.projectCreateIntents.map(({ createdProjectId }) => createdProjectId),
      [targetProjectId, otherProjectId]
    )
    assert.deepEqual(persisted.deletedProjectIds, [targetProjectId])
    assert.equal(settings.writes(), 1, 'replayed cleanup must not rewrite the tombstone')
    await assert.rejects(
      store.writeDraft({ projectId: targetProjectId } as never, null),
      /being deleted or was already deleted/u
    )
  })
})

function memorySettings(initial: unknown): Readonly<{
  host: DomainMainPackageSettingsHost
  writes(): number
  value(): unknown
}> {
  let revision = 1
  let value = structuredClone(initial) as Awaited<
    ReturnType<DomainMainPackageSettingsHost['read']>
  >['value']
  let writes = 0
  return {
    host: {
      read: async () => ({ revision, value }),
      write: async (next, expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = next
        revision += 1
        writes += 1
        return { revision, value }
      },
      clear: async (expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = null
        revision += 1
        writes += 1
        return { revision, value }
      }
    },
    writes: () => writes,
    value: () => structuredClone(value)
  }
}

const observedAt = '2026-08-29T01:00:00.000Z'
const ownerUserId = 'usr_ProjectOwner001'

function planDraft(projectId: string, suffix: string) {
  const planItemId = `item_${suffix}Delete001`
  return {
    draftId: `draft_${suffix}Delete001`,
    draftRevision: 1,
    projectId,
    expectedProjectRevision: 3,
    expectedCoordinatorAuthorityEpoch: 2,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks: [{
      planItemId,
      title: `${suffix} task`,
      objective: `Complete the ${suffix.toLowerCase()} task.`,
      completionCriteria: ['One bounded result is ready.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: [],
      fileIntent: null
    }],
    rationale: `Keep the ${suffix.toLowerCase()} task bounded.`,
    runtimeProvenance: {
      runtimeId: `runtime-${suffix.toLowerCase()}`,
      modelId: null,
      generatedByCoordinatorAgentId: `agt_${suffix}Coordinator1`,
      generatedAt: observedAt
    },
    assignments: [{
      planItemId,
      workerUserId: null,
      recommendationReason: null
    }],
    createdAt: observedAt,
    updatedAt: observedAt
  }
}

function coordinatorBinding(projectId: string, suffix: string) {
  return {
    schemaVersion: 1,
    role: 'coordinator',
    projectId,
    principalUserId: ownerUserId,
    coordinatorAgentId: `agt_${suffix}Coordinator1`,
    coordinatorAuthorityEpoch: 2,
    runtimeId: `runtime-${suffix.toLowerCase()}`,
    threadId: `thread-${suffix.toLowerCase()}`,
    boundAt: observedAt
  }
}

function transferFeedback(projectId: string, suffix: string) {
  const previousCoordinatorAgentId = `agt_${suffix}Previous001`
  return {
    projectId,
    inboxMessageId: `ibx_${suffix}Transfer001`,
    recipientAgentId: previousCoordinatorAgentId,
    previousCoordinatorAgentId,
    coordinatorAgentId: `agt_${suffix}Coordinator1`,
    coordinatorAuthorityEpoch: 2,
    projectRevision: 3,
    disposition: 'authority_transferred_out',
    observedAt
  }
}

function createIntent(projectId: string, suffix: string) {
  return {
    createIntentId: `pct_${suffix}Create001`,
    principalUserId: ownerUserId,
    commandDigest: suffix === 'Target' ? 'a'.repeat(64) : 'b'.repeat(64),
    state: 'succeeded',
    createdProjectId: projectId,
    coordinatorSession: {
      runtimeId: `runtime-${suffix.toLowerCase()}`,
      threadId: `thread-${suffix.toLowerCase()}`
    },
    activationRequestId: `pca_${suffix}Delete001`
  }
}

function pendingActivation(projectId: string, suffix: string) {
  return {
    activationRequestId: `pca_${suffix}Delete001`,
    projectId,
    coordinatorSession: {
      runtimeId: `runtime-${suffix.toLowerCase()}`,
      threadId: `thread-${suffix.toLowerCase()}`
    },
    requestedAt: observedAt
  }
}
