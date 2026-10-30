import assert from 'node:assert/strict'
import test from 'node:test'

import { capabilityRequirementsSatisfied } from '../capability-requirements.js'
import type { ProjectCoordinatorProject } from './contract.js'
import { selectRequirementsWorker } from './worker-selection.js'

type AvailabilityOverrides = Readonly<{
  connectionStatus?: 'online' | 'offline'
  acceptsNewOffers?: boolean
  runtimeCapabilityTags?: readonly string[]
  activeTaskCount?: number
  membershipState?: 'active' | 'invited' | 'removed'
}>

function workerGroup(
  userId: string,
  agentId: string,
  overrides: AvailabilityOverrides = {}
): ProjectCoordinatorProject['workerGroups'][number] {
  return {
    userId,
    displayName: `Worker ${userId}`,
    agents: [{
      displayName: `Agent ${agentId}`,
      projectAvailability: {
        schemaVersion: 1,
        type: 'project_worker_availability_view',
        projectId: 'prj_SelectionTest01',
        userId,
        agentId,
        revision: 1,
        membership: {
          schemaVersion: 1,
          type: 'project_membership',
          projectMembershipId: `pmb_${userId}`,
          projectId: 'prj_SelectionTest01',
          userId,
          state: overrides.membershipState ?? 'active',
          authorityEpoch: 1,
          activatedAt: '2026-08-25T01:00:00.000Z',
          removalRequestedAt: null,
          removalRequestedByUserId: null,
          removedAt: null,
          revision: 1,
          createdAt: '2026-08-25T01:00:00.000Z',
          updatedAt: '2026-08-25T01:00:00.000Z'
        },
        availability: {
          schemaVersion: 1,
          type: 'worker_availability_projection',
          revision: 1,
          createdAt: '2026-08-25T01:00:00.000Z',
          updatedAt: '2026-08-25T01:00:00.000Z',
          userId,
          agentId,
          deviceId: `dev_${userId}`,
          agentActive: true,
          deviceActive: true,
          connectionStatus: overrides.connectionStatus ?? 'online',
          lastHeartbeatAt: '2026-08-25T01:05:00.000Z',
          runtimeReadiness: 'ready',
          runtimeCapabilityTags: overrides.runtimeCapabilityTags ?? [],
          acceptsNewOffers: overrides.acceptsNewOffers ?? true,
          activeTaskCount: overrides.activeTaskCount ?? 0,
          observedAt: '2026-08-25T01:05:00.000Z',
          expiresAt: '2026-08-25T02:00:00.000Z'
        },
        taskAuthorities: [],
        observedAt: '2026-08-25T01:05:00.000Z'
      }
    }]
  } as unknown as ProjectCoordinatorProject['workerGroups'][number]
}

test('picks the least loaded eligible Worker with a stable userId tiebreak', () => {
  const groups = [
    workerGroup('usr_WorkerB', 'agt_WorkerB', { activeTaskCount: 2 }),
    workerGroup('usr_WorkerA', 'agt_WorkerA', { activeTaskCount: 2 }),
    workerGroup('usr_WorkerC', 'agt_WorkerC', { activeTaskCount: 5 })
  ]
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', []), 'usr_WorkerA')
  assert.equal(
    selectRequirementsWorker([groups[0]!, groups[2]!], 'usr_Owner', []),
    'usr_WorkerB'
  )
})

test('uses Unicode code point order for equal-load userId ties', () => {
  const groups = [
    workerGroup('usr_a', 'agt_Lowercase', { activeTaskCount: 0 }),
    workerGroup('usr_A', 'agt_Uppercase', { activeTaskCount: 0 })
  ]
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', []), 'usr_A')
})

test('requires tag coverage, online availability, and acceptance of new offers', () => {
  const groups = [
    workerGroup('usr_Untagged', 'agt_Untagged', { runtimeCapabilityTags: ['qc'] }),
    workerGroup('usr_Offline', 'agt_Offline', { connectionStatus: 'offline', runtimeCapabilityTags: ['qc', 'annotate'] }),
    workerGroup('usr_Busy', 'agt_Busy', { acceptsNewOffers: false, runtimeCapabilityTags: ['qc', 'annotate'] }),
    workerGroup('usr_Invited', 'agt_Invited', { membershipState: 'invited', runtimeCapabilityTags: ['qc', 'annotate'] }),
    workerGroup('usr_Eligible', 'agt_Eligible', { runtimeCapabilityTags: ['qc', 'annotate', 'extra'] })
  ]
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', ['qc', 'annotate']), 'usr_Eligible')
  assert.equal(selectRequirementsWorker(groups.slice(0, 4), 'usr_Owner', ['qc', 'annotate']), null)
})

test('a module without tags qualifies every eligible Worker and exclusions apply', () => {
  const groups = [
    workerGroup('usr_Failed', 'agt_Failed', { activeTaskCount: 0 }),
    workerGroup('usr_Alternate', 'agt_Alternate', { activeTaskCount: 3 })
  ]
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', [], ['usr_Failed']), 'usr_Alternate')
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', [], ['usr_Failed', 'usr_Alternate']), null)
})

test('dispatch selection and the local preflight share one capability rule', () => {
  const scenarios = [
    { required: ['agent-runtime.codex'], available: ['agent-runtime.codex', 'model-access.api'], expected: true },
    { required: ['public-data-selection', 'single-cell-rna-seq'], available: ['agent-runtime.codex', 'model-access.api'], expected: false },
    { required: ['agent-runtime.codex', 'model-access.api'], available: ['agent-runtime.codex'], expected: false },
    { required: [], available: [], expected: true }
  ]
  for (const scenario of scenarios) {
    const selected = selectRequirementsWorker(
      [workerGroup('usr_CapabilityRule', 'agt_CapabilityRule', {
        runtimeCapabilityTags: scenario.available
      })],
      'usr_Owner',
      scenario.required
    )
    assert.equal(
      selected !== null,
      capabilityRequirementsSatisfied(scenario.required, scenario.available),
      JSON.stringify(scenario)
    )
    assert.equal(selected !== null, scenario.expected, JSON.stringify(scenario))
  }
})

test('prefers an eligible non-Owner even when the Owner has the smallest userId and no greater load', () => {
  for (const memberLoad of [0, 3]) {
    const groups = [
      workerGroup('usr_AOwner', 'agt_Owner', { activeTaskCount: 0 }),
      workerGroup('usr_BMember', 'agt_Member', { activeTaskCount: memberLoad })
    ]
    assert.equal(selectRequirementsWorker(groups, 'usr_AOwner', []), 'usr_BMember')
  }
})

test('falls back to the eligible Owner only when no other eligible member remains', () => {
  const groups = [
    workerGroup('usr_Owner', 'agt_Owner', { runtimeCapabilityTags: ['qc'] }),
    workerGroup('usr_Member', 'agt_Member', { connectionStatus: 'offline' })
  ]
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', ['qc']), 'usr_Owner')
  groups[1] = workerGroup('usr_Member', 'agt_Member', { runtimeCapabilityTags: ['qc'] })
  assert.equal(selectRequirementsWorker(groups, 'usr_Owner', ['qc'], ['usr_Member']), 'usr_Owner')
})

test('returns null when the fallback Owner fails any eligibility condition or is excluded', () => {
  const ineligible: AvailabilityOverrides[] = [
    { membershipState: 'invited' },
    { membershipState: 'removed' },
    { connectionStatus: 'offline' },
    { acceptsNewOffers: false },
    { runtimeCapabilityTags: [] }
  ]
  for (const overrides of ineligible) {
    const groups = [workerGroup('usr_Owner', 'agt_Owner', {
      runtimeCapabilityTags: ['qc'], ...overrides
    })]
    assert.equal(selectRequirementsWorker(groups, 'usr_Owner', ['qc']), null, JSON.stringify(overrides))
  }
  assert.equal(selectRequirementsWorker(
    [workerGroup('usr_Owner', 'agt_Owner')], 'usr_Owner', [], ['usr_Owner']
  ), null)
})
