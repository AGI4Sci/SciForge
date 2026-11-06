import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import {
  CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION,
  collectCreateLoopResourceExecutors,
  missingCreateLoopResourceProvider,
  missingCreateLoopWorkflowResourceProvider
} from './resource-executor.js'
import type { WorkflowNodeV1, WorkflowV1 } from './contract.js'

test('preflights missing providers while allowing installed and disabled resource nodes', () => {
  const node: WorkflowNodeV1 = {
    id: 'resource', name: 'Resource', type: 'resource', disabled: false,
    position: { x: 0, y: 0 },
    config: {
      providerId: 'test-provider', resourceId: 'record', resourceName: 'Record',
      operationId: 'read', inputTemplate: '{}'
    }
  }
  assert.equal(
    missingCreateLoopResourceProvider([node], new Map()),
    "Resource provider 'test-provider' is not installed."
  )
  const executor = { id: 'test-provider', execute: async () => ({ result: null }) }
  assert.equal(missingCreateLoopResourceProvider([node], new Map([[executor.id, executor]])), undefined)
  assert.equal(missingCreateLoopResourceProvider([{ ...node, disabled: true }], new Map()), undefined)
})

test('collects provider-owned resource executors from the generic main extension host', () => {
  const executor = Object.freeze({
    id: 'fixture-provider',
    execute: async () => ({ result: { ok: true } })
  })
  const host = contributionHost([contribution('fixture.executor', 'fixture-provider', executor)])

  assert.deepEqual(collectCreateLoopResourceExecutors(host), [executor])
})

test('rejects mismatched and duplicate provider executors', () => {
  const executor = Object.freeze({
    id: 'fixture-provider',
    execute: async () => ({ result: { ok: true } })
  })
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([{
      ...contribution('fixture.invalid', 'fixture-provider', executor),
      contract: {
        location: CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION,
        providerId: 'fixture-provider',
        unexpected: true
      }
    }])),
    /has an invalid contract/
  )
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([
      contribution('fixture.mismatch', 'other-provider', executor)
    ])),
    /does not match provider/
  )
  assert.throws(
    () => collectCreateLoopResourceExecutors(contributionHost([
      contribution('fixture.first', 'fixture-provider', executor),
      contribution('fixture.second', 'fixture-provider', executor)
    ])),
    /is duplicated/
  )
})

test('recursive provider preflight terminates cycles without hiding later resources', () => {
  const first = preflightWorkflow('first', ['second', 'leaf'])
  const second = preflightWorkflow('second', ['first'])
  const leaf = preflightWorkflow('leaf', [])
  assert.equal(missingCreateLoopWorkflowResourceProvider(first, 'trigger', [first, second, leaf], new Map()), undefined)
  leaf.nodes.push({
    id: 'resource', name: 'Resource', type: 'resource', disabled: false,
    position: { x: 0, y: 0 },
    config: { providerId: 'missing-cycle-provider', resourceId: 'record', resourceName: 'Record', operationId: 'read', inputTemplate: '{}' }
  })
  leaf.connections.push({ id: 'resource-edge', source: 'trigger', sourceHandle: '', target: 'resource', targetHandle: '' })
  assert.equal(
    missingCreateLoopWorkflowResourceProvider(first, 'trigger', [first, second, leaf], new Map()),
    "Resource provider 'missing-cycle-provider' is not installed."
  )
  // A self-call is rejected by runtime before entry; graph cycles also terminate.
  const self = preflightWorkflow('self', ['self'])
  self.connections.push({ id: 'back-edge', source: 'call-0', sourceHandle: '', target: 'trigger', targetHandle: '' })
  assert.equal(missingCreateLoopWorkflowResourceProvider(self, 'trigger', [self], new Map()), undefined)
})

test('recursive provider preflight skips missing and triggerless targets as runtime does', () => {
  const first = preflightWorkflow('first', ['missing', 'triggerless'])
  const triggerless = preflightWorkflow('triggerless', [])
  triggerless.nodes = [{
    id: 'resource', name: 'Resource', type: 'resource', disabled: false,
    position: { x: 0, y: 0 },
    config: { providerId: 'missing-provider', resourceId: 'record', resourceName: 'Record', operationId: 'read', inputTemplate: '{}' }
  }]
  assert.equal(missingCreateLoopWorkflowResourceProvider(first, 'trigger', [first, triggerless], new Map()), undefined)
})

function preflightWorkflow(id: string, targets: readonly string[]): WorkflowV1 {
  return {
    id, name: id, enabled: true, callableByAgent: true, env: [],
    createdAt: '', updatedAt: '', lastRunAt: '', nextRunAt: '', lastStatus: 'idle', lastMessage: '', runs: [],
    nodes: [
      { id: 'trigger', name: 'Manual', type: 'manual-trigger', disabled: false, position: { x: 0, y: 0 }, config: { workspaceRoot: '', inputSchema: [] } },
      ...targets.map((workflowId, index): WorkflowNodeV1 => ({
        id: `call-${index}`, name: 'Call', type: 'subworkflow', disabled: false,
        position: { x: 0, y: 0 }, config: { workflowId }
      }))
    ],
    connections: targets.map((_, index) => ({
      id: `edge-${index}`, source: 'trigger', sourceHandle: '', target: `call-${index}`, targetHandle: ''
    }))
  }
}

function contribution(
  id: string,
  providerId: string,
  value: unknown
): DomainMainContribution {
  return {
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/provider',
    owner: { moduleId: 'fixture.provider', moduleVersion: '1.0.0' },
    contract: { location: CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION, providerId },
    value
  }
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return {
    list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  }
}
