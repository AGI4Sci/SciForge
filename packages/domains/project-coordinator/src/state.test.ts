import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { ProjectCoordinatorStateStore } from './state.js'

describe('ProjectCoordinatorStateStore migrations', () => {
  it('upgrades a v2 file Plan draft without losing unrelated Coordinator state', async () => {
    const legacy = legacyState()
    const settings = memorySettings(legacy)
    const store = new ProjectCoordinatorStateStore(settings.host)

    const draft = await store.readDraft('prj_LegacyFile01')

    assert.deepEqual(draft?.tasks[0]?.fileIntent?.dependencyInputs, [])
    assert.equal(draft?.tasks[0]?.fileIntent?.schemaVersion, 2)

    await store.writeDraft({
      ...draft!,
      draftRevision: 2,
      updatedAt: '2026-08-29T02:00:00.000Z'
    }, 1)

    const persisted = settings.value() as Record<string, unknown>
    assert.equal(persisted.schemaVersion, 3)
    const bindings = persisted.coordinatorSessionBindings as Array<Record<string, unknown>>
    assert.equal(bindings[0]?.projectId, 'prj_LegacyFile01')
    assert.equal(bindings[0]?.threadId, 'thread-legacy-coordinator')
    const drafts = persisted.planDrafts as Array<Record<string, unknown>>
    assert.equal(drafts[0]?.draftRevision, 2)
    const tasks = drafts[0]?.tasks as Array<Record<string, unknown>>
    const fileIntent = tasks[0]?.fileIntent as Record<string, unknown>
    assert.equal(fileIntent.schemaVersion, 2)
    assert.deepEqual(fileIntent.dependencyInputs, [])
  })

  it('does not erase an ambiguous dependency field from a v1 draft', async () => {
    const legacy = legacyState()
    const draft = (legacy.planDrafts as Array<Record<string, unknown>>)[0]!
    const task = (draft.tasks as Array<Record<string, unknown>>)[0]!
    task.fileIntent = {
      ...(task.fileIntent as Record<string, unknown>),
      dependencyInputs: [{
        planItemId: 'item_untrusted',
        outputIndex: 0,
        destinationName: 'untrusted.md'
      }]
    }
    const store = new ProjectCoordinatorStateStore(memorySettings(legacy).host)

    await assert.rejects(store.readDraft('prj_LegacyFile01'))
  })

  it('leaves an unbound v2 succeeded creation eligible for canonical recovery', async () => {
    const legacy = legacyState()
    legacy.projectCreateIntents = [{
      createIntentId: 'pct_CreateProject001',
      principalUserId: 'usr_ProjectOwner001',
      commandDigest: '6caf1ebe924739811259532f77829f4a54ca1adb097f914d082225e6daeec077',
      state: 'succeeded',
      createdProjectId: 'prj_CreatedProject01'
    }]
    const store = new ProjectCoordinatorStateStore(memorySettings(legacy).host)

    const commit = await store.readProjectCreationCommit('usr_ProjectOwner001', {
      createIntentId: 'pct_CreateProject001',
      displayName: 'Created Project',
      goal: 'Create one Project with a fresh reviewable Coordinator Session.',
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 2,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      }
    })

    assert.equal(commit, null)
  })

  it('fails closed instead of guessing among multiple v2 Coordinator Session bindings', async () => {
    const legacy = legacyState()
    legacy.projectCreateIntents = [{
      createIntentId: 'pct_LegacyCreate001',
      principalUserId: 'usr_LegacyOwner01',
      commandDigest: 'a'.repeat(64),
      state: 'succeeded',
      createdProjectId: 'prj_LegacyFile01'
    }]
    const bindings = legacy.coordinatorSessionBindings as Array<Record<string, unknown>>
    bindings.push({
      ...bindings[0],
      runtimeId: 'claude-runtime',
      threadId: 'thread-second-legacy-coordinator'
    })
    const store = new ProjectCoordinatorStateStore(memorySettings(legacy).host)

    await assert.rejects(
      store.readCoordinatorSessionBindings(),
      /ambiguous Coordinator Session bindings/u
    )
  })
})

function legacyState(): Record<string, unknown> {
  const at = '2026-08-29T01:00:00.000Z'
  const sourceLocator = {
    contractVersion: 1,
    kind: 'content-space.file-reference',
    authority: 'opencontent.run0',
    identity: { fileId: 'legacy-source-001' }
  }
  return {
    schemaVersion: 2,
    planDrafts: [{
      draftId: 'draft_LegacyFile01',
      draftRevision: 1,
      projectId: 'prj_LegacyFile01',
      expectedProjectRevision: 4,
      expectedCoordinatorAuthorityEpoch: 1,
      supersedesProjectPlanId: null,
      sourceInputLocators: [sourceLocator],
      tasks: [{
        planItemId: 'item_legacy_file',
        title: 'Review legacy file',
        objective: 'Preserve an existing file Plan draft across the package upgrade.',
        completionCriteria: ['One migrated output declaration remains reviewable.'],
        dependencyPlanItemIds: [],
        requiredCapabilityTags: ['meeting.review'],
        fileIntent: {
          schemaVersion: 1,
          inputs: [{
            kind: 'content-space.input-file',
            locator: sourceLocator,
            destinationName: 'source.md',
            expectedSemanticRevision: null,
            expectedMediaType: 'text/markdown'
          }],
          output: {
            kind: 'content-space.output-new',
            target: 'project-binding-root',
            mode: 'upload-new',
            fileName: 'review.md',
            mediaType: 'text/markdown',
            maxBytes: 65_536
          }
        }
      }],
      rationale: 'Retain the exact legacy Plan draft.',
      runtimeProvenance: {
        runtimeId: 'codex-runtime',
        modelId: null,
        generatedByCoordinatorAgentId: 'agt_LegacyCoord01',
        generatedAt: at
      },
      assignments: [{
        planItemId: 'item_legacy_file',
        workerUserId: null,
        recommendationReason: null
      }],
      createdAt: at,
      updatedAt: at
    }],
    coordinatorSessionBindings: [{
      schemaVersion: 1,
      role: 'coordinator',
      projectId: 'prj_LegacyFile01',
      principalUserId: 'usr_LegacyOwner01',
      coordinatorAgentId: 'agt_LegacyCoord01',
      runtimeId: 'codex-runtime',
      threadId: 'thread-legacy-coordinator',
      coordinatorAuthorityEpoch: 1,
      boundAt: at
    }],
    coordinatorTransferFeedback: [],
    projectCreateIntents: [],
    pendingProjectActivations: []
  }
}

function memorySettings(initial: unknown): Readonly<{
  host: DomainMainPackageSettingsHost
  value(): unknown
}> {
  let revision = 1
  let value = structuredClone(initial) as Awaited<
    ReturnType<DomainMainPackageSettingsHost['read']>
  >['value']
  return {
    host: {
      read: async () => ({ revision, value }),
      write: async (next, expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = next
        revision += 1
        return { revision, value }
      },
      clear: async (expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = null
        revision += 1
        return { revision, value }
      }
    },
    value: () => value
  }
}
